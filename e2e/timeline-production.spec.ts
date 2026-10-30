import { syntheticBridgeResponse } from '../src/dashboard/bridgeFixtures';
import { readdir, writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { syntheticSheets, gviz } from '../src/dashboard/fixtures';
import { syntheticTimeline, timelineResponse } from './timelineFinanceFixture';

async function selectPage(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: 'Sayfalar', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  await page.getByRole('navigation', { name: 'Sayfalar', exact: true }).getByRole('link', { name, exact: true }).click();
}

test('a clean production budget visit does not fetch Tabs until Timeline needs it', async ({ page, context }, testInfo) => {
  const tabsFiles = (await readdir('dist/assets')).filter(name => /^Tabs-.*\.js$/.test(name));
  expect(tabsFiles.length, 'the build must expose the deferred shared Tabs chunk').toBeGreaterThan(0);
  const tabsPaths = new Set(tabsFiles.map(name => `/aile/assets/${name}`));
  const storeFiles = (await readdir('dist/assets')).filter(name => /^financeStore-.*\.js$/.test(name));
  expect(storeFiles.length).toBeGreaterThan(0);
  const storePaths = new Set(storeFiles.map(name => `/aile/assets/${name}`));
  const otherFeaturePaths = new Set((await readdir('dist/assets')).filter(name => /^(LegacyApp|HomePlanPage|VehiclePage)-/.test(name)).map(name => `/aile/assets/${name}`));
  expect(otherFeaturePaths.size, 'separate family areas remain deferred').toBeGreaterThanOrEqual(3);
  const requests: string[] = [];
  let timelineReads = 0;
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:5177') requests.push(url.pathname);
  });
  const raw = syntheticSheets();
  const budgetMap = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', 'Düzensiz giderler': 'irregular' } as const;
  await context.route('**/gviz/tq?*', route => {
    const sheet = new URL(route.request().url()).searchParams.get('sheet') ?? '';
    if (sheet === 'Finansman') {
      timelineReads += 1;
      const timeline = syntheticTimeline();
      return route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), timeline) });
    }
    const bridge = syntheticBridgeResponse(route.request().url());
    if (bridge) return route.fulfill({ contentType: 'application/json', body: bridge });
    const key = budgetMap[sheet as keyof typeof budgetMap];
    if (!key) return route.fulfill({ status: 404, body: 'Unexpected sheet' });
    const rows = key === 'plan' || key === 'actual' ? raw[key].map(row => row.slice(0, 4)) : raw[key];
    return route.fulfill({ contentType: 'application/json', body: gviz(rows, key === 'plan' || key === 'actual' ? ['Kalem', ...raw.summary.map(row => String(row[0]))] : undefined) });
  });
  await page.goto('/aile/#/pano');
  await expect(page.getByRole('region', { name: 'Seçili ay özeti' })).toContainText('10.000 ₺');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const beforeTimeline = requests.filter(path => tabsPaths.has(path));
  const beforeEvidence = testInfo.outputPath('budget-and-service-worker-requests.json');
  await writeFile(beforeEvidence, JSON.stringify(requests, null, 2));
  await testInfo.attach('budget-and-service-worker-requests', { path: beforeEvidence, contentType: 'application/json' });
  expect(beforeTimeline, 'service worker installation must not prefetch a feature-specific module').toEqual([]);
  expect(requests.filter(path => storePaths.has(path)), 'Pano must not load the Timeline data module').toEqual([]);
  expect(timelineReads, 'Pano must not fetch the Timeline ledger').toBe(0);
  expect(requests.filter(path => otherFeaturePaths.has(path)), 'shared navigation must not eagerly fetch the home, editing or vehicle areas').toEqual([]);
  await selectPage(page, 'Ödeme takvimi');
  await expect(page.getByRole('tablist', { name: 'Takvim görünümü' })).toBeVisible();
  await expect.poll(() => requests.filter(path => tabsPaths.has(path)).length).toBeGreaterThan(0);
  await page.getByRole('tab', { name: 'Tablo', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Kronolojik ödeme tablosu' })).toBeVisible();
  const afterEvidence = testInfo.outputPath('timeline-requests.json');
  await writeFile(afterEvidence, JSON.stringify(requests, null, 2));
  await testInfo.attach('timeline-requests', { path: afterEvidence, contentType: 'application/json' });
});

test('selected Timeline fetches before its UI arrives and revisits reuse verified memory', async ({ page, context }, testInfo) => {
  const raw = syntheticSheets();
  const budgetMap = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', 'Düzensiz giderler': 'irregular' } as const;
  const table = syntheticTimeline();
  let timelineReads = 0;
  let feedRequestedAt = 0;
  await context.route('**/gviz/tq?*', route => {
    const sheet = new URL(route.request().url()).searchParams.get('sheet') ?? '';
    if (sheet === 'Finansman') {
      timelineReads += 1;
      if (timelineReads === 1) feedRequestedAt = performance.now();
      return route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), table) });
    }
    const bridge = syntheticBridgeResponse(route.request().url());
    if (bridge) return route.fulfill({ contentType: 'application/json', body: bridge });
    const key = budgetMap[sheet as keyof typeof budgetMap];
    if (!key) return route.fulfill({ status: 404, body: 'Unexpected sheet' });
    const rows = key === 'plan' || key === 'actual' ? raw[key].map(row => row.slice(0, 4)) : raw[key];
    return route.fulfill({ contentType: 'application/json', body: gviz(rows, key === 'plan' || key === 'actual' ? ['Kalem', ...raw.summary.map(row => String(row[0]))] : undefined) });
  });
  let releaseUi!: () => void;
  const waitForUi = new Promise<void>(resolve => { releaseUi = resolve; });
  await context.route(/\/assets\/TimelinePage-[^/]+\.js$/, async route => {
    await waitForUi;
    await route.continue();
  });
  try {
    await page.goto('/aile/#/pano');
    await expect(page.getByRole('region', { name: 'Seçili ay özeti' })).toBeVisible();
    expect(timelineReads).toBe(0);
    const selectedAt = performance.now();
    await selectPage(page, 'Ödeme takvimi');
    // This assertion only passes if data and UI downloads are independent.
    await expect.poll(() => timelineReads).toBe(4);
    const uiReleasedAt = performance.now();
    expect(feedRequestedAt).toBeLessThan(uiReleasedAt);
    releaseUi();
    await expect(page.getByRole('article')).toHaveCount(5);
    const coldShownAt = performance.now();
    await selectPage(page, 'Genel bütçe');
    await expect(page.getByRole('region', { name: 'Seçili ay özeti' })).toBeVisible();
    const revisitAt = performance.now();
    await selectPage(page, 'Ödeme takvimi');
    await expect(page.getByRole('article')).toHaveCount(5);
    const warmShownAt = performance.now();
    expect(timelineReads, 'a fresh route revisit must not wait for another Google request').toBe(4);
    await page.getByRole('button', { name: 'Yenile', exact: true }).click();
    await expect.poll(() => timelineReads).toBe(8);
    const evidence = testInfo.outputPath('timeline-data-performance.json');
    await writeFile(evidence, JSON.stringify({ scope: 'synthetic local production; not Google latency', firstRequestBeforeUiMs: uiReleasedAt - feedRequestedAt, coldSelectionToDataMs: coldShownAt - selectedAt, warmSelectionToDataMs: warmShownAt - revisitAt, initialReads: 4, additionalWarmReads: 0, manualRefreshReads: 4 }, null, 2));
    await testInfo.attach('timeline-data-performance', { path: evidence, contentType: 'application/json' });
  } finally { releaseUi(); }
});
