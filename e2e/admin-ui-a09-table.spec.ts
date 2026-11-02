import { test, expect, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accentEdges, focusRing, motion, overflow, smallText } from './admin-detectors';
import { enterKeyboardMode, horizontalOverflow, openAdmin } from './admin-helpers';

// a09-table: ResponsiveTable / Table / AccordionList gerçek rotalarda (Ödemeler, Bütçe). Telefon (chromium 320×568,
// webkit 390×844; @matrix ile 360/375/320×480/568×320) akordeondur: ilk satır açık, başlık düğmesi aria-expanded,
// etiket–değer çiftleri, uzun adlar kelime arasından sarılır. Geniş profil (setViewportSize 1024) yerel <table>:
// kendi kapsayıcısında kayar (taşarken tabindex=0 + caption adlı grup, klavyeyle kayar), ilk sütun yapışkan, başlık ve ilk
// sütun kelime ortasından bölünmez, sayfa yatay taşmaz. Veri: sentetik nesil (dev sunucusu); uzun adlar yalnız bu
// testte forecast_events parçalarına eklenir ve manifest hash'leri yeniden hesaplanır (nesil bütünlük denetimi geçer).
// Canlı GViz kesilir. Emülasyon gerçek cihaz değildir.

const SABIT_AN = new Date('2027-02-18T09:00:00+03:00');
const AKORDEON = '[data-layout="accordion"]';
const UZUN_AD = 'Mutfak tezgâhı DocType Template Proposal yenileme teklifi ve montaj bedeli';
const ODEMELER_TABLO = 'Tahmini ödemeler';
const BUTCE_TABLO = 'Bütçe kalemleri';
const ODAK_RENGI = 'rgb(50, 107, 148)'; // designTokens.odak (#326B94)
const EGRI = 'cubic-bezier(.65,0,.35,1)';

const FIXTURE_KOKU = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));

interface UzunAdliNesil { manifest: string; parcalar: Map<string, string> }
let uzunAdliNesilOnbellek: Promise<UzunAdliNesil> | undefined;

/** Sentetik nesil + uzun adlar: forecast_events parçalarında her ikinci etiketin önüne UZUN_AD; manifest sha256'ları
 *  değişen parçalar için yeniden yazılır. Gerçek veri okunmaz (yalnız fixtures/generation-synthetic). */
function uzunAdliNesil(): Promise<UzunAdliNesil> {
  uzunAdliNesilOnbellek ??= (async () => {
    const ad = (await readdir(FIXTURE_KOKU, { withFileTypes: true })).find(g => g.isDirectory() && /^[a-f0-9]{64}$/.test(g.name))?.name;
    if (!ad) throw new Error('fixtures/generation-synthetic altında nesil klasörü yok');
    const kok = path.join(FIXTURE_KOKU, ad);
    const manifest = JSON.parse(await readFile(path.join(kok, 'manifest.json'), 'utf8')) as { files: { path: string; sha256: string; collection?: string }[] };
    const parcalar = new Map<string, string>();
    for (const dosya of manifest.files) {
      if (dosya.collection !== 'forecast_events' || !dosya.path.startsWith('data/')) continue;
      const govde = JSON.parse(await readFile(path.join(kok, dosya.path), 'utf8')) as { records?: { label?: unknown }[] };
      for (const [i, kayit] of (govde.records ?? []).entries()) {
        if (i % 2 === 0 && typeof kayit.label === 'string') kayit.label = `${UZUN_AD} ${kayit.label}`;
      }
      const metin = JSON.stringify(govde);
      dosya.sha256 = createHash('sha256').update(metin, 'utf8').digest('hex');
      parcalar.set(dosya.path, metin);
    }
    if (parcalar.size === 0) throw new Error('forecast_events parçası yok');
    return { manifest: JSON.stringify(manifest), parcalar };
  })();
  return uzunAdliNesilOnbellek;
}

