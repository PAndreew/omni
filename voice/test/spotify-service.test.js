import test from 'node:test';
import assert from 'node:assert/strict';
import { restartSpotifyService } from '../spotify-service.js';

test('restart control targets only raspotify and verifies service activation', async () => {
  const calls = [];
  const result = await restartSpotifyService({ run: async (program, args) => {
    calls.push({ program, args }); return { stdout: args[0] === 'is-active' ? 'active\n' : '' };
  } });
  assert.equal(result.restarted, true);
  assert.deepEqual(calls, [
    { program: 'systemctl', args: ['--no-ask-password', 'restart', 'raspotify.service'] },
    { program: 'systemctl', args: ['is-active', 'raspotify.service'] },
  ]);
});

test('missing restart permission gives setup instructions instead of false success', async () => {
  await assert.rejects(restartSpotifyService({ run: async () => { const error = new Error('Interactive authentication required'); error.stderr = 'Access denied'; throw error; } }), error => error.status === 503 && /one-time/.test(error.message));
  await assert.rejects(restartSpotifyService({ run: async (_program, args) => ({ stdout: args[0] === 'is-active' ? 'failed\n' : '' }) }), /did not become active/);
  await assert.rejects(restartSpotifyService({ run: async () => { throw new Error('Timed out'); } }), /not confirmed/);
});
