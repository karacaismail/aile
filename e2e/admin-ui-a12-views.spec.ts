import { test, expect, type Page } from '@playwright/test';
import { accentEdges, focusRing, overflow, smallText } from './admin-detectors';
import { enterKeyboardMode, openAdmin } from './admin-helpers';

// a12 görünüm bileşenleri (ui/Kanban, ui/Timeline, ui/FilterArea) gerçek rotada: /alimlar Kanban ve Zaman çizelgesi
// modları; geniş testler telefon projelerinde 1280×800'e büyür. PivotStack gerçek rotada görünmez: sentetik nesilde
// "Pivot kullanılamaz: … sahipliği belirlenmiş toplanabilir ölçüsü yok" (birim testleri kapsar).
// Uyarlamalı teslim (W0): profil html[data-profile]'dan okunur (AdaptiveRoot), genişlikten tahmin edilmez. Telefonda Kanban duruma göre gruplu DİKEY liste (yatay kaydırma yok) ve
// geniş pano modülü (ui/wide/Kanban.wide.tsx) hiç istenmez; genişte aynı adlı bölge tembel gelen yatay pano ızgarasını
// taşır ve kendi içinde kayar. Dokunma hedefi 44 px, kaba işaretçide 48 px; metin ≥ 14 px; çevreleyen odak halkası yok
// (tek alt çizgi, yalnız klavye modunda); basılı durum Pointer Events ile, pointercancel siler; reduced-motion anlık.
// Yalnız sentetik nesil (playwright.admin.config webServer env). Emülasyon gerçek cihaz değildir.

const KANBAN = 'Duruma göre alımlar';
const WIDE_KANBAN = /\/ui\/wide\/Kanban\.wide\.(tsx|css)|\/assets\/wide-/;

async function profileOf(page: Page): Promise<string> {
  return (await page.evaluate(() => document.documentElement.dataset.profile)) ?? 'phone';
}

/** Etkin dokunma hedefi: kaba işaretçi katmanı açıksa 48, değilse 44 (CSS px). */
async function minTarget(page: Page): Promise<number> {
  return (await page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'))) ? 48 : 44;
}

/** Sayfa yüklenmeden istekleri toplar (ağ kanıtı). */
function collectRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', request => urls.push(request.url()));
  return urls;
}

test.describe('a12 › telefon: Kanban gruplu liste', () => {
  test('dikey gruplar, yatay taşma yok, geniş modül indirilmez; hedef ve metin ölçüleri', { tag: '@matrix' }, async ({ page }) => {
    const urls = collectRequests(page);
    await openAdmin(page, '/alimlar/?mod=kanban');
    test.skip((await profileOf(page)) !== 'phone', 'yalnız telefon profili');
    const region = page.getByRole('region', { name: KANBAN, exact: true });
    await expect(region).toHaveAttribute('data-gorunum', 'liste');
    await expect(region).not.toHaveAttribute('tabindex', /.*/);

    // Gruplar alt alta: her grup adlı bölge + h3; yatay kaydırma yok, sayfa taşmaz.
    const groups = region.getByRole('region');
    const count = await groups.count();
    expect(count).toBeGreaterThan(0);
    const boxes = [];
    for (let i = 0; i < count; i += 1) {
      await expect(groups.nth(i).getByRole('heading', { level: 3 })).toContainText(/\d+ kayıt/);
      boxes.push(await groups.nth(i).boundingBox());
    }
    for (let i = 1; i < boxes.length; i += 1) expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y + boxes[i - 1]!.height - 1);
    const scroll = await region.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(scroll.sw).toBeLessThanOrEqual(scroll.cw + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(await overflow(page, { root: '[data-gorunum="liste"]' })).toEqual([]);

    // Kartlar: 44/48 px hedef; metin ≥ 14 px; kavisli vurgu kenarı yok.
    const target = await minTarget(page);
    const cards = region.locator('[data-kanban-kayit]');
    expect(await cards.count()).toBeGreaterThan(0);
    for (const box of await cards.evaluateAll(els => els.slice(0, 8).map(el => el.getBoundingClientRect().toJSON() as DOMRect))) {
      expect(box.height).toBeGreaterThanOrEqual(target);
      expect(box.width).toBeGreaterThanOrEqual(target);
    }
    expect(await smallText(page, { root: '[data-gorunum="liste"]', min: 14 })).toEqual([]);
    expect(await accentEdges(page, { root: '[data-gorunum="liste"]' })).toEqual([]);

    // Ağ kanıtı: telefon profili geniş pano modülünü hiç istemez.
    expect(urls.filter(url => WIDE_KANBAN.test(url))).toEqual([]);
  });

  test('Pointer Events: basılı durum, pointercancel (kaydırma) siler; klavye Tab/Shift+Tab ve tek alt çizgi', async ({ page, browserName }) => {
    await openAdmin(page, '/alimlar/?mod=kanban');
    test.skip((await profileOf(page)) !== 'phone', 'yalnız telefon profili');
    const region = page.getByRole('region', { name: KANBAN, exact: true });
    const first = region.locator('[data-kanban-kayit]').first();
    const second = region.locator('[data-kanban-kayit]').nth(1);
    const url = page.url();

    await first.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0, pointerId: 7 });
    await expect(first).toHaveAttribute('data-pressed', 'true');
    await first.dispatchEvent('pointercancel', { pointerType: 'touch', isPrimary: true, pointerId: 7 });
    await expect(first).not.toHaveAttribute('data-pressed', /.*/);
    expect(page.url()).toBe(url);

    await enterKeyboardMode(page, browserName);
    await first.focus();
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(second).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
    await expect(first).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
  });

  test('reduced-motion: kart geçişi anlık (durum yine anında)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAdmin(page, '/alimlar/?mod=kanban');
    const card = page.getByRole('region', { name: KANBAN, exact: true }).locator('[data-kanban-kayit]').first();
    expect(await card.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await card.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0.24s');
    expect(await card.evaluate(el => getComputedStyle(el).transitionTimingFunction)).toBe('cubic-bezier(0.65, 0, 0.35, 1)');
  });
});

