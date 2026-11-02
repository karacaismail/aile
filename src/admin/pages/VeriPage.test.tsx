// Veri kalitesi ve içe aktarma sayfası. Tasarım: bundle.js Pages.VeriKalitesi, README "Sayfa iskeleti", "Veri durumları"
// ve "Uyarlanır teslim". Veri gerçek katmandan gelir: GenerationProvider + FixtureGenerationSource (sentetik nesil belleğe
// okunur); depo, sözleşme ve koleksiyon yükleyici gerçektir. Seçiciler role/label ile; antd iç sınıfına bağlı seçici yok.
// Para yok: bu sayfada plan ve gerçek tutar yoktur, yalnız sayımlar vardır; sayımlar koleksiyon başına ayrı yazılır.
//
// Bekleme bütçesi: sayfa soğuk açılışta manifest + üç koleksiyon okur, parçaları sha256 ile doğrular ve antd'yi ilk kez
// çizer. Bu yol tam pakette (paralel işçiler) ve işçinin ilk testinde 1 sn'yi aşabiliyor; RTL'nin genel 1 sn varsayılanı
// "Yenile manifesti yeniden okur" testinin ara sıra "Okunuyor…" görüp düşmesinin nedeniydi (yalnız bu testi soğuk
// işçide koşmak 2,3 sn'de data-state="checking" ile düşürüyordu). Bekleyişler gerçek hazır sinyaline (data-state fresh,
// aria-busy yok, "Yenile" etkin) bağlıdır; HAZIR bütçesi yalnız bu sinyalin üst sınırıdır, sinyal gelince hemen döner.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { FixtureGenerationSource, GenerationProvider, type GenerationHandle, type GenerationSource, type Manifest } from '../data';
import { importsOf } from '../adaptive/sourceRules';
import { VeriPage, dataStatusFor, etkiMetni, sorunTuru, zamanMetni } from './VeriPage';

