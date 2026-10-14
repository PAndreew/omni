import test from 'node:test';
import assert from 'node:assert/strict';
import { musicRequest } from './giziMusic.js';
const response = (status, data) => new Response(JSON.stringify(data), { status });
test('repairs stale pairing after service restart, then retries the rejected request once', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === '/gizi/session') return new Response(null, { status: 204 });
    return calls.length === 1 ? response(403, { error: 'Pair Gizi first.' }) : response(200, { enabled: true });
  };
  assert.deepEqual(await musicRequest('radio', { method: 'POST', body: '{"enabled":true}' }, fetchImpl), { enabled: true });
  assert.deepEqual(calls.map(c => c.url), ['/gizi/music/radio', '/gizi/session', '/gizi/music/radio']);
  assert.equal(calls[2].options.body, calls[0].options.body);
});
test('does not retry other failures or loop when pairing fails', async () => {
  for (const error of ['Same-origin request required.', 'Spotify returned 403. No success confirmed.']) {
    let calls = 0;
    await assert.rejects(musicRequest('radio', {}, async () => { calls++; return response(403, { error }); }), { message: error });
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(musicRequest('radio', {}, async () => { calls++; return response(403, { error: 'Pair Gizi first.' }); }));
  assert.equal(calls, 2);
});