async function hazirla(page: Page, { uzunAd = false }: { uzunAd?: boolean } = {}) {
  await page.clock.setFixedTime(SABIT_AN);
  await page.route(/^https:\/\/docs\.google\.com\//, route => route.abort());
  if (uzunAd) {
    const nesil = await uzunAdliNesil();
    const json = 'application/json; charset=utf-8';
    await page.route('**/__aile/generation/manifest.json', route => route.fulfill({ status: 200, contentType: json, body: nesil.manifest }));
    await page.route('**/__aile/generation/data/forecast_events/**', route => {
      const yol = decodeURIComponent(new URL(route.request().url()).pathname.split('/__aile/generation/')[1] ?? '');
      const govde = nesil.parcalar.get(yol);
      return govde === undefined ? route.fallback() : route.fulfill({ status: 200, contentType: json, body: govde });
    });
  }
}

async function telefonAkordeonu(page: Page, rota: '/odemeler' | '/butce', secenek: { uzunAd?: boolean } = {}): Promise<Locator> {
  await hazirla(page, secenek);
  await openAdmin(page, rota);
  const alan = page.locator(AKORDEON);
  await expect(alan).toHaveCount(1);
  return alan;
}

async function genisTablo(page: Page, rota: '/odemeler' | '/butce', ad: string, secenek: { uzunAd?: boolean } = {}): Promise<Locator> {
  await page.setViewportSize({ width: 1024, height: 768 });
  await hazirla(page, secenek);
  await openAdmin(page, rota);
  // Taşan kaydırma kabı caption adlı gruptur (landmark değil) ve sekme sırasındadır.
  const bolge = page.getByRole('group', { name: ad });
  await expect(bolge).toHaveCount(1);
  await expect(bolge.getByRole('table', { name: ad })).toHaveCount(1);
  return bolge;
}

// #region tarayıcı içi ölçümler (dış kapsam yok)

/** Kelime parçası (boşluk ve tire arası) iki satıra bölünmüşse ihlal. Tire ve boşluk doğal sarma noktasıdır. */
function bolunenKelimeler(kok: Element, secici: string): string[] {
  const ihlaller: string[] = [];
  for (const el of Array.from(kok.querySelectorAll(secici))) {
    const yuruyucu = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let dugum = yuruyucu.nextNode(); dugum; dugum = yuruyucu.nextNode()) {
      const metin = dugum.textContent ?? '';
      for (const eslesme of metin.matchAll(/[^\s\-–—]+/g)) {
        const aralik = document.createRange();
        aralik.setStart(dugum, eslesme.index ?? 0);
        aralik.setEnd(dugum, (eslesme.index ?? 0) + eslesme[0].length);
        const satirlar = new Set(Array.from(aralik.getClientRects()).filter(r => r.width > 0).map(r => Math.round(r.bottom)));
        if (satirlar.size > 1) ihlaller.push(`"${eslesme[0]}" ${satirlar.size} satıra bölündü (${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ')[0]})`);
      }
    }
  }
  return ihlaller.slice(0, 10);
}

/** Sarılan (birden çok satırlı) öğe sayısı: uzun ad senaryosunun gerçekten sınandığının kanıtı. */
function sarilanSayisi(kok: Element, secici: string): number {
  return Array.from(kok.querySelectorAll(secici)).filter(el => {
    const satir = parseFloat(getComputedStyle(el).lineHeight) || 24;
    return el.getBoundingClientRect().height > satir * 1.5;
  }).length;
}

