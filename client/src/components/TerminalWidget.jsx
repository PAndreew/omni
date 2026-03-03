import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as TermIcon, Plus, X } from 'lucide-react';
import { getSocket } from '../hooks/useSocket.js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

let sessionCounter = Date.now() % 100000;

const STORAGE_KEY = 'omni:term:sessions';
function loadPersistedSessions() {
  try { const s = sessionStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
function persistSessions(sessions) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch {}
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
    return saved?.length ? saved : [{ id: `term-${++sessionCounter}` }];
  });
  const [activeId, setActiveId] = useState(() => {
    const saved = loadPersistedSessions();
    return saved?.length ? saved[saved.length - 1].id : `term-${sessionCounter}`;
  });

  // Persist session list whenever it changes
  useEffect(() => { persistSessions(sessions); }, [sessions]);

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
    <div ref={rootRef} className={`tile term-tile ${focused ? 'focused' : ''}`} data-active-term-id={activeId}>
      {/* Tab bar */}
      <div className="term-tabbar">
        <TermIcon size={13} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <div className="term-tabs">
          {sessions.map((s, i) => (
            <button
              key={s.id}
              className={`term-tab ${s.id === activeId ? 'active' : ''}`}
              onClick={() => { setActiveId(s.id); setTimeout(() => focusTerminalFor(s.id), 0); }}
            >
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

        /* xterm overrides */
        .term-body .xterm { height: 100% !important; overflow: visible !important; }
        .term-body .xterm-viewport { border-radius: 0; overscroll-behavior: contain; }
        .term-body .xterm-screen  { overflow: visible !important; }
      `}</style>
    </div>
  );
}
