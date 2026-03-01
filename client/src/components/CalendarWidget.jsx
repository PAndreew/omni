import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday, parseISO } from 'date-fns';
import { useSocket } from '../hooks/useSocket.js';

export default function CalendarWidget({ focused }) {
  const [events, setEvents] = useState([]);
  const [month, setMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date());

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

  const selectedKey = format(selectedDay, 'yyyy-MM-dd');
  const selectedEvents = eventsByDay[selectedKey] || [];
  const isSelectedToday = isSameDay(selectedDay, new Date());

  return (
    <div className={`tile cal-tile ${focused ? 'focused' : ''}`}>
      <div className="cal-header">
        <p className="title" style={{ margin: 0 }}>Calendar</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" style={{ padding: '4px 10px' }}
            onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1))}>‹</button>
          <button className="btn" style={{ padding: '4px 8px', fontSize: 11 }}
            onClick={() => { const t = new Date(); setMonth(t); setSelectedDay(t); }}>Today</button>
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
          const isSelected = isSameDay(day, selectedDay);
          return (
            <div key={key}
              className={`cal-day ${isToday(day) ? 'today' : ''} ${dayEvents.length ? 'has-events' : ''} ${isSelected ? 'selected' : ''}`}
              onClick={() => setSelectedDay(day)}>
              <span>{format(day, 'd')}</span>
              {dayEvents.length > 0 && (
                <div className="cal-dots">
                  {dayEvents.slice(0, 3).map((_, i) => (
                    <span key={i} className="cal-dot" style={{ background: dayEvents[i]?.color || 'var(--silver)' }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="cal-today-events">
        <div className="cal-selected-label">
          {isSelectedToday ? 'Today' : format(selectedDay, 'MMM d')}
          {selectedEvents.length > 0 && <span style={{ color: 'var(--silver-light)', marginLeft: 6 }}>{selectedEvents.length}</span>}
        </div>
        {selectedEvents.length > 0 ? selectedEvents.map(ev => (
          <div key={ev.id} className="glass cal-event">
            <span className="cal-event-dot" style={{ background: ev.color || 'var(--silver)' }} />
            <span className="cal-event-title">{ev.title}</span>
            <span className="cal-event-time">
              {ev.all_day || !ev.start_time.includes('T') ? 'All day' : format(parseISO(ev.start_time), 'h:mm a')}
            </span>
          </div>
        )) : (
          <div style={{ fontSize: 14, color: 'var(--text-muted)', padding: '6px 0' }}>No events</div>
        )}
      </div>

      <style>{`
        .cal-tile { display: flex; flex-direction: column; gap: 12px; }
        .cal-header { display: flex; justify-content: space-between; align-items: center; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
        .cal-dow  { text-align: center; font-size: 13px; letter-spacing: 0.08em; color: var(--text-dim);
                    text-transform: uppercase; padding: 4px 0; }
        .cal-day  { aspect-ratio: 1; display: flex; flex-direction: column; align-items: center;
                    justify-content: center; border-radius: 0; font-size: 16px;
                    font-family: 'Satoshi', sans-serif; cursor: pointer; position: relative;
                    color: var(--text-dim); transition: background 0.15s; }
        .cal-day:hover { background: rgba(255,255,255,0.04); }
        .cal-day.today { background: rgba(176,176,176,0.07); color: var(--silver-light); font-weight: 500; }
        .cal-day.has-events { color: var(--text); }
        .cal-day.selected { background: rgba(176,176,176,0.1); outline: 1px solid var(--silver); }
        .cal-day.selected.today { background: rgba(176,176,176,0.14); outline: 1px solid var(--silver-light); }
        .cal-selected-label { font-size: 13px; font-weight: 600; letter-spacing: 0.1em;
                              text-transform: uppercase; color: var(--text-dim); margin-bottom: 4px; }
        .cal-dots { display: flex; gap: 2px; margin-top: 3px; }
        .cal-dot  { width: 5px; height: 5px; border-radius: 50%; }
        .cal-today-events { display: flex; flex-direction: column; gap: 4px; }
        .cal-event { display: flex; align-items: center; gap: 8px; padding: 8px 10px; }
        .cal-event-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .cal-event-title { font-size: 15px; }
        .cal-event-time  { font-size: 13px; color: var(--text-dim); margin-left: auto; white-space: nowrap; }
        .cal-month-label { font-size: 16px; font-weight: 600; }
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
