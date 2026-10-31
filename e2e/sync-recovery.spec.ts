import { test, expect, type Page, type Route } from '@playwright/test';
import { horizontalOverflow, mockApi, smallTargets, smallText } from './helpers';

const REJECT_NAME = 'Reddedilecek kalem';
const REASON = 'durum: izinli değerler fikir, karar';

/**
 * mockApi'nin üstüne kurulan ikinci sahte katman: adı REJECT_NAME olan upsert'i sunucu gibi kalıcı reddeder
 * (`invalid_enum`, doneCount o işlemden önce durur); diğer tüm istekler `fallback` ile mockApi'ye düşer.
 * Gerçek Sheet/Apps Script'e hiçbir yazım yapılmaz.
 */
async function rejectNamed(page: Page) {
  const handler = async (route: Route) => {
    let req: { action?: string; ops?: Array<{ id: string; op: string; patch?: Record<string, unknown> }> } = {};
    try { req = JSON.parse(route.request().postData() ?? '{}'); } catch { /* yok say */ }
    if (req.action !== 'batch') return route.fallback();
    const ops = req.ops ?? [];
    const idx = ops.findIndex((o) => o.op === 'upsert' && o.patch?.ad === REJECT_NAME);
    if (idx !== 0) return route.fallback(); // reddedilecek işlem tek başına ya da en önde değilse bu test katmanı karışmaz
    const now = new Date().toISOString();
    return route.fulfill({ json: { ok: false, doneCount: 0, fingerprint: 'fx-reject', serverTime: now, error: 'invalid_enum', message: REASON, results: [{ ok: false, id: ops[0].id, error: 'invalid_enum', message: REASON }] } });
  };
  await page.route('**/macros/s/**', handler);
  return () => page.unroute('**/macros/s/**', handler);
}

const addItem = async (page: Page, name: string) => {
  await page.getByTestId('fab').click();
  await page.getByTestId('item-detail').getByLabel(/^Ad\b/).fill(name);
  await page.getByRole('button', { name: 'Kaydet' }).click();
};

const status = (page: Page) => page.getByTestId('sync-status');
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Senkron durumu' });

