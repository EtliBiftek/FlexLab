import { useEffect, useMemo, useState } from 'react';
import { Download, Gauge, Pause, Play, X } from 'lucide-react';

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

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center',
  background: 'rgba(0,0,0,.56)', backdropFilter: 'blur(6px)', padding: 24,
};
const dialog: React.CSSProperties = {
  width: 'min(680px, 94vw)', maxHeight: '82vh', overflow: 'auto', border: '1px solid var(--line, #292929)',
  background: 'var(--panel, #111)', borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,.45)', padding: 18,
};
const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line, #292929)',
};

export function QuantDialog({ model, onClose, onStarted, setErr }: { model: any; onClose: () => void; onStarted?: (job: any) => void; setErr: (s: string) => void }) {
  const quants = model?.quants || [];
  const recommended = quants.find((q: any) => q.recommended) || quants[0];
  const [selected, setSelected] = useState(recommended?.id || '');
  const [working, setWorking] = useState(false);

  useEffect(() => { setSelected(recommended?.id || ''); }, [model?.id]);
  if (!model) return null;

  const start = async () => {
    if (!selected || working) return;
    setWorking(true);
    try {
      const job = await api('/api/models/download', { method: 'POST', body: JSON.stringify({ model, quantId: selected }) });
      onStarted?.(job);
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section style={dialog} aria-modal="true" role="dialog">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><h2 style={{ margin: 0, fontSize: 18 }}>{model.name}</h2><p style={{ margin: '5px 0 0', opacity: .65 }}>{model.publisher} · {model.hfId}</p></div>
          <button className="button iconButton" onClick={onClose} aria-label="Kapat"><X size={16} /></button>
        </div>
        <p style={{ opacity: .72, margin: '0 0 8px' }}>{quants.length > 1 ? 'İndirmek istediğin quantization sürümünü seç.' : 'Bu model için indirilebilir paket.'}</p>
        <div>
          {quants.map((q: any) => (
            <label key={q.id} style={{ ...row, cursor: 'pointer' }}>
              <input type="radio" name="quant" checked={selected === q.id} onChange={() => setSelected(q.id)} />
              <div style={{ flex: 1 }}><strong>{q.label}</strong>{q.recommended && <span className="badge ok" style={{ marginLeft: 8 }}>önerilen</span>}<div style={{ opacity: .6, fontSize: 12, marginTop: 4 }}>{q.file === '*' ? 'Tam model snapshot' : q.file}</div></div>
              <span style={{ opacity: .72 }}>{bytes(q.sizeBytes)}</span>
            </label>
          ))}
        </div>
        {model.downloadOnly && <p className="warning" style={{ marginTop: 12 }}>{model.unsupportedReason}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="button secondary" onClick={onClose}>Vazgeç</button>
          <button className="button" onClick={() => void start()} disabled={!selected || working}><Download size={15} /> {working ? 'Başlatılıyor…' : 'İndir'}</button>
        </div>
      </section>
    </div>
  );
}

async function control(id: string, action: string, value?: number) {
  return api('/api/models/download', {
    method: 'POST',
    body: JSON.stringify({ model: { hfId: 'flexlab/control', controlJobId: id, controlAction: action, value } }),
  });
}

const SPEEDS = [
  [0, 'Sınırsız'],
  [1024 * 1024, '1 MB/s'],
  [2 * 1024 * 1024, '2 MB/s'],
  [5 * 1024 * 1024, '5 MB/s'],
  [10 * 1024 * 1024, '10 MB/s'],
  [25 * 1024 * 1024, '25 MB/s'],
  [50 * 1024 * 1024, '50 MB/s'],
] as const;

export function Downloads({ setErr, onDone }: { setErr: (s: string) => void; onDone?: () => Promise<void> }) {
  const [jobs, setJobs] = useState<any[]>([]);
  const activeCount = useMemo(() => jobs.filter((j) => ['queued', 'downloading', 'paused', 'cancelling'].includes(j.status)).length, [jobs]);

  const refresh = async () => {
    try {
      const data = await api('/api/models');
      setJobs(data.downloads || []);
    } catch (e: any) { setErr(e.message); }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 650);
    return () => clearInterval(timer);
  }, []);

  const act = async (job: any, action: string, value?: number) => {
    try {
      await control(job.id, action, value);
      await refresh();
      if (action === 'resume' || action === 'cancel') await onDone?.();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="page">
      <header className="pageHeader"><h1>İndirilenler</h1><p>{activeCount ? `${activeCount} aktif indirme` : 'Model indirmelerini buradan yönet.'}</p></header>
      <div className="pageScroll padded">
        <div className="modelList">
          {jobs.map((job) => (
            <article className="modelRow" key={job.id} style={{ alignItems: 'stretch' }}>
              <div className="modelInfo" style={{ flex: 1 }}>
                <div className="modelTitleLine"><h3>{job.modelName || job.hfId || job.modelId}</h3><span className={`badge ${job.status === 'done' ? 'ok' : ''}`}>{job.status}</span></div>
                <p>{job.quantLabel || job.quantId || 'model'} · {bytes(job.loadedBytes)} / {bytes(job.totalBytes)} · {job.speedBps ? `${bytes(job.speedBps)}/s` : '—'}</p>
                <div className="progressTrack" style={{ marginTop: 10 }}><span style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }} /></div>
                {job.error && <p className="warning">{job.error}</p>}
              </div>
              <div className="modelActions" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: .8 }}><Gauge size={14} /><select value={String(job.speedLimitBps || 0)} onChange={(e) => void act(job, 'speed', Number(e.target.value))}>{SPEEDS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
                {job.status === 'paused' ? <button className="button" onClick={() => void act(job, 'resume')}><Play size={14} /> Devam</button> : ['queued', 'downloading'].includes(job.status) ? <button className="button secondary" onClick={() => void act(job, 'pause')}><Pause size={14} /> Duraklat</button> : null}
                {!['done', 'error', 'cancelled'].includes(job.status) && <button className="button dangerGhost" onClick={() => void act(job, 'cancel')}><X size={14} /> İptal</button>}
              </div>
            </article>
          ))}
          {!jobs.length && <div className="emptyList">Henüz indirme yok.</div>}
        </div>
      </div>
    </div>
  );
}
