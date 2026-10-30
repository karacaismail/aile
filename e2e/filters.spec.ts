import { test, expect, type Page } from '@playwright/test';
import { mockApi, horizontalOverflow, smallTargets, smallText } from './helpers';
import { tokens } from '../src/dashboard/tokens';

const measure = async (page: Page, where: string) => {
  expect(await horizontalOverflow(page), `${where}: taşma`).toEqual([]);
  expect(await smallTargets(page), `${where}: hedef`).toEqual([]);
  expect(await smallText(page), `${where}: metin`).toEqual([]);
};

/** Çip etiketinin (label[for]) hesaplanmış stili. */
async function chipStyle(page: Page, name: RegExp) {
  const input = page.getByTestId('filter-rail').getByRole('checkbox', { name });
  const id = await input.getAttribute('id');
  return page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`label[for="${CSS.escape(id!)}"]`)!;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor, checked: el.hasAttribute('data-checked') };
  }, id);
}

const rgb = (hex: string) => `rgb(${[1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)).join(', ')})`;
const contrast = (foreground: string, background: string) => {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
      const channel = Number(value) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** Shared family identity remains readable and selected state remains distinct in either OS preference. */
async function expectFamilyChipPalette(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
  const off = await chipStyle(page, /^Fiyatsız/);
  expect(off).toEqual({ bg: rgb(tokens.paper), color: rgb(tokens.ink), border: 'rgba(0, 0, 0, 0)', checked: false });
  expect(contrast(off.color, off.bg), 'unselected chip text contrast').toBeGreaterThanOrEqual(4.5);
  await page.getByTestId('quick-chip-fiyatsiz').click();
  await expect(page.getByTestId('filter-rail').getByRole('checkbox', { name: /^Fiyatsız/ })).toBeChecked();
  await expect(page.getByTestId('quick-chip-fiyatsiz').getByTestId('chip-icon-check')).toBeVisible();
  const frames = await page.getByTestId('quick-chip-fiyatsiz').evaluate(async (element, duration) => {
    const label = element.querySelector('label')!;
    const samples: { color: string; bg: string }[] = [];
    const started = performance.now();
    do {
      const style = getComputedStyle(label);
      samples.push({ color: style.color, bg: style.backgroundColor });
      await new Promise(requestAnimationFrame);
    } while (performance.now() - started < duration);
    return samples;
  }, tokens.duration);
  for (const frame of frames) expect(contrast(frame.color, frame.bg), 'chip text remains readable while its selected surface animates').toBeGreaterThanOrEqual(4.5);
  // Wait for the shared surface transition; checking an intermediate RGB is not a palette contract.
  await expect.poll(() => chipStyle(page, /^Fiyatsız/)).toEqual({
    bg: rgb(tokens.timelineViewSelectedSurface), color: rgb(tokens.ink), border: 'rgba(0, 0, 0, 0)', checked: true,
  });
  const on = await chipStyle(page, /^Fiyatsız/);
  expect(on.bg, 'checked and unchecked surfaces must remain distinct').not.toBe(off.bg);
  expect(contrast(on.color, on.bg), 'selected chip text contrast').toBeGreaterThanOrEqual(4.5);
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
});

