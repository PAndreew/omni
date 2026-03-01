import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// ── Particle cloud ────────────────────────────────────────────────────────────
// 200 particles orbiting two slowly-moving attractors with additive ("lighter")
// blending for the neon-plasma glow. Beat pulses every ~500 ms when playing.
function ParticleCloud({ isPlaying }) {
  const canvasRef    = useRef(null);
  const rafRef       = useRef(null);
  const playingRef   = useRef(isPlaying);

  useEffect(() => { playingRef.current = isPlaying; }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const N     = 200;
    const TAU   = Math.PI * 2;
    const px    = new Float32Array(N);
    const py    = new Float32Array(N);
    const pvx   = new Float32Array(N);
    const pvy   = new Float32Array(N);
    const phue  = new Float32Array(N);   // per-particle hue offset
    const psize = new Float32Array(N);
    const plife = new Float32Array(N);   // 0→1 then respawn
    const pspd  = new Float32Array(N);   // life speed

    let W = 1, H = 1;
    let t = 0;             // animation clock
    let beatPulse = 0;     // 0→1, decays after each beat
    let lastBeat  = 0;
    const BEAT_MS = 500;   // 120 BPM

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width  = W;
      canvas.height = H;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function spawn(i) {
      const cx = W / 2, cy = H / 2;
      const angle = Math.random() * TAU;
      const r     = 15 + Math.random() * 70;
      px[i]    = cx + Math.cos(angle) * r;
      py[i]    = cy + Math.sin(angle) * r;
      pvx[i]   = (Math.random() - 0.5) * 0.6;
      pvy[i]   = (Math.random() - 0.5) * 0.6;
      phue[i]  = Math.random() * 360;
      psize[i] = 1.2 + Math.random() * 3.0;
      plife[i] = Math.random();               // stagger initial lifetimes
      pspd[i]  = 0.0018 + Math.random() * 0.0025;
    }
    for (let i = 0; i < N; i++) spawn(i);

    function draw(now) {
      if (!W || !H) { rafRef.current = requestAnimationFrame(draw); return; }

      const playing = playingRef.current;
      const speed   = playing ? 1 : 0.12;

      // Beat pulse (simulated rhythm when playing)
      if (playing && now - lastBeat > BEAT_MS) { beatPulse = 1; lastBeat = now; }
      beatPulse *= 0.90;

      // Trail: partial black fade gives motion blur
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(0,0,0,${playing ? 0.13 : 0.07})`;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2, cy = H / 2;
      // Two attractors slowly orbit the centre
      const a1x = cx + Math.cos(t * 0.28) * W * 0.20;
      const a1y = cy + Math.sin(t * 0.28) * H * 0.20;
      const a2x = cx + Math.cos(t * 0.28 + Math.PI) * W * 0.20;
      const a2y = cy + Math.sin(t * 0.28 + Math.PI) * H * 0.20;

      // Additive blending: overlapping particles bloom into vivid glow
      ctx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < N; i++) {
        // Age & respawn
        plife[i] += pspd[i] * speed;
        if (plife[i] > 1) { spawn(i); continue; }
        const life = Math.sin(plife[i] * Math.PI); // 0→1→0 envelope

        const dx  = px[i] - cx;
        const dy  = py[i] - cy;
        const dst = Math.sqrt(dx * dx + dy * dy) + 0.001;

        // Swirl (tangent to radius)
        const sw = (0.05 + beatPulse * 0.03) * speed;
        pvx[i] += (-dy / dst) * sw;
        pvy[i] += ( dx / dst) * sw;

        // Cohesion toward centre
        const co = 0.007 * speed;
        pvx[i] -= dx * co;
        pvy[i] -= dy * co;

        // Pull toward nearest attractor
        const dax = a1x - px[i], day = a1y - py[i];
        const dbx = a2x - px[i], dby = a2y - py[i];
        const da  = Math.sqrt(dax * dax + day * day) + 0.001;
        const db  = Math.sqrt(dbx * dbx + dby * dby) + 0.001;
        const as  = 0.012 * speed;
        pvx[i] += dax / da * as + dbx / db * as;
        pvy[i] += day / da * as + dby / db * as;

        // Beat: radial burst outward
        if (beatPulse > 0.5) {
          pvx[i] += (dx / dst) * beatPulse * 0.9;
          pvy[i] += (dy / dst) * beatPulse * 0.9;
        }

        // Micro-turbulence
        pvx[i] += (Math.random() - 0.5) * 0.18 * speed;
        pvy[i] += (Math.random() - 0.5) * 0.18 * speed;

        // Damping
        pvx[i] *= 0.965;
        pvy[i] *= 0.965;
        px[i]  += pvx[i];
        py[i]  += pvy[i];

        // Wrap edges
        if (px[i] < -60) px[i] = W + 60;
        if (px[i] > W + 60) px[i] = -60;
        if (py[i] < -60) py[i] = H + 60;
        if (py[i] > H + 60) py[i] = -60;

        const hue  = (phue[i] + t * 22) % 360;
        const r    = psize[i] * (1 + beatPulse * 0.4);
        const op   = life * (playing ? 0.85 : 0.4);

        // Outer glow halo
        ctx.fillStyle = `hsla(${hue}, 100%, 55%, ${op * 0.10})`;
        ctx.beginPath();
        ctx.arc(px[i], py[i], r * 7, 0, TAU);
        ctx.fill();

        // Mid glow
        ctx.fillStyle = `hsla(${hue + 40}, 100%, 65%, ${op * 0.22})`;
        ctx.beginPath();
        ctx.arc(px[i], py[i], r * 3, 0, TAU);
        ctx.fill();

        // Bright core
        ctx.fillStyle = `hsla(${hue + 80}, 100%, 80%, ${op * 0.70})`;
        ctx.beginPath();
        ctx.arc(px[i], py[i], r, 0, TAU);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
      t += 0.016 * speed;
      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []); // runs once; reads playingRef inside loop

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    />
  );
}

// ── Disco overlay ─────────────────────────────────────────────────────────────
export default function DiscoMode({ track, onClose }) {
  const isPlaying = track?.status === 'playing';

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="disco-overlay">
      {/* Particle cloud fills everything */}
      <ParticleCloud isPlaying={isPlaying} />

      {/* Blurred art tints the black canvas very subtly */}
      {track?.art && (
        <div className="disco-art-tint" style={{ backgroundImage: `url(${track.art})` }} />
      )}

      {/* Close — clicking overlay background also closes */}
      <div className="disco-bg-click" onClick={onClose} />

      <button className="disco-close" onClick={onClose} aria-label="Close disco mode">
        <X size={22} strokeWidth={1.5} />
      </button>

      {/* Centre HUD: spinning disc + track info */}
      <div className="disco-hud">
        <div className={`disco-disc-wrap ${isPlaying ? 'disco-spinning' : ''}`}>
          <div className="disco-disc">
            {track?.art
              ? <img src={track.art} alt="album art" className="disco-disc-img" />
              : <div className="disco-disc-img disco-disc-empty" />
            }
            <div className="disco-grooves" />
            <div className="disco-disc-hole" />
          </div>
        </div>

        <div className="disco-meta">
          <div className="disco-title">{track?.title ?? 'Nothing Playing'}</div>
          {track?.artist && <div className="disco-artist">{track.artist}</div>}
        </div>
      </div>

      <style>{`
        .disco-overlay {
          position: fixed; inset: 0; z-index: 9000;
          background: #000;
          animation: discoIn 0.4s cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes discoIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* Subtle art colour wash behind particles */
        .disco-art-tint {
          position: absolute; inset: -80px; z-index: 0; pointer-events: none;
          background-size: cover; background-position: center;
          filter: blur(100px) saturate(2) brightness(0.12);
        }

        /* Transparent click-catcher over particles (behind HUD) */
        .disco-bg-click {
          position: absolute; inset: 0; z-index: 1; cursor: pointer;
        }

        /* Close button */
        .disco-close {
          position: absolute; top: 20px; right: 20px; z-index: 10;
          background: rgba(0,0,0,0.5);
          border: 1px solid rgba(255,255,255,0.15);
          color: rgba(255,255,255,0.75);
          cursor: pointer; border-radius: 50%;
          width: 44px; height: 44px;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .disco-close:hover { background: rgba(255,255,255,0.12); color: #fff; }

        /* Centre HUD */
        .disco-hud {
          position: absolute; inset: 0; z-index: 5;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 24px; pointer-events: none;
        }

        /* Vinyl disc */
        .disco-disc-wrap {
          width: clamp(140px, 28vmin, 240px);
          height: clamp(140px, 28vmin, 240px);
          border-radius: 50%; flex-shrink: 0;
          filter: drop-shadow(0 0 30px rgba(255,255,255,0.12));
        }
        .disco-spinning { animation: discSpin 8s linear infinite; }
        @keyframes discSpin { to { transform: rotate(360deg); } }

        .disco-disc {
          width: 100%; height: 100%;
          border-radius: 50%; overflow: hidden; position: relative;
        }
        .disco-disc-img {
          width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 50%;
        }
        .disco-disc-empty { background: #111; }
        .disco-grooves {
          position: absolute; inset: 0; border-radius: 50%;
          background: repeating-radial-gradient(
            circle at 50%, transparent 0, transparent 4px,
            rgba(0,0,0,0.15) 4px, rgba(0,0,0,0.15) 5px
          );
          pointer-events: none;
        }
        .disco-disc-hole {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 12%; height: 12%;
          border-radius: 50%; background: #000;
          box-shadow: 0 0 0 2px rgba(255,255,255,0.1);
        }

        /* Track info */
        .disco-meta { text-align: center; }
        .disco-title {
          font-size: clamp(18px, 4vw, 34px);
          font-weight: 300; letter-spacing: -0.02em;
          color: rgba(255,255,255,0.92); line-height: 1.2;
          text-shadow: 0 0 40px rgba(255,255,255,0.3);
        }
        .disco-artist {
          font-size: clamp(11px, 1.6vw, 15px);
          color: rgba(255,255,255,0.45);
          margin-top: 8px; letter-spacing: 0.14em; text-transform: uppercase;
        }
      `}</style>
    </div>
  );
}
