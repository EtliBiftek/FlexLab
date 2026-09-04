import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Box,
  Brain,
  Compass,
  Cpu,
  Download,
  Eye,
  FolderPlus,
  Globe,
  ImageIcon,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import './styles.css';
import './runtime.css';
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
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: { message: text } }; }
  if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
  return data;
}

async function streamChatCompletion(payload: any, onDelta: (delta: { content?: string; reasoning?: string }) => void) {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('x-flexlab-management-token', mgmtToken());
  const response = await fetch(`${API}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, stream: true }),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || `HTTP ${response.status}`;
    try { message = JSON.parse(text)?.error?.message || message; } catch {}
    throw new Error(message);
  }
  if (!response.body) throw new Error('Streaming yanıt gövdesi alınamadı.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = (block: string) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n').trim();
    if (!data || data === '[DONE]') return;
    let chunk: any;
    try { chunk = JSON.parse(data); } catch { return; }
    if (chunk?.error?.message) throw new Error(chunk.error.message);
    const delta = chunk?.choices?.[0]?.delta || {};
    const content = typeof delta.content === 'string' ? delta.content : '';
    const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : typeof delta.reasoning === 'string' ? delta.reasoning : '';
    if (content || reasoning) onDelta({ content, reasoning });
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        consume(block);
        boundary = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
  } finally {
    try { await reader.cancel(); } catch {}
  }
}

function bytes(n: number = 0) {
  if (!n) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
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

function Badge({ children, tone = '' }: { children: any; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
function Button({ children, onClick, disabled, className = '', title }: { children: any; onClick?: () => void; disabled?: boolean; className?: string; title?: string }) {
  return <button className={`button ${className}`} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
}
function Field({ label, children }: { label: string; children: any }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Caps({ m }: { m: any }) {
  return <div className="caps">{m.think && <Badge tone="think"><Brain size={12} /> think</Badge>}{m.vision && <Badge tone="vision"><Eye size={12} /> vision</Badge>}{m.embedding && <Badge>embedding</Badge>}{m.contextLength && <Badge>{Math.round(m.contextLength / 1000)}K</Badge>}<Badge>{m.runtime || m.kind}</Badge></div>;
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
      setModels(m.models || []); setRuntime(r); setServer(s);
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, []);
  return (
    <div className="appShell">
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
  const [model, setModel] = useState(''); const [text, setText] = useState(''); const [messages, setMessages] = useState<any[]>([]); const [think, setThink] = useState(true); const [level, setLevel] = useState('medium'); const [web, setWeb] = useState(false); const [working, setWorking] = useState(false);
  useEffect(() => { if (!model && models[0]) setModel(models[0].id); }, [models, model]);
  const selected = models.find((m) => m.id === model); const conversationTitle = messages.find((m) => m.role === 'user')?.content?.slice(0, 34) || 'Yeni sohbet';
  const reset = () => { setMessages([]); setText(''); };
  const send = async () => {
    if (!text.trim() || !model || working) return;
    const q = text.trim();
    const user = { role: 'user', content: q };
    const cleanHistory = messages.filter((m) => !m.streaming).map((m) => ({ role: m.role, content: m.content }));
    const history = [...cleanHistory, { role: 'user', content: web && !/@Web\b/i.test(q) ? `@Web ${q}` : q }];
    const streamKey = `${Date.now()}-${Math.random()}`;
    let content = '';
    let reasoning = '';
    setMessages((x) => [...x, user, { role: 'assistant', content: '', reasoning: '', streaming: true, streamKey }]);
    setText('');
    setWorking(true);
    try {
      await streamChatCompletion({
        model,
        messages: history,
        flexlab: { think: selected?.think ? think : false, think_level: selected?.thinkLevels && think ? level : undefined, web_search: web },
      }, (delta) => {
        content += delta.content || '';
        reasoning += delta.reasoning || '';
        setMessages((rows) => rows.map((m) => m.streamKey === streamKey ? { ...m, content, reasoning } : m));
      });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setMessages((rows) => rows.map((m) => m.streamKey === streamKey ? { ...m, streaming: false } : m));
      setWorking(false);
    }
  };
  if (!models.length) return <div className="centerState"><p>Sohbet için önce bir dil modeli kur veya yerel model ekle.</p></div>;
  return <div className="chatPage"><aside className="conversationPanel"><div className="conversationHead"><span>Sohbetler</span><button onClick={reset} title="Yeni sohbet" aria-label="Yeni sohbet"><Plus size={16} /></button></div><div className="conversationList"><button className="conversation active">{conversationTitle}</button></div></aside><section className="chatMain"><header className="chatTopbar"><select value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m) => <option value={m.id} key={m.id}>{m.name}</option>)}</select>{selected && <Caps m={selected} />}<span className="chatTopSpacer" /><span className="parameterLabel">Parametreler</span></header><div className="messageViewport">{messages.length === 0 ? <div className="chatEmpty"><HelixMark /><h2>Yerel modelinle konuş</h2><p>Mesajların seçtiğin modelle doğrudan kendi bilgisayarında işlenir.</p></div> : <div className="messageColumn">{messages.map((m, i) => <article className={`message ${m.role}${m.streaming ? ' pending' : ''}`} key={m.streamKey || i}><span className="messageRole">{m.role === 'user' ? 'Siz' : 'Asistan'}</span>{m.reasoning && <details className="reasoning" open={m.streaming}><summary>Düşünme süreci</summary><pre>{m.reasoning}</pre></details>}{m.streaming && !m.content && !m.reasoning ? <p>Yanıt hazırlanıyor…</p> : <pre>{m.content}</pre>}</article>)}</div>}</div><footer className="composerArea"><div className="composerBox"><textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder={`${selected?.name || 'Model'} ile yazın…`} /><div className="composerTools">{selected?.think && <label className="toggleLabel"><input type="checkbox" checked={think} onChange={(e) => setThink(e.target.checked)} /><span className="switchUi" /><Brain size={14} className="thinkIcon" />Düşün</label>}{selected?.thinkLevels && think && <select className="miniSelect" value={level} onChange={(e) => setLevel(e.target.value)}><option value="low">Düşük</option><option value="medium">Orta</option><option value="high">Yüksek</option></select>}<label className="toggleLabel"><input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /><span className="switchUi" /><Globe size={14} />Web</label><Button className="sendButton" onClick={() => void send()} disabled={working || !text.trim()}><Send size={15} /> Gönder</Button></div></div><p className="composerHint">FlexLab Engine · Streaming açık · Enter gönderir, Shift+Enter yeni satır</p></footer></section></div>;
}

function PageHeader({ title, description }: { title: string; description: string }) { return <header className="pageHeader"><h1>{title}</h1><p>{description}</p></header>; }

function Discover({ onDone, setErr }: { onDone: () => Promise<void>; setErr: (s: string) => void }) {
  const [provider, setProvider] = useState('huggingface'); const [kind, setKind] = useState('all'); const [cap, setCap] = useState('all'); const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(false); const [installModel, setInstallModel] = useState<any>(null); const [limit, setLimit] = useState(60); const requestId = useRef(0);
  useEffect(() => { setLimit(60); }, [provider, kind, q]);
  useEffect(() => {
    const id = ++requestId.current; const timer = setTimeout(() => { void (async () => { setLoading(true); try { const data = await api(`/api/catalog?provider=${provider}&kind=${kind}&q=${encodeURIComponent(q)}&limit=${limit}`); if (id === requestId.current) setRows(data.models || []); } catch (e: any) { if (id === requestId.current) setErr(e.message); } finally { if (id === requestId.current) setLoading(false); } })(); }, q ? 320 : 80); return () => clearTimeout(timer);
  }, [provider, kind, q, limit]);
  const visibleRows = rows.filter((m) => (kind === 'all' || m.kind === kind) && (cap === 'all' || (cap === 'think' ? m.think : m.vision)));
  return <div className="page"><PageHeader title="Keşfet" description="LM Studio uyumlu katalog ve Hugging Face üzerinden model kurun." /><div className="discoverControls"><div className="segmented"><button className={provider === 'lmstudio' ? 'active' : ''} onClick={() => setProvider('lmstudio')}>LM Studio</button><button className={provider === 'huggingface' ? 'active' : ''} onClick={() => setProvider('huggingface')}>Hugging Face</button></div><div className="searchRow"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Yazdıkça ara: model, yayıncı veya yetenek" /><span className="liveSearchState">{loading ? 'Aranıyor…' : `${visibleRows.length} model`}</span></div><div className="filterPills">{[['all','Tümü'],['llm','Dil'],['image','Görüntü'],['music','Müzik']].map(([id,label]) => <button key={id} className={kind === id ? 'active' : ''} onClick={() => setKind(id)}>{label}</button>)}<button className={cap === 'think' ? 'active' : ''} onClick={() => setCap(cap === 'think' ? 'all' : 'think')}>Think</button><button className={cap === 'vision' ? 'active' : ''} onClick={() => setCap(cap === 'vision' ? 'all' : 'vision')}>Vision</button></div></div><div className="pageScroll"><div className="catalogGrid">{visibleRows.map((m) => { const recommended = (m.quants || []).find((x: any) => x.recommended) || m.quants?.[0]; return <article className="catalogCard" key={m.id}><div className="cardTop"><div><h3>{m.name}</h3><p>{m.publisher}</p></div><Badge>{m.kind === 'llm' ? 'LLM' : m.kind}</Badge></div><p className="description">{m.description}</p><Caps m={m} /><div className="quantOptions">{(m.quants || []).slice(0,5).map((x: any) => <span className="badge" key={x.id}>{x.label}</span>)}</div><div className="cardBottom"><span>{recommended ? `${recommended.label} · ${bytes(recommended.sizeBytes)}` : m.params || m.kind}</span><Button onClick={() => setInstallModel(m)} disabled={!recommended}><Download size={15} /> Kur</Button></div>{m.gated && <p className="warning">Erişim korumalı model</p>}</article>; })}</div>{rows.length >= limit && limit < 240 && <div className="catalogMore"><Button className="secondary" onClick={() => setLimit((x) => Math.min(240, x + 60))} disabled={loading}>{loading ? 'Yükleniyor…' : 'Daha fazla model göster'}</Button></div>}</div><QuantDialog model={installModel} onClose={() => setInstallModel(null)} onStarted={() => void onDone()} setErr={setErr} /></div>;
}

function EditModelDialog({ model, onClose, onSaved, setErr }: { model: any; onClose: () => void; onSaved: () => Promise<void>; setErr: (s: string) => void }) {
  const [name, setName] = useState(model?.name || ''); const [kind, setKind] = useState(model?.kind || 'llm'); const [runtime, setRuntime] = useState(model?.runtime || 'llama.cpp'); const [working, setWorking] = useState(false);
  useEffect(() => { if (!model) return; setName(model.name || ''); setKind(model.kind || 'llm'); setRuntime(model.runtime || 'llama.cpp'); }, [model?.id]);
  useEffect(() => { if (!model) return; const allowed = kind === 'llm' ? ['llama.cpp','transformers-python'] : kind === 'image' ? ['stable-diffusion.cpp','diffusers-python'] : ['audio-python','musicgen-python']; if (!allowed.includes(runtime)) setRuntime(allowed[0]); }, [kind]);
  if (!model) return null;
  const save = async () => { setWorking(true); try { if (!window.flexlabDesktop?.updateModel) throw new Error('Model düzenleme yalnızca desktop uygulamasında kullanılabilir.'); await window.flexlabDesktop.updateModel(model.id, { name: name.trim() || model.name, kind, runtime }); await onSaved(); onClose(); } catch (e: any) { setErr(e.message); } finally { setWorking(false); } };
  const runtimeOptions = kind === 'llm' ? ['llama.cpp','transformers-python'] : kind === 'image' ? ['stable-diffusion.cpp','diffusers-python'] : ['audio-python','musicgen-python'];
  return <div className="localDialogBackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="localDialog"><h2>Modeli düzenle</h2><p>Yanlış algılandıysa türünü ve runtime'ını buradan değiştir.</p><Field label="Ad"><input value={name} onChange={(e) => setName(e.target.value)} /></Field><div className="twoFields"><Field label="Tür"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="llm">LLM / VLM</option><option value="image">Görüntü</option><option value="music">Müzik / audio</option></select></Field><Field label="Runtime"><select value={runtime} onChange={(e) => setRuntime(e.target.value)}>{runtimeOptions.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field></div><div className="localDialogActions"><Button className="secondary" onClick={onClose}>Vazgeç</Button><Button onClick={() => void save()} disabled={working}>{working ? 'Kaydediliyor…' : 'Kaydet'}</Button></div></section></div>;
}

function Models({ models, runtime, refresh, setErr }: { models: any[]; runtime: any; refresh: () => Promise<void>; setErr: (s: string) => void }) {
  const loaded = new Set((runtime?.instances || []).map((x: any) => x.id)); const [dragOver, setDragOver] = useState(false); const [importing, setImporting] = useState(false); const [editModel, setEditModel] = useState<any>(null);
  const act = async (path: string, payload: any) => { try { await api(path, { method: 'POST', body: JSON.stringify(payload) }); await refresh(); } catch (e: any) { setErr(e.message); } };
  const importPaths = async (paths: string[]) => { if (!paths.length) return; setImporting(true); try { if (!window.flexlabDesktop?.importModelPaths) throw new Error('Yerel model ekleme yalnızca desktop uygulamasında kullanılabilir.'); await window.flexlabDesktop.importModelPaths(paths); await refresh(); } catch (e: any) { setErr(e.message); } finally { setImporting(false); } };
  const choose = async () => { try { const paths = await window.flexlabDesktop?.chooseModelPaths?.(); if (paths?.length) await importPaths(paths); } catch (e: any) { setErr(e.message); } };
  const drop = async (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const desktop = window.flexlabDesktop; if (!desktop?.getPathForFile) return setErr('Sürükle-bırak yalnızca desktop uygulamasında kullanılabilir.'); const paths = Array.from(e.dataTransfer.files).map((f) => { try { return desktop.getPathForFile(f); } catch { return ''; } }).filter(Boolean); await importPaths(paths); };
  return <div className="page"><PageHeader title="Modellerim" description="Kurulu modelleri yönet veya elindeki model dosyalarını direkt ekle." /><div className="pageScroll padded"><div className={`localDropZone ${dragOver ? 'dragOver' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => void drop(e)}><FolderPlus size={22} /><div><strong>{importing ? 'Model inceleniyor…' : 'Modeli buraya sürükle bırak'}</strong><span>GGUF, SafeTensors, CKPT veya model klasörü · türü otomatik algılanır</span></div><Button className="secondary" onClick={() => void choose()} disabled={importing}>Dosya / klasör seç</Button></div><div className="modelList">{models.map((m) => <article className="modelRow" key={m.id}><div className="modelInfo"><div className="modelTitleLine"><h3>{m.name}</h3><Badge tone={loaded.has(m.id) ? 'ok' : ''}>{loaded.has(m.id) ? 'bellekte' : m.external ? 'yerel' : m.downloadOnly ? 'indirildi' : 'kurulu'}</Badge><Badge>{m.kind}</Badge><Badge>{m.runtime || m.kind}</Badge></div><p>{m.hfId || m.localPath || m.publisher || 'Yerel model'} · {m.quant?.label || m.kind} · {bytes(m.quant?.sizeBytes)}</p><Caps m={m} />{m.downloadOnly && <p className="warning">{m.unsupportedReason || 'Bu model mevcut runtime ile çalıştırılamıyor.'}</p>}</div><div className="modelActions">{m.kind === 'llm' && m.runtimeSupported !== false && <><Button onClick={() => void act('/api/models/load', { id: m.id, context_length: 8192, gpu_layers: 999, flash_attention: true, fit: true, ttl: 0, embedding: m.embedding })}><Upload size={15} /> {loaded.has(m.id) ? 'Yeniden yükle' : 'Yükle'}</Button>{loaded.has(m.id) && <Button className="secondary" onClick={() => void act('/api/models/unload', { id: m.id })}>Unload</Button>}<Button className="secondary" onClick={async () => { try { const data = await api('/api/models/estimate', { method: 'POST', body: JSON.stringify({ id: m.id, context: 8192, gpuLayers: 999 }) }); alert(`VRAM ≈ ${bytes(data.estimate.estimatedVramBytes)}\nRAM ≈ ${bytes(data.estimate.estimatedRamBytes)}\nVRAM fit: ${data.estimate.fitsVram}`); } catch (e: any) { setErr(e.message); } }}>Bellek</Button></>}<Button className="iconButton secondary" title="Düzenle" onClick={() => setEditModel(m)}><Pencil size={15} /></Button><Button className="iconButton dangerGhost" title="Sil" onClick={async () => { if (!confirm(`${m.name} listeden kaldırılsın mı?${m.external ? '\nOrijinal dosyaya dokunulmayacak.' : ''}`)) return; try { await api(`/api/models/${encodeURIComponent(m.id)}`, { method: 'DELETE' }); await refresh(); } catch (e: any) { setErr(e.message); } }}><Trash2 size={16} /></Button></div></article>)}{!models.length && <div className="emptyList">Henüz model yok.</div>}</div></div><EditModelDialog model={editModel} onClose={() => setEditModel(null)} onSaved={refresh} setErr={setErr} /></div>;
}

function Runtime({ state, refresh, setErr }: { state: any; refresh: () => Promise<void>; setErr: (s: string) => void }) {
  const [liveState, setLiveState] = useState<any>(state || {});
  useEffect(() => { setLiveState(state || {}); }, [state]);
  useEffect(() => { let alive = true; const poll = async () => { try { const next = await api('/api/runtimes'); if (alive) setLiveState(next); } catch {} }; void poll(); const timer = setInterval(() => void poll(), 650); return () => { alive = false; clearInterval(timer); }; }, []);
  const core = liveState?.['musicgen-python'] || { installed: false, path: null, job: null };
  const shown: any = { ...liveState, 'transformers-python': { ...core, installTarget: 'musicgen-python' }, 'diffusers-python': { ...core, installTarget: 'musicgen-python' }, 'audio-python': { ...core, installTarget: 'musicgen-python' } };
  const install = (name: string, value: any) => { const target = value?.installTarget || name; void api(`/api/runtimes/${encodeURIComponent(target)}`, { method: 'POST' }).then(async () => { await refresh(); }).catch((e: any) => setErr(e.message)); };
  return <div className="page"><PageHeader title="Runtime" description="LLM, görüntü ve audio modelleri için yerel motorlar. Python fallback runtime'ları aynı çekirdeği paylaşır." /><div className="pageScroll padded"><div className="modelList">{Object.entries(shown || {}).map(([name, value]: any) => { const job = value?.job; const active = !!job && !['done','error'].includes(job.status); const showProgress = !!job && (active || job.status === 'error'); return <article className="modelRow runtimeRow" key={name}><div className="modelInfo runtimeInfo"><div className="modelTitleLine"><h3>{name}</h3><Badge tone={value.installed ? 'ok' : ''}>{value.installed ? 'kurulu' : active ? 'kuruluyor' : 'eksik'}</Badge></div><p className="monoPath">{value.path || job?.phase || 'Henüz kurulu değil'}</p>{showProgress && <div className={`runtimeInstallProgress ${job.status === 'error' ? 'bad' : ''}`}><div className="runtimeProgressMeta"><span>{job.error || job.phase || 'Kuruluyor'}</span><strong>%{Math.max(0, Math.min(100, Math.round(job.progress || 0)))}</strong></div><div className="progressTrack"><span style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }} /></div><div className="runtimeProgressStats">{job.totalBytes > 0 && <span>{bytes(job.loadedBytes)} / {bytes(job.totalBytes)}</span>}{job.speedBps > 0 && <span>{bytes(job.speedBps)}/s</span>}{job.detail && !job.error && <span className="runtimeDetail">{job.detail}</span>}</div></div>}</div>{!value.installed && <Button onClick={() => install(name, value)} disabled={active}>{active ? 'Kuruluyor…' : job?.status === 'error' ? 'Tekrar dene' : 'Kur'}</Button>}</article>; })}</div></div></div>;
}

