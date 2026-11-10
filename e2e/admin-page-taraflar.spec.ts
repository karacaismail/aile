import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { enterKeyboardMode, gotoAdmin, horizontalOverflow, openAdmin } from './admin-helpers';
import { accentEdges, focusRing, overflow, smallText } from './admin-detectors';

// Taraflar ve teklifler — kritik kullanıcı yolculuğu. Tasarım: bundle.js Aile.Pages.Taraflar (SayfaTaraflar /
// SayfaTaraflarDar), README › Sayfa iskeleti, Veri durumları, Uyarlanır teslim; CLAUDE.md arayüz kuralları.
// Önce telefon: chromium 320×568 ve webkit 390×844 (dokunmatik). @matrix etiketli testler entegrasyonda 360/375,
// 320×480, 568×320 (telefon profili), tablet ve masaüstü projelerinde de koşar; beklentiler o koşudaki profile göre.
//
// Veri: dev sunucusu sentetik nesli (fixtures/generation-synthetic) /__aile/generation/** yolundan verir. Teklif, işi
// yapan ve usta verisi gereken testler yalnız değişen dosyaları page.route ile sunar (manifest hash'i ve bayt sayısı
// yeniden yazılır; bütünlük denetimi gerçek kalır); geri kalan istekler sunucuya düşer. Gerçek nesil okunmaz.

const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && statSync(path.join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = path.join(FIXTURE_ROOT, GENERATION_ID);
const PREFIX = '/__aile/generation/';
const KOK = '#admin-content';

interface Money { amount: string; currency: string }
interface Kayit {
  id: string;
  label?: string;
  deleted_at?: string | null;
  attributes?: Record<string, unknown>;
  amounts: Record<string, Money | null | undefined>;
  [key: string]: unknown;
}
interface ManifestFile { path: string; kind: string; sha256: string; bytes: number; collection?: string; count?: number }
interface Manifest { tenant_id: string; counts: Record<string, number>; files: ManifestFile[] }

const okuJson = <T>(rel: string): T => JSON.parse(readFileSync(path.join(GENERATION_DIR, rel), 'utf8')) as T;
const MANIFEST = okuJson<Manifest>('manifest.json');
const bolumYolu = (collection: string) => MANIFEST.files.find(file => file.collection === collection)!.path;
const kayitlar = (collection: string) => okuJson<{ records: Kayit[] }>(bolumYolu(collection)).records;
const IS = kayitlar('work_orders').filter(record => !record.deleted_at);
const ALIM = kayitlar('purchase_needs').filter(record => !record.deleted_at);
const PROVIDERS_YOLU = 'data/providers/household/00000.json';

interface Degisiklik {
  work_orders?(records: Kayit[]): void;
  purchase_needs?(records: Kayit[]): void;
  relations?(records: Record<string, unknown>[]): void;
  providers?: Kayit[];
}

/** Değişen bölümleri ve manifesti page.route ile sunar; diğer istekler dev sunucusuna düşer. İstenen yolları döndürür. */
async function nesil(page: Page, degisiklik: Degisiklik = {}): Promise<string[]> {
  const manifest = structuredClone(MANIFEST);
  const dosyalar = new Map<string, string>();
  const yaz = (collection: string, rel: string, records: unknown[]) => {
    const text = JSON.stringify({ schemaVersion: 1, collection, records });
    const entry = { path: rel, kind: 'partition', sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text), collection, count: records.length };
    const index = manifest.files.findIndex(file => file.path === rel);
    if (index >= 0) manifest.files[index] = entry;
    else manifest.files.push(entry);
    manifest.counts[collection] = records.length;
    dosyalar.set(rel, text);
  };
  for (const collection of ['work_orders', 'purchase_needs', 'relations'] as const) {
    const mutate = degisiklik[collection] as ((records: unknown[]) => void) | undefined;
    if (!mutate) continue;
    const records = structuredClone(okuJson<{ records: unknown[] }>(bolumYolu(collection)).records);
    mutate(records);
    yaz(collection, bolumYolu(collection), records);
  }
  if (degisiklik.providers) yaz('providers', PROVIDERS_YOLU, degisiklik.providers);
  if (dosyalar.size > 0) dosyalar.set('manifest.json', JSON.stringify(manifest));

  const istekler: string[] = [];
  await page.route('**/__aile/generation/**', async route => {
    const url = new URL(route.request().url());
    const rel = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(PREFIX) + PREFIX.length));
    istekler.push(rel);
    const body = dosyalar.get(rel);
    if (body === undefined) return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'cache-control': 'no-store' }, body });
  });
  return istekler;
}