test.describe('a12 › telefon: Zaman çizelgesi', () => {
  test('ay başlığı h3 + kayıt sayısı, "Tarihi bilinmiyor" sonda; hedef, metin ve taşma', { tag: '@matrix' }, async ({ page }) => {
    await openAdmin(page, '/alimlar/?mod=timeline');
    test.skip((await profileOf(page)) !== 'phone', 'yalnız telefon profili');
    const root = page.locator('.aile-tl');
    await expect(root).toHaveAttribute('data-narrow', 'true');
    const headings = root.getByRole('heading', { level: 3 });
    const texts = await headings.allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).toMatch(/^(\S+ \d{4}|Tarihi bilinmiyor) \d+ kayıt$/);
    const undated = texts.findIndex(text => text.startsWith('Tarihi bilinmiyor'));
    if (undated >= 0) expect(undated).toBe(texts.length - 1);

    const target = await minTarget(page);
    for (const box of await root.locator('.aile-tl-body').evaluateAll(els => els.slice(0, 8).map(el => el.getBoundingClientRect().toJSON() as DOMRect))) {
      expect(box.height).toBeGreaterThanOrEqual(target);
    }
    expect(await smallText(page, { root: '.aile-tl', min: 14 })).toEqual([]);
    expect(await overflow(page, { root: '.aile-tl' })).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

/** Telefon projelerinde (320/390) geniş testleri masaüstü görünümünde koşar; tablet/masaüstü projeleri kendi ölçüsünde. */
async function wideViewport(page: Page) {
  const size = page.viewportSize();
  if (size && size.width < 600) await page.setViewportSize({ width: 1280, height: 800 });
}

test.describe('a12 › geniş: tembel Kanban panosu ve filtre şeridi', () => {
  test('aynı adlı bölge yatay pano ızgarasını tembel yükler; kendi içinde kayar, sayfa kaymaz; klavyeyle kaydırılır', { tag: '@matrix' }, async ({ page, browserName }) => {
    await wideViewport(page);
    const urls = collectRequests(page);
    await openAdmin(page, '/alimlar/?mod=kanban');
    test.skip((await profileOf(page)) === 'phone', 'yalnız geniş profil');
    const region = page.getByRole('region', { name: KANBAN, exact: true });
    await expect(region).toHaveAttribute('data-gorunum', 'pano');
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(region.locator('[data-kanban-izgara]')).toBeVisible();
    expect(urls.some(url => WIDE_KANBAN.test(url))).toBe(true);

    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const scroll = await region.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    if (scroll.sw > scroll.cw + 1) {
      await enterKeyboardMode(page, browserName);
      await region.focus();
      const before = await region.evaluate(el => el.scrollLeft);
      // İnsan basışı kadar (100 ms) basılı tutulur: WebKit'in yumuşak klavye kaydırması keydown'la başlar; aynı anda
      // gelen keyup hareketi ilk karesinden önce kesebiliyor (0 ms basışta WebKit'te ara sıra kayma yok).
      await page.keyboard.press('ArrowRight', { delay: 100 });
      await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(before);
    }
    expect(await smallText(page, { root: '[data-kanban-izgara]', min: 14 })).toEqual([]);
    expect(await accentEdges(page, { root: '[data-kanban-izgara]' })).toEqual([]);
  });

  test('pano kaydırma bölgesi klavye odağında tek alt çizgi taşır (kırpılmaz); karttaki odakta bölge çizgisi yok; işaretçide yok', { tag: '@matrix' }, async ({ page, browserName }) => {
    await wideViewport(page);
    await openAdmin(page, '/alimlar/?mod=kanban');
    test.skip((await profileOf(page)) === 'phone', 'yalnız geniş profil');
    const region = page.getByRole('region', { name: KANBAN, exact: true });
    await expect(region.locator('[data-kanban-izgara]')).toBeVisible();
    const regionLine = () => region.evaluate(el => {
      const after = getComputedStyle(el, '::after');
      const box = el.getBoundingClientRect();
      // Çizginin ortası bölgenin altında görünür mü (kaydırma alanı kırpmıyor mu): o noktadaki en üst öğe bölge değil,
      // çizgi bölgenin dışında çizilir; ölçü olarak sözde öğenin konumu ve boyu okunur.
      return { content: after.content, height: after.height, bottom: after.bottom, width: after.width, regionWidth: box.width };
    });

    // İşaretçi modunda odak: çizgi yok.
    await region.focus();
    expect((await regionLine()).content).toMatch(/^(none|normal)$/);

    // Klavye modu: bölge sekme durağı; tek 3 px çizgi bölgenin 4 px altında, bölge genişliğinde; halka yok.
    await enterKeyboardMode(page, browserName);
    await region.evaluate(el => (el as HTMLElement).blur());
    await region.focus();
    expect(await focusRing(page)).toEqual([]);
    const line = await regionLine();
    expect(line.height).toBe('3px');
    expect(line.bottom).toBe('-7px');
    expect(Math.abs(parseFloat(line.width) - line.regionWidth)).toBeLessThanOrEqual(1);

    // Kaydırma bölgesi çizgiyi kırpmaz: çizgi, bölgenin kaydırılabilir taşmasına da katılmaz (dikey kaydırma doğmaz).
    expect(await region.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);

    // Karttaki odakta tek gösterge kartın kendisidir; bölge çizgisi görünmez.
    const card = region.locator('[data-kanban-kayit]').first();
    await card.focus();
    expect(await focusRing(page)).toEqual([]);
    expect((await regionLine()).content).toMatch(/^(none|normal)$/);
  });

  test('masaüstünde Kanban filtre şeridiyle başlar: 56 px şerit → panel, odak "Paneli gizle"ye; gizle → şerit', { tag: '@matrix' }, async ({ page }) => {
    await wideViewport(page);
    await openAdmin(page, '/alimlar/?mod=kanban');
    test.skip((await profileOf(page)) !== 'desktop', 'yalnız masaüstü profili');
    const rail = page.getByRole('button', { name: /^Filtreleri göster/ });
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute('aria-expanded', 'false');
    const box = await rail.boundingBox();
    expect(Math.round(box!.width)).toBe(56);
    expect(box!.height).toBeGreaterThanOrEqual(await minTarget(page));
    await rail.click();
    const hide = page.getByRole('button', { name: 'Paneli gizle' });
    await expect(hide).toBeFocused();
    await hide.click();
    await expect(page.getByRole('button', { name: /^Filtreleri göster/ })).toBeFocused();
  });
});
