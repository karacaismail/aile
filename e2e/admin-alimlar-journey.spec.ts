import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { enterKeyboardMode, gotoAdmin, horizontalOverflow } from './admin-helpers';
import { accentEdges, focusRing, overflow, selfCheckDetectors, smallText } from './admin-detectors';

// Alımlar ve eşyalar — uçtan uca kullanıcı yolculuğu (sentetik nesil). Tasarım: README › Sayfa iskeleti, ekranlar.md
// (EkranListe/Tablo/Kanban/Zaman, EkranAyrinti + dar biçimler), bundle.js Aile.Pages.Alimlar.
//
// Veri: webServer (playwright.admin.config.ts › syntheticServerEnv) AILE_GENERATION_DIR ile sentetik nesli zaten servis
// eder. Bu yolculuk yine de /__aile/generation/** isteklerini page.route ile aynı fixtures/generation-synthetic
// dosyalarından karşılar: page.route sahtesi sunucudan önceliklidir ve hangi dosyaların istendiğini kaydetmenin tek
// yoludur (manifest, purchase_needs; source_cells/source_rows asla). Sözleşme dev middleware ile aynı: _meta, yalnız
// .json, '..'/mutlak yol reddi, {error:'…'} gövdesi. Gerçek nesil, kasa yolu ve Sheet kimliği okunmaz.
//
// Beklenen kümeler fixture'dan hesaplanır (sabit sayı yazılmaz). Silinmiş (deleted_at) iki sentetik kayıt seçilen
// filtrelerin dışında tutulur: panelin silinmiş kayıtları gösterip göstermemesi bu yolculuğun konusu değildir.
// Projeler: chromium (320, telefon), chromium-desktop (1440), webkit (390, dokunmatik telefon). Seçiciler role/label.

// --- Sentetik nesil -------------------------------------------------------------------------------------------------
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && statSync(path.join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = path.join(FIXTURE_ROOT, GENERATION_ID);
const PREFIX = '/__aile/generation/';

interface Money { amount: string; currency: string }
interface Purchase {
  id: string;
  label: string;
  room_id: string | null;
  category_term_id: string | null;
  deleted_at: string | null;
  amounts: { planned?: Money | null; actual?: Money | null };
}
interface Term { id: string; label: string; parent_id: string | null; vocabulary_id: string }
interface Room { id: string; label: string }

const records = <T>(rel: string): T[] => (JSON.parse(readFileSync(path.join(GENERATION_DIR, rel), 'utf8')) as { records: T[] }).records;
const PURCHASES = records<Purchase>('data/purchase_needs/household/00000.json');
const TERMS = records<Term>('data/terms/global/00000.json');
const ROOMS = records<Room>('data/rooms/household/00000.json');
const ALL_LABELS = PURCHASES.map(record => record.label);
const byLabel = (label: string) => PURCHASES.find(record => record.label === label)!;
const roomId = (label: string) => ROOMS.find(room => room.label === label)!.id;
const sirali = (labels: Iterable<string>) => [...labels].sort((a, b) => a.localeCompare(b, 'tr-TR'));

const termById = new Map(TERMS.map(term => [term.id, term] as const));
/** Terim ve tüm ataları (ebeveyn seçimi alt dalı kapsar). */
function ataZinciri(id: string | null): string[] {
  const out: string[] = [];
  let cursor = id;
  while (cursor && !out.includes(cursor)) {
    out.push(cursor);
    cursor = termById.get(cursor)?.parent_id ?? null;
  }
  return out;
}
/**
 * Kategori ağacının kökü; kayda doğrudan atanmamış, altında iki düzey dal var (Aydınlatma › LED ve armatür …). Kök
 * seçimi torunları da kapsar. Alt dallar: kayıtlarda (kendisi ya da altı) kullanılan doğrudan çocuklar.
 */
const KATEGORI_UST = TERMS.find(term => term.label === 'Elektrik ve aydınlatma' && term.parent_id === null)!;
const KATEGORI_ALTLAR = TERMS.filter(term => term.parent_id === KATEGORI_UST.id && PURCHASES.some(record => ataZinciri(record.category_term_id).includes(term.id)));

const ODA_1 = 'Örnek oda 1';
const ODA_2 = 'Örnek oda 2';
const odaKumesi = (label: string) => PURCHASES.filter(record => record.room_id === roomId(label)).map(record => record.label);
const bilinmeyenOda = () => PURCHASES.filter(record => !record.room_id || !ROOMS.some(room => room.id === record.room_id)).map(record => record.label);
const kategoriKumesi = (termId: string) => PURCHASES.filter(record => ataZinciri(record.category_term_id).includes(termId)).map(record => record.label);

const para = (money: Money) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: money.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(money.amount));
const sayi = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

