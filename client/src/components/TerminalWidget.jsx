import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as TermIcon, Plus, X, Maximize2, Minimize2 } from 'lucide-react';
import { getSocket } from '../hooks/useSocket.js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

let sessionCounter = Date.now() % 100000;

const STORAGE_KEY = 'omni:term:sessions';
// localStorage so sessions survive full browser close/reopen
function loadPersistedSessions() {
  try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
function persistSessions(sessions) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch {}
}

function playPing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

function notifyNeedsInput(sessionIndex) {
  playPing();
  if (Notification.permission === 'granted') {
    new Notification('Terminal waiting for input', {
      body: `Session ${sessionIndex} needs your attention`,
      icon: '/favicon.ico',
      tag: 'term-needs-input',
    });
  }
}

function Session({ id, active, onClose, onActivate }) {
  const containerRef = useRef(null);
  const termRef      = useRef(null);  // xterm Terminal instance
  const fitRef       = useRef(null);  // FitAddon instance
  const socketRef    = useRef(null);
  const handlersRef  = useRef({});    // named handlers so we can remove them specifically

  useEffect(() => {
    if (!containerRef.current) return;
    
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Mono", monospace',
      fontSize: 13,
      lineHeight: 1.3,
      theme: {
        background:  '#000000',
        foreground:  '#cccccc',
        cursor:      '#909090',
        black:       '#000000',
        brightBlack: '#525252',
        white:       '#cccccc',
        brightWhite: '#ffffff',
        blue:        '#5c9cf5',
        green:       '#3dba6e',
        red:         '#e06c75',
        yellow:      '#d4a85a',
        cyan:        '#56b6c2',
        magenta:     '#c678dd',
      },
      allowProposedApi: true,
      scrollback: 2000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    // Tag xterm's hidden textarea with the session id so App.jsx can
    // route remote text input to the correct PTY session.
    try {
      const ta = containerRef.current.querySelector('textarea');
      if (ta) {
        ta.dataset.termSessionId = id;
      }
    } catch {}

    termRef.current = term;
    fitRef.current  = fitAddon;

    // Open PTY session on server
    const socket = getSocket();
    socketRef.current = socket;
    socket.emit('term:open', { id, cols: term.cols, rows: term.rows });

    // Server → terminal — store refs so cleanup removes only this session's listeners
    const onData = ({ id: sid, data }) => { if (sid === id) term.write(data); };
    const onClosed = ({ id: sid }) => {
      if (sid === id) term.write('\r\n\x1b[31m[session closed]\x1b[0m\r\n');
    };
    handlersRef.current = { onData, onClosed };
    socket.on('term:data',   onData);
    socket.on('term:closed', onClosed);

    // Terminal → server
    term.onData(data => socket.emit('term:input', { id, data }));

    // Resize
    term.onResize(({ cols, rows }) => socket.emit('term:resize', { id, cols, rows }));

    return () => {
      term.dispose();
      termRef.current = null;
      // Only detach listeners — do NOT kill the PTY so it survives navigation
      if (socketRef.current) {
        socketRef.current.off('term:data',   handlersRef.current.onData);
        socketRef.current.off('term:closed', handlersRef.current.onClosed);
      }
    };
  }, [id]);

  // Fit on active change / resize
  useEffect(() => {
    if (!active || !fitRef.current) return;
    const raf = requestAnimationFrame(() => fitRef.current?.fit());
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // Global resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => fitRef.current?.fit());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      style={{ display: active ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
      onClick={onActivate}
      data-session-id={id}
    >
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, overscrollBehavior: 'contain' }} />
    </div>
  );
}

