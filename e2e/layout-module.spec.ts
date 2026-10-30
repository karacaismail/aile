import { test, expect } from '@playwright/test';
import { mockApi, horizontalOverflow, smallTargets, smallText } from './helpers';
import fixture from './fixtures/layout.json' with { type: 'json' };

test('oda listesi: genel hariç odalar, ölçü/kalem/duvar özeti; taşma yok, hedefler ≥44', async ({ page }) => {
  await mockApi(page, fixture);
  await page.goto('/#/yerlesim');
  await expect(page.getByTestId('topbar-title')).toHaveText('Yerleşim');
  const cards = page.getByTestId('room-card');
  await expect(cards).toHaveCount(10);
  await expect(page.getByTestId('room-list')).not.toContainText('Genel');
  const salon = cards.filter({ hasText: 'Salon' });
  await expect(salon).toContainText('320 × 450 cm');
  await expect(salon).toContainText('4 kalem');
  await expect(salon).toContainText('K −20');
  await expect(salon).toContainText('Serbest');
  await expect(cards.filter({ hasText: 'Çocuk odası' })).toContainText('ölçü gir');
  // İlk ekranda gerçek içerik: ilk kart katlanmanın üstünde
  const box = await cards.first().boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
});

test('oda sayfası: duvar grupları, kalan/taşma, ihtiyaç haritası; taşma yok, hedefler ≥44', async ({ page }) => {
  await mockApi(page, fixture);
  await page.goto('/#/yerlesim');
  await page.getByTestId('room-card').filter({ hasText: 'Salon' }).click();
  await expect(page).toHaveURL(/#\/yerlesim\/salon$/);
  await expect(page.getByRole('heading', { name: 'Salon' })).toBeVisible();
  await expect(page.getByTestId('wall-K')).toContainText('20 cm taşıyor');
  await expect(page.getByTestId('wall-G')).toContainText('kalan 140 cm');
  await expect(page.getByTestId('wall-D')).toContainText('kalan 450 cm');
  await expect(page.getByTestId('wall-orta')).toContainText('Orta sehpa');
  await expect(page.getByTestId('wall-K').getByTestId('layout-item-card')).toHaveCount(2);
  await expect(page.getByTestId('needs-total-priz')).toHaveText('4');
  await expect(page.getByTestId('needs-total-kanal')).toHaveText('4');
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
  // Sayfanın altı (ihtiyaç haritası) da ölçülür
  await page.getByTestId('needs-map').scrollIntoViewIfNeeded();
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
});

test('oda ölçü formu: kaydet → kart ölçüyü gösterir', async ({ page }) => {
  await mockApi(page, fixture);
  await page.goto('/#/yerlesim/cocuk');
  await expect(page.getByTestId('wall-K')).toContainText('ölçü yok');
  const form = page.getByTestId('room-dims-form');
  await form.getByLabel('En (cm)').fill('280');
  await form.getByLabel('Boy (cm)').fill('350');
  await form.getByRole('combobox', { name: 'Köpek erişimi' }).click();
  await page.getByRole('option', { name: 'Kapalı', exact: true }).click();
  await form.getByRole('button', { name: 'Ölçüleri kaydet' }).click();
  await expect(page.getByTestId('wall-K')).toContainText('kalan 280 cm');
  await expect(page.getByTestId('wall-D')).toContainText('kalan 350 cm');
  await page.getByRole('link', { name: 'Odalara dön' }).click();
  const cocuk = page.getByTestId('room-card').filter({ hasText: 'Çocuk odası' });
  await expect(cocuk).toContainText('280 × 350 cm');
  await expect(cocuk).toContainText('Kapalı');
});

test('kalem formu: ekle → duvar grubunda görünür → düzenle → sil; taşma yok, hedefler ≥44', async ({ page }) => {
  await mockApi(page, fixture);
  await page.goto('/#/yerlesim/salon');
  await page.getByTestId('fab').click();
  const form = page.getByTestId('layout-item-form');
  await expect(form).toBeVisible();
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
  await form.getByLabel('Ad', { exact: false }).first().fill('Yeni dolap');
  // SegmentedControl'ün native radyosu 0×0 (görünmez); dokunulan şey görünür etikettir.
  await form.locator('.mantine-SegmentedControl-label', { hasText: /^B$/ }).click();
  await expect(form.getByRole('radio', { name: 'B' })).toBeChecked();
  await form.getByLabel('En (cm)').fill('100');
  await form.getByLabel('Priz ihtiyacı').fill('2');
  await form.getByLabel('Elimizde var').check();
  await form.getByRole('checkbox', { name: 'Kablo kanalı — Salon' }).scrollIntoViewIfNeeded();
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
  await form.getByRole('checkbox', { name: 'Kablo kanalı — Salon' }).click();
  await form.getByRole('button', { name: 'Kaydet' }).click();
  await expect(form).toBeHidden();
  const wallB = page.getByTestId('wall-B');
  await expect(wallB).toContainText('Yeni dolap');
  await expect(wallB).toContainText('kalan 350 cm');
  await expect(wallB).toContainText('elimizde');
  await expect(wallB).toContainText('2 priz');
  await expect(page.getByTestId('needs-total-priz')).toHaveText('6');
  // Düzenle
  await wallB.getByTestId('layout-item-card').filter({ hasText: 'Yeni dolap' }).click();
  await expect(form).toBeVisible();
  await expect(form.getByLabel('En (cm)')).toHaveValue('100');
  await form.getByLabel('En (cm)').fill('150');
  await form.getByRole('button', { name: 'Kaydet' }).click();
  await expect(wallB).toContainText('kalan 300 cm');
  // Sil
  await wallB.getByTestId('layout-item-card').filter({ hasText: 'Yeni dolap' }).click();
  await form.getByRole('button', { name: 'Sil' }).click();
  await page.getByRole('dialog').filter({ hasText: 'Kalemi sil?' }).getByRole('button', { name: 'Sil' }).click();
  await expect(wallB).not.toContainText('Yeni dolap');
  await expect(wallB).toContainText('Kalem yok');
});

test('satınalma satırı öner: priz satırı oluşur, var olan kanal satırı güncellenir, çoğaltma yok', async ({ page }) => {
  await mockApi(page, fixture);
  await page.goto('/#/yerlesim/salon');
  await page.getByTestId('suggest-button').click();
  await expect(page.getByText('2 satınalma satırı yazıldı')).toBeVisible();
  await page.getByTestId('suggest-button').click();
  await expect(page.getByText('Satınalma satırları zaten güncel')).toBeVisible();
  await page.goto('/#/satinalma');
  await page.getByRole('searchbox', { name: 'Kalem ara' }).fill('Salon');
  const priz = page.getByTestId('item-card').filter({ hasText: 'Panjurlu priz — Salon' });
  await expect(priz).toHaveCount(1);
  await expect(priz).toContainText('4 adet');
  const kanal = page.getByTestId('item-card').filter({ hasText: 'Kablo kanalı — Salon' });
  await expect(kanal).toHaveCount(1);
  await expect(kanal).toContainText('4 m');
});

test('emoji yok (yerleşim ekranları)', async ({ page }) => {
  await mockApi(page, fixture);
  for (const route of ['#/yerlesim', '#/yerlesim/salon', '#/yerlesim/salon/yeni']) {
    await page.goto(`/${route}`);
    await page.waitForLoadState('networkidle');
    const text = await page.evaluate(() => document.body.innerText);
    expect(text, route).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  }
});
