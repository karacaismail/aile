import { test, expect } from '@playwright/test';
import { mockApi } from './helpers';

test('kalem ekle → listede görünür → toplam artar → yenilemede kalır (önbellek)', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  const before = await page.getByTestId('item-card').count();
  await page.getByTestId('fab').click();
  await expect(page.getByTestId('item-detail')).toBeVisible();
  // Geniş ekranda gizli alt sekme bağlantıları (aria-label "Tadilat") 'Ad' ile eşleşir; form içinde ara.
  await page.getByTestId('item-detail').getByLabel(/^Ad\b/).fill('Yeni test kalemi');
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
  await expect(page.getByTestId('item-card')).toHaveCount(7);
  // Hızlı şerit: tek dokunuş
  await page.getByTestId('quick-chip-fiyatsiz').click();
  await expect(page.getByTestId('item-card')).toHaveCount(3);
  for (const t of await page.getByTestId('item-card').allInnerTexts()) expect(t).not.toContain('₺');
  await expect(page.getByTestId('filter-button')).toHaveAccessibleName('Filtrele, 1 etkin');
  // Sayfa aynı durumu gösterir; "N kalemi göster" kapatır
  await page.getByTestId('filter-button').click();
  await expect(page.getByTestId('filter-drawer')).toBeVisible();
  await expect(page.getByTestId('sheet-chip-fiyatsiz').getByRole('checkbox')).toBeChecked();
  await expect(page.getByTestId('filter-apply')).toHaveText('3 kalemi göster');
  await page.getByTestId('filter-apply').click();
  await expect(page.getByTestId('filter-drawer')).toBeHidden();
  await expect(page.getByTestId('item-card')).toHaveCount(3);
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
  await page.getByTestId('item-detail').getByLabel(/^Ad\b/).fill('Çevrimdışı kalem');
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