export default function TerminalWidget({ focused }) {
  const rootRef = useRef(null);
  const [sessions, setSessions] = useState(() => {
    const saved = loadPersistedSessions();
    // Strip any transient fields from persisted data
    return saved?.length ? saved.map(s => ({ id: s.id })) : [{ id: `term-${++sessionCounter}` }];
  });
  const [activeId, setActiveId] = useState(() => {
    const saved = loadPersistedSessions();
    return saved?.length ? saved[saved.length - 1].id : `term-${sessionCounter}`;
  });
  // Track which sessions are waiting for input (show dot on tab)
  const [activityIds, setActivityIds] = useState(new Set());
  const [fullscreen, setFullscreen] = useState(false);

  // Key sequences sent via the on-screen navbar
  const KEY_BUTTONS = [
    { label: 'Esc',  seq: '\x1b'   },
    { label: 'Tab',  seq: '\t'     },
    { label: '/',    seq: '/'      },
    { label: '↑',    seq: '\x1b[A' },
    { label: '↓',    seq: '\x1b[B' },
    { label: '←',    seq: '\x1b[D' },
    { label: '→',    seq: '\x1b[C' },
  ];

  const sendKey = useCallback((seq) => {
    getSocket().emit('term:input', { id: activeId, data: seq });
    focusActiveTerminal();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Listen for server-side needs-input / activity events
  useEffect(() => {
    const socket = getSocket();
    const onNeedsInput = ({ id }) => {
      setActivityIds(prev => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      // Only ping if this session isn't currently active and focused
      setSessions(current => {
        const idx = current.findIndex(s => s.id === id);
        notifyNeedsInput(idx + 1);
        return current;
      });
    };
    const onActivity = ({ id }) => {
      setActivityIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    };
    socket.on('term:needs-input', onNeedsInput);
    socket.on('term:activity', onActivity);
    return () => {
      socket.off('term:needs-input', onNeedsInput);
      socket.off('term:activity', onActivity);
    };
  }, []);

  // Persist session list whenever it changes (only id, no transient state)
  useEffect(() => { persistSessions(sessions.map(s => ({ id: s.id }))); }, [sessions]);

  const focusTerminalFor = useCallback((sessionId) => {
    const root = rootRef.current;
    if (!root) return;

    const tryFocus = (attempt = 0) => {
      // Be very specific: find the textarea inside the session's container
      const ta = root.querySelector(`div[data-session-id="${sessionId}"] textarea`);

      if (ta) {
        ta.focus();
        // Fallback for some browsers
        if (document.activeElement !== ta) ta.focus();
        return;
      }

      // xterm is lazy-loaded from CDN, so it may not be ready immediately.
      if (attempt < 30) setTimeout(() => tryFocus(attempt + 1), 50);
    };

    tryFocus();
  }, []);

  const focusActiveTerminal = useCallback(() => {
    focusTerminalFor(activeId);
  }, [activeId, focusTerminalFor]);

  // Auto-focus when widget becomes active or session changes
  useEffect(() => {
    if (focused) {
      focusActiveTerminal();
    }
  }, [focused, activeId, focusActiveTerminal]);

  const newSession = useCallback(() => {
    const id = `term-${++sessionCounter}`;
    setSessions(prev => [...prev, { id }]);
    setActiveId(id);
    setTimeout(() => focusTerminalFor(id), 100);
  }, [focusTerminalFor]);

  const closeSession = useCallback((id) => {
    // Explicitly kill the PTY on the server
    getSocket().emit('term:close', { id });
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (!next.length) {
        const nid = `term-${++sessionCounter}`;
        setActiveId(nid);
        return [{ id: nid }];
      }
      setActiveId(a => a === id ? next[next.length - 1].id : a);
      return next;
    });
  }, []);

  return (
    <div
      ref={rootRef}
      className={`tile term-tile ${focused ? 'focused' : ''} ${fullscreen ? 'term-fullscreen' : ''}`}
      data-active-term-id={activeId}
    >
      {/* Tab bar */}
      <div className="term-tabbar">
        <TermIcon size={13} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <div className="term-tabs">
          {sessions.map((s, i) => (
            <button
              key={s.id}
              className={`term-tab ${s.id === activeId ? 'active' : ''} ${activityIds.has(s.id) ? 'needs-input' : ''}`}
              onClick={() => {
                setActiveId(s.id);
                setActivityIds(prev => { const n = new Set(prev); n.delete(s.id); return n; });
                setTimeout(() => focusTerminalFor(s.id), 0);
              }}
            >
              {activityIds.has(s.id) && <span className="term-tab-dot" />}
              <span>{i + 1}</span>
              <span className="term-tab-close" onClick={e => { e.stopPropagation(); closeSession(s.id); }}>
                <X size={10} strokeWidth={2} />
              </span>
            </button>
          ))}
        </div>
        <button className="term-new-btn" onClick={newSession} title="New terminal session">
          <Plus size={13} strokeWidth={2} />
        </button>
        <button className="term-new-btn" onClick={() => setFullscreen(f => !f)} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {fullscreen ? <Minimize2 size={13} strokeWidth={2} /> : <Maximize2 size={13} strokeWidth={2} />}
        </button>
      </div>

      {/* Terminal panes */}
      <div className="term-body" onClick={focusActiveTerminal}>
        {sessions.map(s => (
          <Session
            key={s.id}
            id={s.id}
            active={s.id === activeId}
            onActivate={() => { setActiveId(s.id); setTimeout(() => focusTerminalFor(s.id), 0); }}
            onClose={() => closeSession(s.id)}
          />
        ))}
      </div>

      {/* On-screen key navbar — only shown in fullscreen */}
      {fullscreen && (
        <div className="term-keybar">
          {KEY_BUTTONS.map(({ label, seq }) => (
            <button
              key={label}
              className="term-key-btn"
              onPointerDown={e => { e.preventDefault(); sendKey(seq); }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <style>{`
        .term-tile {
          display: flex; flex-direction: column; padding: 0; overflow: hidden;
        }
        .term-tabbar {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 10px; border-bottom: 1px solid var(--border);
          background: var(--surface); flex-shrink: 0;
        }
        .term-tabs { display: flex; gap: 2px; flex: 1; overflow-x: auto; min-width: 0; }
        .term-tabs::-webkit-scrollbar { height: 0; }
        .term-tab {
          display: flex; align-items: center; gap: 5px;
          padding: 3px 8px; font-size: 11px; letter-spacing: 0.06em;
          background: transparent; border: 1px solid transparent;
          color: var(--text-dim); cursor: pointer; white-space: nowrap;
          transition: all 0.15s; border-radius: 0;
        }
        .term-tab:hover { color: var(--silver); border-color: var(--border); }
        .term-tab.active { color: var(--silver-light); border-color: var(--border); background: var(--surface-2); }
        .term-tab.needs-input { color: #56b6c2; }
        .term-tab-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: #56b6c2; flex-shrink: 0;
          animation: tab-pulse 1.5s ease-in-out infinite;
        }
        .term-tab-close {
          display: flex; align-items: center; opacity: 0.4;
          transition: opacity 0.15s;
        }
        .term-tab:hover .term-tab-close { opacity: 0.8; }
        .term-new-btn {
          display: flex; align-items: center; justify-content: center;
          width: 22px; height: 22px; background: transparent; border: none;
          color: var(--text-dim); cursor: pointer; transition: color 0.15s;
        }
        .term-new-btn:hover { color: var(--silver-light); }
        .term-body {
          flex: 1; min-height: 0; display: flex; flex-direction: column;
          padding: 4px 6px 4px 4px;
          background: #000;
        }

        /* Fullscreen mode — escape bento grid, cover entire screen */
        .term-fullscreen {
          position: fixed !important;
          inset: 0 !important;
          z-index: 9000 !important;
          border-radius: 0 !important;
          width: 100dvw !important;
          height: 100dvh !important;
        }

        /* On-screen key navbar */
        .term-keybar {
          display: flex; gap: 6px; padding: 8px 10px;
          background: var(--surface); border-top: 1px solid var(--border);
          flex-shrink: 0; overflow-x: auto;
        }
        .term-keybar::-webkit-scrollbar { height: 0; }
        .term-key-btn {
          padding: 6px 14px; font-size: 12px; font-family: inherit;
          background: var(--surface-2); border: 1px solid var(--border);
          color: var(--silver); cursor: pointer; border-radius: 4px;
          white-space: nowrap; flex-shrink: 0;
          transition: background 0.12s, color 0.12s;
          -webkit-user-select: none; user-select: none;
        }
        .term-key-btn:active { background: var(--border); color: var(--silver-light); }

        /* xterm overrides */
        .term-body .xterm { height: 100% !important; overflow: visible !important; }
        .term-body .xterm-viewport { border-radius: 0; overscroll-behavior: contain; }
        .term-body .xterm-screen  { overflow: visible !important; }
      `}</style>
    </div>
  );
}
