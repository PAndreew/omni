import { useEffect, useState } from 'react';
import './MusicAliases.css';
import { Input } from './ui/input.jsx';
import { Button } from './ui/button.jsx';
import { Card } from './ui/card.jsx';

export default function MusicAliases() {
  const [key, setKey] = useState(() => {
    const paired = new URLSearchParams(location.hash.slice(1)).get('gizi-key');
    if (paired && paired.length <= 128) return paired;
    try { return sessionStorage.getItem('gizi-access-key') || ''; } catch { return ''; }
  });
  useEffect(() => {
    if (!key) return;
    try { sessionStorage.setItem('gizi-access-key', key); } catch { /* private browsing */ }
    if (location.hash.startsWith('#gizi-key=')) history.replaceState(null, '', location.pathname + location.search);
  }, [key]);
  const [status, setStatus] = useState('');
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  async function request(method, body) {
    const session = await fetch('/gizi/session', { method: 'POST' });
    if (!session.ok) throw new Error('Nem sikerült csatlakozni.');
    const response = await fetch('/gizi/metadata', { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error('Nem sikerült. Ellenőrizd a kulcsot, a dal linkjét és az ismétlődő beceneveket.');
    return response.json();
  }
  async function load() { try { setEntries((await request('GET')).entries); } catch (error) { setStatus(error.message); } }
  async function save(event) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    setBusy(true); setStatus('Mentés…');
    try {
      const entry = await request('POST', Object.fromEntries(data));
      try { sessionStorage.setItem('gizi-access-key', key); } catch { /* private browsing */ }
      setStatus(`Mentve: ${entry.aliases.join(' / ')} → ${entry.artists.join(', ')} — ${entry.title}`);
      form.reset(); await load();
    } catch (error) { setStatus(error.message); } finally { setBusy(false); }
  }
  return <main className="music-aliases">
    <header><a href="/">← Omni</a><span className="label">Gizi / Zene</span></header>
    <Card className="tile"><h1>Zene becenevek</h1><p>A családi becenevek közvetlenül a kiválasztott Spotify dalra mutatnak.</p>
      <form onSubmit={save}>
        <label>Becenév<Input name="phrase" placeholder="sárga fejű bácsi" maxLength={100} required /></label>
        <label>Ragozott alak <small>opcionális</small><Input name="inflection" placeholder="sárga fejű bácsit" maxLength={100} /></label>
        <label>Spotify dal linkje<Input name="track" placeholder="https://open.spotify.com/track/…" required /></label>
        <Button disabled={busy}>Becenév hozzáadása</Button>
      </form><p role="status" aria-live="polite">{status}</p>
    </Card>
    <Card className="tile"><header><h2 className="label">Meglévő becenevek</h2><Button variant="outline" onClick={load} disabled={busy}>Betöltés</Button></header>
      <ul>{entries.map(entry => <li key={entry.spotifyId}><strong>{entry.aliases.join(' / ')}</strong><span>{entry.artists?.join(', ')}{entry.artists?.length ? ' — ' : ''}{entry.title}</span></li>)}</ul>
    </Card>
  </main>;
}
