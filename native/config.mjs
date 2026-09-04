import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const HOME = os.homedir();
export const LEGACY_APP_HOME = process.env.HELIX_HOME || path.join(HOME, '.helix-studio');
export const APP_HOME = process.env.FLEXLAB_HOME || path.join(HOME, '.flexlab-studio');
export const MODELS_DIR = path.join(APP_HOME, 'models');
export const RUNTIMES_DIR = path.join(APP_HOME, 'runtimes');
export const DOWNLOADS_DIR = path.join(APP_HOME, 'downloads');
export const OUTPUTS_DIR = path.join(APP_HOME, 'outputs');
export const LIBRARY_FILE = path.join(APP_HOME, 'library.json');
export const CONFIG_FILE = path.join(APP_HOME, 'config.json');
export const MCP_FILE = path.join(APP_HOME, 'mcp.json');
export const PUBLIC_PORT = Number(process.env.FLEXLAB_PORT || 1234);
export const ENGINE_PORT_BASE = Number(process.env.FLEXLAB_ENGINE_PORT_BASE || 12345);

const defaults = {
  serverEnabled: false,
  authEnabled: false,
  corsEnabled: false,
  corsOrigins: ['http://localhost', 'http://127.0.0.1'],
  host: '127.0.0.1',
  port: PUBLIC_PORT,
  serveOnLan: false,
  hfToken: '',
  hfRevision: 'main',
  jitLoading: true,
  autoEvict: true,
  keepOnlyLastJit: true,
  defaultTtl: 3600,
  maxLoadedModels: 2,
  tokens: [],
  mcpEnabled: true,
  allowConfiguredMcp: false,
};

let migrationChecked = false;

async function exists(target) { try { await fs.access(target); return true; } catch { return false; } }

async function migrateLegacyHome() {
  if (migrationChecked) return;
  migrationChecked = true;
  if (process.env.FLEXLAB_HOME || APP_HOME === LEGACY_APP_HOME) return;
  if (await exists(APP_HOME) || !(await exists(LEGACY_APP_HOME))) return;
  try { await fs.rename(LEGACY_APP_HOME, APP_HOME); }
  catch (error) { console.warn('[FlexLab] legacy migration failed:', error?.message || error); }
}

export async function ensureDirs() {
  await migrateLegacyHome();
  await Promise.all([APP_HOME, MODELS_DIR, RUNTIMES_DIR, DOWNLOADS_DIR, OUTPUTS_DIR].map((p) => fs.mkdir(p, { recursive: true })));
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return structuredClone(fallback); }
}

export async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
  if (process.platform !== 'win32') await fs.chmod(file, 0o600).catch(() => {});
}

function hashToken(secret) { return crypto.createHash('sha256').update(String(secret)).digest('hex'); }

function migrateConfig(raw) {
  const cfg = { ...defaults, ...(raw || {}) };
  if (!Array.isArray(cfg.tokens)) cfg.tokens = [];
  if (raw?.apiKey && !cfg.tokens.some((t) => t.legacy)) {
    cfg.tokens.push({ id: crypto.randomUUID(), name: 'Migrated API key', hash: hashToken(raw.apiKey), last4: String(raw.apiKey).slice(-4), scopes: ['inference','models'], createdAt: Date.now(), legacy: true });
  }
  delete cfg.apiKey;
  cfg.host = cfg.serveOnLan ? '0.0.0.0' : '127.0.0.1';
  cfg.port = Number(cfg.port || PUBLIC_PORT);
  cfg.defaultTtl = Math.max(0, Number(cfg.defaultTtl ?? 3600));
  cfg.maxLoadedModels = Math.max(1, Number(cfg.maxLoadedModels ?? 2));
  return cfg;
}

export async function loadConfig() {
  await ensureDirs();
  const raw = await readJson(CONFIG_FILE, defaults);
  const cfg = migrateConfig(raw);
  if (JSON.stringify(cfg) !== JSON.stringify(raw)) await writeJsonAtomic(CONFIG_FILE, cfg);
  return cfg;
}

export async function saveConfig(patch) {
  const current = await loadConfig();
  const allowed = new Set(['serverEnabled','authEnabled','corsEnabled','corsOrigins','serveOnLan','hfToken','hfRevision','jitLoading','autoEvict','keepOnlyLastJit','defaultTtl','maxLoadedModels','mcpEnabled','allowConfiguredMcp']);
  const next = { ...current };
  for (const [k,v] of Object.entries(patch || {})) if (allowed.has(k)) next[k] = v;
  next.host = next.serveOnLan ? '0.0.0.0' : '127.0.0.1';
  next.port = PUBLIC_PORT;
  await writeJsonAtomic(CONFIG_FILE, next);
  return next;
}

export async function createApiToken({ name='API token', scopes=['inference','models'] }={}) {
  const cfg = await loadConfig();
  const secret = `flx-${crypto.randomBytes(24).toString('hex')}`;
  const token = { id: crypto.randomUUID(), name: String(name).slice(0,80), hash: hashToken(secret), last4: secret.slice(-4), scopes: [...new Set(scopes.map(String))], createdAt: Date.now() };
  cfg.tokens.push(token);
  await writeJsonAtomic(CONFIG_FILE, cfg);
  return { token: { ...token, hash: undefined }, secret };
}

export async function revokeApiToken(id) {
  const cfg = await loadConfig();
  const before = cfg.tokens.length;
  cfg.tokens = cfg.tokens.filter((t) => t.id !== id);
  await writeJsonAtomic(CONFIG_FILE, cfg);
  return cfg.tokens.length !== before;
}

export async function verifyApiToken(secret, requiredScope='inference') {
  if (!secret) return false;
  const cfg = await loadConfig();
  const digest = hashToken(secret);
  const hit = cfg.tokens.find((t) => t.hash === digest);
  if (!hit) return false;
  return !requiredScope || hit.scopes?.includes('*') || hit.scopes?.includes(requiredScope);
}

export function publicConfig(cfg) {
  return {
    ...cfg,
    hfToken: cfg.hfToken ? '••••••••' : '',
    tokens: (cfg.tokens || []).map(({hash, ...t}) => t),
  };
}

export async function getHfAuthHeaders() {
  const cfg = await loadConfig();
  return cfg.hfToken ? { authorization: `Bearer ${cfg.hfToken}` } : {};
}
