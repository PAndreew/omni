import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../hooks/useSocket.js';
import CecKeyboard from './CecKeyboard.jsx';

export default function ChoreList({ focused }) {
  const [chores, setChores] = useState([]);
  const [newChore, setNewChore] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [repeat, setRepeat] = useState('');
  const [pulsingId, setPulsingId] = useState(null);
  const [debug, setDebug] = useState('');
  const [showKeyboard, setShowKeyboard] = useState(false);

  const loadChores = useCallback(() => {
    fetch('/api/chores')
      .then(r => r.json())
      .then(setChores)
      .catch(err => console.error('[CHORES] fetch error:', err));
  }, []);

  useEffect(() => {
    loadChores();
  }, [loadChores]);

  // Remove the automatic CEC keyboard trigger on select. 
  // Let App.jsx's widget-mode handle entering/navigating/clicking.
  // useSocket('cec:select', () => { if (focused && !showKeyboard) setShowKeyboard(true); });

  useSocket('chore:added',   (c) => setChores(prev => prev.some(x => x.id === c.id) ? prev : [c, ...prev]));
  useSocket('chore:updated', (c) => {
    setChores(prev => {
      const exists = prev.find(x => x.id === c.id);
      if (exists) {
        return prev.map(x => x.id === c.id ? c : x);
      } else {
        return [c, ...prev];
      }
    });
  });
  useSocket('chore:deleted', ({ id }) => setChores(prev => prev.filter(x => x.id !== id)));

  const toggle = useCallback(async (id) => {
    setPulsingId(id);
    setTimeout(() => setPulsingId(null), 1000);
    try {
      await fetch(`/api/chores/${id}/toggle`, { method: 'PATCH' });
    } catch (err) {
      setDebug('Toggle failed');
    }
  }, []);

  const addChore = useCallback(async (titleArg) => {
    const title = (titleArg ?? newChore).trim();
    if (!title) { setDebug('Type a chore first'); setTimeout(() => setDebug(''), 2000); return; }
    setDebug('Adding...');
    try {
      const res = await fetch('/api/chores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title, 
          due_date: dueDate || null, 
          repeat_interval: repeat || null 
        }),
      });
      if (res.ok) {
        const added = await res.json();
        setChores(prev => prev.some(c => c.id === added.id) ? prev : [added, ...prev]);
        setDebug('Added!');
        setNewChore('');
        setDueDate('');
        setRepeat('');
        setTimeout(() => setDebug(''), 2000);
      } else {
        setDebug('Failed to add');
      }
    } catch (err) {
      setDebug('Network error');
      console.error('[CHORES] add error:', err);
    }
  }, [newChore, dueDate, repeat]);

  const deleteChore = useCallback(async (e, id) => {
    e.stopPropagation();
    try {
      await fetch(`/api/chores/${id}`, { method: 'DELETE' });
    } catch (err) {
      setDebug('Delete failed');
    }
  }, []);

  const sortChores = (list) => {
    return [...list].sort((a, b) => {
      if (a.done !== b.done) return a.done - b.done;
      if (a.due_date && b.due_date) {
        if (a.due_date < b.due_date) return -1;
        if (a.due_date > b.due_date) return 1;
      }
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  };

  const sorted = sortChores(chores);
  const pending = sorted.filter(c => !c.done);
  const done = sorted.filter(c => c.done);

  return (
    <div className={`tile chore-tile ${focused ? 'focused' : ''}`}>
      <CecKeyboard
        visible={showKeyboard}
        placeholder="Add a chore…"
        onSubmit={(text) => { setShowKeyboard(false); addChore(text); }}
        onClose={() => setShowKeyboard(false)}
      />
      <div className="chore-header tile-header">
        <p className="title">Chores <span style={{ color: 'var(--silver-light)', fontVariantNumeric: 'tabular-nums' }}>{pending.length}</span></p>
        {debug && <span className="chore-status">{debug}</span>}
      </div>

      <div className="chore-list">
        {pending.map(c => (
          <ChoreItem key={c.id} chore={c} onToggle={toggle} onDelete={deleteChore} pulsing={pulsingId === c.id} />
        ))}
        {done.map(c => (
          <ChoreItem key={c.id} chore={c} onToggle={toggle} onDelete={deleteChore} done />
        ))}
        {chores.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0', fontSize: 13 }}>
            All clear ✓
          </div>
        )}
      </div>

      <form className="chore-add" onSubmit={e => { e.preventDefault(); addChore(); }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%' }}>
          <input
            className="input"
            style={{ flex: '1 1 200px' }}
            placeholder="Add chore..."
            value={newChore}
            onChange={e => setNewChore(e.target.value)}
          />
          <input
            type="date"
            className="input"
            style={{ flex: '0 0 130px', fontSize: '12px' }}
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
          />
          <select
            className="input"
            style={{ flex: '0 0 100px', fontSize: '12px' }}
            value={repeat}
            onChange={e => setRepeat(e.target.value)}
          >
            <option value="">Once</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <button type="submit" className="btn primary" style={{ whiteSpace: 'nowrap' }}>+ Add</button>
        </div>
      </form>

      <style>{`
        .chore-tile { display: flex; flex-direction: column; gap: 12px; pointer-events: auto; }
        .chore-status { font-size: 11px; color: var(--silver); text-transform: uppercase; letter-spacing: 0.05em; }
        .chore-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
        .chore-add  { display: flex; gap: 8px; position: relative; z-index: 10; border-top: 1px solid var(--border); padding-top: 12px; }
        .chore-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px;
                      border-radius: var(--radius-sm); cursor: pointer;
                      background: var(--surface-2); border: 1px solid var(--border);
                      transition: all 0.2s; user-select: none; }
        .chore-item:hover { border-color: #333; }
        .chore-item:hover .chore-delete, .chore-item:focus-within .chore-delete { opacity: 1; }
        .chore-item.done  { opacity: 0.35; }
        .chore-item.pulsing { animation: chromatic-pulse 0.8s ease; }
        .chore-check { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--border);
                       display: flex; align-items: center; justify-content: center; flex-shrink: 0;
                       transition: all 0.2s; }
        .chore-item.done .chore-check { background: var(--green); border-color: var(--green); }
        .chore-item.done .chore-check::after { content: '✓'; font-size: 10px; color: #000; font-weight: 700; }
        .chore-text { font-size: 16px; font-weight: 300; flex: 1; }
        .chore-details { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
        .chore-due { font-size: 10px; color: var(--silver); }
        .chore-repeat { font-size: 9px; color: var(--blue-light); text-transform: uppercase; }
        .chore-item.done .chore-text { text-decoration: line-through; }
        .chore-delete { background: none; border: none; color: var(--text-muted); cursor: pointer;
                        font-size: 16px; padding: 4px; opacity: 0; transition: opacity 0.2s; }
        .chore-delete:hover { color: var(--silver-light); }
        @media (max-width: 768px) { .chore-delete { opacity: 0.5; } }
      `}</style>
    </div>
  );
}

function ChoreItem({ chore, onToggle, onDelete, done, pulsing }) {
  const isOverdue = !done && chore.due_date && new Date(chore.due_date) < new Date(new Date().setHours(0,0,0,0));
  
  return (
    <div className={`chore-item ${done ? 'done' : ''} ${pulsing ? 'pulsing' : ''}`}
         tabIndex={0}
         onClick={() => onToggle(chore.id)}
         onKeyDown={e => e.key === 'Enter' && onToggle(chore.id)}>
      <div className="chore-check" />
      <span className="chore-text">{chore.title}</span>
      <div className="chore-details">
        {chore.due_date && (
          <span className="chore-due" style={{ color: isOverdue ? 'var(--red)' : 'inherit' }}>
            {chore.due_date}
          </span>
        )}
        {chore.repeat_interval && (
          <span className="chore-repeat">
            {chore.repeat_interval}
          </span>
        )}
        {chore.assignee && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{chore.assignee}</span>}
      </div>
      <button className="chore-delete" onClick={(e) => onDelete(e, chore.id)}>✕</button>
    </div>
  );
}
