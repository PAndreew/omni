import { useEffect, useRef, useState } from 'react';
import { Mic, Send, Square, X } from 'lucide-react';
import { useGiziVoice } from '../hooks/useGiziVoice.js';
import './GiziButton.css';
import { Button } from './ui/button.jsx';
import { Card } from './ui/card.jsx';

const labels = { idle: 'Ready when you are', connecting: 'Connecting…', listening: 'Listening — tap Send when finished', transcribing: 'Gemini is transcribing…', working: 'Pi is working…', synthesizing: 'Preparing the spoken reply…', speaking: 'Gizi is speaking…', ready: 'Tap the mic for a follow-up', error: 'Voice unavailable' };

export default function GiziButton() {
  const [open, setOpen] = useState(() => location.hash.startsWith('#gizi-key='));
  const [key, setKey] = useState(() => {
    const paired = new URLSearchParams(location.hash.slice(1)).get('gizi-key');
    if (paired && paired.length <= 128) return paired;
    try { return sessionStorage.getItem('gizi-access-key') || ''; } catch { return ''; }
  });
  useEffect(() => {
    if (location.hash.startsWith('#gizi-key=')) {
      history.replaceState(null, '', location.pathname + location.search);
      try { sessionStorage.setItem('gizi-access-key', key); } catch { /* private browsing */ }
    }
  }, [key]);
  const voice = useGiziVoice();
  const active = !['idle', 'error', 'ready'].includes(voice.state);
  const talk = () => {
    try { sessionStorage.setItem('gizi-access-key', key); } catch { /* private browsing */ }
    void voice.start(key);
  };
  const close = () => { voice.stop(); setOpen(false); };
  const [wake, setWake] = useState(null);
  const [wakeError, setWakeError] = useState('');
  const busyRef = useRef(false); busyRef.current = active;
  const sequence = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const kiosk = ['localhost', '127.0.0.1'].includes(location.hostname);
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const response = await fetch('/gizi/wake', { signal: controller.signal });
        if (!response.ok) return;
        const status = await response.json();
        if (controller.signal.aborted) return;
        setWake(status);
        const previous = sequence.current; sequence.current = status.sequence;
        if (kiosk && previous !== null && status.sequence > previous && status.ready && !busyRef.current && !document.hidden) {
          const claim = await fetch('/gizi/wake/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sequence: status.sequence }), signal: controller.signal });
          if (claim.ok && !controller.signal.aborted) { window.dispatchEvent(new Event('gizi:wake')); setOpen(true); void voice.start(key); }
        }
      } catch { /* Normal manual voice controls remain available. */ }
      finally { running = false; }
    };
    fetch('/gizi/session', { method: 'POST', signal: controller.signal }).then(response => { if (response.ok) void poll(); }).catch(() => {});
    const timer = setInterval(poll, 1000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [voice.start, key]);
  const toggleWake = async () => {
    setWakeError('');
    try {
      const response = await fetch('/gizi/wake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !wake?.enabled }) });
      if (!response.ok) throw new Error('Wake detector unavailable.');
      setWake(await response.json());
    } catch (error) { setWakeError(error.message); }
  };
  return <aside className="gizi" aria-label="Gizi voice assistant">
    {open && <Card className="gizi-panel" aria-label="Talk to Gizi">
      <header><strong>Hé Zumi</strong><Button variant="ghost" size="icon" type="button" onClick={close} aria-label="Close voice assistant"><X size={20} /></Button></header>
      <p className="gizi-privacy">Your device’s microphone. Audio goes to Google after Send (or the 14-second cutoff). Replies are Hungarian and play here; music plays on OmniWall.</p>
      <Button variant="outline" type="button" disabled={!wake?.available} aria-pressed={Boolean(wake?.enabled)} onClick={() => void toggleWake()}>Wake word “hé zumi”: {wake?.enabled ? 'On' : 'Off'}</Button>
      <small>{wake?.enabled ? wake.ready ? 'Listening locally on the Pi microphone. Say “hé zumi”, then pause for the voice panel. Detection opens only the Pi kiosk.' : 'Wake detector starting…' : 'Wake-word listening is off.'}</small>
      {wakeError && <p role="alert" className="gizi-error">{wakeError}</p>}
      <p className="gizi-status" role="status" aria-live="polite"><span className={voice.state === 'listening' ? 'gizi-dot live' : 'gizi-dot'} />{labels[voice.state]}</p>
      {voice.error && <p className="gizi-error" role="alert">{voice.error}</p>}
      {voice.transcript && <p className="gizi-transcript"><b>You:</b> {voice.transcript}</p>}
      {voice.reply && <p className="gizi-transcript"><b>Gizi:</b> {voice.reply}</p>}
      <div className="gizi-actions">
        {voice.state === 'listening'
          ? <Button type="button" className="gizi-primary" onClick={() => void voice.end()}><Send size={18} /> Send</Button>
          : <Button type="button" className="gizi-primary" onClick={talk} disabled={active}><Mic size={18} /> {voice.state === 'ready' ? 'Reply' : 'Talk to Gizi'}</Button>}
        <Button variant="outline" type="button" onClick={() => voice.stop()} disabled={['idle', 'error'].includes(voice.state)}><Square size={16} /> Stop</Button>
      </div>
      <a href="/gizi/aliases" style={{ color: 'var(--silver-light)', fontSize: 12 }}>Zene becenevek →</a>
      <small>Tap Talk, speak, then Send. Recording stops after 14 seconds. Stop or hide this page to disconnect the voice session. Wake-word detection stays local on the Pi; use the switch above to stop its microphone listener.</small>
    </Card>}
    <Button variant="ghost" size="icon" type="button" className={`gizi-launcher ${voice.state === 'listening' ? 'is-listening' : ''} ${wake?.enabled && wake?.ready ? 'has-wake' : ''}`} title={wake?.enabled && wake?.ready ? 'Pi microphone listening locally for hé zumi' : 'Voice assistant'} aria-label={open ? 'Close Gizi voice assistant' : 'Open Gizi voice assistant'} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}><Mic size={22} /></Button>
  </aside>;
}
