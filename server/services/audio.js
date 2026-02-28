/**
 * Audio metadata bridge.
 *
 * Priority order:
 *  1. Spotify local Web API (port 4070) — richest data, works with raspotify
 *  2. playerctl MPRIS — fallback for both Spotify and Tidal
 *
 * Spotify local API note: raspotify/librespot exposes a local HTTP API on
 * port 4070 that returns the currently playing track with album art URLs.
 * This does NOT require a Spotify Premium API token.
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

let io = null;
let currentTrack = null;
let spotifyLocalAvailable = null; // null = unknown, true/false after first check

// ─── Spotify local API (raspotify) ───────────────────────────────────────────

async function getSpotifyLocal() {
  try {
    const resp = await fetch('http://localhost:4070/remote/status.json?oauth=1&csrf=1', {
      signal: AbortSignal.timeout(1500),
      headers: { Origin: 'https://open.spotify.com' },
    });
    if (!resp.ok) { spotifyLocalAvailable = false; return null; }
    const data = await resp.json();
    spotifyLocalAvailable = true;

    if (!data.track) return null;
    const t = data.track;
    return {
      title:   t.track_resource?.name  || '',
      artist:  t.artist_resource?.name || '',
      album:   t.album_resource?.name  || '',
      art:     t.album_resource?.uri
                 ? `https://open.spotify.com/image/${t.album_resource.uri.split(':').pop()}`
                 : null,
      status:  data.playing ? 'playing' : 'paused',
      position: Math.floor((data.playing_position || 0) * 1000),
      duration: Math.floor((t.length || 0) * 1000),
      source:  'spotify',
    };
  } catch {
    spotifyLocalAvailable = false;
    return null;
  }
}

// ─── playerctl fallback ───────────────────────────────────────────────────────

async function getPlayerctl(player = '--player=spotifyd,spotify,tidal,vlc') {
  try {
    const [artist, title, album, status, art, source] = await Promise.all([
      execAsync(`playerctl ${player} metadata artist 2>/dev/null`).then(r => r.stdout.trim()).catch(() => ''),
      execAsync(`playerctl ${player} metadata title 2>/dev/null`).then(r => r.stdout.trim()).catch(() => ''),
      execAsync(`playerctl ${player} metadata album 2>/dev/null`).then(r => r.stdout.trim()).catch(() => ''),
      execAsync(`playerctl ${player} status 2>/dev/null`).then(r => r.stdout.trim().toLowerCase()).catch(() => 'stopped'),
      execAsync(`playerctl ${player} metadata mpris:artUrl 2>/dev/null`).then(r => r.stdout.trim()).catch(() => ''),
      execAsync(`playerctl ${player} metadata --format '{{playerName}}' 2>/dev/null`).then(r => r.stdout.trim().toLowerCase()).catch(() => 'unknown'),
    ]);
    if (!title) return null;
    return {
      title, artist, album,
      art:    art || null,
      status: status === 'playing' ? 'playing' : 'paused',
      source: source.includes('tidal') ? 'tidal' : 'spotify',
    };
  } catch {
    return null;
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

// ─── Poll loop ────────────────────────────────────────────────────────────────

export function startAudioBridge(socketIo) {
  io = socketIo;

  const poll = async () => {
    const track = (await getSpotifyLocal()) || (await getPlayerctl());
    if (JSON.stringify(track) !== JSON.stringify(currentTrack)) {
      currentTrack = track;
      io.emit('audio:track', track);
    }
  };

  poll();
  setInterval(poll, 2000);
}
