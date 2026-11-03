import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WakeDetector } from '../wake.js';
import { reconnectSpeaker, getSpeakerVolume, setSpeakerVolume } from '../speaker.js';

test('speaker reconnect uses fixed bluetoothctl arguments and verifies connection', async () => {
  const calls = [];
  const result = await reconnectSpeaker({ address: '54:15:89:8A:F8:6A', wait: async () => {}, run: async (program, args) => {
    calls.push({ program, args });
    if (args[0] === 'disconnect') throw new Error('Already disconnected');
    return { stdout: 'Name: JBL\nConnected: yes\n' };
  } });
  assert.equal(result.connected, true);
  assert.deepEqual(calls.map(call => call.args[0]), ['disconnect', 'connect', 'info']);
  assert.ok(calls.every(call => call.program === 'bluetoothctl' && call.args[1] === '54:15:89:8A:F8:6A'));
  await assert.rejects(reconnectSpeaker({ address: 'bad;command' }), /not configured/);
  await assert.rejects(reconnectSpeaker({ wait: async () => {}, run: async () => ({ stdout: 'Connected: no' }) }), /did not reconnect/);
});

test('speaker volume targets the configured sink and refuses amplification', async () => {
  const address = '98:52:3D:0E:40:04'; let percent = 50; const calls = [];
  const run = async (program, args) => {
    calls.push({ program, args });
    if (args[0] === 'set-sink-volume') { percent = Number.parseInt(args[2], 10); return { stdout: '' }; }
    return { stdout: JSON.stringify([{ name: 'bluez_output.98_52_3D_0E_40_04.1', description: 'SoundSticks', mute: false, volume: { 'front-left': { value_percent: `${percent}%` } } }]) };
  };
  assert.equal((await getSpeakerVolume({ address, run })).percent, 50);
  assert.equal((await setSpeakerVolume(60, { address, run })).percent, 60);
  assert.deepEqual(calls.find(call => call.args[0] === 'set-sink-volume').args, ['set-sink-volume', 'bluez_output.98_52_3D_0E_40_04.1', '60%']);
  for (const bad of [-1, 101, 1.5, '80']) await assert.rejects(setSpeakerVolume(bad, { address, run }), /0 to 100/);
  await assert.rejects(getSpeakerVolume({ address, run: async () => ({ stdout: '[]' }) }), /offline/);
});

test('wake detector requires consent, suppresses busy/cooldown events, and claims once', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'beezy-wake-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const model = path.join(dir, 'model'); await mkdir(model);
  await writeFile(path.join(model, 'beezy-keywords.txt'), 'fixture');
  const python = path.join(dir, 'python'); await writeFile(python, 'fixture');
  const wake = new WakeDetector({ stateDir: dir, model, python, enabled: false });
  wake.ready = true; wake.detect(); assert.equal(wake.sequence, 0);
  wake.enabled = true; wake.canWake = () => false; wake.detect(); assert.equal(wake.sequence, 0);
  wake.canWake = () => true; wake.detect(); assert.equal(wake.sequence, 1);
  wake.detect(); assert.equal(wake.sequence, 1);
  assert.equal(wake.claim(99), false); assert.equal(wake.claim(1), true); assert.equal(wake.claim(1), false);
  wake.at = Date.now() - 9000; assert.equal(wake.claim(1), false);
  wake.detect(); assert.equal(wake.sequence, 2);
  wake.setEnabled(false); assert.equal(wake.ready, false); assert.equal(wake.claim(2), false);
  assert.equal(new WakeDetector({ stateDir: dir, model, python, enabled: true }).enabled, false, 'persisted off overrides default on');
});
