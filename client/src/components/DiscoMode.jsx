import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// ── Particle cloud ─────────────────────────────────────────────────────────────
function ParticleCloud({ isPlaying }) {
  const canvasRef  = useRef(null);
  const rafRef     = useRef(null);
  const playingRef = useRef(isPlaying);

  useEffect(() => { playingRef.current = isPlaying; }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const N   = 150;          // fewer particles = reliable on Pi
    const TAU = Math.PI * 2;

    const px    = new Float32Array(N);
    const py    = new Float32Array(N);
    const pvx   = new Float32Array(N);
    const pvy   = new Float32Array(N);
    const phue  = new Float32Array(N);
    const psize = new Float32Array(N);
    const plife = new Float32Array(N);
    const pspd  = new Float32Array(N);

    let W = window.innerWidth;
    let H = window.innerHeight;
    let t = 0;
    let beatPulse = 0;
    let lastBeat  = 0;
    const BEAT_MS = 480;

    function applySize() {
      W = canvas.offsetWidth  || window.innerWidth;
      H = canvas.offsetHeight || window.innerHeight;
      canvas.width  = W;
      canvas.height = H;
    }
    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(canvas);

    function spawn(i) {
      const cx = W / 2, cy = H / 2;
      const angle = Math.random() * TAU;
      const r     = 20 + Math.random() * Math.min(W, H) * 0.38;
      px[i]    = cx + Math.cos(angle) * r;
      py[i]    = cy + Math.sin(angle) * r;
      pvx[i]   = (Math.random() - 0.5) * 0.9;
      pvy[i]   = (Math.random() - 0.5) * 0.9;
      phue[i]  = Math.random() * 360;
      psize[i] = 1.4 + Math.random() * 3.2;
      plife[i] = Math.random();
      pspd[i]  = 0.0016 + Math.random() * 0.0022;
    }
    for (let i = 0; i < N; i++) spawn(i);

    function draw(now) {
      if (!W || !H) { rafRef.current = requestAnimationFrame(draw); return; }

      const playing = playingRef.current;
      const speed   = playing ? 1 : 0.12;

      if (playing && now - lastBeat > BEAT_MS) { beatPulse = 1; lastBeat = now; }
      beatPulse *= 0.88;

      // Slow trail — lower alpha = longer ghost streaks, more visible on Pi at low fps
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(0,0,0,${playing ? 0.07 : 0.04})`;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2, cy = H / 2;

      // Three attractors slowly orbiting the centre
      const a1x = cx + Math.cos(t * 0.21)            * W * 0.26;
      const a1y = cy + Math.sin(t * 0.21)            * H * 0.26;
      const a2x = cx + Math.cos(t * 0.17 + TAU/3)   * W * 0.26;
      const a2y = cy + Math.sin(t * 0.17 + TAU/3)   * H * 0.26;
      const a3x = cx + Math.cos(t * 0.13 + 2*TAU/3) * W * 0.26;
      const a3y = cy + Math.sin(t * 0.13 + 2*TAU/3) * H * 0.26;

      ctx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < N; i++) {
        plife[i] += pspd[i] * speed;
        if (plife[i] > 1) { spawn(i); continue; }

        const life = Math.sin(plife[i] * Math.PI);

        const dx  = px[i] - cx;
        const dy  = py[i] - cy;
        const dst = Math.sqrt(dx * dx + dy * dy) + 0.001;

        // Swirl
        const sw = (0.06 + beatPulse * 0.06) * speed;
        pvx[i] += (-dy / dst) * sw;
        pvy[i] += ( dx / dst) * sw;

        // Cohesion
        pvx[i] -= dx * 0.005 * speed;
        pvy[i] -= dy * 0.005 * speed;

        // Attractor pull (inlined for perf)
        const as = 0.009 * speed;
        let ddx, ddy, d;

        ddx = a1x - px[i]; ddy = a1y - py[i]; d = Math.sqrt(ddx*ddx + ddy*ddy) + 0.001;
        pvx[i] += ddx / d * as;  pvy[i] += ddy / d * as;

        ddx = a2x - px[i]; ddy = a2y - py[i]; d = Math.sqrt(ddx*ddx + ddy*ddy) + 0.001;
        pvx[i] += ddx / d * as;  pvy[i] += ddy / d * as;

        ddx = a3x - px[i]; ddy = a3y - py[i]; d = Math.sqrt(ddx*ddx + ddy*ddy) + 0.001;
        pvx[i] += ddx / d * as;  pvy[i] += ddy / d * as;

        // Beat burst
        if (beatPulse > 0.4) {
          pvx[i] += (dx / dst) * beatPulse * 1.2;
          pvy[i] += (dy / dst) * beatPulse * 1.2;
        }

        // Turbulence
        pvx[i] += (Math.random() - 0.5) * 0.20 * speed;
        pvy[i] += (Math.random() - 0.5) * 0.20 * speed;

        pvx[i] *= 0.963;
        pvy[i] *= 0.963;
        px[i]  += pvx[i];
        py[i]  += pvy[i];

        if (px[i] < -80) px[i] = W + 80;
        if (px[i] > W+80) px[i] = -80;
        if (py[i] < -80) py[i] = H + 80;
        if (py[i] > H+80) py[i] = -80;

        const hue = (phue[i] + t * 28) % 360;
        const r   = psize[i] * (1 + beatPulse * 0.5);
        // Higher base opacity so particles are clearly visible
        const op  = life * (playing ? 0.95 : 0.50);

        // Wide halo
        ctx.fillStyle = `hsla(${hue},100%,55%,${(op * 0.12).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(px[i], py[i], r * 8, 0, TAU); ctx.fill();

        // Mid glow
        ctx.fillStyle = `hsla(${(hue+50)%360},100%,65%,${(op * 0.28).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(px[i], py[i], r * 3, 0, TAU); ctx.fill();

        // Bright core
        ctx.fillStyle = `hsla(${(hue+110)%360},100%,88%,${(op * 0.85).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(px[i], py[i], r, 0, TAU); ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
      t += 0.016 * speed;
      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        display: 'block',
        zIndex: 2,          // above art-tint (z:0), below bg-click (z:3)
      }}
    />
  );
}

// ── Disco overlay ──────────────────────────────────────────────────────────────
export default function DiscoMode({ track, onClose }) {
  const isPlaying = track?.status === 'playing';

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="disco-overlay">
      {/* Art wash — z:0, behind canvas */}
      {track?.art && (
        <div className="disco-art-tint" style={{ backgroundImage: `url(${track.art})` }} />
      )}

      {/* Particle cloud — z:2 */}
      <ParticleCloud isPlaying={isPlaying} />

      {/* Click-to-close layer — z:3, transparent, sits above canvas */}
      <div className="disco-bg-click" onClick={onClose} />

      {/* Close button — z:10 */}
      <button className="disco-close" onClick={onClose} aria-label="Close disco mode">
        <X size={22} strokeWidth={1.5} />
      </button>

      {/* Track info — bottom centre */}
      {track?.title && (
        <div className="disco-info">
          <div className="disco-title">{track.title}</div>
          {track.artist && <div className="disco-artist">{track.artist}</div>}
        </div>
      )}

      <style>{`
        .disco-overlay {
          position: fixed; inset: 0; z-index: 9000;
          background: #000;
          animation: discoIn 0.5s cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes discoIn { from { opacity: 0; } to { opacity: 1; } }

        .disco-art-tint {
          position: absolute; inset: -100px; z-index: 0; pointer-events: none;
          background-size: cover; background-position: center;
          filter: blur(120px) saturate(3) brightness(0.08);
        }

        .disco-bg-click {
          position: absolute; inset: 0; z-index: 3; cursor: pointer;
        }

        .disco-close {
          position: absolute; top: 20px; right: 20px; z-index: 10;
          background: rgba(0,0,0,0.45);
          border: 1px solid rgba(255,255,255,0.14);
          color: rgba(255,255,255,0.65);
          cursor: pointer; border-radius: 50%;
          width: 44px; height: 44px;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .disco-close:hover { background: rgba(255,255,255,0.10); color: #fff; }

        .disco-info {
          position: absolute; bottom: 32px; left: 50%;
          transform: translateX(-50%);
          z-index: 5; text-align: center; pointer-events: none;
          width: 80%;
        }
        .disco-title {
          font-size: clamp(16px, 3vw, 28px);
          font-weight: 200; letter-spacing: -0.01em;
          color: rgba(255,255,255,0.80);
          text-shadow: 0 0 60px rgba(255,255,255,0.5);
        }
        .disco-artist {
          font-size: clamp(10px, 1.4vw, 13px);
          color: rgba(255,255,255,0.38);
          margin-top: 6px; letter-spacing: 0.16em; text-transform: uppercase;
        }
      `}</style>
    </div>
  );
}
