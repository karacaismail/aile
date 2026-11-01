import { expect, test, type Page } from '@playwright/test';
import { syntheticSheets, gviz } from '../src/dashboard/fixtures';
import { syntheticBridgeResponse } from '../src/dashboard/bridgeFixtures';

async function source(page: Page) {
  const raw = syntheticSheets();
  const sheets = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', 'Düzensiz giderler': 'irregular' } as const;
  await page.route('**/gviz/tq?*', route => {
    const bridge = syntheticBridgeResponse(route.request().url());
    if (bridge) return route.fulfill({ contentType: 'application/json', body: bridge });
    const sheet = new URL(route.request().url()).searchParams.get('sheet') as keyof typeof sheets;
    const key = sheets[sheet];
    if (!key) return route.fulfill({ status: 404 });
    const monthly = key === 'plan' || key === 'actual';
    return route.fulfill({ contentType: 'application/json', body: gviz(monthly ? raw[key].map(row => row.slice(0, 4)) : raw[key], monthly ? ['Kalem', ...raw.summary.map(row => String(row[0]))] : undefined) });
  });
}

test('purchase plan narrows source categories and missing prices without treating zero as unknown', async ({ page }) => {
  await source(page);
  await page.goto('/aile/#/ev');
  const table = page.getByRole('table', { name: 'Bütçedeki alım planı', exact: true });
  await expect(table).toContainText('Fiyatı beklenen ürün');
  await page.getByRole('button', { name: 'Tutarı eksik', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table).toContainText('Tutar yok');
  await expect(table).not.toContainText('İptal edilen ürün');
  await page.getByRole('button', { name: 'Tüm alımlar', exact: true }).click();
  await page.getByRole('combobox', { name: 'Alım kategorisi', exact: true }).click();
  await page.getByRole('option', { name: 'Tek seferlik', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table).toContainText('İptal edilen ürün');
  await expect(table).toContainText('0 ₺');
  await page.getByRole('button', { name: 'Tutarı eksik', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByText('Bu filtrelerle eşleşen kayıt yok.')).toBeVisible();
  const journey = page.getByRole('navigation', { name: 'Alımdan sonraki adım', exact: true });
  await expect(journey.getByRole('link', { name: 'Hazırlık listesine git' })).toHaveAttribute('href', '#/satinalma');
  await expect(page.getByText(/Plan tutarı ödeme yapıldığı anlamına gelmez/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('table exploration restores source order and keyboard focus without changing records', async ({ page, browserName }) => {
  await source(page);
  await page.goto('/aile/#/ev');
  const table = page.getByRole('table', { name: 'Bütçedeki alım planı', exact: true });
  await expect(table.locator('tbody tr')).toHaveCount(3);
  const original = await table.locator('tbody tr').allTextContents();
  const sort = table.getByRole('button', { name: 'Güncel tutar', exact: true });
  await sort.click();
  await expect(table.locator('tbody tr').first()).toContainText('İptal edilen ürün');
  const restore = page.getByRole('button', { name: 'Kaynak sırasına dön', exact: true });
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await restore.focus(); await restore.press('Enter');
  await expect(sort).toBeFocused();
  expect(await table.locator('tbody tr').allTextContents()).toEqual(original);
  await expect(page.getByRole('status').filter({ hasText: '1–3 / 3 kayıt' })).toBeVisible();
  const focus = await sort.evaluate(element => ({ outline: getComputedStyle(element).outlineStyle, decoration: getComputedStyle(element).textDecorationLine }));
  expect(focus.outline).toBe('none');
  expect(focus.decoration).toContain('underline');
});

test('the first planned item is reachable on the initial narrow screen before supporting scope notes', async ({ page }, testInfo) => {
  await source(page);
  await page.setViewportSize({width:320,height:740});
  await page.goto('/aile/#/ev');
  const row=page.getByRole('table',{name:'Bütçedeki alım planı',exact:true}).locator('tbody tr').first();
  await expect(row).toBeVisible();
  const title=row.locator('strong').first();
  expect((await title.boundingBox())!.y+(await title.boundingBox())!.height).toBeLessThanOrEqual(740);
  expect((await page.getByRole('region',{name:'Alım planının kapsamı'}).boundingBox())!.y).toBeGreaterThan((await row.boundingBox())!.y);
  await page.screenshot({path:testInfo.outputPath('home-first-screen-320.png')});
});
for (const width of [320, 1440]) for (const textScale of [100, 200]) {
  test(`category chart value labels stay distinct at ${width}px and ${textScale}% text`, async ({ page }, testInfo) => {
    await source(page);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/aile/#/pano');
    await page.evaluate(scale => { document.documentElement.style.fontSize = `${scale}%`; }, textScale);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.charts-host').scrollIntoViewIfNeeded();
    const chart = page.locator('.chart-section').filter({ has: page.getByRole('heading', { name: 'Kasım 2098 ödemeleri', exact: true }) }).locator('.budget-chart');
    const valueLabels = chart.locator('svg text').filter({ hasText: /^\d+ bin$/ });
    await expect.poll(() => valueLabels.count()).toBeGreaterThanOrEqual(2);
    const overlaps = () => valueLabels.evaluateAll(labels => {
      const boxes = labels.filter(label => getComputedStyle(label).visibility !== 'hidden' && getComputedStyle(label).display !== 'none').map(label => ({ text: label.textContent, box: label.getBoundingClientRect() }));
      return boxes.flatMap((current, index) => boxes.slice(index + 1).filter(next => current.box.left < next.box.right && current.box.right > next.box.left && current.box.top < next.box.bottom && current.box.bottom > next.box.top).map(next => [current.text, next.text]));
    });
    await chart.screenshot({ path: testInfo.outputPath('category-axis.png'), animations: 'disabled' });
    await expect.poll(overlaps).toEqual([]);
    await expect(valueLabels.filter({ hasText: /^0 bin$/ })).toBeVisible();
    await expect(valueLabels.filter({ hasText: /^4 bin$/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Kalemler ve fark', exact: true }).click();
    await expect(page.getByRole('table')).toContainText('4.000 ₺');
  });
}