/** Teklif (iş emri + alım) ve İşi yapan (is_kim) verisi. İş emrinde plan ve gerçek de var: üçü ayrı yazılmalı. */
const TEKLIFLI: Degisiklik = {
  work_orders: records => {
    const is0 = records.find(record => record.id === IS[0]!.id)!;
    is0.amounts = { ...is0.amounts, quote: { amount: '9000.00', currency: 'TRY' }, planned: { amount: '17000.00', currency: 'TRY' }, actual: { amount: '8200.00', currency: 'TRY' } };
    is0.attributes = { ...is0.attributes, is_kim: ['elektrikci', 'boyaci'] };
    const is1 = records.find(record => record.id === IS[1]!.id)!;
    is1.attributes = { ...is1.attributes, is_kim: ['elektrikci'] };
  },
  purchase_needs: records => {
    const alim = records.find(record => record.id === ALIM[0]!.id)!;
    alim.amounts = { ...alim.amounts, quote: { amount: '650', currency: 'TRY' } };
  },
};

/**
 * normalize.mjs biçiminde usta (provider) kaydı. base() her kalem satırına tablonun source_id'sini yazar; usta satırları
 * alımlarla aynı app_kalemler tablosundan gelir ve sözleşme (AppRecord) bu kimliği zorunlu tutar.
 */
function usta(n: number, attributes: Record<string, unknown>, quote: string | null): Kayit {
  const kod = `kalem-9${String(n).padStart(2, '0')}`;
  return {
    id: `7a000000-0000-4000-8000-${String(n).padStart(12, '0')}`, tenant_id: MANIFEST.tenant_id, kind: 'provider',
    label: typeof attributes.ad === 'string' ? attributes.ad : kod, source_id: ALIM[0]!.source_id, source_record_id: kod,
    attributes: { deleted_at: null, ...attributes }, source_attributes: { tip: 'usta', id: kod },
    category_term_id: null, phase_term_id: null, context_term_ids: [],
    state_snapshot: { decision: null, fulfillment: null, inspection: null, payment: null },
    state_term_ids: { decision: null, fulfillment: null, inspection: null, payment: null },
    amounts: { quote: quote === null ? null : { amount: quote, currency: 'TRY' } }, dates: {}, room_id: null, deleted_at: null, provenance: null,
  };
}
const ALI = usta(1, { ad: 'Usta Ali', meslek: 'elektrik', telefon: '0532 123 45 67', teklif_sure_gun: '5', garanti_ay: '24', myk_dogrulandi: true }, '17450.00');
const MUTFAK = usta(2, { ad: 'Mutfak Dünyası', meslek: 'diger', telefon: '0212 555 10 10' }, '18900');
const USTALI: Degisiklik = {
  providers: [ALI, MUTFAK],
  relations: records => {
    records.push(
      { id: '7b000000-0000-4000-8000-000000000001', tenant_id: MANIFEST.tenant_id, kind: 'associated_with', source_id: ALI.id, target_id: ALIM[0]!.id },
      { id: '7b000000-0000-4000-8000-000000000002', tenant_id: MANIFEST.tenant_id, kind: 'associated_with', source_id: ALIM[0]!.id, target_id: MUTFAK.id },
    );
  },
};

// --- Yardımcılar ------------------------------------------------------------------------------------------------------
type Profil = 'phone' | 'tablet' | 'desktop';
/** src/admin/adaptive/profile.ts ile aynı eşikler: genişlik < 600 ya da kısa kenar < 480 → telefon. */
function beklenenProfil(page: Page): Profil {
  const { width, height } = page.viewportSize()!;
  if (width < 600 || Math.min(width, height) < 480) return 'phone';
  return width < 1024 ? 'tablet' : 'desktop';
}

/** Geniş-özel kaynak istekleri (dev: /src/admin/pages/taraflar/*.wide.tsx|css). */
function genisIstekleri(page: Page): string[] {
  const out: string[] = [];
  page.on('request', request => {
    if (/\/pages\/taraflar\/[^/?]+\.wide\.(tsx|css)/.test(request.url())) out.push(new URL(request.url()).pathname);
  });
  return out;
}

