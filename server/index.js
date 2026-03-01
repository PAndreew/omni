import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { execSync } from 'child_process';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import pty from 'node-pty';

import choresRouter from './routes/chores.js';
import weatherRouter from './routes/weather.js';
import settingsRouter from './routes/settings.js';
import layoutRouter from './routes/layout.js';
import eventsRouter from './routes/events.js';
import calendarsRouter from './routes/calendars.js';
import rssRouter from './routes/rss.js';
import gamesRouter from './routes/games.js';
import { startCEC } from './services/cec.js';
import { startAudioBridge, getCurrentTrack, sendCommand } from './services/audio.js';
import { startScheduler } from './services/scheduler.js';
import { startCalendarSync } from './services/calendar.js';
import spotifyRouter from './routes/spotify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
const httpServer = createServer(app);
const io = new SocketIO(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] },
});

app.use(cors());
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  if (req.method !== 'GET') {
    console.log('  Headers:', JSON.stringify(req.headers));
    console.log('  Body:', JSON.stringify(req.body));
  }
  next();
});

// Attach io to every request so routes can emit events
app.use((req, _res, next) => { req.io = io; next(); });

// API routes
app.use('/api/chores',    choresRouter);
app.use('/api/weather',   weatherRouter);
app.use('/api/settings',  settingsRouter);
app.use('/api/layout',    layoutRouter);
app.use('/api/events',    eventsRouter);
app.use('/api/calendars', calendarsRouter);
app.use('/api/spotify',   spotifyRouter);
app.use('/api/rss',       rssRouter);
app.use('/api/games',     gamesRouter);

// Audio control
app.post('/api/audio/:cmd', async (req, res) => {
  await sendCommand(req.params.cmd);
  res.json({ ok: true });
});
app.get('/api/audio/current', (req, res) => res.json(getCurrentTrack()));


// Voice command endpoint — frontend sends parsed command text
app.post('/api/voice/command', async (req, res) => {
  const { text } = req.body;
  const reply = await handleVoiceCommand(text?.toLowerCase() || '');
  io.emit('voice:reply', { text: reply });
  res.json({ reply });
});

// Serve built frontend in production
const clientDist  = path.join(__dirname, '../client/dist');
const serverPublic = path.join(__dirname, 'public');
app.use(express.static(serverPublic));
app.use(express.static(clientDist));
app.get('/remote', (_req, res) => res.sendFile(path.join(serverPublic, 'remote.html')));
app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

// ─── PTY session store ───────────────────────────────────────────────────────
const ptySessions = {};   // sessionId → pty process

function spawnPty(id, cols, rows, socket) {
  if (ptySessions[id]) return;
  const shell = process.env.SHELL || '/bin/bash';
  console.log(`[PTY] Spawning ${shell} for session ${id} (${cols}x${rows})`);
  
  try {
    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: process.env.HOME || '/home/pi',
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    proc._socketId = socket.id;   // track owner for cleanup on disconnect
    ptySessions[id] = proc;

    proc.onData(data => socket.emit('term:data', { id, data }));
    proc.onExit(({ exitCode, signal }) => {
      console.log(`[PTY] Session ${id} exited with code ${exitCode}, signal ${signal}`);
      delete ptySessions[id];
      if (socket.connected) {
        socket.emit('term:closed', { id });
      }
    });
  } catch (err) {
    console.error(`[PTY] Failed to spawn PTY for ${id}:`, err);
    socket.emit('term:data', { id, data: `\r\n\x1b[31m[failed to spawn shell: ${err.message}]\x1b[0m\r\n` });
  }
}

