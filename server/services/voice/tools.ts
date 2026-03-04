// ─── Agent Tool Implementations ───────────────────────────────────────────────
// Tools in OpenAI function-calling format, with __execute attached for the loop.

import type { AgentTool } from './types.js';
import type Database from 'better-sqlite3';

type Db = InstanceType<typeof Database>;

function makeTool(
  name: string,
  description: string,
  parameters: object,
  execute: (args: any) => Promise<string> | string,
): AgentTool & { __execute: (args: any) => Promise<string> | string } {
  return {
    type: 'function',
    function: { name, description, parameters },
    __execute: execute,
  };
}

export function buildTools(db: Db) {
  const tools = [

    // ── Chores ──────────────────────────────────────────────────────────────

    makeTool('get_chores', 'Get the list of chores', {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['all', 'done', 'pending'], description: 'Filter by status' },
      },
      required: [],
    }, ({ filter = 'all' } = {}) => {
      let rows: any[];
      if (filter === 'done')    rows = db.prepare('SELECT * FROM chores WHERE done=1 ORDER BY created_at DESC LIMIT 20').all();
      else if (filter === 'pending') rows = db.prepare('SELECT * FROM chores WHERE done=0 ORDER BY due_date ASC LIMIT 20').all();
      else rows = db.prepare('SELECT * FROM chores ORDER BY done ASC, due_date ASC LIMIT 30').all();
      if (!rows.length) return 'No chores found.';
      return rows.map(r => `[${r.done ? '✓' : ' '}] ${r.title}${r.assignee ? ` (${r.assignee})` : ''}${r.due_date ? ` — due ${r.due_date}` : ''}`).join('\n');
    }),

    makeTool('add_chore', 'Add a new chore', {
      type: 'object',
      properties: {
        title:    { type: 'string', description: 'Chore description' },
        assignee: { type: 'string', description: 'Who it is assigned to' },
        due_date: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
      },
      required: ['title'],
    }, ({ title, assignee = '', due_date = null } = {}) => {
      db.prepare('INSERT INTO chores (title, assignee, due_date) VALUES (?, ?, ?)').run(title, assignee, due_date);
      return `Chore "${title}" added.`;
    }),

    makeTool('complete_chore', 'Mark a chore as done', {
      type: 'object',
      properties: {
        id:    { type: 'number', description: 'Chore ID' },
        title: { type: 'string', description: 'Partial title to search for' },
      },
      required: [],
    }, ({ id, title } = {}) => {
      if (id) {
        db.prepare('UPDATE chores SET done=1 WHERE id=?').run(id);
        return `Chore #${id} marked done.`;
      }
      if (title) {
        const row: any = db.prepare("SELECT id FROM chores WHERE title LIKE ? AND done=0 LIMIT 1").get(`%${title}%`);
        if (!row) return `No pending chore matching "${title}" found.`;
        db.prepare('UPDATE chores SET done=1 WHERE id=?').run(row.id);
        return `Chore "${title}" marked done.`;
      }
      return 'Please provide id or title.';
    }),

    makeTool('delete_chore', 'Delete a chore', {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Chore ID to delete' },
      },
      required: ['id'],
    }, ({ id } = {}) => {
      db.prepare('DELETE FROM chores WHERE id=?').run(id);
      return `Chore #${id} deleted.`;
    }),

    // ── Weather ──────────────────────────────────────────────────────────────

    makeTool('get_weather', 'Get current weather and forecast', {
      type: 'object',
      properties: {},
      required: [],
    }, async () => {
      try {
        const resp = await fetch('http://localhost:3001/api/weather');
        if (!resp.ok) return 'Weather unavailable.';
        const data: any = await resp.json();
        const cur = data.current;
        if (!cur) return 'Weather data unavailable.';
        const parts: string[] = [`${data.city ?? 'Current location'}: ${cur.temperature}°C, ${cur.condition}`];
        if (cur.windspeed)   parts.push(`Wind: ${cur.windspeed} km/h`);
        if (data.forecast?.length) {
          const f = data.forecast[0];
          parts.push(`Tomorrow: high ${f.high}°C, low ${f.low}°C`);
        }
        return parts.join('. ');
      } catch {
        return 'Could not fetch weather.';
      }
    }),

    // ── Calendar ─────────────────────────────────────────────────────────────

    makeTool('get_calendar', 'Get upcoming calendar events', {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many days ahead to look (default 7)' },
      },
      required: [],
    }, ({ days = 7 } = {}) => {
      const now  = new Date().toISOString();
      const end  = new Date(Date.now() + days * 86400000).toISOString();
      const rows: any[] = db.prepare(
        'SELECT title, start_time, end_time, all_day FROM events WHERE start_time >= ? AND start_time <= ? ORDER BY start_time ASC LIMIT 10'
      ).all(now, end);
      if (!rows.length) return `No events in the next ${days} days.`;
      return rows.map(r => {
        const start = new Date(r.start_time);
        const label = r.all_day
          ? start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          : start.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        return `${label}: ${r.title}`;
      }).join('\n');
    }),

    // ── Audio ────────────────────────────────────────────────────────────────

    makeTool('control_audio', 'Control music playback (play, pause, next, previous)', {
      type: 'object',
      properties: {
        command: { type: 'string', enum: ['play', 'pause', 'toggle', 'next', 'previous', 'stop'], description: 'Playback command' },
      },
      required: ['command'],
    }, async ({ command } = {}) => {
      try {
        const resp = await fetch(`http://localhost:3001/api/audio/${command}`, { method: 'POST' });
        if (!resp.ok) return `Audio command failed.`;
        return `${command.charAt(0).toUpperCase() + command.slice(1)} executed.`;
      } catch {
        return 'Could not control audio.';
      }
    }),

  ];

  return tools;
}
