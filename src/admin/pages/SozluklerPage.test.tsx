import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ChangeSet, FixtureGenerationSource, GenerationProvider, createMemoryStorage } from '../data';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import type { Term, Vocabulary, WorkflowDefinition } from '../data/types';
import { ConfigProvider } from '../ui/antd';
import { SozluklerPage, vocabularyLabel } from './SozluklerPage';

// Tasarım: README.md "Sayfa iskeleti", bundle.js window.Aile.Pages.Sozlukler (masaüstü: Tabs + kategori ağacı tablosu
// + iş akışı durum sırası + geçiş tablosu; dar: AccordionList + liste). Veri gerçek sentetik nesilden (fixtures/
// generation-synthetic) FixtureGenerationSource ile okunur: vocabularies/terms ağaç, workflows (durumlar + geçişler),
// view_definitions. CRUD iskeleti yalnız yerel değişiklik kümesine "öneri" (note op) yazar; Sheets karşılığı yoktur.
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

const VOCABS = (JSON.parse(FILES['data/vocabularies/global/00000.json']!) as { records: Vocabulary[] }).records;
const TERMS = (JSON.parse(FILES['data/terms/global/00000.json']!) as { records: Term[] }).records;
const WORKFLOWS = (JSON.parse(FILES['data/workflows/global/00000.json']!) as { records: WorkflowDefinition[] }).records;
const CATEGORY = VOCABS.find((v) => v.key === 'category')!;
const CATEGORY_TERMS = TERMS.filter((t) => t.vocabulary_id === CATEGORY.id);
const CATEGORY_ROOTS = CATEGORY_TERMS.filter((t) => t.parent_id === null);
const PURCHASES = (JSON.parse(FILES['data/purchase_needs/household/00000.json']!) as { records: { category_term_id: string | null }[] }).records;
const USED_CATEGORY = CATEGORY_TERMS.find((t) => PURCHASES.some((p) => p.category_term_id === t.id))!;

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

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Tablo satırı adı "Ad kod üst sayı Eylem" biçiminde başlar; yalnız adla başlayan satır. */
const rowNamed = (scope: HTMLElement, label: string) => within(scope).getByRole('row', { name: new RegExp(`^${escapeRe(label)} `) });

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

interface SetupOptions { device?: Device; overrides?: Record<string, string | null>; source?: FixtureGenerationSource }

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

