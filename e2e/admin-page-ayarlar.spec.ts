import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { ADMIN_MAIN, enterKeyboardMode, horizontalOverflow, openAdmin, tabKey } from './admin-helpers';
import { accentEdges, focusRing, overflow, smallText } from './admin-detectors';

// Ayarlar — kritik kullanıcı yolculuğu (tasarım: ekranlar.md SayfaAyarlar / SayfaAyarlarDar, bundle.js Aile.Pages.Ayarlar).
// Telefon önce (chromium 320×568 dokunmatik); webkit 390×844 dokunmatik aynı yolculuğu koşar. @matrix etiketli test
// entegrasyonda 320×480, 360, 375, 568×320 (telefon profili), 820×1180 tablet ve 1440 masaüstünde de koşar.
// Yolculuk: veri kaynağı durumu (nesil + canlı bağlantı) → Apps Script adresi/anahtarı kaydet (anahtar hiçbir yerde düz
// metin değil) → yerel değişiklik kümesini dışa aktar (indirilen JSON'da gizli değer yok) → önbelleği onayla temizle
// (bekleyen değişiklik, adres ve anahtar korunur). Ortak cihaz yolculuğu: bu cihazdaki tüm panel verisi onayla silinir
// (nesil önbelleği, canlı bütçe son okuması, değişiklik kümesi; ana uygulamanın verisi ve seçilmezse adres/anahtar
// kalır), sayfa yeniden yüklenir ve sonucu duyurur. Gizlilik: geliştirme ara katmanı nesli yalnız aynı kökene verir.
// Veri: dev sunucusunun sentetik nesli (AILE_GENERATION_DIR);
// Google'a hiçbir istek gitmez (gidenler kesilir ve test düşer). Seçiciler role/label; antd iç sınıfı yok.

