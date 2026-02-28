import { useState, useEffect, useCallback } from 'react';
import Clock from './components/Clock.jsx';
import Weather from './components/Weather.jsx';
import ChoreList from './components/ChoreList.jsx';
import NowPlaying from './components/NowPlaying.jsx';
import CalendarWidget from './components/CalendarWidget.jsx';
import VoiceAssistant from './components/VoiceAssistant.jsx';
import NotificationManager from './components/Notifications.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { useSocket } from './hooks/useSocket.js';

// Widget grid definition
const TILES = ['clock', 'weather', 'nowplaying', 'chores', 'calendar', 'voice'];

const WIDGET_MAP = {
  clock:      Clock,
  weather:    Weather,
  nowplaying: NowPlaying,
  chores:     ChoreList,
  calendar:   CalendarWidget,
  voice:      VoiceAssistant,
};

export default function App() {
  const [focusIdx, setFocusIdx] = useState(0);
  const [adminMode, setAdminMode] = useState(false);
  const [adminPwd, setAdminPwd] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // D-pad keyboard navigation (also driven by CEC via socket)
  const navigate = useCallback((dir) => {
    setFocusIdx(prev => {
      // 3-column layout: clock(0) weather(1) nowplaying(2) | chores(3) calendar(4) | voice(5)
      const cols = 3;
      if (dir === 'right') return Math.min(prev + 1, TILES.length - 1);
      if (dir === 'left')  return Math.max(prev - 1, 0);
      if (dir === 'down')  return Math.min(prev + cols, TILES.length - 1);
      if (dir === 'up')    return Math.max(prev - cols, 0);
      return prev;
    });
  }, []);

  // Keyboard handler
  useEffect(() => {
    const handler = (e) => {
      const keyMap = {
        ArrowRight: 'right', ArrowLeft: 'left',
        ArrowDown: 'down',   ArrowUp: 'up',
      };
      if (keyMap[e.key]) { e.preventDefault(); navigate(keyMap[e.key]); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  // CEC socket events
  useSocket('cec:right',  () => navigate('right'));
  useSocket('cec:left',   () => navigate('left'));
  useSocket('cec:down',   () => navigate('down'));
  useSocket('cec:up',     () => navigate('up'));
  useSocket('cec:select', () => {
    // Select on currently focused tile — emit an 'activate' event
    const el = document.querySelector(`[data-tile="${TILES[focusIdx]}"]`);
    el?.click();
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

  return (
    <>
      <div className="app-grid">
        {/* Row 1: Clock | Weather | Now Playing */}
        <div data-tile="clock"      className="grid-area-clock">
          <Clock      focused={focusIdx === 0} />
        </div>
        <div data-tile="weather"    className="grid-area-weather">
          <Weather    focused={focusIdx === 1} />
        </div>
        <div data-tile="nowplaying" className="grid-area-nowplaying">
          <NowPlaying focused={focusIdx === 2} />
        </div>

        {/* Row 2: Chores | Calendar */}
        <div data-tile="chores"   className="grid-area-chores">
          <ChoreList  focused={focusIdx === 3} />
        </div>
        <div data-tile="calendar" className="grid-area-calendar">
          <CalendarWidget focused={focusIdx === 4} />
        </div>

        {/* Row 3: Voice */}
        <div data-tile="voice" className="grid-area-voice">
          <VoiceAssistant focused={focusIdx === 5} />
        </div>
      </div>

      {/* Admin toggle (triple-tap bottom-right corner) */}
      <button
        className="admin-trigger"
        onClick={() => setShowLogin(true)}
        title="Admin mode"
      >⚙</button>

      {showLogin && (
        <div className="modal-backdrop" onClick={() => setShowLogin(false)}>
          <div className="modal glass" onClick={e => e.stopPropagation()}>
            <h2 className="chromatic-text" style={{ marginBottom: 16, fontSize: 20 }}>Admin Mode</h2>
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
            {adminMode && (
              <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
                Admin mode active. Widgets are rearrangeable from the phone.
              </div>
            )}
          </div>
        </div>
      )}

      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
      <NotificationManager />

      <style>{`
        /* ── TV layout (default) ───────────────────────────── */
        .app-grid {
          display: grid;
          grid-template-columns: 1fr 1.4fr 0.9fr;
          grid-template-rows: 1fr 1.4fr 0.55fr;
          grid-template-areas:
            "clock weather nowplaying"
            "chores calendar nowplaying"
            "voice voice voice";
          gap: 14px;
          padding: 14px;
          height: 100vh;
          width: 100vw;
        }
        .grid-area-clock      { grid-area: clock; }
        .grid-area-weather    { grid-area: weather; }
        .grid-area-nowplaying { grid-area: nowplaying; }
        .grid-area-chores     { grid-area: chores; }
        .grid-area-calendar   { grid-area: calendar; }
        .grid-area-voice      { grid-area: voice; }

        /* Full height tiles on TV */
        .grid-area-clock > *,
        .grid-area-weather > *,
        .grid-area-nowplaying > *,
        .grid-area-chores > *,
        .grid-area-calendar > *,
        .grid-area-voice > * { height: 100%; }

        /* ── Mobile layout ─────────────────────────────────── */
        @media (max-width: 768px) {
          .app-grid {
            display: flex;
            flex-direction: column;
            height: auto;
            width: 100%;
            gap: 10px;
            padding: 10px;
          }
          /* tiles size to content on mobile */
          .grid-area-clock > *,
          .grid-area-weather > *,
          .grid-area-nowplaying > *,
          .grid-area-chores > *,
          .grid-area-calendar > *,
          .grid-area-voice > * { height: auto; }

          /* clock: compact horizontal layout */
          .clock-tile { flex-direction: row !important; align-items: center; gap: 12px; }
          .clock-date { margin-top: 0 !important; }

          /* now playing: row layout, smaller art */
          .nowplaying-tile { flex-direction: row !important; align-items: center; }
          .np-art-container { width: 72px !important; max-height: 72px !important;
                              aspect-ratio: 1/1; flex-shrink: 0; }
          .np-art-reflection { display: none; }
          .np-info { min-width: 0; }

          /* voice: hide the hint text to save space */
          .voice-hint { display: none; }

          /* chore list: cap height */
          .chore-list { max-height: 220px; }
        }

        .admin-trigger {
          position: fixed; bottom: 16px; right: 16px;
          width: 36px; height: 36px; border-radius: 50%;
          background: transparent; border: 1px solid var(--border);
          color: var(--text-muted); cursor: pointer; font-size: 14px;
          opacity: 0.3; transition: opacity 0.2s;
          z-index: 100;
        }
        .admin-trigger:hover { opacity: 1; }

        .modal-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.7);
          display: flex; align-items: center; justify-content: center; z-index: 500;
        }
        .modal {
          padding: 28px; border-radius: var(--radius); min-width: 300px;
          width: min(360px, calc(100vw - 32px));
        }
      `}</style>
    </>
  );
}
