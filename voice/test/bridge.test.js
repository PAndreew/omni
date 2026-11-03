import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createVoiceServer } from '../server.js';
import { createHouseholdAgent } from '../agent.js';
import { HouseholdMetadata } from '../metadata.js';

async function fixture(t, connect) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'gizi-ws-'));
  const voice = createVoiceServer({ stateDir, accessKey: 'test-key', connect });
  voice.server.listen(0, '127.0.0.1'); await once(voice.server, 'listening');
  t.after(() => { voice.close(); return rm(stateDir, { recursive: true, force: true }); });
  const host = `127.0.0.1:${voice.server.address().port}`;
  return { ...voice, host, url: `ws://${host}/gizi/socket` };
}
function messages(ws) {
  const events = [];
  ws.on('message', data => events.push(JSON.parse(data.toString())));
  return events;
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('unauthenticated clients never create a cloud session', async t => {
  let connects = 0;
  const f = await fixture(t, async () => { connects++; });
  const ws = new WebSocket(f.url, { origin: `http://${f.host}` });
  await once(ws, 'open');
  const events = messages(ws);
  const closed = once(ws, 'close');
  ws.send(JSON.stringify({ type: 'auth', key: 'wrong' }));
  await closed;
  assert.equal(connects, 0);
  assert.match(events[0].message, /Incorrect/);
});

test('authenticated lifecycle transports PCM and cleans up on disconnect', async t => {
  const actions = [];
  const f = await fixture(t, async () => ({ start: () => actions.push('start'), audio: b => actions.push(b.length), end: () => actions.push('end'), dispose: () => actions.push('dispose') }));
  const ws = new WebSocket(f.url, { origin: `http://${f.host}` });
  await once(ws, 'open');
  const events = messages(ws);
  ws.send(JSON.stringify({ type: 'auth', key: 'test-key' }));
  await until(() => events.some(e => e.type === 'ready'));
  ws.send(JSON.stringify({ type: 'start' })); ws.send(Buffer.alloc(3200)); ws.send(JSON.stringify({ type: 'end' }));
  await until(() => actions.includes('end'));
  const closed = once(ws, 'close'); ws.close(); await closed;
  await until(() => actions.includes('dispose'));
  assert.deepEqual(actions, ['start', 3200, 'end', 'dispose']);
});

test('cross-origin browser cannot open the bridge', async t => {
  const f = await fixture(t, async () => assert.fail('must not connect'));
  const ws = new WebSocket(f.url, { origin: 'https://evil.example' });
  ws.on('error', () => {});
  const [response] = await once(ws, 'unexpected-response').then(([, response]) => [response]);
  assert.equal(response.statusCode, 403); ws.terminate();
});

test('phone server does not expose settings or shell sockets', async t => {
  const f = await fixture(t, async () => {});
  for (const route of ['/api/settings', '/socket.io/', '/api/audio/play']) {
    assert.equal((await fetch(`http://${f.host}${route}`)).status, 404);
  }
});

test('actual Pi SDK exposes only the seven household tools, without personal resources', async t => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'gizi-agent-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const metadataFile = path.join(stateDir, 'metadata.json');
  await (await import('node:fs/promises')).writeFile(metadataFile, JSON.stringify({ version: 1, entries: [{ kind: 'track', spotifyId: '3uUuGVFu1V7jTQL60S1r8z', title: 'Where Are You Now', artists: ['Lost Frequencies'], aliases: ['órás'] }] }));
  const agent = await createHouseholdAgent({ controller: {}, metadata: new HouseholdMetadata(metadataFile), stateDir, authPath: path.join(stateDir, 'auth.json'), provider: 'openai-codex', modelId: 'gpt-6-astra' });
  assert.deepEqual(agent.activeTools.sort(), ['music_web_search', 'request_music_confirmation', 'resolve_household_music', 'spotify_add_to_csajok', 'spotify_get_csajok', 'spotify_playback', 'spotify_search_tracks']);
  agent.dispose();
});
