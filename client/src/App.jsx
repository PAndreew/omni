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
import TerminalWidget from './components/TerminalWidget.jsx';
import NotificationManager from './components/Notifications.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { useSocket, getSocket } from './hooks/useSocket.js';

const TILES = ['clock', 'weather', 'nowplaying', 'chores', 'calendar', 'rss', 'voice', 'terminal'];

export default function App() {
  const [focusIdx, setFocusIdx]       = useState(0);
  const cecKeyboardOpen               = useCecKeyboardOpen();
  const [adminMode, setAdminMode]     = useState(false);
  const [adminPwd, setAdminPwd]       = useState('');
  const [showLogin, setShowLogin]     = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [spotifyTab, setSpotifyTab]     = useState(false);
  const [widgetMode, setWidgetMode]     = useState(false);
  const [termTabNav, setTermTabNav]     = useState(false);  // terminal widget: navigating tab bar vs body

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
        // bottom row is idx 6 (voice) and 7 (terminal) — treat as row 2 col 0 and col 1
        if (prev >= 6) return prev; // already in bottom
        if (prev <= 2) return prev === 0 ? 6 : 7; // clock→voice, weather/nowplaying→terminal
        // row 1 (3,4,5) → voice=6, terminal=7, rss stays at 6 from col 2
        const bottomTarget = prev === 3 ? 6 : prev === 4 ? 7 : 7;
        return Math.min(bottomTarget, TILES.length - 1);
      }
      if (dir === 'up') {
        if (prev === 6) return 3; // voice → chores
        if (prev === 7) return 5; // terminal → rss
        return Math.max(prev - cols, 0);
      }
      return prev;
    });
  }, []);

  // ── Widget-mode callbacks — declared before any hook that references them ──
  const getTileFocusables = useCallback(() => {
    const tile = document.querySelector(`[data-tile="${TILES[focusIdx]}"]`);
    if (!tile) return [];
    return Array.from(
      tile.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], textarea, select, [tabindex="0"]')
    ).filter(el => {
      // Check if it's visible or has a focusable tabindex
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }, [focusIdx]);

  // ── Helpers for terminal widget ────────────────────────────────────────
  const isTermWidget = useCallback(() => TILES[focusIdx] === 'terminal', [focusIdx]);

  const getActiveTermId = useCallback(() => {
    return document.querySelector('[data-active-term-id]')?.dataset.activeTermId || null;
  }, []);

  const focusActiveXterm = useCallback(() => {
    const id = getActiveTermId();
    if (!id) return;
    const tryFocus = (attempt = 0) => {
      const ta = document.querySelector(`textarea[data-term-session-id="${id}"]`)
        || document.querySelector('.xterm-helper-textarea');
      if (ta) { ta.focus(); return; }
      if (attempt < 20) setTimeout(() => tryFocus(attempt + 1), 50);
    };
    tryFocus();
  }, [getActiveTermId]);

  const enterWidget = useCallback(() => {
    setWidgetMode(true);
    if (TILES[focusIdx] === 'terminal') {
      setTermTabNav(false);
      setTimeout(() => focusActiveXterm(), 60);
      return;
    }
    setTimeout(() => {
      const els = getTileFocusables();
      if (els.length) { els[0].focus(); els[0].scrollIntoView({ block: 'nearest' }); }
    }, 60);
  }, [getTileFocusables, focusIdx, focusActiveXterm]);

  const exitWidget = useCallback(() => {
    setWidgetMode(false);
    setTermTabNav(false);
    document.activeElement?.blur();
  }, []);

  const widgetStep = useCallback((dir) => {
    const els = getTileFocusables();
    if (!els.length) return;
    const cur  = els.indexOf(document.activeElement);
    const next = dir === 'next'
      ? Math.min(cur < 0 ? 0 : cur + 1, els.length - 1)
      : Math.max(cur <= 0 ? 0 : cur - 1, 0);
    els[next].focus();
    els[next].scrollIntoView({ block: 'nearest' });
  }, [getTileFocusables]);

  const widgetActivate = useCallback(() => {
    const el = document.activeElement;
    if (!el) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    } else {
      el.click();
    }
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const map = { ArrowRight:'right', ArrowLeft:'left', ArrowDown:'down', ArrowUp:'up' };
      if (map[e.key]) {
        e.preventDefault();
        if (!widgetMode) navigate(map[e.key]);
      }
      if (e.key === 'Escape' && widgetMode) exitWidget();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, widgetMode, exitWidget]);

  // ── CEC / D-pad handlers (terminal-aware) ──────────────────────────────
  useSocket('cec:right', () => {
    if (cecKeyboardOpen) return;
    if (!widgetMode) { navigate('right'); return; }
    if (isTermWidget() && !termTabNav) {
      const id = getActiveTermId();
      if (id) getSocket().emit('term:input', { id, data: '\x1b[C' });
    } else { widgetStep('next'); }
  });
  useSocket('cec:left', () => {
    if (cecKeyboardOpen) return;
    if (!widgetMode) { navigate('left'); return; }
    if (isTermWidget() && !termTabNav) {
      const id = getActiveTermId();
      if (id) getSocket().emit('term:input', { id, data: '\x1b[D' });
    } else { widgetStep('prev'); }
  });
  useSocket('cec:down', () => {
    if (cecKeyboardOpen) return;
    if (!widgetMode) { navigate('down'); return; }
    if (isTermWidget() && termTabNav) {
      setTermTabNav(false);
      focusActiveXterm();
    } else if (!isTermWidget()) { widgetStep('next'); }
  });
  useSocket('cec:up', () => {
    if (cecKeyboardOpen) return;
    if (!widgetMode) { navigate('up'); return; }
    if (isTermWidget() && !termTabNav) {
      setTermTabNav(true);
      const tile = document.querySelector('[data-tile="terminal"]');
      const first = tile?.querySelector('.term-tab, .term-new-btn');
      if (first) first.focus();
    } else if (!isTermWidget()) { widgetStep('prev'); }
  });
  useSocket('cec:select', () => {
    if (cecKeyboardOpen) return;
    if (!widgetMode) { enterWidget(); return; }
    if (isTermWidget() && termTabNav) {
      widgetActivate();
      // After clicking a tab or "+", return to terminal body
      setTermTabNav(false);
      setTimeout(() => focusActiveXterm(), 100);
    } else if (!isTermWidget()) {
      widgetActivate();
    }
    // In terminal body mode, select is a no-op (xterm handles input)
  });
  useSocket('cec:back', () => {
    if (showLogin) setShowLogin(false);
    else if (showSettings) setShowSettings(false);
    else if (widgetMode && isTermWidget() && termTabNav) { setTermTabNav(false); focusActiveXterm(); }
    else if (widgetMode) exitWidget();
  });

  // Remote text relay — inject into focused input, or into terminal PTY when active
  useSocket('remote:type', (text) => {
    // Always route to PTY when terminal widget is active
    if (widgetMode && TILES[focusIdx] === 'terminal') {
      const id = getActiveTermId();
      if (id) { getSocket().emit('term:input', { id, data: text }); return; }
    }
    const el = document.activeElement;
    if (!el) return;
    if (el.tagName === 'TEXTAREA' && el.dataset?.termSessionId) {
      getSocket().emit('term:input', { id: el.dataset.termSessionId, data: text }); return;
    }
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
    const proto  = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, el.value + text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  useSocket('remote:backspace', () => {
    if (widgetMode && TILES[focusIdx] === 'terminal') {
      const id = getActiveTermId();
      if (id) { getSocket().emit('term:input', { id, data: '\x7f' }); return; }
    }
    const el = document.activeElement;
    if (!el) return;
    if (el.tagName === 'TEXTAREA' && el.dataset?.termSessionId) {
      getSocket().emit('term:input', { id: el.dataset.termSessionId, data: '\x7f' }); return;
    }
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
    const proto  = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, el.value.slice(0, -1));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  useSocket('remote:enter', () => {
    if (widgetMode && TILES[focusIdx] === 'terminal') {
      const id = getActiveTermId();
      if (id) { getSocket().emit('term:input', { id, data: '\r' }); return; }
    }
    const el = document.activeElement;
    if (!el) return;
    if (el.tagName === 'TEXTAREA' && el.dataset?.termSessionId) {
      getSocket().emit('term:input', { id: el.dataset.termSessionId, data: '\r' }); return;
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });

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
          {TILES.map((name, idx) => (
            <div key={name} data-tile={name}
                 className={`grid-area-${name}${widgetMode && focusIdx === idx ? ' widget-active' : ''}`}>
              {name === 'clock'      && <Clock            focused={focusIdx === 0} />}
              {name === 'weather'    && <Weather          focused={focusIdx === 1} />}
              {name === 'nowplaying' && <NowPlaying       focused={focusIdx === 2} />}
              {name === 'chores'     && <ChoreList        focused={focusIdx === 3} />}
              {name === 'calendar'   && <CalendarWidget   focused={focusIdx === 4} />}
              {name === 'rss'        && <RssWidget        focused={focusIdx === 5} />}
              {name === 'voice'      && <VoiceAssistant   focused={focusIdx === 6} />}
              {name === 'terminal'   && <TerminalWidget    focused={focusIdx === 7} />}
            </div>
          ))}
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
          grid-template-columns: 1fr 1.15fr 0.9fr;
          grid-template-rows: 1fr 2.2fr minmax(60px, 0.4fr);
          grid-template-areas:
            "clock weather nowplaying"
            "chores calendar rss"
            "voice terminal terminal";
          gap: 14px; padding: 14px; min-width: 0; min-height: 0;
        }

        .grid-area-clock, .grid-area-weather, .grid-area-nowplaying, .grid-area-chores, .grid-area-calendar, .grid-area-rss, .grid-area-voice, .grid-area-terminal { min-height: 0; min-width: 0; overflow: hidden; }
        .grid-area-clock      { grid-area: clock; }
        .grid-area-weather    { grid-area: weather; }
        .grid-area-nowplaying { grid-area: nowplaying; }
        .grid-area-chores     { grid-area: chores; }
        .grid-area-calendar   { grid-area: calendar; }
        .grid-area-rss        { grid-area: rss; }
        .grid-area-voice      { grid-area: voice; }
        .grid-area-terminal   { grid-area: terminal; }

        .grid-area-clock > *, .grid-area-weather > *, .grid-area-nowplaying > *, .grid-area-chores > *, .grid-area-calendar > *, .grid-area-rss > *, .grid-area-voice > *, .grid-area-terminal > * { height: 100%; }
        .grid-area-voice .tile { padding: 14px 20px; }

        @media (max-width: 768px) {
          .shell { flex-direction: column; height: auto; min-height: 100vh; overflow-x: hidden; overflow-y: auto; }
          .sidebar { flex-direction: row; width: 100%; height: 48px; justify-content: flex-end; padding: 0 12px; border-right: none; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--void); z-index: 200; }
          .app-grid { display: flex; flex-direction: column; height: auto; width: 100%; max-width: 100%; overflow-x: hidden; gap: 10px; padding: 10px; }
          .grid-area-clock > *, .grid-area-weather > *, .grid-area-nowplaying > *, .grid-area-chores > *, .grid-area-calendar > *, .grid-area-rss > *, .grid-area-voice > *, .grid-area-terminal > * { height: auto; }
          .clock-tile { flex-direction: row !important; align-items: center; gap: 12px; }
          .clock-date { margin-top: 0 !important; }
        }

        .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 500; }
        .modal { padding: 28px; border-radius: 0; width: min(360px, calc(100vw - 32px)); }

        /* Widget mode: show focus ring on whatever element is selected */
        .widget-active button:focus,
        .widget-active input:focus,
        .widget-active textarea:focus,
        .widget-active a:focus,
        .widget-active [tabindex="0"]:focus {
          outline: 2px solid var(--silver-light) !important;
          outline-offset: -2px;
          box-shadow: 0 0 15px rgba(255,255,255,0.1);
        }
        /* Ensure delete buttons are visible when focused in widget mode */
        .widget-active .chore-delete:focus { opacity: 1 !important; color: var(--red); }
      `}</style>
    </>
  );
}
