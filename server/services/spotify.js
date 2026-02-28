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

async function getOmniWallDeviceId(token) {
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const { devices } = await res.json();
    const device = devices?.find(d => d.name === 'OmniWall') || devices?.[0];
    if (device) console.log('[Spotify] Found device:', device.name, device.id);
    return device?.id || null;
  } catch {
    return null;
  }
}

async function transferPlayback(token, deviceId) {
  await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  });
  // Give Spotify a moment to register the transfer
  await new Promise(r => setTimeout(r, 800));
}

async function spotifyFetch(token, endpoint, method = 'GET', body) {
  const res = await fetch(`https://api.spotify.com/v1/${endpoint}`, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

export async function spotifyCommand(cmd) {
  const token = await getAccessToken();
  if (!token) return false;

  const map = {
    play:   { method: 'PUT',  endpoint: 'me/player/play' },
    pause:  { method: 'PUT',  endpoint: 'me/player/pause' },
    toggle: { method: 'GET',  endpoint: 'me/player' },
    next:   { method: 'POST', endpoint: 'me/player/next' },
    prev:   { method: 'POST', endpoint: 'me/player/previous' },
  };

  const action = map[cmd];
  if (!action) return false;

  try {
    // Handle toggle
    if (cmd === 'toggle') {
      const stateRes = await spotifyFetch(token, 'me/player');
      if (stateRes.status === 204) return false;
      const state = await stateRes.json();
      const endpoint = state.is_playing ? 'me/player/pause' : 'me/player/play';
      await spotifyFetch(token, endpoint, 'PUT');
      return true;
    }

    let res = await spotifyFetch(token, action.endpoint, action.method);

    // If no active device, find OmniWall and transfer playback, then retry once
    if (res.status === 404 || res.status === 403) {
      const errBody = await res.json().catch(() => ({}));
      if (errBody?.error?.reason === 'NO_ACTIVE_DEVICE') {
        console.log('[Spotify] No active device — transferring to OmniWall...');
        const deviceId = await getOmniWallDeviceId(token);
        if (deviceId) {
          await transferPlayback(token, deviceId);
          res = await spotifyFetch(token, action.endpoint, action.method);
        }
      }
      if (res.status >= 400) {
        const body = await res.json().catch(() => ({}));
        console.error(`[Spotify] Command '${cmd}' failed ${res.status}:`, JSON.stringify(body));
        return false;
      }
    }

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
    const deviceId = await getOmniWallDeviceId(token);
    const body = { uris: [uri], ...(deviceId ? { device_id: deviceId } : {}) };
    const res = await fetch('https://api.spotify.com/v1/me/player/play', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[Spotify] Play track failed:', JSON.stringify(err));
    }
    return res.status < 400;
  } catch {
    return false;
  }
}
