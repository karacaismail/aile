import { test, expect, type Page } from '@playwright/test';
import { openAdmin } from './admin-helpers';

// p-phonejs2: "Diğer" menüsünün gövdesi tembel (src/admin/ui/Menu.lazy.tsx → import('./Menu.panel')). Telefon ilk rotası
// (/genel) menü düğmesi modülünü statik alır, açılır gövdeyi (Menu.panel: liste + açılır panel + alt sayfa sarmalı),
// Menu.css'i ve BottomSheet'i istemez. "Diğer" çizen gerçek rotada (/hesaplar: birincil "Hesap ekle" + "Diğer" → "Borç
// ekle") ilk basış gövdeyi bir kez indirir: indirme sürerken düğme aria-expanded + aria-busy taşır, basış kaybolmaz; gövde
// gelince alt sayfa açılır ve odak ilk öğededir; Escape odağı düğmeye döndürür; ikinci açılış yeni istek yapmaz. Parça
// indirilemezse (çevrim içi) "Yeni sürüm var · Yenile"; sayfa kendiliğinden yenilenmez.
// Geliştirme sunucusunda modüller ayrı isteklerdir: istek yolu statik kapanışın doğrudan kanıtıdır. Üretim parçalarıyla
// aynı ölçüm docs/ADMIN-BUDGETS.md (p-phonejs2). Görev koşusu: chromium 320×568 + webkit 390×844 (dokunmatik); davranış
// testi @matrix (entegrasyonda telefon profilli matris projeleri; geniş profilde "Diğer" yoktur, test atlanır).

const MENU_BODY = /\/src\/admin\/ui\/(?:Menu\.panel\.tsx|Menu\.tsx|Menu\.css|BottomSheet\.tsx|BottomSheet\.layer\.ts|BottomSheet\.css)(?:\?|$)/;
const PANEL = /\/src\/admin\/ui\/Menu\.panel\.tsx(?:\?.*)?$/;

/** Sayfanın istediği yerel modül yolları (sorgusuz). */
function recordModules(page: Page): string[] {
  const paths: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.includes('/src/')) paths.push(url.pathname + url.search);
  });
  return paths;
}

// Yalnız telefon profili: geniş profilde (tablet, masaüstü) Sayfalar çekmecesi ve "Diğer" menüsü yoktur. Profil kuralı
// src/admin/adaptive/profile.ts ile aynı: genişlik < 600 ya da kısa kenar < 480.
test.skip(({ viewport }) => !viewport || (viewport.width >= 600 && Math.min(viewport.width, viewport.height) >= 480), 'yalnız telefon profili');

const digerOf = (page: Page) => page.locator('.aile-ph [data-part="actions"]').getByRole('button', { name: 'Diğer', exact: true });

test('/genel telefon: menü düğmesi modülü statik, açılır gövde (Menu.panel, Menu.css) ve BottomSheet istenmez', async ({ page }) => {
  const modules = recordModules(page);
  await openAdmin(page, '/genel');
  expect(await page.evaluate(() => document.documentElement.dataset.profile)).toBe('phone');
  expect(modules.some(path => /\/src\/admin\/ui\/Menu\.lazy\.tsx(?:\?|$)/.test(path)), 'tetik modülü statik').toBe(true);
  expect(modules.filter(path => MENU_BODY.test(path))).toEqual([]);
});

test('/hesaplar telefon: ilk basış gövdeyi bir kez indirir; indirme sürerken aria-busy, basış kaybolmaz; alt sayfa açılır, odak ilk öğede', { tag: '@matrix' }, async ({ page }) => {
  const modules = recordModules(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(PANEL, async route => { await held; await route.continue(); });
  await openAdmin(page, '/hesaplar');
  test.skip(await page.evaluate(() => document.documentElement.dataset.profile !== 'phone'), '"Diğer" yalnız telefon profilinde');
  expect(modules.filter(path => PANEL.test(path))).toEqual([]);

  const diger = digerOf(page);
  await expect(diger).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(diger).toHaveAttribute('aria-expanded', 'false');
  // Dokunma hedefi (44 px; kaba işaretçide 48 px) ve okunur metin (≥ 14 px).
  const box = await diger.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await diger.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);

  await diger.click();
  await expect(diger).toHaveAttribute('aria-expanded', 'true');
  await expect(diger).toHaveAttribute('aria-busy', 'true');
  const sheet = page.getByRole('dialog', { name: 'Diğer eylemler' });
  await expect(sheet).toHaveCount(0);
  expect(modules.filter(path => PANEL.test(path))).toHaveLength(1);

  release();
  await expect(sheet).toBeVisible();
  const item = sheet.getByRole('menuitem', { name: 'Borç ekle' });
  await expect(item).toBeFocused();
  await expect(diger).not.toHaveAttribute('aria-busy', 'true');
  const itemBox = await item.boundingBox();
  expect(itemBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await item.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(diger).toBeFocused();
  await expect(diger).toHaveAttribute('aria-expanded', 'false');

  await diger.click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('menuitem', { name: 'Borç ekle' })).toBeFocused();
  expect(modules.filter(path => PANEL.test(path))).toHaveLength(1);
});

test('/hesaplar telefon: gövde parçası indirilemezse (çevrim içi) "Yeni sürüm var · Yenile"; sayfa kendiliğinden yenilenmez, Yenile yeniler', async ({ page }) => {
  await page.route(PANEL, route => route.abort());
  await openAdmin(page, '/hesaplar');
  await page.evaluate(() => { (window as unknown as { __p2Isaret: number }).__p2Isaret = 1; });
  const diger = digerOf(page);
  await diger.click();
  const notice = page.locator('.aile-menu-dugme').getByRole('status');
  await expect(notice).toContainText('Yeni sürüm var');
  await expect(diger).toHaveAttribute('aria-expanded', 'false');
  await expect(diger).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('dialog', { name: 'Diğer eylemler' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __p2Isaret?: number }).__p2Isaret)).toBe(1);
  await Promise.all([page.waitForEvent('load'), notice.getByRole('button', { name: 'Yenile' }).click()]);
  expect(await page.evaluate(() => (window as unknown as { __p2Isaret?: number }).__p2Isaret)).toBeUndefined();
});
