import { syntheticBridgeResponse } from '../src/dashboard/bridgeFixtures';
import { writeFile } from 'node:fs/promises';
import { test, expect, type Page, type Response } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { syntheticSheets, gviz } from '../src/dashboard/fixtures';
import { syntheticTimeline, timelineResponse } from './timelineFinanceFixture';
import { mockApi } from './helpers';
import { feedName } from './webFeed';

async function mockFamily(page: Page) {
  await mockApi(page);
  const raw = syntheticSheets();
  const timeline = syntheticTimeline();
  const map = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', 'Düzensiz giderler': 'irregular' } as const;
  const feeds: string[] = [];
  await page.route('**/gviz/tq?*', route => {
    const sheet = feedName(new URL(route.request().url()))!;
    feeds.push(sheet);
    if (sheet === '_Finans web') return route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), timeline) });
    const bridge = syntheticBridgeResponse(route.request().url());
    if (bridge) return route.fulfill({ contentType: 'application/json', body: bridge });
    const key = map[sheet as keyof typeof map];
    if (!key) return route.fulfill({ status: 404, body: 'Unknown sheet' });
    const rows = key === 'plan' || key === 'actual' ? raw[key].map(row => row.slice(0, 4)) : raw[key];
    return route.fulfill({ contentType: 'application/json', body: gviz(rows, key === 'plan' || key === 'actual' ? ['Kalem', ...raw.summary.map(row => String(row[0]))] : undefined) });
  });
  return { feeds };
}

// Each route has independent identity checks; the linked SPA journey is tested below.
for (const route of ['pano', 'timeline', 'finansman', 'ev', 'satinalma', 'aydinlatma', 'tadilat', 'yerlesim', 'butce', 'ayarlar', 'arac']) {
  test(`family area ${route} shares one identity and a complete primary navigation`, async ({ page }, testInfo) => {
    await mockFamily(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 320, height: 740 });
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
  });
}

