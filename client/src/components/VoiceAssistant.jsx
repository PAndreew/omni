import { useState, useCallback, useEffect } from 'react';
import { MicOff } from 'lucide-react';
import { useVoicePipeline } from '../hooks/useVoicePipeline.js';

// Persist across navigations — migrate old pi/claude values to omni
function loadMode() {
  try {
    const m = localStorage.getItem('omni:voice:mode') || 'off';
    return m === 'omni' ? 'omni' : 'off';
  } catch { return 'off'; }
}
function saveMode(m) {
  try { localStorage.setItem('omni:voice:mode', m); } catch {}
}

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
  const [mode, setModeState] = useState(loadMode); // 'off' | 'omni'
  const setMode = useCallback((m) => { setModeState(m); saveMode(m); }, []);

  const pipeline = useVoicePipeline();
  const omniState = pipeline.state; // idle | listening | awake | thinking | responding

  // ── Toggle ────────────────────────────────────────────────────────────────
  const handleClick = useCallback(async () => {
    if (mode === 'omni') {
      pipeline.stop();
      setMode('off');
    } else {
      setMode('omni');
      await pipeline.start();
    }
  }, [mode, pipeline, setMode]);

  // ── Auto-start on kiosk (non-touch) ───────────────────────────────────────
  useEffect(() => {
    if (loadMode() === 'omni' && !window.matchMedia('(pointer: coarse)').matches) {
      pipeline.start();
      setModeState('omni');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isActive = mode === 'omni';

  return (
    <div className={`tile voice-tile ${focused ? 'focused' : ''}`}>
      <div className="voice-inner">

        {/* Mic button */}
        <button
          className={`voice-btn${isActive ? ' mode-omni' : ''}${isActive && omniState !== 'idle' ? ' active' : ''}`}
          onClick={handleClick}
          aria-label={isActive ? 'Turn off Omni' : 'Activate Omni'}
          title={isActive ? 'Click to turn off' : 'Click to activate Omni'}
        >
          {isActive && omniState !== 'idle' && (
            <div className={`voice-ripple omni-ripple${omniState === 'awake' ? ' awake-ripple' : ''}`} />
          )}
          {isActive ? <OmniIcon size={22} /> : <MicOff size={22} strokeWidth={1.5} style={{ color: 'var(--silver)' }} />}
        </button>

        {/* Status */}
        <div className="voice-text">
          <div className="voice-status">
            {!isActive &&
              <span style={{ color: 'var(--text-muted)' }}>Tap to activate Omni</span>}
            {isActive && omniState === 'idle' &&
              <span style={{ color: 'var(--text-muted)' }}>Starting…</span>}
            {isActive && omniState === 'listening' &&
              <span style={{ color: 'var(--silver)' }}>Say "Hey Omni"…</span>}
            {isActive && omniState === 'awake' &&
              <span className="chromatic-text" style={{ fontWeight: 600 }}>Say your command…</span>}
            {isActive && omniState === 'thinking' &&
              <span style={{ color: 'var(--silver-light)' }}>Thinking…</span>}
            {isActive && omniState === 'responding' && !pipeline.streamingText &&
              <span style={{ color: 'var(--green)' }}>Speaking…</span>}
          </div>

          {isActive && pipeline.streamingText && (
            <div className="voice-stream-text" aria-live="polite">
              {pipeline.streamingText}<span className="blink-cursor">|</span>
            </div>
          )}

          {isActive && pipeline.transcript && omniState !== 'responding' && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
              Heard: "{pipeline.transcript}"
            </div>
          )}
        </div>
      </div>

      <div className="voice-hint">
        <em>weather</em> · <em>chores</em> · <em>calendar</em> · <em>play/pause</em> · <em>any question</em> · <em>barge-in</em>
      </div>

      <style>{`
        .voice-tile  { display: flex; flex-direction: column; justify-content: center;
                       gap: 8px; overflow: hidden; }
        .voice-inner { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
        .voice-text  { flex: 1; min-width: 0; overflow: hidden; }
        .voice-status { font-size: clamp(11px, 1.2vh, 13px);
                        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .voice-hint  { font-size: clamp(9px, 1vh, 10px); color: var(--text-muted);
                       letter-spacing: 0.04em; line-height: 1.5; }
        .voice-hint em { color: var(--text-dim); font-style: normal; }

        .voice-btn { position: relative;
                     width: clamp(38px, 4.5vh, 52px); height: clamp(38px, 4.5vh, 52px);
                     border-radius: 50%;
                     background: var(--surface-2); border: 1.5px solid var(--border);
                     display: flex; align-items: center; justify-content: center; cursor: pointer;
                     transition: all 0.3s; flex-shrink: 0; }
        .voice-btn.mode-omni         { border-color: #06b6d4; color: #06b6d4; }
        .voice-btn.mode-omni.active  { border-color: #22d3ee; box-shadow: 0 0 16px rgba(34,211,238,0.3); color: #22d3ee; }

        .voice-ripple {
          position: absolute; inset: -4px; border-radius: 50%;
          border: 2px solid var(--silver); opacity: 0;
          animation: ripple 1.5s ease-out infinite;
        }
        .omni-ripple  { border-color: #22d3ee; animation-duration: 2s; }
        .awake-ripple { border-color: #f472b6; animation-duration: 0.8s; }
        @keyframes ripple {
          0%   { transform: scale(0.9); opacity: 0.6; }
          100% { transform: scale(1.4); opacity: 0; }
        }

        .voice-stream-text {
          font-size: clamp(10px, 1.1vh, 12px); color: #22d3ee;
          margin-top: 4px; line-height: 1.4;
          display: -webkit-box; -webkit-line-clamp: 3;
          -webkit-box-orient: vertical; overflow: hidden;
        }
        .blink-cursor {
          display: inline-block; animation: blink 1s step-end infinite;
          color: #22d3ee; margin-left: 1px;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; } 50% { opacity: 0; }
        }

        @media (max-width: 768px) {
          .voice-tile { padding: 14px 16px; gap: 0; }
          .voice-hint { display: none; }
        }
      `}</style>
    </div>
  );
}
