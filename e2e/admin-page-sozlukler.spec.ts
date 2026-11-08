import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_MAIN, enterKeyboardMode, gotoAdmin, horizontalOverflow, openAdmin } from './admin-helpers';
import { accentEdges, focusRing, motion, overflow, smallText } from './admin-detectors';

// Sözlükler ve iş akışları — kritik kullanıcı yolculuğu (sentetik nesil; webServer AILE_GENERATION_DIR ile sunar).
// Tasarım: ekranlar.md SayfaSozlukler / SayfaSozluklerDar, bundle.js Aile.Pages.Sozlukler. Önce telefon (320×568):
// başlık + amaç + ana eylem görünür; "Sözlük" seçimi ui Select alt sayfası (role=dialog); terim ağacı iç içe açılır
// liste (ilk kök açık; kök › alt › torun; oklarla gezilir); iş akışı durumları ve geçişleri; sayfa yana kaymaz.
// Geniş (tablet/masaüstü) ağaç tablosu *.wide modülüyle gelir; telefon onu hiç indirmez (ağ kanıtı).
// @matrix etiketli testler genişlikten bağımsızdır ve entegrasyonda 360/375/320×480/568×320/tablet/masaüstünde koşar.
// Beklenenler fixture'dan hesaplanır; seçiciler role/ad ile.

const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && statSync(path.join(FIXTURE_ROOT, name)).isDirectory())!;
const records = <T>(rel: string): T[] => (JSON.parse(readFileSync(path.join(FIXTURE_ROOT, GENERATION_ID, rel), 'utf8')) as { records: T[] }).records;

interface Term { id: string; label: string; code: string; parent_id: string | null; vocabulary_id: string }
interface Vocabulary { id: string; key: string }

const tr = (a: string, b: string) => a.localeCompare(b, 'tr-TR');
const VOCABS = records<Vocabulary>('data/vocabularies/global/00000.json');
const TERMS = records<Term>('data/terms/global/00000.json');
const CATEGORY = VOCABS.find(v => v.key === 'category')!;
const CATEGORY_TERMS = TERMS.filter(t => t.vocabulary_id === CATEGORY.id);
const childrenOf = (id: string | null) => CATEGORY_TERMS.filter(t => t.parent_id === id).sort((a, b) => tr(a.label, b.label));
const ROOTS = childrenOf(null);
const GRAND = CATEGORY_TERMS.filter(t => CATEGORY_TERMS.find(p => p.id === t.parent_id)?.parent_id != null).sort((a, b) => tr(a.label, b.label))[0]!;
const MID = CATEGORY_TERMS.find(t => t.id === GRAND.parent_id)!;
const TOP = CATEGORY_TERMS.find(t => t.id === MID.parent_id)!;

const TITLE = 'Sözlükler ve iş akışları';
const PURPOSE = 'Kategorileri, odaları, durumları ve durumların hangi sırayla değişeceğini tanımlayın.';
const WIDE_MODULE = /\/pages\/sozlukler\/[^?#]*\.wide/;
const CONTENT = '.aile-sz-icerik';

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Düğüm başlığının adı terim adıyla başlar, ardından kullanım ve alt sayısı gelir. */
const named = (label: string) => new RegExp(`^${escapeRe(label)}(\\s|$)`);

type Profil = 'phone' | 'tablet' | 'desktop';
/** src/admin/adaptive/profile.ts ile aynı eşikler: <600 ya da kısa kenar <480 telefon; 600–1023 tablet. */
function profileOf(page: Page): Profil {
  const { width, height } = page.viewportSize() ?? { width: 1440, height: 900 };
  if (width < 600 || Math.min(width, height) < 480) return 'phone';
  return width < 1024 ? 'tablet' : 'desktop';
}

function wideRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', request => {
    if (WIDE_MODULE.test(request.url())) urls.push(request.url());
  });
  return urls;
}

