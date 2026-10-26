import { test, expect } from '@playwright/test';
import { mockApi, horizontalOverflow, smallTargets } from './helpers';
import data from './fixtures/renovation.json' with { type: 'json' };

const SCREENS: Array<{ path: string; ready: string }> = [
  { path: '#/tadilat', ready: 'timeline' },
  { path: '#/tadilat/isler', ready: 'task-list' },
  { path: '#/tadilat/ustalar', ready: 'vendor-list' },
  { path: '#/tadilat/kontrol', ready: 'group-sartname' },
];

for (const s of SCREENS) {
  test(`yatay taşma yok ve dokunma hedefleri ≥44px: ${s.path}`, async ({ page }) => {
    await mockApi(page, data);
    await page.goto(`/${s.path}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('topbar-title')).toHaveText('Tadilat');
    await expect(page.getByTestId(s.ready)).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await smallTargets(page)).toEqual([]);
  });
}

test('takvim: sayaç, bantlar, senaryo değişince taşlar ve ayar kalıcı', async ({ page }) => {
  await mockApi(page, data);
  await page.goto('/#/tadilat');
  await expect(page.getByTestId('countdown')).toContainText('Taşınmaya');
  await expect(page.getByTestId('countdown-days')).toHaveText(/^\d+$/);
  const tl = page.getByTestId('timeline');
  await expect(tl).toContainText('Ramazan 2027');
  await expect(tl).toContainText('Bugün');
  await expect(tl).toContainText('Anahtar teslim (A)');
  await expect(tl).not.toContainText('Anahtar teslim (B)');
  await page.locator('[aria-label="Senaryo"]').getByText('B', { exact: true }).click();
  await expect(tl).toContainText('Anahtar teslim (B)');
  await expect(tl).not.toContainText('Anahtar teslim (A)');
  await page.reload();
  await expect(page.getByTestId('timeline')).toContainText('Anahtar teslim (B)');
});

test('takvim: öğeye dokununca alt çekmece ve bağlı iş', async ({ page }) => {
  await mockApi(page, data);
  await page.goto('/#/tadilat');
  await page.getByRole('button', { name: 'Mobilya sipariş son gün' }).click();
  const drawer = page.getByTestId('timeline-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('20 Oca 2099');
  expect(await horizontalOverflow(page)).toEqual([]);
  await drawer.getByRole('button', { name: /T3 Mutfak dolabı/ }).click();
  await expect(page.getByTestId('task-detail')).toBeVisible();
  await expect(page.getByTestId('task-detail').getByLabel(/^Ad/)).toHaveValue('Mutfak dolabı montajı');
});

test('işler: kart → detay modalı (taşma yok, hedefler ≥44) → kaydet', async ({ page }) => {
  await mockApi(page, data);
  await page.goto('/#/tadilat/isler');
  const cards = page.getByTestId('task-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first().getByTestId('task-kod')).toHaveText('T1');
  await expect(cards.first()).toContainText('Planlandı');
  await cards.first().getByRole('link').click();
  await expect(page.getByTestId('task-detail')).toBeVisible();
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  await page.getByLabel('Not', { exact: true }).fill('e2e notu');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByTestId('task-detail')).toBeHidden();
  await page.getByTestId('fab').click();
  await expect(page.getByText('Yeni iş')).toBeVisible();
  await page.getByTestId('task-detail').getByLabel(/^Ad/).fill('Yeni e2e işi');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Yeni e2e işi')).toBeVisible();
  await expect(page.getByTestId('task-card')).toHaveCount(4);
});

test('ustalar: sayaç, meslek filtresi, WhatsApp/tel bağlantıları', async ({ page }) => {
  await mockApi(page, data);
  await page.goto('/#/tadilat/ustalar');
  await expect(page.getByTestId('vendor-stats')).toContainText('2 aday · 1 teklif (hedef: 5 aday → 3 teklif)');
  const first = page.getByTestId('vendor-card').first();
  await expect(first.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/905320000001');
  await expect(first.getByRole('link', { name: /0532 000 00 01/ })).toHaveAttribute('href', 'tel:+905320000001');
  await page.locator('[aria-label="Meslek"]').getByText('Boya', { exact: true }).click();
  await expect(page.getByTestId('vendor-card')).toHaveCount(1);
  await expect(page.getByTestId('vendor-stats')).toContainText('1 aday · 0 teklif');
  await page.getByTestId('vendor-card').first().getByRole('link', { name: /detayı/ }).click();
  await expect(page.getByTestId('vendor-detail')).toBeVisible();
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
});

test('kontrol: madde işaretleme kalıcı, ilerleme güncellenir, ölçüm girilir', async ({ page }) => {
  await mockApi(page, data);
  await page.goto('/#/tadilat/kontrol');
  await expect(page.getByTestId('progress-sartname')).toHaveText('1/3');
  const row = page.getByRole('checkbox', { name: /Kaçak akım rölesi/ });
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await row.click();
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('progress-sartname')).toHaveText('2/3');
  await expect(page.getByRole('button', { name: 'Metni kopyala' }).first()).toBeVisible();
  await page.getByRole('button', { name: /Kabul testi/ }).click();
  const measure = page.getByLabel(/Ölçüm: Priz gerilimi/);
  await measure.fill('230');
  await measure.blur();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Kaçak akım rölesi/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: /Kabul testi/ }).click();
  await expect(page.getByLabel(/Ölçüm: Priz gerilimi/)).toHaveValue('230');
});

test('emoji yok (tadilat ekranları)', async ({ page }) => {
  await mockApi(page, data);
  for (const s of SCREENS) {
    await page.goto(`/${s.path}`);
    await expect(page.getByTestId(s.ready)).toBeVisible();
    const text = await page.evaluate(() => document.body.innerText);
    expect(text, s.path).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  }
});
