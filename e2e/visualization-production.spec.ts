import { readFile, readdir, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { visualizationSource } from './visualizationFixture';

async function chartPaths() {
  const files = (await readdir('dist/assets')).filter(name => /^Charts-.*\.(js|css)$/.test(name));
  expect(files.filter(name => name.endsWith('.js'))).toHaveLength(1);
  expect(files.filter(name => name.endsWith('.css'))).toHaveLength(1);
  // Verify the emitted finance module actually contains the optional chart import.
  const finance = (await readdir('dist/assets')).find(name => /^FinancePage-.*\.js$/.test(name))!;
  expect(await readFile(`dist/assets/${finance}`, 'utf8')).toContain(files.find(name => name.endsWith('.js'))!);
  return new Set(files.map(name => `/aile/assets/${name}`));
}

test.describe('cold and warm service worker isolation', () => {
  test.use({ serviceWorkers: 'allow' });
  test('daily finance and the service worker do not request charts; monthly view requests them once', async ({ page, context, browserName }, info) => {
    test.skip(browserName === 'webkit', 'WebKit service workers bypass synthetic response interception; separate blocked-worker production check covers its UI.');
    const paths = await chartPaths(), requests: string[] = [], pageRequests: string[] = [], workerRequests: string[] = [];
    context.on('request', request => { const path = new URL(request.url()).pathname; requests.push(path); (request.serviceWorker() ? workerRequests : pageRequests).push(path); });
    await visualizationSource(page);
    await page.goto('/aile/#/finansman');
    await expect(page.getByRole('table', { name: 'Günlük finansman adımları' })).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    expect(requests.filter(path => paths.has(path))).toEqual([]);
    await page.reload();
    await expect(page.getByRole('table', { name: 'Günlük finansman adımları' })).toBeVisible();
    expect(requests.filter(path => paths.has(path))).toEqual([]);
    await page.getByRole('tab', { name: 'Aylık özet', exact: true }).click();
    await expect(page.locator('.finance-trends svg')).toHaveCount(3);
    for (const path of paths) { expect(pageRequests.filter(request => request === path)).toHaveLength(1); expect(workerRequests.filter(request => request === path).length).toBeLessThanOrEqual(1); }
    const evidence = { paths: [...paths], requests, pageRequests, workerRequests, timing: await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => entry.name.includes('/Charts-')).map(entry => ({ name: entry.name, transferSize: (entry as PerformanceResourceTiming).transferSize, encodedBodySize: (entry as PerformanceResourceTiming).encodedBodySize }))) };
    await writeFile(info.outputPath('chart-production-requests.json'), JSON.stringify(evidence, null, 2));
  });
});

test.describe('progressive chart enhancement', () => {
  test.use({ serviceWorkers: 'block' });
  test('the selected values and full table are usable before the optional production chart download completes', async ({ page, context }, info) => {
    const paths = await chartPaths(), requests: string[] = [];
    context.on('request', request => requests.push(new URL(request.url()).pathname));
    await visualizationSource(page);
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/assets\/Charts-.*\.js$/, async route => { await wait; await route.continue(); });
    try {
      await page.goto('/aile/#/finansman');
      await expect(page.getByRole('table', { name: 'Günlük finansman adımları' })).toBeVisible();
      expect(requests.filter(path => paths.has(path))).toEqual([]);
      await page.getByRole('tab', { name: 'Aylık özet', exact: true }).click();
      const trends = page.getByRole('region', { name: 'Nakit ve borcun seyri' });
      await expect(trends.getByRole('group', { name: 'Harcanabilir nakit', exact: true })).toContainText('500 ₺');
      await expect(trends.getByRole('status')).toHaveCount(3);
      await expect(page.getByRole('table', { name: 'Aylık finansman özeti' })).toBeVisible();
      release();
      await expect(trends.locator('svg')).toHaveCount(3);
      await writeFile(info.outputPath('chart-progressive-requests.json'), JSON.stringify(requests, null, 2));
    } finally { release(); }
  });
});
