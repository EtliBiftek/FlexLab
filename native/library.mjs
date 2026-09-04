import fs from 'node:fs/promises';
import path from 'node:path';
import { LIBRARY_FILE, MODELS_DIR, ensureDirs, readJson, writeJsonAtomic } from './config.mjs';

const empty = { version: 1, models: [] };

export async function loadLibrary() {
  await ensureDirs();
  const lib = await readJson(LIBRARY_FILE, empty);
  if (!Array.isArray(lib.models)) lib.models = [];
  return lib;
}

export async function saveLibrary(lib) {
  await writeJsonAtomic(LIBRARY_FILE, lib);
}

export async function upsertInstalled(model) {
  const lib = await loadLibrary();
  lib.models = [model, ...lib.models.filter((m) => m.id !== model.id)];
  await saveLibrary(lib);
  return model;
}

export async function removeInstalled(id) {
  const lib = await loadLibrary();
  const hit = lib.models.find((m) => m.id === id);
  lib.models = lib.models.filter((m) => m.id !== id);
  await saveLibrary(lib);
  if (hit?.localDir && !hit.external) {
    await fs.rm(hit.localDir, { recursive: true, force: true }).catch(() => {});
  }
  return Boolean(hit);
}

export async function getInstalled(id) {
  const lib = await loadLibrary();
  return lib.models.find((m) => m.id === id) || null;
}

export function repoDir(hfId) {
  return path.join(MODELS_DIR, ...String(hfId).split('/').map(safe));
}

function safe(s) {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}
