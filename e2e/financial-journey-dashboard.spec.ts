import { expect, test, type Page } from '@playwright/test';
import { syntheticSheets, gviz } from '../src/dashboard/fixtures';
import { syntheticBridgeResponse } from '../src/dashboard/bridgeFixtures';
import { syntheticTimeline, timelineResponse } from './timelineFinanceFixture';
import { visualizationSource } from './visualizationFixture';
import { feedName } from './webFeed';

async function source(page: Page) {
  const raw = syntheticSheets();
  const sheets = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', 'Düzensiz giderler': 'irregular' } as const;
  await page.route('**/gviz/tq?*', route => {
    if (feedName(new URL(route.request().url())) === '_Finans web') return route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), syntheticTimeline()) });
    const bridge = syntheticBridgeResponse(route.request().url());
    if (bridge) return route.fulfill({ contentType: 'application/json', body: bridge });
    const sheet = feedName(new URL(route.request().url())) as keyof typeof sheets;
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
  await expect(page.getByText(/Eksik tutar sıfır değildir/)).toBeVisible();
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
    const valueLabels = chart.locator('svg text').filter({ hasText: /^-?[\d.,]+(?:\s(?:bin|milyon|milyar|trilyon))?$/ });
    await expect.poll(() => valueLabels.count()).toBeGreaterThanOrEqual(2);
    const overlaps = () => valueLabels.evaluateAll(labels => {
      const boxes = labels.filter(label => getComputedStyle(label).visibility !== 'hidden' && getComputedStyle(label).display !== 'none').map(label => ({ text: label.textContent, box: label.getBoundingClientRect() }));
      return boxes.flatMap((current, index) => boxes.slice(index + 1).filter(next => current.box.left < next.box.right && current.box.right > next.box.left && current.box.top < next.box.bottom && current.box.bottom > next.box.top).map(next => [current.text, next.text]));
    });
    await chart.screenshot({ path: testInfo.outputPath('category-axis.png'), animations: 'disabled' });
    await expect.poll(overlaps).toEqual([]);
    await expect(valueLabels.filter({ hasText: /^0$/ })).toBeVisible();
    await expect(valueLabels.filter({ hasText: /^4 bin$/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Kalemler ve fark', exact: true }).click();
    await expect(page.getByRole('table')).toContainText('4.000 ₺');
  });
}

