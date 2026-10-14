import { test, expect } from '@playwright/test';

const weather = {
  city: 'Budapest',
  forecast: [
    { date: '2026-10-14', current: 12, high: 15, low: 7, condition: { icon: 'cloud', label: 'Overcast' } },
    { date: '2026-10-15', high: 17, low: 11, condition: { icon: 'sun', label: 'Clear' } },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/events', route => route.fulfill({ json: [] }));
  await page.route('**/api/chores', route => route.fulfill({ json: [] }));
  await page.route('**/gizi/**', route => route.fulfill({ json: { available: false } }));
});

test('recovers quickly after an initial weather request failure', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/weather', route => {
    requests++;
    return requests === 1
      ? route.fulfill({ status: 503, json: { error: 'Temporary upstream failure' } })
      : route.fulfill({ json: weather });
  });
  await page.goto('/');
  const tile = page.locator('.dashboard-weather');
  await expect(tile).toContainText('Weather unavailable');
  await page.clock.fastForward(31_000);
  await expect(tile).toContainText('Budapest');
  await expect(tile).toContainText('Tomorrow');
  await expect(tile).not.toContainText('Weather unavailable');
});

test('keeps the last forecast visible during a failed refresh', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/weather', route => {
    requests++;
    return requests === 2
      ? route.fulfill({ status: 503, json: { error: 'Temporary upstream failure' } })
      : route.fulfill({ json: weather });
  });
  await page.goto('/');
  const tile = page.locator('.dashboard-weather');
  await expect(tile).toContainText('Budapest');
  await page.clock.fastForward(600_001);
  await expect(tile).toContainText('Retrying');
  await expect(tile).toContainText('Tomorrow');
  await expect(tile).not.toContainText('Weather unavailable');
  await page.clock.fastForward(31_000);
  await expect(tile).not.toContainText('Retrying');
});
