import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Box,
  Compass,
  Cpu,
  Download,
  ImageIcon,
  MessageSquare,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import './styles.css';
import './runtime.css';
import { Downloads } from './download-ui';
import { EnhancedChat, EnhancedDiscover, EnhancedModels } from './enhanced-ui';

type Tab = 'chat' | 'discover' | 'models' | 'studio' | 'runtime' | 'server' | 'downloads';
const API = 'http://127.0.0.1:1234';

function mgmtToken() {
  return window.flexlabDesktop?.managementToken || import.meta.env.VITE_FLEXLAB_MANAGEMENT_TOKEN || '';
}

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-flexlab-management-token', mgmtToken());
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${API}${path}`, { ...init, headers });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: { message: text } }; }
  if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
  return data;
}

function bytes(n: number = 0) {
  if (!n) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function Button({ children, onClick, disabled, className = '' }: { children: any; onClick?: () => void; disabled?: boolean; className?: string }) {
  return <button className={`button ${className}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Field({ label, children }: { label: string; children: any }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Badge({ children, tone = '' }: { children: any; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
function HelixMark() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3c5 3.2 5 14.8 10 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M17 3C12 6.2 12 17.8 7 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M8.2 8h7.6M8.2 12h7.6M8.2 16h7.6" stroke="currentColor" strokeWidth="1.2" /></svg>;
}

const NAV: Array<{ id: Tab; label: string; icon: any }> = [
  { id: 'chat', label: 'Sohbet', icon: MessageSquare },
  { id: 'discover', label: 'Keşfet', icon: Compass },
  { id: 'models', label: 'Modeller', icon: Box },
  { id: 'studio', label: 'Stüdyo', icon: ImageIcon },
  { id: 'runtime', label: 'Runtime', icon: Cpu },
  { id: 'server', label: 'Sunucu', icon: Terminal },
];

function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [models, setModels] = useState<any[]>([]);
  const [engineRuntime, setEngineRuntime] = useState<any>({});
  const [runtime, setRuntime] = useState<any>({});
  const [server, setServer] = useState<any>({});
  const [err, setErr] = useState('');

  const refresh = async () => {
    try {
      const [m, r, s] = await Promise.all([api('/api/models'), api('/api/runtimes'), api('/api/server')]);
      setModels(m.models || []);
      setEngineRuntime(m.runtime || s.runtime || {});
      setRuntime(r);
      setServer(s);
    } catch (e: any) { setErr(e.message); }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, []);

  return <div className="appShell">
    <aside className="rail">
      <div className="mark" title="FlexLab"><HelixMark /></div>
      <nav className="railNav">{NAV.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} title={label} aria-label={label}><Icon size={20} strokeWidth={1.6} /></button>)}</nav>
      <div className="railBottom">
        <button className={tab === 'downloads' ? 'active' : ''} onClick={() => setTab('downloads')} title="İndirilenler" aria-label="İndirilenler"><Download size={16} strokeWidth={1.6} /></button>
        <button className="railRefresh" onClick={() => void refresh()} title="Yenile" aria-label="Yenile"><RefreshCw size={15} strokeWidth={1.6} /></button>
        <span className={`serverDot ${server.serverEnabled ? 'on' : ''}`} title={server.serverEnabled ? 'API açık' : 'API kapalı'} />
        <p>FLEXLAB</p>
      </div>
    </aside>
    <main className="workspace">
      {err && <button className="errorToast" onClick={() => setErr('')}>{err}</button>}
      {tab === 'chat' && <EnhancedChat models={models.filter((m) => m.kind === 'llm' && m.runtimeSupported !== false)} setErr={setErr} />}
      {tab === 'discover' && <EnhancedDiscover onDone={refresh} setErr={setErr} />}
      {tab === 'models' && <EnhancedModels models={models} runtime={engineRuntime} refresh={refresh} setErr={setErr} />}
      {tab === 'studio' && <Studio models={models.filter((m) => m.runtimeSupported !== false)} setErr={setErr} />}
      {tab === 'runtime' && <Runtime state={runtime} refresh={refresh} setErr={setErr} />}
      {tab === 'server' && <Server cfg={server} refresh={refresh} setErr={setErr} />}
      {tab === 'downloads' && <Downloads setErr={setErr} onDone={refresh} />}
    </main>
  </div>;
}

