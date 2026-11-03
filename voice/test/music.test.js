import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { SpotifyController } from '../spotify.js';
import { createVoiceServer } from '../server.js';

const trackId = '1234567890123456789012';
const playlistId = 'abcdefghijklmnopqrstuv';
const track = { id: trackId, uri: `spotify:track:${trackId}`, type: 'track', name: 'Song fixture', artists: [{ name: 'Artist fixture' }], album: { images: [] } };
const playlist = { id: playlistId, uri: `spotify:playlist:${playlistId}`, name: 'Playlist fixture', owner: { display_name: 'Household' } };
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('music API authenticates, searches, persists history, and plays only on OmniWall', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'beezy-music-'));
  const tokenPath = path.join(dir, 'token.json');
  await writeFile(tokenPath, JSON.stringify({ access_token: 'fake', expires_at: Date.now() / 1000 + 1000 }));
  const mutations = [];
  let devices = [{ id: 'wall', name: 'OmniWall', is_restricted: false }, { id: 'phone', name: 'Phone' }];
  const controller = new SpotifyController({ tokenPath, stateDir: dir, fetchImpl: async (url, options) => {
    const endpoint = url.split('/v1/')[1];
    if (options.method !== 'GET') {
      mutations.push({ endpoint, body: JSON.parse(options.body || '{}') });
      return endpoint === 'me/player' ? new Response('Juqm6CV8fU', { status: 202, headers: { 'Content-Type': 'text/plain' } }) : new Response(null, { status: 204 });
    }
    if (endpoint === 'me/player/devices') return json({ devices });
    if (endpoint === 'me/player') return json({ item: track, context: { uri: playlist.uri }, device: devices[0], is_playing: true });
    if (endpoint.startsWith('search?')) {
      // Spotify's current search API allows at most ten items per type.
      assert.equal(new URL(url).searchParams.get('limit'), '10');
      return json({ tracks: { items: [track] }, playlists: { items: [null, playlist] } });
    }
    if (endpoint.startsWith('me/playlists')) return json({ items: [playlist] });
    if (endpoint.startsWith('me/player/recently-played')) return new Response(null, { status: 403 });
    if (endpoint === `tracks/${trackId}`) return json(track);
    if (endpoint === `playlists/${playlistId}`) return json(playlist);
    throw new Error(`Unexpected endpoint ${endpoint}`);
  } });
  const service = createVoiceServer({ stateDir: dir, accessKey: 'test-key', controller });
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  t.after(async () => { await new Promise(resolve => service.server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const auth = { Authorization: 'Bearer test-key' };
  const post = (endpoint, body, origin = base) => fetch(`${base}/gizi/music/${endpoint}`, { method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/gizi/music/recent`)).status, 403);
  assert.equal((await post('play', { uri: playlist.uri }, 'https://evil.example')).status, 403);
  assert.equal((await post('play', { uri: 'https://evil.example' })).status, 400);
  assert.equal((await post('command', { action: 'delete' })).status, 400);
  const search = await (await fetch(`${base}/gizi/music/search?q=song`, { headers: auth })).json();
  assert.equal(search.tracks[0].title, track.name); assert.equal(search.playlists.length, 1);
  assert.equal((await fetch(`${base}/gizi/music/search`, { headers: auth })).status, 400);
  const state = await (await fetch(`${base}/gizi/music/state`, { headers: auth })).json(); assert.equal(state.track.title, track.name);
  const history = await (await fetch(`${base}/gizi/music/recent`, { headers: auth })).json();
  assert.equal(history.tracks.length, 1); assert.equal(history.playlists.length, 1); assert.match(history.notice, /permission/);
  assert.equal((await post('play', { uri: playlist.uri })).status, 200);
  assert.equal(mutations[0].endpoint, 'me/player/play?device_id=wall'); assert.equal(mutations[0].body.context_uri, playlist.uri);
  assert.equal((await post('play', { uri: track.uri })).status, 200);
  assert.deepEqual(mutations[1].body.uris, [track.uri]);
  const restored = new SpotifyController({ tokenPath, stateDir: dir }); assert.equal((await restored.history()).length, 2);
  const online = await (await fetch(`${base}/gizi/music/devices`, { headers: auth })).json();
  assert.equal(online.find(device => device.id === 'wall').online, true);
  assert.equal((await post('connect', { deviceId: 'wall' })).status, 200);
  assert.deepEqual(mutations[2].body, { device_ids: ['wall'], play: true });
  assert.equal((await post('connect', { deviceId: 'missing' })).status, 409);
  assert.equal((await post('connect', { deviceId: 'bad/id' })).status, 400);
  devices = [{ id: 'phone', name: 'Phone' }];
  const offline = await (await fetch(`${base}/gizi/music/devices`, { headers: auth })).json();
  assert.equal(offline.find(device => device.id === 'wall').online, false);
  assert.equal((await post('play', { uri: playlist.uri })).status, 502); assert.equal(mutations.length, 3);
  assert.equal((await post('play', { uri: track.uri, deviceId: 'phone' })).status, 200);
  assert.equal(mutations[3].endpoint, 'me/player/play?device_id=phone');
});
