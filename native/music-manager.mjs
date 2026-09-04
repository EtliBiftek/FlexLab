import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_HOME } from './config.mjs';
import { getInstalled } from './library.mjs';
import { ensureMusicGenPython } from './runtime-installer.mjs';

export const MUSIC_OUTPUT_DIR = path.join(APP_HOME, 'outputs', 'music');

function safeName() { return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.wav`; }
async function run(exe, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout?.on('data', (c) => { log += c.toString(); });
    child.stderr?.on('data', (c) => { log += c.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`MusicGen worker ${code} ile kapandı.\n${log.slice(-5000)}`)));
  });
}

export async function generateMusicLocalNative(opts = {}) {
  const model = await getInstalled(opts.modelId);
  if (!model) throw new Error('Müzik modeli kurulu değil.');
  if (model.kind !== 'music') throw new Error('Seçilen model müzik modeli değil.');
  if (!model.localDir) throw new Error('Müzik modelinin yerel snapshot yolu bulunamadı.');
  if (!/musicgen/i.test(`${model.hfId || ''} ${(model.tags || []).join(' ')}`)) {
    throw new Error('Bu ilk native müzik runtime’ı MusicGen ailesini destekliyor.');
  }
  const python = await ensureMusicGenPython();
  await fs.mkdir(MUSIC_OUTPUT_DIR, { recursive: true });
  const outputName = safeName();
  const outputPath = path.join(MUSIC_OUTPUT_DIR, outputName);
  let workerPath = fileURLToPath(new URL('./musicgen_worker.py', import.meta.url));
  if (workerPath.includes('app.asar' + path.sep)) workerPath = workerPath.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  await run(python, [
    workerPath,
    '--model', model.localDir,
    '--prompt', String(opts.prompt || '').slice(0, 1000),
    '--output', outputPath,
    '--tokens', String(Math.max(32, Math.min(Number(opts.maxNewTokens || 256), 1500))),
    '--guidance', String(Math.max(0, Math.min(Number(opts.guidanceScale || 3), 20))),
  ]);
  const stat = await fs.stat(outputPath);
  if (!stat.size) throw new Error('MusicGen boş WAV üretti.');
  return { ok: true, file: outputName, url: `/api/outputs/music/${encodeURIComponent(outputName)}`, modelId: model.id };
}