function Server({ cfg, refresh, setErr }: { cfg: any; refresh: () => Promise<void>; setErr: (s: string) => void }) {
  const [newToken, setNewToken] = useState('');
  const patch = async (payload: any) => { try { await api('/api/server', { method: 'PATCH', body: JSON.stringify(payload) }); await refresh(); } catch (e: any) { setErr(e.message); } };
  return <div className="page"><PageHeader title="Yerel sunucu" description="OpenAI / LM Studio uyumlu API. Diğer uygulamalar FlexLab modellerini bu uç noktalardan kullanır." /><div className="serverScroll"><div className="serverColumn"><section className="statusPanel"><span className={`statusLed ${cfg.serverEnabled ? 'on' : ''}`} /><div><h3>{cfg.serverEnabled ? 'Açık' : 'Kapalı'}</h3><p>POST /v1/chat/completions</p></div><label className="powerToggle" title="Sunucuyu aç/kapat"><input type="checkbox" checked={!!cfg.serverEnabled} onChange={(e) => void patch({ serverEnabled: e.target.checked })} /><span /></label></section><section className="serverPanel"><Field label="Base URL"><div className="readOnlyLine mono">http://127.0.0.1:1234/v1</div></Field></section><section className="serverPanel settingsPanel"><h3>Erişim</h3><label className="settingToggle"><span>API token zorunlu</span><input type="checkbox" checked={!!cfg.authEnabled} onChange={(e) => void patch({ authEnabled: e.target.checked })} /></label><label className="settingToggle"><span>LAN üzerinde yayınla</span><input type="checkbox" checked={!!cfg.serveOnLan} onChange={(e) => void patch({ serveOnLan: e.target.checked })} /></label><label className="settingToggle"><span>CORS</span><input type="checkbox" checked={!!cfg.corsEnabled} onChange={(e) => void patch({ corsEnabled: e.target.checked })} /></label></section><section className="serverPanel settingsPanel"><h3>Hugging Face</h3><Field label="Token (yalnızca gated/private modeller için)"><input type="password" placeholder={cfg.hfToken ? 'Token kayıtlı' : 'Public modeller için gerekmez'} onBlur={(e) => e.target.value && void patch({ hfToken: e.target.value })} /></Field><Field label="Default revision"><input defaultValue={cfg.hfRevision || 'main'} onBlur={(e) => void patch({ hfRevision: e.target.value || 'main' })} /></Field></section><section className="serverPanel settingsPanel"><h3>JIT bellek yönetimi</h3><label className="settingToggle"><span>JIT loading</span><input type="checkbox" checked={!!cfg.jitLoading} onChange={(e) => void patch({ jitLoading: e.target.checked })} /></label><label className="settingToggle"><span>Auto-Evict</span><input type="checkbox" checked={!!cfg.autoEvict} onChange={(e) => void patch({ autoEvict: e.target.checked })} /></label><div className="twoFields"><Field label="Default TTL (sec)"><input type="number" defaultValue={cfg.defaultTtl || 3600} onBlur={(e) => void patch({ defaultTtl: Number(e.target.value) })} /></Field><Field label="Max loaded models"><input type="number" min={1} defaultValue={cfg.maxLoadedModels || 2} onBlur={(e) => void patch({ maxLoadedModels: Number(e.target.value) })} /></Field></div></section><section className="serverPanel settingsPanel tokenPanel"><div className="panelTitleRow"><h3>API tokenları</h3><Button onClick={async () => { try { const data = await api('/api/server/tokens', { method: 'POST', body: JSON.stringify({ name: 'Desktop token', scopes: ['inference', 'models'] }) }); setNewToken(data.secret); await refresh(); } catch (e: any) { setErr(e.message); } }}>Yeni token</Button></div>{newToken && <pre className="secret">{newToken}</pre>}{(cfg.tokens || []).map((t: any) => <div className="tokenRow" key={t.id}><span>{t.name} · …{t.last4}<small>{(t.scopes || []).join(', ')}</small></span><button onClick={async () => { await api(`/api/server/tokens/${t.id}`, { method: 'DELETE' }); await refresh(); }}>Revoke</button></div>)}</section></div></div></div>;
}

