import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { syntheticLongTimeline, syntheticTimeline } from '../src/timeline/fixtures';
import { gviz } from '../src/dashboard/fixtures';

async function mockTimeline(page: Page, largeAmounts = false) {
  const table = syntheticTimeline();
  if (largeAmounts) table.rows.forEach(row => {
    for (const column of [6, 9]) row[column] = Math.round(Number(row[column]) * 1234.56 * 100) / 100;
    for (const column of [7, 10, 12]) row[column] = Math.round(Number(row[column]) * 2181.07 * 100) / 100;
  });
  table.rows[2][4] = 'Salon için ölçüye uygun uzun modüler koltuk takımı siparişi';
  table.rows[2][14] = 'Teslimat tarihi satıcı ile teyit edilecek; satın alma ve teslimat ayrı adımlardır.';
  let broken = false;
  const feeds: string[] = [], requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.route('**/gviz/tq?*', route => {
    const sheet = new URL(route.request().url()).searchParams.get('sheet') ?? '';
    feeds.push(sheet);
    if (sheet !== 'Timeline') return route.fulfill({ status: 503, body: 'Unexpected feed' });
    const rows = table.rows.map(row => [...row]);
    if (broken) rows[4][15] = 5;
    return route.fulfill({ contentType: 'application/json', body: gviz(rows, table.labels) });
  });
  return { feeds, requests, breakLedger: () => { broken = true; }, restore: () => { broken = false; } };
}

