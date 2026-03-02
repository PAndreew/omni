import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// ── GLSL shaders ────────────────────────────────────────────────────────────

const VERT = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Kaleidoscope via polar folding + iterative domain warp + IQ cosine palette
const FRAG = `
  precision mediump float;
  uniform vec2  u_res;
  uniform float u_time;
  uniform float u_beat;

  #define TAU 6.28318530718
  #define PI  3.14159265359

  // Inigo Quilez cosine palette — neons that cycle through magenta/cyan/gold
  vec3 pal(float t) {
    return vec3(0.5) + vec3(0.5) * cos(TAU * (vec3(1.0, 1.0, 0.5) * t + vec3(0.80, 0.20, 0.60)));
  }

  void main() {
    // Normalised, -1..1 on shortest axis
    vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);

    // ── Kaleidoscope: N mirror-folds around centre ──────────────────────────
    float N     = 6.0;
    float angle = atan(uv.y, uv.x) + u_time * 0.05;   // slow overall rotation
    float r     = length(uv);
    angle       = mod(angle, TAU / N);
    angle       = abs(angle - PI / N);                  // mirror within segment
    uv          = vec2(cos(angle), sin(angle)) * r;

    // ── Iterative domain-warp (creates fractal tunnel depth) ────────────────
    vec2 uv0 = uv;
    vec3 col = vec3(0.0);

    for (float i = 0.0; i < 4.0; i++) {
      uv = fract(uv * 1.5 + u_time * 0.04) - 0.5;     // drift + tile

      float d = length(uv) * exp(-length(uv0));
      vec3  c = pal(length(uv0) * 0.5 + i * 0.35 + u_time * 0.10);

      d = sin(d * 8.0 + u_time * 1.6) / 8.0;           // pulsing rings
      d = abs(d);
      d = pow(0.012 / d, 1.3);                          // bright thin lines

      col += c * d;
    }

    // ── Beat flash ──────────────────────────────────────────────────────────
    col *= 1.0 + u_beat * 0.7;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ── WebGL kaleidoscope ───────────────────────────────────────────────────────
function KaleidoscopeGL({ isPlaying }) {
  const canvasRef  = useRef(null);
  const playingRef = useRef(isPlaying);
  useEffect(() => { playingRef.current = isPlaying; }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Render at half resolution — 4× fillrate savings on the Pi
    const SCALE = 0.5;
    let W = 0, H = 0;

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) return;

    function resize() {
      W = Math.floor(window.innerWidth  * SCALE);
      H = Math.floor(window.innerHeight * SCALE);
      canvas.width  = W;
      canvas.height = H;
      gl.viewport(0, 0, W, H);
    }

    function mkShader(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error('[Disco]', gl.getShaderInfoLog(s));
      return s;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, mkShader(gl.VERTEX_SHADER,   VERT));
    gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // Full-screen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes  = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uBeat = gl.getUniformLocation(prog, 'u_beat');

    resize();
    window.addEventListener('resize', resize);

    let raf;
    const t0 = performance.now();
    let beat     = 0;
    let lastBeat = 0;
    const BEAT_MS = 480;

    function frame(now) {
      const playing = playingRef.current;
      const elapsed = (now - t0) / 1000;
      const speed   = playing ? 1.0 : 0.12;

      if (playing && now - lastBeat > BEAT_MS) { beat = 1.0; lastBeat = now; }
      beat *= 0.82;   // snappy decay

      gl.uniform2f(uRes,  W, H);
      gl.uniform1f(uTime, elapsed * speed);
      gl.uniform1f(uBeat, beat);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        display: 'block',
        zIndex: 2,
      }}
    />
  );
}

// ── Disco overlay ────────────────────────────────────────────────────────────
export default function DiscoMode({ track, onClose }) {
  const isPlaying = track?.status === 'playing';

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="disco-overlay">
      {/* Blurred album art wash behind shader — z:0 */}
      {track?.art && (
        <div className="disco-art-tint" style={{ backgroundImage: `url(${track.art})` }} />
      )}

      {/* WebGL kaleidoscope — z:2 */}
      <KaleidoscopeGL isPlaying={isPlaying} />

      {/* Click-to-close — z:3, sits above canvas */}
      <div className="disco-bg-click" onClick={onClose} />

      {/* Close button — z:10 */}
      <button className="disco-close" onClick={onClose} aria-label="Close disco mode">
        <X size={22} strokeWidth={1.5} />
      </button>

      {/* Track info — bottom centre — z:5 */}
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