test('the budget month travels to the payment steps and financing, and financing steps between months by name', async ({ page, browserName }, testInfo) => {
  await source(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/pano');
  const picker = page.getByRole('combobox', { name: 'Gösterilen ay' });
  await picker.click();
  await page.getByRole('option', { name: 'Aralık 2098', exact: true }).click();
  const hero = page.getByRole('region', { name: 'Seçili ay özeti' }).locator('.metric-emphasis');
  await expect(hero).toContainText('Aralık 2098');
  await expect(hero).toContainText('Kasım 2098 ayına göre');
  await expect(page.getByRole('group', { name: 'Aralık 2098 · gelir, ödemeler ve birikim' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`budget-month-${browserName}-320.png`), fullPage: true });
  const toSteps = page.getByRole('navigation', { name: 'Bütçeden sonraki adım' }).getByRole('link', { name: /Aralık 2098 ödeme adımları/ });
  // Keyboard focus marks only the destination label, never the whole tile or its detail line.
  await toSteps.focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(toSteps).toBeFocused();
  expect(await toSteps.evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, tile: getComputedStyle(el).textDecorationLine, label: getComputedStyle(el.querySelector('.info-journey-label')!).textDecorationLine, detail: getComputedStyle(el.querySelector('.info-journey-detail')!).textDecorationLine }))).toEqual({ outline: 'none', tile: 'none', label: 'underline', detail: 'none' });
  await toSteps.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Gösterilen dönem' })).toHaveValue('Aralık 2098');
  await page.getByRole('link', { name: 'Aylık özet ve ayrıntılı tablo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Aralık 2098 · ay sonu', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Aralık 2098 ay sonu' })).toContainText('Kasım 2098 ay sonuna göre');
  const previous = page.getByRole('button', { name: 'Önceki ay · Kasım 2098', exact: true });
  expect((await previous.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await previous.click();
  await expect(page.getByRole('heading', { name: 'Kasım 2098 · ay sonu', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Kasım 2098 ay sonu' })).toContainText('İlk ay · önceki ayla karşılaştırma yok');
  await expect(page.getByRole('button', { name: /^Önceki ay/ })).toBeDisabled();
  await expect(page.getByRole('navigation', { name: 'Bu aydan sonraki adım' }).getByRole('link', { name: /Kasım 2098 ödeme adımları/ })).toBeVisible();
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.locator('.finance-page *').evaluateAll(els => els.filter(el => el.textContent?.trim() && el.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(el).fontSize) < 14).length)).toBe(0);
  }
});

test('narrow purchase rows show what and how much in the visible column, and active filters clear in one step', async ({ page, browserName }) => {
  await source(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/ev');
  const table = page.getByRole('table', { name: 'Bütçedeki alım planı', exact: true });
  const glance = table.locator('tbody tr').nth(1).locator('.home-plan-glance');
  await expect(glance).toHaveText('Tutar yok · Aralık 2098');
  const visible = await glance.evaluate(el => { const box = el.getBoundingClientRect(), plane = el.closest('.table-scroll')!.getBoundingClientRect(); return box.left >= plane.left - 1 && box.right <= plane.right + 1 && parseFloat(getComputedStyle(el).fontSize) >= 14; });
  expect(visible).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(glance).toBeHidden();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: 'Tutarı eksik', exact: true }).click();
  const status = page.getByRole('group', { name: 'Etkin filtreler' });
  await expect(status).toContainText('Tutarı eksik · 1 / 3 kalem');
  const clear = page.getByRole('button', { name: 'Filtreleri temizle', exact: true });
  await clear.focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(clear).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Alım planında ara' })).toBeFocused();
  await expect(status).toHaveCount(0);
  await expect(table.locator('tbody tr')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

const navigate = async (page: Page, name: string) => {
  const menu = page.getByRole('button', { name: 'Sayfalar', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Sayfalar', exact: true }).getByRole('link', { name, exact: true }).click();
};

test('a named Finance month link takes Timeline to that month even after an all-period Timeline scope', async ({ page }) => {
  await source(page);
  await page.goto('/aile/#/timeline');
  await page.getByRole('combobox', { name: 'Gösterilen dönem' }).click();
  await page.getByRole('option', { name: 'Tüm dönem', exact: true }).click();
  await navigate(page, 'Finansman');
  const month = page.getByRole('combobox', { name: 'Dönem', exact: true });
  await expect(month).toHaveValue('Kasım 2098');
  // The all-period scope is named, not formatted as a date and not presented as a selected month.
  await expect(page.getByRole('note', { name: 'Seçilen dönem' })).toHaveText('Tüm dönem bu sayfada aylık özet olarak gösterilmez; Kasım 2098 gösteriliyor.');
  await page.getByRole('navigation', { name: 'Bu aydan sonraki adım', exact: true }).getByRole('link', { name: /Kasım 2098 ödeme adımları/ }).click();
  await expect(page).toHaveURL(/#\/timeline$/);
  await expect(page.getByRole('combobox', { name: 'Gösterilen dönem' })).toHaveValue('Kasım 2098');
});

test('global navigation keeps a chosen budget month through financing and back to the budget', async ({ page }) => {
  await source(page);
  await page.goto('/aile/#/pano');
  await page.getByRole('combobox', { name: 'Gösterilen ay' }).click();
  await page.getByRole('option', { name: 'Aralık 2098', exact: true }).click();
  await navigate(page, 'Finansman');
  await expect(page.getByRole('combobox', { name: 'Dönem', exact: true })).toHaveValue('Aralık 2098');
  await navigate(page, 'Ödeme takvimi');
  await expect(page.getByRole('combobox', { name: 'Gösterilen dönem' })).toHaveValue('Aralık 2098');
  await navigate(page, 'Genel bütçe');
  await expect(page.getByRole('combobox', { name: 'Gösterilen ay' })).toHaveValue('Aralık 2098');
});


for (const fontState of ['loaded', 'blocked'] as const) test(`exact chart amounts reflow at 200 and 210 percent with the brand font ${fontState}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await visualizationSource(page, true);
  let blockedFonts = 0;
  if (fontState === 'blocked') await page.route('**/fonts/*.ttf', route => { blockedFonts++; return route.abort(); });
  await page.goto('/aile/#/pano');
  await page.locator('.charts-host').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.charts-host').scrollIntoViewIfNeeded();
  const cash = page.getByRole('region', { name: 'Nakit nasıl ilerliyor?' });
  await expect(cash.getByRole('group', { name: 'Kasım 2098 değerleri' })).toContainText('1.234.567,89 ₺');
  for (const scale of [200, 210]) {
    await page.evaluate(async value => { document.documentElement.style.fontSize = `${value}%`; await document.fonts.ready; }, scale);
    if (fontState === 'loaded') {
      await page.evaluate(() => document.fonts.load('700 40px Outfit'));
      expect(await page.evaluate(() => document.fonts.check('700 40px Outfit'))).toBe(true);
    } else expect(blockedFonts).toBeGreaterThan(0);
    const boxes = await cash.locator('.chart-selected dd').evaluateAll(elements => elements.flatMap(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return [...range.getClientRects()].map(rect => ({ text: element.textContent, font: style.fontFamily, size: style.fontSize, width: rect.width, available: box.width, right: rect.right, bound: box.right }));
    }));
    for (const box of boxes) {
      expect(Number.parseFloat(box.size), 'root text enlargement is preserved').toBeGreaterThanOrEqual(40);
      expect(box.right, JSON.stringify(box)).toBeLessThanOrEqual(box.bound + 1);
    }
    const amount = cash.locator('.chart-selected dd').first();
    await expect(amount).toHaveText('1.234.567,89 ₺');
    const numericLines = await amount.evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), tops = new Set<number>();
      while (walker.nextNode()) {
        const node = walker.currentNode, match = node.textContent?.match(/[-\d.,]+/);
        if (!match) continue;
        const range = document.createRange(); range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
        for (const rect of range.getClientRects()) tops.add(Math.round(rect.top));
      }
      return tops.size;
    });
    expect(numericLines, 'normal enlarged amounts stay together; larger type wraps only at group boundaries').toBeLessThanOrEqual(scale === 200 ? 1 : 2);
    expect(await amount.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      const copied = selection.toString(); selection.removeAllRanges(); return copied;
    }), 'selecting the amount preserves every digit and separator').toBe('1.234.567,89 ₺');
    await cash.getByRole('heading').click();
    await cash.screenshot({ path: info.outputPath(`pano-${fontState}-amount-320-${scale}-percent.png`) });
  }
});
