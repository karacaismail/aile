import { test, expect, type Locator, type Page } from '@playwright/test';
import { enterKeyboardMode, horizontalOverflow, openAdmin, tabKey } from './admin-helpers';
import { focusRing, motion, smallText } from './admin-detectors';

// a05-sheet: yerel BottomSheet (telefon alt sayfası) ve Drawer (kenar çekmecesi) gerçek rotalarda.
// Drawer: dar kabuktaki "Sayfalar" çekmecesi (her rota). BottomSheet: telefonda "Rapor" seçimi (/raporlar, ui/Select
// telefonda listeyi alt sayfada açar). Kapsam: APG kip sözleşmesi (odak içeri, Tab tuzağı, Escape, odak dönüşü), arka plan
// inert ve kaydırma kilidi, yönetim köküne portal, 44/48 px Kapat, ≥ 14 px metin, sürükleyerek kapatma (fare ve gerçek
// dokunma; pointercancel ve gövdeden kaydırma çatışmasız), hareket 240 ms proje eğrisi ve reduced-motion'da anlık.
// Emülasyon gerçek cihaz değildir. Firefox koşulmaz (kalıcı karar). Seçiciler role/label ve bileşen sözleşme sınıfları.

const MOTION_MS = 240;
const CURVE = 'cubic-bezier(0.65, 0, 0.35, 1)';
const SHEET = '.aile-sheet';

const profileOf = (page: Page) => page.locator('html').getAttribute('data-profile');
const coarseInput = (page: Page) => page.locator('html').evaluate(element => element.hasAttribute('data-input-coarse'));
const pagesButton = (page: Page) => page.getByRole('button', { name: 'Sayfalar', exact: true });
const inertAround = (locator: Locator) => locator.evaluate(element => !!element.closest('[inert]'));
const activeInside = (locator: Locator) => locator.evaluate(element => !!document.activeElement && element.contains(document.activeElement));

/** Sarmalın geçişi bitti mi (transform kimlik)? Ölçümler hareket bitince yapılır. */
async function settled(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).first().evaluate(element => {
    const transform = getComputedStyle(element).transform;
    return transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
  }), { message: `${selector} yerine oturmadı` }).toBe(true);
}

/** /raporlar zaten açık (beforeEach): telefonda "Rapor" seçimi listeyi alt sayfada açar. */
async function openReportSheet(page: Page) {
  const main = page.locator('main#admin-content');
  const combobox = page.getByRole('combobox', { name: 'Rapor' });
  await combobox.click();
  const sheet = page.getByRole('dialog', { name: 'Rapor' });
  await expect(sheet).toBeVisible();
  return { main, combobox, sheet };
}

async function expectTarget(page: Page, button: Locator) {
  const box = (await button.boundingBox())!;
  const min = (await coarseInput(page)) ? 48 : 44;
  expect(box.height, 'Kapat yüksekliği').toBeGreaterThanOrEqual(min - 0.5);
  expect(box.width, 'Kapat genişliği').toBeGreaterThanOrEqual(min - 0.5);
}

test.describe('Drawer: Sayfalar çekmecesi', () => {
  test('kip: odak içeride, arka plan inert ve kaymaz, örtü ve Escape kapatır; durum ve odak hareketi beklemez', async ({ page, browserName }) => {
    const main = await openAdmin(page, '/genel');
    test.skip((await profileOf(page)) === 'desktop', 'Sayfalar çekmecesi dar kabukta');
    const button = pagesButton(page);
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Sayfalar' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(await activeInside(dialog), 'odak çekmecede').toBe(true);
    expect(await dialog.evaluate(element => !!element.closest('.aile-admin')), 'yönetim köküne portal').toBe(true);
    expect(await inertAround(main), 'arka plan inert').toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
    await expectTarget(page, dialog.getByRole('button', { name: 'Kapat' }));
    await settled(page, '.aile-mobile-nav .aile-drawer-wrapper');
    expect(await horizontalOverflow(page), 'çekmece açıkken taşma').toEqual([]);
    expect(await smallText(page, { root: '.aile-mobile-nav' }), 'çekmecede metin ≥ 14 px').toEqual([]);

    // Tab tuzağı: bağlantı sayısından fazla Tab'da odak hep çekmecede.
    await enterKeyboardMode(page, browserName);
    const stops = (await dialog.getByRole('link').count()) + 3;
    for (let index = 0; index < stops; index += 1) {
      await page.keyboard.press(tabKey(browserName));
      expect(await activeInside(dialog), `Tab ${index + 1}`).toBe(true);
    }

    // Escape: durum anında (arka plan serbest, odak düğmede), görsel kapanış ardından.
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused({ timeout: MOTION_MS });
    expect(await inertAround(main), 'kapanınca arka plan serbest').toBe(false);
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');

    // Örtü (çekmecenin dışındaki şerit) kapatır.
    await button.click();
    await expect(dialog).toBeVisible();
    await settled(page, '.aile-mobile-nav .aile-drawer-wrapper');
    const viewport = page.viewportSize()!;
    const box = (await dialog.boundingBox())!;
    await page.mouse.click(Math.min(viewport.width - 4, box.x + box.width + 8), viewport.height / 2);
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  });
});

