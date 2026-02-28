/**
 * Notification scheduler — emits socket events for chore reminders and
 * calendar event alerts so the frontend can show browser notifications.
 */
import cron from 'node-cron';
import db from '../db.js';

let io = null;

export function startScheduler(socketIo) {
  io = socketIo;

  // Every hour: check for overdue chores
  cron.schedule('0 * * * *', checkOverdueChores);

  // Every minute: check for upcoming calendar events (15-min warning)
  cron.schedule('* * * * *', checkUpcomingEvents);

  // 8am daily: morning briefing
  cron.schedule('0 8 * * *', morningBriefing);

  // 10pm nightly: TV off via CEC
  cron.schedule('0 22 * * *', () => {
    io.emit('cec:cmd', { cmd: 'standby' });
  });

  // 7am: TV on
  cron.schedule('0 7 * * *', () => {
    io.emit('cec:cmd', { cmd: 'on' });
  });
}

function checkOverdueChores() {
  const today = new Date().toISOString().split('T')[0];
  const overdue = db.prepare(
    "SELECT * FROM chores WHERE done=0 AND due_date IS NOT NULL AND due_date < ?"
  ).all(today);

  if (overdue.length > 0) {
    io.emit('notification', {
      type: 'chore',
      title: 'Overdue Chores',
      body: `${overdue.length} chore${overdue.length > 1 ? 's' : ''} overdue: ${overdue.map(c => c.title).join(', ')}`,
      icon: '📋',
      urgent: true,
    });
  }
}

function checkUpcomingEvents() {
  const now = new Date();
  const in15 = new Date(now.getTime() + 15 * 60 * 1000);
  const events = db.prepare(
    "SELECT * FROM events WHERE start_time BETWEEN ? AND ?"
  ).all(now.toISOString(), in15.toISOString());

  for (const event of events) {
    io.emit('notification', {
      type: 'calendar',
      title: 'Upcoming Event',
      body: `"${event.title}" starts in 15 minutes`,
      icon: '📅',
      urgent: false,
    });
  }
}

function morningBriefing() {
  const today = new Date().toISOString().split('T')[0];
  const pendingChores = db.prepare("SELECT COUNT(*) as n FROM chores WHERE done=0").get()?.n || 0;
  const todayEvents = db.prepare("SELECT * FROM events WHERE date(start_time)=?").all(today);

  io.emit('notification', {
    type: 'briefing',
    title: 'Good Morning',
    body: `${pendingChores} chore${pendingChores !== 1 ? 's' : ''} pending. ${todayEvents.length} event${todayEvents.length !== 1 ? 's' : ''} today.`,
    icon: '🌅',
    urgent: false,
    speak: true,
  });
}
