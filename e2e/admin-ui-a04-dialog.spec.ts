import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { accentEdges, focusRing, motion, smallText } from './admin-detectors';
import { enterKeyboardMode, horizontalOverflow, openAdmin, shiftTabKey, tabKey } from './admin-helpers';

// a04 Dialog (src/admin/ui/Dialog.tsx) gerçek rotalarda: Hesaplar › "Hesap ekle" (bilgi diyaloğu, yalnız Kapat) ve
// Sözlükler › "Terim ekle" (form + FormFooter). Telefon profili (html[data-profile="phone"]): alttan açılan yerel alt
// sayfa; tablet/masaüstü: ortalı, en çok 560 px panel. Testler profile göre beklenti kurar; @matrix etiketliler
// entegrasyonda 360/375/320×480/568×320/tablet/masaüstü projelerinde de koşar. Emülasyon gerçek cihaz değildir:
// dokunma Playwright touchscreen'i, sanal klavye visualViewport benzetimidir. Veri yalnız sentetik nesil (webServer);
// Google'a istek yok (route ile kesilir).

const MOTION_EASE = 'cubic-bezier(.65,0,.35,1)';
const MOTION_MS = 240;
const DIALOG_MAX = 560;
const ROOT = '.aile-dialog';

test.beforeEach(async ({ page }) => {
  await page.route(/https?:\/\/([^/]+\.)?(google|googleapis|gstatic|googleusercontent)\.com\//, route => route.abort());
});

const profileOf = (page: Page) => page.locator('html').getAttribute('data-profile');
const coarseOf = async (page: Page) => (await page.locator('html').getAttribute('data-input-coarse')) !== null;
const activeInside = (dialog: Locator) => dialog.evaluate(node => node.contains(document.activeElement));
const activeTag = (page: Page) => page.evaluate(() => {
  const active = document.activeElement;
  return active ? `${active.tagName.toLowerCase()}:${(active.getAttribute('aria-label') || active.textContent || '').trim()}` : '';
});

async function openHesapEkle(page: Page) {
  const main = await openAdmin(page, '/hesaplar');
  const opener = main.getByRole('button', { name: 'Hesap ekle' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Hesap ekle' });
  await expect(dialog).toBeVisible();
  return { main, opener, dialog };
}

/** Diyalog dışı bir nokta (sol üst köşe her iki sunumda da örtüdür): dokunmatik projede tap, değilse fare tıklaması. */
async function pressOutside(page: Page, info: TestInfo) {
  if (info.project.use.hasTouch) await page.touchscreen.tap(8, 8);
  else await page.mouse.click(8, 8);
}

/** Açılış hareketinin bitmesini bekler (panelin dönüşümü durağan). */
async function settled(page: Page) {
  await page.waitForFunction(selector => {
    const root = document.querySelector(selector);
    return !!root && root.getAnimations({ subtree: true }).every(animation => animation.playState === 'finished');
  }, ROOT);
}

test('@matrix sunum profile göre: telefonda alt sayfa, genişte ortalı panel; ilk odak başlık, arka plan inert, kaydırma kilitli, hedef ve metin ölçüleri', async ({ page }, info) => {
  const { opener, dialog } = await openHesapEkle(page);
  const profile = await profileOf(page);
  const viewport = page.viewportSize()!;
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  const heading = dialog.getByRole('heading', { level: 2, name: 'Hesap ekle' });
  await expect(heading).toBeFocused();
  await settled(page);

  const box = (await dialog.boundingBox())!;
  const close = dialog.getByRole('button', { name: 'Kapat' });
  if (profile === 'phone') {
    // Alt sayfa: alta yaslı, tam genişlik, en çok %85 yükseklik; görünür "Kapat" metni.
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(viewport.height * 0.85 + 1);
    await expect(close).toHaveText('Kapat');
  } else {
    // Ortalı panel: en çok 560 px, yatay ve dikey ortada; simgeli Kapat (aria-label).
    expect(box.width).toBeLessThanOrEqual(DIALOG_MAX + 0.5);
    expect(Math.abs(box.x - (viewport.width - box.x - box.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - (viewport.height - box.y - box.height))).toBeLessThanOrEqual(1);
    await expect(close).toHaveAttribute('aria-label', 'Kapat');
    await expect(close).toHaveText('');
  }

  // Dokunma hedefi: 44 px; kaba giriş katmanı açıksa 48 px.
  const target = (await close.boundingBox())!;
  const minimum = (await coarseOf(page)) ? 48 : 44;
  expect(target.width).toBeGreaterThanOrEqual(minimum - 0.5);
  expect(target.height).toBeGreaterThanOrEqual(minimum - 0.5);

  // Arka plan inert, sayfa kaydırması kilitli; diyalog kökü inert değil.
  await expect(page.locator('#admin-root')).toHaveAttribute('inert', '');
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  expect(await dialog.evaluate(node => node.closest('[inert]') === null)).toBe(true);
  // Gerçek kaydırma denemesi: örtü üzerinde tekerlek sayfayı kaydırmaz (sayfa kaydırılabilirse).
  const scrollTop = () => page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollTop);
  const scrollable = await page.evaluate(() => {
    const scroller = document.scrollingElement ?? document.documentElement;
    return scroller.scrollHeight > scroller.clientHeight + 1;
  });
  if (scrollable) {
    const before = await scrollTop();
    await page.mouse.move(Math.round(viewport.width / 2), 4);
    await page.mouse.wheel(0, 600);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
    expect(await scrollTop()).toBe(before);
  }

  // Kurallar: metin ≥ 14 px, kavisli vurgu kenarı yok, sayfa yatay taşmaz.
  expect(await smallText(page, { root: ROOT })).toEqual([]);
  expect(await accentEdges(page, { root: ROOT })).toEqual([]);
  expect(await horizontalOverflow(page)).toEqual([]);

  // Dışarı dokunma: telefonda örtü kapatır, genişte kapatmaz (Escape kapatır). İkisinde de odak açan düğmeye döner.
  await pressOutside(page, info);
  if (profile === 'phone') await expect(dialog).toBeHidden();
  else {
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
  await expect(opener).toBeFocused();
  await expect(page.locator('#admin-root')).not.toHaveAttribute('inert', '');
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
});

test('klavye: Enter açar, başlıkta tek alt çizgi; Tab/Shift+Tab içeride döner; Escape kapatır, odak ve gösterge açan düğmede', async ({ page, browserName }) => {
  const main = await openAdmin(page, '/hesaplar');
  await enterKeyboardMode(page, browserName);
  const opener = main.getByRole('button', { name: 'Hesap ekle' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Hesap ekle' });
  await expect(dialog).toBeVisible();
  const heading = dialog.getByRole('heading', { level: 2, name: 'Hesap ekle' });
  await expect(heading).toBeFocused();
  await settled(page);
  expect(await focusRing(page), 'başlıkta görünür, çevrelemeyen gösterge').toEqual([]);

  const close = dialog.getByRole('button', { name: 'Kapat' });
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(tabKey(browserName));
    await expect(close).toBeFocused();
    expect(await activeInside(dialog)).toBe(true);
    expect(await focusRing(page)).toEqual([]);
  }
  await page.keyboard.press(shiftTabKey(browserName));
  await expect(close).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
  expect(await focusRing(page), 'dönüş odağında gösterge korunur').toEqual([]);
});

test('işaretçi modunda açılışta odak göstergesi görünmez; Kapat düğmesi kapatır', async ({ page }) => {
  const { opener, dialog } = await openHesapEkle(page);
  await settled(page);
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'false');
  expect(await activeTag(page)).toBe('h2:Hesap ekle');
  expect(await focusRing(page, { keyboard: false })).toEqual([]);
  await dialog.getByRole('button', { name: 'Kapat' }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Pointer Events: örtüde pointercancel sonrası click kapatmaz; telefonda tam basış kapatır', async ({ page }) => {
  const { dialog } = await openHesapEkle(page);
  const profile = await profileOf(page);
  const fire = (kinds: string[]) => page.evaluate(sequence => {
    const scrim = document.querySelector('.aile-dialog-ortu')!;
    for (const kind of sequence) {
      if (kind === 'click') (scrim as HTMLElement).click();
      else scrim.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, isPrimary: true, button: 0, pointerId: 11, pointerType: 'touch' }));
    }
  }, kinds);
  await fire(['pointerdown', 'pointercancel', 'click']);
  await expect(dialog).toBeVisible();
  await fire(['pointerdown', 'pointerup', 'click']);
  if (profile === 'phone') await expect(dialog).toBeHidden();
  else await expect(dialog).toBeVisible();
});

test('@matrix sanal klavye benzetimi (visualViewport): form eylemleri ve odaklı alan görünür kalır', async ({ page }) => {
  const main = await openAdmin(page, '/sozlukler');
  const opener = main.getByRole('button', { name: 'Terim ekle' });
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Terim ekle' });
  await expect(dialog).toBeVisible();
  await settled(page);
  const field = dialog.getByRole('textbox', { name: /Terim adı/ });
  await field.focus();

  // Klavye yüksekliği: görünüm yüksekliğinin %45'i (telefon klavyesi tipik oranı); yalnız görsel görünüm küçülür.
  const visible = await page.evaluate(() => {
    const viewport = window.visualViewport!;
    const height = Math.round(window.innerHeight * 0.55);
    Object.defineProperty(viewport, 'height', { configurable: true, get: () => height });
    viewport.dispatchEvent(new Event('resize'));
    return height;
  });
  await expect(page.locator(ROOT)).toHaveAttribute('data-klavye', 'acik');
  const save = dialog.getByRole('button', { name: 'Öneri olarak kaydet' });
  const saveBox = (await save.boundingBox())!;
  expect(saveBox.y).toBeGreaterThanOrEqual(0);
  expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(visible + 1);
  const fieldBox = (await field.boundingBox())!;
  const panelBox = (await dialog.boundingBox())!;
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(visible + 1);
  expect(fieldBox.y).toBeGreaterThanOrEqual(panelBox.y - 1);
  expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(visible + 1);
  await expect(field).toBeFocused();

  // Klavye kapanınca kök tam görünüme döner.
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    delete (viewport as { height?: number }).height;
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator(ROOT)).not.toHaveAttribute('data-klavye', 'acik');
});

test('hareket: açılış ve kapanış 240 ms tek eğri; kapanışta rol anında kalkar, kopya hareket sonunda silinir', async ({ page }) => {
  const { opener, dialog } = await openHesapEkle(page);
  await settled(page);
  expect(await motion(page, MOTION_EASE, MOTION_MS, { root: ROOT })).toEqual([]);
  const panelTransition = await dialog.evaluate(node => getComputedStyle(node).transitionDuration);
  expect(panelTransition.split(',').map(value => value.trim())).toContain('0.24s');
  // Kapanış kopyasını eklendiği anda kaydet (240 ms'lik pencereyle yarışmadan).
  await page.evaluate(selector => {
    const store = window as unknown as { __dialogGhosts: Array<Record<string, unknown>> };
    store.__dialogGhosts = [];
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof HTMLElement) || !node.matches(selector)) continue;
          const panel = node.querySelector('.aile-dialog-panel')!;
          store.__dialogGhosts.push({
            state: node.dataset.state, hidden: node.getAttribute('aria-hidden'), inert: node.hasAttribute('inert'),
            ids: node.querySelectorAll('[id]').length, transitions: panel.getAnimations().length,
            duration: getComputedStyle(panel).transitionDuration, easing: getComputedStyle(panel).transitionTimingFunction,
          });
        }
      }
    }).observe(document.body, { childList: true });
  }, ROOT);
  await page.keyboard.press('Escape');
  // Anlamsal durum anında: rol yok, odak döndü, arka plan serbest.
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 100 });
  await expect(opener).toBeFocused({ timeout: 100 });
  await expect(page.locator('#admin-root')).not.toHaveAttribute('inert', '', { timeout: 100 });
  // Sunum: kapanan kopya aria-hidden + inert, kimliksiz, 240 ms tek eğriyle kapanır; hareket bitince silinir.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __dialogGhosts: unknown[] }).__dialogGhosts.length)).toBe(1);
  const [ghost] = await page.evaluate(() => (window as unknown as { __dialogGhosts: Array<Record<string, unknown>> }).__dialogGhosts);
  expect(ghost).toMatchObject({ state: 'closing', hidden: 'true', inert: true, ids: 0 });
  expect(ghost.transitions).toBeGreaterThan(0);
  expect(String(ghost.duration).split(',').map(value => value.trim())).toContain('0.24s');
  expect(String(ghost.easing)).toContain('cubic-bezier(0.65, 0, 0.35, 1)');
  await expect(page.locator(ROOT)).toHaveCount(0);
});

