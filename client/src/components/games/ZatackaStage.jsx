import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pause, Play, Share2, RotateCcw, X } from 'lucide-react';
import { useSocket } from '../../hooks/useSocket.js';
import { useGamepad } from '../../hooks/useGamepad.js';

const CELL = 6;
const SPEEDS = {
  slow: 5,
  normal: 7,
  fast: 9,
  hyper: 12,
};

const GAP_PATTERN = {
  draw: 14,
  gap: 8,
};

const ARTIFACTS = {
  bomb: { label: 'Bomb', color: '#D55E00' },
  ghost: { label: 'Ghost', color: '#56B4E9' },
};

const KEYSETS = [
  { left: 'a', right: 'd', action: 'w' },
  { left: 'j', right: 'l', action: 'i' },
  { left: 'f', right: 'h', action: 't' },
  { left: 'v', right: 'n', action: 'b' },
  { left: 'arrowleft', right: 'arrowright', action: 'arrowup' },
  { left: '4', right: '6', action: '8' },
  { left: 'z', right: 'c', action: 'x' },
  { left: ',', right: '/', action: '.' },
];

const createSummary = (scores, players, rounds) => {
  const sorted = [...scores].sort((a, b) => b.points - a.points);
  const leader = sorted[0];
  const leaderName = players.find(p => p.id === leader?.id)?.nickname || 'Leader';
  return `Zatacka match • ${rounds} rounds • ${leaderName} leads with ${leader?.points ?? 0} points.`;
};