test.describe('Sözlükler ve iş akışları › telefon yolculuğu', () => {
  test('başlık, amaç ve ana eylem; Sözlük alt sayfası; kategori ağacı üç düzey; iş akışı geçişleri', async ({ page }) => {
    test.skip(profileOf(page) !== 'phone', 'Telefon yolculuğu; geniş düzen @matrix testlerinde');
    const wide = wideRequests(page);
    const main = await openAdmin(page, '/sozlukler');

    await expect(main.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(main.getByText(PURPOSE)).toBeVisible();
    const primary = main.getByRole('button', { name: 'Terim ekle' });
    await expect(primary).toBeInViewport();
    await expect(primary).toBeEnabled();

    const secim = main.getByRole('combobox', { name: 'Sözlük' });
    await expect(secim).toBeVisible();
    await expect(main.getByRole('tablist')).toHaveCount(0);

    const bolge = main.getByRole('region', { name: 'Kategoriler' });
    await expect(bolge.getByText(`${CATEGORY_TERMS.length} değer · ağaç`)).toBeVisible();
    await expect(bolge.getByRole('table')).toHaveCount(0);
    await expect(bolge.getByRole('button', { name: named(ROOTS[0]!.label) })).toHaveAttribute('aria-expanded', 'true');

    const top = bolge.getByRole('button', { name: named(TOP.label) });
    await top.click();
    await expect(top).toHaveAttribute('aria-expanded', 'true');
    const mid = bolge.getByRole('button', { name: named(MID.label) });
    await mid.click();
    const grand = bolge.getByRole('button', { name: named(GRAND.label) });
    await expect(grand).toBeVisible();
    const box = (await grand.boundingBox())!;
    const coarse = await page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'));
    expect(box.height, 'dokunma hedefi: 44 px, kaba işaretçide 48 px').toBeGreaterThanOrEqual(coarse ? 48 : 44);
    await grand.click();
    const detay = bolge.locator(`[id="${await grand.getAttribute('aria-controls')}"]`);
    await expect(detay.getByText(GRAND.code)).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);

    await secim.click();
    const sheet = page.getByRole('dialog', { name: 'Sözlük' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('option', { name: 'İş akışları' }).click();
    await expect(sheet).toBeHidden();
    const akis = main.getByRole('region', { name: 'İş akışı · Tedarik durumu' });
    await expect(akis.getByRole('list', { name: 'Durum sırası' })).toBeVisible();
    await expect(akis.getByText('Alınacak → Sipariş edildi')).toBeVisible();
    await expect(akis.getByText('Kanıt gerekmez').first()).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(wide, 'telefon geniş-özel modülü indirmemeli').toEqual([]);
  });

  test('ağaç klavyeyle gezilir; odak göstergesi tek alt çizgi, halka yok', async ({ page, browserName }) => {
    test.skip(profileOf(page) !== 'phone', 'Telefon ağacı');
    const main = await openAdmin(page, '/sozlukler');
    const bolge = main.getByRole('region', { name: 'Kategoriler' });
    const first = bolge.getByRole('button', { name: named(ROOTS[0]!.label) });
    const firstChild = bolge.getByRole('button', { name: named(childrenOf(ROOTS[0]!.id)[0]!.label) });
    const second = bolge.getByRole('button', { name: named(ROOTS[1]!.label) });

    await enterKeyboardMode(page, browserName);
    await first.focus();
    expect(await focusRing(page)).toEqual([]);
    await page.keyboard.press('ArrowDown');
    await expect(firstChild).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
    await page.keyboard.press('ArrowLeft');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowDown');
    await expect(second).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(second).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Enter');
    await expect(second).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
  });

  test('ağaç hareketi tek süre ve eğride; azaltılmış harekette durum anında, geçiş yok', { tag: '@matrix' }, async ({ page }) => {
    test.skip(profileOf(page) !== 'phone', 'Açılır ağaç telefon (temel) sunumudur');
    const main = await openAdmin(page, '/sozlukler');
    const tree = '.aile-sz-agac';
    expect(await motion(page, undefined, undefined, { root: tree, reduced: false })).toEqual([]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const second = main.getByRole('region', { name: 'Kategoriler' }).getByRole('button', { name: named(ROOTS[1]!.label) });
    await second.click();
    await expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(await motion(page, undefined, undefined, { root: tree, reduced: true })).toEqual([]);
  });

  test('Terim ekle: öneri olarak kaydedilir, bekleyen önerilerde görünür ve geri alınır', async ({ page }) => {
    const main = await openAdmin(page, '/sozlukler');
    const primary = main.getByRole('button', { name: 'Terim ekle' });
    await expect(primary).toBeEnabled();
    await primary.click();
    const dialog = page.getByRole('dialog', { name: 'Terim ekle' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: /Terim adı/ }).fill('Bahçe mobilyası');
    await dialog.getByRole('button', { name: 'Öneri olarak kaydet' }).click();
    await expect(dialog).toBeHidden();
    const oneriler = main.getByRole('region', { name: 'Bekleyen öneriler' });
    await expect(oneriler.getByText('Terim ekle: Bahçe mobilyası (Kategoriler)')).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
    await oneriler.getByRole('button', { name: 'Geri al: Terim ekle: Bahçe mobilyası (Kategoriler)' }).click();
    await expect(oneriler).toHaveCount(0);
  });

  test('nesil okunamazsa hata durumu adıyla ve "Yeniden dene"; eski sayı gösterilmez', async ({ page }) => {
    await page.route('**/__aile/generation/**', route =>
      route.fulfill({ status: 503, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: 'Nesil yok' }) }));
    await gotoAdmin(page, '/sozlukler');
    const main = page.locator(ADMIN_MAIN);
    await expect(main.getByRole('heading', { level: 2, name: /^Hata: / })).toBeVisible();
    await expect(main.getByRole('alert').getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
    await expect(main.getByRole('list', { name: 'Özet' })).toHaveCount(0);
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});

test.describe('Sözlükler ve iş akışları › genişlik matrisi', () => {
  test('ilk görünüm: başlık, amaç ve ana eylem erişilebilir; yana kayma, küçük metin, kesik etiket ve kenar şeridi yok', { tag: '@matrix' }, async ({ page }) => {
    const main = await openAdmin(page, '/sozlukler');
    await expect(main.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(main.getByText(PURPOSE)).toBeVisible();
    const primary = main.getByRole('button', { name: 'Terim ekle' });
    await primary.scrollIntoViewIfNeeded();
    await expect(primary).toBeInViewport({ ratio: 1 });
    expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(main.getByRole('region', { name: 'Kategoriler' })).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await smallText(page, { root: CONTENT })).toEqual([]);
    expect(await overflow(page, { root: CONTENT })).toEqual([]);
    expect(await accentEdges(page, { root: CONTENT })).toEqual([]);
  });

  test('Sözlük seçimi: telefonda alt sayfa (dialog), genişte sekme şeridi', { tag: '@matrix' }, async ({ page }) => {
    const main = await openAdmin(page, '/sozlukler');
    if (profileOf(page) === 'phone') {
      const secim = main.getByRole('combobox', { name: 'Sözlük' });
      await secim.click();
      const sheet = page.getByRole('dialog', { name: 'Sözlük' });
      await expect(sheet).toBeVisible();
      const option = sheet.getByRole('option', { name: 'Görünümler' });
      await option.scrollIntoViewIfNeeded();
      await expect(option).toBeInViewport();
      await option.click();
      await expect(sheet).toBeHidden();
    } else {
      await expect(main.getByRole('combobox', { name: 'Sözlük' })).toHaveCount(0);
      await main.getByRole('tab', { name: 'Görünümler' }).click();
    }
    const gorunum = main.getByRole('region', { name: 'Görünüm tanımları' });
    await expect(gorunum).toBeVisible();
    await expect(gorunum.getByText('Önerilen şablon').first()).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test('geniş-özel ağaç tablosu yalnız geniş profilde indirilir', { tag: '@matrix' }, async ({ page }) => {
    const wide = wideRequests(page);
    const main = await openAdmin(page, '/sozlukler');
    const bolge = main.getByRole('region', { name: 'Kategoriler' });
    const profil = profileOf(page);
    if (profil === 'phone') {
      await expect(bolge.getByRole('button', { name: named(ROOTS[0]!.label) })).toBeVisible();
      await expect(bolge.getByRole('table')).toHaveCount(0);
      expect(wide).toEqual([]);
      return;
    }
    await expect.poll(() => wide.length, { message: 'geniş profil ağaç tablosu modülünü indirmeli' }).toBeGreaterThan(0);
    if (profil === 'desktop') {
      const table = bolge.getByRole('table', { name: 'Kategoriler' });
      await expect(table).toBeVisible();
      await expect(table.getByRole('row', { name: named(GRAND.label) })).toBeVisible();
    } else {
      // Tablet: tablo sığarsa tablo, sığmazsa aynı açılır ağaç (tasarım: "Tablo sığıyorsa tablo").
      await expect(bolge.getByRole('table', { name: 'Kategoriler' }).or(bolge.getByRole('button', { name: named(ROOTS[0]!.label) }))).toBeVisible();
    }
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});
