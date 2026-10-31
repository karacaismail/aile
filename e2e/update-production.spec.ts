import { readFile, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { syntheticTimeline, timelineResponse } from './timelineFinanceFixture';

test('a real worker update is visible without reloading the active view until confirmed', async ({ page, context, browserName }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await context.route('**/gviz/tq?*', route => route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), syntheticTimeline()) }));
  await page.goto('/aile/#/timeline');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Tablo', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Tablo', exact: true }).click();
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  const original = await readFile('dist/sw.js', 'utf8');
  try {
    // Change only the served worker version; app code and synthetic finance data remain identical.
    await writeFile('dist/sw.js', original + `\n// update acceptance ${testInfo.project.name} ${Date.now()}\n`);
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration!.update(); });
    await expect(page.locator('.app-update').getByRole('status')).toContainText('Yeni sürüm hazır');
    await expect(page.getByRole('tab', { name: 'Tablo', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(navigations).toBe(0);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const notice = page.locator('.app-update');
      expect(await notice.evaluate(el => ({ minimum: Math.min(...[...el.querySelectorAll('*')].map(e => parseFloat(getComputedStyle(e).fontSize))), overflow: document.documentElement.scrollWidth > innerWidth }))).toEqual({ minimum: 16, overflow: false });
      await page.screenshot({ path: testInfo.outputPath(`update-${width}.png`) });
    }
    const action = page.getByRole('button', { name: 'Yeni sürümü aç' });
    await action.focus();
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(action).toBeFocused();
    expect(await action.evaluate(el => getComputedStyle(el).textDecorationLine)).toContain('underline');
    expect(await action.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
    await action.press('Enter');
    await expect.poll(() => navigations).toBe(1);
    await expect(page.getByRole('tab', { name: 'Zaman akışı' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Yeni sürüm hazır.', { exact: true })).toHaveCount(0);
    expect(page.url()).toContain('/aile/#/timeline');
  } finally { await writeFile('dist/sw.js', original); }
});
