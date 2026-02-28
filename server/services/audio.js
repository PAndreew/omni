/**
 * Audio metadata bridge.
 *
 * Reads nowplaying.json written by librespot's --onevent handler,
 * then enriches with metadata from Spotify's embed page.
 */

import { readFileSync, watch } from 'fs';
import { execSync } from 'child_process';

const NOWPLAYING_PATH = process.env.DB_PATH
  ? process.env.DB_PATH.replace('omniwall.db', 'nowplaying.json')
  : '/home/pi/Documents/omni/server/data/nowplaying.json';

let io = null;
let currentTrack = null;
let lastTrackId = null;
let metaCache = new Map(); // trackId → metadata

// ─── Spotify metadata via embed page ─────────────────────────────────────────

async function fetchSpotifyMeta(trackId) {
  if (metaCache.has(trackId)) return metaCache.get(trackId);
  try {
    const res = await fetch(`https://open.spotify.com/embed/track/${trackId}`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await res.text();

    // Extract the JSON entity data Spotify embeds in the page
    const m = html.match(/"name":"([^"]+)","uri":"spotify:track:[^"]+","artists":\[(\{[^\]]+\})\]/);
    let title = '', artist = '', art = '';

    if (m) {
      title = m[1];
      const artistMatch = m[2].match(/"name":"([^"]+)"/);
      if (artistMatch) artist = artistMatch[1];
    }

    // Album art from oEmbed (simpler, reliable)
    const oembed = await fetch(
      `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`,
      { signal: AbortSignal.timeout(3000) }
    ).then(r => r.json()).catch(() => ({}));

    art = oembed.thumbnail_url || '';
    if (!title && oembed.title) title = oembed.title;

    const meta = { title, artist, art };
    metaCache.set(trackId, meta);
    // Cap cache size
    if (metaCache.size > 50) metaCache.delete(metaCache.keys().next().value);
    return meta;
  } catch {
    return { title: '', artist: '', art: '' };
  }
}

// ─── Read and process nowplaying.json ────────────────────────────────────────

async function processNowPlaying() {
  let data;
  try {
    const raw = readFileSync(NOWPLAYING_PATH, 'utf8').trim();
    if (!raw) return;
    data = JSON.parse(raw);
  } catch {
    return;
  }

  if (data.event === 'preloading') return; // ignore pre-buffer events

  if (data.event === 'stopped' || data.event === 'session_disconnected') {
    const track = null;
    if (JSON.stringify(track) !== JSON.stringify(currentTrack)) {
      currentTrack = track;
      io?.emit('audio:track', track);
    }
    return;
  }

  const { trackId, event, positionMs, durationMs } = data;
  if (!trackId) return;

  const status = event === 'paused' ? 'paused' : 'playing';

  // Fetch metadata if we have a new track
  let meta = { title: '', artist: '', art: '' };
  if (trackId !== lastTrackId) {
    lastTrackId = trackId;
    meta = await fetchSpotifyMeta(trackId);
  } else if (currentTrack) {
    meta = { title: currentTrack.title, artist: currentTrack.artist, art: currentTrack.art };
  } else {
    meta = await fetchSpotifyMeta(trackId);
  }

  const track = {
    title:    meta.title,
    artist:   meta.artist,
    album:    '',
    art:      meta.art || null,
    status,
    position: positionMs || 0,
    duration: durationMs || 0,
    source:   'spotify',
  };

  if (JSON.stringify(track) !== JSON.stringify(currentTrack)) {
    currentTrack = track;
    io?.emit('audio:track', track);
  }
}

// ─── Player control ───────────────────────────────────────────────────────────

export function sendCommand(cmd) {
  const map = {
    play:   'playerctl play',
    pause:  'playerctl pause',
    toggle: 'playerctl play-pause',
    next:   'playerctl next',
    prev:   'playerctl previous',
  };
  try { if (map[cmd]) execSync(map[cmd], { stdio: 'ignore', timeout: 2000 }); } catch {}
}

export function getCurrentTrack() { return currentTrack; }

// ─── Start ────────────────────────────────────────────────────────────────────

export function startAudioBridge(socketIo) {
  io = socketIo;

  // Initial read
  processNowPlaying();

  // Watch for changes from librespot event handler
  try {
    watch(NOWPLAYING_PATH, () => {
      setTimeout(processNowPlaying, 100); // small delay for file write to complete
    });
  } catch {
    // If watch fails, fall back to polling
    setInterval(processNowPlaying, 2000);
  }

  // Also poll every 5s as a safety net (updates position)
  setInterval(processNowPlaying, 5000);
}