// --- Sentetik nesil (beklenenler fixture'dan hesaplanır) -------------------------------------------------------------
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && statSync(path.join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = path.join(FIXTURE_ROOT, GENERATION_ID);
const NESIL = GENERATION_ID.slice(0, 6);
const MANIFEST = JSON.parse(readFileSync(path.join(GENERATION_DIR, 'manifest.json'), 'utf8')) as { counts: Record<string, number> };
const KOLEKSIYON = Object.keys(MANIFEST.counts).length;
const KAYIT = Object.values(MANIFEST.counts).reduce((sum, count) => sum + count, 0);
const sayi = (n: number) => new Intl.NumberFormat('tr-TR').format(n);
const NEEDS = (JSON.parse(readFileSync(path.join(GENERATION_DIR, 'data/purchase_needs/household/00000.json'), 'utf8')) as {
  records: { id: string; source_record_id: string; attributes?: { not?: unknown } }[];
}).records;
const LAMBADER = NEEDS.find(record => record.source_record_id === 'kalem-027')!;

const AMAC = 'Aile bilgilerini, biçimleri, e-tablo bağlantısını ve üyeleri yönetin.';
const ADRES = 'https://script.google.com/macros/s/SENTETIK-DAGITIM-2098/exec';
const ANAHTAR = 'sentetik-anahtar-2098-gizli';
const CHANGE_SET_KEY = 'aile:admin:changeset:v1';
/** live.ts LIVE_BUDGET_CACHE_KEY: son iyi canlı bütçe okuması (idb-keyval varsayılan deposu); sheet = sentetik kimlik. */
const LIVE_BUDGET_KEY = 'aile:admin:live-budget:v1';
const SYNTHETIC_SHEET = 'synthetic-budget-sheet-2098';
const LIVE_READ_AT = '2026-10-28T11:32:00.000Z';
const LIVE_LAST_GOOD = { v: 1, sheet: SYNTHETIC_SHEET, budget: { readAt: LIVE_READ_AT, periods: [], months: [], categories: [], groups: [], irregular: [] } };
/** Sentetik yerel not opu (ChangeSet sözleşmesi: opId, recordId, kind, at, actor, before, after). */
const SEED_OP = {
  opId: '01JSENTETIKAYARLAR00000001',
  recordId: LAMBADER.id,
  kind: 'note',
  at: '2026-10-28T14:05:00.000Z',
  actor: 'local',
  // Önkoşul nesildeki gerçek nottur: değişiklik kümesi bayat önkoşulu çakışma sayıp atlar (d03).
  before: { note: typeof LAMBADER.attributes?.not === 'string' ? LAMBADER.attributes.not : null },
  after: { note: 'Sentetik not' },
};

// --- IndexedDB (ham API; sayfa bağlamında) ---------------------------------------------------------------------------
type IdbAction = { db: string; store: string; op: 'keys' } | { db: string; store: string; op: 'get'; key: string } | { db: string; store: string; op: 'put'; key: string; value: unknown };

/** Ana uygulamanın aynı idb-keyval deposundaki anahtarı (src/sync/cache.ts DATA_KEY): panel silmesi buna dokunmamalı. */
const MAIN_APP_KEY = 'aile:data:v1';
const MAIN_APP_VALUE = { sentetik: true, savedAt: '2026-10-28T11:00:00.000Z', items: [] };
const keyvalGet = (page: Page, key: string) => idb<unknown>(page, { db: 'keyval-store', store: 'keyval', op: 'get', key });
const CIHAZ_BOLGESI = 'Cihazdaki panel verisi';
const CIHAZ_DUGMESI = 'Bu cihazdaki tüm panel verisini sil';
const CIHAZ_ONAYI = 'Bu cihazdaki tüm panel verisi silinsin mi?';
const BAGLANTI_SECENEGI = 'Apps Script adresini ve uygulama anahtarını da sil';

function idb<T>(page: Page, action: IdbAction): Promise<T> {
  return page.evaluate(
    (a) => new Promise<T>((resolve, reject) => {
      const request = indexedDB.open(a.db);
      request.onupgradeneeded = () => { request.result.createObjectStore(a.store); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const conn = request.result;
        if (!conn.objectStoreNames.contains(a.store)) {
          conn.close();
          resolve((a.op === 'keys' ? [] : undefined) as T);
          return;
        }
        const tx = conn.transaction(a.store, a.op === 'put' ? 'readwrite' : 'readonly');
        const store = tx.objectStore(a.store);
        const result = a.op === 'keys' ? store.getAllKeys() : a.op === 'get' ? store.get(a.key) : store.put(a.value, a.key);
        tx.oncomplete = () => { conn.close(); resolve(result.result as T); };
        tx.onerror = () => { conn.close(); reject(tx.error); };
      };
    }),
    action,
  );
}

/** Nesil deposunun parça önbelleği (store.ts: IndexedDB 'aile-admin' / 'partitions'). */
const partitionKeys = (page: Page) => idb<string[]>(page, { db: 'aile-admin', store: 'partitions', op: 'keys' });
/** Değişiklik kümesi (changeSet.ts: idb-keyval varsayılan deposu). */
const storedOps = (page: Page) => idb<unknown[] | undefined>(page, { db: 'keyval-store', store: 'keyval', op: 'get', key: CHANGE_SET_KEY });

// --- Yardımcılar ------------------------------------------------------------------------------------------------------
type Profil = 'phone' | 'tablet' | 'desktop';
/** adaptive/profile.ts kuralı: genişlik < 600 ya da kısa kenar < 480 telefon; < 1024 tablet; aksi masaüstü. */
function profil(page: Page): Profil {
  const { width, height } = page.viewportSize() ?? { width: 1440, height: 900 };
  if (width < 600 || Math.min(width, height) < 480) return 'phone';
  return width < 1024 ? 'tablet' : 'desktop';
}

/** Google'a giden her isteği keser ve kaydeder (test sonunda boş olmalı). */
async function googleKapisi(page: Page): Promise<string[]> {
  const giden: string[] = [];
  await page.route(/^https?:\/\/([^/]+\.)?(google|googleapis|gstatic|googleusercontent)\.com\//, route => {
    giden.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  return giden;
}

const bolum = (main: Locator, name: string) => main.getByRole('region', { name, exact: true });
/** Onay katmanı: telefonda alt sayfa (dialog), genişte alertdialog. */
const onay = (page: Page) => page.getByRole('alertdialog', { name: 'Önbellek temizlensin mi?' }).or(page.getByRole('dialog', { name: 'Önbellek temizlensin mi?' }));

/** Öğenin ortasındaki en üst öğe öğenin kendisi ya da içindekidir (yapışkan altlık vb. örtmüyor). */
async function ortasiAcik(locator: Locator): Promise<boolean> {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!top && (top === element || element.contains(top) || top.contains(element));
  });
}

