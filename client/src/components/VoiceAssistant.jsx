import { useState, useCallback, useEffect, useRef } from 'react';
import { MicOff, Mic } from 'lucide-react';
import { useVoiceRecognition, useTTS } from '../hooks/useVoice.js';
import { useVoicePipeline } from '../hooks/useVoicePipeline.js';
import { useSocket, getSocket } from '../hooks/useSocket.js';
import ClaudeIcon from './icons/ClaudeIcon.jsx';
import PiIcon from './icons/PiIcon.jsx';

const LANGS = ['hu', 'en'];

// Persist mode across navigations
function loadMode() {
  try { return localStorage.getItem('omni:voice:mode') || 'off'; } catch { return 'off'; }
}
function saveMode(m) {
  try { localStorage.setItem('omni:voice:mode', m); } catch {}
}

// ── Omni mode icon (waveform-style mic) ──────────────────────────────────────
function OmniIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 2a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
      <path d="M19 10a7 7 0 0 1-14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8"  y1="22" x2="16" y2="22" />
    </svg>
  );
}

export default function VoiceAssistant({ focused }) {
  // ── Core state ────────────────────────────────────────────────────────────
  const [mode,   setModeState] = useState(loadMode);   // 'off' | 'pi' | 'claude' | 'omni'
  const [status, setStatus]    = useState('idle');
  // idle | listening | wake | processing | agent_thinking | awaiting_confirm | speaking

  const [transcript,    setTranscript]    = useState('');
  const [agentMessage,  setAgentMessage]  = useState('');
  const [finalReply,    setFinalReply]    = useState('');
  const [error,         setError]         = useState('');
  const [lang,          setLang]          = useState('hu');
  const [countdown,     setCountdown]     = useState(0);
  const [active,        setActive]        = useState(false);

  const countdownRef      = useRef(null);
  const confirmTimeout    = useRef(null);
  const setDirectModeRef  = useRef(() => {});

  const { speak, cancel: cancelTTS } = useTTS();

  // ── Omni pipeline (mode === 'omni') ───────────────────────────────────────
  const pipeline = useVoicePipeline();

  // ── Mode setter ───────────────────────────────────────────────────────────
  const setMode = useCallback((m) => { setModeState(m); saveMode(m); }, []);

  // ── Load saved lang on mount ───────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(s => setLang(LANGS.includes(s.voice_language) ? s.voice_language : 'hu'))
      .catch(() => {});
  }, []);

  const updateLang = useCallback((next) => {
    setLang(next);
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice_language: next }),
    }).catch(() => {});
  }, []);

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

  // ── Voice command handler (pi/claude wake word path) ──────────────────────
  const handleCommand = useCallback((text) => {
    if (!text) return;
    setTranscript(text);
    setStatus('agent_thinking');
    setAgentMessage('');
    setFinalReply('');
    getSocket().emit('agent:command', { text, agent: mode });
  }, [mode]);

  const handleDirectSpeech = useCallback((text) => {
    if (!text || status !== 'awaiting_confirm') return;
    clearTimeout(confirmTimeout.current);
    stopCountdown();
    setDirectModeRef.current(false);
    setStatus('agent_thinking');
    setAgentMessage('Processing your response…');
    getSocket().emit('agent:respond', { text });
  }, [status, stopCountdown]);

  // ── Voice recognition hook (pi/claude modes) ──────────────────────────────
  const {
    listening, wakeWordDetected, chunkCount, supported,
    start, stop, setDirectMode,
  } = useVoiceRecognition({
    onCommand: handleCommand,
    onDirectSpeech: handleDirectSpeech,
    onListening: (v) => setStatus(v ? 'listening' : 'idle'),
    onError: (msg) => { setError(msg); setActive(false); setStatus('idle'); },
  });

  useEffect(() => { setDirectModeRef.current = setDirectMode; }, [setDirectMode]);

  useEffect(() => {
    if (wakeWordDetected) setStatus('wake');
    else if (listening && status !== 'agent_thinking' && status !== 'awaiting_confirm' && status !== 'speaking') {
      setStatus('listening');
    }
  }, [wakeWordDetected, listening]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mic control (pi/claude) ────────────────────────────────────────────────
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
  // Cycle: off → pi → claude → omni → off
  const switchMode = useCallback(async (newMode) => {
    clearTimeout(confirmTimeout.current);
    stopCountdown();
    setDirectModeRef.current(false);

    // Stop omni pipeline if leaving omni
    if (mode === 'omni' && newMode !== 'omni') {
      pipeline.stop();
    }

    if (newMode === mode && active) {
      stopMic();
      setMode('off');
      return;
    }
    if (newMode === mode && mode === 'omni' && pipeline.active) {
      pipeline.stop();
      setMode('off');
      return;
    }
    if (newMode === 'off') {
      stopMic();
      if (mode === 'omni') pipeline.stop();
      setMode('off');
      return;
    }

    // Start omni mode
    if (newMode === 'omni') {
      if (active && mode !== 'off') { stop(); setActive(false); }
      setMode('omni');
      setStatus('idle');
      setAgentMessage('');
      setFinalReply('');
      setError('');
      await pipeline.start();
      return;
    }

    // Start pi/claude mode
    if (active && mode !== 'off') { stop(); setActive(false); }
    if (mode === 'omni') pipeline.stop();
    setMode(newMode);
    setStatus('idle');
    setAgentMessage('');
    setFinalReply('');
    setError('');
    getSocket().emit('agent:cancel');
    const ok = await start();
    if (ok) setActive(true);
  }, [mode, active, pipeline, stopMic, stop, start, setMode, stopCountdown]);

  // ── Click handler: cycle through modes ────────────────────────────────────
  const handleClick = useCallback(() => {
    if (mode === 'off')   return switchMode('pi');
    if (mode === 'pi')    return switchMode('claude');
    if (mode === 'claude') return switchMode('omni');
    return switchMode('off');
  }, [mode, switchMode]);

  // ── Auto-start on kiosk (non-touch), restore saved mode ───────────────────
  useEffect(() => {
    const savedMode = loadMode();
    if (savedMode !== 'off' && !window.matchMedia('(pointer: coarse)').matches) {
      switchMode(savedMode);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Socket: agent events (pi/claude modes) ────────────────────────────────
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

  useSocket('voice:reply', ({ text }) => { speak(text); });

  // ── Derived values ─────────────────────────────────────────────────────────
  const isOmni = mode === 'omni';
  const omniState = pipeline.state; // 'idle' | 'listening' | 'thinking' | 'responding'

  const buttonIcon = mode === 'claude' ? 'claude'
                   : mode === 'pi'     ? 'pi'
                   : mode === 'omni'   ? 'omni'
                   :                    'off';

  const titleAttr = mode === 'off'    ? 'Click to activate Pi'
                  : mode === 'pi'     ? 'Click to activate Claude'
                  : mode === 'claude' ? 'Click to activate Omni (Deepgram + AI)'
                  :                    'Click to turn off';

  if (!supported && mode !== 'omni') return (
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
          className={`voice-btn ${(isOmni ? pipeline.active : (status !== 'idle' && active)) ? 'active' : ''} ${
            mode === 'claude' ? 'mode-claude' : mode === 'pi' ? 'mode-pi' : mode === 'omni' ? 'mode-omni' : ''
          }`}
          onClick={handleClick}
          aria-label="Toggle voice mode"
          title={titleAttr}
        >
          {status === 'wake' && <div className="voice-ripple" />}
          {isOmni && omniState !== 'idle' && <div className={`voice-ripple omni-ripple${omniState === 'awake' ? ' awake-ripple' : ''}`} />}
          {buttonIcon === 'off' && (
            <MicOff size={22} strokeWidth={1.5} style={{ color: 'var(--silver)' }} />
          )}
          {buttonIcon === 'pi' && <PiIcon size={22} />}
          {buttonIcon === 'claude' && <ClaudeIcon size={22} />}
          {buttonIcon === 'omni' && (
            <OmniIcon size={22} />
          )}
        </button>

        {/* Status text area */}
        <div className="voice-text">
          <div className="voice-status">
            {/* ── Omni mode status ── */}
            {isOmni && omniState === 'idle' &&
              <span style={{ color: 'var(--text-muted)' }}>Omni — say "Hey Omni" to activate</span>}
            {isOmni && omniState === 'listening' &&
              <span style={{ color: 'var(--silver)' }}>Listening for "Hey Omni"…</span>}
            {isOmni && omniState === 'awake' &&
              <span className="chromatic-text" style={{ fontWeight: 600 }}>Say your command…</span>}
            {isOmni && omniState === 'thinking' &&
              <span style={{ color: 'var(--silver-light)' }}>Thinking…</span>}
            {isOmni && omniState === 'responding' && !pipeline.streamingText &&
              <span style={{ color: 'var(--green)' }}>Speaking…</span>}

            {/* ── Pi/Claude mode status ── */}
            {!isOmni && status === 'idle' && mode === 'off' &&
              <span style={{ color: 'var(--text-muted)' }}>Tap mic to activate</span>}
            {!isOmni && status === 'idle' && mode !== 'off' &&
              <span style={{ color: 'var(--text-muted)' }}>Say "Hey Omni" to activate</span>}
            {!isOmni && status === 'listening' &&
              <span style={{ color: 'var(--silver)' }}>Listening… say "Hey Omni"</span>}
            {!isOmni && status === 'wake' &&
              <span className="chromatic-text" style={{ fontWeight: 600 }}>Wake word — listening for command…</span>}
            {!isOmni && status === 'agent_thinking' &&
              <span style={{ color: 'var(--silver-light)' }}>{agentMessage || 'Working…'}</span>}
            {!isOmni && status === 'awaiting_confirm' &&
              <span style={{ color: '#fbbf24', fontWeight: 500 }}>
                {agentMessage}
                {countdown > 0 && <span style={{ color: 'var(--text-dim)', fontSize: 11, marginLeft: 6 }}>{countdown}s</span>}
              </span>}
            {!isOmni && status === 'speaking' &&
              <span style={{ color: 'var(--green)' }}>"{finalReply}"</span>}
          </div>

          {/* ── Omni streaming text ── */}
          {isOmni && pipeline.streamingText && (
            <div className="voice-stream-text" aria-live="polite">
              {pipeline.streamingText}<span className="blink-cursor">|</span>
            </div>
          )}

          {/* ── Omni transcript ── */}
          {isOmni && pipeline.transcript && omniState !== 'responding' && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
              Heard: "{pipeline.transcript}"
            </div>
          )}

          {/* ── Pi/Claude transcript ── */}
          {!isOmni && transcript && status !== 'speaking' && status !== 'agent_thinking' && status !== 'awaiting_confirm' && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Last: "{transcript}"</div>
          )}
          {!isOmni && error && (
            <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>⚠ {error}</div>
          )}
          {!isOmni && active && status === 'listening' && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, fontFamily: 'monospace' }}>
              chunks: {chunkCount} · VAD: WAITING
            </div>
          )}
          {!isOmni && status === 'awaiting_confirm' && (
            <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 2 }}>
              Say "yes" or "no"
            </div>
          )}
        </div>

        {/* Right controls: language dropdown (pi/claude only) */}
        {!isOmni && (
          <div className="voice-controls">
            <label className="lang-select" title="Language">
              <span className="lang-label">Lang</span>
              <select
                value={lang}
                onChange={(e) => updateLang(e.target.value)}
                aria-label="Select language"
              >
                {LANGS.map((code) => (
                  <option key={code} value={code}>{code.toUpperCase()}</option>
                ))}
              </select>
            </label>
          </div>
        )}

      </div>

      <div className="voice-hint">
        {isOmni
          ? <>Omni: <em>weather</em> · <em>chores</em> · <em>play/pause</em> · <em>any question</em> · <em>barge-in supported</em></>
          : <>PI: <em>weather</em> · <em>chores</em> · <em>play/pause</em> · <em>good night</em>
              {' '}·{' '}
              Claude: <em>create a script that…</em> · <em>what's in ~/Documents?</em></>
        }
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
        .voice-btn.mode-omni { border-color: #06b6d4; color: #06b6d4; }
        .voice-btn.mode-omni.active { border-color: #22d3ee; box-shadow: 0 0 16px rgba(34,211,238,0.3); color: #22d3ee; }

        /* Right side controls */
        .voice-controls { display: flex; align-items: center; justify-content: flex-end; flex-shrink: 0; }

        /* Lang dropdown */
        .lang-select { display: inline-flex; align-items: center; gap: 6px;
                       background: var(--surface-2); border: 1px solid var(--border);
                       padding: 4px 6px; border-radius: 6px; }
        .lang-label { font-size: 9px; font-family: monospace; font-weight: 700;
                      letter-spacing: 0.08em; color: var(--text-dim); }
        .lang-select select {
          appearance: none; background: transparent; border: none; outline: none;
          font-size: 10px; font-family: monospace; font-weight: 700; letter-spacing: 0.08em;
          color: var(--text); cursor: pointer; padding-right: 14px;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 0 center;
        }
        .lang-select select option { color: #111; }

        /* Voice ripples */
        .voice-ripple {
          position: absolute; inset: -4px; border-radius: 50%;
          border: 2px solid var(--silver); opacity: 0;
          animation: ripple 1.5s ease-out infinite;
        }
        .omni-ripple { border-color: #22d3ee; animation-duration: 2s; }
        .awake-ripple { border-color: #f472b6; animation-duration: 0.8s; }
        @keyframes ripple {
          0%   { transform: scale(0.9); opacity: 0.6; }
          100% { transform: scale(1.4); opacity: 0; }
        }

        /* Streaming text */
        .voice-stream-text {
          font-size: clamp(10px, 1.1vh, 12px);
          color: #22d3ee;
          margin-top: 4px;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .blink-cursor {
          display: inline-block;
          animation: blink 1s step-end infinite;
          color: #22d3ee;
          margin-left: 1px;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
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
