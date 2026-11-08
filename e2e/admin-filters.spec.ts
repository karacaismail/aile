import { test, expect, type Locator, type Page } from '@playwright/test';
import { focusRing } from './admin-detectors';
import { horizontalOverflow, openAdmin, shiftTabKey, tabKey } from './admin-helpers';

// Filtre ve sorgu yolculuğu (b03-filters): shell/QueryBar, shell/FilterDrawer, shell/FilterPanel.
// Tasarım: aile-tasarim/tasarim-sistemi/README.md › Sayfa iskeleti 3–4 ve Uyarlanır teslim; components/QueryBar,
// FilterPanel, FilterArea, BottomSheet README'leri. Bu projede telefon (genişlik < 600 ya da kısa kenar < 480) filtreleri
// ALT SAYFADA açar; eylemler "Uygula" ve "Temizle"; etkin filtre sayısı tetikte ("Filtreler (N)"). Tablet sağdan 384,
// masaüstü solda 272 px panel (FilterArea). Filtre ve sıralama durumu profil ve görünüm modu değişiminde korunur.
// Odak: alt sayfada her Tab görünür bir öğeye düşer (gizli checkbox input'u değil) ve tek alt çizgi taşır.
// Veri: webServer sentetik nesli servis eder (fixtures/generation-synthetic); ağdan Google'a çağrı yok.
// Seçiciler role/ad ile; tek istisna QueryBar'ın kendi arama sarmalayıcısı (.aile-sorgu-ara, bu görevin dosyası).
// Matris testleri @matrix etiketlidir; görev koşusunda chromium (320×568) ve webkit (390×844) projelerinde de koşar.

const sorgu = (page: Page) => page.getByRole('search', { name: 'Sorgu' });
const tetik = (page: Page) => sorgu(page).getByRole('button', { name: /^Filtreler \(/ });
const altSayfa = (page: Page) => page.getByRole('dialog', { name: /^Filtreler/ });

type Profil = 'phone' | 'tablet' | 'desktop';
const profil = (page: Page) => page.evaluate(() => (document.documentElement.dataset.profile ?? '') as Profil);
/** Dokunma hedefi: 44 px; kaba (dokunmatik) giriş katmanı açıksa 48 px. */
const hedef = async (page: Page) => (await page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse')) ? 48 : 44);

async function kutu(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'öğe çizilmedi').not.toBeNull();
  return box!;
}

async function hedefYuksekligi(page: Page, locator: Locator, ad: string) {
  const min = await hedef(page);
  const { height } = await kutu(locator);
  expect(height, `${ad}: dokunma hedefi ${min} px altında`).toBeGreaterThanOrEqual(min - 0.5);
}

/** Görünüm alanının içinde mi (alt sayfa eylemleri kaydırmadan erişilebilir olmalı). */
async function gorunumIcinde(page: Page, locator: Locator, ad: string) {
  const box = await kutu(locator);
  const viewport = page.viewportSize()!;
  expect(box.y, `${ad}: üstte görünüm dışında`).toBeGreaterThanOrEqual(-0.5);
  expect(box.y + box.height, `${ad}: altta görünüm dışında`).toBeLessThanOrEqual(viewport.height + 0.5);
  expect(box.x + box.width, `${ad}: sağda görünüm dışında`).toBeLessThanOrEqual(viewport.width + 0.5);
}

/** Tarayıcıda: odaklı öğe gerçekten görünür mü (opacity/visibility/display zinciri, boyut, kapsayıcı kaydırma alanı). */
function odakGorunur(): { ok: boolean; neden: string; rol: string } {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return { ok: false, neden: 'odak belgede', rol: '' };
  const rol = el.getAttribute('role') ?? (el instanceof HTMLInputElement ? `input:${el.type}` : el.tagName.toLowerCase());
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return { ok: false, neden: `boyut ${rect.width}×${rect.height}`, rol };
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none') return { ok: false, neden: 'display none', rol };
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return { ok: false, neden: 'visibility', rol };
    if (parseFloat(style.opacity) === 0) return { ok: false, neden: `opacity 0 (${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]})`, rol };
    if (style.clipPath === 'inset(50%)' || style.clip === 'rect(0px, 0px, 0px, 0px)') return { ok: false, neden: 'görsel gizli', rol };
  }
  // Kaydırılan kapsayıcıların görünür alanında mı (odak görünür alana kaydırılmış olmalı).
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (!/(auto|scroll|hidden)/.test(style.overflowY + style.overflowX)) continue;
    const box = node.getBoundingClientRect();
    if (rect.bottom <= box.top || rect.top >= box.bottom || rect.right <= box.left || rect.left >= box.right) {
      return { ok: false, neden: 'kaydırma alanının dışında', rol };
    }
  }
  if (rect.bottom <= 0 || rect.top >= window.innerHeight) return { ok: false, neden: 'görünüm dışında', rol };
  return { ok: true, neden: '', rol };
}

