import { test, expect } from '@playwright/test';
import { syntheticTimeline, timelineResponse } from './timelineFinanceFixture';

test('initial HTML stays readable while application JavaScript and CSS are delayed', async ({ page, context, browserName }, testInfo) => {
  let releaseAssets!: () => void;
  const assetsReady = new Promise<void>(resolve => { releaseAssets = resolve; });
  await context.route(/\/assets\/[^/]+\.(js|css)$/, async route => {
    await assetsReady;
    await route.continue();
  });
  const table = syntheticTimeline();
  await context.route('**/gviz/tq?*', route => route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), table) }));
  try {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/aile/#/timeline', { waitUntil: 'commit' });
    const startup = page.locator('.app-startup');
    await expect(startup, 'HTML must paint a useful shell before application modules arrive').toBeVisible({ timeout: 1500 });
    await expect(startup).toHaveAttribute('aria-busy', 'true');
    await expect(startup.getByRole('status')).toHaveText('aile hazırlanıyor…');
    await expect(startup.getByRole('status')).toHaveCount(1);
    await expect(startup).not.toContainText(/[₺$€]|\d{4}-\d{2}/);
    const activity = startup.locator('.app-startup-activity');
    expect(await activity.evaluate(el => ({ duration: getComputedStyle(el, '::after').animationDuration, easing: getComputedStyle(el, '::after').animationTimingFunction, direction: getComputedStyle(el, '::after').animationDirection }))).toEqual({ duration: '1.44s', easing: 'cubic-bezier(0.65, 0, 0.35, 1)', direction: 'alternate' });
    for (const width of [320, 360, 375, 390, 844, 1023, 1024, 1025, 1440]) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 740 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    const boundaryEvidence = [];
    for (const [width, height] of [[1023, 740], [1024, 740], [1025, 740], [1024, 390]]) {
      await page.setViewportSize({ width, height });
      const layout = await startup.evaluate(el => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, columns: getComputedStyle(el).gridTemplateColumns.split(' '), navigation: getComputedStyle(el.querySelector('.app-startup-navigation')!).display }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(width + 1);
      expect(layout.columns).toHaveLength(width < 1024 ? 1 : 2);
      expect(layout.navigation).toBe(width < 1024 ? 'none' : 'grid');
      boundaryEvidence.push(layout);
    }
    await testInfo.attach('startup-boundaries', { body: JSON.stringify(boundaryEvidence), contentType: 'application/json' });
    await page.setViewportSize({ width: 1440, height: 740 });
    const text = startup.getByRole('status');
    expect(await text.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
    expect(await text.evaluate(el => getComputedStyle(el).fontFamily)).toContain('Outfit');
    // WebKit screenshot capture waits for blocked navigation resources.
    // Keep all layout/semantics checks on each engine; capture this pending state in Chromium.
    if (browserName === 'chromium') await page.screenshot({ path: testInfo.outputPath('html-startup-desktop.png') });
    await page.setViewportSize({ width: 320, height: 740 });
    if (browserName === 'chromium') await page.screenshot({ path: testInfo.outputPath('html-startup-320.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await activity.evaluate(el => getComputedStyle(el, '::after').animationDuration)).toBe('0s');
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => document.documentElement.style.fontSize = '');
    releaseAssets();
    await expect(page.getByRole('article')).toHaveCount(5);
    await expect(startup).toHaveCount(0);
    await expect(page.getByRole('main')).toHaveCount(1);
  } finally { releaseAssets(); }
});

test('application waits for its styles before mounting', async ({ page, context }) => {
  let releaseStyles!: () => void;
  const stylesReady = new Promise<void>(resolve => { releaseStyles = resolve; });
  let styleRequested = false;
  await context.route(/\/assets\/mount-[^/]+\.css$/, async route => {
    styleRequested = true;
    await stylesReady;
    await route.continue();
  });
  const table = syntheticTimeline();
  await context.route('**/gviz/tq?*', route => route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), table) }));
  try {
    await page.goto('/aile/#/timeline', { waitUntil: 'commit' });
    await expect.poll(() => styleRequested).toBe(true);
    await expect(page.locator('.app-startup')).toBeVisible();
    await expect(page.locator('.aile-app'), 'React must not flash before its stylesheet is ready').toHaveCount(0);
    releaseStyles();
    await expect(page.getByRole('article')).toHaveCount(5);
  } finally { releaseStyles(); }
});

for (const asset of ['index', 'mount']) test(`a failed ${asset} download leaves a readable retry instruction`, async ({ page, context }) => {
  // A fresh context exercises the actual first-download failure, without a prior SW cache.
  await context.route(new RegExp(`/assets/${asset}-[^/]+\\.js$`), route => route.abort('failed'));
  await page.goto('/aile/#/timeline', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert')).toHaveText('aile açılamadı. Bağlantınızı kontrol edip sayfayı yenileyin.');
  await expect(page.locator('.app-startup')).toHaveAttribute('aria-busy', 'false');
  expect(await page.locator('.app-startup-activity').evaluate(el => getComputedStyle(el, '::after').animationPlayState)).toBe('paused');
  await expect(page.locator('.aile-app')).toHaveCount(0);
});
