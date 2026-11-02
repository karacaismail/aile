import { expect, test, type Locator, type Page } from '@playwright/test';
import { accentEdges, focusRing, motion, overflow, smallText } from './admin-detectors';
import { horizontalOverflow, openAdmin, shiftTabKey, tabKey } from './admin-helpers';

// Genel durum özeti gerçek rotada (#/genel, GenelPage): ui/Overview ve telefondaki karşılığı. W0 uyarlamalı teslim:
//  - Telefon profili (genişlik < 600 ya da kısa kenar < 480) Overview'u değil, yerel telefon sunumunu çizer
//    (pages/genel/GenelTelefon, data-testid="genel-telefon"): aynı bloklar telefon yolculuğu sırasıyla (ödemeler ve dikkat
//    isteyenler bütçeden önce), tablolar akordeon. Overview geniş sunumdadır (GenelPage.wide, lazyWide; tablet tek sütun
//    "dar", masaüstü iki sütun "genis") ve telefonda hiç çizilmez.
//  - Sözleşme iki sunumda da aynıdır, bu yüzden her test profilin çizdiği sunumu sınar; etkileşim testleri (dokunma,
//    klavye) her projede iki sunumu da koşar: telefon projelerinde Overview için görünüm 820×1180'e (tablet; dokunmatik
//    proje kaba işaretçiyi korur), geniş projelerde telefon sunumu için 390×844'e alınır.
// Sözleşme (ui/Overview.tsx, genel/GenelTelefon.tsx, W0 data/actuals.ts):
//   - Gerçekleşen sekmesindeki değerin ödeme kanıtı yoksa oran/çubuk/"%… harcandı" yok; etiket "Kaynakta yazılı".
//   - Plan ve gerçek ayrı etiketli; sayfa yatay taşmaz; metin ≥ 14 px; radiuslu kutuda kenar şeridi yok.
//   - Hedefler ≥ 44 px, kaba işaretçide (html[data-input-coarse]) ≥ 48 px. Görev satırı dokunmayla değişir; iptal edilen
//     dokunma (touchcancel → pointercancel) değiştirmez.
//   - Klavye: Tab/Shift+Tab sırası, Space değiştirir ve odak kutuda kalır; gösterge tek 3 px çizgi satır genişliğinde ve
//     liste satırının alt kenarında (README › Odak), çevreleyen halka yok; işaretçi modunda gösterge yok.
//   - Hareket tek süre/eğri; reduced-motion'da geçiş yok ve durum anında.
// Veri: dev sunucusu sentetik nesli sunar (AILE_GENERATION_DIR = fixtures/generation-synthetic, W0). Saat sabit
// (15.11.2026, İstanbul): bütçe dönemi 2026-11; sentetik Gerçekleşen kayıtlarının hiçbirinde ödeme kanıtı yok.
// Yerel olmayan her istek kesilir (Google'a ağ çağrısı yok). Görev değişikliği yalnız yerel change set'e yazılır.
// Emülasyon gerçek cihaz değildir.

const SABIT_AN = new Date('2026-11-15T09:00:00+03:00');
const EYLEM = 'rgb(50, 107, 148)';

type SunumAdi = 'telefon' | 'genis';
interface Sunum {
  ad: SunumAdi;
  /** Sunumun kökü (taşma, küçük metin, kenar şeridi ve hareket dedektörlerinin kapsamı). */
  kok: string;
  /** Blok bağlantısı, dikkat satırı ve görev satırı: dokunma hedefleri. */
  hedefler: string;
  /** Görev satırı (<label>; satırın tamamı hedeftir). */
  gorevSatiri: string;
  /** Görünür onay kutusu: Overview'da girdinin kendisi (appearance: none), telefonda girdinin yanındaki süsleyici kutu. */
  gorunurKutu: string;
}

const SUNUM: Record<SunumAdi, Sunum> = {
  telefon: {
    ad: 'telefon',
    kok: '[data-testid="genel-telefon"]',
    hedefler: 'a.aile-genel-bag, a.aile-genel-satir, label.aile-genel-gorev',
    gorevSatiri: 'label.aile-genel-gorev',
    gorunurKutu: '.aile-genel-kutu',
  },
  genis: {
    ad: 'genis',
    kok: '[data-testid="overview"]',
    hedefler: 'a.aile-ov-bag, a.aile-ov-satir, label.aile-ov-gorev',
    gorevSatiri: 'label.aile-ov-gorev',
    gorunurKutu: 'input[type="checkbox"]',
  },
};
const SUNUM_ADI: Record<SunumAdi, string> = { telefon: 'telefon sunumu', genis: 'geniş sunum · Overview' };

