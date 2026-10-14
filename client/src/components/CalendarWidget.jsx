import { useCallback, useEffect, useState } from 'react';
import { addDays, addWeeks, format, isSameDay, parseISO, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSocket } from '../hooks/useSocket.js';
import { Card } from './ui/card.jsx';
import { Button } from './ui/button.jsx';

const dateKey = date => format(date, 'yyyy-MM-dd');
function eventTime(event) {
  if (event.all_day || !event.start_time.includes('T')) return 'All day';
  const start = format(parseISO(event.start_time), 'HH:mm');
  return event.end_time?.includes('T') ? `${start}–${format(parseISO(event.end_time), 'HH:mm')}` : start;
}

export default function CalendarWidget({ focused }) {
  const [events, setEvents] = useState([]);
  const [chores, setChores] = useState([]);
  const [now, setNow] = useState(new Date());
  const [weekOffset, setWeekOffset] = useState(0);
  const loadAgenda = useCallback(() => {
    Promise.all([
      fetch('/api/events').then(response => response.json()),
      fetch('/api/chores').then(response => response.json()),
    ]).then(([nextEvents, nextChores]) => {
      setEvents(Array.isArray(nextEvents) ? nextEvents : []);
      setChores(Array.isArray(nextChores) ? nextChores : []);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    loadAgenda();
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [loadAgenda]);
  useSocket('event:added', loadAgenda);
  useSocket('event:deleted', loadAgenda);
  useSocket('calendar:synced', loadAgenda);
  useSocket('chore:added', loadAgenda);
  useSocket('chore:updated', loadAgenda);
  useSocket('chore:deleted', loadAgenda);

  const weekStart = startOfWeek(addWeeks(now, weekOffset), { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const key = dateKey(now);
  const dayEvents = events.filter(event => event.start_time.slice(0, 10) === key)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const dayChores = chores.filter(chore => !chore.done && (chore.due_date === key || !chore.due_date));

  return <Card className={`tile agenda-tile ${focused ? 'focused' : ''}`}>
    <h2 className="title">Calendar</h2>
    <header className="week-heading">
      <h3>{format(weekStart, 'MMMM yyyy')}</h3>
      <div className="week-navigation">
        <Button variant="ghost" size="icon" type="button" aria-label="Previous week" onClick={() => setWeekOffset(value => value - 1)}><ChevronLeft size={20} /></Button>
        <Button variant="ghost" type="button" aria-label="Return to current week" onClick={() => setWeekOffset(0)}>{format(weekStart, 'MMM d')} – {format(days[6], 'MMM d')}</Button>
        <Button variant="ghost" size="icon" type="button" aria-label="Next week" onClick={() => setWeekOffset(value => value + 1)}><ChevronRight size={20} /></Button>
      </div>
    </header>
    <div className="week-grid" aria-label="Weekly calendar">
      {days.map(day => {
        const dayKey = dateKey(day);
        const count = events.filter(event => event.start_time.slice(0, 10) === dayKey).length;
        return <div key={dayKey} className={`week-day ${isSameDay(day, now) ? 'is-today' : ''}`} aria-label={`${format(day, 'EEEE, MMMM d')}, ${count} events`}>
          <span className="week-day-label">{format(day, 'EEEEE')}</span>
          <span className="week-day-number" aria-current={isSameDay(day, now) ? 'date' : undefined}>{format(day, 'd')}</span>
          <span className="week-dots" aria-hidden="true">{Array.from({ length: count }, (_, index) => <span className="agenda-green-dot" key={index} />)}</span>
        </div>;
      })}
    </div>
    <h3 className="agenda-today-heading">Today</h3>
    <div className="agenda-list" aria-label="Today's entries">
      {dayEvents.map(event => <div className="agenda-entry" key={`event-${event.id}`}>
        <span className="agenda-green-dot" />
        <span className="agenda-entry-title">{event.title}</span>
        <span className="agenda-entry-time">{eventTime(event)}</span>
      </div>)}
      {dayChores.map(chore => <div className="agenda-entry agenda-chore" key={`chore-${chore.id}`}>
        <span className="agenda-green-dot" />
        <span className="agenda-entry-title">{chore.title}</span>
      </div>)}
      {dayEvents.length === 0 && dayChores.length === 0 && <p className="agenda-empty">Nothing scheduled</p>}
    </div>
  </Card>;
}
