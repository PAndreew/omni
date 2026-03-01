import { useState, useEffect, useCallback } from 'react';
import { Settings, Smartphone } from 'lucide-react';
import { useCecKeyboardOpen } from './hooks/useCecKeyboard.js';
import { useGamepad } from './hooks/useGamepad.js';
import Clock from './components/Clock.jsx';
import Weather from './components/Weather.jsx';
import ChoreList from './components/ChoreList.jsx';
import NowPlaying from './components/NowPlaying.jsx';
import RssWidget from './components/RssWidget.jsx';
import CalendarWidget from './components/CalendarWidget.jsx';
import VoiceAssistant from './components/VoiceAssistant.jsx';
import NotificationManager from './components/Notifications.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { useSocket, getSocket } from './hooks/useSocket.js';

const TILES = ['clock', 'weather', 'nowplaying', 'chores', 'calendar', 'rss', 'voice'];

export default function App() {
  const [focusIdx, setFocusIdx]       = useState(0);
  const cecKeyboardOpen               = useCecKeyboardOpen();
  const [adminMode, setAdminMode]     = useState(false);
  const [adminPwd, setAdminPwd]       = useState('');
  const [showLogin, setShowLogin]     = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [spotifyTab, setSpotifyTab]     = useState(false);

  // Open settings on Spotify OAuth callback redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('spotify') === 'connected') {
      setAdminMode(true);
      setShowSettings(true);
      setSpotifyTab(true);
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // D-pad / CEC navigation
  const navigate = useCallback((dir) => {
    setFocusIdx(prev => {
      const cols = 3;
      if (dir === 'right') return Math.min(prev + 1, TILES.length - 1);
      if (dir === 'left')  return Math.max(prev - 1, 0);
      if (dir === 'down') {
         if (prev >= 6) return prev; // voice item
         return Math.min(prev + cols, TILES.length - 1);
      }
      if (dir === 'up')    return Math.max(prev - cols, 0);
      return prev;
    });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const map = { ArrowRight:'right', ArrowLeft:'left', ArrowDown:'down', ArrowUp:'up' };
      if (map[e.key]) { e.preventDefault(); navigate(map[e.key]); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  useSocket('cec:right',  () => { if (!cecKeyboardOpen) navigate('right'); });
  useSocket('cec:left',   () => { if (!cecKeyboardOpen) navigate('left'); });
  useSocket('cec:down',   () => { if (!cecKeyboardOpen) navigate('down'); });
  useSocket('cec:up',     () => { if (!cecKeyboardOpen) navigate('up'); });

  useGamepad({
    onUp:      () => { if (!cecKeyboardOpen) navigate('up'); },
    onDown:    () => { if (!cecKeyboardOpen) navigate('down'); },
    onLeft:    () => { if (!cecKeyboardOpen) navigate('left'); },
    onRight:   () => { if (!cecKeyboardOpen) navigate('right'); },
    onSelect:  () => { if (!cecKeyboardOpen) getSocket().emit('cec:select'); },
    onOptions: () => openAdmin(),
  });

  const login = async () => {
    const res = await fetch('/api/settings/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPwd }),
    });
    if (res.ok) { setAdminMode(true); setShowLogin(false); setShowSettings(true); }
    else alert('Wrong password');
    setAdminPwd('');
  };

  const openAdmin  = () => setShowLogin(true);
  const openRemote = () => window.open(`${window.location.protocol}//${window.location.hostname}:3001/remote`, '_blank');

  return (
    <>
      <div className="shell">
        <nav className="sidebar">
          <button className="sidebar-btn" onClick={openRemote} title="Open remote control on this device">
            <Smartphone size={18} strokeWidth={1.5} />
          </button>
          <button className="sidebar-btn" onClick={openAdmin} title="Admin / Settings">
            <Settings size={18} strokeWidth={1.5} />
          </button>
        </nav>

        <div className="app-grid">
          <div data-tile="clock"      className="grid-area-clock">
            <Clock      focused={focusIdx === 0} />
          </div>
          <div data-tile="weather"    className="grid-area-weather">
            <Weather    focused={focusIdx === 1} />
          </div>
          <div data-tile="nowplaying" className="grid-area-nowplaying">
            <NowPlaying focused={focusIdx === 2} />
          </div>
          <div data-tile="chores"     className="grid-area-chores">
            <ChoreList  focused={focusIdx === 3} />
          </div>
          <div data-tile="calendar"   className="grid-area-calendar">
            <CalendarWidget focused={focusIdx === 4} />
          </div>
          <div data-tile="rss"        className="grid-area-rss">
            <RssWidget  focused={focusIdx === 5} />
          </div>
          <div data-tile="voice"      className="grid-area-voice">
            <VoiceAssistant focused={focusIdx === 6} />
          </div>
        </div>
      </div>

      {showLogin && (
        <div className="modal-backdrop" onClick={() => setShowLogin(false)}>
          <div className="modal glass" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 16, fontSize: 14, fontWeight: 500, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--silver-light)' }}>Admin Mode</h2>
            <input
              className="input"
              type="password"
              placeholder="Password"
              value={adminPwd}
              onChange={e => setAdminPwd(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && login()}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary" onClick={login} style={{ flex: 1 }}>Unlock</button>
              <button className="btn" onClick={() => setShowLogin(false)} style={{ flex: 1 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <SettingsPanel open={showSettings} onClose={() => { setShowSettings(false); setSpotifyTab(false); }}
                     initialTab={spotifyTab ? 'spotify' : null} />
      <NotificationManager />

      <style>{`
        .shell { display: flex; flex-direction: row; width: 100vw; height: 100vh; overflow: hidden; }
        .sidebar { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; width: 48px; flex-shrink: 0; padding: 12px 0; border-right: 1px solid var(--border); gap: 12px; z-index: 10; }
        .sidebar-btn { width: 36px; height: 36px; background: transparent; border: none; color: var(--silver); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.2s; }
        .sidebar-btn:hover { color: var(--silver-light); }

        .app-grid {
          flex: 1; display: grid;
          grid-template-columns: 1fr 1.4fr 0.9fr;
          grid-template-rows: 1fr 1.4fr minmax(90px, 0.6fr);
          grid-template-areas:
            "clock weather nowplaying"
            "chores calendar rss"
            "voice voice voice";
          gap: 14px; padding: 14px; min-width: 0; min-height: 0;
        }

        .grid-area-clock, .grid-area-weather, .grid-area-nowplaying, .grid-area-chores, .grid-area-calendar, .grid-area-rss, .grid-area-voice { min-height: 0; min-width: 0; overflow: hidden; }
        .grid-area-clock      { grid-area: clock; }
        .grid-area-weather    { grid-area: weather; }
        .grid-area-nowplaying { grid-area: nowplaying; }
        .grid-area-chores     { grid-area: chores; }
        .grid-area-calendar   { grid-area: calendar; }
        .grid-area-rss        { grid-area: rss; }
        .grid-area-voice      { grid-area: voice; }

        .grid-area-clock > *, .grid-area-weather > *, .grid-area-nowplaying > *, .grid-area-chores > *, .grid-area-calendar > *, .grid-area-rss > *, .grid-area-voice > * { height: 100%; }
        .grid-area-voice .tile { padding: 14px 20px; }

        @media (max-width: 768px) {
          .shell { flex-direction: column; height: auto; min-height: 100vh; overflow-x: hidden; overflow-y: auto; }
          .sidebar { flex-direction: row; width: 100%; height: 48px; justify-content: flex-end; padding: 0 12px; border-right: none; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--void); z-index: 200; }
          .app-grid { display: flex; flex-direction: column; height: auto; width: 100%; max-width: 100%; overflow-x: hidden; gap: 10px; padding: 10px; }
          .grid-area-clock > *, .grid-area-weather > *, .grid-area-nowplaying > *, .grid-area-chores > *, .grid-area-calendar > *, .grid-area-rss > *, .grid-area-voice > * { height: auto; }
          .clock-tile { flex-direction: row !important; align-items: center; gap: 12px; }
          .clock-date { margin-top: 0 !important; }
        }

        .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 500; }
        .modal { padding: 28px; border-radius: 0; width: min(360px, calc(100vw - 32px)); }
      `}</style>
    </>
  );
}
