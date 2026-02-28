/**
 * Calendar sync service.
 * Fetches iCal feeds (Google Calendar, Apple iCloud, any .ics URL)
 * and upserts events into the local SQLite database.
 *
 * Handles:
 *  - Recurring events (RRULE expansion, next 60 days)
 *  - All-day events (DATE values without time)
 *  - Multiple calendars with per-calendar color + owner
 *  - Graceful failure per-feed (one broken URL won't stop others)
 */

import db from '../db.js';

// Tiny iCal parser — avoids heavy deps, handles the common subset
// Google and Apple both produce clean RFC 5545 output.
function parseICS(text) {
  const events = [];
  const lines = text.replace(/\r\n /g, '').replace(/\r\n\t/g, '').split(/\r?\n/);

  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT')   { if (current) { events.push(current); current = null; } continue; }
    if (!current) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key   = line.slice(0, colon).toUpperCase();
    const value = line.slice(colon + 1);

    if (key === 'SUMMARY')              current.title    = unescapeICS(value);
    else if (key === 'UID')             current.uid      = value;
    else if (key.startsWith('DTSTART')) current.start    = parseICSDate(key, value);
    else if (key.startsWith('DTEND'))   current.end      = parseICSDate(key, value);
    else if (key.startsWith('DURATION'))current.duration = value;
    else if (key === 'RRULE')           current.rrule    = value;
    else if (key === 'STATUS')          current.status   = value;
  }
  return events;
}

function unescapeICS(s) {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseICSDate(key, value) {
  // Key may be "DTSTART;VALUE=DATE" or "DTSTART;TZID=America/New_York"
  const allDay = key.includes('VALUE=DATE') && !key.includes('DATE-TIME');
  if (allDay) {
    // YYYYMMDD → treat as local noon to avoid timezone shift issues
    const y = value.slice(0, 4), m = value.slice(4, 6), d = value.slice(6, 8);
    return { date: new Date(`${y}-${m}-${d}T12:00:00`), allDay: true };
  }
  // 20240315T140000Z or 20240315T140000
  const s = value.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/, '$1-$2-$3T$4:$5:$6$7');
  return { date: new Date(s), allDay: false };
}

// Expand a recurring event up to `limit` occurrences within [from, to]
function expandRecurring(event, from, to, limit = 50) {
  if (!event.rrule || !event.start) return [];
  const rule = Object.fromEntries(event.rrule.split(';').map(p => p.split('=')));
  const freq  = rule.FREQ;
  const count = rule.COUNT ? parseInt(rule.COUNT) : Infinity;
  const until = rule.UNTIL ? new Date(rule.UNTIL.replace(/(\d{4})(\d{2})(\d{2}).*/, '$1-$2-$3')) : null;
  const interval = parseInt(rule.INTERVAL || '1');

  const results = [];
  let cursor = new Date(event.start.date);
  let n = 0;

  const advance = (d) => {
    const next = new Date(d);
    if (freq === 'DAILY')   next.setDate(next.getDate() + interval);
    else if (freq === 'WEEKLY')  next.setDate(next.getDate() + 7 * interval);
    else if (freq === 'MONTHLY') next.setMonth(next.getMonth() + interval);
    else if (freq === 'YEARLY')  next.setFullYear(next.getFullYear() + interval);
    else next.setDate(next.getDate() + 1); // fallback
    return next;
  };

  while (cursor <= to && n < count && n < limit) {
    if (until && cursor > until) break;
    if (cursor >= from) results.push(new Date(cursor));
    cursor = advance(cursor);
    n++;
  }
  return results;
}

// ─── Main sync function ───────────────────────────────────────────────────

const SYNC_WINDOW_DAYS = 60;

export async function syncCalendar(cal) {
  const { id, url, color, owner, name } = cal;
  const now  = new Date();
  const from = new Date(now.getTime() - 7  * 86400_000); // 7 days back
  const to   = new Date(now.getTime() + SYNC_WINDOW_DAYS * 86400_000);

  let icsText;
  try {
    // Google iCal URLs use webcal:// — swap to https://
    const fetchUrl = url.replace(/^webcal:\/\//i, 'https://');
    const resp = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'OmniWall/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    icsText = await resp.text();
  } catch (err) {
    console.error(`[Calendar] Failed to fetch "${name}": ${err.message}`);
    return 0;
  }

  const rawEvents = parseICS(icsText).filter(e => e.status !== 'CANCELLED');

  // Delete previous synced events for this calendar
  db.prepare("DELETE FROM events WHERE source = ?").run(String(id));

  const insert = db.prepare(`
    INSERT OR REPLACE INTO events (uid, title, start_time, end_time, all_day, color, source, owner)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const insertTx = db.transaction(() => {
    for (const ev of rawEvents) {
      if (!ev.start || !ev.title) continue;

      const duration = ev.end
        ? (ev.end.date - ev.start.date)
        : 3600_000; // default 1h

      if (ev.rrule) {
        // Expand recurring events
        const occurrences = expandRecurring(ev, from, to);
        for (const occStart of occurrences) {
          const occEnd = new Date(occStart.getTime() + duration);
          insert.run(
            ev.uid ? `${ev.uid}_${occStart.getTime()}` : null,
            ev.title,
            occStart.toISOString(),
            occEnd.toISOString(),
            ev.start.allDay ? 1 : 0,
            color,
            String(id),
            owner,
          );
          count++;
        }
      } else {
        if (ev.start.date < from || ev.start.date > to) continue;
        insert.run(
          ev.uid || null,
          ev.title,
          ev.start.date.toISOString(),
          ev.end ? ev.end.date.toISOString() : null,
          ev.start.allDay ? 1 : 0,
          color,
          String(id),
          owner,
        );
        count++;
      }
    }
  });
  insertTx();

  db.prepare("UPDATE calendars SET last_synced = ? WHERE id = ?").run(new Date().toISOString(), id);
  console.log(`[Calendar] "${name}" synced — ${count} events`);
  return count;
}

export async function syncAll(io) {
  const cals = db.prepare("SELECT * FROM calendars WHERE enabled = 1").all();
  if (!cals.length) return;

  const results = await Promise.allSettled(cals.map(syncCalendar));
  const total = results.reduce((s, r) => s + (r.value || 0), 0);

  if (io) io.emit('calendar:synced', { total, calendars: cals.length });
  return total;
}

export function startCalendarSync(io) {
  // Sync immediately on boot, then every 15 minutes
  syncAll(io);
  setInterval(() => syncAll(io), 15 * 60_000);
}