test('timeline deep link shows each cash/debt step independently of old budget feeds', async ({ page }) => {
  const mock = await mockTimeline(page);
  await page.goto('/aile/#/timeline');
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
  const purchase = page.getByRole('article', { name: /3\. adım/ });
  await expect(purchase).toContainText('1.000 ₺');
  await expect(purchase).toContainText('500 ₺');
  await expect(page.getByRole('link', { name: 'Timeline', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(mock.feeds.every(feed => feed === 'Timeline')).toBe(true);
  expect(mock.requests.some(url => /(?:VehiclePage|LegacyApp|\/Charts\.tsx)/.test(url))).toBe(false);
  mock.breakLedger();
  await page.getByRole('button', { name: 'Yenile', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Son başarılı takvim');
  await expect(purchase).toContainText('500 ₺');
  mock.restore();
  await page.getByRole('button', { name: 'Yenile', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sonraki ay' }).click();
  await expect(page.getByRole('article', { name: /6\. adım/ })).toContainText('-100 ₺');
  await expect(page.getByRole('alert')).toContainText('Negatif tutar kullanılabilir para değildir');
  await expect(page.getByRole('complementary', { name: 'Tarih ve ödeme varsayımları' })).toContainText('varsayımdır');
  const picker = page.getByRole('textbox', { name: 'Gösterilen dönem' }).or(page.getByRole('combobox', { name: 'Gösterilen dönem' }));
  await picker.click();
  await page.getByRole('option', { name: 'Tüm dönem' }).click();
  await expect(page.getByRole('article')).toHaveCount(8);
});

test('plain Timeline URLs override an obsolete pano hash and open the same canonical page', async ({ page }) => {
  const mock = await mockTimeline(page);
  for (const path of ['/aile/timeline#/pano', '/aile/timeline/#/pano', '/aile/timeline/index.html']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/aile\/#\/timeline$/);
    await expect(page.getByRole('article')).toHaveCount(5);
    expect(mock.feeds.every(feed => feed === 'Timeline')).toBe(true);
  }
});

test('six-digit cash and debt stay intact at 320px with 200% text', async ({ page, browserName }) => {
  await mockTimeline(page, true);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/timeline');
  await expect(page.getByRole('article')).toHaveCount(5);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const measurements = await page.locator('.timeline-balances dd, .timeline-summary strong').evaluateAll(elements => elements.map(element => {
    const text = element.firstChild!;
    const number = text.textContent!.split(' ')[0];
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, number.length);
    return { amount: number, width: range.getBoundingClientRect().width, available: element.getBoundingClientRect().width, lines: range.getClientRects().length, font: parseFloat(getComputedStyle(element).fontSize) };
  }));
  expect(measurements.some(measurement => measurement.amount === '654.321')).toBe(true);
  for (const measurement of measurements) {
    expect(measurement.lines, measurement.amount).toBe(1);
    expect(measurement.width, measurement.amount).toBeLessThanOrEqual(measurement.available + 1);
    expect(measurement.font).toBeGreaterThanOrEqual(14);
  }
  await page.screenshot({ path: `test-results/timeline-${browserName}-320-large-200.png`, fullPage: true });
});

test('all-period view bounds rendering and preserves balances through 716 chronological steps', async ({ page }) => {
  const table = syntheticLongTimeline();
  expect(table.rows).toHaveLength(716);
  await page.route('**/gviz/tq?*', route => route.fulfill({ contentType: 'application/json', body: gviz(table.rows, table.labels) }));
  await page.goto('/aile/#/timeline');
  await expect(page.getByRole('article')).toHaveCount(28);
  const picker = page.getByRole('combobox', { name: 'Gösterilen dönem' });
  await picker.click(); await page.getByRole('option', { name: 'Tüm dönem' }).click();
  await expect(page.getByRole('article')).toHaveCount(50);
  const pages = page.getByRole('navigation', { name: 'Adım sayfaları üst' });
  await expect(pages).toContainText('1–50 / 716 adım');
  const summary = page.getByRole('region', { name: 'Tüm dönem özeti' });
  await expect(summary).toContainText('654.321 ₺');
  for (let pageNumber = 1; pageNumber < 15; pageNumber++) {
    await pages.getByRole('button', { name: 'Sonraki adımlar' }).click();
    expect(await page.getByRole('article').count()).toBeLessThanOrEqual(50);
  }
  await expect(page.getByRole('article')).toHaveCount(16);
  await expect(page.getByRole('article', { name: /716\. adım/ })).toContainText('1.234.567 ₺');
  await expect(pages.getByRole('button', { name: 'Sonraki adımlar' })).toBeDisabled();
  await expect(summary).toContainText('654.321 ₺');
  await picker.click(); await page.getByRole('option', { name: 'Kasım 2098' }).click();
  await expect(page.getByRole('article')).toHaveCount(28);
  await expect(page.getByRole('article', { name: /^1\. adım ·/ })).toBeVisible();
  await picker.click(); await page.getByRole('option', { name: 'Tüm dönem' }).click();
  await expect(pages).toContainText('1–50 / 716 adım');
  await expect(page.getByRole('article', { name: /^1\. adım ·/ })).toBeVisible();
});

test('compact journey preserves readability, focus, dropdown state and responsive layout', async ({ page, browserName }) => {
  await mockTimeline(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/timeline');
  await expect(page.getByRole('article')).toHaveCount(5);
  const picker = page.getByRole('textbox', { name: 'Gösterilen dönem' }).or(page.getByRole('combobox', { name: 'Gösterilen dönem' }));
  await picker.click();
  await expect(page.getByRole('option', { name: 'Aralık 2098' })).toBeVisible();
  await picker.press('ArrowDown'); await picker.press('Enter');
  await picker.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  const focus = await page.evaluate(() => { const style = getComputedStyle(document.activeElement!); return { mode: document.documentElement.dataset.keyboard, outline: style.outlineStyle, decoration: style.textDecorationLine }; });
  expect(focus).toEqual({ mode: 'true', outline: 'none', decoration: 'underline' });
  const previous = page.getByRole('button', { name: 'Önceki ay' });
  await previous.click();
  const motion = await previous.evaluate(element => { const style = getComputedStyle(element); return { duration: style.transitionDuration, easing: style.transitionTimingFunction }; });
  expect(motion.duration).toContain('0.24s'); expect(motion.easing).toContain('cubic-bezier(0.65, 0, 0.35, 1)');
  for (const width of [320, 360, 375, 390, 740, 768, 1023, 1024, 1025, 1440]) {
    await page.setViewportSize({ width, height: width === 740 ? 360 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow at ${width}`).toBe(true);
    expect(await page.locator('main').evaluate(element => Array.from(element.querySelectorAll('*')).filter(node => node.textContent?.trim() && node.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(node).fontSize) < 14).map(node => node.tagName))).toEqual([]);
    await expect(picker).toHaveValue('Kasım 2098');
  }
  const violations = (await new AxeBuilder({ page }).include('.budget-app').analyze()).violations;
  expect(violations.map(violation => violation.id)).toEqual([]);
  await page.screenshot({ path: `test-results/timeline-${browserName}-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({ path: `test-results/timeline-${browserName}-320.png`, fullPage: true });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await previous.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
});