async function kurallar(page: Page) {
  expect(await horizontalOverflow(page), 'sayfa düzeyinde yatay taşma yok').toEqual([]);
  expect(await overflow(page, { root: ADMIN_MAIN }), 'görünüm alanından taşan / kesilen metin yok').toEqual([]);
  expect(await smallText(page, { root: ADMIN_MAIN }), 'okunur metin ≥ 14 CSS px').toEqual([]);
  expect(await accentEdges(page, { root: ADMIN_MAIN }), 'kavisli vurgu kenarı yok').toEqual([]);
}

// --- Kritik yolculuk ---------------------------------------------------------------------------------------------------
test.describe('Ayarlar › kritik yolculuk', () => {
  test('veri kaynağı durumu → canlı bağlantı kaydı → değişiklik kümesi dışa aktarma → onaylı önbellek temizleme', async ({ page }, testInfo) => {
    const google = await googleKapisi(page);
    // İlk açılış IndexedDB'yi kurar; sonra sentetik bekleyen op yazılır ve sayfa tam yeniden yüklenir.
    await openAdmin(page, '/ayarlar');
    await idb(page, { db: 'keyval-store', store: 'keyval', op: 'put', key: CHANGE_SET_KEY, value: [SEED_OP] });
    await idb(page, { db: 'keyval-store', store: 'keyval', op: 'put', key: LIVE_BUDGET_KEY, value: LIVE_LAST_GOOD });
    const main = await openAdmin(page, '/ayarlar');

    // 1. Başlık + amaç ilk bakışta; veri kaynağı durumu başlıktaki tazelik satırında.
    await expect(main.getByRole('heading', { level: 1, name: 'Ayarlar' })).toBeInViewport();
    await expect(main.getByText(AMAC)).toBeInViewport();
    await expect(main.getByText(`Nesil ${NESIL}`).first()).toBeVisible();
    await expect(main.getByRole('list', { name: 'Özet' })).toContainText('Adres yok');

    const nesil = bolum(main, 'Nesil kaynağı');
    await expect(nesil).toContainText('Geliştirme sunucusu (');
    await expect(nesil).toContainText(`${sayi(KOLEKSIYON)} koleksiyon · ${sayi(KAYIT)} kayıt`);
    // Canlı Sheets: kimlik tanımlı; son canlı okuma yerel son iyi okumadan, İstanbul saatiyle (Ayarlar Google'a gitmez).
    const butce = bolum(main, 'Bütçe e-tablosu');
    await expect(butce).toContainText('Kimlik tanımlı (VITE_BUDGET_SHEET_ID)');
    await expect(butce).toContainText('Son canlı okuma');
    await expect(butce).toContainText('28.10.2026 14:32');
    await expect(butce).not.toContainText(SYNTHETIC_SHEET);

    // 2. Canlı bağlantı: adres + anahtar kaydedilir; ana eylem (Kaydet) alan doldurulurken erişilebilir.
    const canli = bolum(main, 'Canlı bağlantı');
    await expect(canli).toContainText('Adres yok');
    await expect(canli).toContainText('Anahtar yok');
    // Kullanıcı alana kaydırır (WebKit fill kendiliğinden kaydırmaz); hiçbir katman (altlık dahil) alanı örtmez.
    const adresAlani = canli.getByLabel('Apps Script adresi');
    await adresAlani.scrollIntoViewIfNeeded();
    await adresAlani.fill(ADRES);
    const anahtarAlani = canli.getByLabel('Uygulama anahtarı');
    await anahtarAlani.scrollIntoViewIfNeeded();
    await anahtarAlani.fill(ANAHTAR);
    await expect(anahtarAlani).toBeInViewport();
    expect(await ortasiAcik(anahtarAlani), 'anahtar alanı yapışkan altlığın altında kalmıyor').toBe(true);
    const kaydet = canli.getByRole('button', { name: 'Kaydet' });
    await expect(kaydet).toBeEnabled();
    await kaydet.scrollIntoViewIfNeeded();
    await expect(kaydet).toBeInViewport();
    expect(await ortasiAcik(kaydet), 'Kaydet örtülmüyor').toBe(true);
    await kaydet.click();
    await expect(canli).toContainText('Hazır');
    await expect(canli).toContainText('Anahtar kayıtlı');
    await expect(canli.getByLabel('Uygulama anahtarı')).toHaveValue('');
    expect(await page.evaluate(() => localStorage.getItem('aile:appKey'))).toBe(ANAHTAR);
    // Gizli değer DOM'da (metin, öznitelik, alan değeri) hiçbir biçimde yok.
    expect(await page.content()).not.toContain(ANAHTAR);
    expect(await page.evaluate(key => Array.from(document.querySelectorAll('input, textarea')).some(el => (el as HTMLInputElement).value.includes(key)), ANAHTAR)).toBe(false);

    // 3. Değişiklik kümesi: bekleyen op, önizleme ve indirme; indirilen dosyada gizli değer yok.
    const kume = bolum(main, 'Değişiklik kümesi');
    await expect(kume).toContainText('1 bekleyen değişiklik');
    await kume.getByRole('button', { name: /Dışa aktarma önizlemesi/ }).click();
    const json = kume.getByLabel('Dışa aktarma JSON');
    await expect(json).toContainText(`"opId": "${SEED_OP.opId}"`);
    await expect(json).toContainText('"not": "Sentetik not"');
    const indir = kume.getByRole('button', { name: 'Değişiklik kümesini indir' });
    await expect(indir).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), indir.click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^aile-degisiklik-kumesi-${NESIL}-\\d{8}-\\d{4}\\.json$`));
    const dosya = readFileSync(await download.path(), 'utf8');
    const disa = JSON.parse(dosya) as { kind: string; generation_id: string; pending: number; ops: { opId: string }[] };
    expect(disa.kind).toBe('aile-change-set-batch');
    expect(disa.generation_id).toBe(GENERATION_ID);
    expect(disa.pending).toBe(1);
    expect(disa.ops.map(op => op.opId)).toEqual([SEED_OP.opId]);
    expect(dosya).not.toContain(ANAHTAR);
    expect(dosya).not.toContain('SENTETIK-DAGITIM-2098');
    await testInfo.attach('disa-aktarma.json', { body: dosya, contentType: 'application/json' });

    // 4. Önbellek: sayım IndexedDB ile aynı; Vazgeç hiçbir şey silmez; onay siler, korunanlar korunur.
    await expect.poll(async () => (await partitionKeys(page)).length, { message: 'nesil parçaları önbellekte' }).toBeGreaterThan(0);
    const once = (await partitionKeys(page)).length;
    const onbellek = bolum(main, 'Önbellek');
    await expect(onbellek).toContainText(`${sayi(once)} parça`);
    const temizle = onbellek.getByRole('button', { name: 'Önbelleği temizle' });
    await temizle.click();
    const katman = onay(page);
    await expect(katman).toBeVisible();
    await expect(katman).toContainText(`${sayi(once)} parça silinir`);
    await expect(katman).toContainText('1 bekleyen değişiklik');
    await katman.getByRole('button', { name: 'Vazgeç' }).click();
    await expect(katman).toBeHidden();
    expect((await partitionKeys(page)).length).toBe(once);

    await temizle.click();
    await expect(katman).toBeVisible();
    const onayla = katman.getByRole('button', { name: 'Önbelleği temizle' });
    await onayla.scrollIntoViewIfNeeded();
    await expect(onayla).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('ayarlar-onay.png') });
    await onayla.click();
    await expect(katman).toBeHidden();
    await expect(onbellek.getByRole('status').filter({ hasText: 'Önbellek temizlendi' })).toContainText(`${sayi(once)} parça silindi`);
    await expect(onbellek).toContainText('Bekleyen 1 değişiklik korundu');
    await expect(onbellek).toContainText('0 parça');
    expect(await partitionKeys(page)).toEqual([]);
    expect(await storedOps(page)).toHaveLength(1);
    expect(await page.evaluate(() => [localStorage.getItem('aile:apiUrl'), localStorage.getItem('aile:appKey')])).toEqual([ADRES, ANAHTAR]);

    await page.screenshot({ path: testInfo.outputPath('ayarlar-sonra.png'), fullPage: true });
    await kurallar(page);
    expect(google, 'Google\'a istek yok').toEqual([]);
  });

  test('eski veri: kaynak yenilenemezse son iyi nesil kalır ve "Eski veri" / "yenilenemedi" adıyla yazılır', async ({ page }) => {
    const google = await googleKapisi(page);
    const main = await openAdmin(page, '/ayarlar');
    // Kaynak yenilemede ulaşılamaz: son iyi nesil kalır, tazelik satırı ve Nesil kaynağı satırı eski veriyi adıyla söyler.
    await page.route('**/__aile/generation/manifest.json', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Sentetik kesinti"}' }));
    const nesil = bolum(main, 'Nesil kaynağı');
    await nesil.getByRole('button', { name: 'Yenile' }).click();
    await expect(main.getByText('yenilenemedi').first()).toBeVisible();
    await expect(nesil).toContainText('Eski veri');
    await expect(nesil).toContainText(`${sayi(KOLEKSIYON)} koleksiyon`);
    await kurallar(page);
    expect(google).toEqual([]);
  });

  test('klavye: Önbelleği temizle → onay açılır, Escape kapatır, odak düğmeye döner; tek alt çizgi, halka yok', async ({ page, browserName }) => {
    const main = await openAdmin(page, '/ayarlar');
    await enterKeyboardMode(page, browserName);
    const temizle = bolum(main, 'Önbellek').getByRole('button', { name: 'Önbelleği temizle' });
    await temizle.focus();
    expect(await focusRing(page)).toEqual([]);
    await page.keyboard.press('Enter');
    const katman = onay(page);
    await expect(katman).toBeVisible();
    await expect.poll(() => katman.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(katman).toBeHidden();
    await expect(temizle).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
  });
});

// --- Ortak cihaz: bu cihazdaki tüm panel verisini silme ------------------------------------------------------------------
test.describe('Ayarlar › ortak cihazda tam silme', () => {
  test('tüm panel verisi onayla silinir; ana uygulamanın verisi ve (seçilmezse) adres/anahtar kalır; sayfa yenilenip sonucu duyurur', async ({ page }, testInfo) => {
    const google = await googleKapisi(page);
    // Taze bağlam: Ayarlar'ın kendi okuduğu parçalar (yeniden yüklemede yine okunacaklar) kaydedilir.
    await openAdmin(page, '/ayarlar');
    const ayarlarParcalari = new Set(await partitionKeys(page));
    await idb(page, { db: 'keyval-store', store: 'keyval', op: 'put', key: CHANGE_SET_KEY, value: [SEED_OP] });
    await idb(page, { db: 'keyval-store', store: 'keyval', op: 'put', key: LIVE_BUDGET_KEY, value: LIVE_LAST_GOOD });
    await idb(page, { db: 'keyval-store', store: 'keyval', op: 'put', key: MAIN_APP_KEY, value: MAIN_APP_VALUE });
    await page.evaluate(([adres, anahtar]) => {
      localStorage.setItem('aile:apiUrl', adres);
      localStorage.setItem('aile:appKey', anahtar);
    }, [ADRES, ANAHTAR] as const);
    // Alımlar başka koleksiyonların parçalarını önbelleğe yazar (geliştirmede kalıcı önbellek açık).
    await openAdmin(page, '/alimlar');
    const main = await openAdmin(page, '/ayarlar');
    const once = await partitionKeys(page);
    expect(once.filter(key => !ayarlarParcalari.has(key)).length, 'Ayarlar dışında önbelleğe yazılmış parça').toBeGreaterThan(0);

    const bolge = bolum(main, CIHAZ_BOLGESI);
    await expect(bolge).toContainText('Ortak bir cihazda');
    await expect(bolum(main, 'Değişiklik kümesi')).toContainText('1 bekleyen değişiklik');
    await bolge.getByRole('button', { name: CIHAZ_DUGMESI }).click();
    const katman = page.getByRole('alertdialog', { name: CIHAZ_ONAYI });
    await expect(katman).toBeVisible();
    await expect(katman).toContainText(`Nesil önbelleği: ${sayi(once.length)} parça`);
    await expect(katman).toContainText('Son canlı bütçe okuması');
    await expect(katman).toContainText('Bekleyen değişiklikler: 1 (e-tabloya gönderilmedi; silinince geri gelmez)');
    const secenek = katman.getByRole('checkbox', { name: BAGLANTI_SECENEGI });
    await expect(secenek).not.toBeChecked();
    // Seçenek satırının tamamı dokunma hedefidir: 44 px, kaba girişte 48 px.
    const hedef = (await page.locator('html[data-input-coarse]').count()) > 0 ? 48 : 44;
    const satir = await secenek.locator('xpath=ancestor::label[1]').boundingBox();
    expect(Math.round(satir!.height), 'seçenek dokunma hedefi').toBeGreaterThanOrEqual(hedef);
    const tumunuSil = katman.getByRole('button', { name: 'Tümünü sil' });
    await tumunuSil.scrollIntoViewIfNeeded();
    await expect(tumunuSil).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('cihaz-onay.png') });
    expect(await smallText(page, { root: '[role="alertdialog"]' }), 'onay metni ≥ 14 CSS px').toEqual([]);

    // Sil → sayfa yeniden yüklenir (bellekteki kopyalar da gider) ve sonucu bir kez duyurur.
    await Promise.all([page.waitForEvent('load'), tumunuSil.click()]);
    const yeni = page.locator(ADMIN_MAIN);
    const sonuc = bolum(yeni, CIHAZ_BOLGESI).getByRole('status');
    await expect(sonuc).toContainText(`Bu cihazdaki panel verisi silindi: ${sayi(once.length)} nesil parçası`);
    await expect(sonuc).toContainText('Apps Script adresi ve uygulama anahtarı korundu.');
    await expect(bolum(yeni, 'Değişiklik kümesi')).toContainText('Bekleyen değişiklik yok');
    await expect(bolum(yeni, 'Bütçe e-tablosu')).toContainText('Henüz yok');

    expect(await storedOps(page), 'değişiklik kümesi silindi').toBeUndefined();
    expect(await keyvalGet(page, LIVE_BUDGET_KEY), 'canlı bütçe son okuması silindi').toBeUndefined();
    expect(await keyvalGet(page, MAIN_APP_KEY), 'ana uygulamanın verisi korunur').toEqual(MAIN_APP_VALUE);
    // Yeniden yüklenen Ayarlar yalnız kendi parçalarını yeniden okuyabilir; Alımlar'ın parçaları gitti.
    expect((await partitionKeys(page)).filter(key => !ayarlarParcalari.has(key)), 'silinmeyen parça').toEqual([]);
    expect(await page.evaluate(() => [localStorage.getItem('aile:apiUrl'), localStorage.getItem('aile:appKey')])).toEqual([ADRES, ANAHTAR]);
    expect(await page.evaluate(() => sessionStorage.getItem('aile:admin:cihaz-silindi')), 'sonuç yalnız bir kez duyurulur').toBeNull();
    await page.screenshot({ path: testInfo.outputPath('cihaz-sonra.png'), fullPage: true });
    await kurallar(page);
    expect(google, 'Google\'a istek yok').toEqual([]);
  });

  test('seçenek işaretlenirse Apps Script adresi ve anahtarı da silinir (ana uygulamayla ortak ayar)', async ({ page }) => {
    await openAdmin(page, '/ayarlar');
    await page.evaluate(([adres, anahtar]) => {
      localStorage.setItem('aile:apiUrl', adres);
      localStorage.setItem('aile:appKey', anahtar);
    }, [ADRES, ANAHTAR] as const);
    const main = await openAdmin(page, '/ayarlar');
    await expect(bolum(main, 'Canlı bağlantı')).toContainText('ana uygulamayla ortaktır');
    await bolum(main, CIHAZ_BOLGESI).getByRole('button', { name: CIHAZ_DUGMESI }).click();
    const katman = page.getByRole('alertdialog', { name: CIHAZ_ONAYI });
    await katman.getByRole('checkbox', { name: BAGLANTI_SECENEGI }).check();
    await Promise.all([page.waitForEvent('load'), katman.getByRole('button', { name: 'Tümünü sil' }).click()]);
    const yeni = page.locator(ADMIN_MAIN);
    await expect(bolum(yeni, CIHAZ_BOLGESI).getByRole('status')).toContainText('Apps Script adresi ve uygulama anahtarı da silindi.');
    await expect(bolum(yeni, 'Canlı bağlantı')).toContainText('Adres yok');
    await expect(bolum(yeni, 'Canlı bağlantı')).toContainText('Anahtar yok');
    expect(await page.evaluate(() => [localStorage.getItem('aile:apiUrl') ?? '', localStorage.getItem('aile:appKey')])).toEqual(['', null]);
  });

  test('klavye: onay açılır, Tab seçeneğe gelir (tek alt çizgi, halka yok), Space işaretler, Escape kapatır ve odak düğmeye döner', async ({ page, browserName }) => {
    const main = await openAdmin(page, '/ayarlar');
    await enterKeyboardMode(page, browserName);
    const dugme = bolum(main, CIHAZ_BOLGESI).getByRole('button', { name: CIHAZ_DUGMESI });
    await dugme.focus();
    await page.keyboard.press('Enter');
    const katman = page.getByRole('alertdialog', { name: CIHAZ_ONAYI });
    await expect(katman).toBeVisible();
    const secenek = katman.getByRole('checkbox', { name: BAGLANTI_SECENEGI });
    // WebKit'te Tab yalnız metin alanlarına gider; düğme/onay kutusu için Alt+Tab (Safari "her öğeyi vurgula" ayarı).
    for (let i = 0; i < 10 && !(await secenek.evaluate(element => element === document.activeElement)); i++) await page.keyboard.press(tabKey(browserName));
    await expect(secenek).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
    const cizgi = await secenek.locator('xpath=ancestor::label[1]').evaluate(element => {
      const after = getComputedStyle(element, '::after');
      return { content: after.content, height: after.height };
    });
    expect(cizgi.content, 'odak çizgisi görünür').not.toBe('none');
    await page.keyboard.press('Space');
    await expect(secenek).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(katman).toBeHidden();
    await expect(dugme).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
  });
});

// --- Gizlilik: geliştirme ara katmanı yalnız aynı kökene ---------------------------------------------------------------
test('gizlilik: nesil ara katmanı başka localhost kökenine 403 verir; panelin okumadığı nesil dosyaları 404', async ({ page, baseURL }) => {
  const kendi = new URL(baseURL!).origin;
  const baska = `http://localhost:${new URL(baseURL!).port}`;
  // Adres çubuğundan açılan sayfa (Sec-Fetch-Site: none) okunur; sonra o sayfa (localhost kökeni) 127.0.0.1'i ister.
  const meta = await page.goto(`${baska}/__aile/generation/_meta`);
  expect(meta?.status()).toBe(200);
  const sonuc = await page.evaluate(async ([ayniKok, baskaKok]) => {
    const oku = async (url: string) => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        return { status: response.status, body: await response.text() };
      } catch (error) {
        return { status: 0, body: String(error) };
      }
    };
    return {
      ayni: await oku(`${ayniKok}/__aile/generation/manifest.json`),
      capraz: await oku(`${baskaKok}/__aile/generation/manifest.json`),
      ham: await oku(`${ayniKok}/__aile/generation/contracts/postgres-mapping.json`),
    };
  }, [baska, kendi] as const);
  expect(sonuc.ayni.status, 'aynı köken').toBe(200);
  expect(JSON.parse(sonuc.ayni.body).generation_id).toBe(GENERATION_ID);
  expect(sonuc.capraz.status, 'başka köken').toBe(403);
  expect(sonuc.capraz.body).not.toContain(GENERATION_ID);
  expect(sonuc.ham.status, 'panelin okumadığı nesil dosyası').toBe(404);
});

