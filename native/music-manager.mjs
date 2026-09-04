import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_HOME } from './config.mjs';
import { ensureMusicGenPython } from './runtime-installer.mjs';
import { ensurePythonAiRuntime } from './python-runtime.mjs';
import { getInstalled } from './library.mjs';

export const MUSIC_OUTPUT_DIR = path.join(APP_HOME, 'outputs', 'music');

function safeName() { return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.wav`; }
async function run(exe, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout?.on('data', (c) => { log += c.toString(); });
    child.stderr?.on('data', (c) => { log += c.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Audio worker ${code} ile kapandı.\n${log.slice(-5000)}`)));
  });
}
function workerPath(name){let p=fileURLToPath(new URL(`./${name}`,import.meta.url));if(p.includes('app.asar'+path.sep))p=p.replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);return p;}

export async function generateMusicLocalNative(opts = {}) {
  const model = await getInstalled(opts.modelId);
  if (!model) throw new Error('Müzik modeli kurulu değil.');
  if (model.kind !== 'music') throw new Error('Seçilen model müzik modeli değil.');
  if (!model.localDir && !model.localPath) throw new Error('Müzik modelinin yerel yolu bulunamadı.');
  await fs.mkdir(MUSIC_OUTPUT_DIR, { recursive: true });
  const outputName = safeName();
  const outputPath = path.join(MUSIC_OUTPUT_DIR, outputName);
  const prompt = String(opts.prompt || '').slice(0, 1000);
  const tokens = String(Math.max(32, Math.min(Number(opts.maxNewTokens || 256), 1500)));

  if (model.runtime === 'audio-python') {
    const python = await ensurePythonAiRuntime('audio');
    await run(python, [workerPath('audio_worker.py'), '--model', model.localDir || model.localPath, '--prompt', prompt, '--output', outputPath, '--tokens', tokens]);
  } else {
    const python = await ensureMusicGenPython();
    await run(python, [
      workerPath('musicgen_worker.py'),
      '--model', model.localDir,
      '--prompt', prompt,
      '--output', outputPath,
      '--tokens', tokens,
      '--guidance', String(Math.max(0, Math.min(Number(opts.guidanceScale || 3), 20))),
    ]);
  }
  const stat = await fs.stat(outputPath);
  if (!stat.size) throw new Error('Audio runtime boş WAV üretti.');
  return { ok: true, file: outputName, url: `/api/outputs/music/${encodeURIComponent(outputName)}`, modelId: model.id };
}
