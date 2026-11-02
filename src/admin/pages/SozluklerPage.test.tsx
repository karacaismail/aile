import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ChangeSet, FixtureGenerationSource, GenerationProvider, createMemoryStorage, type GenerationSource } from '../data';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import type { Term, Vocabulary, WorkflowDefinition } from '../data/types';
import { ConfigProvider } from '../ui/antd';
import { SozluklerPage, countTermUsage, vocabularyLabel } from './SozluklerPage';

// Tasarım: README.md "Sayfa iskeleti", bundle.js window.Aile.Pages.Sozlukler. Veri gerçek sentetik nesilden (fixtures/
// generation-synthetic) FixtureGenerationSource ile okunur. Telefon (temel sunum): "Sözlük" seçimi ui Select'tir (alt
// sayfa, role=dialog); terim ağacı iç içe açılır liste (APG disclosure; ilk kök açık; oklar başlıklar arasında gezer);
// geçişler ve görünümler liste/akordeon. Geniş (tablet/masaüstü): sekmeler + lazyWide ile gelen ağaç tablosu.
// CRUD iskeleti yalnız yerel değişiklik kümesine "öneri" (note op) yazar; Sheets karşılığı yoktur.
// Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok.

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '../../../fixtures/generation-synthetic');
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find((name) => statSync(join(FIXTURE_ROOT, name)).isDirectory())!;
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
    .map((full) => relative(GENERATION_DIR, full))
    .filter((rel) => rel === 'manifest.json' || rel.startsWith('data/'))
    .map((rel) => [rel, readFileSync(join(GENERATION_DIR, rel), 'utf8')]),
);

