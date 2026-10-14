import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Card } from './ui/card.jsx';

export default function Clock({ focused }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const tick = () => {
      window.__omniClockHeartbeat = Date.now();
      setNow(new Date());
    };
    tick();
    const id = setInterval(tick, 1000);
    window.addEventListener('pageshow', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      window.removeEventListener('pageshow', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const hours   = format(now, 'HH');
  const minutes = format(now, 'mm');
  const seconds = format(now, 'ss');
  const dateStr = format(now, 'EEEE, MMMM d');

  return (
    <Card className={`tile clock-tile ${focused ? 'focused' : ''}`}>
      <p className="title">Clock</p>
      <div className="clock-time">
        <span className="clock-hm">{hours}<span className="clock-colon">:</span>{minutes}</span>
        <span className="clock-seconds">{seconds}</span>
      </div>
      <p className="clock-date">{dateStr}</p>
      <style>{`
        .clock-tile { display: flex; flex-direction: column; justify-content: flex-start; }
        .clock-time  { display: flex; align-items: baseline; gap: 4px; }
        .clock-hm    { font-family: inherit; font-size: clamp(36px, 6vw, 88px);
                       font-weight: 700; letter-spacing: -3px; line-height: 1; color: var(--text); }
        .clock-colon { animation: blink 1s step-start infinite; }
        .clock-seconds { font-family: inherit; font-size: clamp(14px, 2vw, 26px);
                         font-weight: 300; color: var(--text-dim); align-self: flex-end;
                         margin-bottom: 8px; }
        .clock-date { font-size: 11px; font-weight: 400; letter-spacing: 0.16em;
                      color: var(--text-dim); text-transform: uppercase; margin-top: 10px; }
        @keyframes blink { 50% { opacity: 0; } }
        @media (max-width: 768px) {
          .clock-seconds { display: none; }
          .clock-date { font-size: 11px; }
        }
      `}</style>
    </Card>
  );
}
