import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangeSet, FixtureGenerationSource, GenerationProvider, createMemoryStorage, type PurchaseNeedRecord, type Term, type WorkflowDefinition } from '../data';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { AlimlarPage, buildAlimlarHash, durumGecisi, parseAlimlarHash } from './AlimlarPage';

// Alımlar ve eşyalar (dikey dilim). Tasarım: README › Sayfa iskeleti, ekranlar.md (EkranListe/Tablo/Kanban/Zaman,
// SayfaAlimlarPivot, EkranAyrinti + Dar biçimler), bundle.js Aile.Pages.Alimlar. Veri sentetik nesilden
// (fixtures/generation-synthetic → FixtureGenerationSource + GenerationProvider); seçiciler role/label ile.

// --- Sentetik nesil → bellek ---------------------------------------------------------------------------------
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

const PURCHASES_PATH = 'data/purchase_needs/household/00000.json';
const VIEWS_PATH = 'data/view_definitions/global/00000.json';
const PURCHASES = (JSON.parse(FILES[PURCHASES_PATH]!) as { records: PurchaseNeedRecord[] }).records;
const TERMS = (JSON.parse(FILES['data/terms/global/00000.json']!) as { records: Term[] }).records;
const WORKFLOWS = (JSON.parse(FILES['data/workflows/global/00000.json']!) as { records: WorkflowDefinition[] }).records;
const ROOMS = (JSON.parse(FILES['data/rooms/household/00000.json']!) as { records: { id: string; label: string }[] }).records;
const ALL_LABELS = PURCHASES.map((record) => record.label!);
const byLabel = (label: string) => PURCHASES.find((record) => record.label === label)!;
const roomId = (label: string) => ROOMS.find((room) => room.label === label)!.id;
const termByLabel = (vocabularyCode: string, label: string) => {
  const workflow = WORKFLOWS.find((item) => item.key === vocabularyCode)!;
  return TERMS.find((term) => term.vocabulary_id === workflow.vocabulary_id && term.label === label)!;
};

interface ManifestFileEntry { path: string; sha256: string; bytes: number; count?: number; collection?: string }
interface ManifestShape { files: ManifestFileEntry[]; counts: Record<string, number> }

/** Bölümü yeni kayıtlarla yeniden yazar; depo bütünlüğü doğruladığı için manifestteki sha256/bytes/count da güncellenir. */
function rewritten(path: string, mutate: (records: Record<string, unknown>[]) => Record<string, unknown>[], manifestText = FILES['manifest.json']!): Record<string, string> {
  const envelope = JSON.parse(FILES[path]!) as { collection: string; records: Record<string, unknown>[] };
  const records = mutate(envelope.records);
  const text = JSON.stringify({ ...envelope, records });
  const manifest = JSON.parse(manifestText) as ManifestShape;
  manifest.files = manifest.files.map((file) =>
    file.path === path ? { ...file, sha256: createHash('sha256').update(text, 'utf8').digest('hex'), bytes: Buffer.byteLength(text, 'utf8'), count: records.length } : file,
  );
  manifest.counts = { ...manifest.counts, [envelope.collection]: records.length };
  return { [path]: text, 'manifest.json': JSON.stringify(manifest) };
}

/** view_definitions › pivot tanımına purchase_need eklenir (pivot dalını sınamak için sentetik değişiklik). */
const PIVOT_ACIK = rewritten(VIEWS_PATH, (records) =>
  records.map((record) => (record['key'] === 'pivot' ? { ...record, supported_kinds: [...(record['supported_kinds'] as string[]), 'purchase_need'] } : record)),
);

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

interface SetupOptions { device?: Device; overrides?: Record<string, string | null>; changeSet?: boolean }

