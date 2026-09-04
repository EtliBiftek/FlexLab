import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { RUNTIMES_DIR } from './config.mjs';

const UA = 'FlexLab/0.4.0 (+local-ai-desktop)';

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
  try { execFileSync(process.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi', ['-L'], { stdio: 'ignore', timeout: 3000 }); return true; } catch { return false; }
}
function scoreAsset(name, runtime) {
  const n = name.toLowerCase();
  const win = process.platform === 'win32';
  const linux = process.platform === 'linux';
  const mac = process.platform === 'darwin';
  let s = 0;
  if (!/\.zip$|\.tar\.gz$/.test(n)) return -999;
  if (/cudart|cuda-runtime|runtime-only/.test(n)) return -500;
  if (win && /(win|windows)/.test(n)) s += 50; else if (linux && /(ubuntu|linux)/.test(n)) s += 50; else if (mac && /(mac|darwin)/.test(n)) s += 50; else s -= 50;
  if (process.arch === 'x64' && /(x64|x86_64)/.test(n)) s += 20;
  if (process.arch === 'arm64' && /(arm64|aarch64)/.test(n)) s += 20;
  if (hasNvidia() && /cuda|cu12|cudart/.test(n)) s += 80;
  if (!hasNvidia() && /vulkan/.test(n)) s += 35;
  if (/cpu|avx2/.test(n)) s += 10;
  if (runtime === 'llama' && /server/.test(n)) s += 5;
  return s;
}
async function download(url, dest) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`Runtime indirme HTTP ${r.status}`);
  const file = await fs.open(dest, 'w');
  try {
    const reader = r.body.getReader();
    while (true) { const {done,value}=await reader.read(); if(done) break; await file.write(value); }
  } finally { await file.close(); }
}
function extract(archive, dir) {
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile','-Command',`Expand-Archive -LiteralPath '${archive.replace(/'/g,"''")}' -DestinationPath '${dir.replace(/'/g,"''")}' -Force`], { stdio:'inherit' });
  } else if (archive.endsWith('.zip')) {
    execFileSync('unzip', ['-o', archive, '-d', dir], { stdio:'inherit' });
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', dir], { stdio:'inherit' });
  }
}
async function installFromGithub({ repo, dirName, exeNames, runtime }) {
  const dir = path.join(RUNTIMES_DIR, dirName);
  const existing = await walkFind(dir, exeNames);
  if (existing) return existing;
  await fs.mkdir(dir, { recursive: true });
  const rel = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { 'user-agent': UA, accept:'application/vnd.github+json' } });
  if (!rel.ok) throw new Error(`${repo} release bulunamadı (${rel.status})`);
  const json = await rel.json();
  const assets = (json.assets || []).map((a) => ({...a, score: scoreAsset(a.name, runtime)})).sort((a,b)=>b.score-a.score);
  const asset = assets.find((a) => a.score > 0);
  if (!asset) throw new Error(`${repo} için bu sistemde uygun prebuilt runtime bulunamadı.`);
  const archive = path.join(dir, asset.name);
  await download(asset.browser_download_url, archive);
  extract(archive, dir);
  await fs.rm(archive, { force:true }).catch(()=>{});
  if (process.platform === 'win32' && hasNvidia() && /cuda|cu12/i.test(asset.name)) {
    const companion = (json.assets || []).find((a) => /cudart/i.test(a.name || '') && /win|windows/i.test(a.name || '') && /x64|x86_64/i.test(a.name || ''));
    if (companion) {
      const runtimeArchive = path.join(dir, companion.name);
      await download(companion.browser_download_url, runtimeArchive);
      extract(runtimeArchive, dir);
      await fs.rm(runtimeArchive, { force:true }).catch(()=>{});
    }
  }
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
    'llama.cpp': { installed: Boolean(llamaPath), path: llamaPath },
    'stable-diffusion.cpp': { installed: Boolean(sdPath), path: sdPath },
    'musicgen-python': { installed: musicInstalled, path: musicInstalled ? musicPython : null },
  };
}

export function ensureLlamaCpp() {
  return installFromGithub({ repo:'ggml-org/llama.cpp', dirName:'llama.cpp', exeNames: process.platform==='win32'?['llama-server.exe']:['llama-server'], runtime:'llama' });
}
export function ensureStableDiffusionCpp() {
  return installFromGithub({ repo:'leejet/stable-diffusion.cpp', dirName:'stable-diffusion.cpp', exeNames: process.platform==='win32'?['sd-cli.exe']:['sd-cli'], runtime:'sd' });
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
      execFileSync(c.cmd, [...c.prefix, '-c', 'import sys; print(sys.version_info[:2])'], { stdio: 'ignore', timeout: 5000 });
      return c;
    } catch {}
  }
  throw new Error('MusicGen için Python 3 bulunamadı. Python 3.10+ kurun veya FLEXLAB_PYTHON yolunu ayarlayın.');
}

export async function ensureMusicGenPython() {
  const root = path.join(RUNTIMES_DIR, 'musicgen-python');
  const venv = path.join(root, 'venv');
  const python = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
  await fs.mkdir(root, { recursive: true });
  if (!await exists(python)) {
    const sys = findSystemPython();
    execFileSync(sys.cmd, [...sys.prefix, '-m', 'venv', venv], { stdio: 'inherit' });
  }
  try {
    execFileSync(python, ['-c', 'import torch, transformers, scipy, accelerate, sentencepiece'], { stdio: 'ignore', timeout: 15000 });
  } catch {
    execFileSync(python, ['-m', 'pip', 'install', '--upgrade', 'pip'], { stdio: 'inherit' });
    execFileSync(python, ['-m', 'pip', 'install', 'torch', 'transformers>=4.46', 'scipy', 'accelerate', 'sentencepiece', 'protobuf', 'safetensors'], { stdio: 'inherit' });
  }
  return python;
}
