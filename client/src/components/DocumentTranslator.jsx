import { useEffect, useState } from 'react';
import { Input } from './ui/input.jsx';
import { Button } from './ui/button.jsx';
export default function DocumentTranslator() {
  const [file, setFile] = useState(null), [target, setTarget] = useState('Hungarian'), [source, setSource] = useState(''), [key, setKey] = useState(() => { try { return sessionStorage.getItem('gizi-access-key') || ''; } catch { return ''; } });
  const [job, setJob] = useState(() => { try { return JSON.parse(sessionStorage.getItem('omni-translation-job') || 'null'); } catch { return null; } }), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { try { if (job) sessionStorage.setItem('omni-translation-job', JSON.stringify(job)); } catch { /* Translation still works without browser storage. */ } }, [job]);
  const headers = () => key ? { Authorization: `Bearer ${key}` } : {};
  useEffect(() => {
    if (!job?.id || ['succeeded', 'failed'].includes(job.status)) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try { const r = await fetch(`/gizi/translations/${job.id}`, { headers: headers(), signal: controller.signal }); if (!r.ok) throw new Error('Unable to retrieve progress. Check your access key.'); setJob(await r.json()); } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    }, 2000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [job?.id, job?.status, key]);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await fetch('/gizi/translations', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/octet-stream', 'X-Filename': file.name.replace(/[^\x20-\x7e]/g, '_'), 'X-Target-Language': target, 'X-Source-Language': source }, body: file });
      const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Upload failed'); setJob(data);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function download() {
    try { const r = await fetch(`/gizi/translations/${job.id}/download`, { headers: headers() }); if (!r.ok) throw new Error('Download failed'); const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = `translated.${job.format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (e) { setError(e.message); }
  }
  return <form className="translator-form" onSubmit={submit}>
    <p>Translate Word documents or text-based PDFs while preserving formatting. Scanned PDFs are not supported. Maximum 20 MB. Text is sent to the configured AI provider; translations are retained on this Pi.</p>
    <label>Gizi access key (if not paired)<Input type="password" value={key} onChange={e => setKey(e.target.value)} /></label>
    <label>Document<Input type="file" accept=".docx,.pdf" required onChange={e => setFile(e.target.files[0] || null)} /></label>
    <label>Source language (optional)<Input maxLength={80} value={source} onChange={e => setSource(e.target.value)} /></label>
    <label>Target language<Input required maxLength={80} value={target} onChange={e => setTarget(e.target.value)} /></label>
    <Button disabled={busy || !file || file.size > 20 * 1024 * 1024 || ['queued', 'running'].includes(job?.status)}>Translate</Button>
    {file?.size > 20 * 1024 * 1024 && <p role="alert">File exceeds 20 MB.</p>}
    {job && <div role="status"><p>{job.status}: {job.progress}</p>{job.error && <p>{job.error}</p>}{job.status === 'succeeded' && <Button type="button" variant="outline" onClick={download}>Download translation</Button>}</div>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