const tr = (a: string, b: string) => a.localeCompare(b, 'tr-TR');
const VOCABS = (JSON.parse(FILES['data/vocabularies/global/00000.json']!) as { records: Vocabulary[] }).records;
const TERMS = (JSON.parse(FILES['data/terms/global/00000.json']!) as { records: Term[] }).records;
const WORKFLOWS = (JSON.parse(FILES['data/workflows/global/00000.json']!) as { records: WorkflowDefinition[] }).records;
const CATEGORY = VOCABS.find((v) => v.key === 'category')!;
const CATEGORY_TERMS = TERMS.filter((t) => t.vocabulary_id === CATEGORY.id);
const childrenOf = (id: string | null) => CATEGORY_TERMS.filter((t) => t.parent_id === id).sort((a, b) => tr(a.label, b.label));
const CATEGORY_ROOTS = childrenOf(null);
const KIND_FILES = Object.keys(FILES).filter((rel) => /^data\/(purchase_needs|lighting_specs|work_orders|layout_items|inspections|automation_scenes|milestones)\//.test(rel));
const ALL_KIND_RECORDS = KIND_FILES.flatMap((rel) => (JSON.parse(FILES[rel]!) as { records: never[] }).records);
const USAGE = countTermUsage(ALL_KIND_RECORDS);
/** Alt dallar dahil kullanım (üst kategori alt dallarını kapsar; tasarım: Mobilya 14 = 5 + 6 + 3). */
const subtreeUsage = (id: string): number => (USAGE.get(id) ?? 0) + childrenOf(id).reduce((sum, child) => sum + subtreeUsage(child.id), 0);
const isLeaf = (t: Term) => childrenOf(t.id).length === 0;
const USED_CATEGORY = CATEGORY_TERMS.find((t) => isLeaf(t) && (USAGE.get(t.id) ?? 0) > 0)!;
const UNUSED_CATEGORY = CATEGORY_TERMS.find((t) => isLeaf(t) && !USAGE.has(t.id))!;
/** İki düzey alt dalı olan ilk (alfabetik) kök: kök › alt › torun. */
const GRAND = CATEGORY_TERMS.filter((t) => {
  const parent = CATEGORY_TERMS.find((p) => p.id === t.parent_id);
  return parent?.parent_id != null;
}).sort((a, b) => tr(a.label, b.label))[0]!;
const MID = CATEGORY_TERMS.find((t) => t.id === GRAND.parent_id)!;
const TOP = CATEGORY_TERMS.find((t) => t.id === MID.parent_id)!;

interface ManifestFileEntry { path: string; sha256: string; bytes: number; count?: number; collection?: string }
interface ManifestShape { files: ManifestFileEntry[]; counts: Record<string, number> }

/** Tek koleksiyonu boşaltır; depo hash doğruladığı için manifestteki sha256/bytes/count ve counts da güncellenir. */
function emptied(collection: string): Record<string, string> {
  const path = Object.keys(FILES).find((rel) => rel.startsWith(`data/${collection}/`))!;
  const envelope = JSON.parse(FILES[path]!) as { records: unknown[] };
  const text = JSON.stringify({ ...envelope, records: [] });
  const manifest = JSON.parse(FILES['manifest.json']!) as ManifestShape;
  manifest.files = manifest.files.map((file) =>
    file.path === path ? { ...file, sha256: createHash('sha256').update(text, 'utf8').digest('hex'), bytes: Buffer.byteLength(text, 'utf8'), count: 0 } : file,
  );
  manifest.counts = { ...manifest.counts, [collection]: 0 };
  return { [path]: text, 'manifest.json': JSON.stringify(manifest) };
}

/** Bölümü bozar (manifest hash'i tutmaz): depo IntegrityError verir, yalnız o koleksiyon hatalı kalır. */
function corrupted(collection: string): Record<string, string> {
  const path = Object.keys(FILES).find((rel) => rel.startsWith(`data/${collection}/`))!;
  return { [path]: `${FILES[path]!} ` };
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const named = (label: string) => new RegExp(`^${escapeRe(label)}(\\s|$)`);
/** İlk hücrenin görünür adı (aria-hidden "└" süsü hariç). */
function firstCellLabel(row: HTMLTableRowElement): string {
  const cell = row.cells[0]?.cloneNode(true) as HTMLElement | undefined;
  if (!cell) return '';
  cell.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
}
/**
 * Gövde satırı: ilk hücresi (Ad) bu terimle başlayan satır. getByRole('row', { name }) 36 satırlık antd tablosunda
 * jsdom'da satır başına ~80 ms ad hesaplar; aynı sözleşmeyi (satır adı terimle başlar) ilk hücreden doğrudan okuruz.
 */
function rowNamed(scope: HTMLElement, label: string): HTMLTableRowElement {
  const matches = Array.from(scope.querySelectorAll<HTMLTableRowElement>('tbody tr')).filter((row) => named(label).test(firstCellLabel(row)));
  expect(matches, `"${label}" satırı`).toHaveLength(1);
  return matches[0]!;
}
/** Ağaç düğüm başlığı (açılır düğme); ad ile başlar, ardından kullanım ve alt sayısı. */
const nodeButton = (scope: HTMLElement, label: string) => within(scope).getByRole('button', { name: named(label) });
const panelOf = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-controls')!)!;
/** Görünür (kapalı panel içinde olmayan) düğüm başlıkları, belge sırasıyla. */
const visibleHeads = (scope: HTMLElement) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>('button[aria-expanded][aria-controls]')).filter((el) => !el.closest('[hidden]'));

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

/** İlk okuma başarılı, sonra her okuma başarısız: refresh → stale (son iyi nesil korunur). */
class FlakySource implements GenerationSource {
  readonly kind = 'fixture' as const;
  readonly label = 'kesintili';
  failing = false;
  private readonly inner = fixtureSource();
  async readText(path: string): Promise<string> {
    if (this.failing) throw new Error('bağlantı kesildi');
    return this.inner.readText(path);
  }
}

interface SetupOptions { device?: Device; overrides?: Record<string, string | null>; source?: GenerationSource }

function setup({ device = 'desktop', overrides, source }: SetupOptions = {}) {
  const changeSet = () => ChangeSet.load({ storage: createMemoryStorage(), now: () => '2026-10-28T11:05:00.000Z' });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ConfigProvider>
        <DeviceContext.Provider value={device}>
          <GenerationProvider source={source ?? fixtureSource(overrides)} cache={null} changeSet={changeSet}>
            {children}
          </GenerationProvider>
        </DeviceContext.Provider>
      </ConfigProvider>
    );
  }
  return render(<SozluklerPage location="/sozlukler" />, { wrapper: Wrapper });
}

