import { useEffect, useMemo, useState } from 'react';
import { Play, X } from 'lucide-react';

const SPEED_LEVELS = [
  { id: 'slow', label: 'Slow' },
  { id: 'normal', label: 'Normal' },
  { id: 'fast', label: 'Fast' },
  { id: 'hyper', label: 'Hyper' },
];

const ZATACKA_MODES = [
  {
    id: 'classic',
    title: 'Classic',
    description: 'Grow when a player collides into a trail. Last alive wins.',
  },
  {
    id: 'gapped',
    title: 'Gapped Trail',
    description: 'Trail alternates between growth and gaps.',
  },
  {
    id: 'ultimate',
    title: 'Ultimate',
    description: 'Artifacts: bomb radius + ghost mode for 2 seconds.',
  },
];

const CONTROL_TYPES = [
  { id: 'controller', label: 'Controller' },
  { id: 'mobile', label: 'Mobile keyboard' },
  { id: 'keyboard', label: 'Keyboard + mouse' },
  { id: 'ps', label: 'PlayStation controller' },
];

const ACCESSIBLE_COLORS = [
  '#E69F00',
  '#56B4E9',
  '#009E73',
  '#F0E442',
  '#0072B2',
  '#D55E00',
  '#CC79A7',
  '#A1A1A1',
];

const createPlayer = (index) => ({
  id: `p${index + 1}`,
  nickname: `Player ${index + 1}`,
  input: CONTROL_TYPES[0].id,
  buttons: 2,
  color: ACCESSIBLE_COLORS[index % ACCESSIBLE_COLORS.length],
});

const calcMaxPlayers = (width, height) => {
  const minSize = Math.min(width, height);
  if (minSize < 600) return 4;
  if (minSize < 900) return 6;
  return 8;
};

export default function GamesMenu({ open, onClose, onLaunch }) {
  const [selectedGame, setSelectedGame] = useState('zatacka');
  const [selectedMode, setSelectedMode] = useState('classic');
  const [speed, setSpeed] = useState('normal');
  const [edgeMode, setEdgeMode] = useState('open');
  const [players, setPlayers] = useState([createPlayer(0), createPlayer(1)]);
  const [maxPlayers, setMaxPlayers] = useState(() => calcMaxPlayers(window.innerWidth, window.innerHeight));

  useEffect(() => {
    const handleResize = () => setMaxPlayers(calcMaxPlayers(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (players.length > maxPlayers) {
      setPlayers(prev => prev.slice(0, maxPlayers));
    }
  }, [maxPlayers, players.length]);

  const modeDetails = useMemo(() => ZATACKA_MODES.find(mode => mode.id === selectedMode), [selectedMode]);

  if (!open) return null;

  const canAddPlayer = players.length < maxPlayers;

  const updatePlayer = (id, updates) => {
    setPlayers(prev => prev.map(player => (player.id === id ? { ...player, ...updates } : player)));
  };

  const addPlayer = () => {
    if (!canAddPlayer) return;
    setPlayers(prev => [...prev, createPlayer(prev.length)]);
  };

  const removePlayer = (id) => {
    setPlayers(prev => prev.filter(player => player.id !== id));
  };

  const handleLaunch = () => {
    onLaunch('zatacka', {
      mode: selectedMode,
      speed,
      edgeMode,
      players,
      maxPlayers,
    });
  };

  return (
    <div className="games-backdrop" onClick={onClose}>
      <div className="games-panel glass" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>Games</h3>
          <button className="sidebar-btn" onClick={onClose} aria-label="Close games menu">
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        <div className="section-title">Available</div>
        <div className="games-list">
          <button
            className={`games-card ${selectedGame === 'zatacka' ? 'active' : ''}`}
            onClick={() => setSelectedGame('zatacka')}
          >
            <div className="games-card-title">Zatacka</div>
            <div className="games-card-desc">Fast trails, bold turns, and arena control.</div>
          </button>
        </div>

        <div className="section-title">Mode</div>
        <div className="games-row">
          {ZATACKA_MODES.map(mode => (
            <button
              key={mode.id}
              className={`games-pill ${selectedMode === mode.id ? 'active' : ''}`}
              onClick={() => setSelectedMode(mode.id)}
            >
              {mode.title}
            </button>
          ))}
        </div>
        <div className="games-card-desc" style={{ marginTop: 6 }}>{modeDetails?.description}</div>

        <div className="section-title">Match</div>
        <div className="games-row">
          {SPEED_LEVELS.map(level => (
            <button
              key={level.id}
              className={`games-pill ${speed === level.id ? 'active' : ''}`}
              onClick={() => setSpeed(level.id)}
            >
              {level.label}
            </button>
          ))}
        </div>
        <div className="games-row" style={{ marginTop: 8 }}>
          <button
            className={`games-pill ${edgeMode === 'open' ? 'active' : ''}`}
            onClick={() => setEdgeMode('open')}
          >
            Open edges
          </button>
          <button
            className={`games-pill ${edgeMode === 'walled' ? 'active' : ''}`}
            onClick={() => setEdgeMode('walled')}
          >
            Walled edges
          </button>
        </div>

        <div className="section-title">Players (max {maxPlayers})</div>
        <div className="games-players">
          {players.map((player, index) => (
            <div key={player.id} className="games-player">
              <div className="games-field">
                <label>
                  <span className="games-color-dot" style={{ background: player.color }} />
                  Nickname
                </label>
                <input
                  value={player.nickname}
                  onChange={(e) => updatePlayer(player.id, { nickname: e.target.value })}
                />
              </div>
              <div className="games-field">
                <label>Input</label>
                <select
                  value={player.input}
                  onChange={(e) => updatePlayer(player.id, { input: e.target.value })}
                >
                  {CONTROL_TYPES.map(control => (
                    <option key={control.id} value={control.id}>{control.label}</option>
                  ))}
                </select>
              </div>
              <div className="games-field">
                <label>Buttons</label>
                <select
                  value={player.buttons}
                  onChange={(e) => updatePlayer(player.id, { buttons: Number(e.target.value) })}
                >
                  {[2, 3].map(count => (
                    <option key={count} value={count}>{count}</option>
                  ))}
                </select>
              </div>
              {players.length > 1 && index > 1 && (
                <button className="btn" onClick={() => removePlayer(player.id)}>Remove</button>
              )}
            </div>
          ))}
        </div>
        <div className="games-row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={addPlayer} disabled={!canAddPlayer}>Add player</button>
        </div>

        {selectedMode === 'ultimate' && (
          <>
            <div className="section-title">Artifacts</div>
            <div className="games-card-desc">Bomb: trigger with third button. Ghost: 2 seconds through trails/walls.</div>
          </>
        )}

        <div className="games-actions">
          <button className="btn primary" onClick={handleLaunch}>
            <Play size={14} strokeWidth={1.5} style={{ marginRight: 6 }} />
            Launch
          </button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
