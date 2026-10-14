import { useCallback, useEffect, useRef, useState } from 'react';
import { Music, Search, Play, Pause, SkipBack, SkipForward, Volume2, Minus, Plus } from 'lucide-react';

import { musicRequest as request } from '../lib/giziMusic.js';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';
import { Switch } from './ui/switch.jsx';
import { Slider } from './ui/slider.jsx';
function MusicList({ title, items, onPlay, busy, empty }) {
  return <section className="music-section"><h3>{title}</h3>
    {items.length ? <div className="music-items">{items.map(item => <Button variant="secondary" className="music-item" key={item.uri} disabled={busy} onClick={() => onPlay(item.uri)} aria-label={`Play ${item.title}`}>
      {item.image ? <img src={item.image} alt="" loading="lazy" /> : <span className="music-art"><Music size={22} /></span>}
      <span className="music-item-copy"><strong>{item.title}</strong><small>{item.subtitle}</small></span><Play size={18} aria-hidden="true" />
    </Button>)}</div> : <p className="music-empty">{empty || 'No results.'}</p>}
  </section>;
}
export default function SpotifyBrowser() {
  const [ready, setReady] = useState(false);
  const [radio, setRadio] = useState({ enabled: false, note: 'Off' });
  const [state, setState] = useState(null);
  const [recent, setRecent] = useState({ tracks: [], playlists: [] });
  const [library, setLibrary] = useState([]);
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [volume, setVolume] = useState(null);
  const [draftVolume, setDraftVolume] = useState(50);
  const [volumeError, setVolumeError] = useState('');
  const [volumeBusy, setVolumeBusy] = useState(false);
  const volumeEditing = useRef(false), volumeLock = useRef(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ tracks: [], playlists: [] });
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/gizi/session', { method: 'POST', signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Could not pair this browser. Open Beezywall on its Tailscale HTTPS address.');
      setReady(true);
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, []);
  const refresh = useCallback(async signal => {
    const radioState = await request('radio', { signal });
    if (!signal?.aborted) setRadio(radioState);
    const available = await request('devices', { signal });
    if (!signal?.aborted) setDevices(available);
    const current = await request('state', { signal });
    if (!signal?.aborted) setState(current);
    const history = await request('recent', { signal });
    if (!signal?.aborted) setRecent(history);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const load = async () => {
      try { await refresh(controller.signal); }
      catch (error) { if (!controller.signal.aborted) setError(error.message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    request('library', { signal: controller.signal }).then(setLibrary).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [ready, refresh]);
  useEffect(() => {
    if (!ready || !query.trim()) { setResults({ tracks: [], playlists: [] }); setSearching(false); return; }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await request(`search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        if (!controller.signal.aborted) setResults(found);
      } catch (error) { if (!controller.signal.aborted) setError(error.message); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [ready, query]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const value = await request('speaker/volume', { signal: controller.signal });
        if (!controller.signal.aborted && !volumeEditing.current) { setVolume(value); setDraftVolume(value.percent); setVolumeError(''); }
      } catch (error) { if (!controller.signal.aborted) { setVolume(null); setVolumeError(error.message); } }
    };
    void load(); const timer = setInterval(load, 15000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [ready]);
  const changeVolume = async percent => {
    if (volumeLock.current || !volume) return;
    if (percent === volume.percent) { volumeEditing.current = false; return; }
    volumeLock.current = true; volumeEditing.current = true; setVolumeBusy(true); setDraftVolume(percent); setVolumeError('');
    try {
      const value = await request('speaker/volume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ percent }) });
      setVolume(value); setDraftVolume(value.percent);
    } catch (error) { setVolumeError(error.message); setDraftVolume(volume.percent); }
    finally { volumeLock.current = false; volumeEditing.current = false; setVolumeBusy(false); }
  };
  const act = async (endpoint, body) => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (endpoint === 'connect') setSelectedDevice(body.deviceId);
      setMessage(endpoint === 'speaker/reconnect' ? 'Bluetooth speaker reconnected.' : endpoint === 'restart' ? 'Spotify restarted. Devices may take a few seconds to reappear; press Connect or Resume.' : 'Command accepted by Spotify.');
      // Refresh failure must not imply that replaying the action is safe.
      try { await refresh(); } catch { setMessage(endpoint === 'speaker/reconnect' ? 'Speaker reconnected. Spotify state could not be refreshed.' : endpoint === 'restart' ? 'Spotify restarted. Wait a few seconds, then refresh devices.' : 'Command accepted. Playback state could not be refreshed.'); }
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  const play = uri => act('play', { uri, ...(selectedDevice ? { deviceId: selectedDevice } : {}) });
  const command = action => act('command', { action, ...(selectedDevice ? { deviceId: selectedDevice } : {}) });
  return <div className="spotify-browser">
    <div className="music-now">
      <span className="music-item-copy"><strong>{state?.track?.title || 'Nothing playing'}</strong><small>{state?.track?.subtitle || 'Playback is sent only to OmniWall'}{state?.device ? ` · ${state.device}` : ''}</small></span>
      <div className="music-controls">
        <Button variant="secondary" size="icon" disabled={!ready || busy} aria-label="Previous track" onClick={() => command('previous')}><SkipBack size={20} /></Button>
        <Button size="icon" disabled={!ready || busy} aria-label={state?.playing ? 'Pause' : 'Resume'} onClick={() => command(state?.playing ? 'pause' : 'resume')}>{state?.playing ? <Pause size={24} /> : <Play size={24} />}</Button>
        <Button variant="secondary" size="icon" disabled={!ready || busy} aria-label="Next track" onClick={() => command('next')}><SkipForward size={20} /></Button>
      </div>
    </div>
    <section className="music-section"><h3>Similar songs · experimental</h3>
      <label className="radio-toggle"><Switch checked={radio.enabled} disabled={!ready || busy} onCheckedChange={enabled => act('radio', { enabled })} aria-label="Keep playing similar songs on OmniWall" /> Keep playing similar songs on OmniWall</label>
      <p className="music-empty">{radio.note}</p>
      <p className="music-empty">Uses Spotify recommendations when available, otherwise the same artist. Never resumes paused playback. Resets on service restart.</p>
    </section>
    <section className="music-section"><h3>Speaker volume</h3>
      <div className="speaker-volume"><Volume2 size={20} aria-hidden="true" />
        <Button variant="outline" size="icon" aria-label="Decrease speaker volume" disabled={!volume || volumeBusy || busy || draftVolume === 0} onClick={() => void changeVolume(Math.max(0, draftVolume - 5))}><Minus size={18} /></Button>
        <Slider className="volume-slider" min={0} max={100} step={1} value={[draftVolume]} aria-label="Speaker volume" disabled={!volume || volumeBusy || busy} onValueChange={([percent]) => { volumeEditing.current = true; setDraftVolume(percent); }} onValueCommit={([percent]) => void changeVolume(percent)} />
        <Button variant="outline" size="icon" aria-label="Increase speaker volume" disabled={!volume || volumeBusy || busy || draftVolume === 100} onClick={() => void changeVolume(Math.min(100, draftVolume + 5))}><Plus size={18} /></Button>
        <output aria-live="polite">{volume ? `${draftVolume}%` : '—'}</output>
      </div>
      <p className="music-empty">{volume?.name || 'Pi Bluetooth speaker'}{volume?.muted ? ' · Muted' : ''} · Controls Pi audio, not phone volume.</p>
      {volumeError && <p role="alert" className="gizi-error">{volumeError}</p>}
    </section>
    <div className="music-recovery">
      <Button variant="outline" disabled={busy || !ready} onClick={() => act('speaker/reconnect', {})}>Reconnect speaker</Button>
      <Button variant="outline" disabled={busy || !ready} onClick={() => { if (window.confirm('Restart the Pi Spotify client? Playback will be interrupted briefly.')) void act('restart', {}); }}>Restart Spotify</Button>
    </div>
    <p className="music-empty">Reconnect speaker repairs Bluetooth. Restart Spotify repairs an offline OmniWall Spotify client.</p>
    <section className="music-section"><div className="music-device-heading"><h3>Devices</h3><Button variant="outline" disabled={busy || !ready} onClick={() => { void refresh().catch(error => setError(error.message)); }}>Refresh</Button></div>
      <p className="music-empty">{selectedDevice ? `Playback target: ${devices.find(device => device.id === selectedDevice)?.name || 'selected device'}` : 'Playback target: OmniWall. Connect to move playback here from your phone.'}</p>
      <div className="music-devices">{devices.map(device => <div className="music-device" key={device.id}>
        <span className="music-item-copy"><strong>{device.name}</strong><small>{device.online ? 'Online' : 'Offline'}{device.active ? ' · Playing here' : ''}{device.restricted ? ' · Restricted' : ''}</small></span>
        <Button variant="outline" disabled={busy || !device.online || device.restricted} aria-label={`Connect to ${device.name}`} onClick={() => act('connect', { deviceId: device.id })}>{device.active ? 'Connected' : 'Connect'}</Button>
      </div>)}</div>
      {!devices.length && <p className="music-empty">No devices found. Open Spotify on a device, then refresh. Offline devices appear only after Beezywall has seen them online.</p>}
    </section>
    <label className="music-search"><Search size={20} aria-hidden="true" /><Input type="search" aria-label="Search tracks and playlists" placeholder="Search tracks and playlists…" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setError(''); }} /></label>
    {error && <p role="alert" className="gizi-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {query.trim() ? searching ? <p role="status">Searching…</p> : <>
      <MusicList title="Tracks" items={results.tracks} onPlay={play} busy={busy} />
      <MusicList title="Playlists" items={results.playlists} onPlay={play} busy={busy} />
    </> : loading ? <p role="status">Loading your music…</p> : <>
      <MusicList title="Recent playlists" items={recent.playlists} onPlay={play} busy={busy} empty="Play a playlist here or through Gizi and it will appear here." />
      <MusicList title="Recent tracks" items={recent.tracks} onPlay={play} busy={busy} empty="Tracks will appear as you play music through Beezywall." />
      {recent.notice && <p className="music-empty">{recent.notice}</p>}
      <MusicList title="Your playlists" items={library} onPlay={play} busy={busy} empty="No playlists available." />
    </>}
  </div>;
}
