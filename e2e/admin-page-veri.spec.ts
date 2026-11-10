import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { ADMIN_MAIN, enterKeyboardMode, gotoAdmin, openAdmin } from './admin-helpers';
import { accentEdges, focusRing, overflow, smallText } from './admin-detectors';

// Veri kalitesi ve içe aktarma — telefon önce kullanıcı yolculuğu (sentetik nesil). Tasarım: README › Sayfa iskeleti,
// Veri durumları, Uyarlanır teslim; ekranlar.md SayfaVeriKalitesi / SayfaVeriKalitesiDar; bundle.js VeriKalitesi.
// Kritik yolculuk (telefon, 320×568 ilk hedef): başlık + amaç + ana eylem ilk ekranda → sorun kuyruğu türe göre
// gruplu, kaynak hücre adresiyle, büyük kuyrukta sayfalı (gerçek nesildeki 469 formül hatası sentetik olarak üretilir)
// → klasörden içe aktar (Chromium showDirectoryPicker; Safari/WebKit <input webkitdirectory> yedeği, özellik algılama)
// → klasörde birden çok nesil varsa nesil seçimi → seçilen nesil okunur.
// Veri: yalnız fixtures/generation-synthetic ve ondan türetilen bellek içi/geçici varyantlar; /__aile/generation/**
// page.route ile karşılanır. Gerçek nesil, kasa yolu ve .env okunmaz; Google'a istek yok.
// Projeler: chromium (320×568 dokunmatik), webkit (390×844 dokunmatik); @matrix testleri entegrasyonda 320×480,
// 360, 375, 568×320 (telefon profili), tablet ve masaüstünde de koşar. Seçiciler role/ad; antd sınıfına bağlı değil.

// --- Sentetik nesil -----------------------------------------------------------------------------------------------
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && existsSync(path.join(FIXTURE_ROOT, name, 'manifest.json')))!;
const GENERATION_DIR = path.join(FIXTURE_ROOT, GENERATION_ID);
const PREFIX = '/__aile/generation/';

