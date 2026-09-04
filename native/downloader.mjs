import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { repoDir, upsertInstalled } from './library.mjs';
import { getHfAuthHeaders, loadConfig } from './config.mjs';
import { readGgufMetadata, capabilitiesFromMetadata } from './gguf.mjs';

const jobs = new Map();
const UA = 'FlexLab/0.4.0 (+local-ai-desktop)';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safePath(root, rel) {
  const full = path.resolve(root, rel);
  const base = path.resolve(root) + path.sep;
  if (!full.startsWith(base)) throw new Error('Geçersiz model dosya yolu.');
  return full;
}

async function sha256(file) {
  const h = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const s = fs.createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('end', resolve);
    s.on('error', reject);
  });
  return h.digest('hex');
}

async function waitWhilePaused(job) {
  while (job?.paused && !job.cancelRequested) {
    job.status = 'paused';
    await sleep(120);
  }
  if (job?.cancelRequested) throw new Error('__FLEXLAB_CANCELLED__');
  if (job && job.status === 'paused') job.status = 'downloading';
}

async function throttle(job, bytesInWindow, windowStartedAt) {
  const limit = Number(job?.speedLimitBps || 0);
  if (!limit) return { bytesInWindow, windowStartedAt };
  const elapsed = Date.now() - windowStartedAt;
  const expected = (bytesInWindow / limit) * 1000;
  if (expected > elapsed) await sleep(Math.min(expected - elapsed, 1000));
  const now = Date.now();
  if (now - windowStartedAt >= 1000) return { bytesInWindow: 0, windowStartedAt: now };
  return { bytesInWindow, windowStartedAt };
}

async function downloadFile(url, dest, { expected = 0, sha256Expected = '', headers = {}, job } = {}, onProgress) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  if (job) job.currentPart = part;
  let existing = 0;
  try { existing = (await fsp.stat(part)).size; } catch {}

  const baseHeaders = { 'user-agent': UA, ...headers };
  if (existing > 0) baseHeaders.range = `bytes=${existing}-`;
  let res = await fetch(url, { headers: baseHeaders, redirect: 'follow' });
  if (existing > 0 && res.status === 200) {
    await fsp.rm(part, { force: true });
    existing = 0;
    delete baseHeaders.range;
    res = await fetch(url, { headers: baseHeaders, redirect: 'follow' });
  }
  if (!res.ok || !res.body) throw new Error(`İndirme HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' — gated/private model için Hugging Face token gerekli olabilir.' : ''}`);

  const contentLength = Number(res.headers.get('content-length') || 0);
  const total = expected || (contentLength ? existing + contentLength : 0);
  let loaded = existing;
  let bytesInWindow = 0;
  let windowStartedAt = Date.now();
  let lastSpeedAt = Date.now();
  let lastSpeedBytes = loaded;
  const reader = res.body.getReader();
  const out = fs.createWriteStream(part, { flags: existing ? 'a' : 'w' });

  try {
    while (true) {
      await waitWhilePaused(job);
      const { done, value } = await reader.read();
      if (done) break;
      await waitWhilePaused(job);
      const chunk = Buffer.from(value);
      await new Promise((resolve, reject) => out.write(chunk, (e) => e ? reject(e) : resolve()));
      loaded += value.byteLength;
      bytesInWindow += value.byteLength;
      const throttled = await throttle(job, bytesInWindow, windowStartedAt);
      bytesInWindow = throttled.bytesInWindow;
      windowStartedAt = throttled.windowStartedAt;
      const now = Date.now();
      if (job && now - lastSpeedAt >= 500) {
        job.speedBps = Math.max(0, Math.round(((loaded - lastSpeedBytes) * 1000) / (now - lastSpeedAt)));
        lastSpeedAt = now;
        lastSpeedBytes = loaded;
      }
      onProgress?.(loaded, total);
    }
  } finally {
    try { await reader.cancel(); } catch {}
    await new Promise((resolve) => out.end(resolve));
  }

  if (job?.cancelRequested) throw new Error('__FLEXLAB_CANCELLED__');
  if (expected && loaded !== expected) throw new Error(`Dosya boyutu uyuşmuyor: beklenen ${expected}, gelen ${loaded}`);
  await fsp.rename(part, dest);
  if (job) job.currentPart = null;

  if (sha256Expected) {
    const got = await sha256(dest);
    if (got.toLowerCase() !== sha256Expected.toLowerCase()) {
      await fsp.rm(dest, { force: true });
      throw new Error(`SHA-256 doğrulaması başarısız: ${path.basename(dest)}`);
    }
  }
  return loaded;
}

