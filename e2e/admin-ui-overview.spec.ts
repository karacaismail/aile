import { expect, test, type Locator, type Page } from '@playwright/test';
import { accentEdges, focusRing, motion, overflow, smallText } from './admin-detectors';
import { horizontalOverflow, openAdmin, shiftTabKey, tabKey } from './admin-helpers';

// ui/Overview gerçek rotada (#/genel, GenelPage): telefon yolculuğu önce (chromium 320×568 dokunmatik, webkit 390×844
// dokunmatik); @matrix etiketli testler entegrasyonda 360/375/320×480/568×320 (telefon profili), tablet ve masaüstünde
// de koşar. Sözleşme (src/admin/ui/Overview.tsx, W0 data/actuals.ts):
//   - Gerçekleşen sekmesindeki değerin ödeme kanıtı yoksa oran/çubuk/"%… harcandı" yok; etiket "Kaynakta yazılı".
//   - Yerleşim profilden: masaüstü iki sütun (genis), diğerleri tek sütun (dar); sayfa yatay taşmaz; metin ≥ 14 px;
//     radiuslu kutuda kenar şeridi yok.
//   - Hedefler ≥ 44 px, kaba işaretçide (html[data-input-coarse]) ≥ 48 px. Görev satırı dokunmayla değişir; iptal edilen
//     dokunma (touchcancel → pointercancel) değiştirmez.
//   - Klavye: Tab/Shift+Tab sırası, Space değiştirir ve odak kutuda kalır; gösterge tek 3 px çizgi satırın alt kenarında,
//     çevreleyen halka yok; işaretçi modunda gösterge yok.
//   - Hareket tek süre/eğri; reduced-motion'da geçiş yok ve durum anında.
// Veri: dev sunucusu sentetik nesli sunar (AILE_GENERATION_DIR = fixtures/generation-synthetic, W0). Saat sabit
// (15.11.2026, İstanbul): bütçe dönemi 2026-11; sentetik Gerçekleşen kayıtlarının hiçbirinde ödeme kanıtı yok.
// Yerel olmayan her istek kesilir (Google'a ağ çağrısı yok). Görev değişikliği yalnız yerel change set'e yazılır.

const SABIT_AN = new Date('2026-11-15T09:00:00+03:00');
const OVERVIEW = '[data-testid="overview"]';
const EYLEM = 'rgb(50, 107, 148)';

async function genelAc(page: Page): Promise<Locator> {
  await page.clock.setFixedTime(SABIT_AN);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, route => route.abort());
  await openAdmin(page, '/genel');
  const overview = page.locator(OVERVIEW);
  await expect(overview).toBeVisible();
  return overview;
}

const gorevler = (page: Page) => page.getByRole('region', { name: 'Bekleyen işler' });

