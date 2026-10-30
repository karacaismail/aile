import { test, expect, type Page } from '@playwright/test';
import { gviz, syntheticSheets } from '../src/dashboard/fixtures';
import { syntheticTimeline } from '../src/timeline/fixtures';
import { mockApi } from './helpers';

const destinations = [
  ['/pano', 'Genel bütçe'], ['/timeline', 'Ödeme takvimi'], ['/butce', 'Harcama kayıtları'],
  ['/ev', 'Alım planı'], ['/satinalma', 'Hazırlık listesi'], ['/aydinlatma', 'Aydınlatma'], ['/yerlesim', 'Yerleşim'],
  ['/tadilat', 'Tadilat takvimi'], ['/tadilat/isler', 'Yapılacak işler'], ['/tadilat/ustalar', 'Ustalar'], ['/tadilat/kontrol', 'Kontrol listesi'],
  ['/arac', 'Araç ve finansman'], ['/ayarlar', 'Ayarlar'],
] as const;

async function mockNavigation(page: Page) {
  await mockApi(page);
  const raw = syntheticSheets();
  const timeline = syntheticTimeline();
  const map = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', 'Düzensiz giderler': 'irregular' } as const;
  await page.route('**/gviz/tq?*', route => {
    const sheet = new URL(route.request().url()).searchParams.get('sheet')!;
    if (sheet === '_Timeline web') return route.fulfill({ contentType: 'application/json', body: gviz(timeline.rows, timeline.labels) });
    const key = map[sheet as keyof typeof map];
    if (!key) return route.fulfill({ status: 404, body: 'Unknown sheet' });
    const rows = key === 'plan' || key === 'actual' ? raw[key].map(row => row.slice(0, 4)) : raw[key];
    return route.fulfill({ contentType: 'application/json', body: gviz(rows, key === 'plan' || key === 'actual' ? ['Kalem', ...raw.summary.map(row => String(row[0]))] : undefined) });
  });
}

test('desktop pages share one persistent sidebar instead of stacked route tabs', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await mockNavigation(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/aile/#/pano');
  for (let index = 0; index < destinations.length; index++) {
    const directory = page.getByRole('navigation', { name: 'Sayfalar', exact: true });
    await expect(directory).toBeVisible();
    await expect(directory).toHaveCount(1);
    await expect(page.locator('.family-primary, .family-context, .family-directory')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sayfalar', exact: true })).toHaveCount(0);
    const sidebar = page.locator('.family-sidebar');
    const bounds = await sidebar.boundingBox();
    expect(bounds!.x).toBe(0);
    expect(bounds!.height).toBe(900);
    expect(await sidebar.evaluate(element => getComputedStyle(element).position)).toBe('sticky');
    for (const [destination, label] of destinations) await expect(directory.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', `#${destination}`);
    await expect(directory.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(directory.getByRole('link', { name: destinations[index][1], exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (index === 0) await page.screenshot({ path: testInfo.outputPath('sidebar-1440.png'), fullPage: false });
    const next = destinations[(index + 1) % destinations.length];
    await directory.getByRole('link', { name: next[1], exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${next[0]}$`));
  }
});

test('mobile page drawer is modal, compact, keyboard accessible and shares the same routes', async ({ page, browserName }, testInfo) => {
  await mockNavigation(page);
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/aile/#/timeline');
  const trigger = page.locator('.family-nav-trigger');
  await expect(page.locator('.family-mobile-current')).toHaveText('Ödeme takvimi');
  await expect(page.locator('.family-primary, .family-context, .family-directory')).toHaveCount(0);
  expect((await page.locator('.family-mobile-header').boundingBox())!.height).toBeLessThanOrEqual(64);
  await trigger.focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Sayfalar', exact: true });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  const close = dialog.getByRole('button', { name: 'Sayfaları kapat' });
  await expect(close).toBeFocused();
  const directory = dialog.getByRole('navigation', { name: 'Sayfalar', exact: true });
  for (const [destination, label] of destinations) await expect(directory.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', `#${destination}`);
  await expect(page.locator('.family-content')).toHaveAttribute('inert', '');
  const panel = page.locator('.family-sidebar');
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  const motion = await panel.evaluate(element => ({ duration: getComputedStyle(element).transitionDuration, easing: getComputedStyle(element).transitionTimingFunction }));
  expect(motion.duration).toBe('0.24s');
  expect(motion.easing).toBe('cubic-bezier(0.65, 0, 0.35, 1)');
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(directory.getByRole('link', { name: 'Genel bütçe', exact: true })).toBeFocused();
  await directory.getByRole('link', { name: 'E-tabloyu aç', exact: true }).focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await expect.poll(async () => (await panel.boundingBox())?.x).toBe(0);
  await directory.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('drawer-320.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  await expect(panel).toHaveAttribute('inert', '');
  expect(await trigger.evaluate(element => ({ outline: getComputedStyle(element).outlineStyle, decoration: getComputedStyle(element).textDecorationLine }))).toEqual({ outline: 'none', decoration: 'underline' });
  expect(await panel.evaluate(element => getComputedStyle(element).transitionDuration)).toBe(motion.duration);
  await trigger.click();
  await close.click();
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await directory.getByRole('link', { name: 'Genel bütçe', exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.goBack();
  await expect(page).toHaveURL(/#\/timeline$/);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await panel.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  for (const width of [320, 360, 375, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page navigation at ${width}, 200% text`).toBe(true);
  }
});

test('navigation focus survives the sidebar and drawer breakpoint without duplicate navigation', async ({ page }) => {
  await mockNavigation(page);
  await page.setViewportSize({ width: 1025, height: 740 });
  await page.goto('/aile/#/timeline');
  const navigation = page.getByRole('navigation', { name: 'Sayfalar', exact: true });
  const home = navigation.getByRole('link', { name: 'Alım planı', exact: true });
  await home.focus();
  for (const width of [1024, 1023, 1024, 1025]) {
    await page.setViewportSize({ width, height: 740 });
    await expect(navigation).toHaveCount(1);
    await expect(home).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Sayfalar', exact: true })).toHaveCount(width < 1024 ? 1 : 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 1023, height: 740 });
  // Wait for the mobile modal to become actionable before focusing its close control.
  await expect(page.getByRole('dialog', { name: 'Sayfalar', exact: true })).toHaveAttribute('aria-modal', 'true');
  const close = page.getByRole('button', { name: 'Sayfaları kapat' });
  await close.focus();
  await page.setViewportSize({ width: 1024, height: 740 });
  await expect(navigation.getByRole('link', { name: 'Ödeme takvimi', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('short landscape drawer keeps the last link reachable and preserves focus', async ({ page }, testInfo) => {
  await mockNavigation(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/aile/#/timeline');
  const trigger = page.locator('.family-nav-trigger');
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Sayfalar', exact: true });
  const lastLink = dialog.getByRole('link', { name: 'E-tabloyu aç', exact: true });
  await lastLink.focus();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(lastLink).toBeFocused();
  await lastLink.scrollIntoViewIfNeeded();
  await expect(lastLink).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect.poll(async () => (await dialog.boundingBox())?.x).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('drawer-844-landscape.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});