/** Kapsayıcı ve ilk sütun özeti. */
function tabloOzeti(bolge: Element) {
  const kaydirici = bolge as HTMLElement;
  const satir = (sec: string) => Array.from(bolge.querySelectorAll(sec)).find(tr => tr.children.length > 1) as HTMLTableRowElement | undefined;
  const baslik = satir('thead tr');
  const govde = satir('tbody tr');
  const stil = (el: Element | undefined) => (el ? getComputedStyle(el) : null);
  return {
    tasiyor: kaydirici.scrollWidth > kaydirici.clientWidth + 1,
    tabindex: kaydirici.getAttribute('tabindex'),
    overflowX: getComputedStyle(kaydirici).overflowX,
    tabloSayisi: bolge.querySelectorAll('table').length,
    ilkBaslik: stil(baslik?.children[0])?.position,
    ikinciBaslik: stil(baslik?.children[1])?.position,
    ilkHucre: stil(govde?.children[0])?.position,
    ikinciHucre: stil(govde?.children[1])?.position,
    ilkHucreKirma: [stil(govde?.children[0])?.wordBreak, stil(govde?.children[0])?.overflowWrap],
    ilkBaslikKirma: [stil(baslik?.children[0])?.wordBreak, stil(baslik?.children[0])?.overflowWrap],
    belgeTasiyor: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    /** Her başlık hücresinin genişliği satır içi min-width'ten az değil. */
    darBasliklar: Array.from(bolge.querySelectorAll('thead th')).flatMap(th => {
      const min = parseFloat((th as HTMLElement).style.minWidth);
      const en = th.getBoundingClientRect().width;
      return Number.isFinite(min) && en + 0.5 < min ? [`${th.textContent}: ${Math.round(en)} < ${min}`] : [];
    }),
  };
}

/** Odaklı akordeon başlığının alt çizgisi (başlık metninin altında). */
function basliktakiCizgi(dugme: Element) {
  const cizgiSahibi = dugme.querySelector('.aile-acc-ul');
  if (!cizgiSahibi) return null;
  const after = getComputedStyle(cizgiSahibi, '::after');
  const ds = getComputedStyle(dugme);
  return {
    opacity: after.opacity,
    height: after.height,
    bottom: after.bottom,
    renk: after.backgroundColor,
    outline: `${ds.outlineStyle} ${ds.outlineWidth}`,
    boxShadow: ds.boxShadow,
  };
}
// #endregion

const telefonmu = (en: number | undefined) => (en ?? 0) < 600;

// --- Telefon: akordeon ------------------------------------------------------------------------------------------

