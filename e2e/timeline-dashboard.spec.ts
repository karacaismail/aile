import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { syntheticLongTimeline, syntheticTimeline, timelineResponse } from './timelineFinanceFixture';
async function mockTimeline(page: Page, largeAmounts = false) {
  const table = syntheticTimeline();
  if (largeAmounts) table.rows.forEach(row => {
    for (const column of [6, 9]) row[column] = Math.round(Number(row[column]) * 1234.56 * 100) / 100;
    for (const column of [7, 10, 12]) row[column] = Math.round(Number(row[column]) * 2181.07 * 100) / 100;
  });
  table.rows[2][4] = 'Salon için ölçüye uygun uzun modüler koltuk takımı siparişi';
  table.rows[2][14] = 'Teslimat tarihi satıcı ile teyit edilecek; satın alma ve teslimat ayrı adımlardır.';
  table.rows[3][14] = 'Kesim + 10 gün. Maaştan önceyse önceki aydan nakit gerekir; aynı günse maaşın yatması beklenir. Özel ödeme notu korunur.';
  let broken = false;
  const feeds: string[] = [], requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.route('**/gviz/tq?*', route => {
    const sheet = new URL(route.request().url()).searchParams.get('sheet') ?? '';
    feeds.push(sheet);
    if (sheet !== 'Finansman') return route.fulfill({ status: 503, body: 'Unexpected feed' });
    const rows = table.rows.map(row => [...row]);
    if (broken) rows[4][0] = rows[0][0];
    return route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), { rows, labels: table.labels }) });
  });
  return { feeds, requests, breakLedger: () => { broken = true; }, restore: () => { broken = false; } };
}