test('şerit: sayımlı hızlı çipler; Fiyatsız tek dokunuşla; huni rozeti; toplam "Görünen"', async ({ page }) => {
  const rail = page.getByTestId('filter-rail');
  await expect(rail.getByRole('checkbox', { name: 'Alınacaklar 7' })).toBeAttached();
  await expect(page.getByTestId('quick-chip-hideDone')).toBeVisible();
  await expect(rail.getByRole('checkbox', { name: 'Fiyatsız 3' })).toBeAttached();
  await expect(rail.getByRole('checkbox', { name: 'Karar bekliyor 1' })).toBeAttached();
  await expect(rail.getByRole('checkbox', { name: 'Son tarih 1' })).toBeAttached();
  await expect(rail.getByRole('checkbox', { name: 'Sipariş 1' })).toBeAttached();
  await expect(page.getByTestId('totals-count')).toHaveText('7 kalem');
  await measure(page, 'şerit');
  await page.getByTestId('quick-chip-fiyatsiz').click();
  await expect(page.getByTestId('item-card')).toHaveCount(3);
  await expect(page.getByTestId('totals-count')).toHaveText('3 / 7 kalem');
  // Para aralığı hiçbir durumda kırpılmaz
  const sum = page.getByTestId('totals-sum');
  expect(await sum.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(page.getByTestId('filter-button')).toHaveAccessibleName('Filtrele, 1 etkin');
  // Sayımlar diğer filtreye göre daralır; sıfır olan devre dışı
  await expect(rail.getByRole('checkbox', { name: 'Son tarih 0' })).toBeDisabled();
  // Temizle her şeyi sıfırlar
  await rail.getByRole('button', { name: 'Temizle' }).click();
  await expect(page.getByTestId('item-card')).toHaveCount(7);
  await expect(page.getByTestId('filter-button')).toHaveAccessibleName('Filtrele');
  // Yenilemede kalıcı: Karar aç, yenile, hâlâ açık
  await page.getByTestId('quick-chip-kararBekliyor').click();
  await page.reload();
  await expect(page.getByTestId('filter-rail').getByRole('checkbox', { name: 'Karar bekliyor 1' })).toBeChecked();
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  // Arama temizle (X) gerçek dokunuşla çalışır
  await page.getByTestId('quick-chip-kararBekliyor').click();
  await page.getByRole('searchbox', { name: 'Kalem ara' }).fill('espresso');
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await measure(page, 'arama');
  await page.getByRole('button', { name: 'Aramayı temizle' }).click();
  await expect(page.getByRole('searchbox', { name: 'Kalem ara' })).toHaveValue('');
  await expect(page.getByTestId('item-card')).toHaveCount(7);
});

test('sayfa: facet seçimi canlı sayım; alt çubuk gövde kaydırılınca da görünür; şeritte kaldırılabilir çip; odak huniye döner', async ({ page, browserName }) => {
  await page.getByTestId('filter-button').click();
  const sheet = page.getByTestId('filter-drawer');
  await expect(sheet).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Filtrele' })).toBeVisible();
  await measure(page, 'sayfa');
  await expect(sheet.getByRole('checkbox', { name: 'Salon 1' })).toBeAttached();
  await page.getByTestId('facet-oda-salon').click();
  await expect(page.getByTestId('filter-apply')).toHaveText('1 kalemi göster');
  await expect(page.getByTestId('filter-clear')).toHaveText('Temizle (1)');
  // Gövdeyi en alta kaydır (Diğer bölümü); alt düğme görünür kalmalı
  await page.getByLabel('Mevcut eşyaları da göster').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('filter-apply')).toBeInViewport();
  const vh = page.viewportSize()!.height;
  const box = await page.getByTestId('filter-apply').boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1);
  await measure(page, 'sayfa (altta)');
  await page.getByTestId('filter-apply').click();
  await expect(sheet).toBeHidden();
  // WebKit düğmeye tıklayınca odak vermez (Safari davranışı); odak dönüşü yalnız Chromium'da ölçülür
  if (browserName !== 'webkit') await expect(page.getByTestId('filter-button')).toBeFocused();
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  const active = page.getByTestId('active-chip-oda-salon');
  await expect(active.getByRole('checkbox', { name: 'Salon 1' })).toBeChecked();
  await active.click();
  await expect(page.getByTestId('active-chip-oda-salon')).toHaveCount(0);
  await expect(page.getByTestId('item-card')).toHaveCount(7);
  // Esc kapatır
  await page.getByTestId('filter-button').click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('sıralama: Ad seçimi uygulanır ve kapanır; alındı işaretlenen kalem en alta, ayraçla', async ({ page }) => {
  await page.getByTestId('sort-button').click();
  const sheet = page.getByTestId('sort-sheet');
  await expect(sheet).toBeVisible();
  if (page.viewportSize()!.width < 768) {
    // Alttan sayfa içerik kadar yüksek: üstte kapatmak için dokunulabilir örtü kalır
    const box = await page.locator('.mantine-Drawer-content').boundingBox();
    expect(box!.y).toBeGreaterThan(44);
  }
  await measure(page, 'sıralama');
  await sheet.getByRole('radio', { name: 'Ad (A → Z)' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('sort-button')).toHaveAccessibleName(/Sırala: Ad/);
  const titles = async () => page.getByTestId('item-card').locator('[role="link"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  const before = await titles();
  expect(before[0]).toMatch(/^Bebek güvenlik/);
  // İlk kalemi alındı işaretle → kapananlar en altta, ayraç görünür
  await page.getByRole('checkbox', { name: /Bebek güvenlik bariyeri alındı/ }).check();
  await expect(page.getByTestId('closed-divider')).toBeVisible();
  const after = await titles();
  expect(after[after.length - 1]).toMatch(/^Bebek güvenlik/);
  // Alınacaklar gizler, boş durum değil
  await page.getByTestId('quick-chip-hideDone').click();
  await expect(page.getByTestId('item-card')).toHaveCount(6);
  await expect(page.getByTestId('closed-divider')).toHaveCount(0);
});

test('çip renkleri: ortak aile tokenları, ayırt edilebilir seçim ve okunabilir metin', async ({ page }) => {
  await expectFamilyChipPalette(page);
});

test.describe('koyu sistem tercihi', () => {
  test.use({ colorScheme: 'dark' });
  test('çip renkleri: ortak aile teması korunur; seçili/seçisiz kontrast ve ölçümler', async ({ page }) => {
    await expectFamilyChipPalette(page);
    await measure(page, 'koyu şerit');
    await page.getByTestId('filter-button').click();
    await expect(page.getByTestId('filter-drawer')).toBeVisible();
    await measure(page, 'koyu sayfa');
  });
});

test('geniş ekran: çipler sarar, sayfa sağdan açılır, sıralama düğmesi etiketli', async ({ page }) => {
  test.skip(page.viewportSize()!.width < 768, 'yalnız ≥768');
  const rail = page.getByTestId('filter-rail');
  const scroll = await rail.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(scroll).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('sort-button')).toHaveText(/Sırala: Öncelik/);
  await page.getByTestId('filter-button').click();
  const content = page.locator('.mantine-Drawer-content');
  await expect(content).toBeVisible();
  const box = await content.boundingBox();
  expect(box!.x).toBeGreaterThan(page.viewportSize()!.width / 2);
  await measure(page, 'geniş sayfa');
  await page.getByTestId('filter-apply').click();
  await page.getByTestId('sort-button').click();
  await expect(page.getByTestId('sort-sheet')).toBeVisible();
  await page.getByTestId('sort-sheet').getByRole('radio', { name: 'Fiyat (yüksekten düşüğe)' }).click();
  await expect(page.getByTestId('sort-button')).toHaveText(/Sırala: Fiyat/);
});
