import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { syntheticSheets, gviz } from '../src/dashboard/fixtures';
import { syntheticTimeline } from '../src/timeline/fixtures';
import { mockApi } from './helpers';

async function mockFamily(page: Page) {
  await mockApi(page);
  const raw = syntheticSheets();
  const timeline = syntheticTimeline();
  const map = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', 'Düzensiz giderler': 'irregular' } as const;
  const feeds: string[] = [];
  await page.route('**/gviz/tq?*', route => {
    const sheet = new URL(route.request().url()).searchParams.get('sheet')!;
    feeds.push(sheet);
    if (sheet === '_Timeline web') return route.fulfill({ contentType: 'application/json', body: gviz(timeline.rows, timeline.labels) });
    const key = map[sheet as keyof typeof map];
    if (!key) return route.fulfill({ status: 404, body: 'Unknown sheet' });
    const rows = key === 'plan' || key === 'actual' ? raw[key].map(row => row.slice(0, 4)) : raw[key];
    return route.fulfill({ contentType: 'application/json', body: gviz(rows, key === 'plan' || key === 'actual' ? ['Kalem', ...raw.summary.map(row => String(row[0]))] : undefined) });
  });
  return { feeds };
}

test('all family areas share one identity and a complete primary journey', async ({ page }, testInfo) => {
  await mockFamily(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 320, height: 740 });
  for (const route of ['pano', 'timeline', 'ev', 'satinalma', 'aydinlatma', 'tadilat', 'yerlesim', 'butce', 'ayarlar', 'arac']) {
    await page.goto(`/aile/#/${route}`);
    await expect(page.locator('.family-primary, .family-context')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Sayfalar', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sayfalar', exact: true }).click();
    const mobileNavigation = page.getByRole('navigation', { name: 'Sayfalar', exact: true });
    for (const name of ['Genel bütçe', 'Ödeme takvimi', 'Alım planı', 'Araç ve finansman']) await expect(mobileNavigation.getByRole('link', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sayfaları kapat' }).click();
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
    expect(await page.getByRole('main').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Outfit');
    for (const width of [320, 360, 375, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} at ${width}`).toBe(true);
      if (width >= 1024) {
        const navigation = page.getByRole('navigation', { name: 'Sayfalar', exact: true });
        for (const name of ['Genel bütçe', 'Ödeme takvimi', 'Alım planı', 'Araç ve finansman']) await expect(navigation.getByRole('link', { name, exact: true })).toBeVisible();
      }
    }
    if (['ev', 'satinalma', 'arac'].includes(route)) await page.screenshot({ path: testInfo.outputPath(`${route}-1440.png`), fullPage: true });
    await page.getByRole('main').focus();
    await page.setViewportSize({ width: 320, height: 740 });
    if (['ev', 'satinalma', 'arac'].includes(route)) await page.screenshot({ path: testInfo.outputPath(`${route}-320.png`), fullPage: true });
  }
});

test('home plan uses budget records and connects to preparation without duplicate accounting', async ({ page }) => {
  const { feeds } = await mockFamily(page);
  await page.goto('/aile/#/ev');
  await expect(page.getByRole('heading', { name: 'Ev planı', exact: true })).toBeVisible();
  const table = page.getByRole('table', { name: 'Bütçedeki alım planı' });
  await expect(table).toContainText('Tutar yok');
  await expect(table).toContainText('0 ₺');
  expect(feeds).not.toContain('_Timeline web');
  if (await page.locator('.family-nav-trigger').isVisible()) await page.getByRole('button', { name: 'Sayfalar', exact: true }).click();
  await page.getByRole('navigation', { name: 'Sayfalar' }).getByRole('link', { name: 'Hazırlık listesi' }).click();
  await expect(page).toHaveURL(/#\/satinalma$/);
  await expect(page.getByTestId('item-list')).toBeVisible();
  if (await page.locator('.family-nav-trigger').isVisible()) await page.getByRole('button', { name: 'Sayfalar', exact: true }).click();
  await page.getByRole('navigation', { name: 'Sayfalar', exact: true }).getByRole('link', { name: 'Ödeme takvimi', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(5);
  await page.goBack();
  await expect(page.getByTestId('item-list')).toBeVisible();
  await expect(page.locator('.family-page-navigation')).toHaveCount(1);
});

test('shared navigation and planner forms preserve keyboard access and readable controls', async ({ page }) => {
  await mockFamily(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/satinalma/yeni');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
  expect(await dialog.evaluate(el => getComputedStyle(el).fontFamily)).toContain('Outfit');
  const small = await dialog.locator('*').evaluateAll(elements => elements.filter(el => el.textContent?.trim() && el.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(el).fontSize) < 14).length);
  expect(small).toBe(0);
  await expect(dialog.locator('select'), 'planner selectors use the shared accessible popup').toHaveCount(0);
  const room = dialog.getByRole('combobox', { name: 'Oda', exact: true });
  await room.click();
  await page.getByRole('option', { name: 'Salon', exact: true }).click();
  await expect(room).toHaveValue('Salon');
  await room.click();
  const closeState = await room.evaluate(input => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return new Promise(resolve => requestAnimationFrame(() => {
      const list = document.querySelector('[role="listbox"][aria-labelledby="' + input.id + '-label"]');
      const panel = list?.closest('.mantine-Select-dropdown');
      resolve({ expanded: input.getAttribute('aria-expanded'), hidden: panel?.getAttribute('aria-hidden'), inert: panel?.hasAttribute('inert') });
    }));
  });
  expect(closeState).toEqual({ expanded: 'false', hidden: 'true', inert: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Sayfalar', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Sayfalar', exact: true });
  const budget = nav.getByRole('link', { name: 'Genel bütçe', exact: true });
  await budget.focus();
  // Mantine's modal trap handles every Tab, including links; no native Safari Alt modifier is needed.
  await page.keyboard.press('Tab');
  const timeline = nav.getByRole('link', { name: 'Ödeme takvimi', exact: true });
  await expect(timeline).toBeFocused();
  await expect.poll(() => timeline.evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, decoration: getComputedStyle(el).textDecorationLine }))).toEqual({ outline: 'none', decoration: 'underline' });
  await timeline.press('Enter');
  await expect(page.getByRole('article')).toHaveCount(5);
  const violations = (await new AxeBuilder({ page }).include('.aile-app').analyze()).violations;
  expect(violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target).join(',')}`)).toEqual([]);
});

test('planner chip and switch focus use one visible underline without a surrounding ring', async ({ page }) => {
  await mockFamily(page);
  await page.goto('/aile/#/satinalma');
  const chip = page.getByTestId('quick-chip-fiyatsiz').getByRole('checkbox');
  await page.keyboard.press('Tab');
  await chip.focus();
  const chipFocus = await chip.evaluate(input => {
    const label = input.nextElementSibling!;
    return { outline: getComputedStyle(label).outlineStyle, underline: getComputedStyle(label).textDecorationLine };
  });
  expect(chipFocus).toEqual({ outline: 'none', underline: 'underline' });
  await page.getByTestId('fab').click();
  const toggle = page.getByRole('dialog').getByRole('switch', { name: 'Karar bekliyor' });
  await page.keyboard.press('Tab');
  await toggle.focus();
  const switchFocus = await toggle.evaluate(input => {
    const root = input.closest('.mantine-Switch-root')!;
    return { outline: getComputedStyle(root.querySelector('.mantine-Switch-track')!).outlineStyle, underline: getComputedStyle(root.querySelector('.mantine-Switch-label')!).textDecorationLine };
  });
  expect(switchFocus).toEqual({ outline: 'none', underline: 'underline' });
});
