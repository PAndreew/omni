import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Type } from '@earendil-works/pi-ai';

export const CSAJOK = '24zkMDCr0Km6Qc47GYZvhn';
const idPattern = /^[A-Za-z0-9]{22}$/;

export class SpotifyController {
  constructor({ tokenPath, stateDir, fetchImpl = fetch, playlistId = CSAJOK }) {
    this.tokenPath = tokenPath;
    this.stateDir = stateDir;
    this.fetch = fetchImpl;
    this.playlistId = playlistId;
    this.cooldownUntil = 0;
    this.refreshPromise = null;
  }
  async token(signal) {
    const token = JSON.parse(await readFile(this.tokenPath, 'utf8'));
    if (token.expires_at > Date.now() / 1000 + 60) return token.access_token;
    if (!this.refreshPromise) this.refreshPromise = this.refresh(token, signal).finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }
  async refresh(token, signal) {
    const res = await this.fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: token.client_id }),
    });
    if (!res.ok) throw new Error('Spotify authorization expired. Owner must reconnect Spotify.');
    const updated = { ...token, ...await res.json() };
    updated.expires_at = Date.now() / 1000 + updated.expires_in;
    await writeFile(`${this.tokenPath}.tmp`, JSON.stringify(updated), { mode: 0o600 });
    await rename(`${this.tokenPath}.tmp`, this.tokenPath);
    return updated.access_token;
  }
  async request(endpoint, signal, { method = 'GET', body, operationId } = {}) {
    if (Date.now() < this.cooldownUntil) throw new Error('Spotify is rate limited. Please try again later.');
    signal.throwIfAborted();
    const token = await this.token(signal);
    const mutation = method !== 'GET';
    const receiptPath = operationId && path.join(this.stateDir, `spotify-${operationId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    if (mutation && !receiptPath) throw new Error('Mutation requires an operation ID.');
    if (receiptPath) {
      await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
      try {
        const existing = JSON.parse(await readFile(receiptPath, 'utf8'));
        if (existing.status === 'completed') return existing.result;
        throw new Error('This operation has already been attempted. Its outcome must be checked before retrying.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await writeFile(receiptPath, JSON.stringify({ status: 'pending', endpoint, method, at: new Date().toISOString() }), { mode: 0o600 });
    }
    let response;
    try {
      response = await this.fetch(`https://api.spotify.com/v1/${endpoint}`, {
        method, signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error(mutation ? 'Spotify outcome unknown: the action might have completed. Check state; do not repeat blindly.' : 'Spotify could not be reached.');
    }
    if (response.status === 429) {
      this.cooldownUntil = Date.now() + Math.max(1, Number(response.headers.get('retry-after')) || 60) * 1000;
      throw new Error('Spotify rate limit reached. Retry later, not in a loop.');
    }
    if (!response.ok) throw new Error(`Spotify returned ${response.status}. No success confirmed.`);
    const result = response.status === 204 ? { accepted: true } : await response.json();
    if (receiptPath) await writeFile(receiptPath, JSON.stringify({ status: 'completed', result, at: new Date().toISOString() }), { mode: 0o600 });
    return result;
  }
  async tracks(signal) {
    const tracks = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await this.request(`playlists/${this.playlistId}/items?limit=100&offset=${offset}`, signal);
      tracks.push(...(page.items || []).map(item => item.item || item.track).filter(Boolean));
      if (!page.next) return tracks;
    }
    throw new Error('Playlist too large for a safe voice edit.');
  }
  async add(trackIds, signal, operationId) {
    if (!trackIds.length || trackIds.length > 20 || trackIds.some(id => !idPattern.test(id))) throw new Error('Invalid track IDs.');
    const before = await this.tracks(signal);
    const existing = new Set(before.map(t => t.id));
    const missing = [...new Set(trackIds)].filter(id => !existing.has(id));
    if (!missing.length) return { added: 0, alreadyPresent: true, playlist: 'csajok' };
    await this.request(`playlists/${this.playlistId}/items`, signal, { method: 'POST', body: { uris: missing.map(id => `spotify:track:${id}`) }, operationId });
    const after = new Set((await this.tracks(signal)).map(t => t.id));
    if (!missing.every(id => after.has(id))) throw new Error('Addition accepted but verification incomplete. Do not add again automatically.');
    return { added: missing.length, verified: true, playlist: 'csajok' };
  }
  async playback(action, signal, operationId, trackId) {
    if (action === 'play_track' && !idPattern.test(trackId || '')) throw new Error('A valid resolved Spotify track ID is required.');
    if (action !== 'play_track' && trackId !== undefined) throw new Error('Track ID is only accepted for play_track.');
    const { devices = [] } = await this.request('me/player/devices', signal);
    const matching = devices.filter(device => device.name === 'OmniWall' && !device.is_restricted);
    if (matching.length !== 1) throw new Error('OmniWall is offline or ambiguous. No other device will be used.');
    const device = matching[0];
    if (action === 'status') {
      const state = await this.request('me/player', signal);
      return { device: state.device?.name || null, playing: state.is_playing || false, track: state.item?.name || null };
    }
    const commands = {
      play_csajok: { method: 'PUT', suffix: 'play', body: { context_uri: `spotify:playlist:${this.playlistId}` } },
      play_track: { method: 'PUT', suffix: 'play', body: { uris: [`spotify:track:${trackId}`] } },
      resume: { method: 'PUT', suffix: 'play' }, pause: { method: 'PUT', suffix: 'pause' },
      next: { method: 'POST', suffix: 'next' }, previous: { method: 'POST', suffix: 'previous' },
    };
    const command = commands[action];
    if (!command) throw new Error('Unsupported playback action.');
    await this.request(`me/player/${command.suffix}?device_id=${encodeURIComponent(device.id)}`, signal, { ...command, operationId });
    return { accepted: true, device: device.name, action, ...(trackId ? { trackId } : {}), note: 'Spotify accepted the command; audible playback is not verified.' };
  }
}