/** Masaüstü ağaç tablosu lazyWide ile gelir; önce bölge, sonra tablo beklenir. */
async function categoryTable() {
  const bolge = await screen.findByRole('region', { name: 'Kategoriler' });
  const table = await within(bolge).findByRole('table', { name: 'Kategoriler' });
  return { bolge, table };
}

describe('SozluklerPage › başlık ve özet', () => {
  it('bölüm, h1, amaç, tek birincil eylem ve ≤3 özet (sözlük / terim / iş akışı ayrı) gelir', async () => {
    setup();
    expect(screen.getByText('Yapı')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Sözlükler ve iş akışları' })).toBeInTheDocument();
    expect(screen.getByText('Kategorileri, odaları, durumları ve durumların hangi sırayla değişeceğini tanımlayın.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terim ekle' })).toBeInTheDocument();

    const ozet = await screen.findByRole('list', { name: 'Özet' });
    const olculer = within(ozet).getAllByRole('listitem');
    expect(olculer).toHaveLength(3);
    expect(within(olculer[0]!).getByText('Sözlük')).toBeInTheDocument();
    expect(within(olculer[0]!).getByText(String(VOCABS.length))).toBeInTheDocument();
    expect(within(olculer[1]!).getByText('Terim')).toBeInTheDocument();
    expect(within(olculer[1]!).getByText(String(TERMS.length))).toBeInTheDocument();
    expect(within(olculer[2]!).getByText('İş akışı')).toBeInTheDocument();
    expect(within(olculer[2]!).getByText(String(WORKFLOWS.length))).toBeInTheDocument();
  });

  it('yüklenirken iskelet, veri gelince tazelik satırında nesil kimliği görünür', async () => {
    setup();
    // Tazelik satırı da role=status taşır; iskelet etiketiyle bulunur.
    const yukleniyor = screen.getByText('Yükleniyor');
    expect(yukleniyor.closest('[role="status"]')).toHaveAttribute('aria-busy', 'true');
    await screen.findByRole('list', { name: 'Özet' });
    expect(screen.queryByText('Yükleniyor')).not.toBeInTheDocument();
    expect(document.querySelector(`[data-generation-id="${GENERATION_ID}"]`)).not.toBeNull();
  });
});

