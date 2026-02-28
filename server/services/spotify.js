import db from '../db.js';

let accessToken = null;
let tokenExpires = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpires) return accessToken;

  const clientId = db.prepare("SELECT value FROM settings WHERE key='spotify_client_id'").get()?.value;
  const clientSecret = db.prepare("SELECT value FROM settings WHERE key='spotify_client_secret'").get()?.value;
  const refreshToken = db.prepare("SELECT value FROM settings WHERE key='spotify_refresh_token'").get()?.value;

  if (!clientId || !clientSecret || !refreshToken) return null;

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const data = await res.json();
    if (data.access_token) {
      accessToken = data.access_token;
      tokenExpires = Date.now() + (data.expires_in - 60) * 1000;
      return accessToken;
    }
  } catch (err) {
    console.error('[Spotify] Token refresh failed:', err);
  }
  return null;
}

export async function spotifyCommand(cmd) {
  const token = await getAccessToken();
  if (!token) return false;

  const map = {
    play:   { method: 'PUT',  endpoint: 'me/player/play' },
    pause:  { method: 'PUT',  endpoint: 'me/player/pause' },
    toggle: { method: 'GET',  endpoint: 'me/player' }, // special case handled below
    next:   { method: 'POST', endpoint: 'me/player/next' },
    prev:   { method: 'POST', endpoint: 'me/player/previous' },
  };

  const action = map[cmd];
  if (!action) return false;

  try {
    // Handle toggle
    if (cmd === 'toggle') {
      const stateRes = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (stateRes.status === 204) return false;
      const state = await stateRes.json();
      const isPlaying = state.is_playing;
      const endpoint = isPlaying ? 'me/player/pause' : 'me/player/play';
      await fetch(`https://api.spotify.com/v1/${endpoint}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return true;
    }

    const res = await fetch(`https://api.spotify.com/v1/${action.endpoint}`, {
      method: action.method,
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.status < 400;
  } catch (err) {
    console.error('[Spotify] Command failed:', err);
    return false;
  }
}

export async function spotifySearch(query, type = 'track') {
  const token = await getAccessToken();
  if (!token) return [];

  try {
    const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=10`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    return data.tracks?.items || [];
  } catch {
    return [];
  }
}

export async function spotifyPlayTrack(uri) {
  const token = await getAccessToken();
  if (!token) return false;

  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/play', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
    return res.status < 400;
  } catch {
    return false;
  }
}
