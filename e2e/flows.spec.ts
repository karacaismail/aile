import { test, expect } from '@playwright/test';
import { mockApi } from './helpers';

test('kalem ekle → listede görünür → toplam artar → yenilemede kalır (önbellek)', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  const before = await page.getByTestId('item-card').count();
  await page.getByTestId('fab').click();
  await expect(page.getByTestId('item-detail')).toBeVisible();
  await page.getByLabel('Ad', { exact: false }).first().fill('Yeni test kalemi');
  await page.getByLabel('Tahmini (min)').fill('1234');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Yeni test kalemi')).toBeVisible();
  expect(await page.getByTestId('item-card').count()).toBe(before + 1);
  await page.reload();
  await expect(page.getByText('Yeni test kalemi')).toBeVisible();
});

test('arama ve filtre', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Kalem ara' }).fill('espresso');
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Kalem ara' }).fill('');
  await page.getByTestId('filter-button').click();
  await expect(page.getByTestId('filter-drawer')).toBeVisible();
  await page.getByLabel('Yalnız fiyatsızlar').check();
  await page.getByRole('button', { name: 'Uygula' }).click();
  const count = await page.getByTestId('item-card').count();
  expect(count).toBeGreaterThan(0);
  for (const t of await page.getByTestId('item-card').allInnerTexts()) expect(t).not.toContain('₺');
});

test('API erişilemezken önbellekten açılır, ekleme kuyruğa girer ve bağlantı dönünce gider', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  // API'yi kes (kabuk dev sunucudan gelmeye devam eder; üretimde service worker kabuğu önbellekler)
  await page.route('**/macros/s/**', (route) => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  await page.getByTestId('fab').click();
  await page.getByLabel('Ad', { exact: false }).first().fill('Çevrimdışı kalem');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Çevrimdışı kalem')).toBeVisible();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('aria-label', /Çevrimdışı/);
  await expect(page.getByTestId('sync-status').locator('..').getByText('1')).toBeVisible();
  // Bağlantı döner: kuyruk boşalır
  await page.unroute('**/macros/s/**');
  await mockApi(page);
  await page.getByTestId('sync-status').click();
  await page.getByRole('button', { name: 'Şimdi eşitle' }).click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('aria-label', /Eşitlendi/);
});
