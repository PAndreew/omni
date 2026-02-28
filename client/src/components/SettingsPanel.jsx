import { useState, useEffect, useCallback } from 'react';

const COLORS = ['#00d4ff', '#ff00aa', '#ffd700', '#00ff88', '#a855f7', '#f97316'];

export default function SettingsPanel({ open, onClose, initialTab }) {
  const [tab, setTab] = useState('calendars');

  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);
  const [calendars, setCalendars] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  // New calendar form
  const [form, setForm] = useState({ name: '', url: '', owner: '', color: COLORS[0] });

  // Weather settings
  const [weather, setWeather] = useState({ lat: '', lon: '', city: '' });
  const [weatherSaved, setWeatherSaved] = useState(false);

  // Spotify settings
  const [spotify, setSpotify] = useState({ clientId: '', clientSecret: '' });
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifySaved, setSpotifySaved] = useState(false);

  // Admin password change
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });

  useEffect(() => {
    if (!open) return;
    fetchCalendars();
    fetch('/api/settings')
      .then(r => r.json())
      .then(s => {
        setWeather({ lat: s.weather_lat, lon: s.weather_lon, city: s.weather_city });
        setSpotify({ clientId: s.spotify_client_id || '', clientSecret: s.spotify_client_secret || '' });
        setSpotifyConnected(!!s.spotify_connected);
      });
  }, [open]);

  const fetchCalendars = () =>
    fetch('/api/calendars').then(r => r.json()).then(setCalendars).catch(() => {});

  const addCalendar = async () => {
    if (!form.name.trim() || !form.url.trim()) return;
    setSyncing(true);
    await fetch('/api/calendars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setForm({ name: '', url: '', owner: '', color: COLORS[calendars.length % COLORS.length] });
    await fetchCalendars();
    setSyncing(false);
  };

  const deleteCalendar = async (id) => {
    await fetch(`/api/calendars/${id}`, { method: 'DELETE' });
    fetchCalendars();
  };

  const toggleCalendar = async (cal) => {
    await fetch(`/api/calendars/${cal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !cal.enabled }),
    });
    fetchCalendars();
  };

  const syncNow = async () => {
    setSyncing(true);
    await fetch('/api/calendars/sync', { method: 'POST' });
    await fetchCalendars();
    setSyncing(false);
    setLastSync(new Date().toLocaleTimeString());
  };

  const saveWeather = async () => {
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weather_lat: weather.lat, weather_lon: weather.lon, weather_city: weather.city }),
    });
    setWeatherSaved(true);
    setTimeout(() => setWeatherSaved(false), 2000);
  };

  const saveSpotify = async () => {
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotify_client_id: spotify.clientId, spotify_client_secret: spotify.clientSecret }),
    });
    setSpotifySaved(true);
    setTimeout(() => setSpotifySaved(false), 2000);
  };

  const disconnectSpotify = async () => {
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotify_refresh_token: '' }),
    });
    setSpotifyConnected(false);
  };

  const changePassword = async () => {
    if (pwd.next !== pwd.confirm) return alert('Passwords do not match');
    const res = await fetch('/api/settings/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd.current }),
    });
    if (!res.ok) return alert('Current password wrong');
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_password: pwd.next }),
    });
    setPwd({ current: '', next: '', confirm: '' });
    alert('Password changed');
  };

  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-panel glass" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sp-header">
          <h2 className="chromatic-text" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.1em' }}>
            SETTINGS
          </h2>
          <button className="btn" onClick={onClose} style={{ padding: '4px 12px' }}>✕</button>
        </div>

        {/* Tabs */}
        <div className="sp-tabs">
          {['calendars', 'weather', 'spotify', 'security'].map(t => (
            <button key={t} className={`sp-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'calendars' ? '📅 Calendars' : t === 'weather' ? '🌤 Weather' : t === 'spotify' ? '🎵 Spotify' : '🔐 Security'}
            </button>
          ))}
        </div>

        {/* ─── Calendars tab ────────────────────────────────────── */}
        {tab === 'calendars' && (
          <div className="sp-body">
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
              Add iCal feed URLs from Google Calendar or Apple iCloud. Each person can have their own feed with a unique colour.
            </p>

            {/* Existing calendars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
              {calendars.map(cal => (
                <div key={cal.id} className="glass cal-row">
                  <span className="cal-swatch" style={{ background: cal.color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{cal.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cal.owner && <span style={{ color: 'var(--text-dim)', marginRight: 6 }}>{cal.owner} ·</span>}
                      {cal.url}
                    </div>
                    {cal.last_synced && (
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                        Last synced: {new Date(cal.last_synced).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn"
                    style={{ padding: '3px 8px', fontSize: 11 }}
                    onClick={() => toggleCalendar(cal)}
                    title={cal.enabled ? 'Disable' : 'Enable'}
                  >
                    {cal.enabled ? '●' : '○'}
                  </button>
                  <button
                    className="btn"
                    style={{ padding: '3px 8px', fontSize: 11, color: 'var(--magenta)' }}
                    onClick={() => deleteCalendar(cal.id)}
                  >✕</button>
                </div>
              ))}
              {calendars.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                  No calendars added yet
                </div>
              )}
            </div>

            {/* Add new */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p className="label" style={{ marginBottom: 4 }}>Add calendar feed</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder="Name (e.g. Emma's Google)" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ flex: 1 }} />
                <input className="input" placeholder="Owner (optional)" value={form.owner}
                  onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} style={{ width: 110 }} />
              </div>
              <input className="input" placeholder="iCal URL  (https://... or webcal://...)"
                value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="label">Colour:</span>
                {COLORS.map(c => (
                  <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                    style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: form.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
                ))}
                <button className="btn primary" onClick={addCalendar} disabled={syncing} style={{ marginLeft: 'auto' }}>
                  {syncing ? 'Adding…' : '+ Add & Sync'}
                </button>
              </div>
            </div>

            {/* Force sync */}
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn" onClick={syncNow} disabled={syncing}>
                {syncing ? '⏳ Syncing…' : '↻ Sync all now'}
              </button>
              {lastSync && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Last: {lastSync}</span>}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>Auto-syncs every 15 min</span>
            </div>

            {/* How-to hint */}
            <details style={{ marginTop: 20 }}>
              <summary style={{ fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer' }}>How to get your iCal URL ›</summary>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.8, background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>
                <strong style={{ color: 'var(--text)' }}>Google Calendar:</strong><br />
                calendar.google.com → ⚙ Settings → click your calendar → "Integrate calendar" → copy the <em>Secret address in iCal format</em> (starts with https://…/basic.ics)<br /><br />
                <strong style={{ color: 'var(--text)' }}>Apple iCloud:</strong><br />
                iCloud.com → Calendar → ⋯ next to a calendar → "Share Calendar" → enable "Public Calendar" → copy the link (starts with webcal://)<br /><br />
                <strong style={{ color: 'var(--text)' }}>iOS Reminders / other apps:</strong><br />
                Any standard .ics subscription URL works.
              </div>
            </details>
          </div>
        )}

        {/* ─── Weather tab ──────────────────────────────────────── */}
        {tab === 'weather' && (
          <div className="sp-body">
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
              Weather data is from Open-Meteo (free, no API key). Find your coordinates at <strong style={{ color: 'var(--text)' }}>open-meteo.com</strong>.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <p className="label" style={{ marginBottom: 4 }}>City name (display only)</p>
                <input className="input" value={weather.city}
                  onChange={e => setWeather(w => ({ ...w, city: e.target.value }))} placeholder="London" />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <p className="label" style={{ marginBottom: 4 }}>Latitude</p>
                  <input className="input" value={weather.lat}
                    onChange={e => setWeather(w => ({ ...w, lat: e.target.value }))} placeholder="51.5074" />
                </div>
                <div style={{ flex: 1 }}>
                  <p className="label" style={{ marginBottom: 4 }}>Longitude</p>
                  <input className="input" value={weather.lon}
                    onChange={e => setWeather(w => ({ ...w, lon: e.target.value }))} placeholder="-0.1278" />
                </div>
              </div>
              <button className="btn primary" onClick={saveWeather}>
                {weatherSaved ? '✓ Saved' : 'Save location'}
              </button>
            </div>
          </div>
        )}

        {/* ─── Spotify tab ──────────────────────────────────────── */}
        {tab === 'spotify' && (
          <div className="sp-body">
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
              Register an app at <strong style={{ color: 'var(--text)' }}>developer.spotify.com</strong>, paste your credentials below, save, then click Connect.
            </p>

            {/* Connection status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10,
                          background: spotifyConnected ? 'rgba(0,255,136,0.08)' : 'var(--surface-2)',
                          border: `1px solid ${spotifyConnected ? 'var(--green)' : 'var(--border)'}`,
                          marginBottom: 18 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                             background: spotifyConnected ? 'var(--green)' : 'var(--text-muted)' }} />
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                {spotifyConnected ? 'Connected' : 'Not connected'}
              </span>
              {spotifyConnected && (
                <button className="btn" style={{ fontSize: 11, padding: '3px 10px', color: 'var(--magenta)' }}
                  onClick={disconnectSpotify}>Disconnect</button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <p className="label" style={{ marginBottom: 4 }}>Client ID</p>
                <input className="input" value={spotify.clientId}
                  onChange={e => setSpotify(s => ({ ...s, clientId: e.target.value }))} placeholder="Client ID" />
              </div>
              <div>
                <p className="label" style={{ marginBottom: 4 }}>Client Secret</p>
                <input className="input" type="password" value={spotify.clientSecret}
                  onChange={e => setSpotify(s => ({ ...s, clientSecret: e.target.value }))} placeholder="Client Secret" />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" style={{ flex: 1 }} onClick={saveSpotify}>
                  {spotifySaved ? '✓ Saved' : 'Save credentials'}
                </button>
                <a href="/api/spotify/auth" className="btn" style={{ flex: 1, textAlign: 'center', textDecoration: 'none',
                    background: 'linear-gradient(135deg,rgba(30,215,96,.15),rgba(30,215,96,.05))',
                    borderColor: '#1ed760', color: '#1ed760' }}>
                  {spotifyConnected ? '↻ Reconnect' : '🎵 Connect Spotify'}
                </a>
              </div>
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer' }}>Redirect URI (add to Spotify app dashboard) ›</summary>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, background: 'var(--surface-2)',
                              padding: '10px 12px', borderRadius: 8, fontFamily: 'monospace', lineHeight: 2 }}>
                  {window.location.origin}/api/spotify/callback
                </div>
              </details>
            </div>
          </div>
        )}

        {/* ─── Security tab ─────────────────────────────────────── */}
        {tab === 'security' && (
          <div className="sp-body">
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 }}>Change the admin mode password.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input className="input" type="password" placeholder="Current password"
                value={pwd.current} onChange={e => setPwd(p => ({ ...p, current: e.target.value }))} />
              <input className="input" type="password" placeholder="New password"
                value={pwd.next} onChange={e => setPwd(p => ({ ...p, next: e.target.value }))} />
              <input className="input" type="password" placeholder="Confirm new password"
                value={pwd.confirm} onChange={e => setPwd(p => ({ ...p, confirm: e.target.value }))} />
              <button className="btn primary" onClick={changePassword}>Change password</button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .settings-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 600;
          display: flex; align-items: stretch; justify-content: flex-end;
        }
        .settings-panel {
          width: min(480px, 100vw); height: 100vh; overflow-y: auto;
          display: flex; flex-direction: column;
          border-radius: var(--radius) 0 0 var(--radius);
          border-right: none; padding: 0;
          animation: slideFromRight 0.25s ease;
        }
        @media (max-width: 768px) {
          .settings-panel {
            width: 100vw;
            border-radius: 0;
          }
        }
        @keyframes slideFromRight {
          from { transform: translateX(40px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        .sp-header { display: flex; justify-content: space-between; align-items: center;
                     padding: 24px 24px 0; }
        .sp-tabs { display: flex; gap: 4px; padding: 16px 24px 0; border-bottom: 1px solid var(--border); }
        .sp-tab { background: none; border: none; color: var(--text-dim); cursor: pointer;
                  font-family: inherit; font-size: 12px; padding: 8px 12px; border-radius: 8px 8px 0 0;
                  transition: all 0.2s; }
        .sp-tab.active { background: var(--surface-2); color: var(--cyan); border-bottom: 2px solid var(--cyan); }
        .sp-tab:hover:not(.active) { color: var(--text); }
        .sp-body { padding: 24px; flex: 1; }
        .cal-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
        .cal-swatch { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
      `}</style>
    </div>
  );
}
