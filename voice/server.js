import express from 'express';
import { translatorRouter } from './translator-router.js';
import { musicRouter } from './music-router.js';
import { WakeDetector } from './wake.js';
import { MusicResolution } from './music-resolution.js';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validKey, sameOrigin, DailyBudget, AudioGate } from './limits.js';
import { fileUploadRouter } from './file-upload.js';
import { SpotifyController } from './spotify.js';
import { HouseholdMetadata } from './metadata.js';
import { createHouseholdAgent } from './agent.js';
import { googleClient } from './google.js';
import { connectRecordedSpeech, transcribeAudio, synthesizeHungarian, TRANSCRIBE_MODEL, HUNGARIAN_VOICE } from './speech.js';

const root = path.dirname(fileURLToPath(import.meta.url));
export function createVoiceServer({ stateDir, accessKey, connect, metadata, controller, wake = null, uploadHome, dailySeconds = 900, sessionSeconds = 90, transcriptionModel = TRANSCRIBE_MODEL, frontend = path.join(root, '../client/dist'), dashboard = 'http://127.0.0.1:3001' }) {
  if (!Number.isInteger(sessionSeconds) || sessionSeconds < 1 || sessionSeconds > 120) throw new Error('Invalid voice session duration.');
  const budget = new DailyBudget(stateDir, dailySeconds);
  const app = express();
  app.disable('x-powered-by');
  const browserSession = randomBytes(32).toString('hex');
  const paired = req => req.headers.cookie?.split(';').some(part => part.trim() === `gizi-session=${browserSession}`);
  app.post('/gizi/session', (req, res) => {
    if (!sameOrigin(req.headers.origin, req.headers.host)) return res.sendStatus(403);
    res.setHeader('Set-Cookie', `gizi-session=${browserSession}; HttpOnly; SameSite=Strict; Path=/gizi; Secure`);
    res.sendStatus(204);
  });
  app.use('/gizi/files', (req, res, next) => {
    if (!paired(req) && !validKey(req.headers.authorization?.replace(/^Bearer /, ''), accessKey)) return res.status(403).json({ error: 'Pair Gizi first.' });
    if (req.method !== 'GET' && !sameOrigin(req.headers.origin, req.headers.host)) return res.status(403).json({ error: 'Same-origin request required.' });
    next();
  }, fileUploadRouter({ home: uploadHome }));
  app.use('/gizi/translations', (req, res, next) => {
    if (!paired(req) && !validKey(req.headers.authorization?.replace(/^Bearer /, ''), accessKey)) return res.status(403).json({ error: 'Pair Gizi or enter the access key first.' });
    if (req.method !== 'GET' && !sameOrigin(req.headers.origin, req.headers.host)) return res.sendStatus(403);
    next();
  }, translatorRouter(stateDir));
  app.use('/gizi/wake', express.json({ limit: '1kb' }), (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!paired(req) && !validKey(req.headers.authorization?.replace(/^Bearer /, ''), accessKey)) return res.sendStatus(403);
    if (req.method !== 'GET' && !sameOrigin(req.headers.origin, req.headers.host)) return res.sendStatus(403);
    next();
  });
  app.get('/gizi/wake', (_req, res) => res.json(wake?.status() || { available: false, enabled: false, ready: false, sequence: 0, at: 0 }));
  app.post('/gizi/wake', (req, res) => {
    if (!wake) return res.status(503).json({ error: 'Wake detector is not installed.' });
    if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'Choose enabled or disabled.' });
    try { wake.setEnabled(req.body.enabled); res.json(wake.status()); }
    catch { res.status(503).json({ error: 'Wake detector unavailable.' }); }
  });
  app.post('/gizi/wake/claim', (req, res) => {
    if (!wake?.claim(req.body.sequence)) return res.sendStatus(409);
    res.sendStatus(204);
  });
  app.use('/gizi/music', (req, res, next) => {
    if (!paired(req) && !validKey(req.headers.authorization?.replace(/^Bearer /, ''), accessKey)) return res.status(403).json({ error: 'Pair Gizi first.' });
    if (req.method !== 'GET' && !sameOrigin(req.headers.origin, req.headers.host)) return res.status(403).json({ error: 'Same-origin request required.' });
    if (!controller) return res.status(503).json({ error: 'Spotify is not configured.' });
    next();
  }, musicRouter(controller));
  app.get('/gizi/aliases', (_req, res) => res.sendFile(path.join(frontend, 'index.html')));
  app.use('/gizi/metadata', express.json({ limit: '8kb' }), (req, res, next) => {
    if (!paired(req) && !validKey(req.headers.authorization?.replace(/^Bearer /, ''), accessKey)) return res.sendStatus(403);
    if (req.method !== 'GET' && !sameOrigin(req.headers.origin, req.headers.host)) return res.sendStatus(403);
    if (!metadata || !controller) return res.sendStatus(503);
    next();
  });
  app.get('/gizi/metadata', async (_req, res) => {
    try { res.json(await metadata.load()); } catch { res.sendStatus(503); }
  });
  app.post('/gizi/metadata', async (req, res) => {
    try {
      const { phrase, track, inflection } = req.body;
      if (typeof phrase !== 'string' || !phrase.trim() || phrase.length > 100 || typeof track !== 'string') throw new Error();
      const id = track.match(/^(?:https:\/\/open\.spotify\.com\/track\/|spotify:track:)?([A-Za-z0-9]{22})(?:\?.*)?$/)?.[1];
      if (!id) throw new Error();
      const song = await controller.request(`tracks/${id}`, AbortSignal.timeout(10000));
      const aliases = [phrase.trim()];
      if (typeof inflection === 'string' && inflection.trim()) { if (inflection.length > 100) throw new Error(); aliases.push(inflection.trim()); }
      const entry = await metadata.add({ kind: 'track', spotifyId: song.id, title: song.name, artists: song.artists.map(a => a.name), aliases });
      res.json(entry);
    } catch { res.status(400).json({ error: 'Invalid track, duplicate alias, or Spotify unavailable. Nothing saved.' }); }
  });
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
  app.get('/gizi/status', (_req, res) => res.json({ ready: true, requiresKey: true, sessionSeconds, dailySeconds, mode: 'recorded-speech', transcriptionModel, language: 'hu-HU' }));
  // Phone view gets only the dashboard's read-only data. Never proxy settings,
  // terminal sockets, writes, or arbitrary URLs from the old Omni application.
  for (const endpoint of ['weather', 'events', 'chores']) app.get(`/api/${endpoint}`, async (_req, res) => {
    try {
      const upstream = await fetch(`${dashboard}/api/${endpoint}`, { signal: AbortSignal.timeout(8000) });
      res.status(upstream.status).json(await upstream.json());
    } catch { res.status(502).json({ error: 'Dashboard unavailable.' }); }
  });
  app.use(express.static(frontend, { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
  app.get('/', (_req, res) => res.sendFile(path.join(frontend, 'index.html')));
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  const attempts = new Map();
  let active = null;
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    const ip = req.socket.remoteAddress;
    const now = Date.now();
    for (const [key, value] of attempts) if (now - value.at > 60000) attempts.delete(key);
    const attempt = attempts.get(ip) || { count: 0, at: now };
    if (req.url !== '/gizi/socket' || !sameOrigin(origin, req.headers.host) || ++attempt.count > 20 || wss.clients.size >= 5) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    attempts.set(ip, attempt);
    wss.handleUpgrade(req, socket, head, ws => { ws.paired = paired(req); wss.emit('connection', ws); });
  });
  wss.on('connection', ws => {
    let authenticated = false, connecting = false, bridge, finished = false;
    let listenTimer, lifetime;
    let inputGraceUntil = 0;
    let submittedBytes = 0;
    const gate = new AudioGate();
    const emit = event => {
      if (ws.readyState !== 1) return;
      if (ws.bufferedAmount > 512000) { finish('Audio connection too slow.'); return; }
      ws.send(JSON.stringify(event));
    };
    const finish = message => {
      if (finished) return;
      finished = true;
      clearTimeout(authTimeout); clearTimeout(lifetime); clearTimeout(listenTimer);
      try { bridge?.dispose(); } catch { /* Continue closing the client even if a provider fails. */ }
      if (active === ws) active = null;
      if (message && ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message }));
      ws.close();
    };
    const authTimeout = setTimeout(() => finish('Voice access key required.'), 5000);
    ws.on('message', async (data, binary) => {
      if (finished) return;
      try {
        if (binary) {
          if (!authenticated || !bridge) throw new Error('Voice is not ready.');
          if (!gate.active && Date.now() < inputGraceUntil) return; // Frames already in flight at the recording cutoff.
          gate.accept(data); submittedBytes += data.length; bridge.audio(data); return;
        }
        const message = JSON.parse(data.toString());
        if (!authenticated) {
          if (message.type !== 'auth' || (!ws.paired && !validKey(message.key, accessKey))) throw new Error('Incorrect voice access key.');
          if (active) throw new Error('Gizi is busy on another device.');
          authenticated = true; active = ws; connecting = true;
          clearTimeout(authTimeout);
          if (budget.remaining() <= 0) throw new Error('Daily voice allowance reached. Try again tomorrow.');
          lifetime = setTimeout(() => finish('Voice session ended. Tap to reconnect.'), sessionSeconds * 1000);
          emit({ type: 'status', state: 'connecting' });
          let timeout;
          try {
            const operation = connect(emit, finish).then(result => {
              if (finished) { result.dispose(); return null; }
              return result;
            });
            bridge = await Promise.race([operation, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Voice startup timed out.')), 20000); })]);
          } finally { clearTimeout(timeout); }
          connecting = false;
          if (!finished) emit({ type: 'ready' });
          return;
        }
        if (message.type === 'stop') { finish(); return; }
        if (connecting || !bridge) throw new Error('Wait for voice to connect.');
        if (message.type === 'start') {
          inputGraceUntil = 0;
          submittedBytes = 0;
          gate.start(); bridge.start();
          listenTimer = setTimeout(() => {
            if (gate.active) {
              try {
                gate.end(); inputGraceUntil = Date.now() + 1000;
                if (submittedBytes) budget.consume(submittedBytes / 32000);
                submittedBytes = 0;
                bridge.end(); emit({ type: 'input_ended' });
              } catch { finish('Daily voice allowance reached. Try again tomorrow.'); }
            }
          }, 15000);
        } else if (message.type === 'end') {
          // 16 kHz mono signed PCM contains 32,000 bytes per second.
          if (gate.active) {
            gate.end(); inputGraceUntil = Date.now() + 1000;
            if (submittedBytes) budget.consume(submittedBytes / 32000);
            submittedBytes = 0;
            bridge.end();
          }
          clearTimeout(listenTimer);
        } else throw new Error('Invalid voice message.');
      } catch (error) {
        // Never relay provider errors, authorization headers, or token bodies.
        const allowed = ['Incorrect voice access key.', 'Gizi is busy on another device.', 'Daily voice allowance reached. Try again tomorrow.', 'Voice startup timed out.'];
        finish(allowed.includes(error.message) ? error.message : 'Voice request failed. Check the local service configuration.');
      }
    });
    ws.on('close', () => finish());
    ws.on('error', () => finish());
  });
  if (wake) wake.canWake = () => active === null;
  return { server, isVoiceActive: () => active !== null, close: () => { wake?.stop(); for (const ws of wss.clients) ws.close(); wss.close(); server.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stateDir = process.env.GIZI_STATE_DIR || path.join(homedir(), '.config/omni-gizi');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(stateDir, 'access-key');
  let accessKey;
  try { accessKey = readFileSync(keyPath, 'utf8').trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; accessKey = randomBytes(18).toString('base64url'); writeFileSync(keyPath, accessKey, { mode: 0o600, flag: 'wx' }); }
  const project = process.env.GIZI_GCP_PROJECT || 'currentlyai';
  const location = process.env.GIZI_GCP_LOCATION || 'eu';
  const transcriptionModel = process.env.GIZI_TRANSCRIBE_MODEL || TRANSCRIBE_MODEL;
  const voiceName = process.env.GIZI_TTS_VOICE || HUNGARIAN_VOICE;
  const controller = new SpotifyController({ tokenPath: process.env.GIZI_SPOTIFY_TOKEN || path.join(homedir(), '.config/omni-spotify/token.json'), stateDir: path.join(stateDir, 'receipts') });
  const resolution = new MusicResolution(); // Pending confirmations survive a fresh wake/voice connection for two minutes.
  const metadata = new HouseholdMetadata(process.env.GIZI_METADATA || path.join(root, 'metadata.json'));
  const wake = new WakeDetector({ stateDir, model: process.env.GIZI_WAKE_MODEL || path.join(stateDir, 'wake-model'), python: process.env.GIZI_WAKE_PYTHON || path.join(root, 'wake/.venv/bin/python'), source: process.env.GIZI_WAKE_SOURCE || '@DEFAULT_SOURCE@', enabled: process.env.GIZI_WAKE_ENABLED === '1' });
  const voice = createVoiceServer({
    stateDir, accessKey, transcriptionModel, metadata, controller, wake,
    dailySeconds: Number(process.env.GIZI_DAILY_SECONDS || 900),
    sessionSeconds: Number(process.env.GIZI_SESSION_SECONDS || 120),
    connect: async (emit, closed) => {
      let agent;
      try {
        const client = await googleClient({ project, location });
        agent = await createHouseholdAgent({ controller, metadata, stateDir, resolution, provider: process.env.GIZI_PI_PROVIDER, modelId: process.env.GIZI_PI_MODEL });
        return connectRecordedSpeech({
          agent, emit, closed,
          transcribe: async (pcm, signal) => transcribeAudio({ client, pcm, signal, model: transcriptionModel, customVocabulary: await metadata.vocabulary() }),
          synthesize: (text, signal) => synthesizeHungarian({ text, project, signal, voice: voiceName }),
        });
      } catch (error) {
        agent?.dispose();
        console.error('[Gizi] Startup failed:', error.name, 'See voice/README.md for credential and project checks.');
        throw error;
      }
    },
  });
  voice.server.listen(Number(process.env.GIZI_PORT || 3002), '127.0.0.1', () => {
    console.log(`[Gizi] Local voice service ready. Project=${project}; key file=${keyPath}`);
    wake.start();
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { voice.close(); setTimeout(() => process.exit(0), 500).unref(); });
}