/** W0 profil sınıflaması (src/admin/adaptive/profile.ts): telefon = genişlik < 600 ya da kısa kenar < 480. */
const telefonGorunumu = ({ width, height }: { width: number; height: number }) => width < 600 || Math.min(width, height) < 480;
const TELEFON_GORUNUMU = { width: 390, height: 844 };
const TABLET_GORUNUMU = { width: 820, height: 1180 };

interface Acilis { kok: Locator; sunum: Sunum; profil: string }

/** #/genel'i sabit saatle açar. `istenen` verilirse görünüm o sunumu verecek profile alınır (açılıştan önce). */
async function genelAc(page: Page, istenen?: SunumAdi): Promise<Acilis> {
  if (istenen) {
    const telefonda = telefonGorunumu(page.viewportSize()!);
    if (istenen === 'telefon' && !telefonda) await page.setViewportSize(TELEFON_GORUNUMU);
    if (istenen === 'genis' && telefonda) await page.setViewportSize(TABLET_GORUNUMU);
  }
  await page.clock.setFixedTime(SABIT_AN);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, route => route.abort());
  await openAdmin(page, '/genel');
  const profil = (await page.evaluate(() => document.documentElement.dataset.profile)) ?? 'yok';
  const sunum = SUNUM[profil === 'phone' ? 'telefon' : 'genis'];
  if (istenen) expect(sunum.ad, `görünüm ${JSON.stringify(page.viewportSize())} → profil ${profil}`).toBe(istenen);
  // Geniş modül yüklenirken telefon sunumu yedek olarak görünebilir (Adaptive); profilin sunumu gelene kadar beklenir.
  const kok = page.locator(sunum.kok);
  await expect(kok).toBeVisible();
  return { kok, sunum, profil };
}

const gorevler = (page: Page) => page.getByRole('region', { name: 'Bekleyen işler' });

