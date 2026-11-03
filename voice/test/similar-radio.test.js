import test from 'node:test';
import assert from 'node:assert/strict';
import { SimilarRadio } from '../similar-radio.js';

function setup({ queue = [], playing = true, device = 'OmniWall', fallback = false, fail = false } = {}) {
  const calls = [];
  const state = { is_playing: playing, repeat_state: 'off', device: { name: device, id: 'device' }, item: { type: 'track', id: 'seed', artists: [{ name: 'Artist' }] } };
  const candidate = { type: 'track', id: 'next', uri: 'spotify:track:next', name: 'Next' };
  const radio = new SimilarRadio({ request: async (endpoint, signal, options) => {
    calls.push({ endpoint, options });
    if (options) { if (fail) throw new Error('Outcome unknown'); return {}; }
    if (endpoint === 'me/player') return state;
    if (endpoint === 'me/player/queue') return { queue };
    if (endpoint.startsWith('recommendations')) { if (fallback) throw new Error('Spotify returned 403. No success confirmed.'); return { tracks: [candidate] }; }
    if (endpoint.startsWith('search')) return { tracks: { items: [candidate] } };
    throw new Error(endpoint);
  } });
  radio.enabled = true;
  return { radio, calls };
}
test('queues one suggestion only once per current track', async () => {
  const { radio, calls } = setup();
  await radio.tick(); await radio.tick();
  assert.equal(calls.filter(c => c.options).length, 1);
  assert.match(radio.note, /queued Next/);
});
test('falls back when recommendations are forbidden', async () => {
  const { radio } = setup({ fallback: true }); await radio.tick();
  assert.match(radio.note, /Same-artist fallback/);
});
test('never interrupts queues, paused playback or another device', async () => {
  for (const options of [{ queue: [{}] }, { playing: false }, { device: 'Phone' }]) {
    const { radio, calls } = setup(options); await radio.tick();
    assert.equal(calls.filter(c => c.options).length, 0);
  }
});
test('does not retry an ambiguous mutation', async () => {
  const { radio, calls } = setup({ fail: true }); await radio.tick(); await radio.tick();
  assert.equal(calls.filter(c => c.options).length, 1);
});
test('disabled by default and disabling stops polling', () => {
  const radio = new SimilarRadio({}); assert.equal(radio.enabled, false);
  radio.configure(true); radio.configure(false); assert.equal(radio.timer, null);
});