test.describe('Overview (#/genel)', () => {
  test('bütçe: kanıtsız Gerçekleşen "Kaynakta yazılı" der, oran ve çubuk yok; yerleşim profile uyar, taşma ve küçük metin yok', { tag: '@matrix' }, async ({ page }) => {
    const overview = await genelAc(page);
    const profil = await page.evaluate(() => document.documentElement.dataset.profile);
    await expect(overview).toHaveAttribute('data-layout', profil === 'desktop' ? 'genis' : 'dar');

    const butce = page.getByRole('region', { name: 'Bütçe · Kasım 2026' });
    await expect(butce).toBeVisible();
    await expect(butce.getByText('Kaynakta yazılı').first()).toBeVisible();
    await expect(butce).not.toContainText(/harcandı|%\s?\d/);
    await expect(butce.locator('.aile-ov-olcek')).toHaveCount(0);
    // Plan ve gerçek ayrı: Planlanan ve Gerçekleşen etiketli (tablo başlığı ya da akordeon gövdesi).
    await expect(butce.getByText('Planlanan').first()).toBeAttached();
    await expect(butce.getByText('Gerçekleşen').first()).toBeAttached();

    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await overflow(page, { root: OVERVIEW })).toEqual([]);
    expect(await smallText(page, { root: OVERVIEW })).toEqual([]);
    expect(await accentEdges(page, { root: OVERVIEW })).toEqual([]);
  });

  test('hedefler 44 px, kaba işaretçide 48 px', { tag: '@matrix' }, async ({ page }) => {
    const overview = await genelAc(page);
    const kaba = await page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'));
    const asgari = kaba ? 48 : 44;
    const olculer = await overview.locator('a.aile-ov-bag, a.aile-ov-satir, label.aile-ov-gorev').evaluateAll(elements =>
      elements.map(element => {
        const rect = element.getBoundingClientRect();
        return { ad: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32), w: rect.width, h: rect.height };
      }),
    );
    expect(olculer.length).toBeGreaterThan(3);
    const kucukler = olculer.filter(olcu => olcu.w < asgari - 0.5 || olcu.h < asgari - 0.5);
    expect(kucukler, `en az ${asgari} px`).toEqual([]);
  });

  test('görev: satıra dokunma kutuyu değiştirir, iptal edilen dokunma değiştirmez', async ({ page, browserName }, testInfo) => {
    await genelAc(page);
    const kutu = gorevler(page).getByRole('checkbox').first();
    const satir = gorevler(page).locator('label.aile-ov-gorev').first();
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

  test('klavye: Tab/Shift+Tab sırası, Space değiştirir ve odak kalır; gösterge satırın alt kenarında tek çizgi, halka yok', async ({ page, browserName }) => {
    await genelAc(page);
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

    // Gösterge: satırın (label) ::after'ı, 3 px, satır genişliğinde, alt kenarda; kutu ve satırda halka yok.
    const cizgi = await kutu.evaluate(element => {
      const satir = element.closest('label')!;
      const after = getComputedStyle(satir, '::after');
      return { content: after.content, height: after.height, bottom: after.bottom, width: parseFloat(after.width), satir: satir.getBoundingClientRect().width, bg: after.backgroundColor };
    });
    expect(cizgi.content).not.toBe('none');
    expect(cizgi).toMatchObject({ height: '3px', bottom: '0px', bg: EYLEM });
    expect(Math.abs(cizgi.width - cizgi.satir)).toBeLessThanOrEqual(1);
    // Ortak dedektör: halka yok. (Satır taşıyıcısının alt kenar konumunu dedektör yalnız tr/[role=row] için tanır;
    // liste satırı için konum yukarıda ölçüldü — f09 isteği.)
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

  test('hareket: tek süre ve eğri; reduced-motion açıkken geçiş yok ve durum anında değişir', { tag: '@matrix' }, async ({ page }, testInfo) => {
    await genelAc(page);
    const kutu = gorevler(page).getByRole('checkbox').first();
    const satir = gorevler(page).locator('label.aile-ov-gorev').first();
    await expect(kutu).toBeEnabled();
    await expect(kutu).not.toBeChecked();
    // Hareket açıkken: Overview'daki her geçiş 240 ms ve tek eğri; kutunun geçişi var (sınama boş geçmesin).
    expect(await motion(page, 'cubic-bezier(.65,0,.35,1)', 240, { root: OVERVIEW })).toEqual([]);
    const once = await kutu.evaluate(element => getComputedStyle(element).transitionDuration);
    expect(once.split(',').some(parca => parseFloat(parca) > 0)).toBe(true);

    // reduced-motion açık yükleme. (Canlı geçişte uygulama sayfayı yeniden kuruyor: Overview öğesi ~250 ms kaybolup
    // yenisi geliyor — kabuk/sağlayıcı isteği; burada Overview'un reduced-motion davranışı sınanır.)
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await genelAc(page);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await expect(kutu).toBeEnabled();
    await expect(kutu).not.toBeChecked();
    expect(await motion(page, 'cubic-bezier(.65,0,.35,1)', 240, { root: OVERVIEW, reduced: true })).toEqual([]);
    await (testInfo.project.use.hasTouch ? satir.tap() : satir.click());
    // Geçiş yok: dolgu aynı karede son değerinde.
    const dolgu = await kutu.evaluate(element => ({ checked: (element as HTMLInputElement).checked, bg: getComputedStyle(element).backgroundColor, sure: getComputedStyle(element).transitionDuration }));
    expect(dolgu.checked).toBe(true);
    expect(dolgu.bg).toBe(EYLEM);
    expect(dolgu.sure.split(',').every(parca => parseFloat(parca) === 0)).toBe(true);
  });
});