/** Açılış hareketi bitti mi: yüzeyin kutusu iki ardışık ölçümde aynı (sabit bekleme yok). */
async function yerlesik(locator: Locator) {
  let onceki = '';
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const simdi = box ? [box.x, box.y, box.width, box.height].map(Math.round).join(',') : '';
    const ayni = simdi !== '' && simdi === onceki;
    onceki = simdi;
    return ayni;
  }, { message: 'yüzey yerleşmedi (hareket sürüyor)', intervals: [50, 100, 100, 200] }).toBe(true);
}

/** Programatik odağı gerçek klavye odağına çevirir (Tab ileri + geri), klavye modu açılır. */
async function klavyeOdagi(page: Page, browserName: string, locator: Locator) {
  await locator.focus();
  await page.keyboard.press(tabKey(browserName));
  await page.keyboard.press(shiftTabKey(browserName));
  await page.waitForFunction(() => document.documentElement.dataset.keyboard === 'true');
  await expect(locator).toBeFocused();
}

/** Sıralama denetiminin görünür değeri (canlı bölge kopyası gibi gizli eşleri dışarıda bırakır). */
const siralamaDegeri = (page: Page, ad: string) => sorgu(page).getByText(ad, { exact: true }).filter({ visible: true }).first();

async function siralamaSec(page: Page, ad: string) {
  await sorgu(page).getByRole('combobox', { name: 'Sıralama' }).click();
  await page.getByRole('option', { name: ad, exact: true }).click();
  await expect(siralamaDegeri(page, ad)).toBeVisible();
}

const sonucMetni = async (page: Page) => (await sorgu(page).getByRole('status').textContent())?.trim() ?? '';

/**
 * Geniş profile ilk geçişte antd sağlayıcı geçidi (adaptive/AdaptiveRoot, PHONE_WITHOUT_ANTD) tembel yüklenir; beklerken
 * kök aria-busy taşır, bağlanınca çalışma alanı bir kez yeniden kurulur (bilinen bedel; durum URL'den geri gelir).
 * Ölçü ve etkileşim ondan sonra yapılır: aksi hâlde ölçülen düğüm yeniden kurulumla belgeden düşer ya da açılan alt
 * sayfa geç bağlanan sağlayıcıyla kapanır.
 */
const saglayiciBagli = (page: Page) => expect(page.locator('[aria-busy="true"]:not(main *)'), 'sağlayıcı geçidi bağlandı').toHaveCount(0);

