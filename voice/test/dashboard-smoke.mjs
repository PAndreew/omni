// Optional layout regression checks. Build client first; no cloud calls or playback changes.
// GIZI_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node test/dashboard-smoke.mjs
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createVoiceServer } from '../server.js';
const { chromium } = await import(process.env.GIZI_PLAYWRIGHT_MODULE || 'playwright');
const stateDir = await mkdtemp(path.join(os.tmpdir(), 'beezy-layout-'));
const service = createVoiceServer({ stateDir, accessKey: 'layout-test-key' });
service.server.listen(0, '127.0.0.1');
await once(service.server, 'listening');
const browser = await chromium.launch({ executablePath: process.env.GIZI_CHROMIUM || '/usr/bin/chromium-browser', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const key = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  const musicPlays = [];
  let speakerVolume = 50;
  const musicTrack = { id: '1234567890123456789012', uri: 'spotify:track:1234567890123456789012', title: 'Song fixture', subtitle: 'Artist', kind: 'track' };
  const musicPlaylist = { id: 'abcdefghijklmnopqrstuv', uri: 'spotify:playlist:abcdefghijklmnopqrstuv', title: 'Playlist fixture', subtitle: 'Household', kind: 'playlist' };
  await page.route('**/gizi/music/**', route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    if (endpoint === 'play') { musicPlays.push(route.request().postDataJSON()); return route.fulfill({ json: { accepted: true } }); }
    if (endpoint === 'volume') {
      if (route.request().method() === 'POST') speakerVolume = route.request().postDataJSON().percent;
      return route.fulfill({ json: { percent: speakerVolume, name: 'SoundSticks', muted: false } });
    }
    if (endpoint === 'reconnect') return route.fulfill({ json: { connected: true, name: 'JBL' } });
    if (endpoint === 'restart') return route.fulfill({ json: { restarted: true } });
    const fixtures = { devices: [{ id: 'wall', name: 'OmniWall', online: true }], state: { track: musicTrack, playing: true, device: 'OmniWall' }, recent: { tracks: [musicTrack], playlists: [musicPlaylist] }, library: [musicPlaylist], search: { tracks: [musicTrack], playlists: [musicPlaylist] } };
    return route.fulfill({ json: fixtures[endpoint] || {} });
  });
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/events', route => route.fulfill({ json: [
    { id: 1, title: 'Meeting fixture', start_time: key + 'T15:00:00', end_time: key + 'T16:00:00' },
    { id: 2, title: 'Appointment fixture', start_time: key + 'T17:00:00' },
  ] }));
  await page.route('**/api/chores', route => route.fulfill({ json: [{ id: 1, title: 'Task fixture', due_date: key, done: 0 }] }));
  for (const [width, height] of [[1280, 720], [390, 844], [320, 640], [768, 1024]]) {
    speakerVolume = 50;
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:${service.server.address().port}`);
    await page.getByText('Meeting fixture').waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.week-day').count(), 7);
    assert.equal(await page.locator('.week-dots .agenda-green-dot').count(), 2);
    assert.equal(await page.locator('.app-shortcut').count(), 3);
    assert.equal(await page.getByText('15:00–16:00').isVisible(), true);
    assert.equal(await page.locator('.dashboard-clock').isVisible(), width > 768);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily.includes('Nunito')), true);
    assert.equal(await page.evaluate(() => document.fonts.check('600 16px Nunito')), true);
    if (width <= 768) {
      const rectangles = await page.evaluate(() => ['calendar', 'weather', 'controls'].map(name => {
        const rect = document.querySelector('.dashboard-' + name).getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left };
      }));
      assert.equal(rectangles[0].left, 0);
      assert.ok(rectangles[1].top >= rectangles[0].bottom);
      assert.ok(rectangles[2].top >= rectangles[1].bottom);
    }
    await page.getByRole('button', { name: 'Next week' }).click();
    assert.equal(await page.locator('.week-dots .agenda-green-dot').count(), 0);
    await page.getByRole('button', { name: 'Return to current week' }).click();
    assert.equal(await page.locator('.week-dots .agenda-green-dot').count(), 2);
    await page.getByRole('button', { name: 'DOCX / PDF translator' }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: 'Close modal' }).click();
    await page.getByRole('button', { name: 'Spotify', exact: true }).click();
    await page.getByRole('heading', { name: 'Recent playlists' }).waitFor();
    await page.getByRole('heading', { name: 'Recent tracks' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Speaker volume"]').disabled);
    await page.getByRole('button', { name: 'Increase speaker volume', exact: true }).click();
    await page.waitForFunction(() => { const slider = document.querySelector('[aria-label="Speaker volume"]'); return slider.value === '55' && !slider.disabled; });
    assert.equal(speakerVolume, 55);
    await page.getByRole('button', { name: 'Reconnect speaker', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Bluetooth speaker reconnected' }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Restart Spotify', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Spotify restarted' }).waitFor();
    await page.getByRole('searchbox', { name: 'Search tracks and playlists' }).fill('fixture');
    await page.getByRole('heading', { name: 'Tracks', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Play Song fixture', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Command accepted' }).waitFor();
    assert.equal(musicPlays.at(-1).uri, musicTrack.uri);
    await page.getByRole('button', { name: 'Close modal' }).click();
    await page.getByRole('button', { name: 'Open Gizi voice assistant' }).click();
    assert.equal(await page.getByRole('region', { name: 'Talk to Gizi' }).isVisible(), true);
    const panel = await page.getByRole('region', { name: 'Talk to Gizi' }).boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= width);
    assert.ok(panel.y >= 0 && panel.y + panel.height <= height);
    assert.ok((await page.getByRole('link', { name: 'Pi Web' }).getAttribute('href')).startsWith('https://'));
    console.log(`${width}x${height}: passed`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise(resolve => service.server.close(resolve));
  await rm(stateDir, { recursive: true, force: true });
}