// Kayıtlar: kase (plan var, gerçek yok, fotoğraf yok, karar ekseninde Araştırılıyor), tencere (plan ve gerçek ayrı).
const KASE = 'Örnek kase';
const TENCERE = 'Örnek tencere';

/** /__aile/generation/** → fixture dosyası; dev middleware'in (src/admin/devServer/privateData.ts) sözleşmesiyle aynı. */
async function sentetikNesil(page: Page): Promise<string[]> {
  const istekler: string[] = [];
  await page.route('**/__aile/generation/**', async route => {
    const url = new URL(route.request().url());
    const index = url.pathname.indexOf(PREFIX);
    let rel: string | null = null;
    try {
      rel = decodeURIComponent(url.pathname.slice(index + PREFIX.length));
    } catch {
      rel = null;
    }
    istekler.push(rel ?? url.pathname);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: `${JSON.stringify(body)}\n` });
    if (!rel || rel.includes('\\') || rel.includes('\0') || rel.split('/').some(part => part === '' || part === '.' || part === '..')) return json(400, { error: 'Geçersiz yol' });
    if (rel === '_meta') return json(200, { generation_id: GENERATION_ID, selectedAt: new Date().toISOString() });
    if (!rel.endsWith('.json')) return json(404, { error: 'Yalnız .json dosyaları servis edilir' });
    const file = path.resolve(GENERATION_DIR, rel);
    if (!file.startsWith(`${GENERATION_DIR}${path.sep}`)) return json(400, { error: 'Geçersiz yol' });
    let body: Buffer;
    try {
      if (!statSync(file).isFile()) return json(404, { error: 'Dosya yok' });
      body = readFileSync(file);
    } catch {
      return json(404, { error: 'Dosya yok' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'cache-control': 'no-store' }, body });
  });
  return istekler;
}

// --- Sayfa yardımcıları ----------------------------------------------------------------------------------------------
type Cihaz = 'phone' | 'tablet' | 'desktop';
const cihaz = (page: Page): Cihaz => {
  const width = page.viewportSize()?.width ?? 1440;
  return width < 600 ? 'phone' : width < 1024 ? 'tablet' : 'desktop';
};

const sorgu = (page: Page) => page.getByRole('search', { name: 'Sorgu' });
const sonuclar = (page: Page) => page.getByRole('region', { name: 'Sonuçlar' });
const satir = (page: Page, label: string) => sonuclar(page).getByRole('button', { name: new RegExp(label) });
const ayrinti = (page: Page, label: string) => page.getByRole('dialog', { name: label });

async function acilis(page: Page): Promise<string[]> {
  const istekler = await sentetikNesil(page);
  await gotoAdmin(page, '/alimlar');
  await expect(page.getByRole('heading', { level: 1, name: 'Alımlar ve eşyalar' })).toBeVisible();
  await expect(sonuclar(page)).toBeVisible();
  // Hazır sinyali (openAdmin ile aynı): meşgul öğe kalmadı. Geniş profilde antd sağlayıcı geçidi tembel bağlanır ve
  // bağlanınca çalışma alanı bir kez yeniden kurulur (AdaptiveRoot kökü o ana kadar aria-busy); yolculuk ondan sonra.
  await expect(page.locator('[aria-busy="true"]'), 'yükleme ve sağlayıcı geçidi bitti').toHaveCount(0);
  return istekler;
}

/** QueryBar'ın "N sonuç" durum metni. */
async function sonucSayisi(page: Page): Promise<number> {
  const text = (await sorgu(page).getByText(/^[\d.]+ sonuç$/).textContent()) ?? '';
  return Number(text.replace(/\D/g, ''));
}
const sonucBekle = (page: Page, n: number) => expect(sorgu(page).getByText(`${sayi(n)} sonuç`, { exact: true })).toBeVisible();

