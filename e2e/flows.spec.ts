import { test, expect } from '@playwright/test';
import { mockApi, textContrast } from './helpers';

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

test('yeni kalem: açılış odağı Ad alanında; boş kayıtta odak ilk hatalı alana döner ve hata sayısı duyurulur', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  await page.getByTestId('fab').click();
  const form = page.getByTestId('item-detail');
  const ad = form.getByLabel(/^Ad\b/);
  await expect(ad).toBeFocused();
  // Uzun formun altındaki yapışkan Kaydet'e kadar kaydırıp boş gönder: hata görünür alana gelmeli
  await form.getByLabel('Not').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(ad).toBeFocused();
  await expect(ad).toBeInViewport();
  await expect(form.getByText('Ad gerekli')).toBeInViewport();
  await expect(form.getByRole('status')).toHaveText('1 alan düzeltilmeli');
  // Alan hatası ve alt çubuktaki hata sayısı aynı semantik hata rengini kullanır ve yüzeyinde AA kontrastı sağlar
  expect(await textContrast(form.getByText('Ad gerekli')), 'alan hatası kontrastı').toBeGreaterThanOrEqual(4.5);
  expect(await textContrast(form.getByRole('status')), 'hata sayısı kontrastı').toBeGreaterThanOrEqual(4.5);
  expect(await form.getByText('Ad gerekli').evaluate((el) => getComputedStyle(el).color)).toBe(await form.getByRole('status').evaluate((el) => getComputedStyle(el).color));
  // setFieldValue ile bağlı fiyat alanı: min > max hatası da odak alır
  await ad.fill('Odak testi');
  await form.getByLabel('Tahmini (min)').fill('200');
  await form.getByLabel('Tahmini (max)').fill('100');
  await form.getByLabel('Not').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(form.getByLabel('Tahmini (max)')).toBeFocused();
  await expect(form.getByText("Min, max'tan büyük olamaz")).toBeInViewport();
  await expect(form.getByRole('status')).toHaveText('1 alan düzeltilmeli');
});

test('etkin faz yeni kaleme ön değer olur ve kayıt görünümde kalır; filtre dışında kalan kayıt için Göster', async ({ page, browserName }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  await page.getByTestId('totals-bar').getByText('Yerleşme', { exact: true }).click();
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await page.getByTestId('fab').click();
  const form = page.getByTestId('item-detail');
  await expect(form.getByRole('radio', { name: 'Yerleşme' })).toBeChecked();
  await form.getByLabel(/^Ad\b/).fill('Yerleşme için yeni kalem');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Yerleşme için yeni kalem')).toBeVisible();
  await expect(page.getByTestId('item-card')).toHaveCount(2);
  // Fiyatsız hızlı filtresi açıkken fiyatlı kalem: listede görünmez, bildirim söyler, Göster gizleyen filtreyi kaldırır
  await page.getByTestId('quick-chip-fiyatsiz').click();
  await page.getByTestId('fab').click();
  await form.getByLabel(/^Ad\b/).fill('Fiyatlı yeni kalem');
  await form.getByLabel('Tahmini (min)').fill('500');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  const toast = page.getByRole('alert').filter({ hasText: 'bu filtrede görünmüyor' });
  await expect(toast).toBeVisible();
  await expect(page.getByText('Fiyatlı yeni kalem')).toBeHidden();
  // Klavye: Tab ile Göster'e (WebKit düğmelere yalnız Alt+Tab ile gider), Enter; bildirim kaybolunca odak gövdeye düşmez, görünür hale gelen kayda geçer
  const show = toast.getByRole('button', { name: 'Göster' });
  expect(await show.locator('.mantine-Button-label').evaluate((el) => el.scrollWidth > el.clientWidth), 'Göster etiketi kırpılmaz').toBe(false);
  for (let i = 0; i < 40 && !(await show.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(show).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toast).toBeHidden();
  await expect(page.getByText('Fiyatlı yeni kalem')).toBeVisible();
  await expect(page.getByTestId('filter-button')).toHaveAccessibleName('Filtrele');
  const card = page.getByRole('link', { name: 'Fiyatlı yeni kalem detayı' });
  await expect(card).toBeFocused();
  await expect(card).toBeInViewport();
  // Klavye modu Enter ile kapanmaz: programatik odak tek alt çizgiyle görünür, çevreleyen halka yok
  expect(await page.evaluate(() => document.documentElement.dataset.keyboard)).toBe('true');
  expect(await card.evaluate((el) => ({ outline: getComputedStyle(el).outlineStyle, decoration: getComputedStyle(el).textDecorationLine }))).toEqual({ outline: 'none', decoration: 'underline' });
});

test('arama terimi yeni kaydı gizlerken Göster: arama temizlenir ve liste yenilenince odak kayda geçer', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Kalem ara' }).fill('espresso');
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await page.getByTestId('fab').click();
  await page.getByTestId('item-detail').getByLabel(/^Ad\b/).fill('Aramada gizli kalem');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  const toast = page.getByRole('alert').filter({ hasText: 'bu filtrede görünmüyor' });
  await toast.getByRole('button', { name: 'Göster' }).click();
  const card = page.getByRole('link', { name: 'Aramada gizli kalem detayı' });
  await expect(card).toBeVisible();
  await expect(card).toBeFocused();
  await expect(page.getByRole('searchbox', { name: 'Kalem ara' })).toHaveValue('');
  // İşaretçiyle tetiklendi: klavye modu kapalı, görünür gösterge yok
  expect(await card.evaluate((el) => getComputedStyle(el).textDecorationLine)).not.toContain('underline');
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

test('tarayıcı depolaması kuyruğu yazamazsa bekleyen kayıt "bu cihazda saklanamadı" diye bildirilir; depolama dönünce uyarı kalkar', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  // Gerçek IndexedDB: yalnız yazma reddedilir (idb-keyval `set` → put); okuma dokunulmaz.
  await page.evaluate(() => {
    const w = window as Window & { __nativeIdbPut?: typeof IDBObjectStore.prototype.put };
    w.__nativeIdbPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('Depolama dolu', 'QuotaExceededError'); };
  });
  await page.route('**/macros/s/**', (route) => route.abort('internetdisconnected'));
  await page.getByTestId('fab').click();
  await page.getByTestId('item-detail').getByLabel(/^Ad\b/).fill('Saklanamayan kalem');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Saklanamayan kalem')).toBeVisible();
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveAttribute('aria-label', /bu cihazda saklanamadı/);
  await expect(page.getByTestId('sync-live')).toContainText('saklanamadı');
  await status.click();
  const drawer = page.getByRole('dialog', { name: 'Senkron durumu' });
  await expect(drawer.getByTestId('sync-storage-warning')).toBeVisible();
  await expect(drawer.getByTestId('sync-storage-warning')).toContainText(/kapanırsa|yenilenirse/);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  // Depolama geri gelir: sonraki yazım kuyruğu saklar, uyarı kalkar; iki kayıt da bekler.
  await page.evaluate(() => {
    const w = window as Window & { __nativeIdbPut?: typeof IDBObjectStore.prototype.put };
    IDBObjectStore.prototype.put = w.__nativeIdbPut!;
  });
  await page.getByTestId('fab').click();
  await page.getByTestId('item-detail').getByLabel(/^Ad\b/).fill('İkinci kalem');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(status).toHaveAttribute('aria-label', /Çevrimdışı · 2 bekleyen$/);
  await expect(status).not.toHaveAttribute('aria-label', /saklanamadı/);
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
