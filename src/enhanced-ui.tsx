import { useEffect, useRef, useState } from 'react';
import {
  Brain,
  Cpu,
  Download,
  Eye,
  FolderPlus,
  Globe,
  Pencil,
  Send,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { QuantDialog } from './download-ui';

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

async function streamChat(payload: any, onDelta: (content: string, reasoning: string) => void, signal: AbortSignal) {
  const response = await fetch(`${API}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-flexlab-management-token': mgmtToken(),
    },
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  });
  if (!response.ok) {
    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    throw new Error(data?.error?.message || text || `HTTP ${response.status}`);
  }

  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/event-stream')) {
    const data = await response.json();
    const msg = data?.choices?.[0]?.message || {};
    onDelta(String(msg.content || ''), String(msg.reasoning_content || ''));
    return;
  }
  if (!response.body) throw new Error('Streaming yanıt gövdesi alınamadı.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = false;

  const consume = (line: string) => {
    if (!line.startsWith('data:')) return false;
    const raw = line.slice(5).trim();
    if (!raw) return false;
    if (raw === '[DONE]') return true;
    try {
      const event = JSON.parse(raw);
      const delta = event?.choices?.[0]?.delta || {};
      const content = typeof delta.content === 'string' ? delta.content : '';
      const reasoning = typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string' ? delta.reasoning : '';
      if (content || reasoning) onDelta(content, reasoning);
    } catch {}
    return false;
  };

  while (!complete) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (consume(line)) { complete = true; break; }
      nl = buffer.indexOf('\n');
    }
    if (done) {
      if (buffer) consume(buffer.replace(/\r$/, ''));
      break;
    }
  }
  try { await reader.cancel(); } catch {}
}

function bytes(n: number = 0) {
  if (!n) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function Badge({ children, tone = '' }: { children: any; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Button({ children, onClick, disabled, className = '', title }: { children: any; onClick?: () => void; disabled?: boolean; className?: string; title?: string }) {
  return <button className={`button ${className}`} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
}
function Field({ label, children }: { label: string; children: any }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
function Caps({ m }: { m: any }) {
  return <div className="caps">{m.think && <Badge tone="think"><Brain size={12} /> think</Badge>}{m.vision && <Badge tone="vision"><Eye size={12} /> vision</Badge>}{m.embedding && <Badge>embedding</Badge>}{m.contextLength && <Badge>{Math.round(m.contextLength / 1000)}K</Badge>}<Badge>{m.runtime || m.kind}</Badge></div>;
}
function HelixMark() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3c5 3.2 5 14.8 10 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M17 3C12 6.2 12 17.8 7 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M8.2 8h7.6M8.2 12h7.6M8.2 16h7.6" stroke="currentColor" strokeWidth="1.2" /></svg>;
}

export function EnhancedChat({ models, setErr }: { models: any[]; setErr: (s: string) => void }) {
  const [model, setModel] = useState('');
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [think, setThink] = useState(true);
  const [level, setLevel] = useState('medium');
  const [web, setWeb] = useState(false);
  const [working, setWorking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { if (!model && models[0]) setModel(models[0].id); }, [models, model]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const selected = models.find((m) => m.id === model);
  const conversationTitle = messages.find((m) => m.role === 'user')?.content?.slice(0, 34) || 'Yeni sohbet';
  const reset = () => { abortRef.current?.abort(); setMessages([]); setText(''); setWorking(false); };
  const stop = () => abortRef.current?.abort();

  const send = async () => {
    if (!text.trim() || !model || working) return;
    const q = text.trim();
    const apiHistory = messages.filter((m) => !m.streaming).map(({ role, content }) => ({ role, content }));
    const userForApi = web && !/@Web\b/i.test(q) ? `@Web ${q}` : q;
    const id = `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const controller = new AbortController();
    abortRef.current = controller;
    setMessages((x) => [...x, { role: 'user', content: q }, { id, role: 'assistant', content: '', reasoning: '', streaming: true }]);
    setText('');
    setWorking(true);
    try {
      await streamChat({
        model,
        messages: [...apiHistory, { role: 'user', content: userForApi }],
        flexlab: {
          think: selected?.think ? think : false,
          think_level: selected?.thinkLevels && think ? level : undefined,
          web_search: web,
        },
      }, (content, reasoning) => {
        setMessages((rows) => rows.map((m) => m.id === id ? { ...m, content: `${m.content || ''}${content}`, reasoning: `${m.reasoning || ''}${reasoning}` } : m));
      }, controller.signal);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErr(e.message || String(e));
    } finally {
      setMessages((rows) => rows.map((m) => m.id === id ? { ...m, streaming: false } : m));
      if (abortRef.current === controller) abortRef.current = null;
      setWorking(false);
    }
  };

  if (!models.length) return <div className="centerState"><p>Sohbet için önce bir dil modeli kur veya yerel model ekle.</p></div>;
  return <div className="chatPage"><aside className="conversationPanel"><div className="conversationHead"><span>Sohbetler</span><button onClick={reset} title="Yeni sohbet" aria-label="Yeni sohbet">+</button></div><div className="conversationList"><button className="conversation active">{conversationTitle}</button></div></aside><section className="chatMain"><header className="chatTopbar"><select value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m) => <option value={m.id} key={m.id}>{m.name}</option>)}</select>{selected && <Caps m={selected} />}<span className="chatTopSpacer" /><span className="parameterLabel">Parametreler</span></header><div className="messageViewport">{messages.length === 0 ? <div className="chatEmpty"><HelixMark /><h2>Yerel modelinle konuş</h2><p>Cevap artık token geldikçe anında ekrana akar.</p></div> : <div className="messageColumn">{messages.map((m, i) => <article className={`message ${m.role}`} key={m.id || i}><span className="messageRole">{m.role === 'user' ? 'Siz' : 'Asistan'}</span>{m.reasoning && <details className="reasoning"><summary>Düşünme süreci</summary><pre>{m.reasoning}</pre></details>}{m.content ? <pre>{m.content}</pre> : m.streaming ? <p>Model hazırlanıyor…</p> : null}</article>)}</div>}</div><footer className="composerArea"><div className="composerBox"><textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!working) void send(); } }} placeholder={`${selected?.name || 'Model'} ile yazın…`} /><div className="composerTools">{selected?.think && <label className="toggleLabel"><input type="checkbox" checked={think} onChange={(e) => setThink(e.target.checked)} /><span className="switchUi" /><Brain size={14} className="thinkIcon" />Düşün</label>}{selected?.thinkLevels && think && <select className="miniSelect" value={level} onChange={(e) => setLevel(e.target.value)}><option value="low">Düşük</option><option value="medium">Orta</option><option value="high">Yüksek</option></select>}<label className="toggleLabel"><input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /><span className="switchUi" /><Globe size={14} />Web</label>{working ? <Button className="sendButton" onClick={stop}><Square size={14} /> Durdur</Button> : <Button className="sendButton" onClick={() => void send()} disabled={!text.trim()}><Send size={15} /> Gönder</Button>}</div></div><p className="composerHint">Streaming · Enter gönderir, Shift+Enter yeni satır</p></footer></section></div>;
}

