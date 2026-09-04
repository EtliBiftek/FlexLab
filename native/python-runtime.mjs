import { spawn } from 'node:child_process';
import { ensureMusicGenPython } from './runtime-installer.mjs';

function run(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const add = (c) => { log = (log + c.toString()).slice(-12000); };
    child.stdout?.on('data', add);
    child.stderr?.on('data', add);
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(log) : reject(new Error(`Python runtime ${code} ile kapandı.\n${log.slice(-5000)}`)));
  });
}

async function has(python, modules) {
  try {
    await run(python, ['-c', modules.map((m) => `import ${m}`).join(';')]);
    return true;
  } catch { return false; }
}

export async function ensurePythonAiRuntime(kind = 'transformers') {
  const python = await ensureMusicGenPython();
  if (kind === 'diffusers' && !await has(python, ['diffusers', 'PIL'])) {
    await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'diffusers>=0.35', 'Pillow', 'huggingface_hub>=0.34']);
  }
  if (kind === 'audio' && !await has(python, ['soundfile'])) {
    await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'soundfile', 'librosa']);
  }
  return python;
}
