import { Router } from 'express';
import db from '../db.js';

const router = Router();

const DEFAULT_LAYOUT = [
  { id: 'clock',      x: 0, y: 0, w: 4, h: 3 },
  { id: 'weather',    x: 4, y: 0, w: 5, h: 3 },
  { id: 'nowplaying', x: 9, y: 0, w: 3, h: 3 },
  { id: 'chores',     x: 0, y: 3, w: 6, h: 5 },
  { id: 'calendar',   x: 6, y: 3, w: 6, h: 5 },
  { id: 'voice',      x: 0, y: 8, w: 12, h: 2 },
];

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM layout').all();
  if (rows.length === 0) return res.json(DEFAULT_LAYOUT);
  res.json(rows);
});

router.put('/', (req, res) => {
  const items = req.body;
  const stmt = db.prepare('INSERT OR REPLACE INTO layout (id, x, y, w, h) VALUES (?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (const item of items) stmt.run(item.id, item.x, item.y, item.w, item.h);
  });
  tx();
  req.io.emit('layout:updated', items);
  res.json({ ok: true });
});

export default router;