/** Sonuç bölgesinde metni tam olarak alım adı olan öğelerden görünen ad kümesi (mod bağımsız; akordeon kapalı gövdesi dahil). */
async function gorunenAdlar(page: Page): Promise<string[]> {
  const found = await sonuclar(page).evaluate((root, labels) => {
    const set = new Set<string>();
    for (const element of Array.from(root.querySelectorAll('*'))) {
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (labels.includes(text)) set.add(text);
    }
    return [...set];
  }, ALL_LABELS);
  return sirali(found);
}

/** Filtre paneli: masaüstünde FilterArea içinde açık; dar ekranda "Filtreler (N)" telefonda alt sayfa, tablette sağ çekmece açar. */
async function filtrePaneli(page: Page): Promise<Locator> {
  if (cihaz(page) !== 'desktop') {
    await sorgu(page).getByRole('button', { name: /^Filtreler \(/ }).click();
    await expect(page.getByRole('dialog', { name: /^Filtreler/ })).toBeVisible();
  }
  // Masaüstünde FilterArea bölgesi ("Filtreler") FilterPanel bölümünü ("Filtreler") sarar; dıştaki kapsam olarak yeter.
  const panel = page.getByRole('region', { name: 'Filtreler', exact: true }).first();
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * Filtre seçimi sürerken sonuç sayısı: masaüstünde sorgu çubuğunda; dar ekranda çekmece altlığının canlı durum metninde
 * ("N sonuç") ve birincil "Uygula" düğmesinin açıklamasında (shell/FilterDrawer; seçim anında uygulanır).
 */
async function araSonuc(page: Page, beklenen: number) {
  if (cihaz(page) === 'desktop') return sonucBekle(page, beklenen);
  const dialog = page.getByRole('dialog', { name: /^Filtreler/ });
  await expect(dialog.getByRole('status').filter({ hasText: / sonuç$/ })).toHaveText(`${sayi(beklenen)} sonuç`);
  await expect(dialog.getByRole('button', { name: 'Uygula', exact: true })).toHaveAccessibleDescription(`${sayi(beklenen)} sonuç`);
}

/** Dar ekranda çekmece "Uygula" ile kapanır (sayı önce doğrulanır); odak sorgu çubuğundaki "Filtreler (N)" düğmesine döner. */
async function filtreKapat(page: Page, beklenen: number) {
  if (cihaz(page) === 'desktop') return;
  await araSonuc(page, beklenen);
  const dialog = page.getByRole('dialog', { name: /^Filtreler/ });
  await dialog.getByRole('button', { name: 'Uygula', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(sorgu(page).getByRole('button', { name: /^Filtreler \(\d+\)$/ })).toBeFocused();
}

/** Boyut bölümü (Disclosure bölgesi, adı "Oda" + isteğe bağlı "N seçili"); kapalıysa açılır. */
async function boyut(panel: Locator, ad: string): Promise<Locator> {
  const dugme = panel.getByRole('button', { name: new RegExp(`^${ad}`) });
  if ((await dugme.getAttribute('aria-expanded')) !== 'true') await dugme.click();
  const bolge = panel.getByRole('region', { name: new RegExp(`^${ad}`) });
  await expect(bolge).toBeVisible();
  return bolge;
}

async function isaretle(bolum: Locator, ad: string) {
  const kutu = bolum.getByRole('checkbox', { name: ad, exact: true });
  await kutu.click();
  await expect(kutu).toBeChecked();
}

const MOD_ANAHTARI: Record<string, string | null> = { Liste: null, Tablo: 'table', Kanban: 'kanban', 'Zaman çizelgesi': 'timeline' };

/** Görünüm modu: masaüstü/tablette radiogroup (Segmented), telefonda combobox (5+ seçenek → Select). */
async function modSec(page: Page, ad: string) {
  const grup = sorgu(page).getByRole('radiogroup', { name: 'Görünüm modu' });
  if (await grup.isVisible()) {
    // Segmented girdisi pointer-events: none; tıklama etiket metnine (QueryBar.test ile aynı).
    await grup.getByText(ad, { exact: true }).click();
    await expect(grup.getByRole('radio', { name: ad, exact: true })).toBeChecked();
  } else {
    await sorgu(page).getByRole('combobox', { name: 'Görünüm modu' }).click();
    await page.getByRole('option', { name: ad, exact: true }).click();
  }
  const key = MOD_ANAHTARI[ad];
  if (key) await expect(page).toHaveURL(new RegExp(`[?&]mod=${key}(&|$)`));
  else await expect(page).not.toHaveURL(/[?&]mod=/);
}

// --- Dedektörler (e2e/admin-detectors.ts) ----------------------------------------------------------------------------
// Paylaşılan dedektörler kendi içinde tamdır ve page.evaluate'e kaynak metin olarak gider (runDetector); kök seçiciyle
// daraltılır. Boş liste = temiz; ihlal metni assertion mesajında görünür.
/** Bu yolculuğun kapsamı: sayfa içeriği (kabuk/nav kuralları kendi spec'lerinde). Satır içi ayrıntı da burada çizilir. */
const KOK = '#admin-content';

// --- Yolculuk --------------------------------------------------------------------------------------------------------
test.describe('Alımlar yolculuğu (sentetik nesil)', () => {
  test('liste fixture nesliyle açılır; ağır kaynak hücreleri indirilmez; metin, kenar ve taşma kuralları', async ({ page }) => {
    const istekler = await acilis(page);
    expect(istekler).toContain('manifest.json');
    expect(istekler.some(rel => rel.startsWith('data/purchase_needs/'))).toBe(true);
    expect(istekler.filter(rel => /source_(cells|rows)/.test(rel)), 'panel source_cells/source_rows indirmez').toEqual([]);

    const toplam = await sonucSayisi(page);
    expect(toplam).toBeGreaterThan(0);
    expect(toplam).toBeLessThanOrEqual(PURCHASES.length);
    expect((await gorunenAdlar(page)).length).toBe(toplam);
    await expect(page.locator('select'), 'native select yok').toHaveCount(0);

    expect(await smallText(page, { root: KOK, min: 14 }), 'metin ≥ 14 CSS px').toEqual([]);
    expect(await accentEdges(page, { root: KOK }), 'radiuslu kutuda tek kenar renkli şerit').toEqual([]);
    expect(await overflow(page, { root: KOK }), 'taşma / kesilen etiket').toEqual([]);
    if (cihaz(page) === 'phone') expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
    // Dedektörler bu motor ve bu sayfanın CSS'i altında ihlali gerçekten yakalıyor (aksi hâlde yukarıdaki boş listeler anlamsız).
    expect(await selfCheckDetectors(page), 'ihlali yakalamayan dedektör').toEqual([]);
  });

  test('filtre: oda OR + "Bilinmiyor"; kategori üst terimi alt dalları kapsar; boyutlar arası AND; etkin etiketler', async ({ page }) => {
    await acilis(page);
    const toplam = await sonucSayisi(page);

    // Aynı boyutta OR: Oda 1 ∪ Oda 2 ∪ Bilinmiyor.
    const oda1 = odaKumesi(ODA_1);
    const oda12 = [...oda1, ...odaKumesi(ODA_2)];
    const oda12b = [...oda12, ...bilinmeyenOda()];
    expect(oda1.length).toBeGreaterThan(0);
    expect(oda12.length).toBeGreaterThan(oda1.length);
    expect(oda12b.length).toBeGreaterThan(oda12.length);

    let panel = await filtrePaneli(page);
    let oda = await boyut(panel, 'Oda');
    await isaretle(oda, ODA_1);
    await araSonuc(page, oda1.length);
    await isaretle(oda, ODA_2);
    await araSonuc(page, oda12.length);
    await isaretle(oda, 'Bilinmiyor');
    await araSonuc(page, oda12b.length);
    await filtreKapat(page, oda12b.length);
    await sonucBekle(page, oda12b.length);
    expect(await gorunenAdlar(page)).toEqual(sirali(oda12b));
    for (const etiket of [`Oda: ${ODA_1}`, `Oda: ${ODA_2}`, 'Oda: Bilinmiyor']) {
      await expect(sorgu(page).getByText(etiket, { exact: true })).toBeVisible();
    }

    // Etkin etiket kaldırılabilir: "Bilinmiyor" çıkınca sayı geri düşer.
    await sorgu(page).getByRole('button', { name: 'Oda: Bilinmiyor filtresini kaldır' }).click();
    await sonucBekle(page, oda12.length);
    await expect(sorgu(page).getByText('Oda: Bilinmiyor', { exact: true })).toHaveCount(0);
    expect(await gorunenAdlar(page)).toEqual(sirali(oda12));

    await sorgu(page).getByRole('button', { name: 'Tümünü temizle' }).click();
    await sonucBekle(page, toplam);
    await expect(sorgu(page).getByText('Etkin filtreler', { exact: true })).toHaveCount(0);

    // Kategori ağacı: üst terim seçilince alt dallar kapsanır (alt kutular işaretli görünür).
    const kapsanan = kategoriKumesi(KATEGORI_UST.id);
    expect(KATEGORI_ALTLAR.length).toBeGreaterThan(1);
    expect(kapsanan.length).toBeGreaterThan(0);
    expect(kapsanan.some(label => termById.get(byLabel(label).category_term_id ?? '')?.parent_id !== KATEGORI_UST.id), 'torun dalı da kapsanmalı').toBe(true);
    expect(PURCHASES.some(record => record.category_term_id === KATEGORI_UST.id), 'üst terim kayda doğrudan atanmamış olmalı').toBe(false);
    panel = await filtrePaneli(page);
    const kategori = await boyut(panel, 'Kategori');
    await expect(kategori.getByText('Üst kategori seçilince tüm alt dalları kapsar.')).toBeVisible();
    await isaretle(kategori, KATEGORI_UST.label);
    for (const alt of KATEGORI_ALTLAR) await expect(kategori.getByRole('checkbox', { name: alt.label, exact: true })).toBeChecked();
    await araSonuc(page, kapsanan.length);

    // Boyutlar arası AND: kategori ∩ oda "Bilinmiyor".
    const kesisim = kapsanan.filter(label => bilinmeyenOda().includes(label));
    expect(kesisim.length).toBeGreaterThan(0);
    expect(kesisim.length).toBeLessThan(kapsanan.length);
    oda = await boyut(panel, 'Oda');
    await isaretle(oda, 'Bilinmiyor');
    await araSonuc(page, kesisim.length);
    await filtreKapat(page, kesisim.length);
    await sonucBekle(page, kesisim.length);
    expect(await gorunenAdlar(page)).toEqual(sirali(kesisim));
    await expect(sorgu(page).getByText(`Kategori: ${KATEGORI_UST.label}`, { exact: true })).toBeVisible();
    await expect(sorgu(page).getByText('Oda: Bilinmiyor', { exact: true })).toBeVisible();
    // Filtre durumu hash'te taşınır (paylaşılabilir görünüm).
    await expect(page).toHaveURL(new RegExp(`category=${KATEGORI_UST.id}`));
  });

  test('modlar: Liste → Tablo → Kanban → Zaman çizelgesi aynı kayıt kümesi; Gantt devre dışı ve gerekçeli', async ({ page }) => {
    await acilis(page);
    const beklenen = sirali([...odaKumesi(ODA_1), ...odaKumesi(ODA_2), ...bilinmeyenOda()]);
    const panel = await filtrePaneli(page);
    const oda = await boyut(panel, 'Oda');
    await isaretle(oda, ODA_1);
    await isaretle(oda, ODA_2);
    await isaretle(oda, 'Bilinmiyor');
    await filtreKapat(page, beklenen.length);

    for (const mod of ['Liste', 'Tablo', 'Kanban', 'Zaman çizelgesi']) {
      if (mod !== 'Liste') await modSec(page, mod);
      await sonucBekle(page, beklenen.length);
      expect(await gorunenAdlar(page), `${mod}: aynı kayıt kümesi`).toEqual(beklenen);
      // Mod değişince filtre korunur.
      await expect(sorgu(page).getByText(`Oda: ${ODA_2}`, { exact: true })).toBeVisible();
    }
    await expect(page.locator('select'), 'native select yok').toHaveCount(0);

    // Gantt gizlenmez: devre dışıdır ve gerekçesi yazılıdır (view_definitions).
    const gerekce = /Gantt kullanılamaz: alımların başlangıç ve bitiş tarihi yok\./;
    await expect(sorgu(page).getByText(gerekce)).toBeVisible();
    const grup = sorgu(page).getByRole('radiogroup', { name: 'Görünüm modu' });
    if (await grup.isVisible()) {
      await expect(grup.getByRole('radio', { name: 'Gantt', exact: true })).toBeDisabled();
      await expect(grup).toHaveAccessibleDescription(gerekce);
    } else {
      await sorgu(page).getByRole('combobox', { name: 'Görünüm modu' }).click();
      const gantt = page.getByRole('option', { name: /^Gantt/ });
      await expect(gantt).toHaveAttribute('aria-disabled', 'true');
      await expect(gantt).toContainText('Kullanılamaz');
      await page.keyboard.press('Escape');
      await expect(gantt).toBeHidden();
    }
    await expect(page).toHaveURL(/[?&]mod=timeline(&|$)/);
  });

  test('ayrıntı: masaüstünde sağ panel, dar ekranda tam sayfa; Plan ve Gerçek ayrı; "Fotoğraf yok"; kapanınca odak satıra döner', async ({ page }) => {
    await acilis(page);
    const kase = byLabel(KASE);
    const kaseSatiri = satir(page, KASE);
    await kaseSatiri.click();
    const dialog = ayrinti(page, KASE);
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/alimlar/${kase.id}`));

    if (cihaz(page) === 'desktop') {
      // Sağda 384 sütun; liste görünür kalır, sayfa yatay kaymaz.
      const panelKutusu = (await dialog.boundingBox())!;
      const sonucKutusu = (await sonuclar(page).boundingBox())!;
      const width = page.viewportSize()!.width;
      expect(panelKutusu.x).toBeGreaterThanOrEqual(sonucKutusu.x + sonucKutusu.width - 1);
      expect(panelKutusu.x + panelKutusu.width).toBeLessThanOrEqual(width + 1);
      expect(Math.abs(panelKutusu.width - 384)).toBeLessThanOrEqual(24);
      await expect(sorgu(page)).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Kapat' })).toBeVisible();
    } else {
      // Tam sayfa: liste ve sorgu çubuğu gizli, üstte "Listeye dön".
      const panelKutusu = (await dialog.boundingBox())!;
      expect(panelKutusu.width).toBeGreaterThanOrEqual(page.viewportSize()!.width * 0.85);
      await expect(sorgu(page)).toBeHidden();
      await expect(sonuclar(page)).toBeHidden();
      await expect(dialog.getByRole('button', { name: 'Listeye dön' })).toBeVisible();
      expect(await horizontalOverflow(page), 'tam sayfa ayrıntıda yatay taşma').toEqual([]);
    }

    // Plan ve gerçek ayrı sütunlarda; gerçek yoksa "Henüz yok"; fotoğraf yoksa "Fotoğraf yok".
    const pg = dialog.getByRole('region', { name: 'Plan ve gerçek' });
    await expect(pg.getByRole('heading', { level: 3, name: 'Plan', exact: true })).toBeVisible();
    await expect(pg.getByRole('heading', { level: 3, name: 'Gerçek', exact: true })).toBeVisible();
    await expect(pg).toContainText(para(kase.amounts.planned!));
    await expect(pg).toContainText('Henüz yok');
    await expect(dialog.getByText('Fotoğraf yok', { exact: true })).toBeVisible();
    expect(await smallText(page, { root: KOK, min: 14 }), 'ayrıntıda metin ≥ 14 CSS px').toEqual([]);

    // Kapanış: odak açan satıra döner, hash seçimi bırakır.
    if (cihaz(page) === 'desktop') await dialog.getByRole('button', { name: 'Kapat' }).click();
    else await dialog.getByRole('button', { name: 'Listeye dön' }).click();
    await expect(dialog).toBeHidden();
    await expect(kaseSatiri).toBeFocused();
    await expect(page).not.toHaveURL(new RegExp(kase.id));

    // Plan ve gerçek tek sayıda birleşmez: tencerede iki tutar ayrı yazılır, toplamları hiçbir yerde yok.
    const tencere = byLabel(TENCERE);
    await satir(page, TENCERE).click();
    const tencereAyrinti = ayrinti(page, TENCERE);
    const tencerePg = tencereAyrinti.getByRole('region', { name: 'Plan ve gerçek' });
    await expect(tencerePg).toContainText(para(tencere.amounts.planned!));
    await expect(tencerePg).toContainText(para(tencere.amounts.actual!));
    const birlesik = para({ amount: String(Number(tencere.amounts.planned!.amount) + Number(tencere.amounts.actual!.amount)), currency: 'TRY' });
    await expect(tencereAyrinti).not.toContainText(birlesik);
  });

  test('"Durumu değiştir" yalnız iş akışı geçişini yerel yazar; etiket değişir; "Geri al" geri çevirir', async ({ page }) => {
    await acilis(page);
    const kaseSatiri = satir(page, KASE);
    await expect(kaseSatiri).toContainText('Araştırılıyor');
    await kaseSatiri.click();
    let dialog = ayrinti(page, KASE);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('combobox', { name: 'Durumu değiştir' }).click();
    // İş akışında olmayan geçiş sunulmaz (Araştırılıyor → Fikir yok).
    await expect(page.getByRole('option', { name: 'Karar bekliyor', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Fikir', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'Karar bekliyor', exact: true }).click();

    const bildirim = page.getByRole('status').filter({ hasText: /Araştırılıyor → Karar bekliyor/ });
    await expect(bildirim).toBeVisible();
    await expect(bildirim).toContainText('kaynağa yazılmadı');
    await expect(dialog).toContainText('Karar bekliyor');

    const listeyeDon = async () => {
      if (cihaz(page) === 'desktop') return;
      await dialog.getByRole('button', { name: 'Listeye dön' }).click();
      await expect(dialog).toBeHidden();
    };
    const yenidenAc = async () => {
      if (cihaz(page) === 'desktop') return;
      await kaseSatiri.click();
      dialog = ayrinti(page, KASE);
      await expect(dialog).toBeVisible();
    };

    await listeyeDon();
    await expect(kaseSatiri).toContainText('Karar bekliyor');
    await yenidenAc();

    await dialog.getByRole('button', { name: 'Geri al' }).click();
    await expect(page.getByText('Değişiklik geri alındı.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Geri al' })).toHaveCount(0);
    await listeyeDon();
    await expect(kaseSatiri).toContainText('Araştırılıyor');
    await expect(kaseSatiri).not.toContainText('Karar bekliyor');
  });

  test('klavye: Enter ayrıntıyı açar, Escape kapatır; odak satıra döner ve göstergesi halka değil alt çizgi', async ({ page, browserName }) => {
    await acilis(page);
    await enterKeyboardMode(page, browserName);
    const kaseSatiri = satir(page, KASE);
    await kaseSatiri.focus();
    await page.keyboard.press('Enter');
    const dialog = ayrinti(page, KASE);
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement)), { message: 'odak ayrıntıya girmedi' }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(kaseSatiri).toBeFocused();
    // Çevreleyen halka (outline, halka box-shadow, dört kenarlı çerçeve) hiçbir taşıyıcıda yok.
    const ihlaller = await focusRing(page, { keyboard: true });
    expect(ihlaller.filter(item => /halka|outline|çerçeve/.test(item)), ihlaller.join('\n')).toEqual([]);
    // Liste satırında gösterge satır genişliğinde, alt kenarda tek 3 px çizgi (ListRow README; tr/[role=row] ile aynı kural).
    // Not: paylaşılan dedektör satırı yalnız tr/[role=row]/.ant-list-item ile tanır; li > button satırını kontrol sayıp
    // 4 px altta bekler. Bu yüzden çizgi konumu burada açıkça ölçülür.
    const cizgi = await kaseSatiri.evaluate(element => {
      const after = getComputedStyle(element, '::after');
      return { content: after.content, height: parseFloat(after.height), width: parseFloat(after.width), bottom: after.bottom, background: after.backgroundColor, rowWidth: element.getBoundingClientRect().width };
    });
    expect(cizgi.content).not.toBe('none');
    expect(cizgi.height).toBe(3);
    expect(Math.abs(cizgi.width - cizgi.rowWidth)).toBeLessThanOrEqual(1);
    expect(cizgi.bottom).toBe('0px');
    expect(cizgi.background).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  });
});

// --- Dedektör öz denetimi: ihlal enjekte edilir → yakalanır; uyumlu örnek temiz kalır -------------------------------
// Sayfa düzeyindeki taşma kökten bağımsız raporlandığı için taşma ihlali temiz ölçümden SONRA enjekte edilir.
test.describe('Dedektör öz denetimi (yolculuğun kullandığı kurallar)', () => {
  const SAYFA = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
    body { margin: 0; font: 16px/1.5 sans-serif; }
    #kok { width: 280px; }
    .kucuk { font-size: 12px; }
    .yeterli { font-size: 14px; }
    .kavisli { border-radius: 12px; border-left: 4px solid rgb(37, 99, 235); padding: 16px; }
    .duz { border-radius: 0 12px 12px 0; border-left: 4px solid rgb(37, 99, 235); padding: 16px; }
    .tasan { width: calc(100vw + 400px); } /* her projede görünüm alanından geniş (1440 masaüstünde 900 px taşmaz) */
    .kesik { width: 60px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    button { position: relative; width: 120px; height: 44px; border: 0; outline: none; background: rgb(240, 240, 240); font-size: 16px; }
    #halka:focus { outline: 3px solid rgb(0, 0, 0); outline-offset: 2px; }
    #golge:focus { box-shadow: 0 0 0 3px rgb(0, 0, 0); }
    #cizgi:focus::after { content: ""; position: absolute; left: 0; right: 0; bottom: -7px; height: 3px; background: rgb(0, 0, 0); }
  </style></head><body>
    <div id="kok">
      <section id="metin-ihlal"><p class="kucuk">Fiyat yok</p></section>
      <section id="metin-temiz"><p class="yeterli">Henüz yok</p></section>
      <section id="kenar-ihlal"><div class="kavisli">Uyarı kutusu</div></section>
      <section id="kenar-temiz"><div class="duz">Düz şerit</div></section>
      <section id="tasma"><p class="yeterli">Sığan metin</p></section>
      <div><button id="halka">Halka</button></div>
      <div><button id="golge">Gölge</button></div>
      <div><button id="cizgi">Çizgi</button></div>
    </div>
  </body></html>`;

  test.beforeEach(async ({ page }) => {
    await page.setContent(SAYFA);
    await page.evaluate(() => document.documentElement.setAttribute('data-keyboard', 'true'));
  });

  test('küçük metin: 12 px yakalanır, 14 px temiz', async ({ page }) => {
    const ihlal = await smallText(page, { root: '#metin-ihlal', min: 14 });
    expect(ihlal).toHaveLength(1);
    expect(ihlal[0]).toMatch(/Fiyat yok/);
    expect(await smallText(page, { root: '#metin-temiz', min: 14 })).toEqual([]);
  });

  test('kavisli vurgu kenarı yakalanır; köşesi radiussuz düz şerit temiz', async ({ page }) => {
    expect((await accentEdges(page, { root: '#kenar-ihlal' })).length).toBeGreaterThan(0);
    expect(await accentEdges(page, { root: '#kenar-temiz' })).toEqual([]);
  });

  test('taşma ve kesilen eylem etiketi yakalanır; sığan içerik temiz', async ({ page }) => {
    expect(await overflow(page, { root: '#tasma', truncation: true })).toEqual([]);
    expect(await horizontalOverflow(page)).toEqual([]);
    await page.evaluate(() => {
      const kok = document.querySelector('#tasma')!;
      const genis = document.createElement('div');
      genis.className = 'tasan';
      genis.textContent = 'Geniş içerik';
      const kesik = document.createElement('button');
      kesik.className = 'kesik';
      kesik.textContent = 'Alım ekle ve kaydet';
      kok.append(genis, kesik);
    });
    const ihlal = await overflow(page, { root: '#tasma', truncation: true });
    expect(ihlal.some(item => /taşıyor/.test(item)), ihlal.join('\n')).toBe(true);
    expect(ihlal.some(item => /kesiliyor/.test(item)), ihlal.join('\n')).toBe(true);
    expect((await horizontalOverflow(page)).length, 'helpers.horizontalOverflow belge taşmasını yakalar').toBeGreaterThan(0);
  });

  test('odak: outline halkası ve box-shadow halkası yakalanır; 4 px altta 3 px çizgi temiz', async ({ page }) => {
    await page.locator('#halka').focus();
    expect((await focusRing(page, { keyboard: true })).some(item => /outline/.test(item))).toBe(true);
    await page.locator('#golge').focus();
    expect((await focusRing(page, { keyboard: true })).some(item => /box-shadow/.test(item))).toBe(true);
    await page.locator('#cizgi').focus();
    expect(await focusRing(page, { keyboard: true, thickness: 3, gap: 4 })).toEqual([]);
  });

  test('paylaşılan öz denetim bu tarayıcı motorunda her kuralın ihlalini yakalar', async ({ page }) => {
    expect(await selfCheckDetectors(page)).toEqual([]);
  });
});
