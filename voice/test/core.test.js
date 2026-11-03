import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validKey, sameOrigin, DailyBudget, AudioGate } from '../limits.js';
import { PcmResampler } from '../../client/public/gizi/pcm-core.js';
import { SpotifyController, CSAJOK } from '../spotify.js';

async function fixture(t, fetchImpl) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gizi-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tokenPath = path.join(dir, 'token.json');
  await writeFile(tokenPath, JSON.stringify({ access_token: 'test', expires_at: Date.now() / 1000 + 1000 }));
  return new SpotifyController({ tokenPath, stateDir: path.join(dir, 'receipts'), fetchImpl });
}
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('accepted Spotify mutation tolerates a plain-text acknowledgement', async t => {
  let calls = 0;
  const spotify = await fixture(t, async () => { calls++; return new Response('Juqm6CV8fU', { status: 202, headers: { 'Content-Type': 'text/plain' } }); });
  const result = await spotify.request('me/player', AbortSignal.timeout(1000), { method: 'PUT', operationId: 'plain-ack', body: { device_ids: ['wall'], play: true } });
  assert.equal(result.accepted, true);
  const receipt = JSON.parse(await readFile(path.join(spotify.stateDir, 'spotify-plain-ack.json'), 'utf8'));
  assert.equal(receipt.status, 'completed');
  assert.equal((await spotify.request('me/player', AbortSignal.timeout(1000), { method: 'PUT', operationId: 'plain-ack' })).accepted, true);
  assert.equal(calls, 1, 'accepted mutation must not be sent again');
  await assert.rejects(spotify.request('me/player', AbortSignal.timeout(1000)), /invalid data response/);
});

test('keys and origins reject missing, mismatched and cross-origin clients', () => {
  assert.equal(validKey('secret', 'secret'), true);
  for (const wrong of [null, {}, '', 'Secret', 'secret\0']) assert.equal(validKey(wrong, 'secret'), false);
  assert.equal(sameOrigin('https://home.example', 'home.example'), true);
  assert.equal(sameOrigin('http://localhost:5173', 'localhost:5173'), true);
  assert.equal(sameOrigin('https://evil.example', 'home.example'), false);
  assert.equal(sameOrigin(undefined, 'home.example'), false);
});

test('daily usage charges submitted audio, survives restart, and resets next day', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gizi-budget-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const now = new Date('2026-10-05T10:00:00Z');
  const budget = new DailyBudget(dir, 90);
  assert.equal(budget.remaining(now), 90);
  assert.equal(budget.consume(3.25, now).seconds, 3.25);
  assert.equal(new DailyBudget(dir, 90).remaining(now), 86.75);
  assert.throws(() => budget.consume(87, now), /allowance/);
  assert.equal(budget.consume(90, new Date('2026-10-06')).seconds, 90);
  await writeFile(path.join(dir, 'daily-budget.json'), 'broken');
  assert.throws(() => new DailyBudget(dir).remaining(), /unavailable/);
});

test('audio is gated, bounded, even-sized and rate limited', () => {
  let now = 0;
  const gate = new AudioGate(() => now);
  assert.throws(() => gate.accept(Buffer.alloc(3200)));
  gate.start(); assert.throws(() => gate.start());
  assert.throws(() => gate.accept(Buffer.alloc(3)));
  for (let i = 0; i < 20; i++) gate.accept(Buffer.alloc(3200));
  assert.throws(() => gate.accept(Buffer.alloc(3200)), /rate/);
  now = 1001; gate.accept(Buffer.alloc(3200));
  gate.end(); assert.throws(() => gate.accept(Buffer.alloc(3200)));
});

for (const rate of [16000, 44100, 48000]) test(`PCM streams ${rate} Hz into exactly 16000 samples per second`, () => {
  const resampler = new PcmResampler(rate);
  const frames = [];
  const samples = new Float32Array(rate).fill(0.5);
  for (let i = 0; i < rate; i += 128) resampler.push(samples.slice(i, i + 128), frame => frames.push(new Int16Array(frame)));
  resampler.flush(frame => frames.push(new Int16Array(frame)));
  assert.equal(frames.reduce((n, frame) => n + frame.length, 0), 16000);
  // Floating phase at 44.1 kHz can cross a half-LSB rounding boundary.
  assert.ok(frames.every(frame => frame.every(sample => Math.abs(sample - 16384) <= 1)));
});