function hfResolve(hfId, file, revision) {
  return `https://huggingface.co/${hfId}/resolve/${encodeURIComponent(revision || 'main')}/${file.split('/').map(encodeURIComponent).join('/')}?download=true`;
}

async function listRepoFiles(hfId, revision) {
  const auth = await getHfAuthHeaders();
  const r = await fetch(`https://huggingface.co/api/models/${hfId}?blobs=true&revision=${encodeURIComponent(revision || 'main')}`, { headers: { 'user-agent': UA, ...auth } });
  if (!r.ok) throw new Error(`Hugging Face model bilgisi alınamadı (${r.status})`);
  const raw = await r.json();
  return { files: raw.siblings || [], sha: raw.sha || null };
}

function lfsSha(f) {
  const oid = String(f?.lfs?.oid || '');
  return oid.startsWith('sha256:') ? oid.slice(7) : '';
}

async function remoteFile(hfId, revision, root, patterns, { optional = false, job } = {}) {
  const repo = await listRepoFiles(hfId, revision);
  const f = patterns.map((re) => repo.files.find((x) => re.test(String(x.rfilename || '')))).find(Boolean);
  if (!f) {
    if (optional) return null;
    throw new Error(`${hfId} içinde gerekli companion dosyası yok.`);
  }
  const rel = path.join('_flexlab_deps', hfId.replace(/[^A-Za-z0-9_.-]+/g, '__'), path.basename(f.rfilename));
  const dest = safePath(root, rel);
  const expected = Number(f.size || f.lfs?.size || 0);
  try {
    const st = await fsp.stat(dest);
    if (!expected || st.size === expected) return dest;
  } catch {}
  if (job && expected) job.totalBytes += expected;
  const auth = await getHfAuthHeaders();
  const base = job?.loadedBytes || 0;
  await downloadFile(hfResolve(hfId, f.rfilename, revision), dest, { expected, sha256Expected: lfsSha(f), headers: auth, job }, (cur) => {
    if (job) {
      job.loadedBytes = base + cur;
      job.progress = job.totalBytes ? Math.min(99, Math.round(job.loadedBytes / job.totalBytes * 100)) : job.progress;
    }
  });
  return dest;
}

async function imageCompanions(model, dir, revision, job) {
  if (model.kind !== 'image') return [];
  const h = model.pipelineHint || 'sd';
  const out = [];
  const push = async (...a) => { const p = await remoteFile(...a); if (p) out.push(p); };
  if (h === 'qwen-image') {
    await push(model.hfId, revision, dir, [/vae\/.*\.(safetensors|gguf)$/i, /vae.*\.(safetensors|gguf)$/i], { job });
    await push('Qwen/Qwen2.5-VL-7B-Instruct-GGUF', 'main', dir, [/Q4_K_M\.gguf$/i], { job });
    await push('Qwen/Qwen2.5-VL-7B-Instruct-GGUF', 'main', dir, [/mmproj.*\.gguf$/i], { optional: true, job });
  } else if (h === 'mage-flow') {
    await push(model.hfId, revision, dir, [/vae\/.*\.(safetensors|gguf)$/i, /mage_vae\.safetensors$/i], { job });
    await push('Qwen/Qwen3-VL-4B-Instruct-GGUF', 'main', dir, [/Q4_K_M\.gguf$/i], { job });
    await push('Qwen/Qwen3-VL-4B-Instruct-GGUF', 'main', dir, [/mmproj.*\.gguf$/i], { optional: true, job });
  } else if (h === 'flux2') {
    await push(model.hfId, revision, dir, [/vae\/.*\.(safetensors|gguf)$/i, /(?:ae|vae).*\.(safetensors|gguf)$/i], { job });
  } else if (h === 'sd3') {
    for (const re of [/clip_l.*\.(safetensors|gguf)$/i, /clip_g.*\.(safetensors|gguf)$/i, /t5.*\.(safetensors|gguf)$/i]) await push(model.hfId, revision, dir, [re], { job });
  }
  return out;
}