// --- Sentetik nesil → bellek -------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '../../../fixtures/generation-synthetic');
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => statSync(join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = join(FIXTURE_ROOT, GENERATION_ID);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

const FILES: Record<string, string> = Object.fromEntries(
  walk(GENERATION_DIR)
    .map(full => relative(GENERATION_DIR, full))
    .filter(rel => rel === 'manifest.json' || rel.startsWith('data/'))
    .map(rel => [rel, readFileSync(join(GENERATION_DIR, rel), 'utf8')]),
);
const MANIFEST = JSON.parse(FILES['manifest.json']!) as Manifest;
const ISSUE_COUNT = MANIFEST.counts.issues!;
const SOURCE_COUNT = MANIFEST.counts.sources!;
const SHEET_COUNT = MANIFEST.counts.sheets!;
const sayi = new Intl.NumberFormat('tr-TR');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** Soğuk açılışın gerçek hazır sinyali için üst sınır (bkz. dosya başı). */
const HAZIR = { timeout: 10_000 };
const UZUN = 30_000;

function fixtureSource(files: Record<string, string> = FILES): FixtureGenerationSource {
  return new FixtureGenerationSource(files, 'sentetik');
}

/** issues koleksiyonu nesilde hiç yoksa (manifest + parçalar): sayfa "Kaynakta sorun kaydı yok" demeli. */
function withoutIssues(): Record<string, string> {
  const files = { ...FILES };
  for (const path of Object.keys(files)) if (path.startsWith('data/issues/')) delete files[path];
  const manifest = JSON.parse(files['manifest.json']!) as Manifest;
  manifest.files = manifest.files.filter(file => file.collection !== 'issues');
  delete manifest.counts.issues;
  files['manifest.json'] = JSON.stringify(manifest);
  return files;
}

interface IssueShape { id: string; code: string; provenance: Record<string, unknown>; detail?: unknown; [key: string]: unknown }
/** Gerçek nesildeki büyük kuyruğun sentetik eşi: budget parçasında n formül hatası (satır 2'den, A–H sütunları). */
function withFormulaErrors(n: number): Record<string, string> {
  const rel = 'data/issues/budget/00000.json';
  const envelope = JSON.parse(FILES[rel]!) as { records: IssueShape[] };
  const template = envelope.records.find(issue => issue.code === 'formula_error')!;
  const generated = Array.from({ length: n }, (_, index): IssueShape => ({
    ...template,
    id: `00000000-0000-5000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    provenance: { ...template.provenance, a1: `${String.fromCharCode(65 + (index % 8))}${2 + Math.floor(index / 8)}`, row: 2 + Math.floor(index / 8), column: 1 + (index % 8) },
  }));
  const records = [...generated, ...envelope.records.filter(issue => issue.code !== 'formula_error')];
  const text = `${JSON.stringify({ collection: 'issues', records, schemaVersion: 1 })}\n`;
  const manifest = JSON.parse(FILES['manifest.json']!) as Manifest;
  manifest.generation_id = sha256(`buyuk-${n}`);
  manifest.files = manifest.files.map(file => (file.path === rel ? { ...file, sha256: sha256(text), bytes: text.length, count: records.length } : file));
  manifest.counts.issues = ISSUE_COUNT - 2 + n;
  return { ...FILES, [rel]: text, 'manifest.json': JSON.stringify(manifest) };
}

/** Aynı veri, farklı nesil kimliği ve daha eski yakalama: klasördeki ikinci nesil. */
const ESKI_ID = sha256('eski-nesil');
function olderFiles(): Record<string, string> {
  const manifest = JSON.parse(FILES['manifest.json']!) as Omit<Manifest, 'sources'> & { sources: { capture: Record<string, unknown> }[] };
  manifest.generation_id = ESKI_ID;
  manifest.sources = manifest.sources.map(source => ({ ...source, capture: { ...source.capture, completed_at: '2026-10-20T06:30:00.000Z' } }));
  return { ...FILES, 'manifest.json': JSON.stringify(manifest) };
}

/** İlk okuma başarılı, sonra her okuma başarısız: refresh → stale (son iyi nesil korunur). */
class FlakySource implements GenerationSource {
  readonly kind = 'fixture' as const;
  readonly label = 'kesintili';
  failing = false;
  readonly reads: string[] = [];
  private readonly inner = fixtureSource();
  async readText(path: string): Promise<string> {
    this.reads.push(path);
    if (this.failing) throw new Error('bağlantı kesildi');
    return this.inner.readText(path);
  }
}

/** File System Access tutamağı biçiminde bellek içi klasör ağacı ({ "eski/manifest.json": "…" }). */
function klasorTutamagi(name: string, files: Record<string, string>): unknown {
  const dirs = new Map<string, Set<string>>();
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      (dirs.get(parent) ?? dirs.set(parent, new Set()).get(parent)!).add(`${i === parts.length - 1 ? 'f' : 'd'}:${parts[i]}`);
    }
  }
  const handle = (prefix: string, label: string): unknown => ({
    kind: 'directory',
    name: label,
    getDirectoryHandle: async (segment: string) => {
      const next = prefix ? `${prefix}/${segment}` : segment;
      if (!dirs.get(prefix)?.has(`d:${segment}`)) throw new DOMException('yok', 'NotFoundError');
      return handle(next, segment);
    },
    getFileHandle: async (file: string) => {
      const text = files[prefix ? `${prefix}/${file}` : file];
      if (text === undefined) throw new DOMException('yok', 'NotFoundError');
      return { kind: 'file', name: file, getFile: async () => ({ text: async () => text }) };
    },
    async *values() {
      for (const entry of dirs.get(prefix) ?? []) {
        const [kind, child] = [entry.slice(0, 1), entry.slice(2)];
        if (kind === 'd') yield handle(prefix ? `${prefix}/${child}` : child, child);
        else yield { kind: 'file', name: child };
      }
    },
  });
  return handle('', name);
}
const ikiNesil = (): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(FILES).map(([rel, text]) => [`yeni/${rel}`, text])),
  ...Object.fromEntries(Object.entries(olderFiles()).map(([rel, text]) => [`eski/${rel}`, text])),
});
/** webkitRelativePath taşıyan File listesi (jsdom bu alanı doldurmaz). */
const dosyaListesi = (root: string, files: Record<string, string>): File[] =>
  Object.entries(files).map(([rel, text]) => {
    const file = new File([text], rel.split('/').pop()!, { type: 'application/json' });
    Object.defineProperty(file, 'webkitRelativePath', { value: `${root}/${rel}` });
    return file;
  });

function renderPage({ source = fixtureSource(), device = 'desktop' as Device }: { source?: GenerationSource; device?: Device } = {}) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DeviceContext.Provider value={device}>
        <GenerationProvider source={source} cache={null} changeSet={null}>
          {children}
        </GenerationProvider>
      </DeviceContext.Provider>
    );
  }
  return render(<VeriPage />, { wrapper: Wrapper });
}

const section = (name: string) => screen.getByRole('region', { name });
const sorunlarBolumu = () => section('Çözülecek sorunlar');
// Grup adı "<Tür> <N> kayıt"; CSS'siz jsdom satır içi öğeler arasına boşluk koymaz, tarayıcı (flex öğeleri) koyar.
const grupAdi = (tur: string) => new RegExp(`^${tur}\\s*\\d`);
const grupDugmesi = (tur: string) => within(sorunlarBolumu()).getByRole('button', { name: grupAdi(tur) });
const grupBolgesi = (tur: string) => within(sorunlarBolumu()).getByRole('region', { name: grupAdi(tur) });
/** Bölgenin erişilebilir adı (aria-label ya da aria-labelledby metni); jsdom metinleri boşluksuz birleştirir. */
const bolgeAdi = (element: HTMLElement) => {
  const ids = element.getAttribute('aria-labelledby');
  const adlar = ids ? ids.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '') : [element.getAttribute('aria-label') ?? ''];
  return adlar.join(' ').trim();
};
// role="status" ad almaz (yalnız yazar adı); DataStatus data-state, LoadingShell aria-busy ile ayrılır.
const veriDurumu = () => {
  const el = screen.getAllByRole('status').find(node => node.hasAttribute('data-state'));
  if (!el) throw new Error('Veri durumu satırı yok');
  return el;
};
const yukleniyor = () => screen.queryAllByRole('status').filter(node => node.getAttribute('aria-busy') === 'true');
const waitForFresh = () => waitFor(() => expect(veriDurumu()).toHaveAttribute('data-state', 'fresh'), HAZIR);
/**
 * Sayfa durulana dek bekler: nesil taze, hiçbir bölüm okunmuyor ve "Yenile" etkin. Yalnız "fresh" yetmez: manifest
 * hazır olunca alt bölümler koleksiyon ister; depo yeniden "checking" olur ve DataStatus sözleşmesi gereği "Yenile" bu
 * sürede devre dışıdır. Bu arada tıklanan düğme hiçbir şey yapmaz.
 */
const waitForSettled = () =>
  waitFor(() => {
    expect(veriDurumu()).toHaveAttribute('data-state', 'fresh');
    expect(yukleniyor()).toHaveLength(0);
    expect(within(veriDurumu()).getByRole('button', { name: 'Yenile' })).toBeEnabled();
  }, HAZIR);
// antd yapışkan başlık ayrı bir <table> içindedir: gövde satırları hücresi olan satırlardır (başlık satırı değil).
const bodyRows = (scope: HTMLElement) => within(scope).getAllByRole('row').filter(row => within(row).queryAllByRole('cell').length > 0);

let webkitdirectory: PropertyDescriptor | undefined;
afterEach(() => {
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  if (webkitdirectory) Object.defineProperty(HTMLInputElement.prototype, 'webkitdirectory', webkitdirectory);
  else delete (HTMLInputElement.prototype as unknown as { webkitdirectory?: unknown }).webkitdirectory;
  webkitdirectory = undefined;
});
/** Safari yolu: showDirectoryPicker yok, <input webkitdirectory> var (jsdom'da ikisi de yok; özellik eklenir). */
function webkitdirectoryVar() {
  webkitdirectory = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'webkitdirectory');
  Object.defineProperty(HTMLInputElement.prototype, 'webkitdirectory', {
    configurable: true,
    get() { return (this as HTMLInputElement).hasAttribute('webkitdirectory'); },
    set(value: boolean) { if (value) (this as HTMLInputElement).setAttribute('webkitdirectory', ''); else (this as HTMLInputElement).removeAttribute('webkitdirectory'); },
  });
}

// --- Başlık ve özet -----------------------------------------------------------------------------------
describe('VeriPage › başlık', () => {
  it('bölüm, h1, amaç ve tazelik satırı; özet en çok üç ölçü ve sayımlar ayrı', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Veri kalitesi ve içe aktarma' })).toBeInTheDocument();
    expect(screen.getByText('Yapı')).toBeInTheDocument();
    expect(screen.getByText('E-tablodan gelen veriyi içe aktarın, eşleşmeyen satırları ve çakışmaları çözün.')).toBeInTheDocument();

    await waitForFresh();
    const durum = veriDurumu();
    expect(durum).toHaveTextContent(`Nesil ${GENERATION_ID.slice(0, 6)}`);

    const ozet = screen.getByRole('list', { name: 'Özet' });
    const olculer = within(ozet).getAllByRole('listitem');
    expect(olculer).toHaveLength(3);
    expect(olculer[0]).toHaveTextContent('Çözülecek sorun');
    expect(olculer[0]).toHaveTextContent(sayi.format(ISSUE_COUNT));
    expect(olculer[1]).toHaveTextContent('Kaynak');
    expect(olculer[1]).toHaveTextContent(sayi.format(SOURCE_COUNT));
    expect(olculer[1]).toHaveTextContent(`${sayi.format(SHEET_COUNT)} sayfa`);
    expect(olculer[2]).toHaveTextContent('Koleksiyon');
    expect(olculer[2]).toHaveTextContent(sayi.format(Object.keys(MANIFEST.counts).length));
  }, UZUN);

  it('para ya da birleşik plan/gerçek toplamı yoktur; sayımlar koleksiyon başına ayrı yazılır', async () => {
    const view = renderPage();
    await waitForFresh();
    await waitFor(() => expect(section('Nesil')).toHaveTextContent('purchase_needs'), HAZIR);
    expect(view.container.textContent).not.toMatch(/₺/);
    const nesil = section('Nesil');
    expect(within(nesil).getByRole('row', { name: /purchase_needs/ })).toHaveTextContent(sayi.format(MANIFEST.counts.purchase_needs!));
    expect(within(nesil).getByRole('row', { name: /budget_observations/ })).toHaveTextContent(sayi.format(MANIFEST.counts.budget_observations!));
    expect(within(nesil).queryByRole('row', { name: /Toplam/ })).toBeNull();
  }, UZUN);

  it('dışa açık yardımcılar korunur (zamanMetni, sorunTuru, etkiMetni)', () => {
    expect(zamanMetni('2026-10-28T08:00:05Z')).toBe('28.10.2026 11:00');
    expect(zamanMetni('')).toBe('Bilinmiyor');
    expect(sorunTuru('formula_error')).toBe('Formül hatası');
    expect(etkiMetni({ vocabulary: 'category' })).toBe('Sözlük: category');
  });
});

// --- Kararsızlığın kök nedeni: soğuk açılışta manifest iki kez okunuyordu ----------------------------------
describe('VeriPage › açılış', () => {
  it('soğuk açılışta manifest.json bir kez okunur; koleksiyonlar manifest yayınlandıktan sonra istenir', async () => {
    const source = new FlakySource();
    renderPage({ source });
    await waitForSettled();
    expect(source.reads.filter(path => path === 'manifest.json')).toHaveLength(1);
    expect(source.reads[0]).toBe('manifest.json');
  }, UZUN);
});

// --- Sorun kuyruğu -------------------------------------------------------------------------------------
describe('VeriPage › çözülecek sorunlar', () => {
  it('geniş profil: türe göre gruplar; her grup kendi tablosu (Hücre · Kaynak · Etki · Durum)', async () => {
    renderPage();
    await waitFor(() => expect(within(sorunlarBolumu()).queryAllByRole('status').filter(n => n.getAttribute('aria-busy') === 'true')).toHaveLength(0), HAZIR);
    const sorunlar = sorunlarBolumu();
    expect(within(sorunlar).getByRole('heading', { level: 2, name: 'Çözülecek sorunlar' })).toBeInTheDocument();
    expect(within(sorunlar).getByText(`${sayi.format(ISSUE_COUNT)} kayıt`)).toBeInTheDocument();

    // Grup başlığı tür + sayım; kalabalık grup üstte. Kuyruk bir sayfaya sığdığı için bütün gruplar açık.
    const gruplar = within(sorunlar).getAllByRole('button', { expanded: true });
    expect(gruplar.map(button => button.textContent)).toEqual([
      'Formül hatası2 kayıt', 'Bilinmeyen aşama1 kayıt', 'Bilinmeyen terim1 kayıt', 'Çözülmeyen ilişki1 kayıt', 'Çözülmeyen oda1 kayıt',
      'Geçersiz bağlantı1 kayıt', 'Geçersiz tarih1 kayıt', 'Kayıt kimliği eksik1 kayıt', 'Yalnız kaynak sayfa1 kayıt',
    ]);
    const formul = grupBolgesi('Formül hatası');
    expect(within(formul).getByRole('table', { name: 'Formül hatası' })).toBeInTheDocument();
    expect(within(formul).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Hücre', 'Kaynak', 'Etki', 'Durum']);
    expect(bodyRows(formul).map(row => within(row).getAllByRole('cell')[0]!.textContent)).toEqual(['Gerçekleşen · G9', 'Plan · E12']);
    expect(within(formul).getByRole('row', { name: /Gerçekleşen · G9/ })).toHaveTextContent('Tip: #REF!');
    expect(within(grupBolgesi('Bilinmeyen terim')).getByRole('row', { name: /app_kalemler · 9\. satır/ })).toHaveTextContent('Sözlük: category');
    expect(within(sorunlar).getAllByText('Gözden geçirilecek')).toHaveLength(ISSUE_COUNT);
    // Kuyruk tek sayfa: sayfalama yok.
    expect(within(sorunlar).queryByRole('navigation')).toBeNull();
  }, UZUN);

  it('telefon: tablo yok; gruplu liste, kaynak hücre adresi satır başlığıdır', async () => {
    renderPage({ device: 'phone' });
    await waitFor(() => expect(grupBolgesi('Formül hatası')).toHaveTextContent('Gerçekleşen · G9'), HAZIR);
    const sorunlar = sorunlarBolumu();
    expect(within(sorunlar).queryByRole('table')).toBeNull();
    const formul = grupBolgesi('Formül hatası');
    const satirlar = within(formul).getAllByRole('listitem');
    expect(satirlar.map(item => item.textContent)).toEqual([
      expect.stringMatching(/^Gerçekleşen · G9.*budget · İleti: Sentetik formül hatası · Tip: #REF!.*Gözden geçirilecek/),
      expect.stringMatching(/^Plan · E12.*Tip: #DIV\/0!/),
    ]);
    expect(within(grupBolgesi('Geçersiz bağlantı')).getByText('app_kalemler · 11. satır')).toBeInTheDocument();
  }, UZUN);

  it('telefon: her grubun listesi grup adını taşıyan bölgedir; sayfada aynı adlı iki bölge yok (landmark ayırt edici adla)', async () => {
    // Liste bölgesinin adı yalnız sayım olsaydı ("1 kayıt") sekiz grup aynı adlı sekiz bölge üretirdi: ekran okuyucunun
    // landmark listesinde ayırt edilemezler (admin-a11y › yapı sözleşmesi).
    renderPage({ device: 'phone' });
    await waitForSettled();
    await waitFor(() => expect(grupBolgesi('Formül hatası')).toHaveTextContent('Gerçekleşen · G9'), HAZIR);
    expect(within(grupBolgesi('Formül hatası')).getByRole('region', { name: 'Formül hatası · 2 kayıt' })).toBeInTheDocument();
    expect(within(grupBolgesi('Geçersiz bağlantı')).getByRole('region', { name: 'Geçersiz bağlantı · 1 kayıt' })).toBeInTheDocument();
    const adlar = screen.getAllByRole('region').map(bolgeAdi);
    expect(adlar.filter(ad => !ad), 'adsız bölge').toEqual([]);
    expect(adlar.filter((ad, i) => adlar.indexOf(ad) !== i), 'yinelenen bölge adı').toEqual([]);
  }, UZUN);

  it('telefon, sayfalı grup: liste bölgesinin adı grup adı + görünen aralık; sayfa değişince ad da değişir', async () => {
    renderPage({ source: fixtureSource(withFormulaErrors(469)), device: 'phone' });
    await waitFor(() => expect(grupDugmesi('Formül hatası')).toHaveAccessibleName(/^Formül hatası\s*469 kayıt$/), HAZIR);
    const formul = grupBolgesi('Formül hatası');
    expect(within(formul).getByRole('region', { name: 'Formül hatası · 1–20 / 469 kayıt' })).toBeInTheDocument();
    await userEvent.click(within(formul).getByRole('button', { name: 'Sonraki sayfa' }));
    expect(within(formul).getByRole('region', { name: 'Formül hatası · 21–40 / 469 kayıt' })).toBeInTheDocument();
  }, UZUN);

  it(`469 formül hatası: yalnız ilk grup açık, ${20}'lik sayfa; "Sonraki sayfa" dilimi değiştirir ve odağı grup başlığına taşır`, async () => {
    renderPage({ source: fixtureSource(withFormulaErrors(469)), device: 'phone' });
    await waitFor(() => expect(grupDugmesi('Formül hatası')).toHaveAccessibleName(/^Formül hatası\s*469 kayıt$/), HAZIR);
    expect(within(sorunlarBolumu()).getAllByRole('button', { expanded: true })).toEqual([grupDugmesi('Formül hatası')]);
    expect(grupDugmesi('Yalnız kaynak sayfa')).toHaveAttribute('aria-expanded', 'false');

    const formul = grupBolgesi('Formül hatası');
    const sayfalar = within(formul).getByRole('navigation', { name: 'Formül hatası sayfaları' });
    expect(sayfalar).toHaveTextContent('1–20 / 469');
    expect(within(formul).getAllByRole('listitem')).toHaveLength(20);
    expect(within(formul).getAllByRole('listitem')[0]).toHaveTextContent(/^Gerçekleşen · A2/);
    expect(within(sayfalar).getByRole('button', { name: 'Önceki sayfa' })).toBeDisabled();

    await userEvent.click(within(sayfalar).getByRole('button', { name: 'Sonraki sayfa' }));
    expect(sayfalar).toHaveTextContent('21–40 / 469');
    expect(within(formul).getAllByRole('listitem')).toHaveLength(20);
    expect(within(formul).getAllByRole('listitem')[0]).toHaveTextContent(/^Gerçekleşen · E4/);
    // Yeni dilim grubun başından okunur: odak grup başlığında (görünür odak çizgisi taşıyan düğme).
    expect(grupDugmesi('Formül hatası')).toHaveFocus();

    for (let i = 0; i < 22; i++) await userEvent.click(within(sayfalar).getByRole('button', { name: 'Sonraki sayfa' }));
    expect(sayfalar).toHaveTextContent('461–469 / 469');
    expect(within(formul).getAllByRole('listitem')).toHaveLength(9);
    expect(within(sayfalar).getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled();
  }, UZUN);

  it('issues koleksiyonu nesilde yoksa dürüstçe "Kaynakta sorun kaydı yok" der', async () => {
    renderPage({ source: fixtureSource(withoutIssues()) });
    await waitForFresh();
    await waitFor(() => expect(sorunlarBolumu()).toHaveTextContent('Kaynakta sorun kaydı yok'), HAZIR);
    expect(within(sorunlarBolumu()).queryByRole('table')).toBeNull();
    const olculer = within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem');
    expect(olculer[0]).toHaveTextContent('Henüz yok');
  }, UZUN);
});

// --- Kaynaklar, sayfalar ve nesil -----------------------------------------------------------------------
describe('VeriPage › kaynaklar ve nesil', () => {
  it('kaynak tablosu yakalama zamanı, kapsam ve sayfa sayısı; sayfa tablosu dolu satır/hücre sayıları', async () => {
    renderPage();
    await waitFor(() => expect(section('Kaynaklar')).not.toHaveTextContent('Yükleniyor'), HAZIR);
    const kaynaklar = section('Kaynaklar');
    expect(within(kaynaklar).getByRole('table', { name: 'Kaynaklar' })).toBeInTheDocument();
    expect(bodyRows(kaynaklar)).toHaveLength(SOURCE_COUNT);
    const household = within(kaynaklar).getByRole('row', { name: /household/ });
    expect(household).toHaveTextContent('28.10.2026 11:00');
    expect(household).toHaveTextContent('synthetic');
    expect(household).toHaveTextContent('İşlem değil');

    await waitFor(() => expect(section('Sayfalar')).not.toHaveTextContent('Yükleniyor'), HAZIR);
    const sayfalar = section('Sayfalar');
    expect(within(sayfalar).getByRole('table', { name: 'Sayfalar' })).toBeInTheDocument();
    expect(bodyRows(sayfalar)).toHaveLength(SHEET_COUNT);
    const kalemler = within(sayfalar).getByRole('row', { name: /app_kalemler/ });
    expect(within(kalemler).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['app_kalemler', 'household', '0', '0']);
  }, UZUN);

  it('nesil bilgisi: kimlik, tutarlılık, kaynak türü ve koleksiyon sayıları', async () => {
    renderPage();
    await waitForFresh();
    const nesil = section('Nesil');
    expect(within(nesil).getByText(GENERATION_ID)).toBeInTheDocument();
    expect(nesil).toHaveTextContent('Anlık görüntü; işlem değil');
    expect(nesil).toHaveTextContent('Fixture · sentetik');
    expect(within(nesil).getByRole('table', { name: 'Koleksiyon sayıları' })).toBeInTheDocument();
    expect(nesil).toHaveTextContent('Bekleyen yerel değişiklik');
    expect(nesil).toHaveTextContent('Kapalı');
  }, UZUN);
});

// --- Veri durumları -------------------------------------------------------------------------------------
describe('VeriPage › veri durumları', () => {
  it('okunurken "Nesil okunuyor" iskeleti; nesil hazır olunca içerik', async () => {
    renderPage();
    expect(yukleniyor().length).toBeGreaterThan(0);
    expect(yukleniyor()[0]).toHaveTextContent('Nesil okunuyor');
    expect(veriDurumu()).toHaveAttribute('data-state', 'checking');
    await waitForSettled();
  }, UZUN);

  it('manifest okunamazsa ErrorState "Hata: …" ve "Yeniden dene"; eski tutar/kayıt gösterilmez', async () => {
    const files = { ...FILES };
    delete files['manifest.json'];
    const source = fixtureSource(files);
    const spy = vi.spyOn(source, 'readText');
    renderPage({ source });
    await waitFor(() => expect(veriDurumu()).toHaveAttribute('data-state', 'error'), HAZIR);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent(/^Hata: /);
    expect(alert).toHaveTextContent('manifest.json');
    expect(screen.queryByRole('table')).toBeNull();
    const before = spy.mock.calls.length;
    await userEvent.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before), HAZIR);
  }, UZUN);

  it('yenileme başarısızsa eski veri kalır, tazelik satırı "yenilenemedi" der', async () => {
    const source = new FlakySource();
    renderPage({ source });
    await waitForSettled();
    source.failing = true;
    await userEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    await waitFor(() => expect(veriDurumu()).toHaveAttribute('data-state', 'stale'), HAZIR);
    expect(veriDurumu()).toHaveTextContent('yenilenemedi');
    expect(within(grupBolgesi('Formül hatası')).getByRole('table', { name: 'Formül hatası' })).toBeInTheDocument();
  }, UZUN);

  it('dataStatusFor her nesil durumunu DataStatus durumuna çevirir', () => {
    const base: GenerationHandle = {
      state: 'ready', manifest: null, generationId: GENERATION_ID, lastReadAt: '2026-10-28T11:32:00Z', lastGoodAt: '2026-10-28T11:32:00Z',
      message: null, refresh: async () => undefined, pickDirectory: async () => false, canPickDirectory: false,
      source: { kind: 'fixture', label: 'sentetik' }, sourceMessage: null,
    };
    expect(dataStatusFor({ ...base, state: 'idle' }).state).toBe('checking');
    expect(dataStatusFor({ ...base, state: 'checking' }).state).toBe('checking');
    expect(dataStatusFor(base)).toMatchObject({ state: 'fresh', generationId: GENERATION_ID, lastReadAt: base.lastReadAt });
    expect(dataStatusFor({ ...base, state: 'stale', message: 'Hata: ağ yok' })).toMatchObject({ state: 'stale', lastGoodAt: base.lastGoodAt, message: 'Hata: ağ yok' });
    expect(dataStatusFor({ ...base, state: 'error', message: 'Hata: manifest yok' })).toMatchObject({ state: 'error', message: 'Hata: manifest yok' });
  });
});

