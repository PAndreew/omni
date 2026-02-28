import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday, parseISO } from 'date-fns';
import { useSocket } from '../hooks/useSocket.js';

export default function CalendarWidget({ focused }) {
  const [events, setEvents] = useState([]);
  const [month, setMonth] = useState(new Date());

  const loadEvents = () =>
    fetch('/api/events').then(r => r.json()).then(setEvents).catch(() => {});

  useEffect(() => { loadEvents(); }, []);

  useSocket('event:added',    (e) => setEvents(prev => [...prev, e].sort((a, b) => a.start_time.localeCompare(b.start_time))));
  useSocket('event:deleted',  ({ id }) => setEvents(prev => prev.filter(e => e.id !== id)));
  useSocket('calendar:synced', loadEvents);

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const startOffset = getDay(startOfMonth(month)); // 0=Sun

  const eventsByDay = {};
  for (const ev of events) {
    const date = ev.start_time.split('T')[0];
    if (!eventsByDay[date]) eventsByDay[date] = [];
    eventsByDay[date].push(ev);
  }

  const today = new Date();
  const todayEvents = events.filter(e => {
    try { return isSameDay(parseISO(e.start_time), today); } catch { return false; }
  });

  return (
    <div className={`tile cal-tile ${focused ? 'focused' : ''}`}>
      <div className="cal-header">
        <p className="title" style={{ margin: 0 }}>Calendar</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" style={{ padding: '4px 10px' }}
            onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1))}>‹</button>
          <span className="cal-month-label">{format(month, 'MMM yyyy')}</span>
          <button className="btn" style={{ padding: '4px 10px' }}
            onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1))}>›</button>
        </div>
      </div>

      <div className="cal-grid">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="cal-dow">{d}</div>
        ))}
        {Array.from({ length: startOffset }).map((_, i) => <div key={`e${i}`} />)}
        {days.map(day => {
          const key = format(day, 'yyyy-MM-dd');
          const dayEvents = eventsByDay[key] || [];
          return (
            <div key={key} className={`cal-day ${isToday(day) ? 'today' : ''} ${dayEvents.length ? 'has-events' : ''}`}>
              <span>{format(day, 'd')}</span>
              {dayEvents.length > 0 && (
                <div className="cal-dots">
                  {dayEvents.slice(0, 3).map((_, i) => (
                    <span key={i} className="cal-dot" style={{ background: dayEvents[i]?.color || 'var(--cyan)' }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {todayEvents.length > 0 && (
        <div className="cal-today-events">
          {todayEvents.map(ev => (
            <div key={ev.id} className="glass cal-event">
              <span className="cal-event-dot" style={{ background: ev.color || 'var(--cyan)' }} />
              <span className="cal-event-title">{ev.title}</span>
              <span className="cal-event-time">
                {ev.start_time.includes('T') ? format(parseISO(ev.start_time), 'h:mm a') : 'All day'}
              </span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .cal-tile { display: flex; flex-direction: column; gap: 12px; }
        .cal-header { display: flex; justify-content: space-between; align-items: center; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
        .cal-dow  { text-align: center; font-size: 11px; letter-spacing: 0.08em; color: var(--text-dim);
                    text-transform: uppercase; padding: 4px 0; }
        .cal-day  { aspect-ratio: 1; display: flex; flex-direction: column; align-items: center;
                    justify-content: center; border-radius: 6px; font-size: 13px;
                    font-family: 'Roboto Mono', monospace; cursor: default; position: relative;
                    color: var(--text-dim); transition: background 0.15s; }
        .cal-day.today { background: rgba(0,212,255,0.12); color: var(--cyan); font-weight: 700; }
        .cal-day.has-events { color: var(--text); }
        .cal-dots { display: flex; gap: 2px; margin-top: 2px; }
        .cal-dot  { width: 4px; height: 4px; border-radius: 50%; }
        .cal-today-events { display: flex; flex-direction: column; gap: 4px; }
        .cal-event { display: flex; align-items: center; gap: 8px; padding: 8px 10px; }
        .cal-event-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .cal-event-title { font-size: 13px; }
        .cal-event-time  { font-size: 12px; color: var(--text-dim); margin-left: auto; }
        .cal-month-label { font-size: 14px; font-weight: 600; }
        @media (max-width: 768px) {
          .cal-dow  { font-size: 12px; }
          .cal-day  { font-size: 15px; }
          .cal-dot  { width: 5px; height: 5px; }
          .cal-event-title { font-size: 14px; }
          .cal-event-time  { font-size: 13px; }
          .cal-month-label { font-size: 16px; }
        }
      `}</style>
    </div>
  );
}
