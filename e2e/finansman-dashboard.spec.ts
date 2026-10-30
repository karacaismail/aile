import { syntheticBridgeResponse } from '../src/dashboard/bridgeFixtures';
import { readdir } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { gviz, syntheticSheets } from '../src/dashboard/fixtures';
import { syntheticFinance } from '../src/finance/fixtures';
import { financeRanges } from '../src/finance/contract';

async function financeSource(page: Page, waitForDaily?: Promise<void>) {
  const source = syntheticFinance();
  const requests: string[] = [];
  const raw = syntheticSheets();
  const map = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', 'Düzensiz giderler': 'irregular' } as const;
  await page.context().route('**/gviz/tq?*', async route => {
    const url = new URL(route.request().url()); const sheet = url.searchParams.get('sheet')!;
    requests.push(sheet);
    if (sheet === 'Finansman') {
      const key = Object.entries(financeRanges).find(([, value]) => value === url.searchParams.get('range'))?.[0] as keyof typeof source;
      if (!key) return route.fulfill({ status: 404 });
      if (key === 'daily' && waitForDaily) await waitForDaily;
      return route.fulfill({ contentType: 'application/json', body: gviz(source[key].rows, source[key].labels) });
    }
    const bridge = syntheticBridgeResponse(route.request().url());
    if (bridge) return route.fulfill({ contentType: 'application/json', body: bridge });
    const key = map[sheet as keyof typeof map];
    if (!key) return route.fulfill({ status: 404 });
    const rows = key === 'plan' || key === 'actual' ? raw[key].map(row => row.slice(0, 4)) : raw[key];
    return route.fulfill({ contentType: 'application/json', body: gviz(rows, key === 'plan' || key === 'actual' ? ['Kalem', ...raw.summary.map(row => String(row[0]))] : undefined) });
  });
  return { source, requests };
}
async function selectPage(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: 'Sayfalar', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  await page.getByRole('navigation', { name: 'Sayfalar', exact: true }).getByRole('link', { name, exact: true }).click();
}

