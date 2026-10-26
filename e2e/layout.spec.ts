import { test, expect } from '@playwright/test';
import { mockApi, ROUTES, horizontalOverflow, smallTargets, smallText } from './helpers';

for (const route of ROUTES) {
  test(`yatay taşma yok ve dokunma hedefleri ≥44px: ${route}`, async ({ page }) => {
    await mockApi(page);
    await page.goto(`/${route}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('topbar-title')).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await smallTargets(page)).toEqual([]);
    expect(await smallText(page), 'metin < 1rem').toEqual([]);
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

test('detay modalında taşma yok ve kaydet erişilebilir', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await page.getByTestId('item-card').first().getByRole('link').click();
  await expect(page.getByTestId('item-detail')).toBeVisible();
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'modal metin < 1rem').toEqual([]);
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