type Files = ReadonlyMap<string, string>;
interface ManifestFileEntry { path: string; sha256: string; bytes: number; kind: string; collection?: string; count?: number }
interface ManifestShape {
  generation_id: string;
  files: ManifestFileEntry[];
  counts: Record<string, number>;
  sources: { key: string; capture: { completed_at: string } }[];
  [key: string]: unknown;
}
interface IssueShape {
  id: string;
  tenant_id: string;
  code: string;
  severity: string;
  detail?: Record<string, unknown>;
  provenance: { a1: string; column: number | null; row: number; sheet_id: number; sheet_title: string; source_id: string; source_key: string };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

/** Panelin okuduğu dosyalar: manifest.json + data/**.json (raw/, schemas/ panelin işi değil). */
const FIXTURE: Files = new Map(
  walk(GENERATION_DIR)
    .map(full => path.relative(GENERATION_DIR, full).split(path.sep).join('/'))
    .filter(rel => rel === 'manifest.json' || rel.startsWith('data/'))
    .map(rel => [rel, readFileSync(path.join(GENERATION_DIR, rel), 'utf8')] as const),
);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const manifestOf = (files: Files) => JSON.parse(files.get('manifest.json')!) as ManifestShape;
const recordsOf = <T>(files: Files, rel: string) => (JSON.parse(files.get(rel)!) as { records: T[] }).records;
const ISSUE_PATHS = manifestOf(FIXTURE).files.filter(file => file.kind === 'partition' && file.collection === 'issues').map(file => file.path);
const FIXTURE_ISSUES = ISSUE_PATHS.flatMap(rel => recordsOf<IssueShape>(FIXTURE, rel));

/** Parçayı yeniden yazar, manifestte bytes/count/sha256 ve sayımı günceller; isteğe bağlı yeni nesil kimliği. */
function withPartition(files: Files, rel: string, collection: string, records: unknown[] | null, generationId?: string): Map<string, string> {
  const next = new Map(files);
  const manifest = manifestOf(files);
  if (records === null) {
    next.delete(rel);
    manifest.files = manifest.files.filter(file => file.path !== rel);
  } else {
    const text = `${JSON.stringify({ collection, records, schemaVersion: 1 })}\n`;
    next.set(rel, text);
    manifest.files = manifest.files.map(file => (file.path === rel ? { ...file, bytes: Buffer.byteLength(text), count: records.length, sha256: sha256(text) } : file));
  }
  const total = manifest.files.filter(file => file.kind === 'partition' && file.collection === collection).reduce((sum, file) => sum + (file.count ?? 0), 0);
  if (manifest.files.some(file => file.collection === collection)) manifest.counts[collection] = total;
  else delete manifest.counts[collection];
  if (generationId) manifest.generation_id = generationId;
  next.set('manifest.json', JSON.stringify(manifest));
  return next;
}

/** Gerçek nesildeki büyük formül hatası kuyruğunun sentetik eşi: budget parçasında n formül hatası + kalan sorunlar. */
const BUYUK_SORUN = 469;
const uuid = (n: number) => `00000000-0000-5000-8000-${n.toString(16).padStart(12, '0')}`;
const SUTUN = (n: number) => String.fromCharCode(65 + (n % 8));
function withFormulaErrors(files: Files, count: number): Map<string, string> {
  const budgetPath = ISSUE_PATHS.find(rel => rel.includes('/budget/'))!;
  const template = recordsOf<IssueShape>(files, budgetPath).find(issue => issue.code === 'formula_error')!;
  const others = recordsOf<IssueShape>(files, budgetPath).filter(issue => issue.code !== 'formula_error');
  const generated = Array.from({ length: count }, (_, index): IssueShape => {
    const row = 2 + Math.floor(index / 8);
    const column = 1 + (index % 8);
    return {
      ...template,
      id: uuid(index + 1),
      detail: { message: 'Sentetik formül hatası', type: index % 3 === 0 ? 'DIV_ZERO' : 'REF' },
      provenance: { ...template.provenance, a1: `${SUTUN(index)}${row}`, row, column, sheet_title: 'Gerçekleşen' },
    };
  });
  return withPartition(files, budgetPath, 'issues', [...generated, ...others], sha256(`buyuk-kuyruk-${count}`));
}
/** issues koleksiyonu hiç olmayan nesil. */
function withoutIssues(files: Files): Map<string, string> {
  let next: Map<string, string> = new Map(files);
  for (const rel of ISSUE_PATHS) next = withPartition(next, rel, 'issues', null);
  return next;
}
/** Aynı veri, farklı nesil kimliği ve daha eski yakalama zamanı (klasörde ikinci nesil). */
const ESKI_ID = sha256('eski-nesil');
const ESKI_ZAMAN = '2026-10-20T06:30:00.000Z';
function olderVariant(files: Files): Map<string, string> {
  const next = new Map(files);
  const manifest = manifestOf(files);
  manifest.generation_id = ESKI_ID;
  manifest.sources = manifest.sources.map(source => ({ ...source, capture: { ...source.capture, completed_at: ESKI_ZAMAN } }));
  next.set('manifest.json', JSON.stringify(manifest));
  return next;
}

type Responder = (rel: string, count: number) => string | { status: number; body?: unknown } | 'hold';

/** /__aile/generation/** → verilen dosyalar (dev middleware sözleşmesi: _meta, yalnız .json, {error} gövdesi). */
async function serve(page: Page, files: Files | Responder): Promise<{ release(): void; requests: string[] }> {
  const requests: string[] = [];
  const held: Route[] = [];
  let released = false;
  const counts = new Map<string, number>();
  const respond: Responder = typeof files === 'function' ? files : rel => files.get(rel) ?? { status: 404, body: { error: 'Dosya yok' } };
  await page.route('**/__aile/generation/**', async route => {
    const url = new URL(route.request().url());
    const rel = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(PREFIX) + PREFIX.length));
    requests.push(rel);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: `${JSON.stringify(body)}\n` });
    if (rel === '_meta') return json(200, { generation_id: GENERATION_ID, selectedAt: new Date().toISOString() });
    const count = (counts.get(rel) ?? 0) + 1;
    counts.set(rel, count);
    const answer = respond(rel, count);
    if (answer === 'hold') {
      if (released) return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: FIXTURE.get(rel) ?? '{}' });
      held.push(route);
      return undefined;
    }
    if (typeof answer === 'string') return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: answer });
    return json(answer.status, answer.body ?? { error: 'Hata' });
  });
  return {
    requests,
    release() {
      released = true;
      for (const route of held.splice(0)) void route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: FIXTURE.get(new URL(route.request().url()).pathname.split(PREFIX)[1] ?? '') ?? '{}' });
    },
  };
}

