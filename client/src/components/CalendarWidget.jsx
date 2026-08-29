import { useCallback, useEffect, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { useSocket } from '../hooks/useSocket.js';

function dateKey(date) {
  return format(date, 'yyyy-MM-dd');
}

function eventTime(event) {
  if (event.all_day || !event.start_time.includes('T')) return 'All day';
  return format(parseISO(event.start_time), 'HH:mm');
}

export default function CalendarWidget({ focused }) {
  const [events, setEvents] = useState([]);
  const [chores, setChores] = useState([]);

  const loadAgenda = useCallback(() => {
    Promise.all([
      fetch('/api/events').then((response) => response.json()),
      fetch('/api/chores').then((response) => response.json()),
    ]).then(([nextEvents, nextChores]) => {
      setEvents(Array.isArray(nextEvents) ? nextEvents : []);
      setChores(Array.isArray(nextChores) ? nextChores : []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadAgenda();
  }, [loadAgenda]);

  useSocket('event:added', loadAgenda);
  useSocket('event:deleted', loadAgenda);
  useSocket('calendar:synced', loadAgenda);
  useSocket('chore:added', loadAgenda);
  useSocket('chore:updated', loadAgenda);
  useSocket('chore:deleted', loadAgenda);

  const today = new Date();
  const days = [today, addDays(today, 1)];

  return (
    <div className={`tile agenda-tile ${focused ? 'focused' : ''}`}>
      <p className="title">Today & tomorrow</p>
      <div className="agenda-columns">
        {days.map((day, index) => {
          const key = dateKey(day);
          const dayEvents = events.filter((event) => event.start_time.slice(0, 10) === key);
          const dayChores = chores.filter((chore) => !chore.done && (
            chore.due_date === key || (index === 0 && !chore.due_date)
          ));

          return (
            <section className={`agenda-day ${index === 0 ? 'today' : ''}`} key={key}>
              <header className="agenda-day-header">
                <div>
                  <p className="agenda-day-name">{index === 0 ? 'Today' : 'Tomorrow'}</p>
                  <p className="agenda-date">{format(day, 'EEEE, MMMM d')}</p>
                </div>
                {dayChores.length > 0 && (
                  <span className="agenda-chore-indicator" title={`${dayChores.length} todos`}>
                    <span className="agenda-green-dot" />
                    {dayChores.length}
                  </span>
                )}
              </header>

              <div className="agenda-list">
                {dayEvents.map((event) => (
                  <div className="agenda-entry" key={`event-${event.id}`}>
                    <span className="agenda-event-dot" style={{ background: event.color || 'var(--silver)' }} />
                    <span className="agenda-entry-title">{event.title}</span>
                    <time>{eventTime(event)}</time>
                  </div>
                ))}
                {dayChores.map((chore) => (
                  <div className="agenda-entry agenda-chore" key={`chore-${chore.id}`}>
                    <span className="agenda-green-dot" />
                    <span className="agenda-entry-title">{chore.title}</span>
                    <span className="agenda-entry-kind">Todo</span>
                  </div>
                ))}
                {dayEvents.length === 0 && dayChores.length === 0 && (
                  <p className="agenda-empty">Nothing scheduled</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
