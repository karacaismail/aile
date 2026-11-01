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
  await page.getByTestId('totals-bar').getByText('Sonra', { exact: true }).click();
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await page.getByTestId('fab').click();
  const form = page.getByTestId('item-detail');
  await expect(form.getByRole('radio', { name: 'Sonra' })).toBeChecked();
  await form.getByLabel(/^Ad\b/).fill('Yerleşme için yeni kalem');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Yerleşme için yeni kalem')).toBeVisible();
  await expect(page.getByTestId('item-card')).toHaveCount(2);
  // Fiyatsız hızlı filtresi açıkken fiyatlı kalem: listede görünmez, bildirim söyler, Göster gizleyen filtreyi kaldırır
  if (await page.getByTestId('filter-button').isVisible()) await page.getByTestId('filter-button').click();
  await page.getByTestId('sheet-chip-fiyatsiz').click();
  if (await page.getByTestId('filter-apply').isVisible()) await page.getByTestId('filter-apply').click();
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
  await expect(page.getByTestId('active-chip-fiyatsiz')).toHaveCount(0);
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
  if (await page.getByTestId('filter-button').isVisible()) await page.getByTestId('filter-button').click();
  await page.getByTestId('sheet-chip-fiyatsiz').click();
  if (await page.getByTestId('filter-apply').isVisible()) await page.getByTestId('filter-apply').click();
  await expect(page.getByTestId('item-card')).toHaveCount(3);
  for (const t of await page.getByTestId('item-card').allInnerTexts()) expect(t).not.toContain('₺');
  await expect(page.getByTestId('active-chip-fiyatsiz')).toBeVisible();
  if (await page.getByTestId('filter-button').isVisible()) {
    await page.getByTestId('filter-button').click();
    await expect(page.getByTestId('filter-drawer')).toBeVisible();
    await expect(page.getByTestId('sheet-chip-fiyatsiz').getByRole('checkbox')).toBeChecked();
    await expect(page.getByTestId('filter-apply')).toHaveText('3 kalemi göster');
    await page.getByTestId('filter-apply').click();
    await expect(page.getByTestId('filter-drawer')).toBeHidden();
  } else {
    await expect(page.getByTestId('sheet-chip-fiyatsiz').getByRole('checkbox')).toBeChecked();
  }
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

const recoveryName = 'Deneme salonu için uzun isimli koltuk takımı';
const recoveryData = {
  settings: [],
  items: [
    { id: 'recovery-open', tip: 'satinalma', ad: recoveryName, durum: 'siparis', faz: '1', oda: 'salon', version: 1 },
    { id: 'recovery-done', tip: 'satinalma', ad: 'Kurulmuş çalışma masası', durum: 'kuruldu', faz: '1', oda: 'salon', version: 1 },
    { id: 'recovery-cancelled', tip: 'satinalma', ad: 'İptal edilmiş lamba', durum: 'iptal', faz: '1', oda: 'salon', version: 1 },
  ],
};

