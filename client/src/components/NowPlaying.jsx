import { useState, useEffect } from 'react';
import { useSocket } from '../hooks/useSocket.js';

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

const PlayIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M8 5V19L19 12L8 5Z" />
  </svg>
);

const PauseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M6 19H10V5H6V19ZM14 5V19H18V5H14Z" />
  </svg>
);

export default function NowPlaying({ focused }) {
  const [track, setTrack] = useState(null);

  useEffect(() => {
    fetch('/api/audio/current').then(r => r.json()).then(t => { if (t) setTrack(t); }).catch(() => {});
  }, []);

  useSocket('audio:track', setTrack);

  const command = (cmd) => fetch(`/api/audio/${cmd}`, { method: 'POST' });

  const isPlaying = track?.status === 'playing';

  return (
    <div className={`tile nowplaying-tile ${focused ? 'focused' : ''}`}>
      <p className="title">Now Playing</p>

      {track?.title ? (
        <>
          <div className="np-art-container">
            {track.art ? (
              <img src={track.art} className="np-art" alt="album art" />
            ) : (
              <div className="np-art-placeholder">
                <span style={{ fontSize: 40 }}>{track.source === 'tidal' ? '🌊' : '🎵'}</span>
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
              <PrevIcon />
            </button>
            <button className="np-btn np-play" onClick={() => command('toggle')} aria-label="Play/Pause">
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button className="np-btn" onClick={() => command('next')} aria-label="Next">
              <NextIcon />
            </button>
          </div>
        </>
      ) : (
        <div className="np-idle">
          <div style={{ fontSize: 48, marginBottom: 8 }}>♪</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Nothing playing</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Open Spotify or Tidal
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
        .np-controls { display: flex; justify-content: center; align-items: center; gap: 16px; }
        .np-btn  { background: none; border: 1px solid var(--border); border-radius: 50%;
                   width: 36px; height: 36px; color: var(--text); cursor: pointer;
                   display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .np-btn:hover { border-color: var(--cyan); color: var(--cyan); }
        .np-play  { width: 44px; height: 44px; border-color: var(--cyan); color: var(--cyan); }
        .np-idle  { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
      `}</style>
    </div>
  );
}
