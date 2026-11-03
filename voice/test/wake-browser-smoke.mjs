// Optional browser test; fake microphone and speech adapter, no cloud calls.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createVoiceServer } from '../server.js';
const { chromium } = await import(process.env.GIZI_PLAYWRIGHT_MODULE || 'playwright');
const stateDir = await mkdtemp(path.join(os.tmpdir(), 'beezy-wake-browser-'));
let captures = 0, claimed = 0;
const wake = {
  enabled: true, ready: true, sequence: 0, at: 0,
  status() { return { available: true, enabled: this.enabled, ready: this.ready, sequence: this.sequence, at: this.at }; },
  setEnabled(value) { this.enabled = value; this.ready = value; },
  claim(sequence) { if (!this.enabled || sequence !== this.sequence || sequence <= claimed || !this.canWake()) return false; claimed = sequence; return true; },
  stop() {},
};
const voice = createVoiceServer({ stateDir, accessKey: 'wake-test-key', wake, connect: async () => ({ start() { captures++; }, audio() {}, end() {}, dispose() {} }) });
voice.server.listen(0, '127.0.0.1'); await once(voice.server, 'listening');
const browser = await chromium.launch({ executablePath: process.env.GIZI_CHROMIUM || '/usr/bin/chromium-browser', headless: true, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${voice.server.address().port}`);
  await page.waitForTimeout(1500);
  assert.equal(captures, 0, 'idle kiosk must not send assistant audio');
  await page.getByRole('button', { name: 'Spotify', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  wake.sequence = 1; wake.at = Date.now();
  await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
  assert.equal(captures, 1); assert.equal(claimed, 1);
  assert.equal(await page.getByRole('dialog').count(), 0, 'wake panel must not be hidden behind an app modal');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: /Wake word/ }).click();
  await page.waitForTimeout(1100);
  assert.equal(wake.enabled, false);
  wake.sequence = 2; wake.at = Date.now();
  await page.waitForTimeout(1500); assert.equal(captures, 1, 'disabled wake must not record');
  assert.deepEqual(errors, []);
  console.log('Browser PASS: local wake opens voice capture, single claim, manual Stop and persistent off control.');
} finally {
  await browser.close(); voice.close(); await rm(stateDir, { recursive: true, force: true });
}
