import { writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { visualizationSource } from './visualizationFixture';

async function readable(page: Page, selector: string) {
  const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'absolute' && !e.closest('.table-scroll')).slice(0, 12).map(e => ({ tag: e.tagName, class: e.className, right: e.getBoundingClientRect().right })) }));
  expect(layout.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width + 1);
  expect(await page.locator(selector).evaluate(root => [...root.querySelectorAll('*')].filter(element => !element.children.length && element.textContent?.trim() && element.getBoundingClientRect().height > 0 && parseFloat(getComputedStyle(element).fontSize) < 14).map(element => element.tagName))).toEqual([]);
}

test('monthly trends keep exact selected values and all source facts across narrow and wide layouts', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const source = await visualizationSource(page);
  await page.goto('/aile/#/finansman');
  await expect(page.getByRole('region', { name: 'Ocak 2098 ay sonu' })).toBeVisible();
  await expect(page.locator('.finance-trends')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Aylık özet', exact: true }).click();
  const trends = page.getByRole('region', { name: 'Nakit ve borcun seyri' });
  await expect(trends.locator('svg')).toHaveCount(3);
  await expect(trends.getByRole('img', { name: /^Harcanabilir nakit: ay sonu eğilimi\. Seçili Ocak 2098: 500 ₺/ })).toBeVisible();
  await expect(trends.getByRole('group', { name: 'Harcanabilir nakit', exact: true })).toContainText('500 ₺');
  await expect(trends.getByRole('group', { name: 'Toplam kart borcu', exact: true })).toContainText('155 ₺');
  await page.getByRole('button', { name: 'Sonraki ay · Şubat 2098' }).click();
  await expect(trends.getByRole('group', { name: 'Harcanabilir nakit', exact: true })).toContainText('1.400 ₺');
  await expect(trends.getByRole('group', { name: 'Toplam kart borcu', exact: true })).toContainText('305 ₺');
  await expect(trends).toContainText('Dönemin tüm ay sonlarında 0 ₺');
  for (const width of [320, 360, 375, 390, 568, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 568 ? 320 : 900 });
    await readable(page, '.finance-trends');
    if (width === 320 || width === 1440) { await trends.getByRole('heading', { name: 'Nakit ve borcun seyri' }).click(); await trends.screenshot({ path: info.outputPath(`finance-trends-${width}.png`) }); }
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  await readable(page, '.finance-trends');
  await page.evaluate(() => document.documentElement.style.fontSize = '');
  await page.keyboard.press('Tab');
  const jump = trends.getByRole('button', { name: 'Bütün aylık tutarlara git' });
  await jump.focus();
  expect(await jump.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
  expect(await jump.evaluate(element => getComputedStyle(element).textDecorationLine)).toContain('underline');
  await jump.press('Enter');
  await expect(page.getByRole('region', { name: 'Aylık finansman tablosu; yatay kaydırılabilir' })).toBeFocused();
  expect(new URL(page.url()).hash).toBe('#/finansman');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(trends.locator('svg')).toHaveCount(3);
  source.metadata.rows[2][0] = 'FALSE';
  await page.getByRole('button', { name: 'Yenile', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(trends).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('Pano shows exact selected values beside every chart and uses visible outline plan bars', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await visualizationSource(page);
  await page.goto('/aile/#/pano');
  await page.locator('.charts-host').scrollIntoViewIfNeeded();
  const cash = page.getByRole('region', { name: 'Nakit nasıl ilerliyor?' });
  await expect(cash.locator('svg')).toBeVisible();
  await page.getByRole('combobox', { name: 'Gösterilen ay' }).click();
  await page.getByRole('option', { name: 'Aralık 2098', exact: true }).click();
  await expect(page.locator('.mantine-Select-dropdown')).toBeHidden();
  await expect(cash.getByRole('group', { name: 'Aralık 2098 değerleri' })).toContainText('7.500 ₺');
  await expect(page.getByRole('region', { name: 'Birikimin seyri' }).getByRole('group', { name: 'Aralık 2098 değerleri' })).toContainText('4.000 ₺');
  const categories = page.getByRole('region', { name: 'Aralık 2098 ödemeleri', exact: true });
  await expect(categories.locator('svg path[fill="#FFFFFF"][stroke="#52697C"]')).not.toHaveCount(0);
  await expect(categories.getByRole('group', { name: 'Borç ve vergi tutarları' })).toContainText('0 ₺');
  await page.setViewportSize({ width: 1440, height: 900 });
  const scroll = categories.getByRole('region', { name: 'Kategori tutarları; yatay kaydırılabilir' });
  await page.keyboard.press('Tab'); await scroll.focus();
  expect(await scroll.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
  expect(await scroll.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
  if (await scroll.evaluate(element => element.scrollWidth > element.clientWidth)) {
    await scroll.press('ArrowRight');
    expect(await scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  }
  await page.mouse.click(1, 1);
  await scroll.evaluate(element => element.scrollLeft = 0);
  await expect(page.locator('.chart-context')).toContainText('Kaynak: Plandan');
  for (const width of [320, 360, 375, 390, 568, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 568 ? 320 : 900 });
    await readable(page, '.chart-grid');
    if (width === 320 || width === 1440) await categories.screenshot({ path: info.outputPath(`pano-categories-${width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  await readable(page, '.chart-grid');
});

test('optional chart download failure leaves exact figures and the entire monthly table usable', async ({ page }) => {
  await visualizationSource(page);
  await page.route('**/src/dashboard/Charts.tsx*', route => route.abort());
  await page.goto('/aile/#/finansman');
  await page.getByRole('tab', { name: 'Aylık özet', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Grafik yüklenemedi' })).toHaveCount(3);
  const trends = page.getByRole('region', { name: 'Nakit ve borcun seyri' });
  await expect(trends.getByRole('group', { name: 'Harcanabilir nakit', exact: true })).toContainText('500 ₺');
  await expect(page.getByRole('table', { name: 'Aylık finansman özeti' })).toContainText('Şubat 2098');
  await page.getByRole('tab', { name: 'Günlük adımlar', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Günlük finansman adımları' })).toBeVisible();
});

test('million-TL exact values reflow at 320px and 200 percent text without clipping', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await visualizationSource(page, true);
  await page.goto('/aile/#/pano');
  await page.locator('.charts-host').scrollIntoViewIfNeeded();
  const cash = page.getByRole('region', { name: 'Nakit nasıl ilerliyor?' });
  await expect(cash.getByRole('group', { name: 'Kasım 2098 değerleri' })).toContainText('1.234.567,89 ₺');
  await page.setViewportSize({ width: 320, height: 740 });
  await readable(page, '.chart-grid');
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  await readable(page, '.chart-grid');
  const textBounds = await cash.locator('.chart-selected dd').evaluateAll(elements => elements.map(element => {
    const range = document.createRange(); range.selectNodeContents(element); const box = element.getBoundingClientRect();
    return [...range.getClientRects()].map(rect => ({ width: rect.width, available: box.width, right: rect.right, bound: box.right }));
  }).flat());
  for (const rect of textBounds) expect(rect.right, JSON.stringify(rect)).toBeLessThanOrEqual(rect.bound + 1);
  await cash.getByRole('heading').click();
  await cash.screenshot({ path: info.outputPath('pano-million-320-200-percent.png') });
});

test('category pairs stay together at 320px and 200 percent text', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await visualizationSource(page);
  await page.goto('/aile/#/pano');
  await page.locator('.charts-host').scrollIntoViewIfNeeded();
  const categories = page.getByRole('region', { name: 'Kasım 2098 ödemeleri', exact: true });
  const labels = ['Borç ve vergi', 'Faturalar', 'Ev', 'Okul', 'Günlük yaşam', 'Düzensiz giderler'];
  for (const size of ['100%', '200%']) {
    await page.evaluate(value => document.documentElement.style.fontSize = value, size);
    for (const label of labels) {
      const pair = categories.getByRole('group', { name: `${label} tutarları` });
      await expect(pair).toBeVisible();
      await expect(pair.getByRole('heading')).toHaveText(label);
      await expect(pair.locator('dt')).toHaveText(['Plan', 'Güncel']);
      const bounds = await pair.evaluate(element => {
        const box = element.getBoundingClientRect();
        return [...element.querySelectorAll('h3,dt,dd')].flatMap(child => {
          const range = document.createRange(); range.selectNodeContents(child);
          return [...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right, start: box.left, end: box.right }));
        });
      });
      for (const rect of bounds) { expect(rect.left).toBeGreaterThanOrEqual(rect.start - 1); expect(rect.right).toBeLessThanOrEqual(rect.end + 1); }
    }
    await readable(page, '.chart-grid');
    await categories.getByRole('heading', { level: 2 }).click();
    await categories.screenshot({ path: info.outputPath(`category-pairs-320-${size}.png`) });
  }
});

test('category table headings align with their desktop source values', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visualizationSource(page);
  await page.goto('/aile/#/pano');
  await page.locator('.charts-host').scrollIntoViewIfNeeded();
  const table = page.getByRole('table', { name: 'Kasım 2098 kategori tutarları' });
  await expect(table).toBeVisible();
  const bounds = await table.evaluate(element => {
    const text = (selector: string) => { const range = document.createRange(); range.selectNodeContents(element.querySelector(selector)!); return range.getBoundingClientRect().toJSON(); };
    return { name: text('tbody th'), value: text('tbody td'), heading: text('thead th:last-child'), final: text('tbody td:last-child') };
  });
  expect(Math.abs(bounds.name.top - bounds.value.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds.heading.right - bounds.final.right)).toBeLessThanOrEqual(1);
});

test('failed chart download offers a truthful page reload and recovers after the connection returns', async ({ page }) => {
  await visualizationSource(page);
  let blocked = true;
  await page.route('**/src/dashboard/Charts.tsx*', route => blocked ? route.abort() : route.continue());
  await page.goto('/aile/#/finansman');
  await page.getByRole('tab', { name: 'Aylık özet', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Grafik yüklenemedi' })).toHaveCount(3);
  const reload = page.getByRole('button', { name: 'Sayfayı yenile', exact: true });
  await expect(reload).toBeVisible();
  blocked = false;
  await Promise.all([page.waitForEvent('load'), reload.click()]);
  await page.getByRole('tab', { name: 'Aylık özet', exact: true }).click();
  await expect(page.locator('.finance-trends svg')).toHaveCount(3);
  await expect(page.getByRole('table', { name: 'Aylık finansman özeti' })).toBeVisible();
});

for (const longPeriod of [false, true]) test(`calendar axis evidence at 320 CSS pixels: ${longPeriod ? '14 and 26 months' : '3 months'}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await visualizationSource(page, false, longPeriod);
  await page.goto('/aile/#/pano');
  await page.locator('.charts-host').scrollIntoViewIfNeeded();
  const evidence: unknown[] = [];
  for (const title of ['Nakit nasıl ilerliyor?', 'Gelir ve ödemeler', 'Birikimin seyri']) {
    const panel = page.getByRole('region', { name: title, exact: true });
    await expect(panel.locator('svg')).toBeVisible();
    evidence.push(await panel.evaluate(element => ({ title: element.getAttribute('aria-labelledby'), viewport: innerWidth, dpr: devicePixelRatio, width: element.getBoundingClientRect().width, labels: [...element.querySelectorAll('svg text')].map(label => ({ text: label.textContent, rect: label.getBoundingClientRect().toJSON() })) })));
    await panel.screenshot({ path: info.outputPath(`pano-${title.replaceAll(' ', '-')}-320.png`) });
  }
  if (longPeriod) {
    await page.goto('/aile/#/finansman');
    await page.getByRole('tab', { name: 'Aylık özet', exact: true }).click();
    const trends = page.getByRole('region', { name: 'Nakit ve borcun seyri' });
    await expect(trends.locator('svg')).toHaveCount(3);
    for (const chart of await trends.locator('svg').all()) { const labels = await chart.locator('text').allTextContents(); expect(labels).toContain('Kas 98'); expect(labels).toContain('Ara 00'); }
    await expect(page.getByRole('table', { name: 'Aylık finansman özeti' }).getByRole('row')).toHaveCount(27);
    await readable(page, '.finance-trends');
    evidence.push(await trends.evaluate(element => ({ title: 'Finance26', viewport: innerWidth, dpr: devicePixelRatio, width: element.getBoundingClientRect().width, labels: [...element.querySelectorAll('svg text')].map(label => ({ text: label.textContent, rect: label.getBoundingClientRect().toJSON() })) })));
    await trends.screenshot({ path: info.outputPath('finance-26-months-320.png') });
  }
  await writeFile(info.outputPath('calendar-axis-evidence.json'), JSON.stringify(evidence, null, 2));
  if (longPeriod) await page.goto('/aile/#/pano');
  await page.locator('.charts-host').scrollIntoViewIfNeeded();
  for (const title of ['Nakit nasıl ilerliyor?', 'Gelir ve ödemeler', 'Birikimin seyri']) {
    const panel = page.getByRole('region', { name: title, exact: true });
    await expect(panel.locator('svg')).toBeVisible();
    const labels = await panel.locator('svg text').allTextContents();
    expect(labels).toContain('Kas 98');
    expect(labels).toContain(longPeriod ? 'Ara 99' : 'Oca 99');
  }
});
