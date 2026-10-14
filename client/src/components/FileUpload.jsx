import { useEffect, useState } from 'react';
import { Upload, Folder } from 'lucide-react';
import { Input } from './ui/input.jsx';
import { Button } from './ui/button.jsx';

async function request(endpoint, options = {}) {
  let response = await fetch(`/gizi/files/${endpoint}`, options);
  let data = await response.json();
  if (response.status === 403 && data.error === 'Pair Gizi first.') {
    const paired = await fetch('/gizi/session', { method: 'POST', signal: options.signal });
    if (!paired.ok) throw new Error('Open Beezywall on its Tailscale HTTPS address to pair this device.');
    response = await fetch(`/gizi/files/${endpoint}`, options);
    data = await response.json();
  }
  if (!response.ok) throw new Error(data.error || 'Upload unavailable.');
  return data;
}
export default function FileUpload() {
  const [folder, setFolder] = useState('');
  const [folders, setFolders] = useState([]);
  const [trail, setTrail] = useState([]);
  const [files, setFiles] = useState([]);
  const [newFolder, setNewFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [maxBytes, setMaxBytes] = useState(200 * 1024 * 1024);
  useEffect(() => {
    const abort = new AbortController();
    request('folders', { signal: abort.signal }).then(data => { setFolders(data.folders); setMaxBytes(data.maxBytes); }).catch(error => { if (!abort.signal.aborted) setError(error.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, []);
  const browse = async next => {
    setLoading(true); setError('');
    try {
      const data = await request(`folders${next ? `?${new URLSearchParams({ folder: next })}` : ''}`);
      setFolders(data.folders); setFolder(next); setMaxBytes(data.maxBytes);
    } catch (error) { setError(error.message); }
    finally { setLoading(false); }
  };
  const enter = next => { setTrail([...trail, folder]); void browse(next); };
  const back = () => { const next = trail.at(-1) || ''; setTrail(trail.slice(0, -1)); void browse(next); };
  const create = async () => {
    setBusy(true); setError('');
    try {
      await request('folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder, name: newFolder.trim() }) });
      setNewFolder(''); await browse(folder);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  const upload = async () => {
    setBusy(true); setError(''); setMessage('');
    let uploaded = 0;
    try {
      for (const file of files) {
        if (file.size > maxBytes) throw new Error(`${file.name} is too large. Maximum ${Math.floor(maxBytes / 1024 / 1024)} MB per file.`);
        setMessage(`Uploading ${file.name} (${uploaded + 1}/${files.length})…`);
        await request(`upload?${new URLSearchParams({ folder, name: file.name })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
        uploaded++;
      }
      setMessage(`Saved ${uploaded} file${uploaded === 1 ? '' : 's'} to ~/` + folder); setFiles([]);
    } catch (error) { setError(`${error.message}${uploaded ? ` ${uploaded} earlier file(s) were saved.` : ''}`); setMessage(''); }
    finally { setBusy(false); }
  };
  return <section className="file-upload">
    <p>Send files to the Pi from this device. Choose a safe destination below.</p>
    <p className="music-empty">Allowed: Downloads, Documents/Uploads, Pictures, Music and Videos. System, hidden, application and symlink folders are blocked. Existing files are never overwritten. Limit: {Math.floor(maxBytes / 1024 / 1024)} MB per file.</p>
    <h3>Destination: {folder ? `~/${folder}` : 'Choose a folder'}</h3>
    {folder && <Button variant="outline" disabled={busy || loading} onClick={back}>Back</Button>}
    <div className="upload-folders">{folders.map(item => <Button variant="outline" disabled={busy || loading} key={item} onClick={() => enter(item)}><Folder size={18} aria-hidden="true" /> {folder ? item.slice(folder.length + 1) : item}</Button>)}</div>
    {loading && <p role="status">Loading folders…</p>}
    {folder && !loading && !folders.length && <p className="music-empty">No subfolders. You can upload here or create a folder.</p>}
    {folder && <div className="upload-new-folder"><Input aria-label="New folder name" placeholder="New folder name" maxLength={120} value={newFolder} disabled={busy} onChange={event => setNewFolder(event.target.value)} /><Button variant="outline" disabled={busy || loading || !newFolder.trim()} onClick={create}>Create folder</Button></div>}
    <label className="upload-file-label">Files<Input type="file" multiple disabled={busy} onChange={event => setFiles(Array.from(event.target.files || []))} /></label>
    {files.length > 0 && <ul>{files.map((file, i) => <li key={`${file.name}-${i}`}>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</li>)}</ul>}
    <Button disabled={busy || loading || !folder || !files.length} onClick={upload}><Upload size={18} aria-hidden="true" /> {busy ? 'Working…' : 'Upload to Pi'}</Button>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="gizi-error">{error}</p>}
  </section>;
}
