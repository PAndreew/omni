import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Loader, Bot, Cpu } from 'lucide-react';
import { useVoiceRecognition, useTTS } from '../hooks/useVoice.js';
import { useSocket, getSocket } from '../hooks/useSocket.js';

const LANGS = ['hu', 'en', 'auto'];
const LANG_LABEL = { hu: 'HU', en: 'EN', auto: 'AUTO' };

// Persist mode across navigations
function loadMode() {
  try { return localStorage.getItem('omni:voice:mode') || 'off'; } catch { return 'off'; }
}
function saveMode(m) {
  try { localStorage.setItem('omni:voice:mode', m); } catch {}
}

export default function VoiceAssistant({ focused }) {
  // ── Core state ────────────────────────────────────────────────────────────
  const [mode,   setModeState] = useState(loadMode);   // 'off' | 'pi' | 'claude'
  const [status, setStatus]    = useState('idle');
  // idle | listening | wake | processing | agent_thinking | awaiting_confirm | speaking

  const [transcript,    setTranscript]    = useState('');
  const [agentMessage,  setAgentMessage]  = useState('');  // last agent:status or question
  const [finalReply,    setFinalReply]    = useState('');
  const [error,         setError]         = useState('');
  const [lang,          setLang]          = useState('hu');
  const [countdown,     setCountdown]     = useState(0);
  const [active,        setActive]        = useState(false);  // mic on/off

  const countdownRef      = useRef(null);
  const confirmTimeout    = useRef(null);
  const setDirectModeRef  = useRef(() => {});  // populated after hook call

  const { speak, cancel: cancelTTS } = useTTS();

  // ── Mode setter (also saves to localStorage) ──────────────────────────────
  const setMode = useCallback((m) => { setModeState(m); saveMode(m); }, []);

  // ── Load saved lang on mount ───────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(s => setLang(s.voice_language || 'hu')).catch(() => {});
  }, []);

  const cycleLang = useCallback(() => {
    const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
    setLang(next);
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice_language: next }),
    }).catch(() => {});
  }, [lang]);

  // ── Countdown helper ───────────────────────────────────────────────────────
  const startCountdown = useCallback((seconds) => {
    setCountdown(seconds);
    clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const stopCountdown = useCallback(() => {
    clearInterval(countdownRef.current);
    setCountdown(0);
  }, []);

  // ── Voice command handler (wake word path) ────────────────────────────────
  const handleCommand = useCallback((text) => {
    if (!text) return;
    console.log('[VA] handleCommand:', text, 'mode:', mode);
    setTranscript(text);
    setStatus('agent_thinking');
    setAgentMessage('');
    setFinalReply('');
    getSocket().emit('agent:command', { text, agent: mode });
  }, [mode]);

  // ── Direct speech handler (confirm-response path) ─────────────────────────
  const handleDirectSpeech = useCallback((text) => {
    if (!text || status !== 'awaiting_confirm') return;
    console.log('[VA] directSpeech (confirm):', text);
    clearTimeout(confirmTimeout.current);
    stopCountdown();
    setDirectModeRef.current(false);
    setStatus('agent_thinking');
    setAgentMessage('Processing your response…');
    getSocket().emit('agent:respond', { text });
  }, [status, stopCountdown]);

  // ── Voice recognition hook ────────────────────────────────────────────────
  const {
    listening, wakeWordDetected, chunkCount, supported,
    start, stop, setDirectMode,
  } = useVoiceRecognition({
    onCommand: handleCommand,
    onDirectSpeech: handleDirectSpeech,
    onListening: (v) => setStatus(v ? 'listening' : 'idle'),
    onError: (msg) => { setError(msg); setActive(false); setStatus('idle'); },
  });

  // Populate the ref so handleDirectSpeech can call setDirectMode without circular deps
  useEffect(() => { setDirectModeRef.current = setDirectMode; }, [setDirectMode]);

  useEffect(() => {
    if (wakeWordDetected) setStatus('wake');
    else if (listening && status !== 'agent_thinking' && status !== 'awaiting_confirm' && status !== 'speaking') {
      setStatus('listening');
    }
  }, [wakeWordDetected, listening]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mic control ───────────────────────────────────────────────────────────
  const stopMic = useCallback(() => {
    stop();
    setActive(false);
    setStatus('idle');
    cancelTTS();
    setDirectModeRef.current(false);
    clearTimeout(confirmTimeout.current);
    stopCountdown();
    getSocket().emit('agent:cancel');
  }, [stop, cancelTTS, stopCountdown]);

  // ── Mode switch ───────────────────────────────────────────────────────────
  const switchMode = useCallback(async (newMode) => {
    // Cancel any pending confirm
    clearTimeout(confirmTimeout.current);
    stopCountdown();
    setDirectModeRef.current(false);

    if (newMode === mode && active) {
      // Clicking active mode → turn off
      stopMic();
      setMode('off');
      return;
    }
    if (newMode === 'off') { stopMic(); setMode('off'); return; }
    if (active && mode !== 'off') { stop(); setActive(false); }
    setMode(newMode);
    setStatus('idle');
    setAgentMessage('');
    setFinalReply('');
    setError('');
    getSocket().emit('agent:cancel');
    const ok = await start();
    if (ok) setActive(true);
  }, [mode, active, stopMic, stop, start, setMode, stopCountdown]);

  // ── Auto-start on kiosk (non-touch), restore saved mode ───────────────────
  useEffect(() => {
    const savedMode = loadMode();
    if (savedMode !== 'off' && !window.matchMedia('(pointer: coarse)').matches) {
      switchMode(savedMode);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Socket: agent events ──────────────────────────────────────────────────
  useSocket('agent:status', ({ text }) => {
    setStatus('agent_thinking');
    setAgentMessage(text);
  });

  useSocket('agent:ask', ({ text, timeout }) => {
    setStatus('awaiting_confirm');
    setAgentMessage(text);
    cancelTTS();
    speak(text);

    const secs = Math.round((timeout || 25000) / 1000);
    startCountdown(secs);
    setDirectModeRef.current(true);

    clearTimeout(confirmTimeout.current);
    confirmTimeout.current = setTimeout(() => {
      setDirectModeRef.current(false);
      stopCountdown();
      getSocket().emit('agent:cancel');
      setStatus(active ? 'listening' : 'idle');
      setAgentMessage('');
    }, timeout || 25000);
  });

  useSocket('agent:done', ({ text }) => {
    setFinalReply(text);
    setAgentMessage('');
    setStatus('speaking');
    cancelTTS();
    speak(text);
    setTimeout(() => {
      if (active) setStatus('listening');
      else setStatus('idle');
    }, 4000);
  });

  useSocket('agent:error', ({ text }) => {
    setError(text);
    setStatus(active ? 'listening' : 'idle');
    speak(text);
  });

  // Legacy HTTP voice reply from socket
  useSocket('voice:reply', ({ text }) => { speak(text); });

  // ── Mode icons ─────────────────────────────────────────────────────────────
  const MicIcon = status === 'processing' || status === 'agent_thinking' ? Loader
                : status === 'speaking'   ? Volume2
                : active                  ? Mic
                :                          MicOff;

  const micColor = status === 'speaking' ? 'var(--green)'
                 : mode === 'claude'      ? '#a78bfa'
                 : mode === 'pi'          ? 'var(--silver)'
                 :                         'var(--silver)';

  if (!supported) return (
    <div className={`tile ${focused ? 'focused' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <MicOff size={20} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
      <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Voice recognition not supported in this browser.</span>
    </div>
  );

  return (
    <div className={`tile voice-tile ${focused ? 'focused' : ''}`}>
      <div className="voice-inner">

        {/* Mic button */}
        <button
          className={`voice-btn ${status !== 'idle' && active ? 'active' : ''} ${mode === 'claude' ? 'mode-claude' : mode === 'pi' ? 'mode-pi' : ''}`}
          onClick={() => mode === 'off' ? switchMode('pi') : switchMode(mode)}
          aria-label="Toggle voice"
          title={active ? 'Click to deactivate' : 'Click to activate'}
        >
          {status === 'wake' && <div className="voice-ripple" />}
          <MicIcon
            size={22} strokeWidth={1.5}
            style={{ color: micColor }}
            className={status === 'agent_thinking' || status === 'processing' ? 'spin' : ''}
          />
        </button>

        {/* Status text area */}
        <div className="voice-text">
          <div className="voice-status">
            {status === 'idle' && mode === 'off' &&
              <span style={{ color: 'var(--text-muted)' }}>Select PI or Claude to activate</span>}
            {status === 'idle' && mode !== 'off' &&
              <span style={{ color: 'var(--text-muted)' }}>Say "Hey Omni" to activate</span>}
            {status === 'listening' &&
              <span style={{ color: 'var(--silver)' }}>Listening… say "Hey Omni"</span>}
            {status === 'wake' &&
              <span className="chromatic-text" style={{ fontWeight: 600 }}>Wake word — listening for command…</span>}
            {status === 'agent_thinking' &&
              <span style={{ color: 'var(--silver-light)' }}>{agentMessage || 'Working…'}</span>}
            {status === 'awaiting_confirm' &&
              <span style={{ color: '#fbbf24', fontWeight: 500 }}>
                {agentMessage}
                {countdown > 0 && <span style={{ color: 'var(--text-dim)', fontSize: 11, marginLeft: 6 }}>{countdown}s</span>}
              </span>}
            {status === 'speaking' &&
              <span style={{ color: 'var(--green)' }}>"{finalReply}"</span>}
          </div>
          {transcript && status !== 'speaking' && status !== 'agent_thinking' && status !== 'awaiting_confirm' && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Last: "{transcript}"</div>
          )}
          {error && (
            <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>⚠ {error}</div>
          )}
          {active && status === 'listening' && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, fontFamily: 'monospace' }}>
              chunks: {chunkCount} · VAD: WAITING
            </div>
          )}
          {status === 'awaiting_confirm' && (
            <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 2 }}>
              Say "yes" or "no"
            </div>
          )}
        </div>

        {/* Right controls: mode pills + lang */}
        <div className="voice-controls">
          <div className="mode-pills">
            <button
              className={`mode-pill ${mode === 'pi' ? 'active-pi' : ''}`}
              onClick={() => switchMode('pi')}
              title="Pi agent — chores, music, home automation"
            >
              <Cpu size={10} strokeWidth={2} style={{ marginRight: 3 }} />PI
            </button>
            <button
              className={`mode-pill ${mode === 'claude' ? 'active-claude' : ''}`}
              onClick={() => switchMode('claude')}
              title="Claude — coding, scripts, general AI"
            >
              <Bot size={10} strokeWidth={2} style={{ marginRight: 3 }} />AI
            </button>
          </div>
          <button onClick={cycleLang} title="Cycle language" className="lang-pill">
            {LANG_LABEL[lang]}
          </button>
        </div>

      </div>

      <div className="voice-hint">
        PI: <em>weather</em> · <em>chores</em> · <em>play/pause</em> · <em>good night</em>
        {' '}·{' '}
        AI: <em>create a script that…</em> · <em>what's in ~/Documents?</em>
      </div>

      <style>{`
        .voice-tile  { display: flex; flex-direction: column; justify-content: center;
                       gap: 8px; overflow: hidden; }
        .voice-inner { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
        .voice-text  { flex: 1; min-width: 0; overflow: hidden; }
        .voice-status { font-size: clamp(11px, 1.2vh, 13px);
                        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .voice-hint  { font-size: clamp(9px, 1vh, 10px); color: var(--text-muted);
                       letter-spacing: 0.04em; line-height: 1.5;
                       overflow: hidden; display: -webkit-box;
                       -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .voice-hint em { color: var(--text-dim); font-style: normal; }

        /* Mic button */
        .voice-btn { position: relative;
                     width: clamp(38px, 4.5vh, 52px); height: clamp(38px, 4.5vh, 52px);
                     border-radius: 50%;
                     background: var(--surface-2); border: 1.5px solid var(--border);
                     display: flex; align-items: center; justify-content: center; cursor: pointer;
                     transition: all 0.3s; flex-shrink: 0; }
        .voice-btn.active      { border-color: var(--silver); box-shadow: 0 0 12px rgba(176,176,176,0.15); }
        .voice-btn.mode-claude { border-color: #7c3aed; }
        .voice-btn.mode-claude.active { border-color: #a78bfa; box-shadow: 0 0 14px rgba(167,139,250,0.25); }
        .voice-btn.mode-pi.active  { border-color: var(--silver); }

        /* Right side controls */
        .voice-controls { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex-shrink: 0; }

        /* Mode pills */
        .mode-pills { display: flex; gap: 4px; }
        .mode-pill {
          display: flex; align-items: center;
          font-size: 10px; font-family: monospace; font-weight: 700; letter-spacing: 0.06em;
          padding: 4px 8px; border-radius: 4px; cursor: pointer;
          background: var(--surface-2); border: 1px solid var(--border);
          color: var(--text-dim); transition: all 0.15s;
        }
        .mode-pill:hover { color: var(--silver); border-color: var(--border); }
        .mode-pill.active-pi    { color: var(--silver-light); border-color: var(--silver);
                                  background: rgba(176,176,176,0.08); }
        .mode-pill.active-claude { color: #a78bfa; border-color: #7c3aed;
                                   background: rgba(124,58,237,0.12); }

        /* Lang pill */
        .lang-pill {
          font-size: 9px; font-family: monospace; font-weight: 700; letter-spacing: 0.08em;
          padding: 2px 7px; border-radius: 4px; cursor: pointer;
          background: var(--surface-2); border: 1px solid var(--border);
          color: var(--text-dim);
        }
        .lang-pill:hover { color: var(--silver); }

        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }

        /* Voice ripple */
        .voice-ripple {
          position: absolute; inset: -4px; border-radius: 50%;
          border: 2px solid var(--silver); opacity: 0;
          animation: ripple 1.5s ease-out infinite;
        }
        @keyframes ripple {
          0%   { transform: scale(0.9); opacity: 0.6; }
          100% { transform: scale(1.4); opacity: 0; }
        }

        /* Mobile: compact */
        @media (max-width: 768px) {
          .voice-tile { padding: 14px 16px; gap: 0; }
          .voice-hint { display: none; }
        }
      `}</style>
    </div>
  );
}