test('home plan uses budget records and connects to preparation without duplicate accounting', async ({ page }) => {
  const { feeds } = await mockFamily(page);
  await page.goto('/aile/#/ev');
  await expect(page.getByRole('heading', { name: 'Alım planı', exact: true })).toBeVisible();
  await expect(page.locator('header.page-header').getByRole('button', { name: 'Yenile', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Güncellendi' })).toHaveCount(1);
  const table = page.getByRole('table', { name: 'Bütçedeki alım planı' });
  await expect(table).toContainText('Tutar yok');
  await expect(table).toContainText('0 ₺');
  expect(feeds).not.toContain('_Finans web');
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

test('preparation list shows complete item names at 320 without clipping', async ({ page }, testInfo) => {
  await mockFamily(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/satinalma');
  const card = page.getByTestId('item-card').filter({ hasText: 'Perde ve tül' });
  await expect(card).toBeVisible();
  const title = card.getByText('Perde ve tül (salon + 3 oda) çok uzun bir açıklama metni ile taşma testi');
  await expect(title).toBeVisible();
  const state = await title.evaluate(el => { const style = getComputedStyle(el); return { clamp: style.webkitLineClamp, cut: el.scrollHeight > el.clientHeight + 1 }; });
  expect(state.clamp, 'item names are never line-clamped').toBe('none');
  expect(state.cut, 'the full name is laid out').toBe(false);
  await expect(card.getByText('₺28.500')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await card.screenshot({ path: testInfo.outputPath('item-card-320.png') });
  // Planner heading at the 48em boundary: narrow keeps the task first (caption hidden, one-step smaller h1); wide shows the caption.
  for (const [width, captionShown] of [[767, false], [768, true], [769, true]] as const) {
    await page.setViewportSize({ width, height: 900 });
    const header = await page.evaluate(() => ({ caption: getComputedStyle(document.querySelector('.page-header-caption')!).display, h1: parseFloat(getComputedStyle(document.querySelector('.page-header h1')!).fontSize) }));
    expect(header.caption !== 'none', `caption at ${width}`).toBe(captionShown);
    expect(header.h1, `h1 size at ${width}`).toBe(captionShown ? 32 : 24);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hazırlık listesi');
  }
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

async function focusPriceFilter(page: Page) {
  await expect(page.getByTestId('filter-toolbar')).toBeVisible();
  const trigger = page.getByTestId('filter-button');
  if (await trigger.isVisible()) {
    await trigger.focus();
    await trigger.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Filtrele', exact: true })).toBeVisible();
  }
  const chip = page.getByTestId('sheet-chip-fiyatsiz').getByRole('checkbox');
  await chip.focus();
  await expect(chip).toBeFocused();
  return chip;
}

test('planner chip and switch focus use one visible underline without a surrounding ring', async ({ page }) => {
  await mockFamily(page);
  await page.goto('/aile/#/satinalma');
  await page.keyboard.press('Tab');
  const chip = await focusPriceFilter(page);
  await expect.poll(() => chip.evaluate(input => {
    const label = input.nextElementSibling!;
    return { focused: document.activeElement === input, keyboard: document.documentElement.dataset.keyboard, focusVisible: input.matches(':focus-visible'), outline: getComputedStyle(label).outlineStyle, underline: getComputedStyle(label).textDecorationLine };
  })).toEqual({ focused: true, keyboard: 'true', focusVisible: true, outline: 'none', underline: 'underline' });
  const drawer = page.getByRole('dialog', { name: 'Filtrele', exact: true });
  if (await drawer.isVisible()) {
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  }
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

test('keyboard intent begins in initial HTML and survives the asynchronous React mount', async ({ page }) => {
  await mockFamily(page);
  let releaseMount!: () => void;
  const mounted = new Promise<void>(resolve => { releaseMount = resolve; });
  await page.route(/\/src\/app\/mount\.tsx(?:\?|$)/, async route => { await mounted; await route.continue(); });
  try {
    await page.goto('/aile/#/satinalma', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-startup')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('html')).not.toHaveAttribute('data-keyboard', 'true');
    await page.keyboard.press('Tab');
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
    releaseMount();
    const chip = await focusPriceFilter(page);
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
    expect(await chip.evaluate(input => getComputedStyle(input.nextElementSibling!).textDecorationLine)).toBe('underline');
    await page.mouse.click(0, 0);
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'false');
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'false');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
    await page.evaluate(() => document.dispatchEvent(new Event('touchstart', { bubbles: true })));
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'false');
  } finally { releaseMount(); }
});

test('planner loads only used icon modules instead of the complete icon catalogue', async ({ page }, testInfo) => {
  await mockFamily(page);
  const responses: Response[] = [];
  page.on('response', response => {
    if (response.request().resourceType() === 'script') responses.push(response);
  });
  await page.goto('/aile/#/satinalma/yeni');
  await expect(page.getByRole('dialog')).toBeVisible();
  // Collect during loading, then read bodies after the editor is ready so evidence
  // collection does not compete with the dialog's first-render assertion.
  const modules = await Promise.all(responses.map(async response => {
    const body = await response.body();
    return { path: new URL(response.url()).pathname, decodedBytes: body.length, icons: body.toString('utf8').match(/duotone/g)?.length ?? 0 };
  }));
  // Each Phosphor icon carries one duotone path table; the full catalogue holds about 1,500 of them.
  const icons = modules.reduce((sum, module) => sum + module.icons, 0);
  expect(icons, 'the editor must not download the multi-megabyte barrel of every icon').toBeLessThan(200);
  expect(icons, 'the existing visible icons are still loaded').toBeGreaterThan(0);
  const evidence = testInfo.outputPath('icon-network.json');
  await writeFile(evidence, JSON.stringify({ icons, modules: modules.filter(module => module.icons > 0), decodedBytes: modules.reduce((sum, module) => sum + module.decodedBytes, 0) }, null, 2));
  await testInfo.attach('requested-icon-modules', { path: evidence, contentType: 'application/json' });
});

test('a keyboard user moving through the record form never has the focused field hidden behind the sticky footer', async ({ page, browserName }) => {
  await mockFamily(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/satinalma/yeni');
  const dialog = page.getByRole('dialog', { name: 'Yeni kalem' });
  await expect(dialog).toBeVisible();
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const covered: string[] = [];
  for (let step = 0; step < 16; step++) {
    await page.keyboard.press(tab);
    const state = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      const footer = document.querySelector<HTMLElement>('[data-testid="form-errors"]')?.parentElement;
      if (!active || !footer || footer.contains(active) || !active.closest('form')) return null;
      const a = active.getBoundingClientRect(), f = footer.getBoundingClientRect();
      return { name: active.getAttribute('aria-label') ?? active.id ?? active.tagName, hidden: a.bottom > f.top + 1 && a.top < f.bottom - 1 };
    });
    if (state?.hidden) covered.push(state.name);
  }
  expect(covered, 'focused fields overlapped by the sticky footer (WCAG 2.4.11)').toEqual([]);
});

// Post-implementation browser coverage for round 3 (the behaviour's RED was executed at unit level first).
test('record cards read identity, status, attention and amount in order with real targets, and the first error list reaches its field', async ({ page, browserName }, testInfo) => {
  await mockFamily(page);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/aile/#/satinalma');
    const card = page.getByTestId('item-card').filter({ hasText: 'Bebek güvenlik bariyeri' });
    await expect(card).toBeVisible();
    const layout = await card.evaluate(el => {
      const box = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
      const title = box('h3'), status = box('[aria-label="Durum ve kapsam"]'), facts = el.querySelector('[aria-label$="alım bilgileri"]')!.getBoundingClientRect();
      const small = [...el.querySelectorAll('*')].filter(n => n.textContent?.trim() && n.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(n).fontSize) < 14).length;
      return { ordered: title.bottom <= status.top + 1 && status.bottom <= facts.top + 1, small };
    });
    expect(layout).toEqual({ ordered: true, small: 0 });
    for (const target of [card.getByRole('link', { name: 'Fiyat ekle' }), card.locator('label').filter({ hasText: 'Alındı' })]) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await card.screenshot({ path: testInfo.outputPath(`record-card-${browserName}-${width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByTestId('item-card').filter({ hasText: 'Bebek güvenlik bariyeri' }).getByRole('link', { name: 'Fiyat ekle' }).click();
  const dialog = page.getByRole('dialog', { name: 'Bebek güvenlik bariyeri' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^Ad\s*\*?$/).fill('');
  await dialog.getByRole('button', { name: 'Kaydet' }).click();
  await expect(dialog.getByRole('status')).toHaveText('1 alan düzeltilmeli');
  const fix = dialog.getByRole('group', { name: 'Düzeltilecek alanlar' }).getByRole('button', { name: 'Ad' });
  expect((await fix.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await dialog.getByLabel('Not').focus();
  await fix.click();
  await expect(dialog.getByLabel(/^Ad\s*\*?$/)).toBeFocused();
  await expect(dialog.getByRole('group', { name: 'Faz' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`record-form-error-${browserName}-320.png`) });
});

// Round 3 closing: record detail entry and return journeys (RED executed before the product fix).
const returnItem = { id: 'focus-record', tip: 'satinalma', ad: 'Uzun isimli salon koltuğu', durum: 'karar', faz: '1', oda: 'salon', gercek_tl: 24000, fiyat_guven: 'dogrulandi' };
const keyboard = (browserName: string) => browserName === 'webkit' ? 'Alt+Tab' : 'Tab';

test('a cold record deep link fills the form with the record that arrives later', async ({ page }) => {
  await mockApi(page, { items: [returnItem], settings: [], cash: [] });
  await page.route('**/macros/s/**', async route => { await new Promise(resolve => setTimeout(resolve, 250)); await route.fallback(); });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/satinalma/focus-record');
  const form = page.getByTestId('item-detail');
  await expect(form).toBeVisible();
  await expect(form.getByLabel(/^Ad\s*\*?$/)).toHaveValue(returnItem.ad);
  await expect(form.getByLabel('Gerçek', { exact: true })).toHaveValue(/24[.]000/);
});

for (const close of ['Escape', 'Vazgeç', 'Kaydet'] as const) {
  test(`closing a record with ${close} returns keyboard focus to the record that opened it`, async ({ page, browserName }) => {
    await mockApi(page, { items: [returnItem], settings: [], cash: [] });
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/aile/#/satinalma');
    const origin = page.getByRole('link', { name: `${returnItem.ad} detayı`, exact: true });
    await expect(origin).toBeVisible();
    await page.keyboard.press(keyboard(browserName));
    await origin.focus();
    await page.keyboard.press('Enter');
    const form = page.getByTestId('item-detail');
    await expect(form).toBeVisible();
    if (close === 'Escape') await page.keyboard.press('Escape');
    else {
      if (close === 'Kaydet') await form.getByLabel('Not').fill('Yeni not');
      await form.getByRole('button', { name: close, exact: true }).focus();
      await page.keyboard.press('Enter');
    }
    await expect(form).toHaveCount(0);
    await expect(origin).toBeFocused();
    await expect(origin).toBeInViewport();
    // One visible, non-enclosing keyboard indicator on the returned focus.
    expect(await origin.evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, line: getComputedStyle(el).textDecorationLine }))).toEqual({ outline: 'none', line: 'underline' });
  });
}

// Round 5 (RED first): the delete confirmation's own focus trap must not take the returned focus away while it closes.
test('deleting a record from its dialog leaves keyboard focus on the page heading, not on the page body', async ({ page }) => {
  await mockApi(page, { items: [returnItem], settings: [], cash: [] });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/satinalma');
  await page.getByRole('link', { name: `${returnItem.ad} detayı`, exact: true }).click();
  const form = page.getByTestId('item-detail');
  await form.getByRole('button', { name: 'Sil', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: 'Kalemi sil?' }).getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('link', { name: `${returnItem.ad} detayı`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});

test('closing a record opened from a deep link lands focus on that record in the list', async ({ page, browserName }) => {
  await mockApi(page, { items: [returnItem], settings: [], cash: [] });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/satinalma/focus-record');
  await expect(page.getByTestId('item-detail')).toBeVisible();
  await page.keyboard.press(keyboard(browserName));
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('item-detail')).toHaveCount(0);
  await expect(page.getByRole('link', { name: `${returnItem.ad} detayı`, exact: true })).toBeFocused();
});

test('the named price action opens the record at its price section and returns to that action', async ({ page, browserName }, testInfo) => {
  await mockApi(page, { items: [{ ...returnItem, gercek_tl: undefined, fiyat_guven: undefined }], settings: [], cash: [] });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
    await page.goto('/aile/#/satinalma');
    const action = page.getByRole('link', { name: 'Fiyat ekle', exact: true });
    await expect(action).toBeVisible();
    await page.keyboard.press(keyboard(browserName));
    await action.focus();
    await page.keyboard.press('Enter');
    const pricing = page.getByTestId('item-detail').getByRole('region', { name: 'Fiyat ve teyit' });
    await expect(pricing).toBeVisible();
    await expect.poll(() => pricing.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expect(pricing).toBeInViewport();
    // The section starts in view: its first price field is visible above the sticky footer, not just the heading.
    await expect.poll(() => page.evaluate(() => {
      const field = [...document.querySelectorAll<HTMLElement>('[data-testid="item-detail"] [data-path="tahmini_tl_min"]')][0];
      const footer = document.querySelector<HTMLElement>('[data-testid="form-errors"]')!.parentElement!;
      const box = field.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= footer.getBoundingClientRect().top;
    })).toBe(true);
    // No price is invented: estimate and actual fields stay empty, and the empty-vs-zero rule is stated.
    await expect(pricing.getByLabel('Gerçek', { exact: true })).toHaveValue('');
    await expect(pricing).toContainText('Boş bırakılan fiyat bilinmiyor demektir');
    await page.screenshot({ path: testInfo.outputPath(`price-action-${browserName}-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('item-detail')).toHaveCount(0);
    await expect(action).toBeFocused();
  }
});

test('with reduced motion, closing a record still returns keyboard focus to the action that opened it at every width', async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page, { items: [{ ...returnItem, gercek_tl: undefined, fiyat_guven: undefined }], settings: [], cash: [] });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
    await page.goto('/aile/#/satinalma');
    const action = page.getByRole('link', { name: 'Fiyat ekle', exact: true });
    await expect(action).toBeVisible();
    await page.keyboard.press(keyboard(browserName));
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('item-detail')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('item-detail')).toHaveCount(0);
    await expect(action, `focus returns at ${width}`).toBeFocused();
  }
});

test('keyboard focus is already on the opener in the same moment the record dialog leaves the page', async ({ page, browserName }) => {
  await mockApi(page, { items: [returnItem], settings: [], cash: [] });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/satinalma');
  const origin = page.getByRole('link', { name: `${returnItem.ad} detayı`, exact: true });
  await expect(origin).toBeVisible();
  await page.keyboard.press(keyboard(browserName));
  await origin.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('item-detail')).toBeVisible();
  // Record the focused element synchronously when the dialog is removed, independent of animation frames.
  await page.evaluate(() => {
    const w = window as unknown as { focusAtRemoval?: string };
    new MutationObserver((_, observer) => {
      if (document.querySelector('[data-testid="item-detail"]')) return;
      w.focusAtRemoval = document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? 'none';
      observer.disconnect();
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('item-detail')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { focusAtRemoval?: string }).focusAtRemoval)).toBe(`${returnItem.ad} detayı`);
});

test('the sticky record form footer stays above field decorations that scroll beneath it', async ({ page }) => {
  await mockApi(page, { items: [{ ...returnItem, gercek_tl: undefined, fiyat_guven: undefined }], settings: [], cash: [] });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/satinalma/focus-record/fiyat');
  await expect(page.getByTestId('item-detail')).toBeVisible();
  // Every sampled point inside the footer hits the footer itself, not a select chevron or input section scrolled under it.
  // Input sections are pointer-events:none in Mantine; make them hit-testable here so the hit test follows paint order.
  await page.addStyleTag({ content: '.mantine-Input-section, .mantine-Input-section * { pointer-events: auto !important; }' });
  const leaks = async () => page.evaluate(() => {
    const footer = document.querySelector<HTMLElement>('[data-testid="form-errors"]')!.parentElement!;
    const box = footer.getBoundingClientRect();
    const out: string[] = [];
    for (let fx = 0.04; fx < 0.97; fx += 0.08) for (let fy = 0.05; fy < 1; fy += 0.1) {
      const hit = document.elementFromPoint(box.left + box.width * fx, box.top + box.height * fy);
      if (hit && !footer.contains(hit)) out.push(`${hit.tagName}.${String(hit.className).split(' ')[0]}@${fx.toFixed(2)},${fy.toFixed(2)}`);
    }
    return out;
  });
  const scroller = await page.evaluate(() => {
    let el = document.querySelector<HTMLElement>('[data-testid="form-errors"]')!.parentElement!.parentElement;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    return !!el;
  });
  expect(scroller).toBe(true);
  const max = await page.evaluate(() => { let el = document.querySelector<HTMLElement>('[data-testid="form-errors"]')!.parentElement!.parentElement; while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement; return el!.scrollHeight - el!.clientHeight; });
  for (let step = 0; step <= max; step += 60) {
    await page.evaluate(top => { let el = document.querySelector<HTMLElement>('[data-testid="form-errors"]')!.parentElement!.parentElement; while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement; el!.scrollTop = top; }, step);
    expect(await leaks(), `footer covered at scrollTop ${step}`).toEqual([]);
  }
});

// Post-implementation browser coverage for field ownership (behaviour RED executed first in purchase.test.tsx).
async function ownershipApi(page: Page, record: Record<string, unknown>) {
  await mockApi(page, { items: [record], settings: [], cash: [] });
  const sent: Array<Record<string, unknown>> = [];
  let server: Record<string, unknown> | null = null;
  await page.route('**/macros/s/**', async route => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { action?: string; ops?: Array<{ patch?: Record<string, unknown> }> };
    if (body.action === 'batch') { for (const op of body.ops ?? []) sent.push(op.patch ?? {}); return route.fallback(); }
    if (server && body.action !== 'health') return route.fulfill({ json: { ok: true, fingerprint: `fx-server-${server.version}`, serverTime: new Date().toISOString(), schemaVersion: 2, items: [server], settings: [], cash: [] } });
    return route.fallback();
  });
  return { sent, serverChanges: async (next: Record<string, unknown>) => { server = next; await page.evaluate(() => window.dispatchEvent(new Event('online'))); } };
}

test('saving a note after a background update writes only the note, never reverting the newer status', async ({ page }) => {
  const record = { id: 'own-1', tip: 'satinalma', ad: 'Salon koltuğu', faz: '1', durum: 'karar', version: 1 };
  const api = await ownershipApi(page, record);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/satinalma/own-1');
  const form = page.getByTestId('item-detail');
  await expect(form.getByLabel(/^Ad\s*\*?$/)).toHaveValue('Salon koltuğu');
  await form.getByLabel('Not').fill('Benim notum');
  await api.serverChanges({ ...record, durum: 'siparis', version: 2 });
  await expect(page.getByRole('link', { name: 'Salon koltuğu detayı' }).locator('xpath=ancestor::*[@data-testid="item-card"]')).toContainText('Sipariş');
  await form.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect.poll(() => api.sent.length).toBeGreaterThan(0);
  expect(api.sent.at(-1)).toEqual({ tip: 'satinalma', not: 'Benim notum' });
});

test('a note edited here and on the server is not overwritten: the conflict is named, reachable by keyboard and resolvable', async ({ page, browserName }, testInfo) => {
  const record = { id: 'own-2', tip: 'satinalma', ad: 'Salon koltuğu', faz: '1', durum: 'karar', not: 'İlk not', version: 1 };
  const api = await ownershipApi(page, record);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/satinalma/own-2');
  const form = page.getByTestId('item-detail');
  await expect(form.getByLabel('Not')).toHaveValue('İlk not');
  await form.getByLabel('Not').fill('Benim notum');
  await api.serverChanges({ ...record, not: 'Sunucudaki yeni not', version: 2 });
  await expect(page.getByTestId('item-card').filter({ hasText: 'Salon koltuğu' })).toBeVisible();
  await form.getByRole('button', { name: 'Kaydet', exact: true }).focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await page.keyboard.press('Enter');
  const conflict = form.getByRole('alert');
  await expect(conflict).toContainText('Not');
  await expect(conflict).toContainText('Benim notum');
  await expect(conflict).toContainText('Sunucudaki yeni not');
  await expect(conflict.getByRole('heading', { level: 4 })).toBeFocused();
  await expect(form.getByLabel('Not')).toHaveValue('Benim notum');
  expect(api.sent).toEqual([]);
  for (const name of ['Benim değerim kalsın', "Sheets'teki kalsın"]) expect((await conflict.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await conflict.evaluate(el => [...el.querySelectorAll('*')].filter(n => n.textContent?.trim() && n.children.length === 0 && parseFloat(getComputedStyle(n).fontSize) < 14).length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`ownership-conflict-${browserName}-320.png`) });
  await conflict.getByRole('button', { name: 'Benim değerim kalsın' }).click();
  await form.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect.poll(() => api.sent.length).toBeGreaterThan(0);
  expect(api.sent.at(-1)).toEqual({ tip: 'satinalma', not: 'Benim notum' });
});