// --- Eylemler ---------------------------------------------------------------------------------------------
describe('VeriPage › eylemler', () => {
  it('"Yenile" manifesti yeniden okur', async () => {
    const source = new FlakySource();
    renderPage({ source });
    await waitForSettled();
    const before = source.reads.filter(path => path === 'manifest.json').length;
    await userEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    await waitFor(() => expect(source.reads.filter(path => path === 'manifest.json').length).toBe(before + 1), HAZIR);
  }, UZUN);

  it('ne seçici ne webkitdirectory varsa "Klasörden içe aktar" devre dışıdır ve nedeni yanında yazar', async () => {
    renderPage();
    await waitForFresh();
    const ice = screen.getByRole('button', { name: 'Klasörden içe aktar' });
    expect(ice).toBeDisabled();
    expect(ice).toHaveAccessibleDescription('Bu tarayıcı klasör içe aktarmayı desteklemiyor; nesil geliştirme sunucusundan okunur.');
  }, UZUN);

  it('klasör seçimi iptal edilirse "Hata: Klasör seçimi iptal edildi" yazar; kaynak değişmez', async () => {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn(async () => {
      throw new DOMException('iptal', 'AbortError');
    });
    renderPage();
    await waitForFresh();
    const ice = screen.getByRole('button', { name: 'Klasörden içe aktar' });
    expect(ice).toBeEnabled();
    await userEvent.click(ice);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Hata: Klasör seçimi iptal edildi'), HAZIR);
    expect(section('Nesil')).toHaveTextContent('Fixture · sentetik');
  }, UZUN);

  it('kökü nesil olan klasör seçilirse doğrudan içe aktarılır; nesil oradan okunur', async () => {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn(async () => klasorTutamagi('nesil-klasoru', FILES));
    renderPage();
    await waitForFresh();
    await userEvent.click(screen.getByRole('button', { name: 'Klasörden içe aktar' }));
    await waitFor(() => expect(section('Nesil')).toHaveTextContent('Klasör · nesil-klasoru'), HAZIR);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitForFresh();
    // Seçici yalnız içe aktarma süresince değiştirildi; tarayıcının kendi seçicisi yerinde.
    expect(typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker).toBe('function');
  }, UZUN);

  it('seçicide iki nesilli klasör: "Nesil seçin" en yeniyi üstte gösterir; seçilen eski nesil okunur', async () => {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn(async () => klasorTutamagi('nesil-klasoru', ikiNesil()));
    renderPage({ device: 'phone' });
    await waitForFresh();
    await userEvent.click(screen.getByRole('button', { name: 'Klasörden içe aktar' }));
    const secim = await screen.findByRole('dialog', { name: 'Nesil seçin' }, HAZIR);
    const secenekler = within(secim).getAllByRole('button', { name: /^Nesil [0-9a-f]{6}/ });
    expect(secenekler).toHaveLength(2);
    expect(secenekler[0]).toHaveAccessibleName(expect.stringMatching(new RegExp(`^Nesil ${GENERATION_ID.slice(0, 6)} · En yeni`)));
    expect(secenekler[0]).toHaveAccessibleName(expect.stringContaining('nesil-klasoru/yeni · Yakalama 28.10.2026 11:00 · 24 koleksiyon'));
    expect(secenekler[1]).toHaveAccessibleName(expect.stringContaining(`Nesil ${ESKI_ID.slice(0, 6)}`));
    expect(secenekler[1]).toHaveAccessibleName(expect.stringContaining('Yakalama 20.10.2026 09:30'));
    await userEvent.click(secenekler[1]!);
    await waitFor(() => expect(section('Nesil')).toHaveTextContent('Klasör · nesil-klasoru/eski'), HAZIR);
    await waitFor(() => expect(veriDurumu()).toHaveTextContent(`Nesil ${ESKI_ID.slice(0, 6)}`), HAZIR);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nesil seçin' })).toBeNull(), HAZIR);
  }, UZUN);

  // Telefonda (alt sayfa): jsdom antd Modal'ın kapanış hareketini bitirmez (animationend yok); masaüstü kapanışı e2e'de.
  it('"Vazgeç" seçimi kapatır; kaynak değişmez', async () => {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn(async () => klasorTutamagi('nesil-klasoru', ikiNesil()));
    renderPage({ device: 'phone' });
    await waitForFresh();
    await userEvent.click(screen.getByRole('button', { name: 'Klasörden içe aktar' }));
    const secim = await screen.findByRole('dialog', { name: 'Nesil seçin' }, HAZIR);
    await userEvent.click(within(secim).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nesil seçin' })).toBeNull(), HAZIR);
    expect(section('Nesil')).toHaveTextContent('Fixture · sentetik');
  }, UZUN);

  describe('Safari yolu: <input type="file" webkitdirectory>', () => {
    beforeEach(() => webkitdirectoryVar());

    it('özellik algılama girdiyi seçer: düğme etkin, gizli girdi webkitdirectory taşır ve tıklanır', async () => {
      renderPage({ device: 'phone' });
      await waitForFresh();
      const ice = screen.getByRole('button', { name: 'Klasörden içe aktar' });
      expect(ice).toBeEnabled();
      expect(ice).not.toHaveAccessibleDescription(/desteklemiyor/);
      const girdi = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      expect(girdi).toHaveAttribute('webkitdirectory');
      const click = vi.spyOn(girdi, 'click').mockImplementation(() => undefined);
      await userEvent.click(ice);
      expect(click).toHaveBeenCalledTimes(1);
    }, UZUN);

    it('seçilen dosyalarda iki nesil: seçim, sonra seçilen nesil okunur', async () => {
      renderPage({ device: 'phone' });
      await waitForFresh();
      const girdi = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      fireEvent.change(girdi, { target: { files: dosyaListesi('nesil-klasoru', ikiNesil()) } });
      const secim = await screen.findByRole('dialog', { name: 'Nesil seçin' }, HAZIR);
      await userEvent.click(within(secim).getAllByRole('button', { name: /^Nesil [0-9a-f]{6}/ })[1]!);
      await waitFor(() => expect(section('Nesil')).toHaveTextContent('Klasör · nesil-klasoru/eski'), HAZIR);
      await waitFor(() => expect(grupBolgesi('Formül hatası')).toHaveTextContent('Gerçekleşen · G9'), HAZIR);
    }, UZUN);

    it('klasörde nesil yoksa "Hata: Seçilen klasörde nesil yok" ve çözüm; kaynak değişmez', async () => {
      renderPage();
      await waitForFresh();
      const girdi = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      fireEvent.change(girdi, { target: { files: dosyaListesi('belgeler', { 'notlar/oku.json': '{}' }) } });
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^Hata: Seçilen klasörde nesil yok.*manifest\.json/), HAZIR);
      expect(section('Nesil')).toHaveTextContent('Fixture · sentetik');
    }, UZUN);
  });

  it('başlıkta tek birincil eylem; "Yenile" yalnız tazelik satırındadır (çift düğme yok)', async () => {
    renderPage({ device: 'phone' });
    await waitForFresh();
    expect(screen.getByRole('button', { name: 'Klasörden içe aktar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Diğer' })).toBeNull();
    const yenile = screen.getAllByRole('button', { name: 'Yenile' });
    expect(yenile).toHaveLength(1);
    expect(veriDurumu()).toContainElement(yenile[0]!);
  }, UZUN);
});

// --- Telefon teslimi: sayfa kodu antd/echarts/geniş modülü statik çekmez -----------------------------------
describe('VeriPage › teslim kuralı', () => {
  it('VeriPage.tsx ve pages/veri/** ham antd, @ant-design, echarts, ui/antd, antd teması ya da *.wide modülünü statik içe aktarmaz', () => {
    const files = [join(here, 'VeriPage.tsx'), ...readdirSync(join(here, 'veri')).filter(name => /\.tsx?$/.test(name) && !/\.test\./.test(name)).map(name => join(here, 'veri', name))];
    expect(files.length).toBeGreaterThan(2);
    const yasak = /^(antd|@ant-design|echarts|zrender)(\/|$)|(^|\/)ui\/antd(\.ts)?$|(^|\/)theme\/antdTheme(\.ts)?$|\.wide(\.tsx?)?$/;
    const ihlaller = files.flatMap(file =>
      importsOf(readFileSync(file, 'utf8'))
        .filter(ref => ref.kind === 'static' && !ref.typeOnly && yasak.test(ref.specifier))
        .map(ref => `${relative(here, file)}: ${ref.specifier}`),
    );
    expect(ihlaller).toEqual([]);
  });
});