// Socket.io
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);
  
  // Debug all incoming events
  socket.onAny((event, ...args) => {
    if (!event.startsWith('audio:')) { // skip noisy audio updates
       console.log(`[WS][${socket.id}] Event: ${event}`, JSON.stringify(args));
    }
  });

  const track = getCurrentTrack();
  if (track) socket.emit('audio:track', track);

  // Remote / gamepad can emit cec:* events and we broadcast to all clients (same as CEC hardware)
  socket.on('cec:select', () => io.emit('cec:select'));
  socket.on('cec:up',    () => io.emit('cec:up'));
  socket.on('cec:down',  () => io.emit('cec:down'));
  socket.on('cec:left',  () => io.emit('cec:left'));
  socket.on('cec:right', () => io.emit('cec:right'));
  socket.on('cec:back',  () => io.emit('cec:back'));

  // Remote text input relay — inject text / backspace / enter into focused kiosk input
  socket.on('remote:type',      (text) => io.emit('remote:type', text));
  socket.on('remote:backspace', ()     => io.emit('remote:backspace'));
  socket.on('remote:enter',     ()     => io.emit('remote:enter'));

  // CEC commands from frontend (for admin mode)
  socket.on('cec:cmd', ({ cmd }) => {
    if (cmd === 'standby') {
      try { execSync('echo standby 0 | cec-client -s -d 1', { stdio: 'ignore' }); } catch {}
    }
  });

  // ── Terminal (PTY) sessions ──────────────────────────────────────────────
  socket.on('term:open', ({ id, cols, rows }) => {
    console.log(`[WS] term:open session=${id} cols=${cols} rows=${rows}`);
    spawnPty(id, cols, rows, socket);
  });
  socket.on('term:input',  ({ id, data }) => { if (ptySessions[id]) ptySessions[id].write(data); });
  socket.on('term:resize', ({ id, cols, rows }) => { if (ptySessions[id]) ptySessions[id].resize(cols, rows); });
  socket.on('term:close',  ({ id }) => {
    if (ptySessions[id]) { try { ptySessions[id].kill(); } catch {} delete ptySessions[id]; }
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
    for (const [id, proc] of Object.entries(ptySessions)) {
      if (proc._socketId === socket.id) {
        try { proc.kill(); } catch {}
        delete ptySessions[id];
      }
    }
  });
});

// Start background services
startCEC(io);
startAudioBridge(io);
startScheduler(io);
startCalendarSync(io);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🖥️  OmniWall server running at http://0.0.0.0:${PORT}`);
  console.log(`   Local network:  http://192.168.0.141:${PORT}`);
  console.log(`   Tailscale IP:   http://100.64.243.93:${PORT}`);
  console.log(`   Tailscale DNS:  http://raspberrypi.tailf0acdd.ts.net:${PORT}`);
});

// ─── Voice command processor ────────────────────────────────────────────────

import db from './db.js';

async function handleVoiceCommand(text) {
  // Time
  if (/what.*(time|clock)/.test(text)) {
    const now = new Date();
    return `It is ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}.`;
  }

  // Date
  if (/what.*(date|day)/.test(text) || /what day/.test(text)) {
    return `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`;
  }

  // Weather
  if (/weather|temperature|forecast|outside|rain|snow/.test(text)) {
    try {
      const resp = await fetch(`http://localhost:${PORT}/api/weather`);
      const w = await resp.json();
      if (w.error) return 'I could not fetch the weather right now.';
      return `Currently ${w.temp}°C in ${w.city}, ${w.condition.label}. Feels like ${w.feels_like}°C with ${w.humidity}% humidity.`;
    } catch {
      return 'Weather data unavailable.';
    }
  }

  // Chores — list pending
  if (/chore|task|todo/.test(text) && /list|pending|left|remain/.test(text)) {
    const chores = db.prepare('SELECT title FROM chores WHERE done=0').all();
    if (!chores.length) return 'No pending chores. All done!';
    return `You have ${chores.length} pending chore${chores.length > 1 ? 's' : ''}: ${chores.map(c => c.title).join(', ')}.`;
  }

  // Chores — add
  const addMatch = text.match(/add chore[:\s]+(.+)/);
  if (addMatch) {
    const title = addMatch[1].trim();
    db.prepare('INSERT INTO chores (title) VALUES (?)').run(title);
    const chore = db.prepare('SELECT * FROM chores ORDER BY id DESC LIMIT 1').get();
    io.emit('chore:added', chore);
    return `Added chore: ${title}.`;
  }

  // Music — toggle
  if (/play|pause|music/.test(text)) {
    sendCommand('toggle');
    return 'Toggling music playback.';
  }

  // Music — next
  if (/next|skip/.test(text)) {
    sendCommand('next');
    return 'Skipping to next track.';
  }

  // Music — previous
  if (/previous|back|restart/.test(text)) {
    sendCommand('prev');
    return 'Going to previous track.';
  }

  // Good night / lights off
  if (/good night|sleep|turn off|screen off/.test(text)) {
    io.emit('cec:cmd', { cmd: 'standby' });
    return 'Good night. Turning off the display.';
  }

  // Good morning
  if (/good morning|wake|turn on|screen on/.test(text)) {
    io.emit('cec:cmd', { cmd: 'on' });
    return 'Good morning!';
  }

  // Now playing
  if (/playing|song|track|artist/.test(text)) {
    const track = getCurrentTrack();
    if (!track || !track.title) return 'Nothing is playing right now.';
    return `Now playing "${track.title}" by ${track.artist} from the album ${track.album}.`;
  }

  return "Sorry, I didn't understand that command. Try asking about the weather, time, chores, or music.";
}