// --- Sayfa yardımcıları -------------------------------------------------------------------------------------------
const H1 = 'Veri kalitesi ve içe aktarma';
const AMAC = 'E-tablodan gelen veriyi içe aktarın, eşleşmeyen satırları ve çakışmaları çözün.';
const ICE_AKTAR = 'Klasörden içe aktar';
const DESTEK_YOK = 'Bu tarayıcı klasör içe aktarmayı desteklemiyor; nesil geliştirme sunucusundan okunur.';
const SAYFA_BOYUTU = 20;
const sayi = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

const profil = (page: Page) => page.evaluate(() => document.documentElement.dataset.profile ?? 'bilinmiyor');
const ana = (page: Page) => page.locator(ADMIN_MAIN);
const sorunlar = (page: Page) => ana(page).getByRole('region', { name: 'Çözülecek sorunlar' });
const durum = (page: Page) => ana(page).locator('[role="status"][data-state]');
/** Grup başlığı (açılır alan düğmesi): "<Tür> <N> kayıt". */
const grupAdi = (tur: string) => new RegExp(`^${tur}\\s+\\d`);
const grup = (page: Page, tur: string) => sorunlar(page).getByRole('button', { name: grupAdi(tur) });
const grupBolgesi = (page: Page, tur: string) => sorunlar(page).getByRole('region', { name: grupAdi(tur) });

/** Sayfa-düzeyi kural dedektörleri (taşma, 14 px, kavisli vurgu kenarı) ana bölgede boş dönmeli. */
async function kurallarTemiz(page: Page, label: string) {
  expect(await overflow(page, { root: ADMIN_MAIN }), `${label}: yatay taşma`).toEqual([]);
  expect(await smallText(page, { root: ADMIN_MAIN, min: 14 }), `${label}: 14 px altı metin`).toEqual([]);
  expect(await accentEdges(page, { root: ADMIN_MAIN }), `${label}: kavisli vurgu kenarı`).toEqual([]);
  const sayfaTasmasi = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sayfaTasmasi, `${label}: belge düzeyinde yatay kaydırma`).toBeLessThanOrEqual(1);
}

/** Başlık, amaç ve ana eylem ilk ekranda (kaydırmadan) görünür. */
async function ilkEkran(page: Page) {
  await expect(ana(page).getByRole('heading', { level: 1, name: H1 })).toBeInViewport();
  await expect(ana(page).getByText(AMAC, { exact: true })).toBeInViewport();
  await expect(ana(page).getByRole('button', { name: ICE_AKTAR })).toBeInViewport();
}