describe('SozluklerPage › sözlük ağacı (masaüstü, lazyWide tablo)', () => {
  it('Kategoriler sekmesi açılır; her düzeydeki terim (torun dahil), üst terimi ve kullanan kayıt sayısı tabloda', async () => {
    setup();
    const { bolge, table } = await categoryTable();
    expect(within(bolge).getByText(`${CATEGORY_TERMS.length} değer · ağaç`)).toBeInTheDocument();
    expect(within(bolge).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Ad', 'E-tablo kodu', 'Üst kategori', 'Kullanan kayıt', 'Eylem']);
    // Gövde satırı başına bir terim: 36 terimin hepsi (üç düzey).
    expect(within(table).getAllByRole('row').filter((row) => row.querySelector('td'))).toHaveLength(CATEGORY_TERMS.length);

    expect(within(rowNamed(table, GRAND.label)).getByText(MID.label)).toBeInTheDocument();
    expect(within(rowNamed(table, MID.label)).getByText(TOP.label)).toBeInTheDocument();
    expect(within(rowNamed(table, CATEGORY_ROOTS[0]!.label)).getByText('—')).toBeInTheDocument();
    expect(within(rowNamed(table, GRAND.label)).getByText(GRAND.code)).toBeInTheDocument();

    const used = USAGE.get(USED_CATEGORY.id)!;
    expect(within(rowNamed(table, USED_CATEGORY.label)).getByText(String(used))).toBeInTheDocument();
    // Üst terimin sayımı alt dallarını kapsar.
    expect(subtreeUsage(TOP.id)).toBeGreaterThan(USAGE.get(TOP.id) ?? 0);
    expect(within(rowNamed(table, TOP.label)).getByText(String(subtreeUsage(TOP.id)))).toBeInTheDocument();
  });

  it('kullanımdaki terimin Pasifleştir düğmesi devre dışıdır ve nedeni yakınında yazılıdır', async () => {
    setup();
    const { bolge, table } = await categoryTable();
    const pasif = within(rowNamed(table, USED_CATEGORY.label)).getByRole('button', { name: 'Pasifleştir' });
    expect(pasif).toBeDisabled();
    expect(pasif).toHaveAccessibleDescription('Kullanılan bir değer pasifleştirilemez; önce kayıtlar başka bir değere taşınır.');
    expect(within(bolge).getByText('Kullanılan bir değer pasifleştirilemez; önce kayıtlar başka bir değere taşınır.')).toBeInTheDocument();
    expect(within(bolge).getByText('Değişiklikler öneri olarak kaydedilir; e-tabloda karşılığı yok.')).toBeInTheDocument();
  });

  it('sözlük adları Türkçe etiketlenir; bilinmeyen anahtar olduğu gibi kalır', () => {
    expect(vocabularyLabel('category')).toBe('Kategoriler');
    expect(vocabularyLabel('funding_type')).toBe('Finansman türleri');
    expect(vocabularyLabel('fulfillment_state')).toBe('Tedarik durumu');
    expect(vocabularyLabel('bilinmeyen_anahtar')).toBe('bilinmeyen_anahtar');
  });

  it('masaüstünde seçim sekme şerididir; Durumlar sekmesinde her durum sözlüğü ayrı bölgedir', async () => {
    setup();
    await categoryTable();
    expect(screen.queryByRole('combobox', { name: 'Sözlük' })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Durumlar' }));
    expect(await screen.findByRole('region', { name: 'Tedarik durumu' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Ödeme durumu' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Kategoriler' })).not.toBeInTheDocument();
  });
});

describe('SozluklerPage › kullanım bilinmiyorsa', () => {
  it('bir tür koleksiyonu okunamazsa sayım "Bilinmiyor" olur ve hiçbir terim pasifleştirilemez (0 sayılmaz)', async () => {
    setup({ overrides: corrupted('work_orders') });
    const { bolge, table } = await categoryTable();
    const row = rowNamed(table, UNUSED_CATEGORY.label);
    expect(within(row).getByText('Bilinmiyor')).toBeInTheDocument();
    const pasif = within(row).getByRole('button', { name: 'Pasifleştir' });
    expect(pasif).toBeDisabled();
    expect(pasif).toHaveAccessibleDescription(/Kullanan kayıtlar sayılamadı/);
    expect(within(bolge).getByText(/Kullanan kayıtlar sayılamadı/)).toBeInTheDocument();
  });
});

describe('SozluklerPage › CRUD iskeleti (değişiklik kümesi, öneri)', () => {
  it('kullanılmayan terim pasifleştirilir: öneri listede "Bekleyen öneriler" altında görünür ve geri alınır', async () => {
    setup();
    const { table } = await categoryTable();
    const pasif = within(rowNamed(table, UNUSED_CATEGORY.label)).getByRole('button', { name: 'Pasifleştir' });
    await waitFor(() => expect(pasif).toBeEnabled());
    await userEvent.click(pasif);

    const oneriler = await screen.findByRole('region', { name: 'Bekleyen öneriler' });
    expect(within(oneriler).getByText(`Pasifleştir: ${UNUSED_CATEGORY.label}`)).toBeInTheDocument();
    expect(within(oneriler).getByText('Öneri olarak kaydedildi')).toBeInTheDocument();
    expect(within(rowNamed(table, UNUSED_CATEGORY.label)).getByText('Pasifleştirme önerildi')).toBeInTheDocument();
    await userEvent.click(within(oneriler).getByRole('button', { name: `Geri al: Pasifleştir: ${UNUSED_CATEGORY.label}` }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bekleyen öneriler' })).not.toBeInTheDocument());
  });

  it('Terim ekle diyaloğu: boş ad hata verir, dolu ad öneri olarak kaydedilir', async () => {
    setup();
    await categoryTable();
    await userEvent.click(screen.getByRole('button', { name: 'Terim ekle' }));
    const dialog = await screen.findByRole('dialog', { name: 'Terim ekle' });
    expect(within(dialog).getByText('Öneri olarak kaydedilir; e-tabloya yazılmaz.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Öneri olarak kaydet' }));
    expect(within(dialog).getByText('Hata: Terim adı boş olamaz')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole('textbox', { name: /Terim adı/ }), 'Bahçe mobilyası');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Öneri olarak kaydet' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Terim ekle' })).not.toBeInTheDocument());
    const oneriler = await screen.findByRole('region', { name: 'Bekleyen öneriler' });
    expect(within(oneriler).getByText('Terim ekle: Bahçe mobilyası (Kategoriler)')).toBeInTheDocument();
  });
});