function Studio({ models, setErr }: { models: any[]; setErr: (s: string) => void }) {
  const images = models.filter((m) => m.kind === 'image'); const music = models.filter((m) => m.kind === 'music'); const [kind, setKind] = useState<'image' | 'music'>('image'); const [model, setModel] = useState(''); const [prompt, setPrompt] = useState(''); const [result, setResult] = useState<any>(null); const [working, setWorking] = useState(false); const list = kind === 'image' ? images : music;
  useEffect(() => { if (!list.some((m) => m.id === model)) setModel(list[0]?.id || ''); }, [kind, models, model]);
  const go = async () => { setWorking(true); setResult(null); try { setResult(await api(kind === 'image' ? '/api/generate/image' : '/api/generate/music', { method: 'POST', body: JSON.stringify({ modelId: model, prompt }) })); } catch (e: any) { setErr(e.message); } finally { setWorking(false); } };
  return <div className="page"><PageHeader title="Stüdyo" description="Görüntü üret veya yerel modelinle müzik yaz." /><div className="studioScroll"><div className="studioColumn"><div className="segmented studioTabs"><button className={kind === 'image' ? 'active' : ''} onClick={() => setKind('image')}>Görüntü</button><button className={kind === 'music' ? 'active' : ''} onClick={() => setKind('music')}>Müzik</button></div><Field label="Model"><select value={model} onChange={(e) => setModel(e.target.value)}>{list.map((m) => <option value={m.id} key={m.id}>{m.name}</option>)}</select></Field><textarea className="studioPrompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={kind === 'image' ? 'Sisli bir liman, gece, film karesi, 35mm…' : 'Lo-fi synth, gece sürüşü, sıcak bas…'} /><Button className="studioGenerate" onClick={() => void go()} disabled={!model || !prompt || working}>{working ? 'Üretiliyor…' : 'Üret'}</Button>{result && <div className="studioResult">{kind === 'image' ? <img src={`${API}${result.url}`} alt="Üretilen görüntü" /> : <audio src={`${API}${result.url}`} controls autoPlay />}</div>}{!list.length && <p className="studioNote">Bu tür için kurulu model yok. Keşfet veya Modellerim bölümünden model ekle.</p>}</div></div></div>;
}

createRoot(document.getElementById('app')!).render(<App />);
