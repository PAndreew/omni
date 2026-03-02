import { useState, useCallback, useEffect } from 'react';
import { Mic, MicOff, Volume2, Loader } from 'lucide-react';
import { useVoiceRecognition, useTTS } from '../hooks/useVoice.js';
import { useSocket } from '../hooks/useSocket.js';

export default function VoiceAssistant({ focused }) {
  const [status, setStatus] = useState('idle'); // idle | listening | wake | processing | speaking
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [active, setActive] = useState(false);

  const { speak } = useTTS();

  const handleCommand = useCallback(async (text) => {
    setStatus('processing');
    setTranscript(text);
    try {
      const res = await fetch('/api/voice/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const { reply: r } = await res.json();
      setReply(r);
      setStatus('speaking');
      speak(r);
      setTimeout(() => setStatus(active ? 'listening' : 'idle'), 3000);
    } catch {
      setStatus('idle');
    }
  }, [speak, active]);

  useSocket('voice:reply', ({ text }) => {
    setReply(text);
    speak(text);
  });

  const { listening, wakeWordDetected, supported, start, stop } = useVoiceRecognition({
    onCommand: handleCommand,
    onListening: (v) => setStatus(v ? 'listening' : 'idle'),
  });

  useEffect(() => {
    if (wakeWordDetected) setStatus('wake');
    else if (listening) setStatus('listening');
  }, [wakeWordDetected, listening]);

  // Auto-start on mount (kiosk). On mobile Safari this silently fails — user must tap Start.
  useEffect(() => {
    start().then(() => setActive(true)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(() => {
    if (active) { stop(); setActive(false); setStatus('idle'); }
    else { start(); setActive(true); setStatus('listening'); }
  }, [active, start, stop]);

  const MicIcon = status === 'processing' ? Loader
                : status === 'speaking'   ? Volume2
                : active                  ? Mic
                :                          MicOff;

  if (!supported) return (
    <div className={`tile ${focused ? 'focused' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <MicOff size={20} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
      <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Voice recognition not supported in this browser.</span>
    </div>
  );

  return (
    <div className={`tile voice-tile ${focused ? 'focused' : ''}`}>
      <div className="voice-inner">
        <button className={`voice-btn ${status !== 'idle' ? 'active' : ''}`} onClick={toggle} aria-label="Toggle voice">
          {status === 'wake' && <div className="voice-ripple" />}
          <MicIcon
            size={22}
            strokeWidth={1.5}
            style={{ color: status === 'processing' ? 'var(--silver-light)' : status === 'speaking' ? 'var(--green)' : status !== 'idle' ? 'var(--silver)' : 'var(--silver)' }}
            className={status === 'processing' ? 'spin' : ''}
          />
        </button>

        <div className="voice-text">
          <div className="voice-status">
            {status === 'idle'       && <span style={{ color: 'var(--text-muted)' }}>{active ? 'Say \u201cHey Omni\u201d to activate' : 'Tap \u201cStart\u201d to enable microphone'}</span>}
            {status === 'listening'  && <span style={{ color: 'var(--silver)' }}>Listening… say "Hey Omni" to activate</span>}
            {status === 'wake'       && <span className="chromatic-text" style={{ fontWeight: 600 }}>Wake word detected — listening for command…</span>}
            {status === 'processing' && <span style={{ color: 'var(--silver-light)' }}>Processing: "{transcript}"</span>}
            {status === 'speaking'   && <span style={{ color: 'var(--green)' }}>"{reply}"</span>}
          </div>
          {transcript && status !== 'speaking' && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Last: "{transcript}"</div>
          )}
        </div>

        <button className="btn" onClick={toggle}>
          {active ? 'Stop' : 'Start'}
        </button>
      </div>

      <div className="voice-hint">
        Commands: <em>weather</em> · <em>time</em> · <em>chores</em> · <em>add chore: [task]</em> · <em>play/pause</em> · <em>next track</em> · <em>good night</em>
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
        .voice-btn   { position: relative;
                       width: clamp(38px, 4.5vh, 52px); height: clamp(38px, 4.5vh, 52px);
                       border-radius: 50%;
                       background: var(--surface-2); border: 1.5px solid var(--border);
                       display: flex; align-items: center; justify-content: center; cursor: pointer;
                       transition: all 0.3s; flex-shrink: 0; }
        .voice-btn.active { border-color: var(--silver); box-shadow: 0 0 12px rgba(176,176,176,0.15); }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        /* Mobile: compact horizontal strip */
        @media (max-width: 768px) {
          .voice-tile { padding: 14px 16px; gap: 0; }
          .voice-hint { display: none; }
        }
      `}</style>
    </div>
  );
}