describe('SozluklerPage › iş akışları ve görünümler', () => {
  it('İş akışları: durum sırası başlangıçtan, başlangıç ve son durumlar sözcükle; geçişler tabloda', async () => {
    setup();
    await categoryTable();
    await userEvent.click(screen.getByRole('tab', { name: 'İş akışları' }));
    const bolge = await screen.findByRole('region', { name: 'İş akışı · Tedarik durumu' });
    // Akışlar sözlüklerinin Türkçe adına göre sıralı (veri sırası değil).
    const akislar = screen.getAllByRole('heading', { level: 2, name: /^İş akışı · / }).map((h) => h.textContent!.replace('İş akışı · ', ''));
    expect(akislar).toEqual([...akislar].sort(tr));
    expect(akislar).toHaveLength(WORKFLOWS.length);
    const sira = within(bolge).getByRole('list', { name: 'Durum sırası' });
    const durumlar = within(sira).getAllByRole('listitem');
    expect(durumlar.map((li) => li.textContent)).toEqual(['Alınacak başlangıç', 'Sipariş edildi', 'Teslim edildi', 'Kuruldu son durum', 'İptal son durum']);

    const kontrol = screen.getByRole('region', { name: 'İş akışı · Kontrol durumu' });
    const table = await within(kontrol).findByRole('table', { name: 'Geçişler · Kontrol durumu' });
    for (const ad of ['Durumdan', 'Duruma', 'Kanıt gerekir']) expect(within(kontrol).getByRole('columnheader', { name: ad })).toBeInTheDocument();
    expect(within(table).getAllByText('Evet').length).toBe(2);
    expect(within(kontrol).getByText(/^2 geçiş · Önerilen şablon · sürüm 1$/)).toBeInTheDocument();
  });

  it('Görünümler: tanımlar tabloda; durum, tür ve alanlar Türkçe (makine anahtarı yok)', async () => {
    setup();
    await categoryTable();
    await userEvent.click(screen.getByRole('tab', { name: 'Görünümler' }));
    const bolge = await screen.findByRole('region', { name: 'Görünüm tanımları' });
    const table = await within(bolge).findByRole('table', { name: 'Görünüm tanımları' });
    const gantt = within(table).getByRole('row', { name: /^Gantt/ });
    expect(within(gantt).getByText('Kimlik, Ad, Planlanan tarih, Bitiş tarihi')).toBeInTheDocument();
    expect(within(gantt).getByText('İş, Kilometre taşı')).toBeInTheDocument();
    expect(within(table).queryByText('gantt_chart')).toBeNull();
    expect(within(table).getAllByText('Önerilen şablon').length).toBe(6);
  });
});

