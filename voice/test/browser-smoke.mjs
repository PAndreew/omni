// Optional real-browser lifecycle test. Uses a fake microphone and fake Live
// adapter; never sends audio to Google or changes Spotify.
// GIZI_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node test/browser-smoke.mjs
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createVoiceServer } from '../server.js';
const { chromium } = await import(process.env.GIZI_PLAYWRIGHT_MODULE || 'playwright');
const stateDir = await mkdtemp(path.join(os.tmpdir(), 'gizi-browser-'));
let captures = 0, bytes = 0, disposals = 0;
const voice = createVoiceServer({
  stateDir, accessKey: 'test-browser-key',
  connect: async emit => ({
    start() { captures++; }, audio(data) { bytes += data.length; },
    end() {
      emit({ type: 'transcript', who: 'user', text: 'Hány dal van a csajok listán?' });
      emit({ type: 'transcript', who: 'assistant', text: 'Négy dal.' });
      emit({ type: 'audio', data: Buffer.alloc(4800).toString('base64') });
      emit({ type: 'turn_complete' });
    },
    dispose() { disposals++; },
  }),
});
voice.server.listen(0, '127.0.0.1'); await once(voice.server, 'listening');
const port = voice.server.address().port;
const browser = await chromium.launch({ executablePath: process.env.GIZI_CHROMIUM || '/usr/bin/chromium-browser', headless: true, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.capturedTracks = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints);
      window.capturedTracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.goto(`http://127.0.0.1:${port}/#gizi-key=test-browser-key`);
  await page.getByRole('button', { name: 'Talk to Gizi', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.equal(await page.evaluate(() => window.capturedTracks.length), 0, 'opening UI must not activate microphone');
  await page.getByRole('button', { name: 'Talk to Gizi', exact: true }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
  await page.waitForTimeout(600);
  assert.equal(captures, 1); assert.ok(bytes > 0, 'PCM must reach bridge');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Reply', exact: true }).waitFor();
  assert.match(await page.locator('.gizi-panel').innerText(), /Négy dal/);
  assert.ok(await page.evaluate(() => window.capturedTracks.every(track => track.readyState === 'ended')));
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(captures, 2); assert.equal(disposals, 1);
  assert.ok(await page.evaluate(() => window.capturedTracks.every(track => track.readyState === 'ended')));
  await page.getByRole('button', { name: 'Talk to Gizi', exact: true }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(100);
  assert.equal(disposals, 2);
  assert.ok(await page.evaluate(() => window.capturedTracks.every(track => track.readyState === 'ended')));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: process.env.GIZI_SCREENSHOT || '/tmp/gizi-phone-button.png' });
  console.log('Browser PASS: pairing, no idle capture, PCM, Send, reply audio, follow-up, Stop, page-hide cleanup.');
  await context.close();
  const deniedContext = await browser.newContext();
  const denied = await deniedContext.newPage();
  await denied.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await denied.goto(`http://127.0.0.1:${port}/#gizi-key=test-browser-key`);
  await denied.getByRole('button', { name: 'Talk to Gizi', exact: true }).click();
  await denied.getByRole('alert').waitFor();
  assert.match(await denied.getByRole('alert').innerText(), /permission denied/);
  await deniedContext.close();
  console.log('Browser PASS: microphone denial gives actionable error.');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) console.error('Browser state:', await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); voice.close(); await rm(stateDir, { recursive: true, force: true }); }
