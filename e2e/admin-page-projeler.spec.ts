import { test, expect, type Locator, type Page } from '@playwright/test';
import { enterKeyboardMode, horizontalOverflow, openAdmin, shiftTabKey } from './admin-helpers';
import { focusRing, smallText } from './admin-detectors';

// Projeler ve görevler — uçtan uca kullanıcı yolculuğu (sentetik nesil; dev sunucusu AILE_GENERATION_DIR ile
// fixtures/generation-synthetic'i verir, Google'a istek yok). Tasarım: README › Sayfa iskeleti + Uyarlanır teslim,
// bundle.js › Pages.Projeler. Mobil önce: 320×568 telefon yolculuğu (başlık + amaç + ana eylem ilk ekranda → proje
// listesi → proje ayrıntısı → görevler akordeonu, seçim alttan açılan sayfada, "Listeye dön" odağı geri verir), sayfa
// yana kaymaz, telefon geniş-özel modülü (projeler/ProjelerGenis.wide, projeler/wide/) hiç istemez — dev sunucusu
// modülleri tek tek verdiği için ağ kaydı kanıttır. @matrix etiketli testler profil bağımsızdır; entegrasyonda
// 360/375/320×480/568×320 telefon, 820 tablet ve 1440 masaüstü projelerinde de koşar (geniş dal orada sınanır).
// Projeler: chromium (320×568 dokunmatik), webkit (390×844 dokunmatik). Seçiciler role/label; "bugün" sabit.

const ROUTE = '/projeler';
const BUGUN = new Date('2026-11-02T09:00:00+03:00');
const BASLIK = 'Projeler ve görevler';
const AMAC = 'Ev projelerini ve görevlerini kim, ne zaman ve hangi sırayla yapacak, görün.';
/** Geniş-özel modüller (dev sunucusu yolu). */
const GENIS_MODUL = /\/src\/admin\/pages\/projeler\/(?:ProjelerGenis\.wide\.tsx|wide\/)/;
const GOREV_DUGMESI = /^Örnek (tadilat işi|kilometre taşı) \d/;

type Profil = 'phone' | 'tablet' | 'desktop';

async function ac(page: Page): Promise<{ main: Locator; istekler: string[] }> {
  await page.clock.setFixedTime(BUGUN);
  const istekler: string[] = [];
  page.on('request', request => istekler.push(new URL(request.url()).pathname));
  const main = await openAdmin(page, ROUTE);
  return { main, istekler };
}

const profil = (page: Page) => page.evaluate(() => document.documentElement.dataset.profile as Profil);
const kaba = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'));
const genisIstekleri = (istekler: readonly string[]) => istekler.filter(path => GENIS_MODUL.test(path));

/** Öğe görünüm alanının içinde mi (kaydırmadan görünür). */
async function ilkEkranda(page: Page, locator: Locator) {
  const vp = page.viewportSize()!;
  const box = (await locator.boundingBox())!;
  expect(box, 'kutu').not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
}

/**
 * Dokunma hedefi: 44 px; kaba (coarse) girişte 48 px. Yumuşak doğrulama: ihlal testi kırmızı yapar ama yolculuğun
 * geri kalanı yine sınanır (ör. ortak Select'in alt sayfa seçeneği; sahibi a03-select).
 */
async function hedefBoyu(page: Page, locator: Locator, ad: string) {
  const asgari = (await kaba(page)) ? 48 : 44;
  const box = (await locator.boundingBox())!;
  expect.soft(box.height, `${ad}: hedef yüksekliği ≥ ${asgari}`).toBeGreaterThanOrEqual(asgari - 0.5);
  expect.soft(box.width, `${ad}: hedef genişliği ≥ ${asgari}`).toBeGreaterThanOrEqual(asgari - 0.5);
}

/** Liste satırı odağı (README › Odak): halka/outline yok; klavye modunda satırın alt kenarında, satır genişliğinde tek 3 px çizgi. */
async function satirOdagi(locator: Locator) {
  return locator.evaluate(el => {
    const s = getComputedStyle(el);
    const after = getComputedStyle(el, '::after');
    const r = el.getBoundingClientRect();
    return {
      outline: s.outlineStyle === 'none' || parseFloat(s.outlineWidth) === 0,
      shadow: s.boxShadow,
      content: after.content,
      height: parseFloat(after.height),
      width: parseFloat(after.width),
      bottom: after.bottom,
      rowWidth: r.width,
    };
  });
}