export function EnhancedDiscover({ onDone, setErr }: { onDone: () => Promise<void>; setErr: (s: string) => void }) {
  const [provider, setProvider] = useState('huggingface');
  const [kind, setKind] = useState('all');
  const [cap, setCap] = useState('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [installModel, setInstallModel] = useState<any>(null);
  const [limit, setLimit] = useState(60);
  const requestId = useRef(0);

  useEffect(() => { setLimit(60); }, [provider, kind, q]);
  useEffect(() => {
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const data = await api(`/api/catalog?provider=${provider}&kind=${kind}&q=${encodeURIComponent(q)}&limit=${limit}`);
          if (id === requestId.current) setRows(data.models || []);
        } catch (e: any) {
          if (id === requestId.current) setErr(e.message);
        } finally {
          if (id === requestId.current) setLoading(false);
        }
      })();
    }, q ? 320 : 80);
    return () => clearTimeout(timer);
  }, [provider, kind, q, limit]);

  const visibleRows = rows.filter((m) => (kind === 'all' || m.kind === kind) && (cap === 'all' || (cap === 'think' ? m.think : m.vision)));
  return <div className="page"><header className="pageHeader"><h1>Keşfet</h1><p>Model ve quantization boyutları gerçek dosya metadata'sından gösterilir.</p></header><div className="discoverControls"><div className="segmented"><button className={provider === 'lmstudio' ? 'active' : ''} onClick={() => setProvider('lmstudio')}>LM Studio</button><button className={provider === 'huggingface' ? 'active' : ''} onClick={() => setProvider('huggingface')}>Hugging Face</button></div><div className="searchRow"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Yazdıkça ara: model, yayıncı veya yetenek" /><span className="liveSearchState">{loading ? 'Boyutlar dahil aranıyor…' : `${visibleRows.length} model`}</span></div><div className="filterPills">{[['all','Tümü'],['llm','Dil'],['image','Görüntü'],['music','Müzik']].map(([id,label]) => <button key={id} className={kind === id ? 'active' : ''} onClick={() => setKind(id)}>{label}</button>)}<button className={cap === 'think' ? 'active' : ''} onClick={() => setCap(cap === 'think' ? 'all' : 'think')}>Think</button><button className={cap === 'vision' ? 'active' : ''} onClick={() => setCap(cap === 'vision' ? 'all' : 'vision')}>Vision</button></div></div><div className="pageScroll"><div className="catalogGrid">{visibleRows.map((m) => { const recommended = (m.quants || []).find((x: any) => x.recommended) || m.quants?.[0]; return <article className="catalogCard" key={m.id}><div className="cardTop"><div><h3>{m.name}</h3><p>{m.publisher}</p></div><Badge>{m.kind === 'llm' ? 'LLM' : m.kind}</Badge></div><p className="description">{m.description}</p><Caps m={m} /><div className="quantOptions">{(m.quants || []).slice(0,5).map((x: any) => <span className="badge" key={x.id}>{x.label} · {bytes(x.sizeBytes)}</span>)}</div><div className="cardBottom"><span>{recommended ? `Önerilen ${recommended.label} · ${bytes(recommended.sizeBytes)}` : m.params || m.kind}</span><Button onClick={() => setInstallModel(m)} disabled={!recommended}><Download size={15} /> Kur</Button></div>{m.repositorySizeBytes > 0 && m.quants?.length > 1 && <p className="description">Repo toplamı: {bytes(m.repositorySizeBytes)} · kurulumda yalnızca seçtiğin quant indirilir.</p>}{m.gated && <p className="warning">Erişim korumalı model</p>}</article>; })}</div>{rows.length >= limit && limit < 240 && <div className="catalogMore"><Button className="secondary" onClick={() => setLimit((x) => Math.min(240, x + 60))} disabled={loading}>{loading ? 'Yükleniyor…' : 'Daha fazla model göster'}</Button></div>}</div><QuantDialog model={installModel} onClose={() => setInstallModel(null)} onStarted={() => void onDone()} setErr={setErr} /></div>;
}

