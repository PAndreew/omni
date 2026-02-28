import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  console.log('[CHORES] GET chores');
  const chores = db.prepare('SELECT * FROM chores ORDER BY done ASC, created_at DESC').all();
  res.json(chores);
});

router.post('/', (req, res) => {
  console.log('[CHORES] POST request body:', JSON.stringify(req.body));
  const { title, assignee = '', due_date = null } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const result = db.prepare('INSERT INTO chores (title, assignee, due_date) VALUES (?, ?, ?)').run(title.trim(), assignee, due_date);
  const chore = db.prepare('SELECT * FROM chores WHERE id = ?').get(result.lastInsertRowid);
  req.io.emit('chore:added', chore);
  res.json(chore);
});

router.patch('/:id/toggle', (req, res) => {
  const chore = db.prepare('SELECT * FROM chores WHERE id = ?').get(req.params.id);
  if (!chore) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE chores SET done = ? WHERE id = ?').run(chore.done ? 0 : 1, chore.id);
  const updated = db.prepare('SELECT * FROM chores WHERE id = ?').get(chore.id);
  req.io.emit('chore:updated', updated);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM chores WHERE id = ?').run(req.params.id);
  req.io.emit('chore:deleted', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

export default router;
