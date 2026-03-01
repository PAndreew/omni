import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, Play, Music, SkipBack, SkipForward, Pause, Disc3 } from 'lucide-react';
import { useSocket } from '../hooks/useSocket.js';
import CecKeyboard from './CecKeyboard.jsx';
import DiscoMode from './DiscoMode.jsx';

function formatTime(ms) {
  if (!ms || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function NowPlaying({ focused }) {
  const [track, setTrack]               = useState(null);
  const [search, setSearch]             = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch]     = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [resultIdx, setResultIdx]       = useState(0);
  const [discoMode, setDiscoMode]       = useState(false);
  const [currentPos, setCurrentPos]     = useState(0);
  const intervalRef                     = useRef(null);

  useEffect(() => {
    fetch('/api/audio/current').then(r => r.json()).then(t => { if (t) { setTrack(t); setCurrentPos(t.position ?? 0); } }).catch(() => {});
  }, []);

  useSocket('audio:track', (t) => {
    setTrack(t);
    setCurrentPos(t?.position ?? 0);
  });

  // Local tick — advances position every second while playing
  useEffect(() => {
    clearInterval(intervalRef.current);
    if (track?.status === 'playing' && track.duration > 0) {
      intervalRef.current = setInterval(() => {
        setCurrentPos(p => Math.min(p + 1000, track.duration));
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [track?.status, track?.duration]);

  useSocket('cec:select', () => {
    if (!focused) return;
    if (showSearch && !showKeyboard && searchResults.length) playTrack(searchResults[resultIdx].uri);
    else if (!showSearch && !showKeyboard) setShowKeyboard(true);
  });

  useSocket('cec:up',   () => { if (focused && showSearch && !showKeyboard && searchResults.length) setResultIdx(i => Math.max(0, i - 1)); });
  useSocket('cec:down', () => { if (focused && showSearch && !showKeyboard && searchResults.length) setResultIdx(i => Math.min(searchResults.length - 1, i + 1)); });

  const command = (cmd) => fetch(`/api/audio/${cmd}`, { method: 'POST' });

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) return;
    const res  = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}`);
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
    setShowSearch(false); setSearch(''); setSearchResults([]); setResultIdx(0);
  };

  const isPlaying = track?.status === 'playing';
  const progress  = track?.duration > 0 ? (currentPos / track.duration) * 100 : 0;

  const HeaderRow = () => (
    <div className="np-header">
      <p className="title" style={{ margin: 0 }}>Now Playing</p>
      <div className="np-header-icons">
        {track?.title && (
          <button className="np-icon-btn" onClick={() => setDiscoMode(true)} title="Disco mode">
            <Disc3 size={16} />
          </button>
        )}
        <button className="np-icon-btn" onClick={() => setShowSearch(!showSearch)}>
          {showSearch ? <X size={16} /> : <Search size={16} />}
        </button>
      </div>
    </div>
  );

  const Controls = () => (
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
  );

  const ProgressBar = () => (
    <div className="np-progress-row">
      <span className="np-time">{formatTime(currentPos)}</span>
      <div className="np-progress-track">
        <div className="np-progress-fill" style={{ width: `${progress}%` }} />
        <div className="np-progress-thumb" style={{ left: `${progress}%` }} />
      </div>
      <span className="np-time">{formatTime(track?.duration)}</span>
    </div>
  );

  // Compact layout used for both mobile and narrow desktop columns
  const CompactLayout = () => (
    <div className="np-compact">
      {/* Row: art + info + controls */}
      <div className="np-compact-row">
        <div className="np-compact-art">
          {track.art
            ? <img src={track.art} className="np-art" alt="album art" />
            : <div className="np-art-placeholder"><Music size={24} style={{ color: 'var(--text-muted)' }} /></div>
          }
        </div>
        <div className="np-compact-mid">
          <div className="np-title np-title-compact">{track.title}</div>
          <div className="np-artist">{track.artist}</div>
        </div>
        <Controls />
      </div>
      {/* Progress */}
      {track.duration > 0 && <ProgressBar />}
    </div>
  );

  return (
    <>
    {discoMode && <DiscoMode track={track} onClose={() => setDiscoMode(false)} />}
    <div className={`tile nowplaying-tile ${focused ? 'focused' : ''}`}>
      <CecKeyboard
        visible={showKeyboard}
        placeholder="Search Spotify…"
        onSubmit={(q) => { setShowKeyboard(false); setShowSearch(true); setSearch(q); doSearch(q); }}
        onClose={() => setShowKeyboard(false)}
      />

      {showSearch ? (
        <>
          <HeaderRow />
          <div className="np-search-container">
            <input className="input" autoFocus placeholder="Search Spotify..."
              value={search} onChange={e => { setSearch(e.target.value); doSearch(e.target.value); }} />
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
        </>
      ) : track?.title ? (
        <>
          <HeaderRow />

          {/* ── Wide layout (tall art on top) ───────────────── */}
          <div className="np-wide">
            <div className="np-art-container">
              {track.art
                ? <img src={track.art} className="np-art" alt="album art" />
                : <div className="np-art-placeholder"><Music size={40} style={{ color: 'var(--text-muted)' }} /></div>
              }
            </div>
            <div className="np-info">
              <div className="np-title">{track.title}</div>
              <div className="np-artist">{track.artist}</div>
              <div className="np-album">{track.album}</div>
            </div>
            <Controls />
            {track.duration > 0 && <ProgressBar />}
          </div>

          {/* ── Compact layout (art + info + controls row) ───── */}
          <div className="np-compact-wrapper">
            <CompactLayout />
          </div>
        </>
      ) : (
        <>
          <HeaderRow />
          <div className="np-idle">
            <div style={{ marginBottom: 12 }}><Music size={48} style={{ color: 'var(--text-muted)' }} /></div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Nothing playing</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Connect via Spotify or Tidal</div>
          </div>
        </>
      )}

      <style>{`
        /* ── Shared ─────────────────────────────────────── */
        .nowplaying-tile { display: flex; flex-direction: column; gap: 12px; }
        .np-header { display: flex; justify-content: space-between; align-items: center; }
        .np-header-icons { display: flex; align-items: center; gap: 2px; }
        .np-icon-btn { background: none; border: none; padding: 6px; color: var(--text-dim);
                       cursor: pointer; display: flex; align-items: center; transition: color 0.2s; }
        .np-icon-btn:hover { color: var(--silver-light); }

        .np-art  { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; display: block; }
        .np-art-placeholder { width: 100%; height: 100%; border-radius: 8px; background: var(--surface-2);
                               display: flex; align-items: center; justify-content: center; }
        .np-info  { overflow: hidden; }
        .np-title  { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .np-artist { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
        .np-album  { font-size: 11px; color: var(--text-muted); margin-top: 1px; }

        .np-controls { display: flex; justify-content: center; align-items: center; gap: 12px; }
        .np-btn  { background: none; border: 1px solid var(--border); border-radius: 50%;
                   width: 38px; height: 38px; color: var(--text); cursor: pointer;
                   display: flex; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0; }
        .np-btn:hover { border-color: var(--silver); color: var(--silver-light); }
        .np-play  { width: 46px; height: 46px; border-color: var(--silver); color: var(--silver-light); }
        .np-idle  { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }

        /* ── Progress bar ───────────────────────────────── */
        .np-progress-row { display: flex; align-items: center; gap: 8px; }
        .np-time { font-size: 10px; color: var(--text-dim); font-variant-numeric: tabular-nums;
                   letter-spacing: 0.04em; flex-shrink: 0; min-width: 28px; }
        .np-time:last-child { text-align: right; }
        .np-progress-track { flex: 1; height: 3px; background: var(--surface-2);
                              border-radius: 2px; position: relative; }
        .np-progress-fill  { height: 100%; background: var(--silver); border-radius: 2px;
                              transition: width 0.9s linear; }
        .np-progress-thumb { position: absolute; top: 50%; transform: translate(-50%, -50%);
                              width: 8px; height: 8px; border-radius: 50%;
                              background: var(--silver-light); transition: left 0.9s linear; }

        /* ── Search ─────────────────────────────────────── */
        .np-search-container { flex: 1; display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
        .np-search-results { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
        .np-search-item { display: flex; align-items: center; gap: 10px; padding: 6px 10px;
                          cursor: pointer; transition: all 0.2s; border-radius: 8px; }
        .np-search-item:hover { background: var(--surface-2); border-color: var(--silver); }
        .np-search-item.cec-active { background: var(--surface-2); border-color: var(--silver-light); }

        /* ── Wide layout (default, tall art on top) ─────── */
        .np-wide { display: flex; flex-direction: column; gap: 12px; flex: 1; }
        .np-wide .np-art-container { position: relative; width: 100%; aspect-ratio: 1/1; max-height: 160px; }
        .np-compact-wrapper { display: none; }

        /* ── Compact layout (art + info + controls row) ─── */
        .np-compact { display: flex; flex-direction: column; gap: 10px; flex: 1; }
        .np-compact-row {
          display: flex; align-items: center; gap: 12px;
        }
        .np-compact-art {
          width: 80px; height: 80px; flex-shrink: 0;
        }
        .np-compact-mid {
          flex: 1; min-width: 0; overflow: hidden;
        }
        .np-title-compact { font-size: 13px; }
        .np-compact .np-controls { gap: 8px; }
        .np-compact .np-btn  { width: 34px; height: 34px; }
        .np-compact .np-play { width: 40px; height: 40px; }
        .np-compact .np-progress-row { padding: 0 2px; }

        /* 
         * Responsive rules:
         * - Wide layout: when the widget is in a wide column (min-width: 200px)
         * - Compact layout: when narrow (TV grid column, or mobile)
         */
        @media (max-width: 768px) {
          .np-wide { display: none; }
          .np-compact-wrapper { display: flex; flex-direction: column; flex: 1; }
        }

        /* Container query: use compact layout when widget itself is narrow */
        .grid-area-nowplaying {
          container-type: inline-size;
          container-name: nowplaying;
        }
        @container nowplaying (max-width: 220px) {
          .np-wide { display: none !important; }
          .np-compact-wrapper { display: flex !important; flex-direction: column; flex: 1; }
        }
      `}</style>
    </div>
    </>
  );
}