test('PCM continues after a worklet transfers and detaches emitted buffers', () => {
  const resampler = new PcmResampler(48000);
  const frames = [];
  resampler.push(new Float32Array(48000).fill(0.5), buffer => {
    frames.push(structuredClone(buffer, { transfer: [buffer] }));
  });
  resampler.flush(buffer => frames.push(structuredClone(buffer, { transfer: [buffer] })));
  assert.equal(frames.length, 10);
  assert.ok(frames.every(buffer => buffer.byteLength === 3200));
});

test('Spotify only targets OmniWall; no fallback to a phone', async t => {
  const spotify = await fixture(t, async () => json({ devices: [{ id: 'phone', name: 'Phone' }] }));
  await assert.rejects(spotify.playback('resume', new AbortController().signal, 'op1'), /offline/);
});

test('play_track sends a resolved URI only to the exact OmniWall device', async t => {
  const trackId = '5fwSHlTEWpluwOM0Sxnh5k';
  const writes = [];
  const spotify = await fixture(t, async (url, options) => {
    if (url.endsWith('me/player/devices')) return json({ devices: [{ name: 'Phone', id: 'phone' }, { name: 'OmniWall', id: 'wall' }] });
    writes.push({ url, method: options.method, body: JSON.parse(options.body) });
    return new Response(null, { status: 204 });
  });
  const result = await spotify.playback('play_track', new AbortController().signal, 'track-op', trackId);
  assert.equal(result.device, 'OmniWall');
  assert.equal(result.trackId, trackId);
  assert.deepEqual(writes, [{ url: 'https://api.spotify.com/v1/me/player/play?device_id=wall', method: 'PUT', body: { uris: [`spotify:track:${trackId}`] } }]);
});

test('play_track rejects missing or invalid IDs before making requests', async t => {
  let requests = 0;
  const spotify = await fixture(t, async () => { requests++; });
  for (const trackId of [undefined, '', 'https://evil.example', 'invented']) await assert.rejects(spotify.playback('play_track', new AbortController().signal, 'invalid-op', trackId), /valid resolved/);
  await assert.rejects(spotify.playback('resume', new AbortController().signal, 'invalid-op', '5fwSHlTEWpluwOM0Sxnh5k'), /only accepted/);
  assert.equal(requests, 0);
});

test('Spotify additions verify state, deduplicate, and only edit csajok', async t => {
  const song = '5fwSHlTEWpluwOM0Sxnh5k';
  let added = false; let posts = 0;
  const spotify = await fixture(t, async (url, options) => {
    assert.ok(url.includes(`playlists/${CSAJOK}/items`));
    if (options.method === 'POST') { posts++; added = true; return json({ snapshot_id: 'test' }); }
    return json({ items: added ? [{ item: { id: song } }] : [], next: null });
  });
  const signal = new AbortController().signal;
  assert.equal((await spotify.add([song], signal, 'op1')).verified, true);
  assert.equal((await spotify.add([song], signal, 'op2')).alreadyPresent, true);
  assert.equal(posts, 1);
  await assert.rejects(spotify.add(['not-an-id'], signal, 'op3'), /Invalid/);
});

test('Spotify ambiguous mutation is not retried under the same operation ID', async t => {
  let calls = 0;
  const spotify = await fixture(t, async () => { calls++; throw new Error('lost connection'); });
  const send = () => spotify.request('me/player/next?device_id=test', new AbortController().signal, { method: 'POST', operationId: 'op-1' });
  await assert.rejects(send(), /outcome unknown/);
  await assert.rejects(send(), /already been attempted/);
  assert.equal(calls, 1);
});

test('Spotify observes Retry-After without a retry loop', async t => {
  let calls = 0;
  const spotify = await fixture(t, async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '60' } }); });
  await assert.rejects(spotify.request('me/player', new AbortController().signal), /rate limit/);
  await assert.rejects(spotify.request('me/player', new AbortController().signal), /rate limited/);
  assert.equal(calls, 1);
});

test('Spotify refresh persists rotated credentials and never returns them as tool data', async t => {
  const spotify = await fixture(t, async (url, options) => {
    assert.equal(url, 'https://accounts.spotify.com/api/token');
    assert.equal(options.body.get('client_id'), 'omni');
    return json({ access_token: 'new-token', refresh_token: 'rotated', expires_in: 3600 });
  });
  await writeFile(spotify.tokenPath, JSON.stringify({ client_id: 'omni', refresh_token: 'old', expires_at: 0 }));
  assert.equal(await spotify.token(new AbortController().signal), 'new-token');
  assert.equal(JSON.parse(await readFile(spotify.tokenPath, 'utf8')).refresh_token, 'rotated');
});