export function spotifyTools(controller, metadata) {
  const tool = (name, description, parameters, run) => ({
    name, label: name, description, parameters,
    execute: async (callId, args, signal) => {
      const result = await run(args, signal, callId);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  });
  return [
    tool('resolve_household_music', 'Resolve an exact child/family nickname from the trusted household metadata store. Call this before Spotify search when the user uses a nickname or unfamiliar short word. A null result means no alias exists.', Type.Object({ alias: Type.String({ minLength: 1, maxLength: 100 }) }), async ({ alias }) => metadata ? metadata.resolve(alias) : null),
    tool('spotify_search_tracks', 'Search Spotify. Resolve exact title and artist; ask if ambiguous. Search is read-only.', Type.Object({ query: Type.String({ minLength: 1, maxLength: 200 }) }), async ({ query }, signal) => {
      const result = await controller.request(`search?${new URLSearchParams({ q: query, type: 'track', limit: '5' })}`, signal);
      return (result.tracks?.items || []).map(track => ({ id: track.id, title: track.name, artists: track.artists.map(a => a.name), explicit: track.explicit }));
    }),
    tool('spotify_get_csajok', 'Read the approved family playlist csajok. Returns total count and at most 100 tracks.', Type.Object({}), async (_, signal) => {
      const tracks = await controller.tracks(signal);
      return { total: tracks.length, truncated: tracks.length > 100, tracks: tracks.slice(0, 100).map(t => ({ id: t.id, title: t.name, artists: t.artists?.map(a => a.name) })) };
    }),
    tool('spotify_add_to_csajok', 'Add resolved Spotify track IDs to csajok, skipping existing tracks and verifying additions. No other playlist can be changed.', Type.Object({ trackIds: Type.Array(Type.String({ pattern: '^[A-Za-z0-9]{22}$' }), { minItems: 1, maxItems: 20 }) }), ({ trackIds }, signal, callId) => controller.add(trackIds, signal, callId)),
    tool('spotify_playback', 'Control only the OmniWall Spotify device. play_track plays a specific song: first resolve its exact ID with spotify_search_tracks; supply trackId. play_csajok starts the family playlist. Never fall back to another device.', Type.Object({
      action: Type.Union(['status', 'play_csajok', 'play_track', 'resume', 'pause', 'next', 'previous'].map(Type.Literal)),
      trackId: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9]{22}$', description: 'Required only for play_track. Resolve using Spotify search; never invent an ID.' })),
    }), ({ action, trackId }, signal, callId) => controller.playback(action, signal, callId, trackId)),
  ];
}
