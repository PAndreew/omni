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
            style={{ color: status === 'processing' ? 'var(--gold)' : status === 'speaking' ? 'var(--green)' : status !== 'idle' ? 'var(--cyan)' : 'var(--text-dim)' }}
            className={status === 'processing' ? 'spin' : ''}
          />
        </button>

        <div className="voice-text">
          <div className="voice-status">
            {status === 'idle'       && <span style={{ color: 'var(--text-muted)' }}>Say <em>"Hey Omni"</em> to activate</span>}
            {status === 'listening'  && <span style={{ color: 'var(--cyan)' }}>Listening… say "Hey Omni" to activate</span>}
            {status === 'wake'       && <span className="chromatic-text" style={{ fontWeight: 600 }}>Wake word detected — listening for command…</span>}
            {status === 'processing' && <span style={{ color: 'var(--gold)' }}>Processing: "{transcript}"</span>}
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
        .voice-tile  { display: flex; flex-direction: column; gap: 10px; }
        .voice-inner { display: flex; align-items: center; gap: 16px; }
        .voice-text  { flex: 1; }
        .voice-status { font-size: 13px; }
        .voice-hint  { font-size: 10px; color: var(--text-muted); letter-spacing: 0.05em; }
        .voice-hint em { color: var(--text-dim); font-style: normal; }
        .voice-btn   { position: relative; width: 52px; height: 52px; border-radius: 50%;
                       background: var(--surface-2); border: 1.5px solid var(--border);
                       display: flex; align-items: center; justify-content: center; cursor: pointer;
                       transition: all 0.3s; flex-shrink: 0; }
        .voice-btn.active { border-color: var(--cyan); box-shadow: 0 0 16px rgba(0,212,255,0.3); }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
