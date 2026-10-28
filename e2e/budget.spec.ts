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
  expect(await smallText(page), 'metin < 1rem').toEqual([]);
}

test('bütçe ekranı: plan × kayıt, taşma yok, hedefler ≥44, metin ≥1rem', async ({ page }) => {
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
  await form.getByTestId('kalem-select').selectOption('Okul servisi');
  await form.getByTestId('expense-save').click();
  await expect(form).toBeHidden();
  await expect(page.getByTestId('month-actual')).toContainText('2.400');
  await expect(page.getByTestId('kalem-Okul servisi')).toContainText('99,5');
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