test('initial loading presents an immediate accessible skeleton without invented balances', async ({ page, browserName }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const table = syntheticTimeline();
  await page.route('**/gviz/tq?*', async route => {
    await pending;
    await route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), table) });
  });
  try {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/aile/#/timeline');
    await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/timeline-loading-${browserName}-320.png`, fullPage: true });
    const skeleton = page.getByRole('region', { name: 'Ödeme takvimi yükleniyor' });
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText(/₺/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Yenile', exact: true })).toBeDisabled();
    for (const width of [320, 360, 375, 390, 667, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await skeleton.locator('*').evaluateAll(elements => elements.filter(el => el.textContent?.trim() && el.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(el).fontSize) < 14).length)).toBe(0);
    }
    const activity = skeleton.locator('.timeline-loading-activity');
    const motion = await activity.evaluate(el => { const style = getComputedStyle(el, '::after'); return { duration: style.animationDuration, easing: style.animationTimingFunction, direction: style.animationDirection }; });
    expect(parseFloat(motion.duration)).toBeGreaterThan(0);
    expect(motion.easing).toBe('cubic-bezier(0.65, 0, 0.35, 1)');
    expect(motion.direction).toBe('alternate');
    expect(await skeleton.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(1);
    await page.screenshot({ path: `test-results/timeline-loading-${browserName}-1440.png`, fullPage: true });
    expect((await new AxeBuilder({ page }).include('.timeline-page').analyze()).violations.map(violation => violation.id)).toEqual([]);
    const overviewBefore = await skeleton.locator('.timeline-overview').boundingBox();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await activity.evaluate(el => getComputedStyle(el, '::after').animationDuration)).toBe('0s');
    release();
    await expect(skeleton).toHaveCount(0);
    await expect(page.getByRole('article')).toHaveCount(5);
    await expect(page.getByRole('article', { name: /3\. adım/ })).toContainText('500 ₺');
    const overviewAfter = await page.getByRole('complementary', { name: 'Dönem kontrolü' }).boundingBox();
    expect(Math.abs(overviewAfter!.x - overviewBefore!.x)).toBeLessThan(1);
    expect(Math.abs(overviewAfter!.width - overviewBefore!.width)).toBeLessThan(1);
  } finally { release(); }
});

test('retry replaces an initial error with loading state and keeps verified content during refresh', async ({ page }) => {
  const table = syntheticTimeline();
  let fail = true;
  let pending: Promise<void> | null = null;
  let release = () => {};
  await page.route('**/gviz/tq?*', async route => {
    if (pending) await pending;
    await route.fulfill(fail ? { status: 503, body: 'Unavailable' } : { contentType: 'application/json', body: timelineResponse(route.request().url(), table) });
  });
  await page.goto('/aile/#/timeline');
  await expect(page.getByRole('alert')).toBeVisible();
  fail = false;
  pending = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.getByRole('button', { name: 'Yenile', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Ödeme takvimi yükleniyor' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    release();
    await expect(page.getByRole('article')).toHaveCount(5);
    pending = new Promise<void>(resolve => { release = resolve; });
    await page.getByRole('button', { name: 'Yenile', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Ödeme takvimi yükleniyor' })).toHaveCount(0);
    await expect(page.getByRole('article')).toHaveCount(5);
    await expect(page.getByRole('article', { name: /3\. adım/ })).toContainText('500 ₺');
  } finally { release(); }
});

test('timeline deep link shows each cash/debt step independently of old budget feeds', async ({ page }) => {
  const mock = await mockTimeline(page);
  await page.goto('/aile/#/timeline');
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
  const purchase = page.getByRole('article', { name: /3\. adım/ });
  await expect(purchase).toContainText('1.000 ₺');
  await expect(purchase).toContainText('500 ₺');
  await expect(page.locator('.family-page-navigation a[href="#/timeline"]')).toHaveAttribute('aria-current', 'page');
  expect(mock.feeds.every(feed => feed === 'Finansman')).toBe(true);
  expect(mock.requests.some(url => /(?:VehiclePage|LegacyApp|\/Charts\.tsx)/.test(url))).toBe(false);
  await page.getByRole('button', { name: 'Yenile', exact: true }).click();
  await expect.poll(() => mock.requests.some(url => new URL(url).searchParams.get('range') === 'A43:R6000')).toBe(true);
  await expect(page.getByRole('article', { name: /1\. adım/ })).toContainText('Adım opening');
  await expect(page.getByRole('alert')).toHaveCount(0);
  mock.breakLedger();
  await page.getByRole('button', { name: 'Yenile', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('işlem kimliği yinelenmiş');
  await expect(page.getByRole('article')).toHaveCount(0);
  mock.restore();
  await page.getByRole('button', { name: 'Yenile', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sonraki ay' }).click();
  await expect(page.getByRole('article', { name: /6\. adım/ })).toContainText('-100 ₺');
  await expect(page.getByRole('alert')).toContainText('Bu tutar kullanılabilir para değildir');
  await expect(page.getByRole('complementary', { name: 'Hesap kapsamı' })).toContainText('Tarih ve maliyet koşulları');
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
    expect(mock.feeds.every(feed => feed === 'Finansman')).toBe(true);
  }
});

test('journey filters preserve period totals and original balances while preserving source dates and conditions', async ({ page }) => {
  await mockTimeline(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/timeline');
  const summary = page.getByRole('region', { name: 'Kasım 2098 özeti' });
  const totals = await summary.innerText();
  const payments = page.getByRole('button', { name: 'Ödemeler', exact: true });
  await payments.click();
  await expect(payments).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('article')).toHaveCount(1);
  const payment = page.getByRole('article', { name: /4\. adım/ });
  await expect(payment).toContainText('800 ₺');
  await expect(summary).toHaveText(totals, { useInnerText: true });
  await expect(payment.locator('.timeline-source')).toBeVisible();
  await expect(payment).toContainText('Kesim + 10 gün.');
  await expect(payment).toContainText('Özel ödeme notu korunur.');
  await page.getByRole('button', { name: 'Sonraki ay' }).click();
  await expect(payments).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('Bu tutar kullanılabilir para değildir');
  await page.getByRole('button', { name: 'Alışveriş', exact: true }).click();
  await expect(page.getByText('Bu dönemde alışveriş adımı yok.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tüm adımlar', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
});

test('journey filters share the view switch surface and remain usable at narrow widths', async ({ page, browserName }, testInfo) => {
  await mockTimeline(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/timeline');
  const filters = page.getByRole('group', { name: 'Adımları filtrele' });
  const views = page.getByRole('tablist', { name: 'Takvim görünümü' });
  const surface = (element: Element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, radius: style.borderRadius, padding: style.padding, gap: style.gap };
  };
  await expect(filters).toBeVisible();
  expect(await filters.evaluate(surface)).toEqual(await views.evaluate(surface));
  const selected = filters.getByRole('button', { name: 'Tüm adımlar', exact: true });
  const selectedStyle = (element: Element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, radius: style.borderRadius, height: style.minHeight, weight: style.fontWeight };
  };
  expect(await selected.evaluate(selectedStyle)).toEqual(await views.getByRole('tab', { name: 'Zaman akışı' }).evaluate(selectedStyle));
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const button of await filters.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(await button.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
    }
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await selected.focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  const payments = filters.getByRole('button', { name: 'Ödemeler', exact: true });
  await expect(payments).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(payments).toHaveAttribute('aria-pressed', 'true');
  expect(await payments.evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, decoration: getComputedStyle(el).textDecorationLine }))).toEqual({ outline: 'none', decoration: 'underline' });
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('filter-wrapper-320.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('filter-wrapper-1440.png'), fullPage: true });
});

test('timeline and table views share exact balances, notes and period/filter state', async ({ page }) => {
  await mockTimeline(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/timeline');
  const views = page.getByRole('tablist', { name: 'Takvim görünümü' });
  const timeline = views.getByRole('tab', { name: 'Zaman akışı', exact: true });
  const tableTab = views.getByRole('tab', { name: 'Tablo', exact: true });
  await expect(timeline).toHaveAttribute('aria-selected', 'true');
  await expect(views.getByRole('tab')).toHaveCount(2);
  const summary = page.getByRole('region', { name: 'Kasım 2098 özeti' });
  const totals = await summary.innerText();
  await page.getByRole('button', { name: 'Ödemeler', exact: true }).click();
  await tableTab.click();
  await expect(tableTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('article')).toHaveCount(0);
  const table = page.getByRole('table', { name: 'Kronolojik ödeme tablosu' });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  const payment = table.getByRole('row', { name: /Adım payment/ });
  await expect(payment.locator('[data-balance="cash"]')).toHaveText('800 ₺');
  await expect(payment.locator('[data-balance="denizPrincipal"]')).toHaveText('300 ₺');
  await expect(payment.locator('[data-balance="isPrincipal"]')).toHaveText('0 ₺');
  await expect(payment.locator('[data-balance="cardDebt"]')).toHaveText('300 ₺');
  await expect(payment).toContainText('27 Kasım 2098');
  await expect(payment).toContainText('Net nakit etkisi -200 ₺');
  await expect(payment).toContainText('Özel ödeme notu korunur.');
  await expect(payment).toContainText('Örnek kaynak');
  await expect(summary).toHaveText(totals, { useInnerText: true });
  await page.getByRole('button', { name: 'Sonraki ay' }).click();
  await expect(tableTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Ödemeler', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('[data-balance="cash"]')).toHaveText('0 ₺');
  await expect(table.locator('[data-balance="requiredBalance"]')).toHaveText('-100 ₺');
  await expect(page.getByRole('alert')).toContainText('Bu tutar kullanılabilir para değildir');
  await timeline.click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', { name: /6\. adım/ })).toContainText('-100 ₺');
  await expect(page.getByRole('combobox', { name: 'Gösterilen dönem' })).toHaveValue('Aralık 2098');
});

test('view tabs support keyboard activation and a readable contained table at narrow widths', async ({ page, browserName }) => {
  await mockTimeline(page, true);
  await page.goto('/aile/#/timeline');
  const views = page.getByRole('tablist', { name: 'Takvim görünümü' });
  const timeline = views.getByRole('tab', { name: 'Zaman akışı', exact: true });
  const tableTab = views.getByRole('tab', { name: 'Tablo', exact: true });
  await page.getByRole('button', { name: 'Sonraki ay' }).focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(timeline).toBeFocused();
  await timeline.press('ArrowRight');
  await expect(tableTab).toBeFocused();
  await tableTab.press('Enter');
  await expect(tableTab).toHaveAttribute('aria-selected', 'true');
  const focus = await tableTab.evaluate(el => ({ mode: document.documentElement.dataset.keyboard, outline: getComputedStyle(el).outlineStyle, decoration: getComputedStyle(el).textDecorationLine }));
  expect(focus).toEqual({ mode: 'true', outline: 'none', decoration: 'underline' });
  await tableTab.press('Home');
  await expect(timeline).toBeFocused();
  await timeline.press('End');
  await expect(tableTab).toBeFocused();
  await tableTab.press('Space');
  const scroll = page.getByRole('region', { name: 'Ödeme tablosu; yatay kaydırılabilir' });
  for (const width of [320, 360, 375, 390, 740, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 740 ? 360 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `table page overflow at ${width}`).toBe(true);
    expect(await scroll.evaluate(el => el.scrollWidth > el.clientWidth), 'readable columns scroll within their own region').toBe(true);
    expect(await scroll.locator('th, td').evaluateAll(elements => elements.filter(el => parseFloat(getComputedStyle(el).fontSize) < 14).length)).toBe(0);
    await expect(views.getByRole('tab', { name: 'Tablo' })).toHaveAttribute('aria-selected', 'true');
  }
  await scroll.focus();
  await scroll.press('ArrowRight');
  await expect.poll(() => scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  const scrollFocus = await scroll.evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow }));
  expect(scrollFocus.outline).toBe('none');
  expect(scrollFocus.shadow).toContain('inset');
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  const motion = await tableTab.evaluate(el => ({ duration: getComputedStyle(el).transitionDuration, easing: getComputedStyle(el).transitionTimingFunction }));
  expect(motion.duration).toContain('0.24s');
  expect(motion.easing).toContain('cubic-bezier(0.65, 0, 0.35, 1)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await tableTab.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect((await new AxeBuilder({ page }).include('.timeline-page').analyze()).violations.map(violation => violation.id)).toEqual([]);
  await tableTab.click();
  await scroll.evaluate(el => { el.scrollLeft = 0; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/timeline-table-${browserName}-320.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/timeline-table-${browserName}-1440.png`, fullPage: true });
});

