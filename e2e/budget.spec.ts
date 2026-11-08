import { test, expect, type Page } from '@playwright/test';
import { mockApi, horizontalOverflow, smallTargets, smallText } from './helpers';

// Sentetik bütçe: tarih "bu ay" çalışma anında hesaplanır (ekran içinde bulunulan ayla açılır).
const now = new Date();
const year = now.getFullYear();
const mm = String(now.getMonth() + 1).padStart(2, '0');
const months = (n: number) => Array(12).fill(n);
const plan = {
  year,
  groups: [
    { name: 'BORÇLAR', rows: [{ label: 'Kredi Örnek Bankası uzun adlı taksit', plan: months(33000) }, { label: 'Vergi', plan: months(11000) }] },
    { name: 'FATURALAR', rows: [{ label: 'Elektrik', plan: months(600) }, { label: 'İnternet', plan: months(1000) }] },
    { name: 'DİĞERLERİ', rows: [{ label: 'Market', plan: months(15000) }, { label: 'Okul servisi', plan: months(10000) }, { label: 'Harçlık', plan: months(5000) }] },
  ],
};
const cash = [
  { id: 'E2ECASH01', tarih: `${year}-${mm}-01`, tutar: 1250.5, kalem: 'Market', not: 'haftalık alışveriş ve temizlik malzemeleri', created_at: `${year}-${mm}-01T09:00:00Z`, version: 1 },
  { id: 'E2ECASH02', tarih: `${year}-${mm}-02`, tutar: 650, kalem: 'Elektrik', created_at: `${year}-${mm}-02T09:00:00Z`, version: 1 },
  { id: 'E2ECASH03', tarih: `${year}-${mm}-03`, tutar: 400, kalem: 'Hediye', created_at: `${year}-${mm}-03T09:00:00Z`, version: 1 },
];

async function open(page: Page, route = '/#/butce') {
  await mockApi(page, { items: [], settings: [], cash, plan });
  await page.goto(route);
  await expect(page.getByTestId('month-actual')).toContainText('2.300');
}

async function measured(page: Page) {
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 14px').toEqual([]);
}

test('bütçe ekranı: plan × kayıt, taşma yok, hedefler ≥44, metin ≥14px', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('month-plan')).toContainText('75.600');
  await expect(page.getByTestId('kalem-Elektrik')).toContainText('650');
  await expect(page.getByTestId('group-Planda olmayan')).toContainText('Hediye');
  // 320×480: ilk ekranda özet görünür
  const box = await page.getByTestId('month-summary').boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await measured(page);
});

test('üst çubuktan tek dokunuşla harcama: tutar → kalem → kaydet, liste ve toplam güncellenir', async ({ page }) => {
  await open(page);
  await page.getByTestId('topbar-expense').click();
  const form = page.getByTestId('expense-form');
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Tutar')).toBeFocused();
  await measured(page);
  await form.getByLabel('Tutar').fill('99,5');
  await form.getByTestId('kalem-select').click();
  await page.getByRole('option', { name: 'Okul servisi', exact: true }).click();
  await form.getByTestId('expense-save').click();
  await expect(form).toBeHidden();
  await expect(page.getByTestId('month-actual')).toContainText('2.400');
  await expect(page.getByTestId('kalem-Okul servisi')).toContainText('99,5');
});

test('önceki ay görüntülenirken bugünkü tarihle eklenen harcama kaydın ayında görünür', async ({ page }) => {
  await open(page);
  const current = (await page.getByTestId('month-label').textContent())!;
  await page.getByTestId('month-prev').click();
  await expect(page.getByTestId('month-label')).not.toHaveText(current);
  await page.getByTestId('fab').click();
  const form = page.getByTestId('expense-form');
  await form.getByLabel('Tutar').fill('45');
  await form.getByTestId('kalem-select').click();
  await page.getByRole('option', { name: 'Harçlık', exact: true }).click();
  await form.getByTestId('expense-save').click();
  await expect(form).toBeHidden();
  await expect(page.getByTestId('month-label')).toHaveText(current);
  await expect(page.getByTestId('kalem-Harçlık')).toContainText('45');
});

