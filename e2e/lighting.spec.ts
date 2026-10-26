import { test, expect } from '@playwright/test';
import { mockApi, horizontalOverflow, smallTargets, smallText } from './helpers';
import data from './fixtures/lighting.json' with { type: 'json' };

test.beforeEach(async ({ page }) => {
  await mockApi(page, data);
});

test('Odalar sekmesi: oda kartları, rozetler, taşma yok, hedefler ≥44px', async ({ page }) => {
  await page.goto('/#/aydinlatma');
  await expect(page.getByTestId('lighting-tabs')).toBeVisible();
  const cards = page.getByTestId('room-card');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBe(10);
  const salon = page.locator('[data-testid="room-card"][data-oda="salon"]');
  await expect(salon).toContainText('3 katman');
  await expect(salon).toContainText('gece');
  await expect(salon).toContainText('görev CRI≥90');
  const cocuk = page.locator('[data-testid="room-card"][data-oda="cocuk"]');
  await expect(cocuk).toContainText('görev CRI≥90');
  await expect(page.locator('[data-testid="room-card"][data-oda="wc"]')).toContainText('ana yok');
  // İlk ekranda gerçek içerik: ilk oda kartı görüntü alanında
  const box = await cards.first().boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
});

test('Oda sayfası: başlık, köpek rozeti, katman kartları ve uyarılar', async ({ page }) => {
  await page.goto('/#/aydinlatma');
  await page.locator('[data-testid="room-card"][data-oda="salon"]').click();
  await expect(page.getByTestId('room-header')).toContainText('Salon');
  await expect(page.getByTestId('dog-badge')).toContainText('köpek serbest');
  await expect(page.getByTestId('layer-card')).toHaveCount(3);
  await expect(page.getByText('Tavan çizgisel')).toBeVisible();
  await expect(page.getByText('sürücü payı %50')).toBeVisible();
  await expect(page.getByText('köpek kuralı')).toBeVisible();
  await expect(page.getByText('2 ürün')).toBeVisible();
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
  await page.getByRole('button', { name: 'Geri' }).click();
  await expect(page.getByTestId('lighting-tabs')).toBeVisible();
});

test('Katman formu: taşma yok, görev CRI doğrulaması, kayıt sonrası kart', async ({ page }) => {
  await page.goto('/#/aydinlatma/cocuk');
  await expect(page.getByTestId('layer-card')).toHaveCount(3);
  await page.getByTestId('fab').click();
  await expect(page.getByTestId('layer-form')).toBeVisible();
  await expect(page.getByTestId('cct-value')).toContainText('2700–4000 K');
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Katman türü gerekli')).toBeVisible();
  await page.getByLabel('Katman türü').selectOption('gorev');
  await page.getByLabel('CRI min').fill('80');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Görev katmanında CRI ≥ 90 olmalı')).toBeVisible();
  await page.getByLabel('CRI min').fill('95');
  await page.getByLabel('Katman adı').fill('E2E masa lambası');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByTestId('layer-form')).toHaveCount(0);
  await expect(page.getByTestId('layer-card')).toHaveCount(4);
  await expect(page.getByText('E2E masa lambası')).toBeVisible();
  // Yenilemede kalır (sahte API + önbellek)
  await page.reload();
  await expect(page.getByText('E2E masa lambası')).toBeVisible();
});

test('Katman formu: köpek kuralı ve uzun şerit uyarısı', async ({ page }) => {
  await page.goto('/#/aydinlatma/salon/01TESTLAYER000000000000003');
  await expect(page.getByTestId('layer-form')).toBeVisible();
  await expect(page.getByLabel('Katman adı')).toHaveValue('Süpürgelik gece');
  await page.getByLabel('Uzunluk (m)').fill('6');
  await expect(page.getByTestId('layer-warnings')).toContainText('iki uçtan besleme');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Köpek erişebilen odada 90 cm altında açıkta şerit/kablo olamaz')).toBeVisible();
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
});

test('Sahneler sekmesi: sahne kartı ve seviyeler; sahne formu', async ({ page }) => {
  await page.goto('/#/aydinlatma');
  await page.getByText('Sahneler', { exact: true }).click();
  const card = page.getByTestId('scene-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Akşam filmi');
  await expect(card).toContainText('Düğme');
  await expect(card.getByTestId('scene-level').first()).toHaveText('Salon · Tavan çizgisel · %20 · 2700 K');
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
  await card.click();
  await expect(page.getByTestId('scene-form')).toBeVisible();
  await expect(page.getByTestId('scene-level-row')).toHaveCount(2);
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
  await page.getByRole('button', { name: 'Seviye ekle' }).click();
  await expect(page.getByTestId('scene-level-row')).toHaveCount(3);
  await page.getByLabel('Katman 3').selectOption('01TESTLAYER000000000000002');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByTestId('scene-form')).toHaveCount(0);
  await expect(card.getByTestId('scene-level')).toHaveCount(3);
});

test('Yol haritası: toplam tahmini, adımlar ve bağlı kalemler', async ({ page }) => {
  await page.goto('/#/aydinlatma');
  await page.getByText('Yol haritası', { exact: true }).click();
  await expect(page.getByTestId('roadmap')).toBeVisible();
  await expect(page.getByTestId('roadmap-total')).toContainText('₺2.300–3.000');
  await expect(page.getByTestId('step-elektrik')).toContainText('Salon · Tavan çizgisel');
  await expect(page.getByTestId('step-elektrik')).toContainText('Şerit LED 24V 5 m');
  await expect(page.getByTestId('step-elektrik')).toContainText('LED sürücü 60 W');
  await expect(page.getByTestId('step-ampul')).toContainText('Çocuk odası · Ders masası');
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
});

test('emoji yok (aydınlatma ekranları)', async ({ page }) => {
  for (const route of ['#/aydinlatma', '#/aydinlatma/salon', '#/aydinlatma/salon/yeni', '#/aydinlatma/sahne/yeni']) {
    await page.goto(`/${route}`);
    await expect(page.getByTestId('topbar-title')).toBeVisible();
    const text = await page.evaluate(() => document.body.innerText);
    expect(text, route).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  }
});