export async function startDownload(model, quantId, options = {}) {
  if (model?.controlJobId) return controlDownloadJob(model.controlJobId, model.controlAction, model.value);
  const cfg = await loadConfig();
  const revision = options.revision || cfg.hfRevision || 'main';
  const job = {
    id: crypto.randomUUID(),
    modelId: model.id,
    modelName: model.name || model.hfId,
    hfId: model.hfId,
    quantId,
    quantLabel: null,
    status: 'queued',
    progress: 0,
    loadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    speedLimitBps: Math.max(0, Number(options.speedLimitBps || 0)),
    paused: false,
    cancelRequested: false,
    error: null,
    revision,
    createdAt: Date.now(),
    currentPart: null,
  };
  jobs.set(job.id, job);

  void (async () => {
    try {
      job.status = 'downloading';
      const dir = repoDir(model.hfId);
      await fsp.mkdir(dir, { recursive: true });
      const auth = await getHfAuthHeaders();
      const repo = await listRepoFiles(model.hfId, revision);
      const q = model.quants.find((x) => x.id === quantId) || model.quants.find((x) => x.recommended) || model.quants[0];
      if (!q) throw new Error('Quantization bulunamadı.');
      job.quantId = q.id;
      job.quantLabel = q.label;
      let selected = q.file === '*' ? repo.files : repo.files.filter((f) => f.rfilename === q.file);
      if (model.kind === 'llm' && model.vision) {
        const mm = model.mmproj?.find((x) => /bf16|f16|q8/i.test(x.file || '')) || model.mmproj?.[0];
        if (mm) {
          const f = repo.files.find((x) => x.rfilename === mm.file);
          if (f) selected.push(f);
        }
      }
      job.totalBytes = selected.reduce((n, f) => n + Number(f.size || f.lfs?.size || 0), 0);
      for (const f of selected) {
        await waitWhilePaused(job);
        const dest = safePath(dir, f.rfilename);
        const base = job.loadedBytes;
        const expected = Number(f.size || f.lfs?.size || 0);
        await downloadFile(hfResolve(model.hfId, f.rfilename, revision), dest, { expected, sha256Expected: lfsSha(f), headers: auth, job }, (cur) => {
          job.loadedBytes = base + cur;
          job.progress = job.totalBytes ? Math.min(99, Math.round(job.loadedBytes / job.totalBytes * 100)) : 0;
        });
        job.loadedBytes = base + expected;
      }
      await imageCompanions(model, dir, revision, job);
      const main = q.file === '*' ? selected.find((f) => /\.(gguf|safetensors|ckpt)$/i.test(f.rfilename || ''))?.rfilename : q.file;
      const localPath = main ? safePath(dir, main) : dir;
      let meta = {};
      if (model.kind === 'llm' && /\.gguf$/i.test(localPath)) {
        try {
          const r = await readGgufMetadata(localPath);
          meta = capabilitiesFromMetadata(r.metadata);
        } catch {}
      }
      const installed = { ...model, id: model.id, revision, resolvedRevision: repo.sha || revision, localDir: dir, localPath, quant: q, installedAt: Date.now(), metadata: meta, think: meta.think ?? model.think, thinkLevels: meta.thinkLevels ?? model.thinkLevels, vision: meta.vision ?? model.vision, context: meta.context ? String(meta.context) : model.context, embedding: meta.embedding ?? false, blockCount: meta.blockCount };
      if (model.kind === 'llm' && model.vision) {
        const mm = model.mmproj?.find((x) => /bf16|f16|q8/i.test(x.file || '')) || model.mmproj?.[0];
        if (mm) installed.mmprojPath = safePath(dir, mm.file);
      }
      await upsertInstalled(installed);
      job.status = 'done';
      job.progress = 100;
      job.speedBps = 0;
      job.model = installed;
    } catch (e) {
      if (String(e?.message || e) === '__FLEXLAB_CANCELLED__') {
        job.status = 'cancelled';
        job.error = null;
        job.speedBps = 0;
        if (job.currentPart) await fsp.rm(job.currentPart, { force: true }).catch(() => {});
      } else {
        job.status = 'error';
        job.error = e?.message || String(e);
        job.speedBps = 0;
      }
    } finally {
      job.currentPart = null;
    }
  })();
  return job;
}

export function controlDownloadJob(id, action, value) {
  const job = jobs.get(id);
  if (!job) return null;
  if (action === 'pause' && ['queued', 'downloading'].includes(job.status)) {
    job.paused = true;
    job.status = 'paused';
  } else if (action === 'resume' && job.status === 'paused') {
    job.paused = false;
    job.status = 'downloading';
  } else if (action === 'cancel' && !['done', 'error', 'cancelled'].includes(job.status)) {
    job.cancelRequested = true;
    job.paused = false;
    job.status = 'cancelling';
  } else if (action === 'speed') {
    job.speedLimitBps = Math.max(0, Number(value || 0));
  }
  return job;
}

export function getDownloadJob(id) { return jobs.get(id) || null; }
export function listDownloadJobs() { return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt); }