test('reduced-motion: geçiş yok, durum anında; kapanışta kopya yok', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { opener, dialog } = await openHesapEkle(page);
  expect(await dialog.evaluate(node => getComputedStyle(node).transitionDuration.split(',').every(value => parseFloat(value) === 0))).toBe(true);
  expect(await motion(page, MOTION_EASE, MOTION_MS, { root: ROOT, reduced: true })).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator(ROOT)).toHaveCount(0, { timeout: 100 });
  await expect(opener).toBeFocused();
});

test('hızlı aç-kapa: iz kalmaz (inert, kaydırma kilidi, katman)', async ({ page }) => {
  const main = await openAdmin(page, '/hesaplar');
  const opener = main.getByRole('button', { name: 'Hesap ekle' });
  for (let i = 0; i < 3; i++) {
    await opener.click();
    await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#admin-root')).not.toHaveAttribute('inert', '');
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
  await expect(page.locator(ROOT)).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('iç içe katman: diyalogdaki Sözlük seçimi açılır ve seçilir; diyalog açık kalır, sonra Escape diyaloğu kapatır', async ({ page }) => {
  const main = await openAdmin(page, '/sozlukler');
  const opener = main.getByRole('button', { name: 'Terim ekle' });
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Terim ekle' });
  await expect(dialog).toBeVisible();
  await settled(page);
  const combo = dialog.getByRole('combobox', { name: 'Sözlük' });
  // APG: açık açılır listede Escape yalnız listeyi kapatır; diyalog açık kalır (en üstteki katman önce).
  await combo.click();
  await expect(page.getByRole('option').filter({ visible: true }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option').filter({ visible: true })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await combo.click();
  // Görünür seçenekler (antd'nin sıfır boyutlu erişilebilirlik listesi sayılmaz; yerel liste de aynı rolü taşır).
  const options = page.getByRole('option').filter({ visible: true });
  await expect(options.first()).toBeVisible();
  // Açılış hareketi sürerken görünür sayısı değişebilir: eşik aynı, yalnız durağanlaşması beklenir.
  await expect.poll(() => options.count()).toBeGreaterThan(1);
  // Seçili olmayan ilk seçenek: seçim diyaloğun üstünde açılan katmandan yapılır (arka plan inert'i ona dokunmaz).
  const choice = options.and(page.locator(':not([aria-selected="true"])')).first();
  const picked = ((await choice.getAttribute('aria-label')) ?? (await choice.innerText())).trim();
  await choice.click();
  await expect(options).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(picked);
  // Seçim katmanı kapandı; Escape şimdi diyaloğu kapatır ve odak açan düğmeye döner.
  await dialog.getByRole('textbox', { name: /Terim adı/ }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.locator('#admin-root')).not.toHaveAttribute('inert', '');
});