test('alım kurtarma: Alındı sonrası kalıcı Geri al ve klavye odağı kayda döner', async ({ page, browserName }, testInfo) => {
  await mockApi(page, recoveryData);
  await page.goto('/#/satinalma');
  const checkbox = page.getByRole('checkbox', { name: `${recoveryName} alındı` });
  await expect(checkbox).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Alınacaklar 1' })).toBeChecked();
  expect((await page.getByRole('radiogroup', { name: 'Alım listesi' }).boundingBox())!.height, 'view selector remains a compact readable control').toBeLessThanOrEqual(88);
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  for (let i = 0; i < 40 && !(await checkbox.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(checkbox).toBeFocused();
  await page.keyboard.press('Space');
  const toast = page.getByRole('region', { name: 'Son alım işlemi' }).filter({ hasText: `${recoveryName} alındı` });
  const undo = toast.getByRole('button', { name: 'Geri al' });
  await expect(undo).toBeFocused();
  if (page.viewportSize()!.width === 320) {
    const message = toast.getByRole('status');
    const textBox = (await message.boundingBox())!;
    const actionBox = (await undo.boundingBox())!;
    expect(actionBox.y, 'narrow toast places action after the full-width message').toBeGreaterThanOrEqual(textBox.y + textBox.height);
    expect((await toast.boundingBox())!.height, 'long name must not make a tall narrow column').toBeLessThanOrEqual(200);
  }
  await expect(page.getByTestId('item-card')).toHaveCount(0);
  // Persistence is a behavioral requirement: the previous control expired after five seconds.
  await page.waitForTimeout(6100);
  await expect(undo).toBeVisible();
  expect(await undo.locator('.mantine-Button-label').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await undo.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  expect(await undo.evaluate(el => getComputedStyle(el).textDecorationLine)).toContain('underline');
  await page.screenshot({ path: testInfo.outputPath('purchase-undo.png'), fullPage: true });
  await page.keyboard.press('Enter');
  const returned = page.getByRole('link', { name: `${recoveryName} detayı` });
  await expect(returned).toBeFocused();
  await expect(returned).toBeInViewport();
  await expect(checkbox).not.toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('purchase-restored.png'), fullPage: true });
});

test('alım kurtarma: Aldıklarımızdan sonradan kaldırma, ters işlemde Geri al ve çevrimdışı kalıcılık', async ({ page }, testInfo) => {
  await mockApi(page, recoveryData);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await page.getByText('Aldıklarımız', { exact: true }).click();
  const checkbox = page.getByRole('checkbox', { name: 'Kurulmuş çalışma masası alındı' });
  await expect(checkbox).toBeChecked();
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await expect(page.getByText('İptal edilmiş lamba')).toBeHidden();
  const views = page.getByRole('radiogroup', { name: 'Alım listesi' });
  await expect.poll(() => views.evaluate(root => {
    const input = root.querySelector<HTMLInputElement>('input:checked')!;
    const selected = root.querySelector(`label[for="${CSS.escape(input.id)}"]`)!.getBoundingClientRect();
    const indicator = root.querySelector('.mantine-SegmentedControl-indicator')!.getBoundingClientRect();
    return Math.abs(selected.x - indicator.x) + Math.abs(selected.width - indicator.width);
  }), { message: 'selected surface settles on Aldıklarımız before visual evidence' }).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath('purchase-completed.png'), fullPage: true });
  await page.route('**/macros/s/**', route => route.abort('internetdisconnected'));
  await checkbox.click();
  const toast = page.getByRole('region', { name: 'Son alım işlemi' }).filter({ hasText: 'Alındı işareti kaldırıldı' });
  await toast.getByRole('button', { name: 'Geri al' }).click();
  await expect(checkbox).toBeChecked();
  await expect(page.getByTestId('item-card').getByText('Kuruldu', { exact: true })).toBeVisible();
  await checkbox.click();
  await toast.getByRole('button', { name: 'Kapat' }).click();
  await page.getByText('Alınacaklar', { exact: true }).click();
  await expect(page.getByTestId('item-card')).toHaveCount(2);
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('aria-label', /Çevrimdışı/);
  await page.reload();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByTestId('item-card')).toHaveCount(2);
  await page.getByText('Tüm kalemler', { exact: true }).click();
  await expect(page.getByTestId('item-card')).toHaveCount(3);
  await expect(page.getByText('İptal edilmiş lamba')).toBeVisible();
});

test('alım kurtarma: 320 görünüm seçicisi ve ilk kayıt birlikte okunur', async ({ page }, testInfo) => {
  await mockApi(page, recoveryData);
  await page.goto('/#/satinalma');
  const group = page.getByRole('radiogroup', { name: 'Alım listesi' });
  const title = page.getByRole('heading', { name: recoveryName });
  for (const height of [568, 740]) {
    await page.setViewportSize({ width: 320, height });
    await expect(title).toBeVisible();
    await expect(title).toBeInViewport({ ratio: 1 });
    expect(await group.evaluate(root => [...root.querySelectorAll('label')].every(label => {
      const box = label.getBoundingClientRect();
      return [...label.querySelectorAll('span')].every(span => {
        const range = document.createRange(); range.selectNodeContents(span);
        const text = range.getBoundingClientRect();
        return text.left >= box.left - 1 && text.right <= box.right + 1 && parseFloat(getComputedStyle(span).fontSize) >= 14;
      });
    })), 'view names and counts fit their own targets without small text').toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`purchase-320x${height}.png`) });
  }
});