describe('SozluklerPage › boş, hata ve eski veri durumları', () => {
  it('terimler koleksiyonu boşsa dürüst metin: "Kaynakta terim kaydı yok"', async () => {
    setup({ overrides: emptied('terms') });
    expect(await screen.findByText('Kaynakta terim kaydı yok')).toBeInTheDocument();
  });

  it('sözlükler koleksiyonu boşsa boş durum: "Kaynakta sözlük kaydı yok"', async () => {
    setup({ overrides: emptied('vocabularies') });
    expect(await screen.findByRole('heading', { name: 'Kaynakta sözlük kaydı yok' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terim ekle' })).toBeDisabled();
  });

  it('iş akışları boşsa sekmede "Kaynakta iş akışı kaydı yok"', async () => {
    setup({ overrides: emptied('workflows') });
    await categoryTable();
    await userEvent.click(screen.getByRole('tab', { name: 'İş akışları' }));
    expect(await screen.findByText('Kaynakta iş akışı kaydı yok')).toBeInTheDocument();
  });

  it('manifest okunamazsa ErrorState "Hata: …" ve Yeniden dene gelir; eski sayı gösterilmez', async () => {
    setup({ overrides: { 'manifest.json': null } });
    const hata = await screen.findByRole('heading', { level: 2, name: /^Hata: / });
    expect(hata).toBeInTheDocument();
    // Tazelik satırı (DataStatus) da "Yeniden dene" sunar; ErrorState'inki alert bölgesinde.
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Özet' })).not.toBeInTheDocument();
  });

  it('yenileme başarısızsa eski veri: tazelik satırı "yenilenemedi" der, son iyi nesil gösterilmeye devam eder', async () => {
    const source = new FlakySource();
    setup({ source, device: 'phone' });
    await screen.findByRole('region', { name: 'Kategoriler' });
    source.failing = true;
    await userEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    const durum = () => screen.getAllByRole('status').find((node) => node.hasAttribute('data-state'))!;
    await waitFor(() => expect(durum()).toHaveAttribute('data-state', 'stale'));
    expect(durum()).toHaveTextContent('yenilenemedi');
    const bolge = screen.getByRole('region', { name: 'Kategoriler' });
    expect(nodeButton(bolge, CATEGORY_ROOTS[0]!.label)).toBeInTheDocument();
  });
});

describe('SozluklerPage › telefon', () => {
  it('"Sözlük" seçimi alt sayfadır (dialog); İş akışları seçilince akışlar gelir', async () => {
    setup({ device: 'phone' });
    await screen.findByRole('region', { name: 'Kategoriler' });
    expect(screen.queryByRole('tablist')).toBeNull();
    await userEvent.click(screen.getByRole('combobox', { name: 'Sözlük' }));
    const sheet = await screen.findByRole('dialog', { name: 'Sözlük' });
    expect(within(sheet).getAllByRole('option').map((o) => o.textContent)).toEqual(['Kategoriler', 'Durumlar', 'Finansman', 'Diğer sözlükler', 'İş akışları', 'Görünümler']);
    expect(within(sheet).getByRole('option', { name: 'Kategoriler' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(within(sheet).getByRole('option', { name: 'İş akışları' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sözlük' })).toBeNull());
    const akis = await screen.findByRole('region', { name: 'İş akışı · Kontrol durumu' });
    // Telefonda geçiş satırı "A → B", anlamı sözcükle: "Kanıt gerekir" (yalnız "Evet" değil).
    expect(within(akis).getAllByText('Kontrol bekliyor → Kontrol tamamlandı').length).toBe(1);
    expect(within(akis).getAllByText('Kanıt gerekir').length).toBeGreaterThan(0);
    expect(within(akis).queryByRole('table')).toBeNull();
  });

  it('ağaç iç içe açılır listedir: ilk kök açık, kök › alt › torun açılır; tablo yok', async () => {
    setup({ device: 'phone' });
    const bolge = await screen.findByRole('region', { name: 'Kategoriler' });
    expect(within(bolge).queryByRole('table')).toBeNull();
    expect(nodeButton(bolge, CATEGORY_ROOTS[0]!.label)).toHaveAttribute('aria-expanded', 'true');
    const others = CATEGORY_ROOTS.slice(1).map((root) => nodeButton(bolge, root.label));
    for (const button of others) expect(button).toHaveAttribute('aria-expanded', 'false');

    const top = nodeButton(bolge, TOP.label);
    if (top.getAttribute('aria-expanded') === 'true') await userEvent.click(top);
    expect(within(panelOf(top)).queryByRole('button', { name: named(MID.label) })).toBeNull();
    await userEvent.click(top);
    expect(top).toHaveAttribute('aria-expanded', 'true');
    const mid = within(panelOf(top)).getByRole('button', { name: named(MID.label) });
    expect(mid).toBeVisible();
    await userEvent.click(mid);
    const grand = within(panelOf(mid)).getByRole('button', { name: named(GRAND.label) });
    expect(grand).toBeVisible();
    await userEvent.click(grand);
    // Torun ayrıntısı: üst terim, e-tablo kodu (alias) ve alt yoksa "Yok".
    const detay = panelOf(grand);
    expect(within(detay).getByText('Üst kategori').nextElementSibling).toHaveTextContent(MID.label);
    expect(within(detay).getByText('E-tablo kodu').nextElementSibling).toHaveTextContent(GRAND.code);
    expect(within(detay).getByText('Alt kategori').nextElementSibling).toHaveTextContent('Yok');
  });

  it('düğüm başlığı Türkçe adı ve kullanım/alt sayısını taşır; makine kodu başlıkta yok', async () => {
    setup({ device: 'phone' });
    const bolge = await screen.findByRole('region', { name: 'Kategoriler' });
    const top = nodeButton(bolge, TOP.label);
    expect(top).toHaveAccessibleName(`${TOP.label} ${subtreeUsage(TOP.id)} kayıt kullanıyor · ${childrenOf(TOP.id).length} alt kategori`);
    for (const head of within(bolge).getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded'))) {
      expect(head.textContent).not.toMatch(/[a-z]+[_:][a-z]/);
    }
  });

  it('ağaç klavyeyle gezilir: Aşağı/Yukarı görünür başlıklar, Sağ açar ya da alta iner, Sol kapatır ya da üste çıkar, Home/End', async () => {
    const user = userEvent.setup();
    setup({ device: 'phone' });
    const bolge = await screen.findByRole('region', { name: 'Kategoriler' });
    const first = nodeButton(bolge, CATEGORY_ROOTS[0]!.label);
    const firstChildren = childrenOf(CATEGORY_ROOTS[0]!.id);
    expect(firstChildren.length).toBeGreaterThan(0);
    first.focus();

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName(named(firstChildren[0]!.label));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(first);
    await user.keyboard('{ArrowLeft}');
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(first);

    await user.keyboard('{ArrowDown}');
    const second = nodeButton(bolge, CATEGORY_ROOTS[1]!.label);
    expect(document.activeElement).toBe(second);
    await user.keyboard('{ArrowRight}');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(second);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(first);

    await user.keyboard('{End}');
    const heads = visibleHeads(bolge);
    expect(document.activeElement).toBe(heads[heads.length - 1]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(first);
    await user.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-expanded', 'true');
  });

  it('telefonda alt dalı kullanılan üst terim de pasifleştirilemez; nedeni düğmeye bağlı', async () => {
    setup({ device: 'phone' });
    const bolge = await screen.findByRole('region', { name: 'Kategoriler' });
    const usedRoot = CATEGORY_ROOTS.find((root) => subtreeUsage(root.id) > 0 && (USAGE.get(root.id) ?? 0) === 0)!;
    const head = nodeButton(bolge, usedRoot.label);
    if (head.getAttribute('aria-expanded') === 'false') await userEvent.click(head);
    const pasif = within(panelOf(head)).getAllByRole('button', { name: 'Pasifleştir' })[0]!;
    expect(pasif).toBeDisabled();
    expect(pasif).toHaveAccessibleDescription('Kullanılan bir değer pasifleştirilemez; önce kayıtlar başka bir değere taşınır.');
  });
});
