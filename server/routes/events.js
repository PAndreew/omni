import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const events = db.prepare('SELECT * FROM events ORDER BY start_time ASC').all();
  res.json(events);
});

router.post('/', (req, res) => {
  const { title, start_time, end_time, color } = req.body;
  if (!title || !start_time) return res.status(400).json({ error: 'title and start_time required' });
  const result = db.prepare('INSERT INTO events (title, start_time, end_time, color) VALUES (?, ?, ?, ?)').run(title, start_time, end_time || null, color || '#7C3AED');
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(result.lastInsertRowid);
  req.io.emit('event:added', event);
  res.json(event);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  req.io.emit('event:deleted', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

export default router;
