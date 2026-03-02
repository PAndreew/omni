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
import { initAgent, processVoiceCommand } from './services/agent.js';
import { startWhisper } from './services/whisper.js';
import db from './db.js';

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
  console.log(`[Voice] Processing command: "${text}"`);
  const reply = await processVoiceCommand(text?.toLowerCase() || '');
  console.log(`[Voice] Agent reply: "${reply}"`);
  io.emit('voice:reply', { text: reply });
  res.json({ reply });
});

// Whisper transcription proxy — receives raw WAV, forwards to local whisper_server.py
app.post('/api/voice/transcribe', express.raw({ type: 'audio/*', limit: '50mb' }), async (req, res) => {
  try {
    const mime = req.headers['content-type'] || 'audio/webm';
    const ext  = mime.includes('mp4') ? '.mp4' : mime.includes('ogg') ? '.ogg' : mime.includes('wav') ? '.wav' : '.webm';
    const lang = db.prepare("SELECT value FROM settings WHERE key='voice_language'").get()?.value || 'hu';
    const form = new FormData();
    form.append('file', new Blob([req.body], { type: mime }), `audio${ext}`);
    form.append('language', lang);
    const resp = await fetch('http://127.0.0.1:8765/inference', { method: 'POST', body: form });
    res.json(await resp.json());
  } catch (err) {
    res.status(503).json({ error: 'Whisper unavailable', detail: err.message });
  }
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
  console.log(`[WS] Client connected: ${socket.id} from ${socket.handshake.address} (UA: ${socket.handshake.headers['user-agent']})`);
  
  // Debug all incoming events
  socket.onAny((event, ...args) => {
    if (!event.startsWith('audio:')) {
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
initAgent(io);
startWhisper();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🖥️  OmniWall server running at http://0.0.0.0:${PORT}`);
  console.log(`   Local network:  http://192.168.0.141:${PORT}`);
  console.log(`   Tailscale IP:   http://100.64.243.93:${PORT}`);
  console.log(`   Tailscale DNS:  http://raspberrypi.tailf0acdd.ts.net:${PORT}`);
});