test.describe('Projeler › telefon yolculuğu', () => {
  test('başlık + amaç + ana eylem ilk ekranda; proje listesi → ayrıntı → görevler; seçim alttan; geri dönüş; geniş kod yok', async ({ page }) => {
    const { main, istekler } = await ac(page);
    test.skip((await profil(page)) !== 'phone', 'telefon profili (chromium 320, webkit 390)');
    const vp = page.viewportSize()!;

    // 1) Başlık iskeleti ve ana eylem ilk ekranda; eylemin nedeni yazılı (yazma bu sürümde yok).
    const h1 = main.getByRole('heading', { level: 1, name: BASLIK });
    await expect(h1).toBeVisible();
    await expect(main.getByText(AMAC)).toBeVisible();
    const ekle = main.getByRole('button', { name: 'Görev ekle' });
    await expect(ekle).toBeVisible();
    await expect(ekle).toBeDisabled();
    await expect(ekle).toHaveAccessibleDescription('Proje ve görev kaydı bu sürümde yalnız e-tablodan gelir; panelden ekleme henüz yok.');
    await ilkEkranda(page, h1);
    await ilkEkranda(page, ekle);
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);

    // 2) Proje listesi: iki proje (aşamaya göre), plan ve gerçek ayrı; tablo / sorgu çubuğu / Kanban / Gantt yok.
    const projeler = main.getByRole('region', { name: 'Projeler' });
    await expect(projeler).toContainText('Kaynakta ayrı proje kaydı yok; görevler proje aşamasına göre toplanır.');
    await expect(projeler.getByRole('button')).toHaveCount(2);
    const once = projeler.getByRole('button', { name: 'Taşınma öncesi' });
    await expect(once).toContainText('Planlanan');
    await expect(once).toContainText('₺290.400,00');
    await expect(once).toContainText('Gerçekleşen');
    await expect(once).toContainText('₺103.300,00');
    await hedefBoyu(page, once, 'proje satırı');
    await expect(main.getByRole('table')).toHaveCount(0);
    await expect(main.getByRole('search', { name: 'Sorgu' })).toHaveCount(0);
    await expect(main.getByRole('region', { name: 'Gantt çizelgesi, yana kaydırılabilir' })).toHaveCount(0);

    // 3) Proje ayrıntısı tam sayfa: odak başlıkta; görevler akordeonda, ilk satır açık.
    await once.click();
    const ayrinti = main.getByRole('region', { name: 'Taşınma öncesi' });
    await expect(ayrinti.getByRole('heading', { level: 2, name: 'Taşınma öncesi' })).toBeFocused();
    await expect(main.getByRole('region', { name: 'Projeler' })).toHaveCount(0);
    await expect(main.getByRole('region', { name: 'Kontroller' })).toHaveCount(0);
    await expect(ayrinti.getByRole('button', { name: GOREV_DUGMESI })).toHaveCount(10);
    await expect(ayrinti.getByRole('button', { name: /^Örnek tadilat işi 1(?!\d)/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(ayrinti.getByRole('table')).toHaveCount(0);
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);

    // 4) "Göster" seçimi alttan açılan sayfada (alt kenara oturur); "Açık görevler" biten üç görevi gizler.
    await ayrinti.getByRole('combobox', { name: 'Göster' }).click();
    const sayfa = page.getByRole('dialog', { name: 'Göster' });
    await expect(sayfa).toBeVisible();
    await expect.poll(async () => {
      const box = await sayfa.boundingBox();
      return box ? Math.round(box.y + box.height) : -1;
    }).toBe(vp.height);
    const acik = sayfa.getByRole('option', { name: /^Açık görevler/ });
    await hedefBoyu(page, acik, 'alt sayfa seçeneği');
    await acik.click();
    await expect(sayfa).toBeHidden();
    await expect(ayrinti.getByRole('button', { name: GOREV_DUGMESI })).toHaveCount(7);
    await expect(ayrinti.getByRole('button', { name: /^Örnek tadilat işi 1(?!\d)/ })).toHaveCount(0);

    // 5) "Listeye dön": liste geri gelir, odak açılan projede.
    await ayrinti.getByRole('button', { name: 'Listeye dön' }).click();
    await expect(main.getByRole('button', { name: 'Taşınma öncesi' })).toBeFocused();
    await expect(main.getByRole('region', { name: 'Kontroller' })).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);

    // 6) Telefon geniş-özel modülü hiç istemedi.
    expect(genisIstekleri(istekler)).toEqual([]);
  });

  test('klavye: proje satırında halka yok, satır altında tek çizgi; Enter ayrıntıyı açar, "Listeye dön" odağı geri verir', async ({ page, browserName }) => {
    const { main } = await ac(page);
    test.skip((await profil(page)) !== 'phone', 'telefon profili');
    const once = main.getByRole('button', { name: 'Taşınma öncesi' });

    // İşaretçi modunda (klavye modu kapalı) odak göstergesi görünmez.
    await once.focus();
    const isaretci = await satirOdagi(once);
    expect(isaretci.outline).toBe(true);
    expect(isaretci.shadow).toBe('none');
    expect(['none', 'normal']).toContain(isaretci.content);

    await enterKeyboardMode(page, browserName);
    await once.focus();
    const klavye = await satirOdagi(once);
    expect(klavye.outline).toBe(true);
    expect(klavye.shadow).toBe('none');
    expect(klavye.content).not.toBe('none');
    expect(klavye.height).toBe(3);
    expect(Math.abs(klavye.width - klavye.rowWidth)).toBeLessThanOrEqual(1);
    expect(klavye.bottom).toBe('0px');

    await page.keyboard.press('Enter');
    const ayrinti = main.getByRole('region', { name: 'Taşınma öncesi' });
    const baslik = ayrinti.getByRole('heading', { level: 2, name: 'Taşınma öncesi' });
    await expect(baslik).toBeFocused();
    // Programatik odak (başlık) da göstergeyi korur: başlığın altında tek çizgi, halka yok.
    expect(await focusRing(page)).toEqual([]);

    await page.keyboard.press(shiftTabKey(browserName));
    const geri = ayrinti.getByRole('button', { name: 'Listeye dön' });
    await expect(geri).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
    await page.keyboard.press('Enter');
    await expect(main.getByRole('button', { name: 'Taşınma öncesi' })).toBeFocused();
  });

  test('şablonlar: Türkçe ad ve sürüm; ham makine anahtarı yalnız açılan ayrıntıda "Teknik anahtar" etiketiyle', async ({ page }) => {
    const { main } = await ac(page);
    const bolum = main.getByRole('region', { name: 'Önerilen görev şablonları' });
    await bolum.scrollIntoViewIfNeeded();
    await expect(bolum).toContainText('15 şablon');
    // Görünür metinde hiçbir snake_case makine anahtarı yok (kapalı ayrıntılar gizli).
    const gorunur = await bolum.evaluate(el => (el as HTMLElement).innerText);
    expect(gorunur).not.toMatch(/\b[a-z]+(?:_[a-z]+)+\b/);
    const garanti = bolum.getByRole('button', { name: /^Garanti ve bakım bilgilerini kaydet/ });
    await expect(garanti).toContainText('Sürüm 1');
    await garanti.click();
    await expect(garanti).toHaveAttribute('aria-expanded', 'true');
    // Açılan ayrıntı (aria-controls): bağımlılık Türkçe adla, ham anahtar "Teknik anahtar" etiketinin altında.
    const panelId = await garanti.getAttribute('aria-controls');
    expect(panelId, 'satır ayrıntı bölgesini adlandırır').toBeTruthy();
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(panel.getByText('Teknik anahtar', { exact: true })).toBeVisible();
    await expect(panel.getByText('register_warranty_and_maintenance', { exact: true })).toBeVisible();
    await expect(panel.getByText('İşin kabul kontrolünü kaydet', { exact: true })).toBeVisible();
    await expect(panel.getByText('inspect_and_accept', { exact: true })).toHaveCount(0);
    // Diğer şablonların anahtarları kapalı ayrıntıda kalır (görünmez).
    expect(await bolum.evaluate(el => (el as HTMLElement).innerText.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])).toEqual(['register_warranty_and_maintenance']);
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);
  });
});