// --- Uyarlanır yerleşim (matris) ---------------------------------------------------------------------------------------
test('Ayarlar uyarlanır yerleşim: profil, satır düzeni, ana eylem ve onay katmanı görünüm alanında', { tag: '@matrix' }, async ({ page }) => {
  const main = await openAdmin(page, '/ayarlar');
  const beklenen = profil(page);
  await expect(page.locator('html')).toHaveAttribute('data-profile', beklenen);
  await expect(main.getByRole('heading', { level: 1, name: 'Ayarlar' })).toBeInViewport();

  // Satır düzeni: telefon/tablette başlık alanların üstünde (alt alta); masaüstünde solda (yan yana).
  const canli = bolum(main, 'Canlı bağlantı');
  const baslik = await canli.getByRole('heading', { level: 2, name: 'Canlı bağlantı' }).boundingBox();
  const adres = canli.getByLabel('Apps Script adresi');
  const alan = await adres.boundingBox();
  expect(baslik && alan).toBeTruthy();
  if (beklenen === 'desktop') expect(alan!.x).toBeGreaterThan(baslik!.x + baslik!.width);
  else expect(alan!.y).toBeGreaterThan(baslik!.y + baslik!.height);

  // Alan doldurulurken ne odaklı alan ne Kaydet örtülür (yapışkan altlık kısa yükseklikte de alanı kapatmaz).
  await adres.scrollIntoViewIfNeeded();
  await adres.click();
  await adres.fill(ADRES);
  await expect(adres).toBeInViewport();
  expect(await ortasiAcik(adres), 'odaklı alan örtülmüyor').toBe(true);
  const kaydet = canli.getByRole('button', { name: 'Kaydet' });
  await kaydet.scrollIntoViewIfNeeded();
  await expect(kaydet).toBeInViewport();
  expect(await ortasiAcik(kaydet), 'Kaydet örtülmüyor').toBe(true);
  await canli.getByRole('button', { name: 'Vazgeç' }).click();

  // Onay katmanı: telefonda alttan sayfa; birincil eylem görünüm alanında.
  await bolum(main, 'Önbellek').getByRole('button', { name: 'Önbelleği temizle' }).click();
  const katman = onay(page);
  await expect(katman).toBeVisible();
  const onayla = katman.getByRole('button', { name: 'Önbelleği temizle' });
  await onayla.scrollIntoViewIfNeeded();
  await expect(onayla).toBeInViewport();
  const kutu = await katman.boundingBox();
  const vp = page.viewportSize()!;
  expect(kutu!.width).toBeLessThanOrEqual(vp.width + 1);
  if (beklenen === 'phone') expect(Math.round(kutu!.y + kutu!.height)).toBeGreaterThanOrEqual(vp.height - 1);
  await katman.getByRole('button', { name: 'Vazgeç' }).click();
  await expect(katman).toBeHidden();

  // Tam silme onayı (daha uzun içerik): kısa yükseklikte de birincil eylem ve seçenek erişilebilir, katman taşmaz.
  await bolum(main, CIHAZ_BOLGESI).getByRole('button', { name: CIHAZ_DUGMESI }).click();
  const tam = page.getByRole('alertdialog', { name: CIHAZ_ONAYI });
  await expect(tam).toBeVisible();
  const secenek = tam.getByRole('checkbox', { name: BAGLANTI_SECENEGI });
  await secenek.scrollIntoViewIfNeeded();
  await expect(secenek).toBeInViewport();
  const tumunuSil = tam.getByRole('button', { name: 'Tümünü sil' });
  await tumunuSil.scrollIntoViewIfNeeded();
  await expect(tumunuSil).toBeInViewport();
  const tamKutu = await tam.boundingBox();
  expect(tamKutu!.width).toBeLessThanOrEqual(vp.width + 1);
  if (beklenen === 'phone') expect(Math.round(tamKutu!.y + tamKutu!.height)).toBeGreaterThanOrEqual(vp.height - 1);
  expect(await smallText(page, { root: '[role="alertdialog"]' }), 'onay metni ≥ 14 CSS px').toEqual([]);
  await tam.getByRole('button', { name: 'Vazgeç' }).click();
  await expect(tam).toBeHidden();

  await kurallar(page);
});
