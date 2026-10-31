import { readFile, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { syntheticTimeline, timelineResponse } from './timelineFinanceFixture';

test('a real worker update is visible without reloading the active view until confirmed', async ({ page, context, browserName }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  // After the worker-controlled reload, WebKit no longer hands the page's gviz
  // fetch to context.route (Playwright: requests taken over by a service worker
  // are invisible to route; worker-level routing is Chromium-only). The
  // synthetic transport is therefore answered inside the document by a
  // test-only fetch shim backed by the same Node fixture encoder, so the real
  // decode, SHA-256 and metadata freshness path runs on identical bytes before
  // and after the worker starts controlling the page, in every engine.
  const table = syntheticTimeline();
  let syntheticReads = 0;
  await context.exposeBinding('__aileSyntheticGviz', (_source, url: string) => { syntheticReads += 1; return timelineResponse(url, table); });
  await context.addInitScript(() => {
    const synthetic = (window as unknown as { __aileSyntheticGviz(url: string): Promise<string> }).__aileSyntheticGviz;
    const network = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/gviz/tq?')) return network(input, init);
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const body = await synthetic(url);
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
  // Network-layer guard: covers Chromium and the not-yet-controlled first WebKit
  // document. Once WebKit is worker-controlled this route is not consulted, so the
  // WebKit proof is the binding count plus the synthetic content rendered below.
  let escapedReads = 0;
  await context.route('**/gviz/tq?*', route => { escapedReads += 1; return route.fulfill({ status: 503, contentType: 'text/plain', body: 'synthetic transport bypassed' }); });
  await page.goto('/aile/#/timeline');
  // The first document must finish both verified reads before the worker-controlled reload.
  await expect(page.getByRole('tab', { name: 'Tablo', exact: true })).toBeVisible();
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
    // Three document loads (first visit, worker-controlled reload, confirmed update), two verified reads each.
    await expect(page.getByRole('article').first()).toContainText('Sentetik');
    await expect.poll(() => syntheticReads).toBeGreaterThanOrEqual(6);
    expect(escapedReads, 'no finance request may reach the network layer').toBe(0);
  } finally { await writeFile('dist/sw.js', original); }
});