// --- 1. Kritik telefon yolculuğu ----------------------------------------------------------------------------------
test.describe('Veri › telefon yolculuğu', () => {
  test('başlık, amaç ve ana eylem ilk ekranda; sorunlar türe göre gruplu ve kaynak hücre adresli; tablo yok', async ({ page, browserName }) => {
    await serve(page, FIXTURE);
    await openAdmin(page, '/veri');
    test.skip((await profil(page)) !== 'phone', 'Telefon profili yolculuğu; geniş profil ayrı testte.');

    await ilkEkran(page);
    await expect(ana(page).getByRole('button', { name: ICE_AKTAR })).toBeEnabled();
    await expect(durum(page)).toHaveAttribute('data-state', 'fresh');
    await expect(durum(page)).toContainText(`Nesil ${GENERATION_ID.slice(0, 6)}`);

    // Telefonda tablo yok: sorunlar türe göre gruplu liste; her grup başlığı tür + sayım taşır.
    await expect(ana(page).getByRole('table')).toHaveCount(0);
    await expect(sorunlar(page).getByRole('heading', { level: 2, name: 'Çözülecek sorunlar' })).toBeVisible();
    await expect(grup(page, 'Formül hatası')).toHaveAccessibleName(/Formül hatası\s+2 kayıt/);
    await expect(grup(page, 'Formül hatası')).toHaveAttribute('aria-expanded', 'true');
    // Kuyruk tek sayfaya sığıyor (10 ≤ 20): bütün gruplar açık, her sorun kaynak hücre adresiyle görünür.
    const formul = grupBolgesi(page, 'Formül hatası');
    await expect(formul.getByText('Gerçekleşen · G9', { exact: true })).toBeVisible();
    await expect(formul.getByText('Plan · E12', { exact: true })).toBeVisible();
    await expect(formul.getByText(/Tip: #REF!/)).toBeVisible();
    await expect(grupBolgesi(page, 'Geçersiz bağlantı').getByText('app_kalemler · 11. satır', { exact: true })).toBeVisible();
    // Sayfalama yalnız kuyruk bir sayfayı aşınca çizilir.
    await expect(sorunlar(page).getByRole('navigation')).toHaveCount(0);

    await kurallarTemiz(page, 'telefon açılışı');
    // Klavye modu: ana eylemde tek alt çizgi; çevreleyen halka yok.
    await enterKeyboardMode(page, browserName);
    await ana(page).getByRole('button', { name: ICE_AKTAR }).focus();
    expect(await focusRing(page), 'ana eylem odak göstergesi').toEqual([]);
  });

  test(`${BUYUK_SORUN} formül hatası: grup başına ${SAYFA_BOYUTU} kayıtlık sayfa, Önceki/Sonraki ile gezilir`, async ({ page }) => {
    const files = withFormulaErrors(FIXTURE, BUYUK_SORUN);
    await serve(page, files);
    await openAdmin(page, '/veri');
    const telefon = (await profil(page)) === 'phone';

    const formul = grupBolgesi(page, 'Formül hatası');
    await expect(grup(page, 'Formül hatası')).toHaveAccessibleName(new RegExp(`Formül hatası\\s+${sayi(BUYUK_SORUN)} kayıt`));
    // En kalabalık grup üstte ve açık; kuyruk bir sayfayı aştığı için diğer gruplar kapalı başlar.
    await expect(sorunlar(page).getByRole('button', { expanded: true })).toHaveCount(1);
    await expect(grup(page, 'Formül hatası')).toHaveAttribute('aria-expanded', 'true');
    await expect(grup(page, 'Yalnız kaynak sayfa')).toHaveAttribute('aria-expanded', 'false');

    const sayfalar = formul.getByRole('navigation', { name: 'Formül hatası sayfaları' });
    await expect(sayfalar).toContainText(`1–${SAYFA_BOYUTU} / ${sayi(BUYUK_SORUN)}`);
    const satirlar = telefon ? formul.getByRole('listitem') : formul.getByRole('row').filter({ has: page.getByRole('cell') });
    await expect(satirlar).toHaveCount(SAYFA_BOYUTU);
    await expect(satirlar.first()).toContainText('Gerçekleşen · A2');
    await expect(sayfalar.getByRole('button', { name: 'Önceki sayfa' })).toBeDisabled();

    await sayfalar.getByRole('button', { name: 'Sonraki sayfa' }).click();
    await expect(sayfalar).toContainText(`${SAYFA_BOYUTU + 1}–${SAYFA_BOYUTU * 2} / ${sayi(BUYUK_SORUN)}`);
    await expect(satirlar).toHaveCount(SAYFA_BOYUTU);
    // Sıra kaynak hücre sırasıdır (satır, sonra sütun): 21. kayıt 4. satırın 5. sütunu (E4).
    await expect(satirlar.first()).toContainText('Gerçekleşen · E4');
    await sayfalar.getByRole('button', { name: 'Önceki sayfa' }).click();
    await expect(sayfalar).toContainText(`1–${SAYFA_BOYUTU} / ${sayi(BUYUK_SORUN)}`);

    // Gerçek nesilde ~36 bin karakter üreten kuyruk artık bir sayfa kadar metin çizer.
    const metin = await sorunlar(page).evaluate(element => (element as HTMLElement).innerText.length);
    expect(metin, 'sorun kuyruğunun görünür metni').toBeLessThan(8_000);
    await kurallarTemiz(page, 'büyük kuyruk');
  });
});

// --- 2. Klasör içe aktarma ve nesil seçimi -----------------------------------------------------------------------
/** İki nesilli klasör: <kök>/yeni (sentetik nesil) ve <kök>/eski (aynı veri, eski yakalama). */
function nesilKlasoru(root: string): string {
  const write = (dir: string, files: Files) => {
    for (const [rel, text] of files) {
      const full = path.join(root, dir, ...rel.split('/'));
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
  };
  write('yeni', FIXTURE);
  write('eski', olderVariant(FIXTURE));
  return root;
}

/** Chromium'da showDirectoryPicker'ı aynı iki nesilli klasörü veren sahte tutamakla değiştirir (yerel iletişim kutusu yok). */
async function sahteKlasorSecici(page: Page) {
  const files: Record<string, string> = {};
  for (const [rel, text] of FIXTURE) files[`yeni/${rel}`] = text;
  for (const [rel, text] of olderVariant(FIXTURE)) files[`eski/${rel}`] = text;
  await page.addInitScript(({ files: map }) => {
    interface Node { dirs: Map<string, Node>; files: Map<string, string> }
    const root: Node = { dirs: new Map(), files: new Map() };
    for (const [rel, text] of Object.entries(map)) {
      const parts = rel.split('/');
      let node = root;
      for (const part of parts.slice(0, -1)) {
        if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: new Map() });
        node = node.dirs.get(part)!;
      }
      node.files.set(parts[parts.length - 1]!, text);
    }
    const notFound = () => new DOMException('Bulunamadı', 'NotFoundError');
    const handle = (node: Node, name: string): unknown => ({
      kind: 'directory',
      name,
      async getDirectoryHandle(child: string) {
        const next = node.dirs.get(child);
        if (!next) throw notFound();
        return handle(next, child);
      },
      async getFileHandle(child: string) {
        const text = node.files.get(child);
        if (text === undefined) throw notFound();
        return { kind: 'file', name: child, getFile: async () => new File([text], child, { type: 'application/json' }) };
      },
      async *values() {
        for (const [child, next] of node.dirs) yield handle(next, child);
        for (const child of node.files.keys()) yield { kind: 'file', name: child };
      },
    });
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => handle(root, 'nesil-klasoru');
  }, { files });
}

/** showDirectoryPicker'ı kaldırır: Chromium'da Safari yolu (<input webkitdirectory>) sınanır. */
async function seciciYok(page: Page) {
  await page.addInitScript(() => {
    try {
      delete (Window.prototype as unknown as Record<string, unknown>).showDirectoryPicker;
    } catch {
      /* prototipte yok */
    }
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true, writable: true });
  });
}

