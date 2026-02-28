import { useState, useEffect, useCallback } from 'react';
import { Search, X, Play, Music, SkipBack, SkipForward, Pause } from 'lucide-react';
import { useSocket } from '../hooks/useSocket.js';
import CecKeyboard from './CecKeyboard.jsx';

const PrevIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M19 20L9 12L19 4V20ZM5 19H7V5H5V19Z" />
  </svg>
);

const NextIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M5 4L15 12L5 20V4ZM17 5H19V19H17V5Z" />
  </svg>
);

export default function NowPlaying({ focused }) {
  const [track, setTrack] = useState(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [resultIdx, setResultIdx] = useState(0);

  useEffect(() => {
    fetch('/api/audio/current').then(r => r.json()).then(t => { if (t) setTrack(t); }).catch(() => {});
  }, []);

  useSocket('audio:track', setTrack);

  // CEC: OK on focused tile — open keyboard or play highlighted result
  useSocket('cec:select', () => {
    if (!focused) return;
    if (showSearch && !showKeyboard && searchResults.length) {
      playTrack(searchResults[resultIdx].uri);
    } else if (!showSearch && !showKeyboard) {
      setShowKeyboard(true);
    }
  });

  // CEC: navigate search results while keyboard is closed
  useSocket('cec:up',   () => { if (focused && showSearch && !showKeyboard && searchResults.length) setResultIdx(i => Math.max(0, i - 1)); });
  useSocket('cec:down', () => { if (focused && showSearch && !showKeyboard && searchResults.length) setResultIdx(i => Math.min(searchResults.length - 1, i + 1)); });

  const command = (cmd) => fetch(`/api/audio/${cmd}`, { method: 'POST' });

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) return;
    const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setSearchResults(data);
    setResultIdx(0);
  }, []);

  const playTrack = async (uri) => {
    await fetch('/api/spotify/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri }),
    });
    setShowSearch(false);
    setSearch('');
    setSearchResults([]);
    setResultIdx(0);
  };

  const isPlaying = track?.status === 'playing';

  return (
    <div className={`tile nowplaying-tile ${focused ? 'focused' : ''}`}>
      <CecKeyboard
        visible={showKeyboard}
        placeholder="Search Spotify…"
        onSubmit={(q) => { setShowKeyboard(false); setShowSearch(true); setSearch(q); doSearch(q); }}
        onClose={() => setShowKeyboard(false)}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p className="title" style={{ margin: 0 }}>Now Playing</p>
        <button onClick={() => setShowSearch(!showSearch)}
          style={{ background: 'none', border: 'none', padding: '6px', color: 'var(--text-dim)',
                   cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--silver-light)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}>
          {showSearch ? <X size={16} /> : <Search size={16} />}
        </button>
      </div>

      {showSearch ? (
        <div className="np-search-container">
          <input
            className="input"
            autoFocus
            placeholder="Search Spotify..."
            value={search}
            onChange={e => { setSearch(e.target.value); doSearch(e.target.value); }}
          />
          <div className="np-search-results">
            {searchResults.map((t, i) => (
              <div key={t.id} className={`glass np-search-item${i === resultIdx && focused ? ' cec-active' : ''}`} onClick={() => playTrack(t.uri)}>
                <img src={t.album.images[2]?.url} alt="art" style={{ width: 32, height: 32, borderRadius: 4 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t.artists[0].name}</div>
                </div>
                <Play size={12} fill="currentColor" />
              </div>
            ))}
          </div>
        </div>
      ) : track?.title ? (
        <>
          <div className="np-art-container">
            {track.art ? (
              <img src={track.art} className="np-art" alt="album art" />
            ) : (
              <div className="np-art-placeholder">
                <Music size={40} style={{ color: 'var(--text-muted)' }} />
              </div>
            )}
            <div className="np-art-reflection" />
          </div>

          <div className="np-info">
            <div className="np-title">{track.title}</div>
            <div className="np-artist">{track.artist}</div>
            <div className="np-album">{track.album}</div>
          </div>

          <div className="np-controls">
            <button className="np-btn" onClick={() => command('prev')} aria-label="Previous">
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button className="np-btn np-play" onClick={() => command('toggle')} aria-label="Play/Pause">
              {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            </button>
            <button className="np-btn" onClick={() => command('next')} aria-label="Next">
              <SkipForward size={18} fill="currentColor" />
            </button>
          </div>
        </>
      ) : (
        <div className="np-idle">
          <div style={{ marginBottom: 12 }}><Music size={48} style={{ color: 'var(--text-muted)' }} /></div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Nothing playing</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Connect via Spotify or Tidal
          </div>
        </div>
      )}

      <style>{`
        .nowplaying-tile { display: flex; flex-direction: column; gap: 12px; }
        .np-art-container { position: relative; width: 100%; aspect-ratio: 1/1; max-height: 160px; }
        .np-art  { width: 100%; height: 100%; object-fit: cover; border-radius: 12px; display: block; }
        .np-art-placeholder { width: 100%; height: 100%; border-radius: 12px; background: var(--surface-2);
                               display: flex; align-items: center; justify-content: center; }
        .np-art-reflection { position: absolute; bottom: -20px; left: 0; right: 0; height: 40px;
                              background: inherit; transform: scaleY(-1) translateY(-20px);
                              mask-image: linear-gradient(to bottom, rgba(0,0,0,0.3), transparent);
                              -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.3), transparent);
                              pointer-events: none; border-radius: 12px; }
        .np-info  { flex: 1; overflow: hidden; }
        .np-title  { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .np-artist { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
        .np-album  { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
        .np-controls { display: flex; justify-content: center; align-items: center; gap: 12px; }
        .np-btn  { background: none; border: 1px solid var(--border); border-radius: 50%;
                   width: 38px; height: 38px; color: var(--text); cursor: pointer;
                   display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .np-btn:hover { border-color: var(--silver); color: var(--silver-light); }
        .np-play  { width: 46px; height: 46px; border-color: var(--silver); color: var(--silver-light); }
        .np-idle  { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .np-search-container { flex: 1; display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
        .np-search-results { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
        .np-search-item { display: flex; align-items: center; gap: 10px; padding: 6px 10px; cursor: pointer; transition: all 0.2s; border-radius: 8px; }
        .np-search-item:hover { background: var(--surface-2); border-color: var(--silver); }
        .np-search-item.cec-active { background: var(--surface-2); border-color: var(--silver-light); }
      `}</style>
    </div>
  );
}
