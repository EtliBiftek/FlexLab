import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Box,
  Brain,
  Compass,
  Cpu,
  Download,
  Eye,
  Globe,
  ImageIcon,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import './styles.css';
import { Downloads, QuantDialog } from './download-ui';

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
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: { message: text } };
  }
  if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
  return data;
}

function bytes(n: number = 0) {
  if (!n) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function HelixMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3c5 3.2 5 14.8 10 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M17 3C12 6.2 12 17.8 7 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.2 8h7.6M8.2 12h7.6M8.2 16h7.6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function Badge({ children, tone = '' }: { children: any; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Button({ children, onClick, disabled, className = '', title }: { children: any; onClick?: () => void; disabled?: boolean; className?: string; title?: string }) {
  return (
    <button className={`button ${className}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Caps({ m }: { m: any }) {
  return (
    <div className="caps">
      {m.think && <Badge tone="think"><Brain size={12} /> think</Badge>}
      {m.vision && <Badge tone="vision"><Eye size={12} /> vision</Badge>}
      {m.embedding && <Badge>embedding</Badge>}
      {m.contextLength && <Badge>{Math.round(m.contextLength / 1000)}K</Badge>}
      <Badge>{m.runtime || m.kind}</Badge>
    </div>
  );
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
  const [runtime, setRuntime] = useState<any>({});
  const [server, setServer] = useState<any>({});
  const [err, setErr] = useState('');

  const refresh = async () => {
    try {
      const [m, r, s] = await Promise.all([api('/api/models'), api('/api/runtimes'), api('/api/server')]);
      setModels(m.models || []);
      setRuntime(r);
      setServer(s);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="appShell">
      <aside className="rail">
        <div className="mark" title="FlexLab"><HelixMark /></div>
        <nav className="railNav">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} title={label} aria-label={label}>
              <Icon size={20} strokeWidth={1.6} />
            </button>
          ))}
        </nav>
        <div className="railBottom">
          <button className={tab === 'downloads' ? 'active' : ''} onClick={() => setTab('downloads')} title="İndirilenler" aria-label="İndirilenler"><Download size={16} strokeWidth={1.6} /></button>
          <button className="railRefresh" onClick={() => void refresh()} title="Yenile" aria-label="Yenile"><RefreshCw size={15} strokeWidth={1.6} /></button>
          <span className={`serverDot ${server.serverEnabled ? 'on' : ''}`} title={server.serverEnabled ? 'API açık' : 'API kapalı'} />
          <p>FLEXLAB</p>
        </div>
      </aside>

      <main className="workspace">
        {err && <button className="errorToast" onClick={() => setErr('')}>{err}</button>}
        {tab === 'chat' && <Chat models={models.filter((m) => m.kind === 'llm' && m.runtimeSupported !== false)} setErr={setErr} />}
        {tab === 'discover' && <Discover onDone={refresh} setErr={setErr} />}
        {tab === 'models' && <Models models={models} runtime={server.runtime} refresh={refresh} setErr={setErr} />}
        {tab === 'studio' && <Studio models={models.filter((m) => m.runtimeSupported !== false)} setErr={setErr} />}
        {tab === 'runtime' && <Runtime state={runtime} refresh={refresh} setErr={setErr} />}
        {tab === 'server' && <Server cfg={server} refresh={refresh} setErr={setErr} />}
        {tab === 'downloads' && <Downloads setErr={setErr} onDone={refresh} />}
      </main>
    </div>
  );
}

function Chat({ models, setErr }: { models: any[]; setErr: (s: string) => void }) {
  const [model, setModel] = useState('');
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [think, setThink] = useState(true);
  const [level, setLevel] = useState('medium');
  const [web, setWeb] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!model && models[0]) setModel(models[0].id);
  }, [models, model]);

  const selected = models.find((m) => m.id === model);
  const conversationTitle = messages.find((m) => m.role === 'user')?.content?.slice(0, 34) || 'Yeni sohbet';

  const reset = () => {
    setMessages([]);
    setText('');
  };

  const send = async () => {
    if (!text.trim() || !model || working) return;
    const q = text.trim();
    const user = { role: 'user', content: q };
    const history = [...messages, { role: 'user', content: web && !/@Web\b/i.test(q) ? `@Web ${q}` : q }];
    setMessages((x) => [...x, user]);
    setText('');
    setWorking(true);
    try {
      const data = await api('/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model,
          messages: history,
          stream: false,
          flexlab: {
            think: selected?.think ? think : false,
            think_level: selected?.thinkLevels && think ? level : undefined,
            web_search: web,
          },
        }),
      });
      const msg = data.choices?.[0]?.message || {};
      setMessages((x) => [...x, { role: 'assistant', content: msg.content || '', reasoning: msg.reasoning_content || '' }]);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setWorking(false);
    }
  };

  if (!models.length) return <div className="centerState"><p>Sohbet için önce bir dil modeli kur.</p></div>;

  return (
    <div className="chatPage">
      <aside className="conversationPanel">
        <div className="conversationHead"><span>Sohbetler</span><button onClick={reset} title="Yeni sohbet" aria-label="Yeni sohbet"><Plus size={16} /></button></div>
        <div className="conversationList"><button className="conversation active">{conversationTitle}</button></div>
      </aside>

      <section className="chatMain">
        <header className="chatTopbar">
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => <option value={m.id} key={m.id}>{m.name}</option>)}
          </select>
          {selected && <Caps m={selected} />}
          <span className="chatTopSpacer" />
          <span className="parameterLabel">Parametreler</span>
        </header>

        <div className="messageViewport">
          {messages.length === 0 ? (
            <div className="chatEmpty"><HelixMark /><h2>Yerel modelinle konuş</h2><p>Mesajların seçtiğin modelle doğrudan kendi bilgisayarında işlenir.</p></div>
          ) : (
            <div className="messageColumn">
              {messages.map((m, i) => (
                <article className={`message ${m.role}`} key={i}>
                  <span className="messageRole">{m.role === 'user' ? 'Siz' : 'Asistan'}</span>
                  {m.reasoning && <details className="reasoning"><summary>Düşünme süreci</summary><pre>{m.reasoning}</pre></details>}
                  <pre>{m.content}</pre>
                </article>
              ))}
              {working && <article className="message assistant pending"><span className="messageRole">Asistan</span><p>Yanıt yazılıyor</p></article>}
            </div>
          )}
        </div>

        <footer className="composerArea">
          <div className="composerBox">
            <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder={`${selected?.name || 'Model'} ile yazın…`} />
            <div className="composerTools">
              {selected?.think && <label className="toggleLabel"><input type="checkbox" checked={think} onChange={(e) => setThink(e.target.checked)} /><span className="switchUi" /><Brain size={14} className="thinkIcon" />Düşün</label>}
              {selected?.thinkLevels && think && <select className="miniSelect" value={level} onChange={(e) => setLevel(e.target.value)}><option value="low">Düşük</option><option value="medium">Orta</option><option value="high">Yüksek</option></select>}
              <label className="toggleLabel"><input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /><span className="switchUi" /><Globe size={14} />Web</label>
              <Button className="sendButton" onClick={() => void send()} disabled={working || !text.trim()}><Send size={15} /> Gönder</Button>
            </div>
          </div>
          <p className="composerHint">FlexLab Engine · Enter gönderir, Shift+Enter yeni satır</p>
        </footer>
      </section>
    </div>
  );
}

function PageHeader({ title, description }: { title: string; description: string }) {
  return <header className="pageHeader"><h1>{title}</h1><p>{description}</p></header>;
}

function Discover({ onDone, setErr }: { onDone: () => Promise<void>; setErr: (s: string) => void }) {
  const [provider, setProvider] = useState('huggingface');
  const [kind, setKind] = useState('all');
  const [cap, setCap] = useState('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [installModel, setInstallModel] = useState<any>(null);

  const search = async () => {
    setLoading(true);
    try {
      const data = await api(`/api/catalog?provider=${provider}&kind=${kind}&q=${encodeURIComponent(q)}&limit=24`);
      setRows(data.models || []);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void search(); }, []);

  const visibleRows = rows.filter((m) => cap === 'all' || (cap === 'think' ? m.think : m.vision));

  return (
    <div className="page">
      <PageHeader title="Keşfet" description="LM Studio kataloğu ve Hugging Face üzerinden model kurun." />
      <div className="discoverControls">
        <div className="segmented">
          <button className={provider === 'lmstudio' ? 'active' : ''} onClick={() => setProvider('lmstudio')}>LM Studio</button>
          <button className={provider === 'huggingface' ? 'active' : ''} onClick={() => setProvider('huggingface')}>Hugging Face</button>
        </div>
        <form className="searchRow" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Model, yayıncı veya yetenek ara" />
          <Button disabled={loading}>{loading ? 'Aranıyor…' : 'Ara'}</Button>
        </form>
        <div className="filterPills">
          {[[ 'all', 'Tümü' ], [ 'llm', 'Dil' ], [ 'image', 'Görüntü' ], [ 'music', 'Müzik' ]].map(([id, label]) => <button key={id} className={kind === id ? 'active' : ''} onClick={() => setKind(id)}>{label}</button>)}
          <button className={cap === 'think' ? 'active' : ''} onClick={() => setCap(cap === 'think' ? 'all' : 'think')}>Think</button>
          <button className={cap === 'vision' ? 'active' : ''} onClick={() => setCap(cap === 'vision' ? 'all' : 'vision')}>Vision</button>
          <Button className="filterRefresh" onClick={() => void search()} title="Filtreyi uygula"><RefreshCw size={14} /></Button>
        </div>
      </div>

      <div className="pageScroll">
        <div className="catalogGrid">
          {visibleRows.map((m) => {
            const recommended = (m.quants || []).find((x: any) => x.recommended) || m.quants?.[0];
            return (
              <article className="catalogCard" key={m.id}>
                <div className="cardTop"><div><h3>{m.name}</h3><p>{m.publisher}</p></div><Badge>{m.kind === 'llm' ? 'LLM' : m.kind}</Badge></div>
                <p className="description">{m.description}</p>
                <Caps m={m} />
                <div className="quantOptions">{(m.quants || []).slice(0, 5).map((x: any) => <span className="badge" key={x.id}>{x.label}</span>)}</div>
                <div className="cardBottom"><span>{recommended ? `${recommended.label} · ${bytes(recommended.sizeBytes)}` : m.params || m.kind}</span><Button onClick={() => setInstallModel(m)} disabled={!recommended}><Download size={15} /> Kur</Button></div>
                {m.unsupportedReason && <p className="warning">{m.unsupportedReason}</p>}
              </article>
            );
          })}
        </div>
      </div>
      <QuantDialog model={installModel} onClose={() => setInstallModel(null)} onStarted={() => void onDone()} setErr={setErr} />
    </div>
  );
}

function Models({ models, runtime, refresh, setErr }: { models: any[]; runtime: any; refresh: () => Promise<void>; setErr: (s: string) => void }) {
  const loaded = new Set((runtime?.instances || []).map((x: any) => x.id));
  const act = async (path: string, payload: any) => {
    try {
      await api(path, { method: 'POST', body: JSON.stringify(payload) });
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Modellerim" description="Kurulu modelleri yükleyin, bellek kullanımını ölçün veya kaldırın." />
      <div className="pageScroll padded">
        <div className="modelList">
          {models.map((m) => (
            <article className="modelRow" key={m.id}>
              <div className="modelInfo">
                <div className="modelTitleLine"><h3>{m.name}</h3><Badge tone={loaded.has(m.id) ? 'ok' : ''}>{loaded.has(m.id) ? 'bellekte' : m.downloadOnly ? 'indirildi' : 'kurulu'}</Badge><Badge>{m.runtime || m.kind}</Badge></div>
                <p>{m.hfId || m.publisher || 'Yerel model'} · {m.quant?.label || m.kind} · {bytes(m.quant?.sizeBytes)}</p>
                <Caps m={m} />
                {m.downloadOnly && <p className="warning">{m.unsupportedReason || 'Bu model indirildi ancak mevcut runtime ile çalıştırılamıyor.'}</p>}
              </div>
              <div className="modelActions">
                {m.kind === 'llm' && m.runtimeSupported !== false && <>
                  <Button onClick={() => void act('/api/models/load', { id: m.id, context_length: 8192, gpu_layers: 999, flash_attention: true, fit: true, ttl: 0, embedding: m.embedding })}><Upload size={15} /> {loaded.has(m.id) ? 'Yeniden yükle' : 'Yükle'}</Button>
                  {loaded.has(m.id) && <Button className="secondary" onClick={() => void act('/api/models/unload', { id: m.id })}>Unload</Button>}
                  <Button className="secondary" onClick={async () => { try { const data = await api('/api/models/estimate', { method: 'POST', body: JSON.stringify({ id: m.id, context: 8192, gpuLayers: 999 }) }); alert(`VRAM ≈ ${bytes(data.estimate.estimatedVramBytes)}\nRAM ≈ ${bytes(data.estimate.estimatedRamBytes)}\nVRAM fit: ${data.estimate.fitsVram}`); } catch (e: any) { setErr(e.message); } }}>Bellek</Button>
                </>}
                <Button className="iconButton dangerGhost" title="Sil" onClick={async () => { if (!confirm(`${m.name} silinsin mi?`)) return; try { await api(`/api/models/${encodeURIComponent(m.id)}`, { method: 'DELETE' }); await refresh(); } catch (e: any) { setErr(e.message); } }}><Trash2 size={16} /></Button>
              </div>
            </article>
          ))}
          {!models.length && <div className="emptyList">Henüz kurulu model yok.</div>}
        </div>
      </div>
    </div>
  );
}

function Runtime({ state, refresh, setErr }: { state: any; refresh: () => Promise<void>; setErr: (s: string) => void }) {
  const install = async (name: string) => {
    try {
      await api(`/api/runtimes/${encodeURIComponent(name)}`, { method: 'POST' });
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Runtime" description="FlexLab'ın modelleri gerçekten çalıştırmak için kullandığı yerel motorlar." />
      <div className="pageScroll padded"><div className="modelList">{Object.entries(state || {}).map(([name, value]: any) => <article className="modelRow" key={name}><div className="modelInfo"><div className="modelTitleLine"><h3>{name}</h3><Badge tone={value.installed ? 'ok' : ''}>{value.installed ? 'kurulu' : 'eksik'}</Badge></div><p className="monoPath">{value.path || 'Henüz kurulu değil'}</p></div>{!value.installed && <Button onClick={() => void install(name)}>Kur</Button>}</article>)}</div></div>
    </div>
  );
}

function Server({ cfg, refresh, setErr }: { cfg: any; refresh: () => Promise<void>; setErr: (s: string) => void }) {
  const [newToken, setNewToken] = useState('');
  const patch = async (payload: any) => {
    try {
      await api('/api/server', { method: 'PATCH', body: JSON.stringify(payload) });
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Yerel sunucu" description="OpenAI / LM Studio uyumlu API. Diğer uygulamalar FlexLab modellerini bu uç noktalardan kullanır." />
      <div className="serverScroll"><div className="serverColumn">
        <section className="statusPanel"><span className={`statusLed ${cfg.serverEnabled ? 'on' : ''}`} /><div><h3>{cfg.serverEnabled ? 'Açık' : 'Kapalı'}</h3><p>POST /v1/chat/completions</p></div><label className="powerToggle" title="Sunucuyu aç/kapat"><input type="checkbox" checked={!!cfg.serverEnabled} onChange={(e) => void patch({ serverEnabled: e.target.checked })} /><span /></label></section>
        <section className="serverPanel"><Field label="Base URL"><div className="readOnlyLine mono">http://127.0.0.1:1234/v1</div></Field></section>
        <section className="serverPanel settingsPanel"><h3>Erişim</h3><label className="settingToggle"><span>API token zorunlu</span><input type="checkbox" checked={!!cfg.authEnabled} onChange={(e) => void patch({ authEnabled: e.target.checked })} /></label><label className="settingToggle"><span>LAN üzerinde yayınla</span><input type="checkbox" checked={!!cfg.serveOnLan} onChange={(e) => void patch({ serveOnLan: e.target.checked })} /></label><label className="settingToggle"><span>CORS</span><input type="checkbox" checked={!!cfg.corsEnabled} onChange={(e) => void patch({ corsEnabled: e.target.checked })} /></label></section>
        <section className="serverPanel settingsPanel"><h3>Hugging Face</h3><Field label="Token"><input type="password" placeholder={cfg.hfToken ? 'Token kayıtlı' : 'hf_…'} onBlur={(e) => e.target.value && void patch({ hfToken: e.target.value })} /></Field><Field label="Default revision"><input defaultValue={cfg.hfRevision || 'main'} onBlur={(e) => void patch({ hfRevision: e.target.value || 'main' })} /></Field></section>
        <section className="serverPanel settingsPanel"><h3>JIT bellek yönetimi</h3><label className="settingToggle"><span>JIT loading</span><input type="checkbox" checked={!!cfg.jitLoading} onChange={(e) => void patch({ jitLoading: e.target.checked })} /></label><label className="settingToggle"><span>Auto-Evict</span><input type="checkbox" checked={!!cfg.autoEvict} onChange={(e) => void patch({ autoEvict: e.target.checked })} /></label><div className="twoFields"><Field label="Default TTL (sec)"><input type="number" defaultValue={cfg.defaultTtl || 3600} onBlur={(e) => void patch({ defaultTtl: Number(e.target.value) })} /></Field><Field label="Max loaded models"><input type="number" min={1} defaultValue={cfg.maxLoadedModels || 2} onBlur={(e) => void patch({ maxLoadedModels: Number(e.target.value) })} /></Field></div></section>
        <section className="serverPanel settingsPanel tokenPanel"><div className="panelTitleRow"><h3>API tokenları</h3><Button onClick={async () => { try { const data = await api('/api/server/tokens', { method: 'POST', body: JSON.stringify({ name: 'Desktop token', scopes: ['inference', 'models'] }) }); setNewToken(data.secret); await refresh(); } catch (e: any) { setErr(e.message); } }}>Yeni token</Button></div>{newToken && <pre className="secret">{newToken}</pre>}{(cfg.tokens || []).map((t: any) => <div className="tokenRow" key={t.id}><span>{t.name} · …{t.last4}<small>{(t.scopes || []).join(', ')}</small></span><button onClick={async () => { await api(`/api/server/tokens/${t.id}`, { method: 'DELETE' }); await refresh(); }}>Revoke</button></div>)}</section>
      </div></div>
    </div>
  );
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

  useEffect(() => {
    if (!list.some((m) => m.id === model)) setModel(list[0]?.id || '');
  }, [kind, models, model]);

  const go = async () => {
    setWorking(true);
    setResult(null);
    try {
      setResult(await api(kind === 'image' ? '/api/generate/image' : '/api/generate/music', { method: 'POST', body: JSON.stringify({ modelId: model, prompt }) }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Stüdyo" description="Görüntü üret veya yerel modelinle müzik yaz." />
      <div className="studioScroll"><div className="studioColumn">
        <div className="segmented studioTabs"><button className={kind === 'image' ? 'active' : ''} onClick={() => setKind('image')}>Görüntü</button><button className={kind === 'music' ? 'active' : ''} onClick={() => setKind('music')}>Müzik</button></div>
        <Field label="Model"><select value={model} onChange={(e) => setModel(e.target.value)}>{list.map((m) => <option value={m.id} key={m.id}>{m.name}</option>)}</select></Field>
        <textarea className="studioPrompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={kind === 'image' ? 'Sisli bir liman, gece, film karesi, 35mm…' : 'Lo-fi synth, gece sürüşü, sıcak bas…'} />
        <Button className="studioGenerate" onClick={() => void go()} disabled={!model || !prompt || working}>{working ? 'Üretiliyor…' : 'Üret'}</Button>
        {result && <div className="studioResult">{kind === 'image' ? <img src={`${API}${result.url}`} alt="Üretilen görüntü" /> : <audio src={`${API}${result.url}`} controls autoPlay />}</div>}
        {!list.length && <p className="studioNote">Bu tür için kurulu model yok. Keşfet bölümünden model kur.</p>}
      </div></div>
    </div>
  );
}

createRoot(document.getElementById('app')!).render(<App />);