import { test, expect } from '@playwright/test';
import { mockApi, ROUTES, horizontalOverflow, smallTargets, smallText } from './helpers';

for (const route of ROUTES) {
  test(`yatay taşma yok ve dokunma hedefleri ≥44px: ${route}`, async ({ page }) => {
    await mockApi(page);
    await page.goto(`/${route}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await smallTargets(page)).toEqual([]);
    expect(await smallText(page), 'metin < 14px').toEqual([]);
  });
}

test('ilk ekranda gerçek içerik görünür (Satınalma)', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  const card = page.getByTestId('item-card').first();
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
  await expect(page.getByTestId('totals-sum')).toContainText('₺');
});

test('ilk kartın tutar ve tarihleri artı düğmesinin altında kalmaz', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  const card = page.getByTestId('item-card').first();
  await expect(card).toBeVisible();
  const fab = (await page.getByTestId('fab').boundingBox())!;
  // Satır kutusu değil, görünen yazı ölçülür.
  const covered = await card.locator('dd').evaluateAll((els, f) => els.filter((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      if ([...range.getClientRects()].some((r) => r.right > f.x && r.left < f.x + f.width && r.bottom > f.y && r.top < f.y + f.height)) return true;
    }
    return false;
  }).map((el) => el.textContent), fab);
  expect(covered).toEqual([]);
});

test('telefonda dönem seçicisine klavyeyle ulaşılır ve seçili dönem özette görünür', async ({ page, browserName }) => {
  test.skip(page.viewportSize()!.width > 480, 'yalnız telefon düzeni');
  await mockApi(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  const all = page.getByRole('radio', { name: 'Hepsi' });
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  for (let i = 0; i < 40 && !(await all.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press(tab);
  await expect(all).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  const baby = page.getByRole('radio', { name: 'Bebek' });
  await expect(baby).toBeChecked();
  await expect(baby).toBeFocused();
  const inView = await baby.evaluate((el) => { const r = el.nextElementSibling!.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; });
  expect(inView, 'seçili dönem etiketi ekranda').toBe(true);
  const phase = page.getByTestId('totals-phase');
  await expect(phase).toBeVisible();
  await expect(phase).toContainText('Bebek');
  await expect(phase).toBeInViewport();
});

test('detay modalında taşma yok ve kaydet erişilebilir', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await page.getByTestId('item-card').first().getByRole('link').click();
  await expect(page.getByTestId('item-detail')).toBeVisible();
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'modal metin < 14px').toEqual([]);
  await expect(page.getByRole('button', { name: 'Kaydet' })).toBeVisible();
});

test('emoji yok', async ({ page }) => {
  await mockApi(page);
  for (const route of ROUTES) {
    await page.goto(`/${route}`);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text, route).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  }
});