export default function ZatackaStage({ open, config, onClose }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(0);
  const accRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [round, setRound] = useState(1);
  const [roundState, setRoundState] = useState('ready');
  const [scores, setScores] = useState([]);
  const [statusLine, setStatusLine] = useState('');
  const gameRef = useRef(null);

  const players = useMemo(() => config?.players || [], [config]);
  const maxPlayers = config?.maxPlayers || 8;
  const speed = SPEEDS[config?.speed] || SPEEDS.normal;
  const mode = config?.mode || 'classic';
  const edgeMode = config?.edgeMode || 'open';

  useEffect(() => {
    if (!open || !players.length) return;
    setScores(players.map(p => ({ id: p.id, points: 0, kills: 0, wins: 0 })));
    setRound(1);
    setRoundState('ready');
    setRunning(true);
  }, [open, players]);

  const bindGame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

    const cols = Math.floor(width / CELL);
    const rows = Math.floor(height / CELL);
    const grid = new Int16Array(cols * rows).fill(-1);

    const spawnPositions = players.map((_, idx) => {
      const angle = (Math.PI * 2 * idx) / players.length;
      return {
        x: Math.floor(cols / 2 + Math.cos(angle) * cols * 0.28),
        y: Math.floor(rows / 2 + Math.sin(angle) * rows * 0.28),
        dir: idx % 2 === 0 ? 0 : 2,
      };
    });

    const livePlayers = players.map((p, idx) => ({
      ...p,
      idx,
      x: spawnPositions[idx].x,
      y: spawnPositions[idx].y,
      dir: spawnPositions[idx].dir,
      alive: true,
      ghostUntil: 0,
      bombCharges: 0,
      gapTicks: 0,
      gapOn: true,
      pendingTurn: 0,
    }));

    const artifacts = [];
    let artifactTimer = 0;

    return {
      ctx,
      width,
      height,
      cols,
      rows,
      grid,
      livePlayers,
      artifacts,
      artifactTimer,
    };
  };

  const resetRound = () => {
    const state = bindGame();
    if (!state) return;
    gameRef.current = state;
    setRoundState('running');
    setStatusLine('');
    lastTimeRef.current = performance.now();
    accRef.current = 0;
  };

  useEffect(() => {
    if (!open) return;
    resetRound();
  }, [open, round]);

  const updateScoresForKill = (killerIdx) => {
    if (killerIdx == null || killerIdx < 0) return;
    const killerId = players[killerIdx]?.id;
    if (!killerId) return;
    setScores(prev => prev.map(s => (s.id === killerId ? { ...s, points: s.points + 1, kills: s.kills + 1 } : s)));
  };

  const updateScoresForWin = (winnerId) => {
    if (!winnerId) return;
    setScores(prev => prev.map(s => (s.id === winnerId ? { ...s, points: s.points + 3, wins: s.wins + 1 } : s)));
  };

  const killPlayer = (state, player, killerIdx) => {
    if (!player.alive) return;
    player.alive = false;
    updateScoresForKill(killerIdx);
  };

  const spawnArtifact = (state) => {
    if (state.artifacts.length >= 3) return;
    const type = Math.random() > 0.5 ? 'bomb' : 'ghost';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const x = Math.floor(Math.random() * state.cols);
      const y = Math.floor(Math.random() * state.rows);
      const idx = y * state.cols + x;
      if (state.grid[idx] !== -1) continue;
      if (state.artifacts.some(a => a.x === x && a.y === y)) continue;
      state.artifacts.push({ type, x, y });
      return;
    }
  };

  const applyBomb = (state, player) => {
    if (player.bombCharges <= 0) return;
    player.bombCharges -= 1;
    const radius = 6;
    const { cols, rows, grid } = state;
    const centerX = player.x;
    const centerY = player.y;
    for (let y = centerY - radius; y <= centerY + radius; y += 1) {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy > radius * radius) continue;
        const wrapX = (x + cols) % cols;
        const wrapY = (y + rows) % rows;
        grid[wrapY * cols + wrapX] = -1;
        state.livePlayers.forEach(lp => {
          if (!lp.alive) return;
          if (lp.x === wrapX && lp.y === wrapY) {
            killPlayer(state, lp, player.idx);
          }
        });
      }
    }
    setStatusLine(`${player.nickname} detonated a bomb.`);
  };

  const handleAction = (playerIdx) => {
    const state = gameRef.current;
    if (!state) return;
    const player = state.livePlayers[playerIdx];
    if (!player || !player.alive) return;
    if (mode === 'ultimate') applyBomb(state, player);
  };

  const turnPlayer = (playerIdx, dir) => {
    const state = gameRef.current;
    if (!state) return;
    const player = state.livePlayers[playerIdx];
    if (!player || !player.alive) return;
    player.pendingTurn = dir;
  };

  useSocket('cec:left', () => {
    const idx = players.findIndex(p => p.input === 'mobile');
    if (idx >= 0) turnPlayer(idx, -1);
  });
  useSocket('cec:right', () => {
    const idx = players.findIndex(p => p.input === 'mobile');
    if (idx >= 0) turnPlayer(idx, 1);
  });
  useSocket('cec:select', () => {
    const idx = players.findIndex(p => p.input === 'mobile');
    if (idx >= 0) handleAction(idx);
  });
  useSocket('cec:back', () => setRunning(prev => !prev));

  useGamepad({
    enabled: open,
    onLeft: () => {
      const idx = players.findIndex(p => p.input === 'controller' || p.input === 'ps');
      if (idx >= 0) turnPlayer(idx, -1);
    },
    onRight: () => {
      const idx = players.findIndex(p => p.input === 'controller' || p.input === 'ps');
      if (idx >= 0) turnPlayer(idx, 1);
    },
    onSelect: () => {
      const idx = players.findIndex(p => p.input === 'controller' || p.input === 'ps');
      if (idx >= 0) handleAction(idx);
    },
    onBack: () => setRunning(prev => !prev),
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      const key = e.key.toLowerCase();
      players.forEach((player, idx) => {
        if (player.input !== 'keyboard') return;
        const keyset = KEYSETS[idx] || KEYSETS[0];
        if (key === keyset.left) turnPlayer(idx, -1);
        if (key === keyset.right) turnPlayer(idx, 1);
        if (player.buttons === 3 && key === keyset.action) handleAction(idx);
      });
      if (key === ' ') setRunning(prev => !prev);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, players]);

  useEffect(() => {
    if (!open) return;
    const draw = (now) => {
      const state = gameRef.current;
      if (!state) return;
      if (!running) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const dt = now - lastTimeRef.current;
      lastTimeRef.current = now;
      accRef.current += dt;
      const stepMs = 1000 / speed;

      while (accRef.current >= stepMs) {
        accRef.current -= stepMs;
        tick(state, now);
      }

      render(state);
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame((t) => {
      lastTimeRef.current = t;
      accRef.current = 0;
      draw(t);
    });

    return () => cancelAnimationFrame(rafRef.current);
  }, [open, running, speed]);

  const tick = (state, now) => {
    const { cols, rows, grid, livePlayers } = state;
    state.artifactTimer += 1;
    if (mode === 'ultimate' && state.artifactTimer > speed * 3) {
      spawnArtifact(state);
      state.artifactTimer = 0;
    }

    livePlayers.forEach(player => {
      if (!player.alive) return;

      if (player.pendingTurn !== 0) {
        player.dir = (player.dir + player.pendingTurn + 4) % 4;
        player.pendingTurn = 0;
      }

      const dx = player.dir === 1 ? 1 : player.dir === 3 ? -1 : 0;
      const dy = player.dir === 2 ? 1 : player.dir === 0 ? -1 : 0;

      let nx = player.x + dx;
      let ny = player.y + dy;

      if (edgeMode === 'open') {
        nx = (nx + cols) % cols;
        ny = (ny + rows) % rows;
      } else if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        killPlayer(state, player, null);
        return;
      }

      const idx = ny * cols + nx;
      const isGhost = player.ghostUntil > now;
      if (!isGhost && grid[idx] !== -1) {
        killPlayer(state, player, grid[idx]);
        return;
      }

      player.x = nx;
      player.y = ny;

      if (mode === 'gapped') {
        player.gapTicks += 1;
        const cycle = GAP_PATTERN.draw + GAP_PATTERN.gap;
        player.gapOn = (player.gapTicks % cycle) < GAP_PATTERN.draw;
      } else {
        player.gapOn = true;
      }

      if (player.gapOn && (!isGhost || grid[idx] === -1)) {
        grid[idx] = player.idx;
      }

      if (mode === 'ultimate') {
        const artifactIdx = state.artifacts.findIndex(a => a.x === nx && a.y === ny);
        if (artifactIdx >= 0) {
          const artifact = state.artifacts.splice(artifactIdx, 1)[0];
          if (artifact.type === 'bomb') player.bombCharges += 1;
          if (artifact.type === 'ghost') player.ghostUntil = now + 2000;
        }
      }
    });

    const alive = livePlayers.filter(p => p.alive);
    if (roundState === 'running' && alive.length <= 1) {
      setRoundState('over');
      setRunning(false);
      if (alive.length === 1) {
        updateScoresForWin(alive[0].id);
        setStatusLine(`${alive[0].nickname} wins the round.`);
      } else {
        setStatusLine('Round ended in a draw.');
      }
    }
  };

  const render = (state) => {
    const { ctx, width, height, cols, rows, grid, livePlayers, artifacts } = state;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, width, height);

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const owner = grid[y * cols + x];
        if (owner === -1) continue;
        const color = livePlayers[owner]?.color || '#777';
        ctx.fillStyle = color;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }

    artifacts.forEach(artifact => {
      ctx.fillStyle = ARTIFACTS[artifact.type].color;
      ctx.beginPath();
      ctx.arc(artifact.x * CELL + CELL / 2, artifact.y * CELL + CELL / 2, CELL * 0.55, 0, Math.PI * 2);
      ctx.fill();
    });

    livePlayers.forEach(player => {
      if (!player.alive) return;
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(player.x * CELL + CELL / 2, player.y * CELL + CELL / 2, CELL * 0.75, 0, Math.PI * 2);
      ctx.fill();
      if (player.ghostUntil > performance.now()) {
        ctx.strokeStyle = 'rgba(86,180,233,0.6)';
        ctx.beginPath();
        ctx.arc(player.x * CELL + CELL / 2, player.y * CELL + CELL / 2, CELL * 1.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  };

  const exportScoreboard = () => {
    const payload = {
      game: 'zatacka',
      mode,
      edgeMode,
      speed: config?.speed || 'normal',
      round,
      scores,
      players,
      createdAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `zatacka-scoreboard-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const shareScoreboard = async () => {
    const payload = {
      game: 'zatacka',
      mode,
      edgeMode,
      speed: config?.speed || 'normal',
      round,
      scores,
      players,
      createdAt: new Date().toISOString(),
    };
    try {
      const res = await fetch('/api/games/scoreboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Share failed');
      const shareUrl = encodeURIComponent(data.url);
      const quote = encodeURIComponent(createSummary(scores, players, round));
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}&quote=${quote}`, '_blank');
    } catch {
      setStatusLine('Share failed. Try Export JSON instead.');
    }
  };

  if (!open) return null;

  const sortedScores = [...scores].sort((a, b) => b.points - a.points);

  return (
    <div className="game-stage-backdrop" onClick={onClose}>
      <div className="game-stage" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="game-stage-title">Zatacka Arena</div>
          <button className="sidebar-btn" onClick={onClose} aria-label="Close game">
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>
        <div className="game-stage-body">
          <canvas ref={canvasRef} className="game-stage-canvas" />
          <div className="game-stage-meta">
            <div>Mode: {mode}</div>
            <div>Speed: {config?.speed || 'normal'}</div>
            <div>Edges: {edgeMode}</div>
            <div>Players: {players.length} / {maxPlayers}</div>
            <div>Round: {round}</div>
            <div>Status: {roundState}</div>
            {statusLine && <div style={{ color: 'var(--silver-light)' }}>{statusLine}</div>}
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              Keyboard players: use left/right keys. Third key triggers artifacts. Space toggles pause.
            </div>

            <div style={{ marginTop: 12, fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase' }}>Scoreboard</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {sortedScores.map(entry => {
                const player = players.find(p => p.id === entry.id);
                return (
                  <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="games-color-dot" style={{ background: player?.color || '#777' }} />
                    <span style={{ flex: 1 }}>{player?.nickname || 'Player'}</span>
                    <span>{entry.points} pts</span>
                  </div>
                );
              })}
            </div>

            <div className="games-actions" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={() => setRunning(prev => !prev)}>
                {running ? <Pause size={14} strokeWidth={1.5} style={{ marginRight: 6 }} /> : <Play size={14} strokeWidth={1.5} style={{ marginRight: 6 }} />}
                {running ? 'Pause' : 'Resume'}
              </button>
              <button className="btn" onClick={() => setRound(r => r + 1)}>
                <RotateCcw size={14} strokeWidth={1.5} style={{ marginRight: 6 }} />
                Next round
              </button>
            </div>
            <div className="games-actions">
              <button className="btn" onClick={exportScoreboard}>
                <Download size={14} strokeWidth={1.5} style={{ marginRight: 6 }} />
                Export JSON
              </button>
              <button className="btn" onClick={shareScoreboard}>
                <Share2 size={14} strokeWidth={1.5} style={{ marginRight: 6 }} />
                Share on Facebook
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
