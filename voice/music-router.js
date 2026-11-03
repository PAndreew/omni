import express from 'express';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { musicItem } from './spotify.js';
import { SimilarRadio } from './similar-radio.js';
import { reconnectSpeaker, getSpeakerVolume, setSpeakerVolume } from './speaker.js';
import { restartSpotifyService } from './spotify-service.js';

export function musicRouter(controller) {
  const router = express.Router();
  router.use(express.json({ limit: '2kb' }));
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const radio = new SimilarRadio(controller);
  router.get('/radio', (_req, res) => res.json(radio.status()));
  router.post('/radio', (req, res) => {
    if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean.' });
    res.json(radio.configure(req.body.enabled));
  });
  let lastTrack, lastPlaylist, recentCache, recentAt = 0;
  const run = handler => async (req, res) => {
    try { await handler(req, res, AbortSignal.timeout(20000)); }
    catch (error) { res.status(error.status === 503 ? 503 : 502).json({ error: error.message || 'Spotify unavailable.' }); }
  };
  let restarting = false, restartAt = 0;
  router.post('/restart', run(async (_req, res) => {
    if (restarting) return res.status(409).json({ error: 'Spotify is already restarting.' });
    if (Date.now() - restartAt < 60000) return res.status(429).json({ error: 'Wait one minute before another restart. Check the device list first.' });
    restarting = true; restartAt = Date.now();
    try { res.json(await restartSpotifyService()); }
    catch (error) { if (error.status === 503) restartAt = 0; throw error; }
    finally { restarting = false; }
  }));
  router.get('/speaker/volume', run(async (_req, res) => res.json(await getSpeakerVolume())));
  router.post('/speaker/volume', run(async (req, res) => {
    if (!Number.isInteger(req.body.percent) || req.body.percent < 0 || req.body.percent > 100) return res.status(400).json({ error: 'Choose a volume from 0 to 100.' });
    res.json(await setSpeakerVolume(req.body.percent));
  }));
  let reconnecting = false;
  router.post('/speaker/reconnect', run(async (_req, res) => {
    if (reconnecting) return res.status(409).json({ error: 'Speaker is already reconnecting.' });
    reconnecting = true;
    try { res.json(await reconnectSpeaker()); }
    finally { reconnecting = false; }
  }));
  const validDevice = id => id === undefined || (typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id));
  router.get('/devices', run(async (_req, res, signal) => {
    const { devices = [] } = await controller.request('me/player/devices', signal);
    const filename = path.join(controller.stateDir, 'music-devices.json');
    let known = [];
    try { known = JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const online = devices.filter(device => device.id).map(device => ({ id: device.id, name: device.name, type: device.type, active: Boolean(device.is_active), restricted: Boolean(device.is_restricted), online: true, lastSeen: new Date().toISOString() }));
    const all = [...online, ...known.filter(device => !online.some(current => current.id === device.id)).map(device => ({ ...device, online: false, active: false }))].slice(0, 30);
    await mkdir(controller.stateDir, { recursive: true, mode: 0o700 });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(all), { mode: 0o600 });
    await rename(temporary, filename);
    res.json(all);
  }));
  router.post('/connect', run(async (req, res, signal) => {
    const id = req.body.deviceId;
    if (!id || !validDevice(id)) return res.status(400).json({ error: 'Select a valid device.' });
    const { devices = [] } = await controller.request('me/player/devices', signal);
    const device = devices.find(device => device.id === id && !device.is_restricted);
    if (!device) return res.status(409).json({ error: 'Device is offline or restricted. Open Spotify on it and refresh.' });
    await controller.request('me/player', signal, { method: 'PUT', operationId: randomUUID(), body: { device_ids: [id], play: true } });
    res.json({ accepted: true, device: device.name });
  }));
  router.get('/state', run(async (_req, res, signal) => {
    const state = await controller.request('me/player', signal);
    const track = state.item?.type === 'track' ? musicItem(state.item) : null;
    if (track && track.uri !== lastTrack) {
      try { await controller.recordHistory(track); lastTrack = track.uri; } catch { /* Playback state remains usable. */ }
    }
    const uri = state.context?.uri;
    if (uri?.startsWith('spotify:playlist:') && uri !== lastPlaylist) {
      try {
        const item = await controller.request(`playlists/${uri.split(':')[2]}`, signal);
        await controller.recordHistory(musicItem(item, 'playlist')); lastPlaylist = uri;
      } catch { /* A deleted/private playlist must not hide playback state. */ }
    }
    res.json({ track, playing: Boolean(state.is_playing), device: state.device?.name || null, deviceId: state.device?.id || null, position: state.progress_ms || 0, duration: state.item?.duration_ms || 0 });
  }));
  router.get('/search', run(async (req, res, signal) => {
    const query = req.query.q;
    if (typeof query !== 'string' || !query.trim() || query.length > 200) return res.status(400).json({ error: 'Enter a search up to 200 characters.' });
    const result = await controller.request(`search?${new URLSearchParams({ q: query.trim(), type: 'track,playlist', limit: '10' })}`, signal);
    res.json({ tracks: (result.tracks?.items || []).filter(Boolean).map(item => musicItem(item)), playlists: (result.playlists?.items || []).filter(Boolean).map(item => musicItem(item, 'playlist')) });
  }));
  router.get('/library', run(async (_req, res, signal) => {
    const result = await controller.request('me/playlists?limit=50', signal);
    res.json((result.items || []).filter(Boolean).map(item => musicItem(item, 'playlist')));
  }));
  router.get('/recent', run(async (_req, res, signal) => {
    if (!recentCache || Date.now() - recentAt > 60000) {
      try {
        const result = await controller.request('me/player/recently-played?limit=30', signal);
        recentCache = { tracks: (result.items || []).filter(entry => entry.track).map(entry => ({ ...musicItem(entry.track), playedAt: entry.played_at })), notice: null };
      } catch {
        recentCache = { tracks: [], notice: 'Showing history recorded by Beezywall. Spotify account-wide history needs the user-read-recently-played permission; reconnect Spotify with that scope to enable it.' };
      }
      recentAt = Date.now();
    }
    const local = await controller.history();
    const unique = items => items.filter((item, index) => items.findIndex(other => other.uri === item.uri) === index);
    // Preserve the most recent occurrence, not the oldest duplicate.
    const tracks = [...recentCache.tracks, ...local.filter(item => item.kind === 'track')].sort((a, b) => (b.playedAt || '').localeCompare(a.playedAt || ''));
    res.json({ tracks: unique(tracks).slice(0, 20), playlists: unique(local.filter(item => item.kind === 'playlist')).slice(0, 12), notice: recentCache.notice });
  }));
  router.post('/play', run(async (req, res, signal) => {
    if (!validDevice(req.body.deviceId)) return res.status(400).json({ error: 'Invalid device.' });
    const match = typeof req.body.uri === 'string' && req.body.uri.match(/^spotify:(track|playlist):([A-Za-z0-9]{22})$/);
    if (!match) return res.status(400).json({ error: 'Choose a Spotify track or playlist.' });
    res.json(await controller.playback(match[1] === 'track' ? 'play_track' : 'play_playlist', signal, randomUUID(), match[1] === 'track' ? match[2] : undefined, match[1] === 'playlist' ? match[2] : undefined, req.body.deviceId));
  }));
  router.post('/command', run(async (req, res, signal) => {
    if (!['resume', 'pause', 'next', 'previous'].includes(req.body.action)) return res.status(400).json({ error: 'Unsupported playback command.' });
    if (!validDevice(req.body.deviceId)) return res.status(400).json({ error: 'Invalid device.' });
    res.json(await controller.playback(req.body.action, signal, randomUUID(), undefined, undefined, req.body.deviceId));
  }));
  return router;
}