test.describe('filtreler ve sorgu çubuğu — telefon yolculuğu', () => {
  test.beforeEach(async ({ page }) => {
    await openAdmin(page, '/alimlar');
    test.skip((await profil(page)) !== 'phone', 'telefon yolculuğu: proje görünümü telefon profilinde değil');
  });

  test('sorgu çubuğu: arama tam genişlik, sıralama Select, Filtreler (N) tetiği ve temizle düğmesi 44/48', async ({ page }) => {
    const bolge = sorgu(page);
    await expect(bolge).toBeVisible();
    const bolgeKutu = await kutu(bolge);
    const ara = bolge.getByRole('searchbox', { name: 'Ara' });
    await expect(ara).toBeVisible();
    const alan = await kutu(bolge.locator('.aile-sorgu-ara'));
    expect(Math.abs(alan.width - bolgeKutu.width), 'arama alanı sorgu çubuğu genişliğinde değil').toBeLessThanOrEqual(1);

    const siralama = bolge.getByRole('combobox', { name: 'Sıralama' });
    await expect(siralama).toBeVisible();

    await expect(tetik(page)).toHaveAccessibleName('Filtreler (0)');
    await hedefYuksekligi(page, tetik(page), 'Filtreler tetiği');

    await ara.fill('örnek');
    const temizle = bolge.getByRole('button', { name: 'Tümünü temizle' });
    await expect(temizle).toBeVisible();
    await hedefYuksekligi(page, temizle, 'Tümünü temizle');
    expect(await horizontalOverflow(page), 'sayfa düzeyinde yatay taşma').toEqual([]);
    await temizle.click();
    await expect(ara).toHaveValue('');
    await expect(temizle).toBeHidden();
  });

  test('filtreler alt sayfada: Uygula ve Temizle, sonuç sayısı, etkin sayı tetikte ve başlıkta', async ({ page }) => {
    const ilkSonuc = await sonucMetni(page);
    await tetik(page).click();
    const sayfa = altSayfa(page);
    await expect(sayfa).toBeVisible();
    await expect(sayfa).toHaveAccessibleName('Filtreler');

    // Alt sayfa: görünümün altına dayanır, üstte örtü görünür kalır (tam ekran değil).
    await yerlesik(sayfa);
    const viewport = page.viewportSize()!;
    await expect.poll(async () => {
      const box = await sayfa.boundingBox();
      return box ? Math.round(box.y + box.height) : -1;
    }, { message: 'alt sayfa görünümün altına dayanmıyor' }).toBe(viewport.height);
    const box = await kutu(sayfa);
    expect(box.y, 'alt sayfa tam ekran; üstte örtü kalmadı').toBeGreaterThan(0);

    const uygula = sayfa.getByRole('button', { name: 'Uygula', exact: true });
    const temizle = sayfa.getByRole('button', { name: 'Temizle', exact: true });
    for (const [dugme, ad] of [[uygula, 'Uygula'], [temizle, 'Temizle']] as const) {
      await expect(dugme).toBeVisible();
      await gorunumIcinde(page, dugme, ad);
      await hedefYuksekligi(page, dugme, ad);
    }
    await expect(sayfa.getByRole('status')).toHaveText(ilkSonuc);
    expect(await horizontalOverflow(page), 'alt sayfa açıkken yatay taşma').toEqual([]);

    const secenek = sayfa.getByRole('checkbox').first();
    const ad = (await secenek.getAttribute('aria-label')) ?? '';
    expect(ad, 'seçeneğin erişilebilir adı yok').not.toBe('');
    await secenek.click();
    await expect(secenek).toBeChecked();
    await expect(sayfa).toHaveAccessibleName('Filtreler · 1 etkin');
    await expect(sayfa.getByRole('status')).toHaveText(/^[\d.]+ sonuç$/);

    await uygula.click();
    await expect(sayfa).toBeHidden();
    await expect(tetik(page)).toHaveAccessibleName('Filtreler (1)');

    await tetik(page).click();
    await expect(sayfa).toBeVisible();
    await expect(sayfa.getByRole('checkbox', { name: ad, exact: true })).toBeChecked();
    await temizle.click();
    await expect(sayfa, 'Temizle alt sayfayı kapatmamalı').toBeVisible();
    await expect(sayfa).toHaveAccessibleName('Filtreler');
    await expect(sayfa.getByRole('checkbox', { name: ad, exact: true })).not.toBeChecked();
    await expect(sayfa.getByRole('status')).toHaveText(ilkSonuc);
    await uygula.click();
    await expect(sayfa).toBeHidden();
    await expect(tetik(page)).toHaveAccessibleName('Filtreler (0)');
  });

  test('klavye: alt sayfada her Tab görünür bir öğeye düşer, tek alt çizgi; Escape açan düğmeye döner', async ({ page, browserName }) => {
    await klavyeOdagi(page, browserName, tetik(page));
    await page.keyboard.press('Enter');
    const sayfa = altSayfa(page);
    await expect(sayfa).toBeVisible();
    await expect.poll(() => sayfa.evaluate(el => el.contains(document.activeElement)), { message: 'odak alt sayfaya girmedi' }).toBe(true);
    await yerlesik(sayfa);

    const roller: string[] = [];
    for (let index = 1; index <= 10; index += 1) {
      await page.keyboard.press(tabKey(browserName));
      expect(await sayfa.evaluate(el => el.contains(document.activeElement)), `Tab ${index}: odak alt sayfadan kaçtı`).toBe(true);
      const gorunur = await page.evaluate(odakGorunur);
      roller.push(gorunur.rol);
      expect(gorunur.ok, `Tab ${index} (${gorunur.rol}): odaklanan öğe görünür değil — ${gorunur.neden}`).toBe(true);
      expect(await focusRing(page), `Tab ${index} (${gorunur.rol}): odak göstergesi`).toEqual([]);
    }
    expect(roller, 'Tab sırası hiçbir filtre seçeneğine ulaşmadı').toContain('input:checkbox');

    await page.keyboard.press('Escape');
    await expect(sayfa).toBeHidden();
    await expect(tetik(page)).toBeFocused();
  });

  test('profil ve görünüm modu değişimi: filtre ve sıralama korunur; masaüstünde 272 px sol panel', async ({ page }) => {
    const telefon = page.viewportSize()!;
    await siralamaSec(page, 'Planlanan tutar (yüksekten)');

    await tetik(page).click();
    const sayfa = altSayfa(page);
    const secenek = sayfa.getByRole('checkbox').first();
    const ad = (await secenek.getAttribute('aria-label')) ?? '';
    await secenek.click();
    await expect(secenek).toBeChecked();
    await sayfa.getByRole('button', { name: 'Uygula', exact: true }).click();
    await expect(sayfa).toBeHidden();
    await expect(tetik(page)).toHaveAccessibleName('Filtreler (1)');
    const sonuc = await sonucMetni(page);

    // Telefon → masaüstü: filtre panelde seçili, sıralama aynı, sonuç sayısı aynı.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => profil(page)).toBe('desktop');
    await saglayiciBagli(page);
    await expect(tetik(page)).toHaveCount(0);
    const panel = page.getByRole('region', { name: 'Filtreler', exact: true }).first();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: ad, exact: true })).toBeChecked();
    const panelKutu = await kutu(panel);
    expect(Math.abs(panelKutu.width - 272), `filtre paneli 272 px değil (${panelKutu.width})`).toBeLessThanOrEqual(1);
    const sonuclar = await kutu(page.getByRole('region', { name: 'Sonuçlar' }));
    expect(panelKutu.x + panelKutu.width, 'filtre paneli sonuçların solunda değil').toBeLessThanOrEqual(sonuclar.x);
    await expect(siralamaDegeri(page, 'Planlanan tutar (yüksekten)')).toBeVisible();
    await expect(sorgu(page).getByRole('status')).toHaveText(sonuc);

    // Görünüm modu değişimi (Tablo: panel şeritle başlar): etkin sayı şeritte, sonuç aynı.
    const modlar = sorgu(page).getByRole('radiogroup', { name: 'Görünüm modu' });
    await modlar.getByText('Tablo', { exact: true }).click();
    await expect(modlar.getByRole('radio', { name: 'Tablo', exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Filtreleri göster, 1 etkin' })).toBeVisible();
    await expect(sorgu(page).getByRole('status')).toHaveText(sonuc);
    await expect(siralamaDegeri(page, 'Planlanan tutar (yüksekten)')).toBeVisible();

    // Masaüstü → telefon: tetik sayısı, sıralama ve sonuç korunur; alt sayfada seçim işaretli.
    await page.setViewportSize(telefon);
    await expect.poll(() => profil(page)).toBe('phone');
    await expect(tetik(page)).toHaveAccessibleName('Filtreler (1)');
    await expect(siralamaDegeri(page, 'Planlanan tutar (yüksekten)')).toBeVisible();
    await expect(sorgu(page).getByRole('status')).toHaveText(sonuc);
    await tetik(page).click();
    const donus = altSayfa(page);
    await expect(donus).toHaveAccessibleName('Filtreler · 1 etkin');
    // Tablo modunda açık başlayan boyutlar farklıdır; seçimi bulmak için kapalı boyutlar açılır.
    const kapali = donus.getByRole('button', { expanded: false });
    for (let tur = 0; tur < 20 && (await kapali.count()) > 0; tur += 1) await kapali.first().click();
    await expect(donus.getByRole('checkbox', { name: ad, exact: true })).toBeChecked();
    expect(await horizontalOverflow(page), 'profil dönüşünden sonra yatay taşma').toEqual([]);
  });
});

