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
  table.rows[3][14] = 'Kesim + 10 gün. Maaştan önceyse önceki aydan nakit gerekir; aynı günse maaşın yatması beklenir. Özel ödeme notu korunur.';
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

test('journey filters preserve period totals and original balances while making payment dates explicit', async ({ page }) => {
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
  await expect(payment.getByRole('group', { name: 'Ödeme ve gelir tarihleri' })).toBeVisible();
  await expect(payment.getByRole('group', { name: 'Ödeme ve gelir tarihleri' })).toContainText('27 Kasım 2098');
  await expect(payment.getByRole('group', { name: 'Ödeme ve gelir tarihleri' })).toContainText('10 Kasım 2098');
  await expect(payment.getByRole('group', { name: 'Ödeme ve gelir tarihleri' })).toContainText('ödemeden 17 gün önce');
  await expect(payment).not.toContainText('Maaştan önceyse');
  await expect(payment).toContainText('Kesim + 10 gün.');
  await expect(payment).toContainText('Özel ödeme notu korunur.');
  await page.getByRole('button', { name: 'Sonraki ay' }).click();
  await expect(payments).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('Negatif tutar kullanılabilir para değildir');
  await page.getByRole('button', { name: 'Alışveriş', exact: true }).click();
  await expect(page.getByText('Bu dönemde alışveriş adımı yok.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tüm adımlar', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
});

test('compact steps show every explanation immediately without a disclosure button', async ({ page }) => {
  await mockTimeline(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/timeline');
  await expect(page.getByRole('article')).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready);
  expect((await page.getByRole('article').first().boundingBox())!.y, 'first step begins in the narrow viewport').toBeLessThan(740);
  const purchase = page.getByRole('article', { name: /3\. adım/ });
  const note = purchase.getByText(/Teslimat tarihi satıcı ile teyit edilecek; satın alma ve teslimat ayrı adımlardır\./);
  await expect(note).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ayrıntı/ })).toHaveCount(0);
  for (const label of ['Kalan nakit', 'Toplam kart borcu', 'Denizbank', 'İşbank']) await expect(purchase.getByText(label, { exact: true })).toBeVisible();
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
    expect(layout.gap, 'notes follow the content without a large empty panel').toBeLessThanOrEqual(8);
    expect(layout.gap).toBeGreaterThanOrEqual(0);
    expect(layout.padding).toBe('0px');
    expect(layout.hidden).toBe(false);
    if (size.width === 1440) expect(layout.aligned, 'event and balances share the top row').toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const first = await page.getByRole('article').first().boundingBox();
  expect(first!.y + first!.height, 'first complete step is above the fold').toBeLessThan(900);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(note).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('same-day steps have separate surfaces without oversized inner spacing', async ({ page }) => {
  const table = syntheticTimeline();
  table.rows[2][1] = table.rows[1][1];
  table.rows[2][2] = 2;
  await page.route('**/gviz/tq?*', route => route.fulfill({ contentType: 'application/json', body: gviz(table.rows, table.labels) }));
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

test('six-digit cash and debt stay intact at 320px with 200% text', async ({ page, browserName }) => {
  await mockTimeline(page, true);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/aile/#/timeline');
  await expect(page.getByRole('article')).toHaveCount(5);
  const picker = page.getByRole('combobox', { name: 'Gösterilen dönem' });
  await picker.click();
  for (const width of [671, 672, 673, 1087, 1088, 1089]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(picker).toBeFocused();
    await expect(picker).toHaveValue('Kasım 2098');
    await expect.poll(() => page.locator('.mantine-Select-dropdown').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `large amount overflow at ${width}`).toBe(true);
    const columns = await page.locator('.timeline-workspace').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(columns, `workspace at ${width}`).toBe(width >= 1088 ? 2 : 1);
    if (width < 1087) {
      const dayColumns = await page.locator('.timeline-day').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(dayColumns, `date rail at ${width}`).toBe(width >= 672 ? 2 : 1);
    }
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
