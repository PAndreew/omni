import { Router } from 'express';
import db from '../db.js';
import { syncCalendar, syncAll } from '../services/calendar.js';

const router = Router();

const OWNER_COLORS = ['#00d4ff', '#ff00aa', '#ffd700', '#00ff88', '#a855f7', '#f97316'];

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM calendars ORDER BY id').all());
});

router.post('/', async (req, res) => {
  const { name, url, owner = '', color } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });

  const existing = db.prepare('SELECT COUNT(*) as n FROM calendars').get();
  const autoColor = OWNER_COLORS[existing.n % OWNER_COLORS.length];

  const result = db.prepare(
    'INSERT INTO calendars (name, url, owner, color) VALUES (?, ?, ?, ?)'
  ).run(name, url, owner, color || autoColor);

  const cal = db.prepare('SELECT * FROM calendars WHERE id = ?').get(result.lastInsertRowid);

  // Kick off an immediate sync for the new calendar
  try {
    await syncCalendar(cal);
    req.io.emit('calendar:synced', { total: null, calendars: 1 });
  } catch {}

  res.json(cal);
});

router.patch('/:id', (req, res) => {
  const { name, url, owner, color, enabled } = req.body;
  const cal = db.prepare('SELECT * FROM calendars WHERE id = ?').get(req.params.id);
  if (!cal) return res.status(404).json({ error: 'Not found' });

  db.prepare('UPDATE calendars SET name=?, url=?, owner=?, color=?, enabled=? WHERE id=?').run(
    name  ?? cal.name,
    url   ?? cal.url,
    owner ?? cal.owner,
    color ?? cal.color,
    enabled !== undefined ? (enabled ? 1 : 0) : cal.enabled,
    cal.id,
  );
  res.json(db.prepare('SELECT * FROM calendars WHERE id = ?').get(cal.id));
});

router.delete('/:id', (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM events WHERE source = ?').run(id);
  db.prepare('DELETE FROM calendars WHERE id = ?').run(id);
  req.io.emit('calendar:synced', {});
  res.json({ ok: true });
});

// Force a full re-sync
router.post('/sync', async (req, res) => {
  const total = await syncAll(req.io);
  res.json({ ok: true, total });
});

export default router;
