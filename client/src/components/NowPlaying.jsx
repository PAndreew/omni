import { useState, useEffect } from 'react';
import { useSocket } from '../hooks/useSocket.js';

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
            <button className="np-btn" onClick={() => command('prev')} aria-label="Previous">⏮</button>
            <button className="np-btn np-play" onClick={() => command('toggle')} aria-label="Play/Pause">
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button className="np-btn" onClick={() => command('next')} aria-label="Next">⏭</button>
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
        .np-controls { display: flex; justify-content: center; gap: 16px; }
        .np-btn  { background: none; border: 1px solid var(--border); border-radius: 50%;
                   width: 36px; height: 36px; color: var(--text); cursor: pointer; font-size: 14px;
                   display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .np-btn:hover { border-color: var(--cyan); color: var(--cyan); }
        .np-play  { width: 44px; height: 44px; font-size: 18px; border-color: var(--cyan); color: var(--cyan); }
        .np-idle  { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
      `}</style>
    </div>
  );
}
