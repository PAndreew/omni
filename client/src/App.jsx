import { useState, useEffect, useCallback } from 'react';
import { Gamepad2, Settings, Smartphone } from 'lucide-react';
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
import GamesMenu from './components/GamesMenu.jsx';
import ZatackaStage from './components/games/ZatackaStage.jsx';
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
  const [showGames, setShowGames]       = useState(false);
  const [activeGame, setActiveGame]     = useState(null);
  const [activeGameConfig, setActiveGameConfig] = useState(null);

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
      // Sidebar indices: -1 (Games), -2 (Remote), -3 (Settings)
      if (dir === 'left') {
        if (prev === 0) return -1;
        if (prev === 3) return -2;
        if (prev === 6) return -3;
        if (prev < 0) return prev;
        return Math.max(prev - 1, 0);
      }
      if (dir === 'right') {
        if (prev === -1) return 0;
        if (prev === -2) return 3;
        if (prev === -3) return 6;
        if (prev < 0) return prev;
        return Math.min(prev + 1, TILES.length - 1);
      }
      if (dir === 'up') {
        if (prev === -1) return -1;
        if (prev === -2) return -1;
        if (prev === -3) return -2;
        if (prev === 6) return 3;
        if (prev === 7) return 5;
        return Math.max(prev - 3, 0);
      }
      if (dir === 'down') {
        if (prev === -1) return -2;
        if (prev === -2) return -3;
        if (prev === -3) return -3;
        if (prev >= 6) return prev;
        if (prev <= 2) return prev === 0 ? 6 : 7;
        const bottomTarget = prev === 3 ? 6 : 7;
        return Math.min(bottomTarget, TILES.length - 1);
      }
      return prev;
    });
  }, []);

  const getFocusables = useCallback(() => {
    // If a modal is open, focus only within it
    const modal = document.querySelector('.modal, .settings-panel, .games-panel');
    if (modal) {
      return Array.from(
        modal.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], textarea, select, [tabindex="0"]')
      ).filter(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return true;
      });
    }

    // Otherwise, if in widget mode, focus within the tile
    if (widgetMode) {
      const tile = document.querySelector(`[data-tile="${TILES[focusIdx]}"]`);
      if (!tile) return [];
      return Array.from(
        tile.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], textarea, select, [tabindex="0"]')
      ).filter(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return true;
      });
    }
    return [];
  }, [focusIdx, widgetMode]);

  const enterWidget = useCallback(() => {
    setWidgetMode(true);
    setTimeout(() => {
      const els = getFocusables();
      if (els.length) { els[0].focus(); els[0].scrollIntoView({ block: 'nearest' }); }
    }, 60);
  }, [getFocusables]);

  const exitWidget = useCallback(() => {
    setWidgetMode(false);
    document.activeElement?.blur();
  }, []);

  const widgetStep = useCallback((dir) => {
    const els = getFocusables();
    if (!els.length) return;
    const cur  = els.indexOf(document.activeElement);
    const next = dir === 'next'
      ? Math.min(cur < 0 ? 0 : cur + 1, els.length - 1)
      : Math.max(cur <= 0 ? 0 : cur - 1, 0);
    els[next].focus();
    els[next].scrollIntoView({ block: 'nearest' });
  }, [getFocusables]);

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
        // Don't intercept arrow keys if we are typing in a terminal
        const isTerm = document.activeElement?.dataset?.termSessionId || document.activeElement?.classList.contains('xterm-helper-textarea');
        if (isTerm) return;

        e.preventDefault();
        if (!widgetMode && !modalActive) {
          navigate(map[e.key]);
        } else {
          const stepMap = { ArrowRight: 'next', ArrowDown: 'next', ArrowLeft: 'prev', ArrowUp: 'prev' };
          widgetStep(stepMap[e.key]);
        }
      }
      if (e.key === 'Escape' && widgetMode) exitWidget();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, widgetMode, exitWidget]);

  const modalActive = showLogin || showSettings || showGames;

  useSocket('cec:right',  () => { 
    console.log('[CEC] right', { cecKeyboardOpen, widgetMode, modalActive });
    if (!cecKeyboardOpen) { if (modalActive || widgetMode) widgetStep('next'); else navigate('right'); } 
  });
  useSocket('cec:left',   () => { 
    console.log('[CEC] left', { cecKeyboardOpen, widgetMode, modalActive });
    if (!cecKeyboardOpen) { if (modalActive || widgetMode) widgetStep('prev'); else navigate('left'); } 
  });
  useSocket('cec:down',   () => { 
    console.log('[CEC] down', { cecKeyboardOpen, widgetMode, modalActive });
    if (!cecKeyboardOpen) { if (modalActive || widgetMode) widgetStep('next'); else navigate('down'); } 
  });
  useSocket('cec:up',     () => { 
    console.log('[CEC] up', { cecKeyboardOpen, widgetMode, modalActive });
    if (!cecKeyboardOpen) { if (modalActive || widgetMode) widgetStep('prev'); else navigate('up'); } 
  });
  useSocket('cec:select', () => { 
    console.log('[CEC] select', { cecKeyboardOpen, widgetMode, focusIdx, modalActive });
    if (!cecKeyboardOpen) { 
      if (modalActive || widgetMode) {
        widgetActivate();
      } else {
        if (focusIdx === -1) toggleGames();
        else if (focusIdx === -2) openRemote();
        else if (focusIdx === -3) openAdmin();
        else enterWidget();
      }
    } 
  });
  useSocket('cec:back',   () => {
    if (showLogin) setShowLogin(false);
    else if (showSettings) setShowSettings(false);
    else if (widgetMode) exitWidget();
  });

  // Helper: get active terminal session id from DOM
  const getActiveTermId = useCallback(() => {
    return document.querySelector('[data-active-term-id]')?.dataset.activeTermId || null;
  }, []);

  // Remote text relay — route to PTY when terminal is active widget, else to focused input
  useSocket('remote:type', (text) => {
    // Terminal widget is active → always send to PTY
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
  const openRemote = () => window.open('/remote', '_blank');
  const toggleGames = () => setShowGames(prev => !prev);
  const launchGame = (gameId, config) => {
    setActiveGame(gameId);
    setActiveGameConfig(config);
    setShowGames(false);
  };
  const closeGame = () => {
    setActiveGame(null);
    setActiveGameConfig(null);
  };

  // Auto-focus first element when modal opens
  useEffect(() => {
    if (modalActive) {
      setTimeout(() => {
        const els = getFocusables();
        if (els.length) els[0].focus();
      }, 100);
    }
  }, [modalActive, getFocusables]);

  return (
    <>
      <div className="shell">
        <nav className="sidebar">
          <button className={`sidebar-btn games-btn ${focusIdx === -1 ? 'focused' : ''}`} onClick={toggleGames} title="Open games menu">
            <Gamepad2 size={18} strokeWidth={1.5} />
          </button>
          <button className={`sidebar-btn ${focusIdx === -2 ? 'focused' : ''}`} onClick={openRemote} title="Open remote control on this device">
            <Smartphone size={18} strokeWidth={1.5} />
          </button>
          <button className={`sidebar-btn ${focusIdx === -3 ? 'focused' : ''}`} onClick={openAdmin} title="Admin / Settings">
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
      <GamesMenu open={showGames} onClose={() => setShowGames(false)} onLaunch={launchGame} />
      <ZatackaStage open={activeGame === 'zatacka'} config={activeGameConfig} onClose={closeGame} />
      <NotificationManager />

      <style>{`
        .shell { display: flex; flex-direction: row; width: 100vw; height: 100vh; overflow: hidden; }
        .sidebar { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; width: 48px; flex-shrink: 0; padding: 12px 0; border-right: 1px solid var(--border); gap: 12px; z-index: 10; }
        .sidebar-btn { width: 36px; height: 36px; background: transparent; border: none; color: var(--silver); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.2s; }
        .sidebar-btn:hover { color: var(--silver-light); }
        .sidebar-btn.focused { color: var(--silver-light); outline: 2px solid var(--silver-light); outline-offset: -2px; }
        .games-btn { color: var(--silver-light); }

        .games-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 420; display: flex; align-items: flex-end; justify-content: flex-start; }
        .games-panel { width: min(440px, calc(100vw - 32px)); margin: 0 0 72px 56px; padding: 18px; background: var(--surface); border: 1px solid var(--border); box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
        .games-panel header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .games-panel h3 { font-size: 12px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: var(--silver-light); }
        .games-panel .section-title { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-muted); margin: 14px 0 8px; }
        .games-list { display: grid; gap: 8px; }
        .games-card { display: grid; gap: 6px; padding: 12px; border: 1px solid var(--border); background: var(--surface-2); cursor: pointer; transition: border-color 0.2s; text-align: left; color: var(--text); font-family: inherit; border-radius: 0; }
        .games-card.active { border-color: var(--silver); }
        .games-card-title { font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; }
        .games-card-desc { font-size: 12px; color: var(--text-dim); }
        .games-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .games-pill { padding: 6px 10px; border: 1px solid var(--border); background: var(--surface-2); font-size: 11px; color: var(--text-dim); cursor: pointer; border-radius: 0; }
        .games-pill.active { border-color: var(--silver); color: var(--silver-light); }
        .games-field { display: grid; gap: 6px; }
        .games-field label { font-size: 11px; color: var(--text-muted); }
        .games-field input, .games-field select { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 6px 8px; font-family: inherit; font-size: 12px; }
        .games-players { display: grid; gap: 8px; }
        .games-player { display: grid; grid-template-columns: 1fr 1fr 70px; gap: 8px; align-items: end; }
        .games-color-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 6px; border: 1px solid rgba(255,255,255,0.2); }
        .games-actions { display: flex; gap: 8px; margin-top: 16px; }

        .game-stage-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 520; display: flex; align-items: center; justify-content: center; }
        .game-stage { width: min(980px, calc(100vw - 32px)); background: var(--surface); border: 1px solid var(--border); }
        .game-stage header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); }
        .game-stage-title { font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--silver-light); }
        .game-stage-body { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 14px; padding: 16px; }
        .game-stage-canvas { width: 100%; height: 540px; background: #050505; border: 1px solid var(--border); }
        .game-stage-meta { display: grid; gap: 10px; font-size: 12px; color: var(--text-dim); }

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
          .games-btn { margin-right: auto; }
          .games-backdrop { align-items: flex-start; }
          .games-panel { margin: 60px 12px 12px; width: calc(100vw - 24px); }
          .game-stage { width: calc(100vw - 24px); }
          .game-stage-body { grid-template-columns: 1fr; }
          .game-stage-canvas { height: 320px; }
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
