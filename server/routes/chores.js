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
  const { title, assignee = '', due_date = null, priority = 'medium' } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  
  try {
    const result = db.prepare('INSERT INTO chores (title, assignee, due_date, priority) VALUES (?, ?, ?, ?)').run(title.trim(), assignee, due_date, priority);
    const chore = db.prepare('SELECT * FROM chores WHERE id = ?').get(result.lastInsertRowid);
    req.io.emit('chore:added', chore);
    res.json(chore);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// Bulk/Advanced updates for agent control
router.post('/batch', (req, res) => {
  const { action, ids, payload } = req.body;
  if (!ids?.length) return res.status(400).json({ error: 'No IDs' });

  if (action === 'delete') {
    const stmt = db.prepare('DELETE FROM chores WHERE id = ?');
    ids.forEach(id => stmt.run(id));
    ids.forEach(id => req.io.emit('chore:deleted', { id: parseInt(id) }));
    return res.json({ ok: true });
  }

  if (action === 'complete') {
    const stmt = db.prepare('UPDATE chores SET done = 1 WHERE id = ?');
    ids.forEach(id => stmt.run(id));
    ids.forEach(id => {
      const updated = db.prepare('SELECT * FROM chores WHERE id = ?').get(id);
      req.io.emit('chore:updated', updated);
    });
    return res.json({ ok: true });
  }

  res.status(400).json({ error: 'Unknown action' });
});

export default router;