function setup({ device = 'desktop', overrides, changeSet = true }: SetupOptions = {}) {
  const source = fixtureSource(overrides);
  const loader = changeSet ? () => ChangeSet.load({ storage: createMemoryStorage(), now: () => '2026-11-02T10:00:00.000Z' }) : null;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DeviceContext.Provider value={device}>
        <GenerationProvider source={source} cache={null} changeSet={loader}>
          {children}
        </GenerationProvider>
      </DeviceContext.Provider>
    );
  }
  return { user: userEvent.setup(), ...render(<AlimlarPage location="/alimlar" />, { wrapper: Wrapper }) };
}

const sonuclar = () => screen.findByRole('region', { name: 'Sonuçlar' });
/** Segment düğmesinin girdisi pointer-events: none; tıklama etiket metnine yapılır (QueryBar.test ile aynı). */
const modSec = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(within(screen.getByRole('radiogroup', { name: 'Görünüm modu' })).getByText(name));
const sonucSayisi = (n: number) => screen.findByText(`${n} sonuç`);

/** Sonuç bölgesinde hangi alım adları görünür (tam metin eşleşmesi). */
function gorunenAdlar(region: HTMLElement): string[] {
  return ALL_LABELS.filter((label) => within(region).queryAllByText(label).length > 0).sort();
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

// --- Saf yardımcılar -------------------------------------------------------------------------------------
describe('AlimlarPage › URL (hash) durumu', () => {
  it('mod, arama, sıra, filtre ve seçili kayıt hash sorgusuna yazılır ve aynen geri okunur', () => {
    const state = {
      id: 'a1b2c3d4-0000-5000-8000-000000000001',
      mode: 'table' as const,
      search: 'lamba, kase',
      sort: 'planned_desc',
      facets: { room: ['r1', 'unknown'], owner: ['Ali, Veli'], date: ['baslangic=01.01.2027'] },
      dateType: 'order_due_on',
      timelineField: 'ordered',
    };
    const hash = buildAlimlarHash(state);
    expect(hash.startsWith('#/alimlar/a1b2c3d4-0000-5000-8000-000000000001?')).toBe(true);
    expect(parseAlimlarHash(hash)).toEqual(state);
  });

  it('seçim yokken yol "/alimlar/?…" biçimindedir (wouter iç içe rota eşleşmesi korunur); boş durumda yalnız "#/alimlar"', () => {
    const empty = { id: null, mode: null, search: '', sort: null, facets: {}, dateType: null, timelineField: null };
    expect(buildAlimlarHash(empty)).toBe('#/alimlar');
    expect(buildAlimlarHash({ ...empty, mode: 'kanban' })).toBe('#/alimlar/?mod=kanban');
    expect(parseAlimlarHash('#/alimlar/?mod=kanban')).toEqual({ ...empty, mode: 'kanban' });
    // Geçersiz mod yok sayılır; başka sayfanın hash'i bu sayfanın durumu değildir.
    expect(parseAlimlarHash('#/alimlar?mod=uydurma')?.mode ?? null).toBeNull();
    expect(parseAlimlarHash('#/projeler/?mod=table')).toBeNull();
  });
});

describe('AlimlarPage › durum geçişi (iş akışı)', () => {
  it('izinli geçiş (Araştırılıyor → Karar bekliyor) karar ekseninde kabul edilir', () => {
    const kase = byLabel('Örnek kase');
    const hedef = termByLabel('decision', 'Karar bekliyor');
    const sonuc = durumGecisi(kase, hedef.id, WORKFLOWS, TERMS);
    expect(sonuc).toEqual({ ok: true, axis: 'decision', from: { code: 'researching', term_id: kase.state_term_ids.decision }, to: { code: hedef.code, term_id: hedef.id } });
  });

  it('iş akışında olmayan geçiş (Araştırılıyor → Fikir) "Hata: …" ile reddedilir', () => {
    const kase = byLabel('Örnek kase');
    const sonuc = durumGecisi(kase, termByLabel('decision', 'Fikir').id, WORKFLOWS, TERMS);
    expect(sonuc.ok).toBe(false);
    expect(!sonuc.ok && sonuc.reason).toMatch(/^Hata: .*Araştırılıyor.*Fikir/);
  });

  it('tedarik ekseni dolu kayıtta geçiş tedarik iş akışından okunur (Alınacak → Sipariş)', () => {
    const yastik = byLabel('Örnek yastık');
    const ordered = TERMS.find((term) => term.id === WORKFLOWS.find((w) => w.key === 'fulfillment')!.transitions[0]!.to_term_id)!;
    const sonuc = durumGecisi(yastik, ordered.id, WORKFLOWS, TERMS);
    expect(sonuc.ok && sonuc.axis).toBe('fulfillment');
  });
});

// --- Sayfa -----------------------------------------------------------------------------------------------
describe('AlimlarPage › başlık, özet ve veri durumları', () => {
  it('bölüm, h1, amaç; yüklenirken iskelet, sonra liste', async () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Alımlar ve eşyalar' })).toBeInTheDocument();
    expect(screen.getByText('Alım ve envanter')).toBeInTheDocument();
    expect(screen.getByText('Ev için alınacak ve alınmış her şeyi plan ve gerçek tutarıyla izleyin.')).toBeInTheDocument();
    expect(screen.getByRole('status', { busy: true })).toBeInTheDocument();
    await sonuclar();
    await waitFor(() => expect(screen.getByText(/Nesil/)).toHaveTextContent(GENERATION_ID.slice(0, 6)));
  });

  it('özet üç ayrı madde: Planlanan ₺565.500,00 · Gerçekleşen ₺36.600,00 · Fiyatı eksik 4 (plan ve gerçek birleşmez)', async () => {
    setup();
    await sonuclar();
    const ozet = screen.getByRole('list', { name: 'Özet' });
    const maddeler = within(ozet).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(maddeler).toHaveLength(3);
    expect(maddeler[0]).toContain('Planlanan');
    expect(maddeler[0]).toContain('₺565.500,00');
    expect(maddeler[0]).toContain('24 kayıt');
    expect(maddeler[1]).toContain('Gerçekleşen');
    expect(maddeler[1]).toContain('₺36.600,00');
    expect(maddeler[1]).toContain('1 kayıt');
    expect(maddeler[2]).toContain('Fiyatı eksik');
    expect(maddeler[2]).toContain('4');
    // Plan + gerçek toplamı (₺602.100,00) hiçbir yerde yazılmaz.
    expect(screen.queryByText(/602\.100/)).toBeNull();
  });

  it('birincil eylem "Alım ekle" işlevsiz çizilmez: devre dışı ve nedeni yazılı', async () => {
    setup();
    await sonuclar();
    const ekle = screen.getByRole('button', { name: 'Alım ekle' });
    expect(ekle).toBeDisabled();
    expect(ekle).toHaveAccessibleDescription(/kaynak e-tabloya/);
  });

  it('nesil okunamazsa "Hata: …" ile ErrorState ve "Yeniden dene"', async () => {
    setup({ overrides: { 'manifest.json': null } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nesil okunamadı');
    expect(alert).toHaveTextContent(/Hata:/);
    expect(within(alert).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
  });

  it('purchase_needs boşsa dürüst metin: "Kaynakta alım kaydı yok"; sorgu çubuğu çizilmez', async () => {
    setup({ overrides: rewritten(PURCHASES_PATH, () => []) });
    expect(await screen.findByText('Kaynakta alım kaydı yok')).toBeInTheDocument();
    expect(screen.queryByRole('search')).toBeNull();
  });
});

describe('AlimlarPage › sorgu çubuğu ve modlar', () => {
  it('altı mod; desteklenmeyenler view_definitions gerekçesiyle devre dışı (Gantt, Pivot)', async () => {
    setup();
    await sonuclar();
    expect(screen.getByRole('radio', { name: 'Liste' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Tablo' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Zaman çizelgesi' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Kanban' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Gantt' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Pivot' })).toBeDisabled();
    const grup = screen.getByRole('radiogroup', { name: 'Görünüm modu' });
    expect(grup).toHaveAccessibleDescription(/Gantt kullanılamaz: alımların başlangıç ve bitiş tarihi yok\./);
    expect(grup).toHaveAccessibleDescription(/Pivot kullanılamaz: /);
  });

  it('mod değişince aynı kayıt kümesi görünür (filtreli: Oda 1 ∪ Oda 2 → 8 kayıt) ve hash mod/filtreyi taşır', async () => {
    const { user } = setup();
    await sonuclar();
    await user.click(screen.getByRole('checkbox', { name: 'Örnek oda 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Örnek oda 2' }));
    await sonucSayisi(8);
    const beklenen = PURCHASES.filter((r) => r.room_id === roomId('Örnek oda 1') || r.room_id === roomId('Örnek oda 2')).map((r) => r.label!).sort();
    expect(beklenen).toHaveLength(8);
    expect(gorunenAdlar(await sonuclar())).toEqual(beklenen);
    expect(window.location.hash).toContain(`room=`);
    expect(window.location.hash).toContain(roomId('Örnek oda 1'));

    for (const mod of ['Tablo', 'Kanban', 'Zaman çizelgesi']) {
      await modSec(user, mod);
      await waitFor(() => expect(screen.getByRole('radio', { name: mod })).toBeChecked());
      expect(gorunenAdlar(await sonuclar())).toEqual(beklenen);
    }
    expect(window.location.hash).toContain('mod=timeline');
    expect(window.location.hash).toContain(roomId('Örnek oda 2'));
  });

  it('filtre: aynı boyutta OR, boyutlar arası AND (Oda 1 ∪ Oda 2) ∩ Ödeme "Planlandı" → 4', async () => {
    const { user } = setup();
    await sonuclar();
    await user.click(screen.getByRole('checkbox', { name: 'Örnek oda 1' }));
    await sonucSayisi(4);
    await user.click(screen.getByRole('checkbox', { name: 'Örnek oda 2' }));
    await sonucSayisi(8);
    await user.click(screen.getByRole('button', { name: /Ödeme durumu/ }));
    await user.click(await screen.findByRole('checkbox', { name: 'Planlandı' }));
    await sonucSayisi(4);
    const beklenen = ['Örnek askı', 'Örnek lambader', 'Örnek masa', 'Örnek sandalye'];
    expect(gorunenAdlar(await sonuclar())).toEqual(beklenen);
    // Etkin filtreler kaldırılabilir etiketlerdir.
    expect(screen.getByText('Ödeme durumu: Planlandı')).toBeInTheDocument();
  });

  it('hash ile açılış: "#/alimlar/?mod=table" tabloyu açar', async () => {
    window.location.hash = '#/alimlar/?mod=table';
    setup();
    const region = await sonuclar();
    expect(screen.getByRole('radio', { name: 'Tablo' })).toBeChecked();
    expect(within(region).getByRole('table', { name: 'Alımlar ve eşyalar' })).toBeInTheDocument();
    expect(within(region).getByRole('columnheader', { name: 'Planlanan' })).toBeInTheDocument();
    expect(within(region).getByRole('columnheader', { name: 'Gerçekleşen' })).toBeInTheDocument();
  });

  it('Zaman çizelgesinde tarih alanı seçilir (native select yok, combobox)', async () => {
    const { user } = setup();
    await sonuclar();
    await modSec(user, 'Zaman çizelgesi');
    const secim = await screen.findByRole('combobox', { name: 'Tarih alanı' });
    expect(document.querySelector('select')).toBeNull();
    await user.click(secim);
    await user.click(await screen.findByRole('option', { name: 'Sipariş' }));
    await waitFor(() => expect(window.location.hash).toContain('zaman=ordered'));
  });

  it('Pivot (tanım izin verince): oda × durum, Plan ve Gerçek ayrı satırda; satır toplamı ölçü başına', async () => {
    const { user } = setup({ overrides: PIVOT_ACIK });
    await sonuclar();
    await modSec(user, 'Pivot');
    const tablo = await screen.findByRole('table', { name: 'Oda ve duruma göre planlanan ve gerçekleşen tutar' });
    const satir = within(tablo).getByRole('row', { name: /^Örnek oda 3 / });
    // Oda 3: battaniye (İptal, plan 1.900), vazo (Araştırılıyor, 25.000), tencere (Kuruldu, plan 38.600 / gerçek 36.600), perde (Karar bekliyor, 35.900)
    expect(satir).toHaveTextContent('Plan ₺101.400,00');
    expect(satir).toHaveTextContent('Gerçek ₺36.600,00');
    expect(satir).not.toHaveTextContent('₺138.000,00');
    expect(within(tablo).getByRole('row', { name: /^Toplam / })).toHaveTextContent('Plan ₺565.500,00');
  });

  it('Pivot telefonda PivotStack olur (mod hash ile gelir; telefonda mod seçimi combobox)', async () => {
    window.location.hash = '#/alimlar/?mod=pivot';
    setup({ device: 'phone', overrides: PIVOT_ACIK });
    const region = await sonuclar();
    expect(await within(region).findByText('Genel toplam')).toBeInTheDocument();
    expect(within(region).queryByRole('table')).toBeNull();
  });

  it('Pivot tanımda yoksa hash ile istenen pivot uydurulmaz; Liste açılır', async () => {
    window.location.hash = '#/alimlar/?mod=pivot';
    setup();
    await sonuclar();
    expect(screen.getByRole('radio', { name: 'Liste' })).toBeChecked();
  });
});

describe('AlimlarPage › ayrıntı, odak ve durum değişikliği', () => {
  it('masaüstü: satır ayrıntıyı sağda açar (hash #/alimlar/<id>), odak içeri girer; "Kapat" odağı satıra döndürür', async () => {
    const { user } = setup();
    const region = await sonuclar();
    const kase = byLabel('Örnek kase');
    const satir = within(region).getByRole('button', { name: /Örnek kase/ });
    await user.click(satir);
    const panel = await screen.findByRole('dialog', { name: 'Örnek kase' });
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    expect(window.location.hash).toContain(`/alimlar/${kase.id}`);
    expect(within(panel).getByRole('region', { name: 'Plan ve gerçek' })).toHaveTextContent('Henüz yok');
    await user.click(within(panel).getByRole('button', { name: 'Kapat' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Örnek kase' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(region).getByRole('button', { name: /Örnek kase/ })));
    expect(window.location.hash).not.toContain(kase.id);
  });

  it('mod değişince seçim ve odak korunur', async () => {
    const { user } = setup();
    const region = await sonuclar();
    await user.click(within(region).getByRole('button', { name: /Örnek kase/ }));
    await screen.findByRole('dialog', { name: 'Örnek kase' });
    const tablo = screen.getByRole('radio', { name: 'Tablo' });
    await modSec(user, 'Tablo');
    await waitFor(() => expect(tablo).toBeChecked());
    expect(screen.getByRole('dialog', { name: 'Örnek kase' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Tablo' }));
    const satir = within(await sonuclar()).getByRole('row', { name: /^Örnek kase / });
    expect(satir).toHaveAttribute('aria-selected', 'true');
  });

  it('"Durumu değiştir" yalnız iş akışı geçişlerini sunar; seçim yerel change set’e yazılır ve "Geri al" geri çevirir', async () => {
    const { user } = setup();
    const region = await sonuclar();
    await user.click(within(region).getByRole('button', { name: /Örnek kase/ }));
    const panel = await screen.findByRole('dialog', { name: 'Örnek kase' });
    await user.click(within(panel).getByRole('combobox', { name: 'Durumu değiştir' }));
    const liste = await screen.findByRole('listbox');
    const secenekler = within(liste).getAllByRole('option').map((o) => o.textContent);
    expect(secenekler).toEqual(['Araştırılıyor', 'Karar bekliyor', 'İptal']);
    expect(within(liste).queryByRole('option', { name: 'Fikir' })).toBeNull();
    await user.click(within(liste).getByRole('option', { name: 'Karar bekliyor' }));

    await waitFor(() => expect(within(region).getByRole('button', { name: /Örnek kase/ })).toHaveTextContent('Karar bekliyor'));
    expect(await screen.findByText(/Araştırılıyor → Karar bekliyor/)).toHaveTextContent(/kaynağa yazılmadı/);
    const geriAl = within(screen.getByRole('dialog', { name: 'Örnek kase' })).getByRole('button', { name: 'Geri al' });
    await user.click(geriAl);
    await waitFor(() => expect(within(region).getByRole('button', { name: /Örnek kase/ })).toHaveTextContent('Araştırılıyor'));
    expect(await screen.findByText('Değişiklik geri alındı.')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Örnek kase' })).queryByRole('button', { name: 'Geri al' })).toBeNull();
  });

  it('telefon: ayrıntı tam sayfa ("Listeye dön"); dönüşte odak açan satıra gelir', async () => {
    const { user } = setup({ device: 'phone' });
    const region = await sonuclar();
    await user.click(within(region).getByRole('button', { name: /Örnek kase/ }));
    const sayfa = await screen.findByRole('dialog', { name: 'Örnek kase' });
    await waitFor(() => expect(document.activeElement).toBe(sayfa));
    expect(screen.queryByRole('search')).toBeNull();
    await user.click(within(sayfa).getByRole('button', { name: 'Listeye dön' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Örnek kase' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(region).getByRole('button', { name: /Örnek kase/ })));
  });

  // WebKit/Safari düğmeye tıklamayı odak taşımadan işler: document.activeElement body ya da odaklanabilir bir ata
  // (main, tabIndex -1) kalır; açan öğe tıklanan satırdan bilinmeli. fireEvent.click odak taşımaz, Safari'yi taklit eder.
  it.each([
    ['phone', 'body'],
    ['desktop', 'body'],
    ['phone', 'başka öğe'],
    ['desktop', 'başka öğe'],
  ] as const)('%s: tıklama odak taşımasa da (Safari, odak %s) kapanınca odak açan satıra döner', async (device, odak) => {
    const { user } = setup({ device });
    const region = await sonuclar();
    const satir = within(region).getByRole('button', { name: /Örnek kase/ });
    if (odak === 'başka öğe') screen.getByRole('searchbox', { name: 'Ara' }).focus();
    else expect(document.activeElement).toBe(document.body);
    fireEvent.click(satir);
    const ayrinti = await screen.findByRole('dialog', { name: 'Örnek kase' });
    await user.click(within(ayrinti).getByRole('button', { name: device === 'phone' ? 'Listeye dön' : 'Kapat' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Örnek kase' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(region).getByRole('button', { name: /Örnek kase/ })));
  });

  it('telefon: filtreler tam ekran çekmecede; hash’teki seçim ayrıntıyı doğrudan açar', async () => {
    const kase = byLabel('Örnek kase');
    window.location.hash = `#/alimlar/${kase.id}`;
    const { user } = setup({ device: 'phone' });
    const sayfa = await screen.findByRole('dialog', { name: 'Örnek kase' });
    await user.click(within(sayfa).getByRole('button', { name: 'Listeye dön' }));
    await act(async () => {});
    await user.click(await screen.findByRole('button', { name: 'Filtreler (0)' }));
    // antd test ortamında başlık kimliği sabit ("test-id") olduğundan diyalog adı yerine h2 başlığından bulunur.
    const cekmece = (await screen.findByRole('heading', { level: 2, name: 'Filtreler' })).closest('[role="dialog"]') as HTMLElement;
    expect(within(cekmece).getByRole('button', { name: '28 sonucu göster' })).toBeInTheDocument();
  });
});
