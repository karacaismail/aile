import { test, expect } from '@playwright/test';
import { mockApi, horizontalOverflow } from './helpers';

const preparation = { id: 'readable-item', tip: 'satinalma', ad: 'Salon için uzun isimli köşe koltuk takımı', durum: 'karar', faz: '1', oda: 'salon', gercek_tl: 24000, fiyat_guven: 'dogrulandi', siparis_son_tarih: '2099-01-05', teslim_tarihi: '2099-02-19' };

test('hazırlık kartı bedel, tarih ve fiyat niteliğini ayırır; teslim işareti ödeme oluşturmaz', async ({ page }) => {
  const writes: Array<{ table: string; patch?: Record<string, unknown> }> = [];
  page.on('request', request => {
    if (request.method() !== 'POST' || !request.url().includes('/macros/s/')) return;
    const body = request.postDataJSON() as { action?: string; ops?: Array<{ table: string; patch?: Record<string, unknown> }> };
    if (body.action === 'batch') writes.push(...body.ops ?? []);
  });
  await mockApi(page, { items: [preparation], settings: [], cash: [] });
  await page.goto('/#/satinalma');
  const card = page.getByTestId('item-card');
  await expect(card.getByRole('heading', { name: preparation.ad })).toBeVisible();
  const facts = card.getByRole('group', { name: `${preparation.ad} alım bilgileri` });
  await expect(facts.getByText('Kayıtlı bedel')).toBeVisible();
  await expect(facts.getByText('₺24.000')).toBeVisible();
  await expect(facts.getByText('Fiyat doğrulandı')).toBeVisible();
  await expect(facts.getByText('Sipariş son günü')).toBeVisible();
  await expect(facts.getByText('Teslim tarihi')).toBeVisible();
  // Completion intentionally removes the card from the default Alınacaklar view.
  await card.getByRole('checkbox', { name: `${preparation.ad} alındı` }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Son alım işlemi' })).toContainText(preparation.ad);
  await page.getByRole('radiogroup', { name: 'Alım listesi' }).getByText('Aldıklarımız', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Aldıklarımız 1' })).toBeChecked();
  await expect(card.getByRole('checkbox', { name: `${preparation.ad} alındı` })).toBeChecked();
  await expect(card).toHaveAttribute('data-done', 'true');
  await expect(card.getByText('Teslim durumu ödeme kaydı değildir.')).toBeVisible();
  await expect.poll(() => writes.some(write => write.table === 'kalemler' && write.patch?.durum === 'teslim')).toBe(true);
  expect(writes.some(write => write.table === 'nakit')).toBe(false);
  expect(await horizontalOverflow(page)).toEqual([]);
  await card.getByRole('link', { name: 'Harcama kayıtlarına git' }).click();
  await expect(page.getByTestId('budget')).toBeVisible();
  await expect(page.getByTestId('month-actual')).toHaveText('₺0');
});

test('adlandırılmış form bölümleri girilen değerleri yeniden boyutlandırmada korur', async ({ page }) => {
  await mockApi(page, { items: [preparation], settings: [] });
  await page.goto('/#/satinalma/yeni');
  const form = page.getByTestId('item-detail');
  const identity = form.getByRole('region', { name: 'Kalem bilgileri' });
  const pricing = form.getByRole('region', { name: 'Fiyat ve teyit' });
  const order = form.getByRole('region', { name: 'Sipariş ve teslim' });
  await identity.getByLabel(/^Ad\b/).fill('Boyut değiştiren kayıt');
  await pricing.getByLabel('Tahmini (min)').fill('1750');
  await order.getByLabel('Nereden').fill('Mağaza');
  await page.setViewportSize({ width: 667, height: 320 });
  await expect(identity.getByLabel(/^Ad\b/)).toHaveValue('Boyut değiştiren kayıt');
  await expect(order.getByLabel('Nereden')).toHaveValue('Mağaza');
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(pricing.getByLabel('Tahmini (min)')).toHaveValue('₺ 1.750');
  expect(await horizontalOverflow(page)).toEqual([]);
  await form.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByRole('heading', { name: 'Boyut değiştiren kayıt' })).toBeVisible();
});