function Runtime({ state, refresh, setErr }: { state: any; refresh: () => Promise<void>; setErr: (s: string) => void }) {
  const [liveState, setLiveState] = useState<any>(state || {});
  useEffect(() => { setLiveState(state || {}); }, [state]);
  useEffect(() => { let alive = true; const poll = async () => { try { const next = await api('/api/runtimes'); if (alive) setLiveState(next); } catch {} }; void poll(); const timer = setInterval(() => void poll(), 650); return () => { alive = false; clearInterval(timer); }; }, []);
  const core = liveState?.['musicgen-python'] || { installed: false, path: null, job: null };
  const shown: any = { ...liveState, 'transformers-python': { ...core, installTarget: 'musicgen-python' }, 'diffusers-python': { ...core, installTarget: 'musicgen-python' }, 'audio-python': { ...core, installTarget: 'musicgen-python' } };
  const install = (name: string, value: any) => { const target = value?.installTarget || name; void api(`/api/runtimes/${encodeURIComponent(target)}`, { method: 'POST' }).then(async () => { await refresh(); }).catch((e: any) => setErr(e.message)); };
  return <div className="page"><header className="pageHeader"><h1>Runtime</h1><p>LLM, görüntü ve audio modelleri için yerel motorlar.</p></header><div className="pageScroll padded"><div className="modelList">{Object.entries(shown || {}).map(([name, value]: any) => { const job = value?.job; const active = !!job && !['done','error'].includes(job.status); const showProgress = !!job && (active || job.status === 'error'); return <article className="modelRow runtimeRow" key={name}><div className="modelInfo runtimeInfo"><div className="modelTitleLine"><h3>{name}</h3><Badge tone={value.installed ? 'ok' : ''}>{value.installed ? 'kurulu' : active ? 'kuruluyor' : 'eksik'}</Badge></div><p className="monoPath">{value.path || job?.phase || 'Henüz kurulu değil'}</p>{showProgress && <div className={`runtimeInstallProgress ${job.status === 'error' ? 'bad' : ''}`}><div className="runtimeProgressMeta"><span>{job.error || job.phase || 'Kuruluyor'}</span><strong>%{Math.max(0, Math.min(100, Math.round(job.progress || 0)))}</strong></div><div className="progressTrack"><span style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }} /></div><div className="runtimeProgressStats">{job.totalBytes > 0 && <span>{bytes(job.loadedBytes)} / {bytes(job.totalBytes)}</span>}{job.speedBps > 0 && <span>{bytes(job.speedBps)}/s</span>}{job.detail && !job.error && <span className="runtimeDetail">{job.detail}</span>}</div></div>}</div>{!value.installed && <Button onClick={() => install(name, value)} disabled={active}>{active ? 'Kuruluyor…' : job?.status === 'error' ? 'Tekrar dene' : 'Kur'}</Button>}</article>; })}</div></div></div>;
}

