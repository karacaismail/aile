import { test, expect, type Page } from '@playwright/test';
import { horizontalOverflow, mockApi, smallTargets, smallText } from './helpers';

const goOffline = (page: Page) => page.route('**/macros/s/**', (route) => route.abort('internetdisconnected'));
const cacheSection = (page: Page) => page.getByRole('heading', { name: 'Önbellek' }).locator('..');

test('çevrimdışı bekleyen kayıt önbellek temizlemede korunur; sonuç dürüst; bağlantı dönünce gider', async ({ page }, testInfo) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  await goOffline(page);
  await page.reload();
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  await page.getByTestId('fab').click();
  await page.getByTestId('item-detail').getByLabel(/^Ad\b/).fill('Çevrimdışı kalem');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Çevrimdışı kalem')).toBeVisible();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('aria-label', /Çevrimdışı/);

  // Ayarlar'a geç ve sayfayı yeniden yükle: kuyruk IndexedDB'den geri gelmeli, bölüm neyin korunacağını önceden söylemeli.
  await page.goto('/#/ayarlar');
  await page.reload();
  const section = cacheSection(page);
  await expect(section).toContainText('1 bekleyen değişiklik gönderilmeyi bekliyor');
  await expect(section).toContainText('Şu an çevrimdışı');
  const result = page.getByTestId('cache-result');
  await expect(result).toHaveAttribute('role', 'status'); // durum bölgesi mesajdan önce DOM'da (ARIA22)
  await expect(result).toHaveText('');
  await page.screenshot({ path: testInfo.outputPath('settings-offline-before.png'), fullPage: true });

  await page.getByRole('button', { name: 'Önbelleği temizle' }).click();
  await expect(result).toContainText('yeniden yüklenemedi');
  await expect(result).toContainText('1 bekleyen değişiklik korundu');
  await expect(result).not.toContainText('Yeniden yüklendi');
  await expect(page.getByTestId('sync-status').locator('..').getByText('1')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('settings-offline-after.png'), fullPage: true });
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page)).toEqual([]);

  // Bağlantı döner: bekleyen kayıt gönderilir, sunucudan okunur.
  await page.unroute('**/macros/s/**');
  await mockApi(page);
  await page.getByTestId('sync-status').click();
  await page.getByRole('button', { name: 'Şimdi eşitle' }).click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('aria-label', /Eşitlendi/);
  await page.goto('/#/satinalma');
  await page.reload();
  await expect(page.getByText('Çevrimdışı kalem')).toBeVisible();
});

test('çevrimiçi temizleme yeniden yükler; klavye odağı düğmede kalır ve tek alt çizgiyle görünür', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/ayarlar');
  await expect(page.getByTestId('sync-status')).toHaveAttribute('aria-label', /Eşitlendi/);
  await expect(cacheSection(page)).not.toContainText('bekleyen değişiklik');
  const button = page.getByRole('button', { name: 'Önbelleği temizle' });
  await page.keyboard.press('Tab');
  await button.focus();
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
  await expect.poll(() => button.evaluate((el) => ({ outline: getComputedStyle(el).outlineStyle, decoration: getComputedStyle(el).textDecorationLine }))).toEqual({ outline: 'none', decoration: 'underline' });
  await button.press('Enter');
  const result = page.getByTestId('cache-result');
  await expect(result).toContainText('Yeniden yüklendi');
  await expect(result).toContainText('Bekleyen değişiklik yok');
  await expect(button).toBeFocused();
  await expect(button).not.toHaveAttribute('disabled');
  await expect(button).not.toHaveAttribute('aria-disabled');
});