test('verified native amounts stay readable from 320px; views and keyboard scrolling preserve the month', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const { requests } = await financeSource(page);
  await page.goto('/aile/#/finansman');
  await expect(page.getByRole('region', { name: 'Ocak 2098 ay sonu' })).toContainText('500 ₺');
  const firstAmount = await page.locator('.finance-summary dd').first().boundingBox();
  expect(firstAmount!.y + firstAmount!.height).toBeLessThanOrEqual(740);
  expect(requests).toEqual(['Finansman', 'Finansman', 'Finansman', 'Finansman']);
  await expect(page.getByText('Koşullu hesap; banka oranı ve geçmiş faiz teyitsiz.')).toBeVisible();
  const scroll = page.getByRole('region', { name: 'Günlük finansman tablosu; yatay kaydırılabilir' });
  await page.keyboard.press('Tab'); await scroll.focus();
  await expect(scroll).toBeFocused();
  expect(await scroll.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
  expect(await scroll.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
  await scroll.press('ArrowRight');
  expect(await scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole('combobox', { name: 'Dönem' }).click();
  await page.getByRole('option', { name: 'Şubat 2098', exact: true }).click();
  await expect(page.locator('.mantine-Select-dropdown')).toBeHidden();
  await expect(page.getByRole('region', { name: 'Şubat 2098 ay sonu' })).toContainText('1.400 ₺');
  await page.getByRole('tab', { name: 'Aylık özet', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Aylık finansman özeti' })).toBeVisible();
  await page.getByRole('tab', { name: 'Günlük adımlar', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Dönem' })).toHaveValue('Şubat 2098');
  await expect(page.getByRole('row', { name: /Sentetik iç aktarım/ })).toContainText('gelir değildir');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow at ${width}`).toBe(true);
    const tiny = await page.locator('.finance-page').evaluate(root => [...root.querySelectorAll('*')].filter(element => element.children.length === 0 && element.textContent?.trim() && element.getBoundingClientRect().height > 0 && parseFloat(getComputedStyle(element).fontSize) < 14).map(element => element.tagName));
    expect(tiny).toEqual([]);
    if ([320, 1440].includes(width)) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: testInfo.outputPath(`finance-${width}.png`), fullPage: false });
    }
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  await testInfo.attach('zoom-layout', { contentType: 'application/json', body: JSON.stringify(await page.locator('.finance-page').evaluate(root => [root, ...root.querySelectorAll('*')].filter(element => !element.closest('table') && element.getBoundingClientRect().right > innerWidth + 1).map(element => ({ tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right })))) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Dönem' })).toHaveValue('Şubat 2098');
  expect(await page.locator('select').count()).toBe(0);
});

test('stale native guard removes previously valid amounts and gives a recovery action', async ({ page }) => {
  const { source } = await financeSource(page);
  await page.goto('/aile/#/finansman');
  await expect(page.getByRole('table', { name: 'Günlük finansman adımları' })).toBeVisible();
  source.metadata.rows[2][0] = 'FALSE';
  await page.getByRole('button', { name: 'Yenile', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('hesabı yenilenmeli');
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.locator('.finance-summary')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Finansman e-tablosunu aç' })).toBeVisible();
  source.metadata.rows[2][0] = 'TRUE';
  await page.getByRole('button', { name: 'Yenile', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Günlük finansman adımları' })).toBeVisible();
});

test('slow source shows a single skeleton and reduced motion never fabricates financial values', async ({ page }) => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await financeSource(page, waiting);
  try {
    await page.goto('/aile/#/finansman');
    const skeleton = page.getByLabel('Finansman yükleniyor', { exact: true });
    await expect(skeleton).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('status')).toContainText('kontrol ediliyor');
    expect(await page.locator('.finance-loading-track span').evaluate(element => getComputedStyle(element).animationTimingFunction)).toBe('cubic-bezier(0.65, 0, 0.35, 1)');
    await expect(page.locator('.finance-page')).not.toContainText('₺');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.locator('.finance-loading-track span').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    release();
    await expect(page.getByRole('table', { name: 'Günlük finansman adımları' })).toBeVisible();
    await expect(skeleton).toHaveCount(0);
  } finally { release(); }
});

test.describe('production resource isolation', () => {
test.use({ serviceWorkers: 'allow' });
test('production navigation and service worker fetch financing only after its page is selected', async ({ page, context, browserName }, testInfo) => {
  test.skip(!testInfo.config.metadata.financeProduction, 'Production build and isolated preview required.');
  test.skip(browserName === 'webkit', 'WebKit service workers bypass Playwright route interception; synthetic source isolation cannot be guaranteed in this layer. UI runs separately with service workers blocked.');
  const files = (await readdir('dist/assets')).filter(name => /^(FinancePage|financeStore)-/.test(name));
  expect(files.length).toBeGreaterThan(0);
  const paths = new Set(files.map(name => `/aile/assets/${name}`));
  const assetRequests: string[] = [];
  context.on('request', request => { assetRequests.push(new URL(request.url()).pathname); });
  const { requests } = await financeSource(page);
  await page.goto('/aile/#/pano');
  await expect(page.getByRole('region', { name: 'Seçili ay özeti' })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  expect(assetRequests.filter(path => paths.has(path))).toEqual([]);
  expect(requests.filter(sheet => sheet === 'Finansman')).toEqual([]);
  await selectPage(page, 'Finansman');
  await expect(page.getByRole('table', { name: 'Günlük finansman adımları' })).toBeVisible();
  expect(assetRequests.filter(path => paths.has(path)).length).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('navigation', { name: 'Sayfalar', exact: true }).getByRole('link', { name: 'Finansman', exact: true })).toHaveAttribute('aria-current', 'page');
  const stored = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) urls.push(request.url);
    return { urls, local: { ...localStorage }, session: { ...sessionStorage } };
  });
  expect(stored.urls.some(url => url.includes('/gviz/'))).toBe(false);
  expect(JSON.stringify([stored.local, stored.session])).not.toContain('synthetic-opening');
});
});

test('remaining finance widths keep the daily ledger in its own scroll area', async ({ page }, testInfo) => {
  await financeSource(page);
  await page.goto('/aile/#/finansman');
  const table = page.getByRole('region', { name: 'Günlük finansman tablosu; yatay kaydırılabilir' });
  await expect(table).toBeVisible();
  for (const viewport of [{ width: 360, height: 740 }, { width: 375, height: 740 }, { width: 844, height: 390 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(viewport);
    await table.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`finance-daily-${viewport.width}x${viewport.height}.png`), fullPage: false });
  }
});

test('Timeline and Finansman use one verified ledger across hot navigation and stale refresh', async ({ page }, testInfo) => {
  const { source, requests } = await financeSource(page);
  await page.goto('/aile/#/timeline');
  const opening = page.getByRole('article', { name: '1. adım · Sentetik dönem başlangıcı' });
  await expect(opening).toContainText('KMH anaparası');
  await expect(opening).toContainText('-50 ₺');
  await expect(page.getByRole('region', { name: 'Ocak 2098 özeti' })).toContainText('500 ₺');
  expect(requests).toHaveLength(4);
  await page.getByRole('tab', { name: 'Tablo', exact: true }).click();
  const row = page.getByRole('row', { name: /Sentetik dönem başlangıcı/ });
  await expect(row.locator('[data-balance="cash"]')).toHaveText('0 ₺');
  await expect(row.locator('[data-balance="requiredBalance"]')).toHaveText('-50 ₺');
  await expect(row.locator('[data-balance="kmhPrincipal"]')).toHaveText('50 ₺');
  await selectPage(page, 'Finansman');
  await expect(page.getByRole('region', { name: 'Ocak 2098 ay sonu' })).toContainText('500 ₺');
  expect(requests, 'the detailed page reuses the same checked snapshot').toHaveLength(4);
  await selectPage(page, 'Ödeme takvimi');
  await expect(opening).toBeVisible();
  expect(requests, 'returning to the flow has no additional source latency').toHaveLength(4);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await opening.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`shared-timeline-${width}.png`), animations: 'disabled' });
  }
  source.metadata.rows[2] = ['FALSE'];
  await page.getByRole('button', { name: 'Yenile', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('finansman hesabı yenilenmeli');
  await expect(page.getByRole('article')).toHaveCount(0);
  await selectPage(page, 'Finansman');
  await expect(page.getByRole('alert')).toContainText('finansman hesabı yenilenmeli');
  await expect(page.getByRole('region', { name: 'Ocak 2098 ay sonu' })).toHaveCount(0);
});
