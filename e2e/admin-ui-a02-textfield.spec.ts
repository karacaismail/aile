import { expect, test, type Locator, type Page } from '@playwright/test';
import { focusRing, motion, smallText } from './admin-detectors';
import { horizontalOverflow, openAdmin, shiftTabKey, tabKey } from './admin-helpers';

// TextField (src/admin/ui/TextField.tsx) gerçek rotalarda: Alımlar sorgu çubuğundaki arama alanı (type="search",
// temizle düğmesi) ve Ayarlar'daki adres/anahtar alanları (yardım, hata, aria-describedby, aria-invalid).
// Projeler: chromium 320×568 dokunmatik, webkit 390×844 dokunmatik, chromium-desktop 1440×900; @matrix etiketli
// testler entegrasyonda 360/375/320×480/568×320/tablet/masaüstü projelerinde de koşar. Emülasyon gerçek cihaz değildir:
// sanal klavye burada visualViewport taklidiyle sınanır (gerçek iOS/Android klavyesi değil).
// Veri: dev sunucusu yalnız sentetik nesli verir (playwright.admin.config.ts › syntheticServerEnv). Google'a giden her
// istek kesilir ve test sonunda boş olduğu doğrulanır.

const GOOGLE_HOST = /(^|\.)(google|googleapis|gstatic|googleusercontent)\.com$/;
const external = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const hits: string[] = [];
  external.set(page, hits);
  await page.route((url) => GOOGLE_HOST.test(url.hostname), (route) => {
    hits.push(route.request().url());
    return route.abort();
  });
});

test.afterEach(async ({ page }) => {
  expect(external.get(page), 'Google ağ çağrısı yapılmamalı').toEqual([]);
});

const searchbox = (page: Page) => page.getByRole('search').first().getByRole('searchbox', { name: 'Ara' });
const clearButton = (page: Page) => page.getByRole('button', { name: 'Aramayı temizle' });
/** Girdiyi taşıyan kutu (odak çizgisi taşıyıcısı) ve alanın kökü. */
const boxOf = (control: Locator) => control.locator('xpath=ancestor::*[@data-focus-line][1]');
const fieldOf = (control: Locator) => control.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " aile-textfield ")][1]');

const isCoarse = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'));
const targetFor = (coarse: boolean) => (coarse ? 48 : 44);
const fontSize = (control: Locator) => control.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'öğe yerleşimde yok').not.toBeNull();
  return box!;
}

