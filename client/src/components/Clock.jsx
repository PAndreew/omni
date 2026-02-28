import { useState, useEffect } from 'react';
import { format } from 'date-fns';

export default function Clock({ focused }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hours   = format(now, 'HH');
  const minutes = format(now, 'mm');
  const seconds = format(now, 'ss');
  const dateStr = format(now, 'EEEE, MMMM d');

  return (
    <div className={`tile clock-tile ${focused ? 'focused' : ''}`}>
      <p className="title">Clock</p>
      <div className="clock-time">
        <span className="clock-hm">{hours}<span className="clock-colon">:</span>{minutes}</span>
        <span className="clock-seconds">{seconds}</span>
      </div>
      <p className="clock-date">{dateStr}</p>
      <style>{`
        .clock-tile { display: flex; flex-direction: column; justify-content: center; }
        .clock-time  { display: flex; align-items: baseline; gap: 4px; }
        .clock-hm    { font-family: 'Roboto Mono', monospace; font-size: clamp(52px, 6vw, 88px);
                       font-weight: 300; letter-spacing: -2px; line-height: 1;
                       background: linear-gradient(135deg, #fff 60%, #aaa);
                       -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .clock-colon { animation: blink 1s step-start infinite; }
        .clock-seconds { font-family: 'Roboto Mono', monospace; font-size: clamp(18px, 2vw, 28px);
                         font-weight: 300; color: var(--text-dim); align-self: flex-end;
                         margin-bottom: 8px; }
        .clock-date { font-size: 13px; font-weight: 300; letter-spacing: 0.12em;
                      color: var(--text-dim); text-transform: uppercase; margin-top: 10px; }
        @keyframes blink { 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}