test('reddedilen kayıt sessizce kaybolmaz: rozet ve etiket söyler, yenilemede kalır, çekmece adı ve nedeni gösterir, yeniden dene başarır', async ({ page }, testInfo) => {
  await mockApi(page);
  const stopRejecting = await rejectNamed(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  const before = await page.getByTestId('item-card').count();
  await addItem(page, REJECT_NAME);

  // Sahte başarı yok: durum "gönderilemedi" der, rozet 1.
  await expect(status(page)).toHaveAttribute('aria-label', /1 değişiklik gönderilemedi/);
  await expect(status(page).locator('..').getByText('1')).toBeVisible();
  // Liste sunucu gerçeğine döner (kayıt Sheets'te yok); girdi çekmecede saklanır.
  await expect(page.getByTestId('item-card')).toHaveCount(before);

  // Yeniden yükleme reddi silmez (IndexedDB).
  await page.reload();
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  await expect(status(page)).toHaveAttribute('aria-label', /1 değişiklik gönderilemedi/);

  await status(page).click();
  const d = drawer(page);
  await expect(d).toBeVisible();
  const item = d.getByTestId('sync-rejected-item');
  await expect(item).toContainText(REJECT_NAME);
  await expect(item).toContainText('Yeni kayıt');
  await expect(item).toContainText(REASON);
  await expect(item.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
  await expect(item.getByRole('button', { name: 'Vazgeç' })).toBeVisible();
  // Okuma sırası: neden ve eylemler, her zaman açık değer listesinden önce gelir; değerler etiket/değer çiftleridir.
  const details = item.getByRole('group', { name: 'Kaydedilen değerler' });
  await expect(details.getByRole('term').filter({ hasText: /^Ad$/ })).toBeVisible();
  await expect(details.getByRole('definition').filter({ hasText: REJECT_NAME })).toBeVisible();
  const y = async (l: ReturnType<Page['getByText']>) => (await l.boundingBox())!.y;
  expect(await y(item.getByText(REASON))).toBeLessThan(await y(item.getByRole('button', { name: 'Yeniden dene' })));
  expect(await y(item.getByRole('button', { name: 'Yeniden dene' }))).toBeLessThan(await y(details));
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.mantine-Drawer-content')].every((el) => getComputedStyle(el).opacity === '1'));
  await page.screenshot({ path: testInfo.outputPath('sync-rejected-drawer.png'), fullPage: false });
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page)).toEqual([]);

  // Neden giderildi (sunucu artık kabul ediyor): aynı işlem yeniden gönderilir, red kapanır, kayıt listede ve yenilemede kalır.
  await stopRejecting();
  await item.getByRole('button', { name: 'Yeniden dene' }).click();
  await expect(status(page)).toHaveAttribute('aria-label', /Eşitlendi/);
  await expect(d.getByTestId('sync-rejected-item')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await expect(page.getByText(REJECT_NAME)).toBeVisible();
  await page.reload();
  await expect(page.getByText(REJECT_NAME)).toBeVisible();
  await expect(status(page)).toHaveAttribute('aria-label', /Eşitlendi/);
});

test('vazgeç yalnız onaydan sonra siler; onay kaydın adını söyler; silinen değişiklik yenilemede geri gelmez', async ({ page }) => {
  await mockApi(page);
  await rejectNamed(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  await addItem(page, REJECT_NAME);
  await expect(status(page)).toHaveAttribute('aria-label', /gönderilemedi/);
  await status(page).click();
  const d = drawer(page);
  const item = d.getByTestId('sync-rejected-item');
  await item.getByRole('button', { name: 'Vazgeç' }).click();
  const confirm = page.getByRole('dialog', { name: /vazgeç/i });
  await expect(confirm).toContainText(REJECT_NAME);
  await confirm.getByRole('button', { name: 'Geri dön' }).click();
  await expect(confirm).toBeHidden();
  await expect(item).toHaveCount(1); // onaysız silinmedi
  await item.getByRole('button', { name: 'Vazgeç' }).click();
  await page.getByRole('dialog', { name: /vazgeç/i }).getByRole('button', { name: 'Değişikliği sil' }).click();
  await expect(d.getByTestId('sync-rejected-item')).toHaveCount(0);
  await expect(status(page)).toHaveAttribute('aria-label', /Eşitlendi/);
  await expect(status(page)).not.toHaveAttribute('aria-label', /gönderilemedi/);
  await page.reload();
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  await expect(status(page)).toHaveAttribute('aria-label', /Eşitlendi/);
  await expect(page.getByText(REJECT_NAME)).toHaveCount(0);
});

for (const count of [1, 2]) test(`klavyeyle onaylanan "Vazgeç" sonrası odak çekmecede kalır ve görünür (${count} red)`, async ({ page }) => {
  await mockApi(page);
  await rejectNamed(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  for (let i = 1; i <= count; i++) { await addItem(page, REJECT_NAME); await expect(status(page)).toHaveAttribute('aria-label', new RegExp(`${i} değişiklik gönderilemedi`)); }
  await status(page).click();
  const d = drawer(page);
  await page.keyboard.press('Tab');
  const discard = d.getByRole('button', { name: 'Vazgeç', exact: true }).first();
  await discard.focus();
  await discard.press('Enter');
  const confirm = page.getByRole('dialog', { name: /vazgeç/i });
  const yes = confirm.getByRole('button', { name: 'Değişikliği sil', exact: true });
  await yes.focus();
  await yes.press('Enter');
  await expect(confirm).toBeHidden();
  await expect(d.getByTestId('sync-rejected-item')).toHaveCount(count - 1);
  // Odak çekmecede kalan sabit öğeye geçer (satır kalkınca "Şimdi eşitle", liste kaldıysa bölüm başlığı) ve tek alt çizgiyle görünür.
  const survivor = count === 1 ? d.getByRole('button', { name: 'Şimdi eşitle' }) : d.getByRole('heading', { name: 'Gönderilemeyen değişiklikler' });
  await expect(survivor).toBeFocused();
  await page.waitForTimeout(400); // ek emniyet: ilk iddia zaten modal çıkışından sonradır; sonradan bir zamanlayıcı odağı çalmıyor
  await expect(survivor).toBeFocused();
  await expect.poll(() => survivor.evaluate((el) => ({ outline: getComputedStyle(el).outlineStyle, decoration: getComputedStyle(el).textDecorationLine }))).toEqual({ outline: 'none', decoration: 'underline' });
});

test('klavye: Tab ile "Yeniden dene"ye gelince tek alt çizgi, çevre halkası yok; Enter çalışır', async ({ page }) => {
  await mockApi(page);
  const stopRejecting = await rejectNamed(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  await addItem(page, REJECT_NAME);
  await expect(status(page)).toHaveAttribute('aria-label', /gönderilemedi/);
  await status(page).click();
  const retry = drawer(page).getByRole('button', { name: 'Yeniden dene' });
  await expect(retry).toBeVisible();
  await page.keyboard.press('Tab');
  await retry.focus();
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
  await expect.poll(() => retry.evaluate((el) => ({ outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow, decoration: getComputedStyle(el).textDecorationLine }))).toEqual({ outline: 'none', shadow: 'none', decoration: 'underline' });
  await stopRejecting();
  await retry.press('Enter');
  await expect(status(page)).toHaveAttribute('aria-label', /Eşitlendi/);
  // Satır kalktı; odak çekmeceden düşmez, kalan sabit düğmeye geçer ve tek alt çizgiyle görünür.
  const syncNow = drawer(page).getByRole('button', { name: 'Şimdi eşitle' });
  await expect(syncNow).toBeFocused();
  await expect.poll(() => syncNow.evaluate((el) => ({ outline: getComputedStyle(el).outlineStyle, decoration: getComputedStyle(el).textDecorationLine }))).toEqual({ outline: 'none', decoration: 'underline' });
});