test.describe('TextField: Alımlar arama alanı', () => {
  test('görünür etiket, 44/48 px hedef, ≥14 px metin, kaba girişte ≥16 px girdi, yatay taşma yok', { tag: '@matrix' }, async ({ page }) => {
    await openAdmin(page, '/alimlar');
    const input = searchbox(page);
    await expect(input).toBeVisible();
    const label = fieldOf(input).locator('label');
    await expect(label).toHaveText('Ara');
    await expect(label).toBeVisible();

    const coarse = await isCoarse(page);
    const target = targetFor(coarse);
    expect((await rect(boxOf(input))).height).toBeGreaterThanOrEqual(target - 0.5);
    expect(await fontSize(input)).toBeGreaterThanOrEqual(coarse ? 16 : 14);

    await input.fill('koltuk');
    const clear = clearButton(page);
    await expect(clear).toBeVisible();
    const box = await rect(boxOf(input));
    const button = await rect(clear);
    expect(button.width).toBeGreaterThanOrEqual(target - 0.5);
    expect(button.height).toBeGreaterThanOrEqual(target - 0.5);
    // Düğme kutunun sağ ucunda ve kutunun içinde kalır; girdi düğmenin altına girmez.
    expect(Math.abs(button.x + button.width - (box.x + box.width))).toBeLessThanOrEqual(1);
    expect(button.y).toBeGreaterThanOrEqual(box.y - 0.5);
    expect(button.y + button.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    const inputBox = await rect(input);
    expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(button.x + 0.5);

    expect(await smallText(page, { root: '[role="search"]' })).toEqual([]);
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test('kaba giriş katmanı: kutu ve temizle düğmesi 48 px, girdi yazısı en az 16 px', { tag: '@matrix' }, async ({ page }) => {
    await openAdmin(page, '/alimlar');
    // Doğal katman ne olursa olsun kaba giriş kuralını sınar (masaüstünde de); AdaptiveRoot <html>'e aynı özniteliği yazar.
    await page.evaluate(() => document.documentElement.setAttribute('data-input-coarse', ''));
    const input = searchbox(page);
    await input.fill('koltuk');
    expect((await rect(boxOf(input))).height).toBeGreaterThanOrEqual(47.5);
    const button = await rect(clearButton(page));
    expect(button.width).toBeGreaterThanOrEqual(47.5);
    expect(button.height).toBeGreaterThanOrEqual(47.5);
    expect(await fontSize(input)).toBeGreaterThanOrEqual(16);
  });

  test('klavye: Tab girdi → temizle, Shift+Tab geri, oklar girdide kalır, Enter/Space temizler ve odak girdiye döner; tek alt çizgi', async ({ page, browserName }) => {
    await openAdmin(page, '/alimlar');
    const input = searchbox(page);
    await input.fill('koltuk');
    const clear = clearButton(page);

    await input.focus();
    await page.keyboard.press(tabKey(browserName));
    await page.waitForFunction(() => document.documentElement.dataset.keyboard === 'true');
    await expect(clear).toBeFocused();
    expect(await focusRing(page)).toEqual([]);

    await page.keyboard.press(shiftTabKey(browserName));
    await expect(input).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
    const line = await boxOf(input).evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      return { content: after.content, height: parseFloat(after.height), width: parseFloat(after.width), inner: (el as HTMLElement).clientWidth };
    });
    expect(line.content).not.toBe('none');
    expect(line.height).toBeCloseTo(3, 1);
    expect(Math.abs(line.width - line.inner)).toBeLessThanOrEqual(1);

    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) await page.keyboard.press(key);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('koltuk');

    await page.keyboard.press(tabKey(browserName));
    await expect(clear).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(clear).toHaveCount(0);
    expect(await focusRing(page)).toEqual([]);

    await page.keyboard.type('masa');
    await expect(input).toHaveValue('masa');
    await page.keyboard.press(tabKey(browserName));
    await expect(clear).toBeFocused();
    await page.keyboard.press('Space');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
  });

  test('dokunma/işaretçi: pointercancel temizlemez, dokunuş temizler, odak girdiye döner, işaretçi modunda çizgi yok', async ({ page }) => {
    await openAdmin(page, '/alimlar');
    const input = searchbox(page);
    await input.fill('koltuk');
    const clear = clearButton(page);

    const touch = { pointerType: 'touch', pointerId: 11, isPrimary: true, bubbles: true };
    await clear.dispatchEvent('pointerdown', touch);
    await clear.dispatchEvent('pointercancel', touch);
    await expect(input).toHaveValue('koltuk');
    await expect(clear).toBeVisible();

    if (test.info().project.use.hasTouch) await clear.tap();
    else await clear.click();
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(clear).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.dataset.keyboard)).toBe('false');
    expect(await focusRing(page)).toEqual([]);
  });

  test('hareket: tek süre ve eğri; reduced-motion açıkken geçiş yok, durum anında', async ({ page }) => {
    await openAdmin(page, '/alimlar');
    const box = boxOf(searchbox(page));
    // Kök yalnız bu alan (temizle düğmesi dahil); sorgu çubuğundaki diğer bileşenler kendi görevlerinde ölçülür.
    const root = '[role="search"] .aile-textfield';
    await searchbox(page).fill('koltuk');
    await expect(clearButton(page)).toBeVisible();
    expect(await motion(page, undefined, undefined, { root })).toEqual([]);
    const normal = await box.evaluate((el) => ({ duration: getComputedStyle(el).transitionDuration, ease: getComputedStyle(el).transitionTimingFunction }));
    expect(normal.duration.split(',').map((part) => part.trim())).toEqual(['0.24s', '0.24s']);
    expect(normal.ease).toContain('cubic-bezier(0.65, 0, 0.35, 1)');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(clearButton(page)).toBeVisible();
    await expect(searchbox(page)).toHaveValue('koltuk');
    expect(await motion(page, undefined, undefined, { root, reduced: true })).toEqual([]);
    // Uzun el `transition-duration: 0s` listeyi tek değere indirir (tarayıcı listeyi özellik sayısına göre tekrarlar):
    // her süre 0 olmalı, liste uzunluğu değil.
    const reduced = await box.evaluate((el) => getComputedStyle(el).transitionDuration);
    const parts = reduced.split(',').map((part) => part.trim());
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(part).toBe('0s');
    // Durum anında: temizleyince düğme aynı karede kalkar, kutu geçişsiz.
    await clearButton(page).click();
    await expect(searchbox(page)).toHaveValue('');
    await expect(clearButton(page)).toHaveCount(0);
  });
});