test.describe('BottomSheet: telefon seçimi', () => {
  test.beforeEach(async ({ page }) => {
    await openAdmin(page, '/raporlar');
    test.skip((await profileOf(page)) !== 'phone', 'Alt sayfa telefon profilinde');
  });

  test('alttan açılır, en çok %85, yönetim köküne portal; metin ≥ 14 px, Kapat 44/48 px; Escape odak dönüşü', async ({ page }) => {
    const { main, combobox, sheet } = await openReportSheet(page);
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(await activeInside(sheet), 'odak sayfada').toBe(true);
    expect(await sheet.evaluate(element => !!element.closest('.aile-admin'))).toBe(true);
    expect(await inertAround(main)).toBe(true);
    await settled(page, '.aile-sheet-sarmal');
    const viewport = page.viewportSize()!;
    const box = (await page.locator('.aile-sheet-sarmal').boundingBox())!;
    expect(Math.abs(box.y + box.height - viewport.height), 'alt kenara oturur').toBeLessThanOrEqual(1);
    expect(box.height, 'en çok %85').toBeLessThanOrEqual(viewport.height * 0.85 + 1);
    expect(box.width).toBeCloseTo(viewport.width, 0);
    await expectTarget(page, sheet.getByRole('button', { name: 'Kapat' }));
    expect(await smallText(page, { root: SHEET }), 'alt sayfada metin ≥ 14 px').toEqual([]);
    expect(await horizontalOverflow(page)).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(combobox).toBeFocused({ timeout: MOTION_MS });
    expect(await inertAround(main)).toBe(false);
    await expect(sheet).toBeHidden();
  });

  test('klavye: Tab Kapat\'a gider, gösterge tek alt çizgi (halka yok); Enter kapatır ve odak döner', async ({ page, browserName }) => {
    const { combobox, sheet } = await openReportSheet(page);
    await enterKeyboardMode(page, browserName);
    const close = sheet.getByRole('button', { name: 'Kapat' });
    // Panelden ilk Tab Kapat'a (alt sayfanın ilk durağı); giriş zaten panelde.
    await sheet.focus();
    await page.keyboard.press(tabKey(browserName));
    await expect(close).toBeFocused();
    expect(await focusRing(page, { keyboard: true }), 'Kapat odak göstergesi').toEqual([]);
    await page.keyboard.press('Enter');
    await expect(sheet).toBeHidden();
    await expect(combobox).toBeFocused();
  });

  test('fare ile tutamaçtan sürükleme: eşik altı yerine döner, eşik üstü kapatır ve odak döner', async ({ page }) => {
    const { combobox, sheet } = await openReportSheet(page);
    await settled(page, '.aile-sheet-sarmal');
    const header = (await page.locator('.aile-sheet-ust').boundingBox())!;
    const x = header.x + header.width / 2;
    const y = header.y + 6;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 20, { steps: 4 });
    await page.mouse.up();
    await expect(sheet).toBeVisible();
    await settled(page, '.aile-sheet-sarmal');

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 60, { steps: 6 });
    // Sürüklerken parmağı (imleci) izler, geçiş yok.
    expect(await page.locator('.aile-sheet-sarmal').getAttribute('data-surukleniyor')).toBe('');
    await page.mouse.move(x, y + 240, { steps: 10 });
    await page.mouse.up();
    await expect(sheet).toBeHidden();
    await expect(combobox).toBeFocused();
  });

  test('gerçek dokunma (Chromium CDP): tutamaçtan kapatır; pointercancel iptal eder; gövdeden hareket sürükleme değildir', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP dokunma olayları yalnız Chromium');
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: { x: number; y: number }[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const glide = async (x: number, from: number, to: number) => {
      for (let step = 1; step <= 8; step += 1) await touch('touchMove', [{ x, y: from + ((to - from) * step) / 8 }]);
    };

    const { combobox, sheet } = await openReportSheet(page);
    await settled(page, '.aile-sheet-sarmal');
    const header = (await page.locator('.aile-sheet-ust').boundingBox())!;
    const x = header.x + header.width / 2;
    const y = header.y + 6;

    // Gövdeden başlayan dikey hareket: alt sayfa yerinden oynamaz (iç kaydırma alanı; touch-action başlıkta none).
    const body = (await page.locator('.aile-sheet-govde').boundingBox())!;
    const bodyX = body.x + body.width / 2;
    const bodyY = body.y + Math.min(body.height / 2, 40);
    await touch('touchStart', [{ x: bodyX, y: bodyY }]);
    await glide(bodyX, bodyY, bodyY + 200);
    expect(await page.locator('.aile-sheet-sarmal').evaluate(element => element.style.getPropertyValue('--surukleme'))).toBe('');
    await touch('touchEnd', []);
    await expect(sheet).toBeVisible();

    // pointercancel: yarıda iptal, kapatmaz ve yerine döner.
    await touch('touchStart', [{ x, y }]);
    await glide(x, y, y + 200);
    expect(await page.locator('.aile-sheet-sarmal').evaluate(element => element.style.getPropertyValue('--surukleme'))).not.toBe('');
    await touch('touchCancel', []);
    await expect(sheet).toBeVisible();
    await settled(page, '.aile-sheet-sarmal');
    expect(await page.locator('.aile-sheet-sarmal').evaluate(element => element.style.getPropertyValue('--surukleme'))).toBe('');

    // Tutamaçtan aşağı: kapatır, odak açan alana döner.
    await touch('touchStart', [{ x, y }]);
    await glide(x, y, y + 240);
    await touch('touchEnd', []);
    await expect(sheet).toBeHidden();
    await expect(combobox).toBeFocused();
  });

  test('hareket: açılış/kapanış 240 ms proje eğrisiyle, gecikmesiz; kapanırken durum anında', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      const w = window as unknown as { __sheetMotion: { property: string; duration: string; easing: string; delay: string }[] };
      w.__sheetMotion = [];
      document.addEventListener('transitionrun', (event) => {
        const target = event.target as Element;
        if (!target.closest('.aile-sheet') || !/aile-sheet-(sarmal|ortu)/.test(String(target.className))) return;
        const style = getComputedStyle(target);
        w.__sheetMotion.push({ property: event.propertyName, duration: style.transitionDuration, easing: style.transitionTimingFunction, delay: style.transitionDelay });
      }, true);
    });
    const { combobox, sheet } = await openReportSheet(page);
    expect(await motion(page, 'cubic-bezier(.65,0,.35,1)', MOTION_MS, { root: SHEET }), 'durağan hareket kuralları').toEqual([]);
    await settled(page, '.aile-sheet-sarmal');
    await page.keyboard.press('Escape');
    await expect(combobox).toBeFocused({ timeout: MOTION_MS });
    await expect(sheet).toBeHidden();
    await expect(page.locator(SHEET)).toHaveCount(0);
    const records = await page.evaluate(() => (window as unknown as { __sheetMotion: { property: string; duration: string; easing: string; delay: string }[] }).__sheetMotion);
    expect(records.map(record => record.property).sort()).toEqual(['opacity', 'opacity', 'transform', 'transform']);
    for (const record of records) {
      expect(record.duration).toBe('0.24s');
      expect(record.easing).toBe(CURVE);
      expect(record.delay).toBe('0s');
    }
  });

  test('reduced-motion: anında açılır ve kapanır, çalışan animasyon yok', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const combobox = page.getByRole('combobox', { name: 'Rapor' });
    await combobox.click();
    const sheet = page.getByRole('dialog', { name: 'Rapor' });
    await expect(sheet).toBeVisible({ timeout: 100 });
    const running = await page.evaluate(() => document.getAnimations()
      .filter(animation => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return target instanceof Element && !!target.closest('.aile-sheet');
      }).length);
    expect(running).toBe(0);
    expect(await motion(page, 'cubic-bezier(.65,0,.35,1)', MOTION_MS, { root: SHEET, reduced: true })).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator(SHEET)).toHaveCount(0, { timeout: 100 });
    await expect(combobox).toBeFocused();
  });

  test('kısa ve yatay telefonda sığar: başlık ve Kapat görünür, en çok %85, gövde kendi içinde kayar', { tag: '@matrix' }, async ({ page }) => {
    const { sheet } = await openReportSheet(page);
    await settled(page, '.aile-sheet-sarmal');
    const viewport = page.viewportSize()!;
    const wrapper = (await page.locator('.aile-sheet-sarmal').boundingBox())!;
    expect(wrapper.height).toBeLessThanOrEqual(viewport.height * 0.85 + 1);
    await expect(sheet.getByRole('heading', { level: 2, name: 'Rapor' })).toBeInViewport();
    await expect(sheet.getByRole('button', { name: 'Kapat' })).toBeInViewport();
    const scroll = await page.locator('.aile-sheet-govde').evaluate(element => ({
      overflowY: getComputedStyle(element).overflowY, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
    }));
    expect(scroll.overflowY).toBe('auto');
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});