test('changing timeline/table view preserves the current chronological page', async ({ page }) => {
  const table = syntheticLongTimeline();
  await page.route('**/gviz/tq?*', route => route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), table) }));
  await page.goto('/aile/#/timeline');
  await page.getByRole('combobox', { name: 'Gösterilen dönem' }).click();
  await page.getByRole('option', { name: 'Tüm dönem' }).click();
  const pages = page.getByRole('navigation', { name: 'Adım sayfaları üst' });
  await pages.getByRole('button', { name: 'Sonraki adımlar' }).click();
  await expect(pages).toContainText('51–100 / 716 adım');
  await page.getByRole('tab', { name: 'Tablo', exact: true }).click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(50);
  await expect(page.getByRole('table').locator('tbody tr').first()).toContainText('Örnek adım 51');
  await expect(pages).toContainText('51–100 / 716 adım');
  await pages.getByRole('button', { name: 'Sonraki adımlar' }).click();
  await page.getByRole('tab', { name: 'Zaman akışı', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(50);
  await expect(page.getByRole('article').first()).toContainText('Örnek adım 101');
  await expect(pages).toContainText('101–150 / 716 adım');
});

test('verified steps commit in frame-sized batches in both views while summaries stay complete', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const paints: { view: string; count: number; busy: string | null }[] = [];
    Object.assign(window, { timelinePaints: paints });
    new MutationObserver(() => {
      const timeline = document.querySelectorAll('.timeline-journey article').length;
      const table = document.querySelectorAll('.timeline-table tbody tr').length;
      const count = timeline || table;
      if (!count) return;
      const view = timeline ? 'timeline' : 'table';
      const busy = document.querySelector('[role="tabpanel"]:not([hidden])')?.getAttribute('aria-busy') ?? null;
      const last = paints.at(-1);
      if (last?.view !== view || last.count !== count || last.busy !== busy) paints.push({ view, count, busy });
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });
  });
  const table = syntheticLongTimeline();
  await page.route('**/gviz/tq?*', route => route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), table) }));
  await page.goto('/aile/#/timeline');
  await expect(page.getByRole('article')).toHaveCount(28);
  const summary = page.getByRole('region', { name: 'Kasım 2098 özeti' });
  const totals = await summary.innerText();
  await page.getByRole('tab', { name: 'Tablo', exact: true }).click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(28);
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-busy', 'false');
  expect(await summary.innerText()).toBe(totals);
  const paints = await page.evaluate(() => (window as unknown as { timelinePaints: { view: string; count: number; busy: string | null }[] }).timelinePaints);
  const evidence = testInfo.outputPath('verified-step-commits.json');
  await writeFile(evidence, JSON.stringify(paints, null, 2));
  await testInfo.attach('verified-step-commits', { path: evidence, contentType: 'application/json' });
  for (const view of ['timeline', 'table']) expect(paints.filter(paint => paint.view === view)).toEqual([
    { view, count: 8, busy: 'true' }, { view, count: 24, busy: 'true' }, { view, count: 28, busy: 'false' },
  ]);
});