const bolum = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
/** Özet ölçüsü: etiketi tam eşleşen madde ("Teklif", "en az iki teklifli kayıt" notlu "Karşılaştırma" değil). */
const ozet = (page: Page, label: string) =>
  page.getByRole('list', { name: 'Özet' }).getByRole('listitem').filter({ has: page.getByText(label, { exact: true }) });
const tazelik = (page: Page) => page.locator('[role="status"][data-state]');
/** Açılır satırın gövdesindeki etiket–değer çifti (AccordionList dt/dd). */
const deger = (govde: Locator, etiket: string) => govde.locator('dt', { hasText: new RegExp(`^${etiket}$`) }).locator('xpath=following-sibling::dd[1]');
const govdeOf = async (page: Page, satir: Locator) => page.locator(`[id="${await satir.getAttribute('aria-controls')}"]`);

/**
 * Taraf satırının iletişim bağlantılarını görünür kılar. Telefonda taraf satırı akordeondur: kapalıysa açılır. Masaüstünde
 * taraf tablosu tembel gelir (beklerken telefon listesi yedektir); bağlantılar tablo satırında doğrudan görünür, bu yüzden
 * önce tablonun satırı beklenir (yedek listeden yeni çizilen tabloya geçiş anında düğme okunmaz).
 */
async function tarafIletisimi(page: Page, bolge: Locator, ad: string) {
  if (beklenenProfil(page) === 'desktop') {
    await expect(bolge.getByRole('table', { name: 'Taraflar' }).getByRole('row', { name: new RegExp(ad) })).toBeVisible();
    return;
  }
  const satir = bolge.getByRole('button', { name: new RegExp(ad) });
  if ((await satir.getAttribute('aria-expanded')) !== 'true') await satir.click();
}

async function kurallar(page: Page) {
  expect(await smallText(page, { root: KOK, min: 14 }), 'metin ≥ 14 CSS px').toEqual([]);
  expect(await accentEdges(page, { root: KOK }), 'radiuslu kutuda tek kenar renkli şerit').toEqual([]);
  expect(await overflow(page, { root: KOK }), 'taşma / kesilen etiket').toEqual([]);
  expect(await horizontalOverflow(page), 'sayfa düzeyinde yatay taşma').toEqual([]);
}

