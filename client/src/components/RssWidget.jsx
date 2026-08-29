import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';

function ageLabel(timestamp) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export default function RssWidget({ focused }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch('/api/rss')
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load headlines');
        return response.json();
      })
      .then((data) => setItems(Array.isArray(data) ? data.slice(0, 2) : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className={`tile headline-tile ${focused ? 'focused' : ''}`}>
      <header className="headline-header">
        <p className="title">Fresh reads · Last four hours</p>
        <button className="headline-refresh" onClick={load} aria-label="Refresh headlines">
          <RefreshCw size={18} />
        </button>
      </header>

      <div className="headline-grid">
        {loading && items.length === 0 && <p className="headline-state">Finding something interesting…</p>}
        {!loading && items.length === 0 && <p className="headline-state">No recent headlines right now</p>}
        {items.map((item) => (
          <a className="headline-card" href={item.link} target="_blank" rel="noopener noreferrer" key={`${item.feedName}-${item.link}`}>
            <div className="headline-meta">
              <span>{item.feedName}</span>
              <span>{ageLabel(item.pubTs)}</span>
            </div>
            <h2>{item.title}</h2>
            <ExternalLink className="headline-link-icon" size={20} aria-hidden="true" />
          </a>
        ))}
      </div>
    </div>
  );
}