function Server({ cfg, refresh, setErr }: { cfg: any; refresh: () => Promise<void>; setErr: (s: string) => void }) {
  const [newToken, setNewToken] = useState('');
  const patch = async (payload: any) => { try { await api('/api/server', { method: 'PATCH', body: JSON.stringify(payload) }); await refresh(); } catch (e: any) { setErr(e.message); } };
  return <div className="page"><header className="pageHeader"><h1>Yerel sunucu</h1><p>OpenAI / LM Studio uyumlu API.</p></header><div className="serverScroll"><div className="serverColumn"><section className="statusPanel"><span className={`statusLed ${cfg.serverEnabled ? 'on' : ''}`} /><div><h3>{cfg.serverEnabled ? 'Açık' : 'Kapalı'}</h3><p>POST /v1/chat/completions</p></div><label className="powerToggle" title="Sunucuyu aç/kapat"><input type="checkbox" checked={!!cfg.serverEnabled} onChange={(e) => void patch({ serverEnabled: e.target.checked })} /><span /></label></section><section className="serverPanel"><Field label="Base URL"><div className="readOnlyLine mono">http://127.0.0.1:1234/v1</div></Field></section><section className="serverPanel settingsPanel"><h3>Erişim</h3><label className="settingToggle"><span>API token zorunlu</span><input type="checkbox" checked={!!cfg.authEnabled} onChange={(e) => void patch({ authEnabled: e.target.checked })} /></label><label className="settingToggle"><span>LAN üzerinde yayınla</span><input type="checkbox" checked={!!cfg.serveOnLan} onChange={(e) => void patch({ serveOnLan: e.target.checked })} /></label><label className="settingToggle"><span>CORS</span><input type="checkbox" checked={!!cfg.corsEnabled} onChange={(e) => void patch({ corsEnabled: e.target.checked })} /></label></section><section className="serverPanel settingsPanel"><h3>Hugging Face</h3><Field label="Token (yalnızca gated/private modeller için)"><input type="password" placeholder={cfg.hfToken ? 'Token kayıtlı' : 'Public modeller için gerekmez'} onBlur={(e) => e.target.value && void patch({ hfToken: e.target.value })} /></Field><Field label="Default revision"><input defaultValue={cfg.hfRevision || 'main'} onBlur={(e) => void patch({ hfRevision: e.target.value || 'main' })} /></Field></section><section className="serverPanel settingsPanel"><h3>JIT bellek yönetimi</h3><label className="settingToggle"><span>JIT loading</span><input type="checkbox" checked={!!cfg.jitLoading} onChange={(e) => void patch({ jitLoading: e.target.checked })} /></label><label className="settingToggle"><span>Auto-Evict</span><input type="checkbox" checked={!!cfg.autoEvict} onChange={(e) => void patch({ autoEvict: e.target.checked })} /></label><div className="twoFields"><Field label="Default TTL (sec)"><input type="number" defaultValue={cfg.defaultTtl || 3600} onBlur={(e) => void patch({ defaultTtl: Number(e.target.value) })} /></Field><Field label="Max loaded models"><input type="number" min={1} defaultValue={cfg.maxLoadedModels || 2} onBlur={(e) => void patch({ maxLoadedModels: Number(e.target.value) })} /></Field></div></section><section className="serverPanel settingsPanel tokenPanel"><div className="panelTitleRow"><h3>API tokenları</h3><Button onClick={async () => { try { const data = await api('/api/server/tokens', { method: 'POST', body: JSON.stringify({ name: 'Desktop token', scopes: ['inference', 'models'] }) }); setNewToken(data.secret); await refresh(); } catch (e: any) { setErr(e.message); } }}>Yeni token</Button></div>{newToken && <pre className="secret">{newToken}</pre>}{(cfg.tokens || []).map((t: any) => <div className="tokenRow" key={t.id}><span>{t.name} · …{t.last4}<small>{(t.scopes || []).join(', ')}</small></span><button onClick={async () => { await api(`/api/server/tokens/${t.id}`, { method: 'DELETE' }); await refresh(); }}>Revoke</button></div>)}</section></div></div></div>;
}

function Studio({ models, setErr }: { models: any[]; setErr: (s: string) => void }) {
  const images = models.filter((m) => m.kind === 'image');
  const music = models.filter((m) => m.kind === 'music');
  const [kind, setKind] = useState<'image' | 'music'>('image');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<any>(null);
  const [working, setWorking] = useState(false);
  const list = kind === 'image' ? images : music;
  useEffect(() => { if (!list.some((m) => m.id === model)) setModel(list[0]?.id || ''); }, [kind, models, model]);
  const go = async () => { setWorking(true); setResult(null); try { setResult(await api(kind === 'image' ? '/api/generate/image' : '/api/generate/music', { method: 'POST', body: JSON.stringify({ modelId: model, prompt }) })); } catch (e: any) { setErr(e.message); } finally { setWorking(false); } };
  return <div className="page"><header className="pageHeader"><h1>Stüdyo</h1><p>Görüntü üret veya yerel modelinle müzik yaz.</p></header><div className="studioScroll"><div className="studioColumn"><div className="segmented studioTabs"><button className={kind === 'image' ? 'active' : ''} onClick={() => setKind('image')}>Görüntü</button><button className={kind === 'music' ? 'active' : ''} onClick={() => setKind('music')}>Müzik</button></div><Field label="Model"><select value={model} onChange={(e) => setModel(e.target.value)}>{list.map((m) => <option value={m.id} key={m.id}>{m.name}</option>)}</select></Field><textarea className="studioPrompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={kind === 'image' ? 'Sisli bir liman, gece, film karesi, 35mm…' : 'Lo-fi synth, gece sürüşü, sıcak bas…'} /><Button className="studioGenerate" onClick={() => void go()} disabled={!model || !prompt || working}>{working ? 'Üretiliyor…' : 'Üret'}</Button>{result && <div className="studioResult">{kind === 'image' ? <img src={`${API}${result.url}`} alt="Üretilen görüntü" /> : <audio src={`${API}${result.url}`} controls autoPlay />}</div>}{!list.length && <p className="studioNote">Bu tür için kurulu model yok. Keşfet veya Modellerim bölümünden model ekle.</p>}</div></div></div>;
}

createRoot(document.getElementById('app')!).render(<App />);