function EditModelDialog({ model, onClose, onSaved, setErr }: { model: any; onClose: () => void; onSaved: () => Promise<void>; setErr: (s: string) => void }) {
  const [name, setName] = useState(model?.name || '');
  const [kind, setKind] = useState(model?.kind || 'llm');
  const [runtime, setRuntime] = useState(model?.runtime || 'llama.cpp');
  const [working, setWorking] = useState(false);
  useEffect(() => { if (!model) return; setName(model.name || ''); setKind(model.kind || 'llm'); setRuntime(model.runtime || 'llama.cpp'); }, [model?.id]);
  useEffect(() => { if (!model) return; const allowed = kind === 'llm' ? ['llama.cpp','transformers-python'] : kind === 'image' ? ['stable-diffusion.cpp','diffusers-python'] : ['audio-python','musicgen-python']; if (!allowed.includes(runtime)) setRuntime(allowed[0]); }, [kind]);
  if (!model) return null;
  const save = async () => { setWorking(true); try { if (!window.flexlabDesktop?.updateModel) throw new Error('Model düzenleme yalnızca desktop uygulamasında kullanılabilir.'); await window.flexlabDesktop.updateModel(model.id, { name: name.trim() || model.name, kind, runtime }); await onSaved(); onClose(); } catch (e: any) { setErr(e.message); } finally { setWorking(false); } };
  const runtimeOptions = kind === 'llm' ? ['llama.cpp','transformers-python'] : kind === 'image' ? ['stable-diffusion.cpp','diffusers-python'] : ['audio-python','musicgen-python'];
  return <div className="localDialogBackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="localDialog"><h2>Modeli düzenle</h2><p>Yanlış algılandıysa türünü ve runtime'ını buradan değiştir.</p><Field label="Ad"><input value={name} onChange={(e) => setName(e.target.value)} /></Field><div className="twoFields"><Field label="Tür"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="llm">LLM / VLM</option><option value="image">Görüntü</option><option value="music">Müzik / audio</option></select></Field><Field label="Runtime"><select value={runtime} onChange={(e) => setRuntime(e.target.value)}>{runtimeOptions.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field></div><div className="localDialogActions"><Button className="secondary" onClick={onClose}>Vazgeç</Button><Button onClick={() => void save()} disabled={working}>{working ? 'Kaydediliyor…' : 'Kaydet'}</Button></div></section></div>;
}

