import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../hooks/useSocket.js';

export default function ChoreList({ focused }) {
  const [chores, setChores] = useState([]);
  const [newChore, setNewChore] = useState('');
  const [pulsingId, setPulsingId] = useState(null);

  useEffect(() => {
    fetch('/api/chores').then(r => r.json()).then(setChores).catch(() => {});
  }, []);

  useSocket('chore:added',   (c) => setChores(prev => [c, ...prev]));
  useSocket('chore:updated', (c) => setChores(prev => prev.map(x => x.id === c.id ? c : x)));
  useSocket('chore:deleted', ({ id }) => setChores(prev => prev.filter(x => x.id !== id)));

  const toggle = useCallback(async (id) => {
    setPulsingId(id);
    setTimeout(() => setPulsingId(null), 1000);
    await fetch(`/api/chores/${id}/toggle`, { method: 'PATCH' });
  }, []);

  const addChore = useCallback(async () => {
    const title = newChore.trim();
    if (!title) return;
    setNewChore('');
    await fetch('/api/chores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  }, [newChore]);

  const pending  = chores.filter(c => !c.done);
  const done     = chores.filter(c => c.done);

  return (
    <div className={`tile chore-tile ${focused ? 'focused' : ''}`}>
      <p className="title">Chores <span style={{ color: 'var(--cyan)', fontVariantNumeric: 'tabular-nums' }}>{pending.length}</span></p>

      <div className="chore-list">
        {pending.map(c => (
          <ChoreItem key={c.id} chore={c} onToggle={toggle} pulsing={pulsingId === c.id} />
        ))}
        {done.map(c => (
          <ChoreItem key={c.id} chore={c} onToggle={toggle} done />
        ))}
        {chores.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0', fontSize: 13 }}>
            All clear ✓
          </div>
        )}
      </div>

      <div className="chore-add">
        <input
          className="input"
          placeholder="Add chore..."
          value={newChore}
          onChange={e => setNewChore(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addChore()}
        />
        <button className="btn primary" onClick={addChore} style={{ whiteSpace: 'nowrap' }}>+ Add</button>
      </div>

      <style>{`
        .chore-tile { display: flex; flex-direction: column; gap: 12px; }
        .chore-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
        .chore-add  { display: flex; gap: 8px; }
        .chore-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px;
                      border-radius: var(--radius-sm); cursor: pointer;
                      background: var(--surface-2); border: 1px solid var(--border);
                      transition: all 0.2s; user-select: none; }
        .chore-item:hover { border-color: #333; }
        .chore-item.done  { opacity: 0.35; }
        .chore-item.pulsing { animation: chromatic-pulse 0.8s ease; }
        .chore-check { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--border);
                       display: flex; align-items: center; justify-content: center; flex-shrink: 0;
                       transition: all 0.2s; }
        .chore-item.done .chore-check { background: var(--green); border-color: var(--green); }
        .chore-item.done .chore-check::after { content: '✓'; font-size: 10px; color: #000; font-weight: 700; }
        .chore-text { font-size: 13px; font-weight: 300; flex: 1; }
        .chore-item.done .chore-text { text-decoration: line-through; }
      `}</style>
    </div>
  );
}

function ChoreItem({ chore, onToggle, done, pulsing }) {
  return (
    <div className={`chore-item ${done ? 'done' : ''} ${pulsing ? 'pulsing' : ''}`}
         onClick={() => onToggle(chore.id)}>
      <div className="chore-check" />
      <span className="chore-text">{chore.title}</span>
      {chore.assignee && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{chore.assignee}</span>}
    </div>
  );
}
