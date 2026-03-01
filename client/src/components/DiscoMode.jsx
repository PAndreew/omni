import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// ── Canvas EQ visualizer ─────────────────────────────────────────────────────
// Simulates a frequency-spectrum visualizer. Since we have no raw audio buffer,
// each bar oscillates independently using layered sin waves to feel organic.
function EQVisualizer({ isPlaying }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const BARS = 80;
    // Per-bar parameters — randomised once
    const phases = Array.from({ length: BARS }, () => Math.random() * Math.PI * 2);
    const freq1  = Array.from({ length: BARS }, () => 0.6  + Math.random() * 1.2);
    const freq2  = Array.from({ length: BARS }, () => 0.15 + Math.random() * 0.4);
    // Amplitude envelope: bell shape peaking around 30 % (bass/low-mid)
    const envelope = Array.from({ length: BARS }, (_, i) => {
      const t = i / BARS;
      return 0.15 + 0.85 * Math.exp(-Math.pow((t - 0.28) * 3.5, 2));
    });

    const ctx = canvas.getContext('2d');
    let t = 0;

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function draw() {
      const W = canvas.width;
      const H = canvas.height;
      if (!W || !H) { rafRef.current = requestAnimationFrame(draw); return; }

      ctx.clearRect(0, 0, W, H);

      const barW  = W / BARS;
      const speed = isPlaying ? 1 : 0.08;

      for (let i = 0; i < BARS; i++) {
        // Two sin waves combined for organic movement
        const raw = (
          0.55 * (Math.sin(t * freq1[i] + phases[i]) + 1) / 2 +
          0.45 * (Math.sin(t * freq2[i] + phases[i] * 1.7) + 1) / 2
        );
        const h = raw * envelope[i] * H * (isPlaying ? 0.92 : 0.08) + (isPlaying ? 4 : 1);

        // Hue slowly rotates across the bar positions
        const hue = (i / BARS) * 260 + t * 18;

        const grad = ctx.createLinearGradient(0, H - h, 0, H);
        grad.addColorStop(0,   `hsla(${hue}, 90%, 70%, 1)`);
        grad.addColorStop(0.5, `hsla(${hue + 30}, 80%, 55%, 0.8)`);
        grad.addColorStop(1,   `hsla(${hue + 60}, 70%, 35%, 0.2)`);

        ctx.fillStyle = grad;
        ctx.fillRect(i * barW + 1, H - h, barW - 2, h);
      }

      t += 0.022 * speed;
      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}

// ── Disco overlay ─────────────────────────────────────────────────────────────
export default function DiscoMode({ track, onClose }) {
  const isPlaying = track?.status === 'playing';

  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="disco-overlay" onClick={onClose}>
      {/* Blurred album art background */}
      {track?.art && (
        <div
          className="disco-bg"
          style={{ backgroundImage: `url(${track.art})` }}
        />
      )}
      <div className="disco-bg-vignette" />

      {/* Beat pulse ring behind the disc */}
      <div className={`disco-pulse-ring ${isPlaying ? 'disco-pulse-active' : ''}`} />

      {/* Main content — stop propagation so clicking it doesn't close */}
      <div className="disco-content" onClick={e => e.stopPropagation()}>
        {/* Close button */}
        <button className="disco-close" onClick={onClose} aria-label="Close disco mode">
          <X size={22} strokeWidth={1.5} />
        </button>

        {/* Spinning disc */}
        <div className={`disco-disc-wrap ${isPlaying ? 'disco-disc-spinning' : ''}`}>
          <div className="disco-disc">
            {track?.art
              ? <img src={track.art} alt="album art" className="disco-disc-img" />
              : <div className="disco-disc-img disco-disc-empty" />
            }
            {/* Vinyl grooves overlay */}
            <div className="disco-grooves" />
            <div className="disco-disc-hole" />
          </div>
        </div>

        {/* Track info */}
        <div className="disco-meta">
          <div className="disco-title">{track?.title ?? 'Nothing Playing'}</div>
          {track?.artist && <div className="disco-artist">{track.artist}</div>}
          {track?.album  && <div className="disco-album">{track.album}</div>}
        </div>
      </div>

      {/* EQ visualizer pinned to bottom */}
      <div className="disco-eq" onClick={e => e.stopPropagation()}>
        <EQVisualizer isPlaying={isPlaying} />
      </div>

      <style>{`
        .disco-overlay {
          position: fixed; inset: 0; z-index: 9000;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          background: #000;
          animation: discoIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          cursor: pointer;
        }
        @keyframes discoIn {
          from { opacity: 0; transform: scale(0.97); }
          to   { opacity: 1; transform: scale(1); }
        }

        /* Blurred album art fill */
        .disco-bg {
          position: absolute; inset: -60px; z-index: 0;
          background-size: cover; background-position: center;
          filter: blur(80px) saturate(1.6) brightness(0.22);
        }
        .disco-bg-vignette {
          position: absolute; inset: 0; z-index: 1;
          background: radial-gradient(ellipse at 50% 40%,
            rgba(0,0,0,0.1) 0%,
            rgba(0,0,0,0.7) 60%,
            rgba(0,0,0,0.95) 100%);
        }

        /* Pulsing halo behind the disc */
        .disco-pulse-ring {
          position: absolute; z-index: 2;
          width: clamp(220px, 36vmin, 360px);
          height: clamp(220px, 36vmin, 360px);
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.06);
          top: 50%; left: 50%;
          transform: translate(-50%, -58%);
          pointer-events: none;
        }
        .disco-pulse-active {
          animation: discoPulse 2s ease-in-out infinite;
        }
        @keyframes discoPulse {
          0%, 100% { box-shadow: 0 0 0   20px rgba(255,255,255,0.03),
                                 0 0 0   60px rgba(255,255,255,0.01); }
          50%       { box-shadow: 0 0 40px 20px rgba(255,255,255,0.08),
                                  0 0 80px 40px rgba(255,255,255,0.03); }
        }

        /* Content column */
        .disco-content {
          position: relative; z-index: 5;
          display: flex; flex-direction: column;
          align-items: center; gap: 28px;
          padding: 24px 24px 140px;
          width: 100%; max-width: 480px;
          cursor: default;
        }

        /* Close button */
        .disco-close {
          position: fixed; top: 20px; right: 20px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          color: rgba(255,255,255,0.65);
          cursor: pointer; border-radius: 50%;
          width: 44px; height: 44px;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s; z-index: 20;
        }
        .disco-close:hover {
          background: rgba(255,255,255,0.14);
          color: #fff;
          border-color: rgba(255,255,255,0.3);
        }

        /* Vinyl disc */
        .disco-disc-wrap {
          width: clamp(180px, 32vmin, 280px);
          height: clamp(180px, 32vmin, 280px);
          border-radius: 50%;
          flex-shrink: 0;
        }
        .disco-disc-spinning {
          animation: discSpin 7s linear infinite;
        }
        @keyframes discSpin { to { transform: rotate(360deg); } }

        .disco-disc {
          width: 100%; height: 100%;
          border-radius: 50%; overflow: hidden;
          position: relative;
          box-shadow:
            0 0 0 2px rgba(255,255,255,0.08),
            0 20px 60px rgba(0,0,0,0.8);
        }
        .disco-disc-img {
          width: 100%; height: 100%;
          object-fit: cover; display: block; border-radius: 50%;
        }
        .disco-disc-empty {
          background: var(--surface-2);
        }
        /* Subtle vinyl groove rings */
        .disco-grooves {
          position: absolute; inset: 0; border-radius: 50%;
          background: repeating-radial-gradient(
            circle at 50%,
            transparent 0,
            transparent 4px,
            rgba(0,0,0,0.12) 4px,
            rgba(0,0,0,0.12) 5px
          );
          pointer-events: none;
        }
        .disco-disc-hole {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 12%; height: 12%;
          border-radius: 50%; background: #111;
          box-shadow: 0 0 0 2px rgba(255,255,255,0.08);
        }

        /* Track info */
        .disco-meta { text-align: center; }
        .disco-title {
          font-size: clamp(20px, 4.5vw, 38px);
          font-weight: 300; letter-spacing: -0.02em;
          color: #fff; line-height: 1.2;
        }
        .disco-artist {
          font-size: clamp(12px, 1.8vw, 16px);
          color: rgba(255,255,255,0.45);
          margin-top: 10px; letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .disco-album {
          font-size: 11px; color: rgba(255,255,255,0.25);
          margin-top: 5px; letter-spacing: 0.06em;
        }

        /* EQ at bottom */
        .disco-eq {
          position: fixed; bottom: 0; left: 0; right: 0;
          height: clamp(70px, 16vh, 140px);
          z-index: 6; pointer-events: none;
        }

        @media (max-width: 768px) {
          .disco-content { padding-bottom: 120px; gap: 20px; }
          .disco-eq { height: clamp(60px, 14vh, 110px); }
        }
      `}</style>
    </div>
  );
}
