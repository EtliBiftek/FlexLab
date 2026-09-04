import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import extractZip from 'extract-zip';
import { RUNTIMES_DIR } from './config.mjs';

const UA = 'FlexLab/0.4.0 (+local-ai-desktop)';
const runtimeJobs = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nvidiaCache;

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function walkFind(dir, names) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const ent of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (names.includes(ent.name.toLowerCase())) return p;
    }
  }
  return null;
}

function hasNvidia() {
  if (nvidiaCache !== undefined) return nvidiaCache;
  try {
    execFileSync(process.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi', ['-L'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
    nvidiaCache = true;
  } catch {
    nvidiaCache = false;
  }
  return nvidiaCache;
}

function scoreAsset(name, runtime) {
  const n = String(name || '').toLowerCase();
  if (!/\.zip$|\.tar\.gz$/.test(n)) return -999;
  if (/cudart|cuda-runtime|runtime-only/.test(n)) return -500;

  const win = process.platform === 'win32';
  const linux = process.platform === 'linux';
  const mac = process.platform === 'darwin';
  if (win && !/(?:^|[-_.])(win|windows)(?:[-_.]|$)/.test(n)) return -999;
  if (linux && !/(ubuntu|linux)/.test(n)) return -999;
  if (mac && !/(mac|macos|darwin)/.test(n)) return -999;

  if (process.arch === 'x64' && /(arm64|aarch64)/.test(n)) return -999;
  if (process.arch === 'arm64' && /(x64|x86_64)/.test(n)) return -999;

  let s = 50;
  if (process.arch === 'x64' && /(x64|x86_64)/.test(n)) s += 25;
  if (process.arch === 'arm64' && /(arm64|aarch64)/.test(n)) s += 25;

  if (hasNvidia()) {
    if (/cuda|cu12|cu13/.test(n)) s += 100;
    else if (/vulkan/.test(n)) s += 35;
    else if (/cpu|avx2/.test(n)) s += 15;
  } else {
    if (/cuda|cu12|cu13/.test(n)) s -= 100;
    if (/vulkan/.test(n)) s += 55;
    if (/cpu|avx2/.test(n)) s += 35;
  }

  if (runtime === 'llama' && /server|llama/.test(n)) s += 5;
  return s;
}

function installableAssets(release, runtime) {
  return (release?.assets || [])
    .map((a) => ({ ...a, score: scoreAsset(a.name, runtime) }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function githubJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub release bilgisi alınamadı (${r.status})`);
  return r.json();
}

async function releaseWithBinaries(repo, runtime, job) {
  if (job) { job.phase = 'Uygun prebuilt sürüm aranıyor'; job.progress = Math.max(job.progress, 2); }
  let release = await githubJson(`https://api.github.com/repos/${repo}/releases/latest`);
  if (installableAssets(release, runtime).length) return release;

  const pointer = (release.assets || []).find((a) => String(a.name || '').toLowerCase() === 'nightly-tag.txt');
  let tag = '';
  if (pointer?.browser_download_url) {
    const r = await fetch(pointer.browser_download_url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    if (r.ok) tag = (await r.text()).trim();
  }
  if (!tag) tag = String(release.body || '').match(/releases\/tag\/(b\d+)/i)?.[1] || '';
  if (tag) {
    if (job) job.phase = `Prebuilt ${tag} çözülüyor`;
    release = await githubJson(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  }
  return release;
}

function runHidden(command, args, { cwd, job, phase } = {}) {
  return new Promise((resolve, reject) => {
    if (job && phase) job.phase = phase;
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const add = (chunk) => {
      const text = chunk.toString();
      log = (log + text).slice(-12000);
      if (job) {
        const line = text.trim().split(/\r?\n/).filter(Boolean).pop();
        if (line) job.detail = line.slice(0, 240);
      }
    };
    child.stdout?.on('data', add);
    child.stderr?.on('data', add);
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(log) : reject(new Error(`${path.basename(command)} ${code} ile kapandı.\n${log.slice(-4000)}`)));
  });
}

async function download(url, dest, job) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`Runtime indirme HTTP ${r.status}`);
  const expected = Number(r.headers.get('content-length') || 0);
  const base = Number(job?.loadedBytes || 0);
  if (job && !job.totalBytes && expected) job.totalBytes = expected;
  const file = await fs.open(dest, 'w');
  let loaded = 0;
  let speedAt = Date.now();
  let speedBytes = 0;
  try {
    const reader = r.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await file.write(value);
      loaded += value.byteLength;
      if (job) {
        job.loadedBytes = base + loaded;
        const total = Number(job.totalBytes || expected || 0);
        if (total) job.progress = Math.max(job.progress, Math.min(80, Math.max(5, Math.round(5 + (job.loadedBytes / total) * 75))));
        const now = Date.now();
        if (now - speedAt >= 500) {
          job.speedBps = Math.round(((loaded - speedBytes) * 1000) / (now - speedAt));
          speedBytes = loaded;
          speedAt = now;
        }
      }
    }
  } finally {
    await file.close();
  }
  if (job) { job.loadedBytes = base + loaded; job.speedBps = 0; }
}

async function extract(archive, dir, job) {
  if (job) { job.status = 'extracting'; job.phase = 'Arşiv çıkarılıyor'; job.progress = Math.max(job.progress, 84); }
  if (archive.toLowerCase().endsWith('.zip')) {
    await extractZip(archive, { dir: path.resolve(dir) });
    return;
  }
  await runHidden('tar', ['-xzf', archive, '-C', dir], { job, phase: 'Arşiv çıkarılıyor' });
}

async function installFromGithub({ repo, dirName, exeNames, runtime }, job) {
  const dir = path.join(RUNTIMES_DIR, dirName);
  const existing = await walkFind(dir, exeNames);
  if (existing) return existing;
  await fs.mkdir(dir, { recursive: true });

  const release = await releaseWithBinaries(repo, runtime, job);
  const assets = installableAssets(release, runtime);
  const asset = assets[0];
  if (!asset) throw new Error(`${repo} için bu sistemde uygun prebuilt runtime bulunamadı.`);

  let companion = null;
  if (process.platform === 'win32' && hasNvidia() && /cuda|cu12|cu13/i.test(asset.name)) {
    const ver = String(asset.name).match(/cuda-([0-9.]+)/i)?.[1] || '';
    companion = (release.assets || []).find((a) => {
      const n = String(a.name || '');
      return /cudart/i.test(n) && /win|windows/i.test(n) && /x64|x86_64/i.test(n) && (!ver || n.includes(`cuda-${ver}`));
    }) || null;
  }

  if (job) {
    job.status = 'downloading';
    job.phase = `${asset.name} indiriliyor`;
    job.assetName = asset.name;
    job.totalBytes = Number(asset.size || 0) + Number(companion?.size || 0);
    job.loadedBytes = 0;
    job.progress = 5;
  }

  const archive = path.join(dir, asset.name);
  await download(asset.browser_download_url, archive, job);
  await extract(archive, dir, job);
  await fs.rm(archive, { force: true }).catch(() => {});

  if (companion) {
    if (job) { job.status = 'downloading'; job.phase = `${companion.name} indiriliyor`; job.progress = Math.max(job.progress, 84); }
    const runtimeArchive = path.join(dir, companion.name);
    await download(companion.browser_download_url, runtimeArchive, job);
    await extract(runtimeArchive, dir, job);
    await fs.rm(runtimeArchive, { force: true }).catch(() => {});
  }

  if (job) { job.status = 'installing'; job.phase = 'Runtime doğrulanıyor'; job.progress = 96; }
  const exe = await walkFind(dir, exeNames);
  if (!exe) throw new Error(`${repo} indirildi fakat executable bulunamadı.`);
  return exe;
}

export async function runtimeInstallState() {
  const llamaDir = path.join(RUNTIMES_DIR, 'llama.cpp');
  const sdDir = path.join(RUNTIMES_DIR, 'stable-diffusion.cpp');
  const musicRoot = path.join(RUNTIMES_DIR, 'musicgen-python');
  const llamaNames = process.platform === 'win32' ? ['llama-server.exe'] : ['llama-server'];
  const sdNames = process.platform === 'win32' ? ['sd-cli.exe'] : ['sd-cli'];
  const musicPython = process.platform === 'win32' ? path.join(musicRoot, 'venv', 'Scripts', 'python.exe') : path.join(musicRoot, 'venv', 'bin', 'python');
  const [llamaPath, sdPath, musicInstalled] = await Promise.all([
    walkFind(llamaDir, llamaNames),
    walkFind(sdDir, sdNames),
    exists(musicPython),
  ]);
  return {
    'llama.cpp': { installed: Boolean(llamaPath), path: llamaPath, job: runtimeJobs.get('llama.cpp') || null },
    'stable-diffusion.cpp': { installed: Boolean(sdPath), path: sdPath, job: runtimeJobs.get('stable-diffusion.cpp') || null },
    'musicgen-python': { installed: musicInstalled, path: musicInstalled ? musicPython : null, job: runtimeJobs.get('musicgen-python') || null },
  };
}

async function waitForRuntimeJob(job) {
  if (!job) throw new Error('Bilinmeyen runtime.');
  while (!['done', 'error'].includes(job.status)) await sleep(120);
  if (job.status === 'error') throw new Error(job.error || `${job.name} kurulamadı.`);
  return job.path;
}

export function ensureLlamaCpp(job) {
  if (job) return installFromGithub({ repo: 'ggml-org/llama.cpp', dirName: 'llama.cpp', exeNames: process.platform === 'win32' ? ['llama-server.exe'] : ['llama-server'], runtime: 'llama' }, job);
  return waitForRuntimeJob(startRuntimeInstall('llama.cpp'));
}
export function ensureStableDiffusionCpp(job) {
  if (job) return installFromGithub({ repo: 'leejet/stable-diffusion.cpp', dirName: 'stable-diffusion.cpp', exeNames: process.platform === 'win32' ? ['sd-cli.exe'] : ['sd-cli'], runtime: 'sd' }, job);
  return waitForRuntimeJob(startRuntimeInstall('stable-diffusion.cpp'));
}

function findSystemPython() {
  const configured = process.env.FLEXLAB_PYTHON || process.env.HELIX_PYTHON;
  const candidates = configured
    ? [{ cmd: configured, prefix: [] }]
    : process.platform === 'win32'
      ? [{ cmd: 'py.exe', prefix: ['-3'] }, { cmd: 'python.exe', prefix: [] }, { cmd: 'python3.exe', prefix: [] }]
      : [{ cmd: 'python3', prefix: [] }, { cmd: 'python', prefix: [] }];
  for (const c of candidates) {
    try {
      execFileSync(c.cmd, [...c.prefix, '-c', 'import sys; print(sys.version_info[:2])'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
      return c;
    } catch {}
  }
  throw new Error('MusicGen için Python 3 bulunamadı. Python 3.10+ kurun veya FLEXLAB_PYTHON yolunu ayarlayın.');
}

export async function ensureMusicGenPython(job) {
  if (!job) return waitForRuntimeJob(startRuntimeInstall('musicgen-python'));

  const root = path.join(RUNTIMES_DIR, 'musicgen-python');
  const venv = path.join(root, 'venv');
  const python = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
  await fs.mkdir(root, { recursive: true });

  if (!await exists(python)) {
    job.status = 'installing'; job.phase = 'Python sanal ortamı hazırlanıyor'; job.progress = 8;
    const sys = findSystemPython();
    await runHidden(sys.cmd, [...sys.prefix, '-m', 'venv', venv], { job, phase: 'Python sanal ortamı hazırlanıyor' });
  }

  let depsReady = true;
  try {
    await runHidden(python, ['-c', 'import torch, transformers, scipy, accelerate, sentencepiece'], { job });
  } catch {
    depsReady = false;
  }
  if (!depsReady) {
    job.status = 'installing'; job.phase = 'pip güncelleniyor'; job.progress = 25;
    await runHidden(python, ['-m', 'pip', 'install', '--upgrade', 'pip', '--disable-pip-version-check'], { job, phase: 'pip güncelleniyor' });
    job.phase = 'PyTorch ve MusicGen bağımlılıkları indiriliyor'; job.progress = 38;
    const pulse = setInterval(() => { if (job.progress < 92) job.progress += 1; }, 4000);
    pulse.unref?.();
    try {
      await runHidden(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'torch', 'transformers>=4.46', 'scipy', 'accelerate', 'sentencepiece', 'protobuf', 'safetensors'], { job, phase: 'PyTorch ve MusicGen bağımlılıkları indiriliyor' });
    } finally {
      clearInterval(pulse);
    }
  }
  job.phase = 'MusicGen runtime doğrulanıyor'; job.progress = 96;
  return python;
}

export function startRuntimeInstall(name) {
  const known = ['llama.cpp', 'stable-diffusion.cpp', 'musicgen-python'];
  if (!known.includes(name)) return null;
  const previous = runtimeJobs.get(name);
  if (previous && !['done', 'error'].includes(previous.status)) return previous;

  const job = {
    id: crypto.randomUUID(),
    name,
    status: 'queued',
    phase: 'Kurulum hazırlanıyor',
    detail: '',
    progress: 0,
    loadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    assetName: null,
    path: null,
    error: null,
    createdAt: Date.now(),
  };
  runtimeJobs.set(name, job);

  void (async () => {
    try {
      const p = name === 'llama.cpp'
        ? await ensureLlamaCpp(job)
        : name === 'stable-diffusion.cpp'
          ? await ensureStableDiffusionCpp(job)
          : await ensureMusicGenPython(job);
      job.path = p;
      job.status = 'done';
      job.phase = 'Kurulum tamamlandı';
      job.progress = 100;
      job.speedBps = 0;
    } catch (e) {
      job.status = 'error';
      job.phase = 'Kurulum başarısız';
      job.error = e?.message || String(e);
      job.speedBps = 0;
    }
  })();
  return job;
}
