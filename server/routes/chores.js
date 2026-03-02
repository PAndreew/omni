import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  console.log('[CHORES] GET chores');
  const chores = db.prepare(`
    SELECT * FROM chores 
    ORDER BY 
      done ASC, 
      CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, 
      due_date ASC, 
      created_at DESC
  `).all();
  res.json(chores);
});

router.post('/', (req, res) => {
  console.log('[CHORES] POST request body:', JSON.stringify(req.body));
  const { title, assignee = '', due_date = null, priority = 'medium', repeat_interval = null } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  
  try {
    const result = db.prepare('INSERT INTO chores (title, assignee, due_date, priority, repeat_interval) VALUES (?, ?, ?, ?, ?)').run(title.trim(), assignee, due_date, priority, repeat_interval);
    const chore = db.prepare('SELECT * FROM chores WHERE id = ?').get(result.lastInsertRowid);
    req.io.emit('chore:added', chore);
    res.json(chore);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getNextDueDate(currentDueDate, interval) {
  if (!currentDueDate || !interval) return null;
  const date = new Date(currentDueDate);
  if (isNaN(date.getTime())) return null;

  if (interval === 'daily') {
    date.setDate(date.getDate() + 1);
  } else if (interval === 'weekly') {
    date.setDate(date.getDate() + 7);
  } else if (interval === 'monthly') {
    date.setMonth(date.getMonth() + 1);
  } else {
    return null;
  }
  return date.toISOString().split('T')[0];
}

router.patch('/:id/toggle', (req, res) => {
  const chore = db.prepare('SELECT * FROM chores WHERE id = ?').get(req.params.id);
  if (!chore) return res.status(404).json({ error: 'Not found' });
  
  const newDone = chore.done ? 0 : 1;
  
  if (newDone === 1 && chore.repeat_interval) {
    const nextDue = getNextDueDate(chore.due_date || new Date().toISOString().split('T')[0], chore.repeat_interval);
    if (nextDue) {
      // For repeating chores, we just update the due date and keep it as not done
      // OR we could mark this one done and create a new one. 
      // The user requirement "create repeating scheduled chores" might imply they want to see it done then a new one appears.
      // But resetting the date is often smoother for a dashboard.
      // Let's go with updating the date and keep it 'not done' so it stays in the list as the "next" task.
      db.prepare('UPDATE chores SET due_date = ?, done = 0 WHERE id = ?').run(nextDue, chore.id);
    } else {
      db.prepare('UPDATE chores SET done = ? WHERE id = ?').run(newDone, chore.id);
    }
  } else {
    db.prepare('UPDATE chores SET done = ? WHERE id = ?').run(newDone, chore.id);
  }

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