test('alım kurtarma: klavyeyle bildirimi kapatınca odak mevcut listede kalır', async ({ page, browserName }) => {
  await mockApi(page, recoveryData);
  await page.goto('/#/satinalma');
  const checkbox = page.getByRole('checkbox', { name: `${recoveryName} alındı` });
  await expect(checkbox).toBeVisible();
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  for (let i = 0; i < 40 && !(await checkbox.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press(tab);
  await expect(checkbox).toBeFocused();
  await page.keyboard.press('Space');
  const toast = page.getByRole('region', { name: 'Son alım işlemi' }).filter({ hasText: `${recoveryName} alındı` });
  const undo = toast.getByRole('button', { name: 'Geri al' });
  await expect(undo).toBeFocused();
  const close = toast.getByRole('button', { name: 'Kapat' });
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toast).toBeHidden();
  const selected = page.getByRole('radio', { name: 'Alınacaklar 0' });
  await expect(selected).toBeFocused();
  await expect(selected).toBeInViewport();
  expect(await selected.evaluate(el => ({ keyboard: document.documentElement.dataset.keyboard, ring: getComputedStyle(el).outlineStyle, label: getComputedStyle(el.nextElementSibling!).textDecorationLine }))).toEqual({ keyboard: 'true', ring: 'none', label: 'underline' });
});

test('alım kurtarma: dört işlemden sonra son Geri al görünür ve klavyeyle erişilir', async ({ page, browserName }) => {
  const items = Array.from({ length: 4 }, (_, i) => ({ id: `completion-${i}`, tip: 'satinalma', ad: `Deneme kalemi ${i + 1}`, durum: 'siparis', version: 1 }));
  await mockApi(page, { settings: [], items });
  await page.goto('/#/satinalma');
  for (let i = 1; i <= 3; i++) await page.getByRole('checkbox', { name: `Deneme kalemi ${i} alındı` }).click();
  const last = page.getByRole('checkbox', { name: 'Deneme kalemi 4 alındı' });
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  for (let i = 0; i < 40 && !(await last.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press(tab);
  await expect(last).toBeFocused();
  await page.keyboard.press('Space');
  const undo = page.getByRole('region', { name: 'Son alım işlemi' }).filter({ hasText: 'Deneme kalemi 4 alındı' }).getByRole('button', { name: 'Geri al' });
  await expect(undo).toBeVisible();
  await expect(undo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('checkbox', { name: 'Deneme kalemi 4 alındı' })).not.toBeChecked();
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await page.getByText('Aldıklarımız', { exact: true }).click();
  await expect(page.getByTestId('item-card')).toHaveCount(3);
  await page.getByRole('checkbox', { name: 'Deneme kalemi 1 alındı' }).click();
  await page.getByRole('region', { name: 'Son alım işlemi' }).getByRole('button', { name: 'Kapat' }).click();
  await expect(page.getByRole('radio', { name: 'Aldıklarımız 2' })).not.toBeFocused();
  expect(await page.evaluate(() => document.documentElement.dataset.keyboard)).toBe('false');
});

test('alım kurtarma: uzun listede aşağıdaki pointer işleminin Geri al eylemi ekranda kalır', async ({ page }, testInfo) => {
  test.skip(page.viewportSize()!.width > 400, 'This regression covers the narrow single-column list.');
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `long-${i}`, tip: 'satinalma', ad: `${String(i + 1).padStart(2, '0')} Salon için geniş oturumlu uzun isimli koltuk takımı ve berjer`, durum: 'siparis', faz: '1', oda: 'salon', adet: 2, tahmini_tl_min: 12500, not: 'Teslim ve ölçü teyidi bekleniyor', version: 1 }));
  await mockApi(page, { settings: [], items });
  await page.goto('/#/satinalma');
  const checkbox = page.getByRole('checkbox', { name: `${items[8].ad} alındı` });
  await checkbox.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before, 'the action occurs well below the list header').toBeGreaterThan(1000);
  if (testInfo.project.use.hasTouch) await checkbox.tap(); else await checkbox.click();
  const panel = page.getByRole('region', { name: 'Son alım işlemi' });
  const undo = panel.getByRole('button', { name: 'Geri al' });
  await expect(undo).toBeVisible();
  const geometry = await undo.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: window.innerHeight, scrollY: window.scrollY, keyboard: document.documentElement.dataset.keyboard, focused: el === document.activeElement };
  });
  await testInfo.attach('pointer-undo-geometry', { body: JSON.stringify({ before, ...geometry }), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('purchase-long-pointer.png') });
  expect(geometry.top, 'Undo remains inside the viewport after a lower-list pointer action').toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
  expect(geometry.scrollY, 'the list is not forced back to its beginning').toBeGreaterThan(before - 500);
  expect(geometry.keyboard).toBe('false');
  expect(geometry.focused, 'pointer completion does not steal focus').toBe(false);
  expect(await undo.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'Undo is not covered by the toolbar').toBe(true);
  const fab = page.getByTestId('fab');
  const panelBox = (await panel.boundingBox())!;
  const fabBox = (await fab.boundingBox())!;
  const following = page.getByRole('link', { name: `${items[9].ad} detayı` });
  await expect(following).toBeInViewport();
  expect((await following.boundingBox())!.y, 'the following record remains readable below the recovery area').toBeGreaterThanOrEqual(panelBox.y + panelBox.height);
  expect(panelBox.y + panelBox.height, 'completion does not overlap the add action').toBeLessThanOrEqual(fabBox.y);
  await fab.click();
  await expect(page.getByTestId('item-detail')).toBeVisible();
  expect(await panel.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'completion remains below the record dialog').toBe(false);
  await page.getByRole('button', { name: 'Vazgeç' }).click();
  await expect(page.getByTestId('item-detail')).toBeHidden();
  await expect(undo).toBeInViewport({ ratio: 1 });
  // Move the document further without focusing another element; mobile WebKit does not support wheel input.
  await page.evaluate(() => window.scrollBy(0, 400));
  await expect(undo).toBeInViewport({ ratio: 1 });
  await undo.click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByRole('link', { name: `${items[8].ad} detayı` })).toBeFocused();
  await expect(page.getByRole('link', { name: `${items[8].ad} detayı` })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY), 'Undo restores the lower-list record context').toBeGreaterThan(1000);
});