test.describe('TextField: Ayarlar alanları', () => {
  test('yardım ve hata aria-describedby, aria-invalid; hata metni 14 px ve kesilmeden sarılır', { tag: '@matrix' }, async ({ page }) => {
    await openAdmin(page, '/ayarlar');
    const adres = page.getByRole('textbox', { name: 'Apps Script adresi' });
    await expect(adres).toBeVisible();
    await expect(adres).toHaveAccessibleDescription(/Yalnız bu tarayıcıda saklanır/);
    await expect(adres).not.toHaveAttribute('aria-invalid', 'true');
    await expect(fieldOf(adres).locator('label')).toBeVisible();

    await adres.fill('abc');
    await expect(adres).toHaveAttribute('aria-invalid', 'true');
    await expect(adres).toHaveAccessibleDescription(/^Hata: Adres /);
    const note = fieldOf(adres).locator('p', { hasText: /^Hata: Adres / });
    await expect(note).toBeVisible();
    const noteStyle = await note.evaluate((el) => {
      const style = getComputedStyle(el);
      return { size: parseFloat(style.fontSize), whiteSpace: style.whiteSpace, overflowing: el.scrollWidth > el.clientWidth + 1 };
    });
    expect(noteStyle.size).toBeGreaterThanOrEqual(14);
    expect(noteStyle.whiteSpace).toBe('normal');
    expect(noteStyle.overflowing).toBe(false);
    // Kenar rengi 240 ms geçişle hata rengine varır (anlık değil, ama son durum kesin).
    const hata = await boxOf(adres).evaluate((el) => {
      const probe = document.createElement('span');
      el.append(probe);
      probe.style.color = 'var(--aile-hata)';
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    await expect.poll(() => boxOf(adres).evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(hata);
    expect(await smallText(page, { root: 'main#admin-content' })).toEqual([]);
    expect(await horizontalOverflow(page)).toEqual([]);

    await adres.fill('');
    await expect(adres).not.toHaveAttribute('aria-invalid', 'true');

    const anahtar = page.getByLabel('Uygulama anahtarı');
    await expect(anahtar).toHaveAttribute('type', 'password');
    await expect(anahtar).toHaveAccessibleDescription(/Boş bırakılırsa anahtar silinir/);
  });

  test('sanal klavye: visualViewport küçülünce odaklı alan görünür alana kayar', async ({ page }) => {
    // Sanal klavye taklidi: görsel görünüm alanı (visualViewport) yüksekliği küçülür ve resize yayar.
    await page.addInitScript(() => {
      const fake = Object.assign(new EventTarget(), {
        width: window.innerWidth, height: window.innerHeight, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
      });
      Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
      (window as unknown as { __aileFakeViewport: typeof fake }).__aileFakeViewport = fake;
    });
    await openAdmin(page, '/ayarlar');
    // Alanın altında kaydırma payı olsun (gerçek klavyede de sayfa alttan uzar); yerleşim yalnız alttan büyür.
    await page.addStyleTag({ content: 'main#admin-content { padding-bottom: 100vh !important; }' });
    const anahtar = page.getByLabel('Uygulama anahtarı');
    const field = fieldOf(anahtar);
    await field.evaluate((el) => el.scrollIntoView({ block: 'end' }));
    const height = page.viewportSize()!.height;
    await anahtar.focus();
    await expect(anahtar).toBeFocused();

    const visible = Math.round(height * 0.45);
    await page.evaluate((next) => {
      const viewport = (window as unknown as { __aileFakeViewport: EventTarget & { height: number } }).__aileFakeViewport;
      viewport.height = next;
      viewport.dispatchEvent(new Event('resize'));
    }, visible);

    const placed = await field.evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
    expect(placed.bottom).toBeLessThanOrEqual(visible);
    expect(placed.top).toBeGreaterThanOrEqual(0);
    await expect(anahtar).toBeFocused();
  });
});
