import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { readGgufMetadata, capabilitiesFromMetadata } from './gguf.mjs';
import { loadLibrary, saveLibrary, upsertInstalled } from './library.mjs';

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function statSafe(p) { try { return await fs.stat(p); } catch { return null; } }
async function readJsonSafe(p) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; } }
async function listFiles(root, max = 400) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop();
    for (const ent of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else out.push(p);
      if (out.length >= max) break;
    }
  }
  return out;
}
function low(s) { return String(s || '').toLowerCase(); }
function hasAny(s, re) { return re.test(low(s)); }
function basenameName(p) { return path.basename(p, path.extname(p)).replace(/[-_]+/g, ' ').trim() || 'Yerel model'; }
function runtimeFor(kind, format, hint = '') {
  if (kind === 'llm') return format === 'gguf' ? 'llama.cpp' : 'transformers-python';
  if (kind === 'image') return /^(sd|flux1|flux2|sd3|qwen-image|mage-flow|z-image|ideogram4)$/.test(hint) ? 'stable-diffusion.cpp' : 'diffusers-python';
  return 'audio-python';
}
function inferImageHint(text) {
  const s = low(text);
  if (/qwen.?image/.test(s)) return 'qwen-image';
  if (/mage.?flow/.test(s)) return 'mage-flow';
  if (/flux.?2/.test(s)) return 'flux2';
  if (/\bflux\b/.test(s)) return 'flux1';
  if (/ideogram.?4/.test(s)) return 'ideogram4';
  if (/stable.?diffusion.?3|\bsd3\b/.test(s)) return 'sd3';
  if (/z.?image/.test(s)) return 'z-image';
  if (/stable.?diffusion|sdxl|sd1\.?5|checkpoint|unet/.test(s)) return 'sd';
  return 'diffusers';
}
function configKind(config, modelIndex, names) {
  const text = `${JSON.stringify(config || {})} ${JSON.stringify(modelIndex || {})} ${names}`.toLowerCase();
  if (/musicgen|audiogen|text-to-audio|audio-generation|bark|music/.test(text)) return 'music';
  if (/diffusionpipeline|stablediffusion|fluxpipeline|text-to-image|image-to-image|unet2d|vae|diffusers/.test(text)) return 'image';
  return 'llm';
}
async function inspectPath(input) {
  const target = path.resolve(String(input || ''));
  const st = await statSafe(target);
  if (!st) throw new Error(`Model yolu bulunamadı: ${target}`);
  const isDir = st.isDirectory();
  const files = isDir ? await listFiles(target) : [target];
  const names = files.map((f) => path.relative(isDir ? target : path.dirname(target), f)).join(' ');
  const ext = isDir ? '' : path.extname(target).toLowerCase();
  const root = isDir ? target : path.dirname(target);
  const config = await readJsonSafe(path.join(root, 'config.json'));
  const modelIndex = await readJsonSafe(path.join(root, 'model_index.json'));
  let kind = configKind(config, modelIndex, `${target} ${names}`);
  let format = ext.replace(/^\./, '') || 'folder';
  let meta = {};
  let localPath = target;
  let localDir = root;
  let vision = false, think = false, thinkLevels = false, embedding = false;
  if (ext === '.gguf') {
    kind = /diffusion|flux|sdxl|stable.?diffusion|vae|unet|image/i.test(target) ? 'image' : 'llm';
    try {
      const r = await readGgufMetadata(target);
      meta = capabilitiesFromMetadata(r.metadata);
      vision = Boolean(meta.vision); think = Boolean(meta.think); thinkLevels = Boolean(meta.thinkLevels); embedding = Boolean(meta.embedding);
    } catch {}
  } else if (!isDir && ['.ckpt', '.safetensors'].includes(ext)) {
    if (/music|audio|bark|musicgen|audiogen/i.test(target)) kind = 'music';
    else if (/sdxl|stable.?diffusion|flux|diffusion|unet|vae|checkpoint|image/i.test(target)) kind = 'image';
  }
  if (isDir) {
    const main = files.find((f) => /\.gguf$/i.test(f) && !/mmproj/i.test(f)) || files.find((f) => /\.(safetensors|ckpt|bin)$/i.test(f));
    if (main) localPath = main;
    format = files.some((f) => /\.gguf$/i.test(f)) ? 'gguf-folder' : modelIndex ? 'diffusers' : config ? 'transformers' : 'folder';
  }
  const hint = kind === 'image' ? inferImageHint(`${target} ${names} ${JSON.stringify(modelIndex || {})}`) : '';
  const runtime = runtimeFor(kind, format.startsWith('gguf') ? 'gguf' : format, hint);
  const id = `local-${crypto.createHash('sha1').update(target).digest('hex').slice(0, 16)}`;
  const sizeBytes = (await Promise.all(files.slice(0, 400).map(async (f) => (await statSafe(f))?.size || 0))).reduce((a, b) => a + b, 0);
  return {
    id,
    name: basenameName(isDir ? target : localPath),
    publisher: 'Yerel',
    description: `Yerel model · ${format}`,
    kind,
    source: 'local',
    external: true,
    localDir,
    localPath,
    format,
    runtime,
    runtimeSupported: true,
    downloadOnly: false,
    pipelineHint: kind === 'image' ? hint : undefined,
    vision,
    think,
    thinkLevels,
    embedding,
    metadata: meta,
    importedAt: Date.now(),
    quant: { id: 'local', label: format.toUpperCase(), sizeBytes, file: isDir ? '*' : path.basename(localPath), recommended: true },
    tags: ['local', format],
  };
}

export async function importLocalModels(paths = []) {
  const unique = [...new Set((paths || []).map(String).filter(Boolean))];
  if (!unique.length) return [];
  const imported = [];
  for (const p of unique) {
    const model = await inspectPath(p);
    imported.push(await upsertInstalled(model));
  }
  return imported;
}

export async function updateLocalModel(id, patch = {}) {
  const lib = await loadLibrary();
  const index = lib.models.findIndex((m) => m.id === id);
  if (index < 0) throw new Error('Model bulunamadı.');
  const current = lib.models[index];
  const allowed = ['name', 'kind', 'runtime', 'pipelineHint', 'vision', 'think', 'thinkLevels', 'embedding'];
  const next = { ...current };
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
  if (patch.kind && !Object.prototype.hasOwnProperty.call(patch, 'runtime')) {
    next.runtime = runtimeFor(next.kind, String(next.format || '').startsWith('gguf') ? 'gguf' : next.format, next.pipelineHint || '');
  }
  next.runtimeSupported = true;
  next.downloadOnly = false;
  lib.models[index] = next;
  await saveLibrary(lib);
  return next;
}