test('başka modülden de açılır; kayıt düzenlenip silinir', async ({ page }) => {
  await mockApi(page, { items: [], settings: [], cash, plan });
  await page.goto('/#/tadilat');
  await page.getByTestId('topbar-expense').click();
  await expect(page.getByTestId('expense-form')).toBeVisible();
  await page.getByRole('button', { name: 'Kapat' }).click();
  await page.goto('/#/butce');
  await page.getByTestId('entry-E2ECASH03').click();
  await page.getByTestId('expense-delete').click();
  await expect(page.getByTestId('entry-E2ECASH03')).toHaveCount(0);
  await expect(page.getByTestId('month-actual')).toContainText('1.900');
});

test('silinen harcama bildirimden Geri al ile döner; toplam ve liste eski haline gelir; klavyeyle ulaşılır, odak geri gelen satıra geçer', async ({ page, browserName }) => {
  await open(page);
  await page.getByTestId('entry-E2ECASH03').click();
  await page.getByTestId('expense-delete').click();
  await expect(page.getByTestId('entry-E2ECASH03')).toHaveCount(0);
  await expect(page.getByTestId('month-actual')).toContainText('1.900');
  const toast = page.getByRole('alert').filter({ hasText: 'Harcama silindi' });
  await expect(toast).toContainText('₺400 Hediye');
  const undo = toast.getByRole('button', { name: 'Geri al' });
  expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(44 - 0.5); // rem ölçeği alt piksel (43,999…) üretebilir; ortak smallTargets toleransı
  // Eylem etiketi dar bildirimde kırpılmaz; mesaj metni gerekirse sarılır.
  expect(await undo.locator('.mantine-Button-label').evaluate((el) => ({ clipped: el.scrollWidth > el.clientWidth, text: el.textContent }))).toEqual({ clipped: false, text: 'Geri al' });
  // Doğal Tab sırasıyla ulaşılır (WebKit düğmelere yalnız Alt+Tab ile gider); klavye göstergesi tek alt çizgi, çevreleyen halka yok.
  for (let i = 0; i < 40 && !(await undo.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(undo).toBeFocused();
  expect(await undo.evaluate((el) => ({ outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow, decoration: getComputedStyle(el).textDecorationLine }))).toEqual({ outline: 'none', shadow: 'none', decoration: 'underline' });
  // Yalnız simge taşıyan Kapat: alt çizgi görünür piksel üretmez; klavye modunda çevrelemeyen tek alt çubuk (::after), işaretçi modunda yok.
  const close = toast.getByRole('button', { name: 'Kapat' });
  const indicator = (el: Element) => { const a = getComputedStyle(el, '::after'); return { content: a.content, height: a.height, background: a.backgroundColor, outline: getComputedStyle(el).outlineStyle }; };
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(close).toBeFocused();
  expect(await close.evaluate(indicator)).toEqual({ content: '""', height: '3px', background: 'rgb(50, 107, 148)', outline: 'none' });
  await page.getByTestId('month-label').click(); // işaretçi (etkileşimsiz başlık): klavye modu kapanır
  await close.focus();
  expect((await close.evaluate(indicator)).content).toBe('none');
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
  await expect(undo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('entry-E2ECASH03')).toBeVisible();
  await expect(page.getByTestId('month-actual')).toContainText('2.300');
  await expect(toast).toBeHidden();
  // Bildirim kapanınca odak gövdeye düşmez: geri gelen satır odaklı ve görünür göstergeli.
  const row = page.getByTestId('entry-E2ECASH03');
  await expect(row).toBeFocused();
  expect(await row.evaluate((el) => ({ outline: getComputedStyle(el).outlineStyle, decoration: getComputedStyle(el).textDecorationLine }))).toEqual({ outline: 'none', decoration: 'underline' });
});

test('Bütçe sayfası açık değilken Geri al: odak kabuktaki Harcama ekle düğmesine geçer ve yalnız simgeyken görünür klavye göstergesi taşır', async ({ page, browserName }) => {
  await open(page);
  await page.getByTestId('entry-E2ECASH03').click();
  await page.getByTestId('expense-delete').click();
  const toast = page.getByRole('alert').filter({ hasText: 'Harcama silindi' });
  await expect(toast).toBeVisible();
  // Uygulama içi rota değişimi (menü bağlantısı gibi hash değişimi; page.goto tam yükleme yapar ve bildirim deposunu sıfırlar).
  await page.evaluate(() => { location.hash = '#/tadilat'; });
  await expect(page.getByTestId('timeline')).toBeVisible();
  const undo = toast.getByRole('button', { name: 'Geri al' });
  await expect(undo).toBeVisible(); // bildirim zaman sınırı yok, rota değişince de durur
  for (let i = 0; i < 40 && !(await undo.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await page.keyboard.press('Enter');
  const target = page.getByTestId('topbar-expense');
  await expect(target).toBeFocused();
  expect(await target.evaluate((el) => { const a = getComputedStyle(el, '::after'); return { content: a.content, height: a.height, outline: getComputedStyle(el).outlineStyle, labelHidden: getComputedStyle(el.querySelector('span')!).display === 'none' }; })).toEqual({ content: '""', height: '3px', outline: 'none', labelHidden: true });
  await page.goto('/#/butce');
  await expect(page.getByTestId('entry-E2ECASH03')).toBeVisible();
});

test('kuyruğu boşaltan depolama yazımı reddedilirse uyarı görünür kalır; depolama dönüp Şimdi eşitle ile yazılınca yenileme geri alınan kaydı korur', async ({ page }) => {
  await open(page);
  // Gerçek IndexedDB: ilk kuyruk yazımı (silme) diske gider, sonrakiler (boş kuyruk, geri alma) reddedilir.
  await page.evaluate(() => {
    const w = window as Window & { __nativeIdbPut?: typeof IDBObjectStore.prototype.put };
    const original = IDBObjectStore.prototype.put; w.__nativeIdbPut = original; let first = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (args[1] === 'aile:outbox:v1') { if (!first) throw new DOMException('Depolama dolu', 'QuotaExceededError'); first = false; }
      return original.apply(this, args);
    };
  });
  await page.getByTestId('entry-E2ECASH03').click();
  await page.getByTestId('expense-delete').click();
  await page.getByRole('alert').filter({ hasText: 'Harcama silindi' }).getByRole('button', { name: 'Geri al' }).click();
  await expect(page.getByTestId('entry-E2ECASH03')).toBeVisible();
  const status = page.getByTestId('sync-status');
  // Kuyruk boş ve sunucu güncel olsa da diskteki eski silme kaydı dürüstçe bildirilir; "Eşitlendi" tek başına yazılmaz.
  await expect(status).toHaveAttribute('aria-label', /saklanamadı/);
  await page.evaluate(() => { const w = window as Window & { __nativeIdbPut?: typeof IDBObjectStore.prototype.put }; IDBObjectStore.prototype.put = w.__nativeIdbPut!; });
  await status.click();
  const drawer = page.getByRole('dialog', { name: 'Senkron durumu' });
  await expect(drawer.getByTestId('sync-storage-warning')).toContainText(/yeniden uygulanabilir|yenileme/);
  await drawer.getByRole('button', { name: 'Şimdi eşitle' }).click();
  await expect(drawer.getByTestId('sync-storage-warning')).toBeHidden();
  await expect(status).not.toHaveAttribute('aria-label', /saklanamadı/);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByTestId('entry-E2ECASH03')).toBeVisible();
  await expect(page.getByTestId('month-actual')).toContainText('2.300');
});

test('ana ekran kısayolu formu açar', async ({ page }) => {
  await open(page, '/#/butce/yeni');
  await expect(page.getByTestId('expense-form')).toBeVisible();
  await expect(page).toHaveURL(/#\/butce$/);
});

test('görüntü (SNAP=1)', async ({ page }, info) => {
  test.skip(!process.env.SNAP, 'yalnız gözle kontrol için');
  await open(page);
  await page.screenshot({ path: `.tmp-shots/butce-${info.project.name}.png`, fullPage: true });
  await page.getByTestId('fab').click();
  await expect(page.getByTestId('expense-form')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `.tmp-shots/butce-form-${info.project.name}.png` });
});