test('view tab text retains contrast throughout normal and interrupted selection motion', async ({ page }, testInfo) => {
  await mockTimeline(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/aile/#/timeline');
  const views = page.getByRole('tablist', { name: 'Takvim görünümü' });
  await expect(views).toBeVisible();
  const result = await views.evaluate(async list => {
    const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const rgba = (value: string) => {
      const channels = value.match(/[\d.]+/g)!.map(Number);
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const background = (element: Element): number[] => {
      const color = rgba(getComputedStyle(element).backgroundColor);
      if (color[3] === 1 || !element.parentElement) return color.slice(0, 3);
      const behind = background(element.parentElement);
      return color.slice(0, 3).map((channel, i) => channel * color[3] + behind[i] * (1 - color[3]));
    };
    const luminance = (color: number[]) => color.slice(0, 3).map(channel => {
      const value = channel / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const samples: { phase: string; contrast: number[]; selected: string[] }[] = [];
    const sample = (phase: string) => samples.push({ phase, selected: tabs.map(tab => tab.getAttribute('aria-selected')!), contrast: tabs.map(tab => {
      const a = luminance(rgba(getComputedStyle(tab).color)), b = luminance(background(tab));
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    }) });
    const frames = async (milliseconds: number, phase: string) => {
      const start = performance.now();
      do { await new Promise(requestAnimationFrame); sample(phase); } while (performance.now() - start < milliseconds);
    };
    sample('initial');
    tabs[1].click();
    await frames(120, 'select-table');
    tabs[0].click();
    await frames(280, 'interrupt-return');
    tabs[1].click();
    await frames(280, 'select-table-complete');
    return samples;
  });
  expect(result.find(sample => sample.phase === 'select-table')!.selected).toEqual(['false', 'true']);
  expect(result.find(sample => sample.phase === 'interrupt-return')!.selected).toEqual(['true', 'false']);
  const worst = Math.min(...result.flatMap(sample => sample.contrast));
  const evidencePath = testInfo.outputPath('view-tab-contrast.json');
  await writeFile(evidencePath, JSON.stringify({ minimum: worst, samples: result }, null, 2));
  await testInfo.attach('view-tab-contrast', { path: evidencePath, contentType: 'application/json' });
  expect(worst, `minimum computed text/background contrast across ${result.length} frames`).toBeGreaterThanOrEqual(4.5);
});

test('compact steps show every explanation immediately without a disclosure button', async ({ page }, testInfo) => {
  await mockTimeline(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/timeline');
  await expect(page.getByRole('article')).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: testInfo.outputPath('first-content-320.png'), animations: 'disabled' });
  expect((await page.getByRole('article').first().boundingBox())!.y, 'first step begins in the narrow viewport').toBeLessThan(740);
  const purchase = page.getByRole('article', { name: /3\. adım/ });
  const note = purchase.getByText(/Teslimat tarihi satıcı ile teyit edilecek; satın alma ve teslimat ayrı adımlardır\./);
  await expect(note).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ayrıntı/ })).toHaveCount(0);
  for (const label of ['Harcanabilir nakit', 'Toplam kart borcu', 'KMH anaparası', 'Denizbank anapara', 'İşbank anapara']) await expect(purchase.getByText(label, { exact: true })).toBeVisible();
  await expect(purchase.locator('.timeline-source')).toBeVisible();
  await expect(purchase.locator('.timeline-source')).toContainText('Örnek kaynak');
  for (const size of [{ width: 740, height: 360 }, { width: 1440, height: 900 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(size);
    await expect(note).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const layout = await purchase.evaluate(el => {
      const context = el.querySelector('.timeline-step-context')!.getBoundingClientRect();
      const balances = el.querySelector('.timeline-balances')!.getBoundingClientRect();
      const details = el.querySelector('.timeline-details')!;
      const bounds = details.getBoundingClientRect();
      return { gap: bounds.top - Math.max(context.bottom, balances.bottom), padding: getComputedStyle(details).paddingTop, hidden: !!details.closest('[inert], [aria-hidden="true"]'), aligned: Math.abs(context.top - balances.top) < 1 };
    });
    // DOMRect subtraction can differ by sub-pixel floating-point noise in Firefox.
    expect(Math.round(layout.gap * 64) / 64, 'notes follow the content without a large empty panel').toBeLessThanOrEqual(8);
    expect(layout.gap).toBeGreaterThanOrEqual(0);
    expect(layout.padding).toBe('0px');
    expect(layout.hidden).toBe(false);
    if (size.width === 1440) expect(layout.aligned, 'event and balances share the top row').toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const first = await page.getByRole('article').first().boundingBox();
  await page.screenshot({ path: testInfo.outputPath('first-content-1440.png'), animations: 'disabled' });
  expect(first!.y + first!.height, 'first complete step is above the fold').toBeLessThan(900);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(note).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('same-day steps have separate surfaces without oversized inner spacing', async ({ page }) => {
  const table = syntheticTimeline();
  table.rows[2][1] = table.rows[1][1];
  table.rows[2][2] = 2;
  await page.route('**/gviz/tq?*', route => route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), table) }));
  await page.goto('/aile/#/timeline');
  const day = page.getByRole('region', { name: '10 Kasım 2098' });
  await expect(day.getByRole('article')).toHaveCount(2);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const steps = await day.locator('.timeline-step').evaluateAll(elements => elements.map(el => {
      const box = el.getBoundingClientRect(), body = el.querySelector('article')!.getBoundingClientRect();
      const style = getComputedStyle(el);
      return { top: box.top, bottom: box.bottom, inset: body.left - box.left, surface: style.backgroundColor, pageSurface: getComputedStyle(document.querySelector('.budget-app')!).backgroundColor, radius: parseFloat(style.borderTopLeftRadius) };
    }));
    for (const step of steps) {
      expect(step.surface).not.toBe('rgba(0, 0, 0, 0)');
      expect(step.surface).not.toBe(step.pageSurface);
      expect(step.radius).toBeGreaterThan(0);
      expect(step.inset).toBeGreaterThanOrEqual(8);
      expect(step.inset).toBeLessThanOrEqual(16);
    }
    expect(steps[1].top - steps[0].bottom, 'white space separates consecutive steps on the same day').toBeGreaterThanOrEqual(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(day.getByRole('button', { name: /^Ayrıntı/ })).toHaveCount(0);
  }
});

test('overview and steps have distinct contrasting surfaces with readable summary values', async ({ page }) => {
  await mockTimeline(page);
  await page.goto('/aile/#/timeline');
  const overview = page.getByRole('complementary', { name: 'Dönem kontrolü' });
  await expect(overview.getByRole('heading', { name: 'Dönem sonu' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ödeme akışı' }).getByText('Ödeme akışı', { exact: true })).toBeVisible();
  const surface = await overview.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(surface).not.toBe('rgba(0, 0, 0, 0)');
  expect(surface).not.toBe(await page.locator('.timeline-step').first().evaluate(el => getComputedStyle(el).backgroundColor));
  await page.getByRole('button', { name: 'Sonraki ay' }).click();
  await expect(overview.getByRole('alert')).toContainText('fon eksiği 100 ₺');
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const violations = (await new AxeBuilder({ page }).include('.timeline-overview').analyze()).violations;
    expect(violations.map(violation => violation.id)).toEqual([]);
  }
});

test('six-digit cash and debt stay intact at 320px with 200% text', async ({ page, browserName }) => {
  await mockTimeline(page, true);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/timeline');
  await expect(page.getByRole('article')).toHaveCount(5);
  const picker = page.getByRole('combobox', { name: 'Gösterilen dönem' });
  await picker.click();
  for (const width of [671, 672, 673, 1087, 1088, 1089, 1359, 1360, 1361]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(picker).toBeFocused();
    await expect(picker).toHaveValue('Kasım 2098');
    await expect.poll(() => page.locator('.mantine-Select-dropdown').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `large amount overflow at ${width}`).toBe(true);
    const columns = await page.locator('.timeline-workspace').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    const wideWorkspace = await page.locator('.timeline-page').evaluate(el => el.clientWidth >= 64 * parseFloat(getComputedStyle(el).fontSize));
    expect(columns, `workspace at ${width}`).toBe(wideWorkspace ? 2 : 1);
    const dayColumns = await page.locator('.timeline-day').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    const wideFlow = await page.locator('.timeline-flow').evaluate(el => el.clientWidth >= 40 * parseFloat(getComputedStyle(el).fontSize));
    expect(dayColumns, `date rail at ${width}`).toBe(wideFlow ? 2 : 1);
  }
  await picker.press('Escape');
  await page.setViewportSize({ width: 320, height: 740 });
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
  await page.route('**/gviz/tq?*', route => route.fulfill({ contentType: 'application/json', body: timelineResponse(route.request().url(), table) }));
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
  expect(await page.locator(':focus').evaluate(el => getComputedStyle(el, '::after').height)).toBe('3px');
  const focus = await page.evaluate(() => { const style = getComputedStyle(document.activeElement!); return { mode: document.documentElement.dataset.keyboard, outline: style.outlineStyle, decoration: style.textDecorationLine }; });
  expect(focus).toEqual({ mode: 'true', outline: 'none', decoration: 'underline' });
  const previous = page.getByRole('button', { name: 'Önceki ay' });
  await previous.click();
  const motion = await previous.evaluate(element => { const style = getComputedStyle(element); return { duration: style.transitionDuration, easing: style.transitionTimingFunction }; });
  expect(motion.duration).toContain('0.24s'); expect(motion.easing).toContain('cubic-bezier(0.65, 0, 0.35, 1)');
  for (const width of [320, 360, 375, 390, 740, 767, 768, 769, 991, 992, 993, 1023, 1024, 1025, 1440]) {
    await page.setViewportSize({ width, height: width === 740 ? 360 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow at ${width}`).toBe(true);
    expect(await page.locator('main').evaluate(element => Array.from(element.querySelectorAll('*')).filter(node => node.textContent?.trim() && node.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(node).fontSize) < 14).map(node => node.tagName))).toEqual([]);
    await expect(picker).toHaveValue('Kasım 2098');
  }
  await picker.click();
  await page.setViewportSize({ width: 320, height: 740 });
  const menu = page.locator('.mantine-Select-dropdown');
  await expect.poll(() => menu.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }), { message: 'open month menu follows the narrower viewport' }).toBe(true);
  await expect(picker).toBeFocused();
  await expect(picker).toHaveValue('Kasım 2098');
  await picker.press('Escape');
  await expect(menu).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  const violations = (await new AxeBuilder({ page }).include('.budget-app').analyze()).violations;
  expect(violations.map(violation => violation.id)).toEqual([]);
  await page.screenshot({ path: `test-results/timeline-${browserName}-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({ path: `test-results/timeline-${browserName}-320.png`, fullPage: true });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'desktop with 200% text').toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await previous.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
});