test('@matrix filtre yüzeyi profile uyar: telefonda alt sayfa, tablette sağdan 384, masaüstünde 272 px panel; yatay taşma yok', { tag: '@matrix' }, async ({ page }) => {
  await openAdmin(page, '/alimlar');
  const viewport = page.viewportSize()!;
  const p = await profil(page);
  expect(['phone', 'tablet', 'desktop']).toContain(p);
  expect(await horizontalOverflow(page), 'sayfa düzeyinde yatay taşma').toEqual([]);

  if (p === 'desktop') {
    await expect(tetik(page)).toHaveCount(0);
    const panel = page.getByRole('region', { name: 'Filtreler', exact: true }).first();
    await expect(panel).toBeVisible();
    expect(Math.abs((await kutu(panel)).width - 272)).toBeLessThanOrEqual(1);
    return;
  }

  const ara = await kutu(sorgu(page).locator('.aile-sorgu-ara'));
  expect(Math.abs(ara.width - (await kutu(sorgu(page))).width), 'arama tam genişlik değil').toBeLessThanOrEqual(1);
  await hedefYuksekligi(page, tetik(page), 'Filtreler tetiği');
  await tetik(page).click();
  const sayfa = altSayfa(page);
  await expect(sayfa).toBeVisible();
  // Açılış hareketi (240 ms) bitmeden ölçülen konum geçicidir; yüzey yerleşince ölçülür.
  await yerlesik(sayfa);
  const uygula = sayfa.getByRole('button', { name: 'Uygula', exact: true });
  const temizle = sayfa.getByRole('button', { name: 'Temizle', exact: true });
  await expect(uygula).toBeVisible();
  await expect(temizle).toBeVisible();
  await gorunumIcinde(page, uygula, 'Uygula');
  await gorunumIcinde(page, temizle, 'Temizle');
  await hedefYuksekligi(page, uygula, 'Uygula');
  await expect.poll(async () => {
    const box = await sayfa.boundingBox();
    if (!box) return 'yok';
    if (p === 'phone') return Math.round(box.y + box.height) === viewport.height && box.y > 0 ? 'alt' : `y=${box.y} h=${box.height}`;
    return Math.round(box.x + box.width) === viewport.width && Math.abs(box.width - 384) <= 1 ? 'sag-384' : `x=${box.x} w=${box.width}`;
  }, { message: 'filtre yüzeyinin yeri profile uymuyor' }).toBe(p === 'phone' ? 'alt' : 'sag-384');
  // Gövde kendi içinde kayar: en az bir seçenek görünür alanda.
  await expect(sayfa.getByRole('checkbox').first()).toBeInViewport();
  expect(await horizontalOverflow(page), 'filtre yüzeyi açıkken yatay taşma').toEqual([]);
  await uygula.click();
  await expect(sayfa).toBeHidden();
});