describe('SozluklerPage › sözlük ağacı (masaüstü)', () => {
  it('Kategoriler sekmesi açılır; kök terimler, alt terimlerin üst kategorisi ve kullanan kayıt sayısı tabloda', async () => {
    setup();
    const bolge = await screen.findByRole('region', { name: 'Kategoriler' });
    expect(within(bolge).getByText(`${CATEGORY_TERMS.length} değer · ağaç`)).toBeInTheDocument();
    // Yapışkan başlık ayrı tabloda çizilir; başlıklar bölge içinde aranır, gövde satırları adlandırılmış tabloda.
    expect(within(bolge).getByRole('table', { name: 'Kategoriler' })).toBeInTheDocument();
    for (const ad of ['Ad', 'Kod', 'Üst kategori', 'Kullanan kayıt', 'Eylem']) expect(within(bolge).getByRole('columnheader', { name: ad })).toBeInTheDocument();

    const child = CATEGORY_TERMS.find((t) => t.parent_id !== null)!;
    const parent = CATEGORY_TERMS.find((t) => t.id === child.parent_id)!;
    const childRow = rowNamed(bolge, child.label);
    expect(within(childRow).getByText(parent.label)).toBeInTheDocument();
    const rootRow = rowNamed(bolge, CATEGORY_ROOTS[0]!.label);
    expect(within(rootRow).getByText('—')).toBeInTheDocument();

    const used = PURCHASES.filter((p) => p.category_term_id === USED_CATEGORY.id).length;
    expect(used).toBeGreaterThan(0);
    const usedRow = rowNamed(bolge, USED_CATEGORY.label);
    expect(within(usedRow).getByText(String(used))).toBeInTheDocument();
  });

  it('kullanımdaki terimin Pasifleştir düğmesi devre dışıdır ve nedeni yakınında yazılıdır', async () => {
    setup();
    const bolge = await screen.findByRole('region', { name: 'Kategoriler' });
    const usedRow = rowNamed(bolge, USED_CATEGORY.label);
    const pasif = within(usedRow).getByRole('button', { name: 'Pasifleştir' });
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

  it('Durumlar sekmesinde her durum sözlüğü ayrı bölgedir', async () => {
    setup();
    await screen.findByRole('region', { name: 'Kategoriler' });
    await userEvent.click(screen.getByRole('tab', { name: 'Durumlar' }));
    expect(await screen.findByRole('region', { name: 'Tedarik durumu' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Ödeme durumu' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Kategoriler' })).not.toBeInTheDocument();
  });
});

describe('SozluklerPage › CRUD iskeleti (değişiklik kümesi, öneri)', () => {
  it('kullanılmayan terim pasifleştirilir: öneri listede "Bekleyen öneriler" altında görünür ve geri alınır', async () => {
    setup();
    const bolge = await screen.findByRole('region', { name: 'Kategoriler' });
    const unused = CATEGORY_TERMS.find((t) => !PURCHASES.some((p) => p.category_term_id === t.id))!;
    const row = rowNamed(bolge, unused.label);
    const pasif = within(row).getByRole('button', { name: 'Pasifleştir' });
    await waitFor(() => expect(pasif).toBeEnabled());
    await userEvent.click(pasif);

    const oneriler = await screen.findByRole('region', { name: 'Bekleyen öneriler' });
    expect(within(oneriler).getByText(`Pasifleştir: ${unused.label}`)).toBeInTheDocument();
    expect(within(oneriler).getByText('Öneri olarak kaydedildi')).toBeInTheDocument();
    await userEvent.click(within(oneriler).getByRole('button', { name: `Geri al: Pasifleştir: ${unused.label}` }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bekleyen öneriler' })).not.toBeInTheDocument());
  });

  it('Terim ekle diyaloğu: boş ad hata verir, dolu ad öneri olarak kaydedilir', async () => {
    setup();
    await screen.findByRole('region', { name: 'Kategoriler' });
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
  it('İş akışları: durum sırası etiketlerle ve geçişler tabloda; Kanıt gerekir sözcükle yazılır', async () => {
    setup();
    await screen.findByRole('region', { name: 'Kategoriler' });
    await userEvent.click(screen.getByRole('tab', { name: 'İş akışları' }));
    const bolge = await screen.findByRole('region', { name: 'İş akışı · Kontrol durumu' });
    const sira = within(bolge).getByRole('list', { name: 'Durum sırası' });
    expect(within(sira).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
    const table = within(bolge).getByRole('table', { name: 'Geçişler · Kontrol durumu' });
    for (const ad of ['Durumdan', 'Duruma', 'Kanıt gerekir']) expect(within(bolge).getByRole('columnheader', { name: ad })).toBeInTheDocument();
    expect(within(table).getAllByText('Evet').length).toBe(2);
    expect(within(bolge).getByText(/^2 geçiş · Önerilen şablon · sürüm 1$/)).toBeInTheDocument();
  });

  it('Görünümler: tanımlar tabloda, durum "Önerilen şablon" sözcüğüyle', async () => {
    setup();
    await screen.findByRole('region', { name: 'Kategoriler' });
    await userEvent.click(screen.getByRole('tab', { name: 'Görünümler' }));
    const bolge = await screen.findByRole('region', { name: 'Görünüm tanımları' });
    const table = within(bolge).getByRole('table', { name: 'Görünüm tanımları' });
    expect(within(table).getByRole('row', { name: /Gantt/ })).toBeInTheDocument();
    expect(within(table).getAllByText('Önerilen şablon').length).toBe(6);
  });
});

describe('SozluklerPage › boş ve hata durumları', () => {
  it('terimler koleksiyonu boşsa dürüst metin: "Kaynakta terim kaydı yok"', async () => {
    setup({ overrides: emptied('terms') });
    expect(await screen.findByText('Kaynakta terim kaydı yok')).toBeInTheDocument();
  });

  it('iş akışları boşsa sekmede "Kaynakta iş akışı kaydı yok"', async () => {
    setup({ overrides: emptied('workflows') });
    await screen.findByRole('region', { name: 'Kategoriler' });
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
});

describe('SozluklerPage › telefon', () => {
  it('ağaç akordeondur (ilk kök açık), kök başlığında kullanan kayıt ve alt kategori sayısı; alt yoksa "Yok"', async () => {
    setup({ device: 'phone' });
    const bolge = await screen.findByRole('region', { name: 'Kategoriler' });
    expect(within(bolge).queryByRole('table')).toBeNull();
    const first = within(bolge).getByRole('button', { name: new RegExp(`^${CATEGORY_ROOTS[0]!.label}`) });
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const leaf = CATEGORY_ROOTS.find((root) => !CATEGORY_TERMS.some((t) => t.parent_id === root.id))!;
    const leafButton = within(bolge).getByRole('button', { name: new RegExp(`^${leaf.label}`) });
    await userEvent.click(leafButton);
    const panel = document.getElementById(leafButton.getAttribute('aria-controls')!)!;
    expect(within(panel).getByText('Yok')).toBeInTheDocument();
  });
});