/** WebKit'te <input webkitdirectory> ile klasör seçiminin macOS CI'daki süre bütçesi (yalnız süre, doğrulama değil). */
const WEBKIT_KLASOR_SURESI = 240_000;

async function neslSec(page: Page, tetik: () => Promise<void>) {
  await tetik();
  const secim = page.getByRole('dialog', { name: 'Nesil seçin' });
  await expect(secim).toBeVisible();
  const secenekler = secim.getByRole('button', { name: /^Nesil [0-9a-f]{6}/ });
  await expect(secenekler).toHaveCount(2);
  // En yeni üstte ve adıyla işaretli; tarih tr-TR, İstanbul saati.
  await expect(secenekler.nth(0)).toHaveAccessibleName(new RegExp(`^Nesil ${GENERATION_ID.slice(0, 6)}.*En yeni`));
  await expect(secenekler.nth(1)).toHaveAccessibleName(new RegExp(`^Nesil ${ESKI_ID.slice(0, 6)}.*20\\.10\\.2026 09:30`));
  await secenekler.nth(1).click();
  await expect(secim).toBeHidden();
  const nesil = ana(page).getByRole('region', { name: 'Nesil' });
  await expect(nesil).toContainText('Klasör · nesil-klasoru/eski');
  await expect(durum(page)).toHaveAttribute('data-state', 'fresh');
  await expect(durum(page)).toContainText(`Nesil ${ESKI_ID.slice(0, 6)}`);
  await expect(grupBolgesi(page, 'Formül hatası').getByText('Gerçekleşen · G9', { exact: true })).toBeVisible();
}