// --- Yolculuk ---------------------------------------------------------------------------------------------------------
test.describe('Taraflar ve teklifler', () => {
  test('ilk ekran: başlık, amaç, ana eylem ve tazelik; boş durumlar adıyla; profil, metin, kenar ve taşma kuralları', { tag: '@matrix' }, async ({ page }) => {
    const istekler = await nesil(page);
    const main = await openAdmin(page, '/taraflar');
    await expect(page.locator('html')).toHaveAttribute('data-profile', beklenenProfil(page));

    const h1 = main.getByRole('heading', { level: 1, name: 'Taraflar ve teklifler' });
    await expect(h1).toBeVisible();
    await expect(main.getByText('Satıcıları, ustaları ve gelen teklifleri tek yerde karşılaştırın.')).toBeVisible();
    const kaydet = main.getByRole('button', { name: 'Teklif kaydet' });
    await expect(kaydet).toBeVisible();
    await expect(kaydet).toBeDisabled();
    await expect(kaydet).toHaveAccessibleDescription(/e-tablo/);
    // Kısa yükseklik dışında ana eylem ilk ekrandadır; kısa ekranda kaydırılarak erişilir (sayfa dikey kayar).
    if (page.viewportSize()!.height >= 568) await expect(kaydet).toBeInViewport();
    else {
      await kaydet.scrollIntoViewIfNeeded();
      await expect(kaydet).toBeInViewport();
    }
    await expect(tazelik(page)).toContainText(`Nesil ${GENERATION_ID.slice(0, 6)}`);

    await expect(ozet(page, 'Taraf kaydı')).toContainText('Henüz yok');
    await expect(ozet(page, 'Teklif')).toContainText('Henüz yok');
    await expect(bolum(page, 'Teklifler')).toContainText('Kaynakta teklif yok');
    await expect(bolum(page, 'Taraflar')).toContainText('Kaynakta taraf kaydı yok');
    await expect(bolum(page, 'İşi yapanlar')).toContainText('Kaynakta işi yapan bilgisi yok');
    await expect(bolum(page, 'Taraflar').getByRole('link'), 'kaynakta telefon yokken uydurma bağlantı yok').toHaveCount(0);
    await expect(page.locator('select'), 'native select yok').toHaveCount(0);

    // Gerekli koleksiyonlar okunur; providers yokken bağlar (relations) ve ağır kaynak dökümleri indirilmez.
    expect(istekler.some(rel => rel.startsWith('data/work_orders/'))).toBe(true);
    expect(istekler.some(rel => rel.startsWith('data/purchase_needs/'))).toBe(true);
    expect(istekler.filter(rel => /^data\/(relations|providers|source_cells|source_rows)\//.test(rel))).toEqual([]);
    await kurallar(page);
  });

  test('teklif ve işi yapan verisi: telefonda akordeon (ilk satır açık), genişte karşılaştırma; plan, gerçek ve teklif ayrı', { tag: '@matrix' }, async ({ page, browserName }) => {
    const genis = genisIstekleri(page);
    await nesil(page, TEKLIFLI);
    await openAdmin(page, '/taraflar');
    const teklifler = bolum(page, 'Teklifler');
    const profil = beklenenProfil(page);
    await expect(ozet(page, 'Teklif')).toContainText('2');
    await expect(teklifler).toContainText('2 teklif · 2 kayıt');

    if (profil === 'phone') {
      const satirlar = teklifler.getByRole('button', { name: /Taraf bilinmiyor/ });
      await expect(satirlar).toHaveCount(2);
      await expect(satirlar.first()).toHaveAttribute('aria-expanded', 'true');
      await expect(satirlar.nth(1)).toHaveAttribute('aria-expanded', 'false');
      await expect(teklifler.getByRole('table')).toHaveCount(0);

      const isGrubu = teklifler.getByRole('region', { name: new RegExp(IS[0]!.label!) });
      const isSatiri = isGrubu.getByRole('button', { name: /Taraf bilinmiyor/ });
      if ((await isSatiri.getAttribute('aria-expanded')) !== 'true') await isSatiri.click();
      const govde = await govdeOf(page, isSatiri);
      await expect(deger(govde, 'Teklif')).toHaveText('₺9.000,00');
      await expect(deger(govde, 'Planlanan')).toHaveText('₺17.000,00');
      await expect(deger(govde, 'Gerçekleşen')).toHaveText('₺8.200,00');
      await expect(deger(govde, 'İletişim')).toHaveText('Bilinmiyor');

      const isiYapanlar = bolum(page, 'İşi yapanlar');
      await expect(isiYapanlar.getByRole('listitem').filter({ hasText: 'Elektrikçi' })).toContainText('2 iş');
      await expect(isiYapanlar.getByRole('table')).toHaveCount(0);
      expect(genis, 'telefon geniş-özel modül indirmez').toEqual([]);

      // Klavye: satır başlığı Enter ile açılır; odak göstergesi halka değil.
      await enterKeyboardMode(page, browserName);
      const ikinci = satirlar.nth(1);
      const durum = await ikinci.getAttribute('aria-expanded');
      await ikinci.focus();
      await page.keyboard.press('Enter');
      await expect(ikinci).toHaveAttribute('aria-expanded', durum === 'true' ? 'false' : 'true');
      const ihlaller = await focusRing(page, { keyboard: true });
      expect(ihlaller.filter(item => /halka|outline|çerçeve/.test(item)), ihlaller.join('\n')).toEqual([]);
    } else {
      const yuvalar = teklifler.getByRole('group', { name: /Taraf bilinmiyor/ });
      await expect(yuvalar).toHaveCount(2);
      const isGrubu = teklifler.getByRole('region', { name: new RegExp(IS[0]!.label!) });
      await expect(isGrubu).toContainText('Planlanan ₺17.000,00');
      await expect(isGrubu).toContainText('Gerçekleşen ₺8.200,00');
      await expect(isGrubu.getByRole('group')).toContainText('₺9.000,00');
      await expect(bolum(page, 'İşi yapanlar')).toContainText('Elektrikçi');
      expect(genis.some(url => url.endsWith('TekliflerGenis.wide.tsx')), 'geniş profil karşılaştırmayı tembel yükler').toBe(true);
    }
    await kurallar(page);
  });

  test('masaüstü 1440: karşılaştırma yuvaları ve işi yapanlar tablosu yalnız geniş profilde tembel yüklenir', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const genis = genisIstekleri(page);
    await nesil(page, TEKLIFLI);
    await openAdmin(page, '/taraflar');
    await expect(page.locator('html')).toHaveAttribute('data-profile', 'desktop');
    const teklifler = bolum(page, 'Teklifler');
    await expect(teklifler.getByRole('group', { name: /Taraf bilinmiyor/ })).toHaveCount(2);
    const tablo = bolum(page, 'İşi yapanlar').getByRole('table', { name: /İşi yapanlar/ });
    await expect(tablo.getByRole('row', { name: /Elektrikçi/ })).toContainText('2');
    expect(genis.some(url => url.endsWith('TekliflerGenis.wide.tsx'))).toBe(true);
    expect(genis.some(url => url.endsWith('IsiYapanlarTablosu.wide.tsx'))).toBe(true);
    expect(genis.some(url => url.endsWith('TaraflarTablosu.wide.tsx')), 'taraf yokken taraf tablosu indirilmez').toBe(false);
    await kurallar(page);
  });

  // Görev koşusunda telefon genişliklerinin kanıtı (matrix projeleri entegrasyonda ayrıca koşar): 320×568 → 320×480 →
  // 360 → 375 → 390 → yatay 568×320. Hepsi telefon profilidir; geniş-özel modül hiçbirinde indirilmez.
  test('telefon genişlikleri 320×568, 320×480, 360, 375, 390 ve yatay 568×320: telefon sunumu, akordeon, bağlantı hedefi, taşma yok', async ({ page, browserName }) => {
    // Altı görünüm sırayla açılır. macOS CI'daki WebKit bu yolculukta 30 sn sınırını aşabiliyor, doğrulamalar aynı kalır.
    test.slow(browserName === 'webkit');
    const genis = genisIstekleri(page);
    await nesil(page, { ...TEKLIFLI, ...USTALI });
    for (const boyut of [{ width: 320, height: 568 }, { width: 320, height: 480 }, { width: 360, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 568, height: 320 }]) {
      await test.step(`${boyut.width}×${boyut.height}`, async () => {
        await page.setViewportSize(boyut);
        const main = await openAdmin(page, '/taraflar');
        await expect(page.locator('html')).toHaveAttribute('data-profile', 'phone');
        await expect(main.getByRole('heading', { level: 1, name: 'Taraflar ve teklifler' })).toBeVisible();
        await expect(main.getByText('Satıcıları, ustaları ve gelen teklifleri tek yerde karşılaştırın.')).toBeVisible();
        const kaydet = main.getByRole('button', { name: 'Teklif kaydet' });
        await kaydet.scrollIntoViewIfNeeded();
        await expect(kaydet).toBeInViewport();

        const teklifler = bolum(page, 'Teklifler');
        const satirlar = teklifler.getByRole('button', { expanded: true });
        await expect(satirlar.first()).toBeVisible();
        await expect(main.getByRole('table'), 'telefonda tablo yok, akordeon').toHaveCount(0);

        const taraflar = bolum(page, 'Taraflar');
        const ilk = taraflar.getByRole('button', { expanded: true }).first();
        await expect(ilk).toBeVisible();
        const baglanti = taraflar.getByRole('link', { name: /^Ara: / }).first();
        await baglanti.scrollIntoViewIfNeeded();
        const asgari = (await page.locator('html[data-input-coarse]').count()) > 0 ? 48 : 44;
        const kutu = (await baglanti.boundingBox())!;
        expect(Math.min(kutu.width, kutu.height), `bağlantı hedefi ≥ ${asgari}`).toBeGreaterThanOrEqual(asgari);
        await kurallar(page);
      });
    }
    expect(genis, 'telefon geniş-özel modül indirmez').toEqual([]);
  });

  // Panel sözleşmesi providers koleksiyonunu okur (data/contract.ts; normalize.mjs usta satırı → providers). Telefonda taraf
  // satırı akordeondur, bağlantılar açık satırın gövdesindedir; masaüstünde tembel taraf tablosunun satırındadır.
  test('taraflar: tel: ve WhatsApp bağlantıları erişilebilir adlı, en az 44 px (dokunmatikte 48), odak alt çizgi', async ({ page, browserName }) => {
    await nesil(page, USTALI);
    await openAdmin(page, '/taraflar');
    const taraflar = bolum(page, 'Taraflar');
    await expect(ozet(page, 'Taraf kaydı')).toContainText('2');
    await tarafIletisimi(page, taraflar, 'Usta Ali');

    const ara = taraflar.getByRole('link', { name: 'Ara: Usta Ali, 0532 123 45 67' });
    const wa = taraflar.getByRole('link', { name: 'WhatsApp ile yaz: Usta Ali (yeni sekmede açılır)' });
    await expect(ara).toHaveAttribute('href', 'tel:+905321234567');
    await expect(wa).toHaveAttribute('href', 'https://wa.me/905321234567');
    await expect(wa).toHaveAttribute('target', '_blank');
    await expect(wa).toHaveAttribute('rel', /noopener/);
    const kaba = (await page.locator('html[data-input-coarse]').count()) > 0;
    const asgari = kaba ? 48 : 44;
    for (const baglanti of [ara, wa]) {
      const kutu = (await baglanti.boundingBox())!;
      expect(kutu.height, `hedef yüksekliği ≥ ${asgari}`).toBeGreaterThanOrEqual(asgari);
      expect(kutu.width, `hedef genişliği ≥ ${asgari}`).toBeGreaterThanOrEqual(asgari);
    }
    // Sabit hatta yalnız arama.
    await tarafIletisimi(page, taraflar, 'Mutfak Dünyası');
    await expect(taraflar.getByRole('link', { name: 'Ara: Mutfak Dünyası, 0212 555 10 10' })).toHaveAttribute('href', 'tel:+902125551010');
    await expect(taraflar.getByRole('link', { name: /WhatsApp ile yaz: Mutfak Dünyası/ })).toHaveCount(0);
    // Karşılaştırma: aynı alıma bağlı iki usta teklifi; en düşük fiyat sözcükle ve kesin farkla.
    await expect(bolum(page, 'Teklifler')).toContainText(`${ALIM[0]!.label}: en düşük fiyat Usta Ali, ₺1.450,00 daha ucuz.`);

    await enterKeyboardMode(page, browserName);
    await ara.focus();
    const ihlaller = await focusRing(page, { keyboard: true });
    expect(ihlaller, ihlaller.join('\n')).toEqual([]);
    await kurallar(page);
  });

  test('veri durumları: yükleniyor (başlık korunur), hata (Hata: … + Yeniden dene, tutar yok), eski veri (yenilenemedi)', { tag: '@matrix' }, async ({ page }) => {
    // Yükleniyor: manifest bekletilir; başlık ve iskelet görünür.
    let birak!: () => void;
    const beklet = new Promise<void>(resolve => { birak = resolve; });
    await page.route('**/__aile/generation/manifest.json', async route => {
      await beklet;
      await route.fallback();
    });
    await gotoAdmin(page, '/taraflar');
    await expect(page.getByRole('heading', { level: 1, name: 'Taraflar ve teklifler' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Yükleniyor' }).first()).toBeVisible();
    birak();
    await expect(bolum(page, 'Teklifler')).toContainText('Kaynakta teklif yok');
    await page.unrouteAll({ behavior: 'wait' });

    // Eski veri: yenileme başarısız → son iyi veri kalır, tazelik satırı "yenilenemedi".
    await page.route('**/__aile/generation/manifest.json', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Sunucu meşgul"}' }));
    await tazelik(page).getByRole('button', { name: 'Yenile' }).click();
    await expect(tazelik(page)).toHaveAttribute('data-state', 'stale');
    await expect(tazelik(page)).toContainText('yenilenemedi');
    await expect(bolum(page, 'Teklifler')).toContainText('Kaynakta teklif yok');
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Hata: ilk okuma başarısız → sayfa hatası, bölüm ve tutar yok.
    await page.goto('about:blank');
    await gotoAdmin(page, '/taraflar');
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { level: 2 })).toHaveText(/^Hata: Nesil okunamadı/);
    await expect(alert.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Taraflar ve teklifler' })).toBeVisible();
    await expect(bolum(page, 'Teklifler')).toHaveCount(0);
    await expect(page.locator(KOK)).not.toContainText('₺');
    await kurallar(page);
  });
});
