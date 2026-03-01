import { useState, useEffect, useRef } from 'react';
import { ExternalLink, RefreshCw, X, Plus } from 'lucide-react';
import { useSocket } from '../hooks/useSocket.js';

export default function RssWidget({ focused }) {
  const [items, setItems]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [showAddForm, setShowAddForm]   = useState(false);
  const [addForm, setAddForm]           = useState({ name: '', url: '' });
  const [addMsg, setAddMsg]             = useState('');
  const refreshRef                      = useRef(null);

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/rss');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // Re-fetch every 15 minutes
    refreshRef.current = setInterval(fetchItems, 15 * 60 * 1000);
    return () => clearInterval(refreshRef.current);
  }, []);

  // CEC/gamepad select on this focused tile: open the add-feed form
  useSocket('cec:select', () => {
    if (focused && !showAddForm && !selectedItem) setShowAddForm(true);
  });

  // Handle back button from remote to close modal or form
  useSocket('cec:back', () => {
    if (selectedItem) setSelectedItem(null);
    else if (showAddForm) setShowAddForm(false);
  });

  const addFeed = async () => {
    if (!addForm.name.trim() || !addForm.url.trim()) return;
    setAddMsg('Adding…');
    try {
      const res = await fetch('/api/rss/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      if (res.ok) {
        setAddMsg('Added!');
        setAddForm({ name: '', url: '' });
        setTimeout(() => { setShowAddForm(false); setAddMsg(''); }, 1200);
        fetchItems();
      } else {
        const e = await res.json();
        setAddMsg(e.error || 'Failed');
        setTimeout(() => setAddMsg(''), 2500);
      }
    } catch {
      setAddMsg('Network error');
      setTimeout(() => setAddMsg(''), 2500);
    }
  };

  if (loading) return (
    <div className={`tile ${focused ? 'focused' : ''}`}
         style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="skeleton" style={{ width: '80%', height: 20, borderRadius: 4 }} />
    </div>
  );

  return (
    <div className={`tile rss-tile ${focused ? 'focused' : ''}`}>
      <div className="rss-header">
        <p className="title">News</p>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {addMsg && <span style={{ fontSize: 10, color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{addMsg}</span>}
          <button className="rss-icon-btn" onClick={() => setShowAddForm(v => !v)} title="Add feed">
            <Plus size={13} />
          </button>
          <button className="rss-icon-btn" onClick={fetchItems} title="Refresh">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Inline add-feed form */}
      {showAddForm && (
        <div className="rss-add-form">
          <input
            className="input"
            placeholder="Feed name"
            value={addForm.name}
            onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
            style={{ flex: 1, fontSize: 12, padding: '5px 8px' }}
          />
          <input
            className="input"
            placeholder="https://..."
            value={addForm.url}
            onChange={e => setAddForm(f => ({ ...f, url: e.target.value }))}
            style={{ flex: 2, fontSize: 12, padding: '5px 8px' }}
          />
          <button className="btn primary" onClick={addFeed} style={{ fontSize: 11, padding: '5px 10px', whiteSpace: 'nowrap' }}>
            + Add
          </button>
          <button className="rss-icon-btn" onClick={() => { setShowAddForm(false); setAddForm({ name: '', url: '' }); }}>
            <X size={13} />
          </button>
        </div>
      )}

      <div className="rss-list">
        {items.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0', fontSize: 12 }}>
            No feeds configured — use + to add one
          </div>
        )}
        {items.map((item, idx) => (
          <div key={idx} className="rss-item glass">
            {item.feedName && (
              <span className="rss-feed-tag">{item.feedName}</span>
            )}
            <h3 className="rss-item-title">{item.title}</h3>
            {item.description && (
              <div
                className="rss-item-desc"
                dangerouslySetInnerHTML={{ __html: item.description.substring(0, 120) + '…' }}
              />
            )}
            <button className="details-btn" onClick={() => setSelectedItem(item)}>Read more</button>
          </div>
        ))}
      </div>

      {/* Article modal */}
      {selectedItem && (
        <div className="modal-backdrop" onClick={() => setSelectedItem(null)}>
          <div className="modal glass rss-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              {selectedItem.feedName && (
                <span className="rss-feed-tag" style={{ marginBottom: 6 }}>{selectedItem.feedName}</span>
              )}
              <h2 className="modal-title">{selectedItem.title}</h2>
              <button className="close-btn" onClick={() => setSelectedItem(null)}><X size={20} /></button>
            </div>
            <div
              className="modal-body"
              dangerouslySetInnerHTML={{ __html: selectedItem.description }}
            />
            <div className="modal-footer">
              <a href={selectedItem.link} target="_blank" rel="noopener noreferrer" className="btn primary">
                <ExternalLink size={14} style={{ marginRight: 6 }} /> Read original
              </a>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .rss-tile { display: flex; flex-direction: column; height: 100%; overflow: hidden; gap: 0; }
        .rss-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .rss-icon-btn { background: none; border: none; color: var(--text-dim); cursor: pointer;
                        padding: 4px; border-radius: 4px; display: flex; align-items: center;
                        transition: color 0.2s; }
        .rss-icon-btn:hover { color: var(--silver); }

        .rss-add-form { display: flex; gap: 6px; align-items: center; margin-bottom: 10px;
                        padding: 8px; background: var(--surface-2); border-radius: var(--radius-sm);
                        border: 1px solid var(--border); flex-wrap: wrap; }

        .rss-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 7px; padding-right: 4px; }
        .rss-list::-webkit-scrollbar { width: 3px; }
        .rss-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

        .rss-item { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border);
                    display: flex; flex-direction: column; gap: 5px; }
        .rss-feed-tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em;
                        color: var(--silver); font-weight: 600; }
        .rss-item-title { font-size: 13px; font-weight: 500; color: var(--text); line-height: 1.35; }
        .rss-item-desc { font-size: 11px; color: var(--text-dim); line-height: 1.5; }
        .rss-item-desc p, .rss-item-desc img { margin: 0; display: none; }
        .rss-item-desc * { font-size: inherit; }

        .details-btn { align-self: flex-start; background: none; border: 1px solid var(--border);
                       color: var(--text-muted); padding: 3px 8px; border-radius: 4px;
                       font-size: 10px; cursor: pointer; text-transform: uppercase;
                       letter-spacing: 0.05em; transition: all 0.2s; margin-top: 2px; }
        .details-btn:hover { border-color: var(--silver); color: var(--text); }

        .rss-modal { width: min(600px, 90vw); max-height: 80vh; display: flex; flex-direction: column; padding: 24px; }
        .modal-header { display: flex; flex-direction: column; margin-bottom: 16px; position: relative; }
        .modal-title { font-size: 18px; font-weight: 600; line-height: 1.3; padding-right: 32px; }
        .close-btn { position: absolute; top: 0; right: 0; background: none; border: none;
                     color: var(--text-dim); cursor: pointer; }
        .modal-body { flex: 1; overflow-y: auto; font-size: 14px; line-height: 1.7;
                      color: var(--text-light); }
        .modal-body img { max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0; }
        .modal-footer { margin-top: 20px; display: flex; justify-content: flex-end; }

        /* Mobile: cap height and scroll */
        @media (max-width: 768px) {
          .rss-tile {
            max-height: 400px;
          }
          .rss-list {
            max-height: 320px;
            flex: none;
          }
        }
      `}</style>
    </div>
  );
}