test.describe('Genel durum özeti (#/genel): telefonda yerel sunum, genişte Overview', () => {
  test('bütçe: kanıtsız Gerçekleşen "Kaynakta yazılı" der, oran ve çubuk yok; yerleşim profile uyar, taşma ve küçük metin yok', { tag: '@matrix' }, async ({ page }) => {
    const { kok, sunum, profil } = await genelAc(page);
    if (sunum.ad === 'genis') {
      await expect(kok).toHaveAttribute('data-layout', profil === 'desktop' ? 'genis' : 'dar');
    } else {
      // Telefon profili geniş sunumu (Overview) hiç çizmez.
      await expect(page.locator(SUNUM.genis.kok)).toHaveCount(0);
    }

    const butce = page.getByRole('region', { name: 'Bütçe · Kasım 2026' });
    await expect(butce).toBeVisible();
    await expect(butce.getByText('Kaynakta yazılı').first()).toBeVisible();
    await expect(butce).not.toContainText(/harcandı|%\s?\d/);
    await expect(butce.locator('.aile-ov-olcek, progress, meter, [role="progressbar"], [role="meter"]')).toHaveCount(0);
    // Plan ve gerçek ayrı: Planlanan ve Gerçekleşen etiketli (tablo başlığı ya da akordeon gövdesi).
    await expect(butce.getByText('Planlanan').first()).toBeAttached();
    await expect(butce.getByText('Gerçekleşen').first()).toBeAttached();

    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await overflow(page, { root: sunum.kok })).toEqual([]);
    expect(await smallText(page, { root: sunum.kok })).toEqual([]);
    expect(await accentEdges(page, { root: sunum.kok })).toEqual([]);
  });

  test('hedefler 44 px, kaba işaretçide 48 px', { tag: '@matrix' }, async ({ page }) => {
    const { kok, sunum } = await genelAc(page);
    const kaba = await page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'));
    const asgari = kaba ? 48 : 44;
    const olculer = await kok.locator(sunum.hedefler).evaluateAll(elements =>
      elements.map(element => {
        const rect = element.getBoundingClientRect();
        return { ad: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32), w: rect.width, h: rect.height };
      }),
    );
    expect(olculer.length).toBeGreaterThan(3);
    const kucukler = olculer.filter(olcu => olcu.w < asgari - 0.5 || olcu.h < asgari - 0.5);
    expect(kucukler, `en az ${asgari} px`).toEqual([]);
  });

  for (const ad of ['telefon', 'genis'] as const) {
    test(`görev [${SUNUM_ADI[ad]}]: satıra dokunma kutuyu değiştirir, iptal edilen dokunma değiştirmez`, async ({ page, browserName }, testInfo) => {
      const { sunum } = await genelAc(page, ad);
      const kutu = gorevler(page).getByRole('checkbox').first();
      const satir = gorevler(page).locator(sunum.gorevSatiri).first();
      await expect(kutu).toBeEnabled();
      await expect(kutu).not.toBeChecked();
      const dokunmatik = Boolean(testInfo.project.use.hasTouch);
      const bas = () => (dokunmatik ? satir.tap() : satir.click());

      await bas();
      await expect(kutu).toBeChecked();
      await bas();
      await expect(kutu).not.toBeChecked();

      // İptal: parmak satırda başlar, kaydırır ve sistem dokunmayı iptal eder (touchcancel → pointercancel). Tıklama yok.
      // Dokunma iptali yalnız Chromium CDP ile üretilebilir; WebKit'te bu adım koşmaz (not_run olarak işaretlenir).
      if (!(dokunmatik && browserName === 'chromium')) {
        testInfo.annotations.push({ type: 'not_run', description: 'touchcancel adımı yalnız dokunmatik Chromium (CDP) projesinde koşar' });
        return;
      }
      await satir.scrollIntoViewIfNeeded();
      const alan = (await satir.boundingBox())!;
      const x = alan.x + alan.width / 2;
      const y = alan.y + alan.height / 2;
      await page.evaluate(() => {
        const w = window as unknown as { __iptal: string[] };
        w.__iptal = [];
        document.addEventListener('pointercancel', event => w.__iptal.push(event.pointerType), { capture: true });
      });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 40 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await expect.poll(() => page.evaluate(() => (window as unknown as { __iptal: string[] }).__iptal)).toContain('touch');
      await expect(kutu).not.toBeChecked();
    });

    test(`klavye [${SUNUM_ADI[ad]}]: Tab/Shift+Tab sırası, Space değiştirir ve odak kalır; gösterge satırın alt kenarında tek çizgi, halka yok`, async ({ page, browserName }) => {
      await genelAc(page, ad);
      const blok = gorevler(page);
      const baglanti = blok.getByRole('link', { name: 'Projeler ve görevler' });
      const kutu = blok.getByRole('checkbox').first();
      const ikinci = blok.getByRole('checkbox').nth(1);
      await expect(kutu).toBeEnabled();

      await baglanti.focus();
      await page.keyboard.press(tabKey(browserName));
      await expect(kutu).toBeFocused();
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.keyboard)).toBe('true');
      await page.keyboard.press(tabKey(browserName));
      await expect(ikinci).toBeFocused();
      await page.keyboard.press(shiftTabKey(browserName));
      await expect(kutu).toBeFocused();

      // Gösterge: satırın (label) ::after'ı, 3 px, satır genişliğinde; alt kenarı liste satırının (li) alt kenarında
      // (README › Odak: liste satırında alt kenar; listenin overflow'unda kesilmez). Kutu ve satırda halka yok.
      const cizgi = await kutu.evaluate(element => {
        const satir = element.closest('label')!;
        const kutuSiniri = satir.getBoundingClientRect();
        const after = getComputedStyle(satir, '::after');
        return {
          content: after.content,
          height: after.height,
          bg: after.backgroundColor,
          genislik: parseFloat(after.width),
          satir: kutuSiniri.width,
          alt: kutuSiniri.bottom - parseFloat(after.bottom),
          liAlt: satir.closest('li')!.getBoundingClientRect().bottom,
        };
      });
      expect(cizgi.content).not.toBe('none');
      expect(cizgi).toMatchObject({ height: '3px', bg: EYLEM });
      expect(Math.abs(cizgi.genislik - cizgi.satir)).toBeLessThanOrEqual(1);
      expect(Math.abs(cizgi.alt - cizgi.liAlt), 'çizgi liste satırının alt kenarında').toBeLessThanOrEqual(1);
      // Ortak dedektör: halka yok. (Satır taşıyıcısının alt kenar konumunu dedektör yalnız tr/[role=row] için tanır;
      // Overview'un liste satırı çizgisi satırın içinde bottom 0'dadır ve konumu yukarıda ölçüldü — f09 isteği.)
      const halka = (await focusRing(page)).filter(ihlal => !/::after konum bottom 0px \(beklenen -7px\)$/.test(ihlal));
      expect(halka).toEqual([]);

      await page.keyboard.press('Space');
      await expect(kutu).toBeChecked();
      await expect(kutu).toBeFocused();
      // Sayfa aynı öğeyi yeniden çizer; odak kutuda kalır. Oklar ve Escape değiştirmez, odağı taşımaz.
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      await expect(kutu).toBeChecked();
      await expect(kutu).toBeFocused();
      await page.keyboard.press('Space');
      await expect(kutu).not.toBeChecked();

      // İşaretçi modu: gösterge görünmez.
      await kutu.click();
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.keyboard ?? '')).not.toBe('true');
      const sonra = await kutu.evaluate(element => getComputedStyle(element.closest('label')!, '::after').content);
      expect(['none', 'normal']).toContain(sonra);
    });
  }

  test('hareket: tek süre ve eğri; reduced-motion açıkken geçiş yok ve durum anında değişir', { tag: '@matrix' }, async ({ page }, testInfo) => {
    const { sunum } = await genelAc(page);
    const kutu = gorevler(page).getByRole('checkbox').first();
    const satir = gorevler(page).locator(sunum.gorevSatiri).first();
    const gorunur = satir.locator(sunum.gorunurKutu);
    await expect(kutu).toBeEnabled();
    await expect(kutu).not.toBeChecked();
    // Hareket açıkken: sunumdaki her geçiş 240 ms ve tek eğri; görünür kutunun geçişi var (sınama boş geçmesin).
    expect(await motion(page, 'cubic-bezier(.65,0,.35,1)', 240, { root: sunum.kok })).toEqual([]);
    const once = await gorunur.evaluate(element => getComputedStyle(element).transitionDuration);
    expect(once.split(',').some(parca => parseFloat(parca) > 0)).toBe(true);

    // reduced-motion açık yükleme. (Canlı geçişte uygulama sayfayı yeniden kuruyor: sunum öğesi ~250 ms kaybolup yenisi
    // geliyor — kabuk/sağlayıcı isteği; burada sunumun reduced-motion davranışı sınanır.)
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await genelAc(page);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await expect(kutu).toBeEnabled();
    await expect(kutu).not.toBeChecked();
    expect(await motion(page, 'cubic-bezier(.65,0,.35,1)', 240, { root: sunum.kok, reduced: true })).toEqual([]);
    await (testInfo.project.use.hasTouch ? satir.tap() : satir.click());
    // Geçiş yok: kutunun işaretli göründüğü İLK karede dolgu son değerindedir. (Girdi denetimli: değişiklik kümesine
    // yazılınca işaretlenir; o kare beklenir, sabit bekleme yok, en çok 120 kare.)
    const dolgu = await kutu.evaluate((girdi, secici) => new Promise<{ checked: boolean; bg: string; sure: string }>(resolve => {
      const gorunurOge = girdi.closest('label')!.querySelector<HTMLElement>(secici)!;
      const oku = () => ({ checked: (girdi as HTMLInputElement).checked, bg: getComputedStyle(gorunurOge).backgroundColor, sure: getComputedStyle(gorunurOge).transitionDuration });
      const bekle = (kalan: number) => {
        const durum = oku();
        if (durum.checked || kalan === 0) resolve(durum);
        else requestAnimationFrame(() => bekle(kalan - 1));
      };
      bekle(120);
    }), sunum.gorunurKutu);
    expect(dolgu.checked).toBe(true);
    expect(dolgu.bg).toBe(EYLEM);
    expect(dolgu.sure.split(',').every(parca => parseFloat(parca) === 0)).toBe(true);
  });
});