export function EnhancedModels({ models, runtime, refresh, setErr }: { models: any[]; runtime: any; refresh: () => Promise<void>; setErr: (s: string) => void }) {
  const instances = new Map((runtime?.instances || []).map((x: any) => [x.id, x]));
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editModel, setEditModel] = useState<any>(null);
  const [busyId, setBusyId] = useState('');

  const act = async (path: string, payload: any) => { try { await api(path, { method: 'POST', body: JSON.stringify(payload) }); await refresh(); } catch (e: any) { setErr(e.message); } };
  const importPaths = async (paths: string[]) => { if (!paths.length) return; setImporting(true); try { if (!window.flexlabDesktop?.importModelPaths) throw new Error('Yerel model ekleme yalnızca desktop uygulamasında kullanılabilir.'); await window.flexlabDesktop.importModelPaths(paths); await refresh(); } catch (e: any) { setErr(e.message); } finally { setImporting(false); } };
  const choose = async () => { try { const paths = await window.flexlabDesktop?.chooseModelPaths?.(); if (paths?.length) await importPaths(paths); } catch (e: any) { setErr(e.message); } };
  const drop = async (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const desktop = window.flexlabDesktop; if (!desktop?.getPathForFile) return setErr('Sürükle-bırak yalnızca desktop uygulamasında kullanılabilir.'); const paths = Array.from(e.dataTransfer.files).map((f) => { try { return desktop.getPathForFile(f); } catch { return ''; } }).filter(Boolean); await importPaths(paths); };

  const loadVram = async (m: any) => {
    setBusyId(m.id);
    try {
      let vramOnly = true;
      try {
        const info = await api('/api/models/estimate', { method: 'POST', body: JSON.stringify({ id: m.id, context: 8192, gpuLayers: 999 }) });
        if (info?.estimate?.fitsVram === false) {
          const hybrid = confirm(`${m.name} tam VRAM'e sığmıyor.\nTahmini VRAM: ${bytes(info.estimate.estimatedVramBytes)}\nHibrit RAM + VRAM olarak yüklemek ister misin?`);
          if (!hybrid) return;
          vramOnly = false;
        }
      } catch {}
      await api('/api/models/load', { method: 'POST', body: JSON.stringify({ id: m.id, context_length: 8192, gpu_layers: 999, flash_attention: true, fit: !vramOnly, vram_only: vramOnly, ttl: 0, embedding: m.embedding, force_reload: true }) });
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusyId('');
    }
  };

  const eject = async (m: any) => {
    setBusyId(m.id);
    try { await api('/api/models/unload', { method: 'POST', body: JSON.stringify({ id: m.id }) }); await refresh(); } catch (e: any) { setErr(e.message); } finally { setBusyId(''); }
  };

  return <div className="page"><header className="pageHeader"><h1>Modellerim</h1><p>Kurulu modelleri yönet, VRAM'e al/eject et veya kendi modelini ekle.</p></header><div className="pageScroll padded"><div className={`localDropZone ${dragOver ? 'dragOver' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => void drop(e)}><FolderPlus size={22} /><div><strong>{importing ? 'Model inceleniyor…' : 'Modeli buraya sürükle bırak'}</strong><span>GGUF, SafeTensors, CKPT veya model klasörü · türü otomatik algılanır</span></div><Button className="secondary" onClick={() => void choose()} disabled={importing}>Dosya / klasör seç</Button></div><div className="modelList">{models.map((m) => { const inst: any = instances.get(m.id); const loaded = !!inst; const stateLabel = loaded ? (inst?.load_config?.vram_only ? "VRAM'de" : 'hibrit bellekte') : m.external ? 'yerel' : m.downloadOnly ? 'indirildi' : 'kurulu'; return <article className="modelRow" key={m.id}><div className="modelInfo"><div className="modelTitleLine"><h3>{m.name}</h3><Badge tone={loaded ? 'ok' : ''}>{stateLabel}</Badge><Badge>{m.kind}</Badge><Badge>{m.runtime || m.kind}</Badge></div><p>{m.hfId || m.localPath || m.publisher || 'Yerel model'} · {m.quant?.label || m.kind} · {bytes(m.quant?.sizeBytes || m.installSizeBytes)}</p><Caps m={m} />{m.downloadOnly && <p className="warning">{m.unsupportedReason || 'Bu model mevcut runtime ile çalıştırılamıyor.'}</p>}{m.kind !== 'llm' && <p className="description">Bu runtime modeli üretim isteği sırasında GPU/VRAM'e alır ve işlem bitince bırakır.</p>}</div><div className="modelActions">{m.kind === 'llm' && m.runtimeSupported !== false && <>{loaded ? <Button className="secondary" onClick={() => void eject(m)} disabled={busyId === m.id}><X size={15} /> {busyId === m.id ? 'Eject…' : 'Eject'}</Button> : <Button onClick={() => void loadVram(m)} disabled={busyId === m.id}><Upload size={15} /> {busyId === m.id ? "VRAM'e alınıyor…" : "VRAM'e al"}</Button>}<Button className="secondary" onClick={async () => { try { const data = await api('/api/models/estimate', { method: 'POST', body: JSON.stringify({ id: m.id, context: 8192, gpuLayers: 999 }) }); alert(`VRAM ≈ ${bytes(data.estimate.estimatedVramBytes)}\nRAM ≈ ${bytes(data.estimate.estimatedRamBytes)}\nVRAM fit: ${data.estimate.fitsVram}`); } catch (e: any) { setErr(e.message); } }}><Cpu size={15} /> Bellek</Button></>}<Button className="iconButton secondary" title="Düzenle" onClick={() => setEditModel(m)}><Pencil size={15} /></Button><Button className="iconButton dangerGhost" title="Sil" onClick={async () => { if (!confirm(`${m.name} listeden kaldırılsın mı?${m.external ? '\nOrijinal dosyaya dokunulmayacak.' : ''}`)) return; try { await api(`/api/models/${encodeURIComponent(m.id)}`, { method: 'DELETE' }); await refresh(); } catch (e: any) { setErr(e.message); } }}><Trash2 size={16} /></Button></div></article>; })}{!models.length && <div className="emptyList">Henüz model yok.</div>}</div></div><EditModelDialog model={editModel} onClose={() => setEditModel(null)} onSaved={refresh} setErr={setErr} /></div>;
}