test.describe('telefon akordeon (ResponsiveTable → AccordionList)', () => {
  test.beforeEach(({ page }) => {
    test.skip(!telefonmu(page.viewportSize()?.width), 'telefon kuralı: 600 px altı projeler (chromium, webkit, @matrix telefonlar)');
  });

  test('ilk satır açık, başlık düğmesi aria-expanded, etiket–değer çiftleri; uzun adlar kelime arasından sarılır; taşma yok', { tag: '@matrix' }, async ({ page }) => {
    const alan = await telefonAkordeonu(page, '/odemeler', { uzunAd: true });
    await expect(page.getByRole('table', { name: ODEMELER_TABLO })).toHaveCount(0);
    const basliklar = alan.locator('button[aria-expanded]');
    await expect(basliklar.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(alan.locator('button[aria-expanded="true"]')).toHaveCount(1);

    const panelKimligi = await basliklar.first().getAttribute('aria-controls');
    const panel = page.locator(`[id="${panelKimligi}"]`);
    await expect(panel).toBeVisible();
    const ciftler = await panel.evaluate(p => Array.from(p.querySelectorAll('dl > div')).map(d => [d.querySelector('dt')?.textContent ?? '', d.querySelector('dd')?.textContent ?? '']));
    expect(ciftler.length).toBeGreaterThan(0);
    for (const [etiket, deger] of ciftler) {
      expect(etiket, 'etiket boş').not.toBe('');
      expect(deger, `${etiket}: değer boş (eksik bilgi adıyla yazılmalı)`).not.toBe('');
    }
    expect(ciftler.map(([etiket]) => etiket)).toContain('Gerçekleşen');

    // Uzun adlar gerçekten sarıldı ve hiçbir kelime ortasından bölünmedi.
    await expect(alan.getByText(UZUN_AD, { exact: false }).first()).toBeVisible();
    expect(await alan.evaluate(sarilanSayisi, '.aile-acc-title')).toBeGreaterThan(0);
    expect(await alan.evaluate(bolunenKelimeler, '.aile-acc-title, .aile-acc-meta, .aile-acc-dl dt, .aile-acc-dl dd, .aile-acc-gtitle, .aile-acc-bar-metin')).toEqual([]);
    // Başlık sütunu kendi alanında kalır (lead ve ok kutusunun üstüne taşmaz).
    const tasanBaslik = await alan.evaluate(kok =>
      Array.from(kok.querySelectorAll('.aile-acc-main')).flatMap(ana => {
        if (ana.scrollWidth <= ana.clientWidth + 1) return [];
        const sag = ana.getBoundingClientRect().right;
        const tasan = Array.from(ana.querySelectorAll('*')).filter(el => el.getBoundingClientRect().right > sag + 1);
        return [`${ana.scrollWidth}>${ana.clientWidth}: ${tasan.map(el => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ')[0]} "${(el.textContent ?? '').slice(0, 40)}" ${Math.round(el.getBoundingClientRect().width)}px`).slice(0, 3).join(' | ')}`];
      }));
    expect(tasanBaslik, 'başlık sütunundan taşan öğe').toEqual([]);

    expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
    expect(await overflow(page), 'taşma ve kesilen metin').toEqual([]);
    expect(await smallText(page, { root: AKORDEON }), '14 px alt sınır').toEqual([]);
    expect(await accentEdges(page, { root: AKORDEON }), 'radiuslu kutuda kenar şeridi').toEqual([]);
  });

  test('dokunma hedefi: satır başlıkları en az 44 px, kaba girişte 48 px; "Tümünü aç" en az 44 px', { tag: '@matrix' }, async ({ page }) => {
    const alan = await telefonAkordeonu(page, '/odemeler');
    const kaba = await page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'));
    const asgari = kaba ? 48 : 44;
    const olculer = await alan.locator('button[aria-expanded]').evaluateAll(dugmeler =>
      dugmeler.map(d => { const r = d.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    expect(olculer.length).toBeGreaterThan(0);
    for (const [en, boy] of olculer) {
      expect(boy, `satır başlığı yüksekliği ${boy}`).toBeGreaterThanOrEqual(asgari);
      expect(en, `satır başlığı genişliği ${en}`).toBeGreaterThanOrEqual(asgari);
    }
    const tumu = await alan.getByRole('button', { name: 'Tümünü aç' }).boundingBox();
    expect(tumu?.height ?? 0, '"Tümünü aç" yüksekliği (Button)').toBeGreaterThanOrEqual(44);
  });

  test('klavye: oklar/Home/End başlıklar arasında, Tab/Shift+Tab sırayla, Enter/Space açar-kapar, Escape dokunmaz; tek alt çizgi, halka yok', async ({ page, browserName }) => {
    const alan = await telefonAkordeonu(page, '/odemeler');
    const basliklar = alan.locator('button[aria-expanded]');
    const sayi = await basliklar.count();
    expect(sayi).toBeGreaterThan(3);
    await enterKeyboardMode(page, browserName);
    await basliklar.first().focus();

    await page.keyboard.press('ArrowDown');
    await expect(basliklar.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(basliklar.nth(sayi - 1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(basliklar.first()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(basliklar.nth(sayi - 1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(basliklar.first()).toBeFocused();

    // Tab sıradaki başlığa (ilk satırın gövdesinde odaklanabilir öğe yok), Shift+Tab geri.
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(basliklar.nth(1)).toBeFocused();
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
    await expect(basliklar.first()).toBeFocused();

    await basliklar.nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(basliklar.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(basliklar.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');
    await expect(basliklar.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await expect(basliklar.nth(1)).toBeFocused();

    // Gösterge: başlık metninin altında 3 px odak çizgisi; düğmede outline/halka yok.
    await expect.poll(() => basliklar.nth(1).evaluate(basliktakiCizgi)).toMatchObject({ opacity: '1', height: '3px', bottom: '-4px', renk: ODAK_RENGI, boxShadow: 'none' });
    const halka = (await focusRing(page, { keyboard: true })).filter(ihlal => /halka|outline|çerçeve/.test(ihlal));
    expect(halka).toEqual([]);

    // İşaretçi kipine dönünce gösterge kaybolur, odak yerinde kalır.
    const kutu = await basliklar.nth(2).boundingBox();
    await page.mouse.click((kutu?.x ?? 0) + 8, (kutu?.y ?? 0) + 8);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.keyboard ?? 'yok')).not.toBe('true');
    await expect.poll(async () => (await basliklar.nth(2).evaluate(basliktakiCizgi))?.opacity).toBe('0');
  });

  test('dokunma: dokunuş satırı açar ve kapatır; kaydırma hareketi (pointercancel) satırı değiştirmez', async ({ page, browserName }) => {
    const alan = await telefonAkordeonu(page, '/odemeler');
    const basliklar = alan.locator('button[aria-expanded]');
    await basliklar.nth(1).tap();
    await expect(basliklar.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await basliklar.nth(1).tap();
    await expect(basliklar.nth(1)).toHaveAttribute('aria-expanded', 'false');

    test.skip(browserName !== 'chromium', 'gerçek dokunmatik kaydırma hareketi yalnız Chromium CDP ile üretilebilir (WebKit: not_run)');
    const hedef = basliklar.nth(2);
    await hedef.scrollIntoViewIfNeeded();
    const once = await hedef.getAttribute('aria-expanded');
    await page.evaluate(() => {
      const w = window as unknown as { __olaylar: string[] };
      w.__olaylar = [];
      for (const tur of ['pointerdown', 'pointercancel', 'click']) document.addEventListener(tur, e => w.__olaylar.push(`${tur}:${(e.target as Element).closest('button')?.getAttribute('aria-expanded') ?? '-'}`), true);
    });
    const kutu = (await hedef.boundingBox())!;
    const x = kutu.x + kutu.width / 2;
    const y = kutu.y + kutu.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let adim = 1; adim <= 10; adim++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - adim * 18 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    const olaylar = await page.evaluate(() => (window as unknown as { __olaylar: string[] }).__olaylar);
    expect(olaylar.some(olay => olay.startsWith('pointercancel')), olaylar.join(', ')).toBe(true);
    expect(olaylar.some(olay => olay.startsWith('click')), olaylar.join(', ')).toBe(false);
    await expect(hedef).toHaveAttribute('aria-expanded', once ?? 'false');
  });

  test('odak dönüşü: gövdedeki düğmede odak varken satır kapanırsa odak satır başlığına döner, body\'ye düşmez (Bütçe)', async ({ page, browserName }) => {
    const alan = await telefonAkordeonu(page, '/butce');
    const ilk = alan.locator('button[aria-expanded]').first();
    await expect(ilk).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator(`[id="${await ilk.getAttribute('aria-controls')}"]`);
    const ayrinti = panel.getByRole('button', { name: 'Ayrıntıyı aç' });
    await expect(ayrinti).toBeVisible();
    await alan.getByRole('button', { name: 'Tümünü aç' }).click();
    await enterKeyboardMode(page, browserName);
    await ayrinti.focus();
    await expect(ayrinti).toBeFocused();
    // Odağı taşımayan etkinleştirme (WebKit'te düğmeye tıklama odak vermez): "Tümünü kapat" gövdeyi kapatır.
    await alan.getByRole('button', { name: 'Tümünü kapat' }).dispatchEvent('click');
    await expect(ilk).toHaveAttribute('aria-expanded', 'false');
    await expect(ilk).toBeFocused();
  });

  test('hareket: tek süre ve eğri; reduced-motion açıkken geçiş yok, durum anında değişir', async ({ page }) => {
    const alan = await telefonAkordeonu(page, '/odemeler');
    expect(await motion(page, EGRI, 240, { root: AKORDEON })).toEqual([]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ikinci = alan.locator('button[aria-expanded]').nth(1);
    await ikinci.click();
    await expect(ikinci).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator(`[id="${await ikinci.getAttribute('aria-controls')}"]`);
    const sureler = await panel.evaluate(p => {
      const li = p.closest('li')!;
      return [p, li.querySelector('.aile-acc-head'), li.querySelector('.aile-acc-tog'), li.querySelector('.aile-acc-chev')]
        .filter((el): el is Element => el !== null)
        .map(el => getComputedStyle(el).transitionDuration.split(',').map(s => s.trim()).every(s => s === '0s'));
    });
    expect(sureler.every(Boolean), String(sureler)).toBe(true);
    await expect(panel).toBeVisible();
    expect(await motion(page, EGRI, 240, { root: AKORDEON, reduced: true })).toEqual([]);
  });
});

// --- Geniş profil: yerel tablo ---------------------------------------------------------------------------------

test.describe('geniş profil tablo (ResponsiveTable → Table)', () => {
  test('yerel tablo: başlık ve gövde tek tabloda; kendi kapsayıcısında kayar, ilk sütun yapışkan, sayfa taşmaz', async ({ page }) => {
    const bolge = await genisTablo(page, '/odemeler', ODEMELER_TABLO, { uzunAd: true });
    const ozet = await bolge.evaluate(tabloOzeti);
    expect(ozet).toMatchObject({
      tasiyor: true,
      tabindex: '0',
      tabloSayisi: 1,
      ilkBaslik: 'sticky',
      ilkHucre: 'sticky',
      belgeTasiyor: false,
    });
    expect(['auto', 'scroll']).toContain(ozet.overflowX);
    expect(ozet.ikinciBaslik).not.toBe('sticky');
    expect(ozet.ikinciHucre).not.toBe('sticky');
    expect(ozet.darBasliklar).toEqual([]);
    for (const deger of [...ozet.ilkHucreKirma, ...ozet.ilkBaslikKirma]) expect(['break-all', 'anywhere']).not.toContain(deger);
    expect(await bolge.evaluate(bolunenKelimeler, 'thead th, tbody td:first-child, tbody td')).toEqual([]);
    expect(await bolge.evaluate(sarilanSayisi, 'tbody td')).toBeGreaterThan(0);
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await smallText(page, { root: '.aile-rtable' }), '14 px alt sınır').toEqual([]);
    expect(await accentEdges(page, { root: '.aile-rtable' }), 'radiuslu kutuda kenar şeridi').toEqual([]);
  });

  test('kaydırma kapsayıcısı klavyeyle kayar; odakta tek alt çizgi (halka yok); kaydırınca ilk sütun yerinde kalır', async ({ page, browserName }) => {
    const bolge = await genisTablo(page, '/odemeler', ODEMELER_TABLO);
    await enterKeyboardMode(page, browserName);
    await bolge.focus();
    await expect(bolge).toBeFocused();
    expect(await focusRing(page, { keyboard: true })).toEqual([]);
    const ilkSol = await bolge.evaluate(b => b.querySelector('tbody td')!.getBoundingClientRect().left);
    // Gerçek tuş vuruşu gibi basılı tutulur: WebKit klavye kaydırması animasyonludur ve gecikmesiz keyup'ta durur.
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight', { delay: 120 });
    await expect.poll(() => bolge.evaluate(b => b.scrollLeft)).toBeGreaterThan(0);
    const sonra = await bolge.evaluate(b => ({
      ilk: b.querySelector('tbody td')!.getBoundingClientRect().left,
      kap: b.getBoundingClientRect().left,
      ikinci: b.querySelectorAll('tbody tr')[0]!.children[1]!.getBoundingClientRect().left,
    }));
    expect(Math.abs(sonra.ilk - ilkSol)).toBeLessThanOrEqual(1.5);
    expect(sonra.ikinci).toBeLessThan(sonra.ilk + 400);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);

    // İşaretçi kipinde kapsayıcı odakta kalsa da gösterge görünmez.
    await page.mouse.move(5, 5);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.keyboard ?? 'yok')).not.toBe('true');
    await bolge.focus();
    expect(await focusRing(page, { keyboard: false })).toEqual([]);
  });

  test('satırlar: Enter ve Space açar, oklar satırlar arasında; odak çizgisi satırın altında, yapışkan ilk hücrenin üstünde (Bütçe)', async ({ page, browserName }) => {
    const bolge = await genisTablo(page, '/butce', BUTCE_TABLO);
    const satirlar = bolge.locator('tbody tr[tabindex="0"]');
    expect(await satirlar.count()).toBeGreaterThan(2);
    await enterKeyboardMode(page, browserName);
    await satirlar.nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(satirlar.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(satirlar.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(satirlar.nth(2)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(satirlar.nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(satirlar.nth(1)).not.toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(satirlar.first()).toBeFocused();
    expect(await page.evaluate(() => window.scrollX)).toBe(0);

    await satirlar.nth(2).focus();
    expect(await focusRing(page, { keyboard: true })).toEqual([]);
    const katman = await satirlar.nth(2).evaluate(tr => {
      const ilk = tr.children[0] as HTMLElement;
      return { yapiskan: getComputedStyle(ilk).position === 'sticky', ilkZ: getComputedStyle(ilk).zIndex, cizgiZ: getComputedStyle(tr, '::after').zIndex };
    });
    if (katman.yapiskan) expect(Number(katman.cizgiZ)).toBeGreaterThanOrEqual(Number(katman.ilkZ) || 0);
  });

  test('dokunma: satıra dokunuş açar; yatay kaydırma hareketi (pointercancel) satır seçmez, kapsayıcıyı kaydırır', async ({ page, browserName }) => {
    const bolge = await genisTablo(page, '/butce', BUTCE_TABLO);
    const satirlar = bolge.locator('tbody tr[tabindex="0"]');
    const hasTouch = await page.evaluate(() => navigator.maxTouchPoints > 0);
    test.skip(!hasTouch, 'dokunma yalnız dokunmatik projelerde (chromium, webkit)');
    await satirlar.nth(1).locator('td').nth(1).tap();
    await expect(satirlar.nth(1)).toHaveAttribute('aria-selected', 'true');

    test.skip(browserName !== 'chromium', 'gerçek dokunmatik kaydırma hareketi yalnız Chromium CDP ile üretilebilir (WebKit: not_run)');
    const secili = await bolge.locator('tbody tr[aria-selected="true"]').count();
    const hucre = satirlar.nth(2).locator('td').nth(2);
    const kutu = (await hucre.boundingBox())!;
    const x = kutu.x + kutu.width / 2;
    const y = kutu.y + kutu.height / 2;
    await page.evaluate(() => {
      const w = window as unknown as { __olaylar: string[] };
      w.__olaylar = [];
      for (const tur of ['pointercancel', 'click']) document.addEventListener(tur, () => w.__olaylar.push(tur), true);
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let adim = 1; adim <= 10; adim++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - adim * 16, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    const olaylar = await page.evaluate(() => (window as unknown as { __olaylar: string[] }).__olaylar);
    expect(olaylar).toContain('pointercancel');
    expect(olaylar).not.toContain('click');
    await expect.poll(() => bolge.evaluate(b => b.scrollLeft)).toBeGreaterThan(0);
    await expect(satirlar.nth(2)).not.toHaveAttribute('aria-selected', 'true');
    expect(await bolge.locator('tbody tr[aria-selected="true"]').count()).toBe(secili);
  });
});