test.describe('Veri › klasörden içe aktar', () => {
  test('özellik algılama: seçici varsa showDirectoryPicker, yoksa <input webkitdirectory>; iki nesilden biri seçilir', async ({ page }, testInfo) => {
    const supportsPicker = testInfo.project.name.startsWith('chromium');
    if (!supportsPicker) test.setTimeout(WEBKIT_KLASOR_SURESI);
    if (supportsPicker) await sahteKlasorSecici(page);
    await serve(page, FIXTURE);
    await openAdmin(page, '/veri');
    const yontem = await page.evaluate(() => (typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function' ? 'picker' : 'input'));
    const dugme = ana(page).getByRole('button', { name: ICE_AKTAR });
    await expect(dugme).toBeEnabled();
    await expect(ana(page).getByText(DESTEK_YOK)).toHaveCount(0);

    if (yontem === 'picker') {
      await neslSec(page, () => dugme.click());
    } else {
      const klasor = nesilKlasoru(testInfo.outputPath('nesil-klasoru'));
      await neslSec(page, async () => {
        const chooser = page.waitForEvent('filechooser');
        await dugme.click();
        await (await chooser).setFiles(klasor);
      });
    }
    await kurallarTemiz(page, 'içe aktarma sonrası');
  });

  test('Chromium\'da showDirectoryPicker yokken de <input webkitdirectory> yedeği çalışır (Safari yolu)', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('chromium'), 'WebKit zaten seçicisiz; yol bir önceki testte sınanır.');
    await seciciYok(page);
    await serve(page, FIXTURE);
    await openAdmin(page, '/veri');
    const klasor = nesilKlasoru(testInfo.outputPath('nesil-klasoru'));
    await neslSec(page, async () => {
      const chooser = page.waitForEvent('filechooser');
      await ana(page).getByRole('button', { name: ICE_AKTAR }).click();
      await (await chooser).setFiles(klasor);
    });
  });

  test('klasörde nesil yoksa "Hata:" ile neden ve çözüm yazılır; mevcut nesil korunur', async ({ page }, testInfo) => {
    // macOS CI'da WebKit'in klasör seçimi (setInputFiles) tek başına 29 sn, 10 Kasım 2026'da 88 sn sürdü.
    // Yalnız süre bütçesi büyür, doğrulamalar aynı kalır.
    test.setTimeout(WEBKIT_KLASOR_SURESI);
    await seciciYok(page);
    await serve(page, FIXTURE);
    await openAdmin(page, '/veri');
    const bos = testInfo.outputPath('bos-klasor');
    mkdirSync(path.join(bos, 'notlar'), { recursive: true });
    writeFileSync(path.join(bos, 'notlar', 'oku.json'), '{}');
    const chooser = page.waitForEvent('filechooser');
    await ana(page).getByRole('button', { name: ICE_AKTAR }).click();
    await (await chooser).setFiles(bos);
    await expect(ana(page).getByRole('alert')).toContainText('Hata: Seçilen klasörde nesil yok');
    await expect(durum(page)).toContainText(`Nesil ${GENERATION_ID.slice(0, 6)}`);
  });

  test('ne seçici ne de webkitdirectory varsa düğme devre dışı ve nedeni yanında yazar', async ({ page }) => {
    await seciciYok(page);
    await page.addInitScript(() => {
      try {
        delete (HTMLInputElement.prototype as unknown as Record<string, unknown>).webkitdirectory;
      } catch {
        /* silinemez */
      }
    });
    await serve(page, FIXTURE);
    await openAdmin(page, '/veri');
    const dugme = ana(page).getByRole('button', { name: ICE_AKTAR });
    await expect(dugme).toBeDisabled();
    await expect(dugme).toHaveAccessibleDescription(DESTEK_YOK);
    await expect(ana(page).getByText(DESTEK_YOK)).toBeVisible();
  });
});