test.describe('Projeler › uyarlamalı teslim', () => {
  test('profil: telefon proje listesi ve geniş kod yok; geniş profil sorgu çubuğu + Tablo/Kanban/Gantt (lazyWide) @matrix', { tag: '@matrix' }, async ({ page, browserName }) => {
    const { main, istekler } = await ac(page);
    const p = await profil(page);
    const h1 = main.getByRole('heading', { level: 1, name: BASLIK });
    const ekle = main.getByRole('button', { name: 'Görev ekle' });
    await expect(h1).toBeVisible();
    await expect(main.getByText(AMAC)).toBeVisible();
    await expect(ekle).toBeVisible();
    await ilkEkranda(page, h1);
    // Ana eylem kaydırmayla ulaşılabilir ve görünüm alanına tam sığar (yapışkan öğe altında kalmaz).
    await ekle.scrollIntoViewIfNeeded();
    await ilkEkranda(page, ekle);
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);

    if (p === 'phone') {
      const projeler = main.getByRole('region', { name: 'Projeler' });
      await expect(projeler.getByRole('button')).toHaveCount(2);
      await expect(main.getByRole('search', { name: 'Sorgu' })).toHaveCount(0);
      const sonra = projeler.getByRole('button', { name: 'Taşınma sonrası' });
      await hedefBoyu(page, sonra, 'proje satırı');
      await sonra.click();
      const ayrinti = main.getByRole('region', { name: 'Taşınma sonrası' });
      await expect(ayrinti.getByRole('button', { name: GOREV_DUGMESI })).toHaveCount(2);
      expect(await horizontalOverflow(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
      await ayrinti.getByRole('button', { name: 'Listeye dön' }).click();
      await expect(main.getByRole('button', { name: 'Taşınma sonrası' })).toBeFocused();
      expect(genisIstekleri(istekler)).toEqual([]);
      return;
    }

    // Geniş: çalışma alanı lazyWide ile geldi (ağda geniş modül var); telefonun proje listesi yerini ona bıraktı.
    const sorgu = main.getByRole('search', { name: 'Sorgu' });
    await expect(sorgu).toBeVisible();
    expect(genisIstekleri(istekler).length).toBeGreaterThan(0);
    await expect(main.getByRole('region', { name: 'Projeler' })).toHaveCount(0);
    await expect(main.getByRole('table', { name: 'Görevler' }).or(main.getByRole('button', { name: GOREV_DUGMESI }).first())).toBeVisible();

    // Gantt: proje satırı + görevler; yatay kaydırma yalnız çizelgenin içinde, sayfa kaymaz.
    const modlar = main.getByRole('radiogroup', { name: 'Görünüm modu' });
    if (await modlar.count()) await modlar.getByText('Gantt', { exact: true }).click();
    else {
      await main.getByRole('combobox', { name: 'Görünüm modu' }).click();
      await page.getByRole('option', { name: /^Gantt/ }).click();
    }
    const cizelge = main.getByRole('region', { name: 'Gantt çizelgesi, yana kaydırılabilir' });
    await expect(cizelge).toBeVisible();
    await expect(cizelge.getByRole('img', { name: 'Proje Taşınma öncesi: 03.11.2026 – 20.06.2027' })).toBeAttached();
    await expect(cizelge.getByRole('img', { name: /^Örnek/ })).toHaveCount(12);
    const kayar = await cizelge.evaluate(el => el.scrollWidth > el.clientWidth);
    expect(kayar).toBe(true);
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);

    // Odak (b04): kaydırma kabı odaklanınca halka yok; tek çizgiyi kaydırmayan sarmalayıcı çizer, yalnız klavye modunda.
    await cizelge.focus();
    await expect(cizelge).toBeFocused();
    expect(await focusRing(page), 'işaretçi modunda gösterge yok').toEqual([]);
    await enterKeyboardMode(page, browserName);
    await cizelge.focus();
    await expect(cizelge).toBeFocused();
    expect(await focusRing(page), 'klavye modunda tek alt çizgi').toEqual([]);
    const cizgi = await cizelge.evaluate(el => getComputedStyle(el.parentElement!, '::after').content);
    expect(cizgi).not.toBe('none');
    // Klavyeyle yana kaydırma her motorda aynı: → bir hafta, End son, Home baş; odak çizelgede kalır, sayfa kaymaz.
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => cizelge.evaluate(el => el.scrollLeft), { message: 'ok tuşu çizelgeyi yana kaydırır' }).toBeGreaterThan(0);
    await page.keyboard.press('End');
    await expect.poll(() => cizelge.evaluate(el => Math.round(el.scrollWidth - el.clientWidth - el.scrollLeft)), { message: 'End sona götürür' }).toBeLessThanOrEqual(1);
    await page.keyboard.press('Home');
    await expect.poll(() => cizelge.evaluate(el => el.scrollLeft), { message: 'Home başa döner' }).toBe(0);
    await expect(cizelge).toBeFocused();
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});