// --- 3. Veri durumları: yükleniyor, boş, hata, eski veri — ayrı ve adıyla --------------------------------------------
test.describe('Veri › durumlar', () => {
  test('yükleniyor: aynı yerleşimde "Nesil okunuyor" iskeleti; başlık ve ana eylem yine görünür', async ({ page }) => {
    const sunum = await serve(page, rel => (rel === 'manifest.json' ? 'hold' : FIXTURE.get(rel) ?? { status: 404 }));
    await gotoAdmin(page, '/veri');
    await expect(ana(page).getByRole('heading', { level: 1, name: H1 })).toBeVisible();
    await expect(ana(page).locator('[role="status"][aria-busy="true"]').filter({ hasText: 'Nesil okunuyor' })).toBeVisible();
    await expect(ana(page).getByRole('button', { name: ICE_AKTAR })).toBeVisible();
    await expect(durum(page)).toHaveAttribute('data-state', 'checking');
    sunum.release();
    await expect(durum(page)).toHaveAttribute('data-state', 'fresh');
    await expect(sorunlar(page)).toBeVisible();
  });

  test('hata: manifest okunamazsa "Hata: Veri okunamadı" ve "Yeniden dene"; kayıt gösterilmez', async ({ page }) => {
    await serve(page, rel => (rel === 'manifest.json' ? { status: 404, body: { error: 'Dosya yok' } } : FIXTURE.get(rel) ?? { status: 404 }));
    await gotoAdmin(page, '/veri');
    const hata = ana(page).getByRole('alert').filter({ has: page.getByRole('heading', { name: /^Hata: Veri okunamadı/ }) });
    await expect(hata).toBeVisible();
    await expect(hata.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
    await expect(durum(page)).toHaveAttribute('data-state', 'error');
    await expect(sorunlar(page)).toHaveCount(0);
    await kurallarTemiz(page, 'hata durumu');
  });

  test('boş: nesilde issues yoksa "Kaynakta sorun kaydı yok"; özet sayım uydurmaz ("Henüz yok")', async ({ page }) => {
    await serve(page, withoutIssues(FIXTURE));
    await openAdmin(page, '/veri');
    await expect(sorunlar(page)).toContainText('Kaynakta sorun kaydı yok');
    await expect(ana(page).getByRole('list', { name: 'Özet' }).getByRole('listitem').first()).toContainText('Henüz yok');
  });

  test('eski veri: yenileme başarısızsa son iyi nesil kalır ve tazelik satırı "yenilenemedi" der', async ({ page }) => {
    let failing = false;
    await serve(page, rel => (failing && rel === 'manifest.json' ? { status: 503, body: { error: 'Sunucu meşgul' } } : FIXTURE.get(rel) ?? { status: 404 }));
    await openAdmin(page, '/veri');
    failing = true;
    await durum(page).getByRole('button', { name: 'Yenile' }).click();
    await expect(durum(page)).toHaveAttribute('data-state', 'stale');
    await expect(durum(page)).toContainText('yenilenemedi');
    await expect(grupBolgesi(page, 'Formül hatası').getByText('Gerçekleşen · G9', { exact: true })).toBeVisible();
  });
});

// --- 4. Uyarlanır genişlikler (@matrix: entegrasyonda 320×480, 360, 375, 568×320, tablet, masaüstü) -------------------
test('profil sözleşmesi: telefonda tablo yok, başlık/amaç/ana eylem ilk ekranda; genişte tablo; sayfa yatay taşmaz', { tag: '@matrix' }, async ({ page }) => {
  await serve(page, withFormulaErrors(FIXTURE, BUYUK_SORUN));
  await openAdmin(page, '/veri');
  const p = await profil(page);
  const viewport = page.viewportSize()!;
  const telefonBekleniyor = viewport.width < 600 || Math.min(viewport.width, viewport.height) < 480;
  expect(p, `${viewport.width}×${viewport.height} profili`).toBe(telefonBekleniyor ? 'phone' : viewport.width < 1024 ? 'tablet' : 'desktop');
  const bolge = grupBolgesi(page, 'Formül hatası');
  if (p === 'phone') {
    await ilkEkran(page);
    await expect(ana(page).getByRole('table')).toHaveCount(0);
    await expect(bolge.getByRole('listitem')).toHaveCount(SAYFA_BOYUTU);
  } else {
    // Masaüstünde tablo; tablette tablo sığıyorsa tablo, sığmıyorsa akordeon (README › Uyarlanır teslim).
    const tablo = bolge.getByRole('table', { name: 'Formül hatası' });
    if (p === 'desktop') await expect(tablo).toBeVisible();
    const satirlar = (await tablo.count()) > 0 ? bolge.getByRole('row').filter({ has: page.getByRole('cell') }) : bolge.getByRole('listitem');
    await expect(satirlar).toHaveCount(SAYFA_BOYUTU);
  }
  await kurallarTemiz(page, `${viewport.width}×${viewport.height}`);
});

test('telefon genişlikleri 320×480 · 360 · 375 · 390 · 568×320: profil telefon kalır, ilk ekran ve taşma kuralları', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium' && testInfo.project.name !== 'webkit', 'Görev koşusunda telefon projelerinde açık boyutlarla sınanır.');
  await serve(page, withFormulaErrors(FIXTURE, BUYUK_SORUN));
  for (const size of [{ width: 320, height: 480 }, { width: 360, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(size);
    await openAdmin(page, '/veri');
    const label = `${size.width}×${size.height}`;
    expect(await profil(page), `${label} profili`).toBe('phone');
    await ilkEkran(page);
    await expect(ana(page).getByRole('table')).toHaveCount(0);
    await expect(grupBolgesi(page, 'Formül hatası').getByRole('listitem')).toHaveCount(SAYFA_BOYUTU);
    await kurallarTemiz(page, label);
  }
});

// --- 5. Geniş profil (masaüstü projesi): grup içinde tablo, ilk sütun hücre adresi -------------------------------
test('geniş profilde her grup kendi tablosudur; sütunlar Hücre · Kaynak · Etki · Durum', async ({ page }) => {
  await serve(page, FIXTURE);
  await openAdmin(page, '/veri');
  test.skip((await profil(page)) === 'phone', 'Geniş profil (tablet/masaüstü) davranışı.');
  test.skip((await profil(page)) === 'tablet', 'Tablette tablo yalnız sığarsa çizilir; @matrix testi kapsar.');
  const bolge: Locator = grupBolgesi(page, 'Formül hatası');
  await expect(bolge.getByRole('table', { name: 'Formül hatası' })).toBeVisible();
  // Yapışkan başlık ayrı bir <table> olabilir: başlık hücreleri grup bölgesinde aranır.
  await expect(bolge.getByRole('columnheader')).toHaveText(['Hücre', 'Kaynak', 'Etki', 'Durum']);
  await expect(bolge.getByRole('row', { name: /Gerçekleşen · G9/ })).toContainText('Gözden geçirilecek');
  expect(FIXTURE_ISSUES.length).toBeGreaterThan(0);
  await kurallarTemiz(page, 'geniş');
});
