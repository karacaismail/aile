// Bütçe ve nakit sayfası: sentetik nesil (fixtures/generation-synthetic) GenerationProvider + FixtureGenerationSource ile
// belleğe okunur; budget_observations plan (basis planned) ve gerçek (recorded_aggregate) AYRI sütunlardır, hiçbir yerde
// tek sayıda birleşmez. Gerçekleşen anlamı yalnız data/actuals.ts'ten: içinde bulunulan aydan (Europe/Istanbul) sonraki
// dönem "Henüz yok"; ödeme kanıtı olmayan yazılı değer "Kaynakta yazılı" (durum da bu, oran yok); "Tamamlandı" /
// "Aşıldı" / "Sınıra yakın" yalnız kanıtlı gerçekleşende; Gerçekleşen planın aynasıysa MIRRORS_PLAN_NOTE. Fark yalnız iki
// taraf da bilinen ve aynı para biriminde iken. Dönem seçici Select (telefonda alt sayfa); tablo ResponsiveTable
// (telefonda kalem kalem akordeon, ilk satır açık). Aylık eğilim (Chart) geniş-özeldir: butce/ButceTrend.wide.tsx,
// lazyWide ile yalnız tablet/masaüstünde yüklenir; telefonda çizilmez ve indirilmez. Canlı GViz (live.liveBudget) ikinci
// DataStatus satırıdır. Seçiciler role/label ile; antd iç sınıfı yok. Ağ yok: canlı okuma liveBudgetImpl ile enjekte.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { importsOf } from '../adaptive/sourceRules';
import {
  FixtureGenerationSource, GenerationProvider, MIRRORS_PLAN_NOTE, lastReadAtOf, liveBudget,
  type BudgetObservation, type BudgetViewModel, type GenerationSource, type LiveBudgetOptions, type LiveBudgetResult,
} from '../data';
import { ButcePage, budgetRowsFor, compareWithLive, defaultPeriod, periodLabel, type ButcePageProps } from './ButcePage';
import { trendPoints } from './butce/model';

const mocks = vi.hoisted(() => {
  const setOption = vi.fn();
  const init = vi.fn(() => ({ setOption, resize: vi.fn(), dispose: vi.fn() }));
  return { setOption, init };
});
vi.mock('echarts/core', () => ({ init: mocks.init, use: vi.fn(), registerTheme: vi.fn() }));
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {} }));
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

beforeEach(() => {
  mocks.init.mockClear();
  mocks.setOption.mockClear();
});

// --- Sentetik nesil → bellek ------------------------------------------------------------------------------
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
const PLAN_PATH = 'data/budget_observations/budget/201/00000.json';
const ACTUAL_PATH = 'data/budget_observations/budget/202/00000.json';
const parseRecords = (path: string) => (JSON.parse(FILES[path]!) as { records: BudgetObservation[] }).records;
const PLAN = parseRecords(PLAN_PATH);
const ACTUAL = parseRecords(ACTUAL_PATH);
const ALL = [...PLAN, ...ACTUAL];

const NOW = () => new Date('2026-11-02T09:00:00.000Z');
const TODAY = NOW();
const PERIOD = '2026-11';
const FUTURE = '2026-12';
const LABEL_1 = 'Örnek gider satırı 1';
const LABEL_2 = 'Örnek gider satırı 2';
const LABEL_3 = 'Örnek gider satırı 3';
const LABEL_4 = 'Örnek gider satırı 4';
const plannedOf = (label: string, period = PERIOD) => PLAN.find(r => r.label === label && r.period === period)!;
const actualOf = (label: string, period = PERIOD) => ACTUAL.find(r => r.label === label && r.period === period)!;
const tl = (decimal: string) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 }).format(decimal as `${number}`);

interface ManifestFile { path: string; sha256: string; bytes: number; count?: number; collection?: string }
interface ManifestShape { files: ManifestFile[]; counts: Record<string, number> }

/**
 * Partition dosyalarını yeni kayıt listeleriyle yazar ve manifesti tutarlı tutar (sha256, bayt, kayıt sayısı ve
 * budget_observations toplam sayımı): depo bütünlük denetimi gerçek kalır, kapatılmaz.
 */
async function withPartitions(changes: Record<string, BudgetObservation[]>): Promise<Record<string, string>> {
  const files = { ...FILES };
  const manifest = JSON.parse(files['manifest.json']!) as ManifestShape;
  for (const [path, records] of Object.entries(changes)) {
    const text = JSON.stringify({ schemaVersion: 1, collection: 'budget_observations', records });
    files[path] = text;
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const entry = manifest.files.find(file => file.path === path)!;
    entry.sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    entry.bytes = bytes.byteLength;
    if (entry.count !== undefined) entry.count = records.length;
  }
  manifest.counts.budget_observations = manifest.files
    .filter(file => file.path.startsWith('data/budget_observations/'))
    .reduce((total, file) => total + (file.count ?? 0), 0);
  files['manifest.json'] = JSON.stringify(manifest);
  return files;
}

/** Bir dönemin Gerçekleşen kayıtlarını dönüştürür; diğer kayıtlar olduğu gibi kalır. */
const mapActual = (period: string, change: (record: BudgetObservation) => BudgetObservation) =>
  ACTUAL.map(record => (record.period === period ? change(record) : record));
const withValue = (record: BudgetObservation, decimal: string | null, evidence = record.payment_evidence): BudgetObservation =>
  ({ ...record, payment_evidence: evidence, value: { ...record.value, decimal } });

const onDevice = (device: Device) => ({ children }: { children: ReactNode }) =>
  <DeviceContext.Provider value={device}>{children}</DeviceContext.Provider>;

function liveOk(budget: Partial<BudgetViewModel> = {}): LiveBudgetResult {
  return {
    ok: true,
    budget: {
      periods: [PERIOD],
      months: [],
      categories: [],
      groups: [],
      irregular: [],
      readAt: '2026-11-02T09:05:00.000Z',
      ...budget,
    },
  };
}
const liveFail: LiveBudgetResult = { ok: false, kind: 'integrity', message: 'Hata: Google Sheets yanıtı okunamadı. Paylaşım erişimini kontrol edin.' };

/** Saklı son iyi canlı okuma yok (IndexedDB'ye dokunulmaz); ilgili testler kendi lastGoodImpl'ini verir. */
const noLastGood = async () => null;

interface RenderOptions { device?: Device; files?: Record<string, string>; source?: GenerationSource }
function renderPage(props: Partial<ButcePageProps> = {}, { device = 'desktop', files = FILES, source }: RenderOptions = {}) {
  const liveBudgetImpl = props.liveBudgetImpl ?? vi.fn(async () => liveOk());
  const Wrapper = onDevice(device);
  const utils = render(
    <Wrapper>
      <GenerationProvider source={source ?? new FixtureGenerationSource(files, 'sentetik')} cache={null} changeSet={null}>
        <ButcePage now={NOW} liveBudgetImpl={liveBudgetImpl} lastGoodImpl={noLastGood} {...props} />
      </GenerationProvider>
    </Wrapper>,
  );
  return { ...utils, liveBudgetImpl };
}

const rowOf = (name: string) => screen.getAllByRole('row').find(row => within(row).queryByText(name))!;
const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell').map(cell => cell.textContent);
/** Masaüstü tablosunda bir satırın sütun başlığına göre hücresi (başlıklar sayfa düzeyinde: antd başlığı ayrı tabloda olabilir). */
function cellAt(name: string, column: string): HTMLElement {
  const headers = screen.getAllByRole('columnheader').map(th => th.textContent);
  const index = headers.indexOf(column);
  return within(rowOf(name)).getAllByRole('cell')[index]!;
}
/** "8 kalem · Kasım 2026" sayımı: strong + span olarak çizilir; paragrafın tam metniyle eşleşir. */
const countText = (text: string) => screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === text);
/** Akordeon satırının açık gövdesi (aria-controls). */
const panelOf = (head: HTMLElement) => document.getElementById(head.getAttribute('aria-controls')!)!;
const headOf = async (label: string) => (await screen.findAllByRole('button', { expanded: true })).find(h => h.textContent?.includes(label))!;

async function choosePeriod(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: 'Dönem' }));
  await user.click(await screen.findByRole('option', { name: label }));
}

// --- Saf yardımcılar ----------------------------------------------------------------------------------------
describe('ButcePage › saf yardımcılar', () => {
  it('periodLabel: YYYY-MM → "Kasım 2026" (tr-TR)', () => {
    expect(periodLabel('2026-11')).toBe('Kasım 2026');
    expect(periodLabel('2027-01')).toBe('Ocak 2027');
  });

  it('defaultPeriod: içinde bulunulan ay varsa o; yoksa bugünden önceki son dönem; hiçbiri yoksa ilk dönem', () => {
    const periods = ['2026-09', '2026-10', '2026-11', '2026-12'];
    expect(defaultPeriod(periods, new Date('2026-11-02'))).toBe('2026-11');
    expect(defaultPeriod(['2026-09', '2026-10', '2027-01'], new Date('2026-11-02'))).toBe('2026-10');
    expect(defaultPeriod(['2027-01', '2027-02'], new Date('2026-11-02'))).toBe('2027-01');
    expect(defaultPeriod([], new Date('2026-11-02'))).toBeNull();
  });

  it('defaultPeriod: içinde bulunulan ay Europe/Istanbul takvimidir (31 Ekim 21:30 UTC = 1 Kasım 00:30 İstanbul)', () => {
    const periods = ['2026-09', '2026-10', '2026-11', '2026-12'];
    expect(defaultPeriod(periods, new Date('2026-10-31T21:30:00.000Z'))).toBe('2026-11');
    expect(defaultPeriod(periods, new Date('2026-10-31T20:59:00.000Z'))).toBe('2026-10');
  });

  it('budgetRowsFor: plan ve gerçek ayrı alanlar; fark planlanan − gerçekleşen; yinelenen gözlem toplanmaz, "Bilinmiyor"', () => {
    const rows = budgetRowsFor(ALL, PERIOD, null, TODAY);
    expect(rows).toHaveLength(8);
    const row = rows.find(r => r.label === LABEL_1)!;
    expect(row.planned).toEqual({ amount: plannedOf(LABEL_1).value.decimal, currency: 'TRY' });
    expect(row.actual).toEqual({ amount: actualOf(LABEL_1).value.decimal, currency: 'TRY' });
    expect(row.planned).not.toEqual(row.actual);
    const diff = (Number(row.planned!.amount) * 100 - Number(row.actual!.amount) * 100) / 100;
    expect(row.difference).toEqual({ amount: diff.toFixed(2), currency: 'TRY' });
    expect(row.ownership).toBe('unknown');
    // Yinelenen plan gözlemi (aynı etiket, dönem, basis): toplanmaz; değer bilinmiyor olur.
    const dup = { ...plannedOf(LABEL_1), id: 'dup-1', value: { decimal: '1.00', currency: 'TRY' } };
    const dupRow = budgetRowsFor([...ALL, dup], PERIOD, null, TODAY).find(r => r.label === LABEL_1)!;
    expect(dupRow.planned).toBeNull();
    expect(dupRow.plannedAmbiguous).toBe(true);
    expect(dupRow.difference).toBeNull();
    expect(dupRow.status.label).toBe('Bilinmiyor');
  });

  it('budgetRowsFor: içinde bulunulan aydan sonraki dönemde Gerçekleşen "Henüz yok" (kaynakta değer olsa bile); fark yok', () => {
    const row = budgetRowsFor(ALL, FUTURE, null, TODAY).find(r => r.label === LABEL_1)!;
    expect(actualOf(LABEL_1, FUTURE).value.decimal).not.toBeNull();
    expect(row.recorded).toEqual({ kind: 'not_yet' });
    expect(row.actual).toBeNull();
    expect(row.difference).toBeNull();
    expect(row.status).toEqual({ label: 'Henüz yok', tone: 'notr' });
    expect(row.spend.text).toBe('Henüz yok');
    // Plan gelecekte de bilinir.
    expect(row.planned).toEqual({ amount: plannedOf(LABEL_1, FUTURE).value.decimal, currency: 'TRY' });
  });

  it('budgetRowsFor: ödeme kanıtı olmayan Gerçekleşen "Kaynakta yazılı"; durum oran üretmez, fark iki bilinen değerden', () => {
    const row = budgetRowsFor(ALL, PERIOD, null, TODAY).find(r => r.label === LABEL_1)!;
    expect(row.recorded).toEqual({ kind: 'recorded', money: { amount: actualOf(LABEL_1).value.decimal, currency: 'TRY' }, evidence: false });
    expect(row.status).toEqual({ label: 'Kaynakta yazılı', tone: 'bilgi' });
    expect(row.spend).toEqual({ kind: 'in_source', percent: null, text: 'Kaynakta yazılı' });
    expect(row.difference).not.toBeNull();
    for (const other of budgetRowsFor(ALL, PERIOD, null, TODAY)) expect(['Tamamlandı', 'Aşıldı', 'Sınıra yakın', 'Planda']).not.toContain(other.status.label);
  });

  it('budgetRowsFor: kanıtlı Gerçekleşen → Aşıldı / Tamamlandı / Sınıra yakın / Planda ve "%N harcandı" (spendLabel)', () => {
    const plan = (label: string, decimal: string) => ({ ...plannedOf(label), value: { decimal, currency: 'TRY' } });
    const real = (label: string, decimal: string) => ({ ...actualOf(label), payment_evidence: true, value: { decimal, currency: 'TRY' } });
    const observations = [
      plan(LABEL_1, '1000.00'), real(LABEL_1, '1000.01'),
      plan(LABEL_2, '1000.00'), real(LABEL_2, '1000'),
      plan(LABEL_3, '1000.00'), real(LABEL_3, '950.00'),
      plan(LABEL_4, '1000.00'), real(LABEL_4, '500.00'),
    ];
    const rows = budgetRowsFor(observations, PERIOD, null, TODAY);
    const of = (label: string) => rows.find(r => r.label === label)!;
    expect(of(LABEL_1).status).toEqual({ label: 'Aşıldı', tone: 'hata' });
    expect(of(LABEL_1).difference).toEqual({ amount: '-0.01', currency: 'TRY' });
    expect(of(LABEL_2).status).toEqual({ label: 'Tamamlandı', tone: 'olumlu' });
    expect(of(LABEL_2).difference).toEqual({ amount: '0.00', currency: 'TRY' });
    expect(of(LABEL_3).status).toEqual({ label: 'Sınıra yakın', tone: 'uyari' });
    expect(of(LABEL_3).spend.text).toBe('%95 harcandı');
    expect(of(LABEL_4).status).toEqual({ label: 'Planda', tone: 'notr' });
    expect(of(LABEL_4).spend.text).toBe('%50 harcandı');
  });

  it('budgetRowsFor: fark yalnız iki taraf bilinen ve aynı para biriminde iken; okunamayan Gerçekleşen "Bilinmiyor"', () => {
    const usd = { ...actualOf(LABEL_1), value: { decimal: '10.00', currency: 'USD' } };
    const broken = { ...actualOf(LABEL_2), value: { decimal: 'on bin', currency: 'TRY' } };
    const rest = ALL.filter(r => !(r.basis === 'recorded_aggregate' && r.period === PERIOD && (r.label === LABEL_1 || r.label === LABEL_2)));
    const rows = budgetRowsFor([...rest, usd, broken], PERIOD, null, TODAY);
    const one = rows.find(r => r.label === LABEL_1)!;
    expect(one.actual).toEqual({ amount: '10.00', currency: 'USD' });
    expect(one.difference).toBeNull();
    const two = rows.find(r => r.label === LABEL_2)!;
    expect(two.recorded).toEqual({ kind: 'recorded', money: null, evidence: false });
    expect(two.actual).toBeNull();
    expect(two.difference).toBeNull();
    expect(two.status).toEqual({ label: 'Bilinmiyor', tone: 'uyari' });
  });

  it('budgetRowsFor: canlı sahiplik eşlemesiyle ara toplam / kalem işaretlenir ve ağaç sırası kurulur', () => {
    const live = liveOk({
      groups: [{ id: 'g1', label: LABEL_1, group: '', kind: 'expense', planned: {}, actual: {} }],
      categories: [{ id: 'c2', label: LABEL_2, group: LABEL_1, kind: 'expense', planned: {}, actual: {} }],
    });
    const rows = budgetRowsFor(ALL, PERIOD, live.ok ? live.budget : null, TODAY);
    const g = rows.find(r => r.label === LABEL_1)!;
    const c = rows.find(r => r.label === LABEL_2)!;
    expect(g.ownership).toBe('subtotal');
    expect(c.ownership).toBe('leaf');
    expect(c.parent).toBe(LABEL_1);
    expect(rows.indexOf(c)).toBe(rows.indexOf(g) + 1);
  });

  it('compareWithLive: aynı dönemde tutarı farklı ya da tek tarafta olan etiketleri sayar; kaynak değerleri karşılaştırılır', () => {
    const rows = budgetRowsFor(ALL, PERIOD, null, TODAY);
    const same = liveOk({
      categories: rows.map(r => ({ id: r.label, label: r.label, group: '', kind: 'expense' as const, planned: { [PERIOD]: r.planned }, actual: { [PERIOD]: r.actual } })),
    });
    expect(compareWithLive(rows, same.ok ? same.budget : null, PERIOD)).toBe(0);
    const changed = liveOk({
      categories: [
        { id: 'x', label: LABEL_1, group: '', kind: 'expense', planned: { [PERIOD]: { amount: '1.00', currency: 'TRY' } }, actual: { [PERIOD]: rows[0].actual } },
        { id: 'y', label: 'Yalnız canlıda', group: '', kind: 'expense', planned: { [PERIOD]: { amount: '5.00', currency: 'TRY' } }, actual: {} },
      ],
    });
    // LABEL_1 planı farklı (1), "Yalnız canlıda" yalnız canlıda (1), nesildeki diğer 7 etiket canlıda yok (7) → 9
    expect(compareWithLive(rows, changed.ok ? changed.budget : null, PERIOD)).toBe(9);
    // Gelecek dönem: ekranda "Henüz yok" olsa da nesil ile canlı aynı kaynak değerleri taşıyorsa fark yoktur.
    const future = budgetRowsFor(ALL, FUTURE, null, TODAY);
    const mirror = liveOk({
      categories: future.map(r => ({
        id: r.label, label: r.label, group: '', kind: 'expense' as const,
        planned: { [FUTURE]: r.planned }, actual: { [FUTURE]: { amount: actualOf(r.label, FUTURE).value.decimal!, currency: 'TRY' } },
      })),
    });
    expect(compareWithLive(future, mirror.ok ? mirror.budget : null, FUTURE)).toBe(0);
  });

  it('trendPoints: kalemin aylık plan ve Gerçekleşen anlamı; gelecek aylar "Henüz yok", plan gelecekte de bilinir', () => {
    const periods = [...new Set(ALL.map(r => r.period))].sort();
    const points = trendPoints(ALL, periods, LABEL_1, TODAY);
    expect(points.map(p => p.period)).toEqual(periods);
    const nov = points.find(p => p.period === PERIOD)!;
    expect(nov.planned).toEqual({ amount: plannedOf(LABEL_1).value.decimal, currency: 'TRY' });
    expect(nov.recorded).toEqual({ kind: 'recorded', money: { amount: actualOf(LABEL_1).value.decimal, currency: 'TRY' }, evidence: false });
    const dec = points.find(p => p.period === FUTURE)!;
    expect(dec.recorded).toEqual({ kind: 'not_yet' });
    expect(dec.planned).not.toBeNull();
  });
});

// --- Sayfa -------------------------------------------------------------------------------------------------
describe('ButcePage › başlık ve özet', () => {
  it('bölüm "Para" → h1 "Bütçe ve nakit" → amaç → DataStatus (nesil) → ≤3 özet; plan ve gerçek ayrı özetlerdir', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Bütçe ve nakit' })).toBeInTheDocument();
    expect(screen.getByText('Para')).toBeInTheDocument();
    expect(screen.getByText('Ayın gelirini, planlanan giderlerini ve kalan nakdi kalem kalem izleyin.')).toBeInTheDocument();
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    const statuses = screen.getAllByRole('status');
    const nesil = statuses.find(s => s.textContent?.includes('Nesil '))!;
    expect(nesil).toHaveTextContent(`Nesil ${GENERATION_ID.slice(0, 6)}`);
    expect(nesil).toHaveAttribute('data-state', 'fresh');
    const summary = screen.getByRole('list', { name: 'Özet' });
    const items = within(summary).getAllByRole('listitem').map(li => li.textContent);
    expect(items.length).toBeLessThanOrEqual(3);
    expect(items[0]).toContain('Kasım 2026');
    expect(items[1]).toMatch(/^Planlanan8 gözlem/);
    // Gerçekleşen kanıtsız: sayım + "Kaynakta yazılı" notu (ödeme olayı değil, kaynak gözlemi).
    expect(items[2]).toMatch(/^Gerçekleşen8 gözlem/);
    expect(items[2]).toContain('Kaynakta yazılı');
    // Gözlemler toplanmaz: özet tutar değil sayımdır (data-platform: additive totals değil).
    expect(summary.textContent).not.toMatch(/₺/);
  });

  it('gelecek dönemde Gerçekleşen özeti "Henüz yok"; plan sayımı kalır', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    await choosePeriod(user, 'Aralık 2026');
    await waitFor(() => expect(countText('8 kalem · Aralık 2026')).toBeInTheDocument());
    const items = within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem').map(li => li.textContent);
    expect(items[1]).toMatch(/^Planlanan8 gözlem/);
    expect(items[2]).toMatch(/^GerçekleşenHenüz yok/);
  });

  it('başlıkta tek birincil eylem "Kalem ekle" (yerel değişiklik kümesi yok → devre dışı, nedeni yazılı) ve "Dışa aktar" ikincil', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    const primary = screen.getByRole('button', { name: /Kalem ekle/ });
    expect(primary).toBeDisabled();
    expect(screen.getByText('Bu dilimde kalem eklenmez; Sheets\'e yazma yok.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dışa aktar' })).toBeInTheDocument();
  });
});

describe('ButcePage › dönem ve tablo', () => {
  it('dönem seçici "Dönem" combobox; varsayılan içinde bulunulan ay; tablo Planlanan / Gerçekleşen / Fark ayrı sütunlar', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    expect(screen.getByRole('combobox', { name: 'Dönem' })).toBeInTheDocument();
    expect(countText('8 kalem · Kasım 2026')).toBeInTheDocument();
    expect(table).toBeInTheDocument();
    // antd başlığı ayrı bir <table> içinde çizebilir (yapışkan başlık); sütun başlıkları sayfa düzeyinde aranır.
    const headers = screen.getAllByRole('columnheader').map(th => th.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Kalem', 'Planlanan', 'Gerçekleşen', 'Fark', 'Durum', 'Tür']));
    expect(headers.indexOf('Planlanan')).toBeLessThan(headers.indexOf('Gerçekleşen'));
    const cells = cellsOf(rowOf(LABEL_1));
    expect(cells).toContain(tl(plannedOf(LABEL_1).value.decimal!));
    expect(cells).toContain('Bilinmiyor'); // sahiplik canlı eşleme olmadan bilinmez
  });

  it('Gerçekleşen hücresi kaynak değerini "Kaynakta yazılı" ile yazar; durum "Kaynakta yazılı", oran yok', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    const actual = cellAt(LABEL_1, 'Gerçekleşen');
    expect(actual).toHaveTextContent(tl(actualOf(LABEL_1).value.decimal!));
    expect(actual).toHaveTextContent('Kaynakta yazılı');
    expect(cellAt(LABEL_1, 'Durum')).toHaveTextContent('Kaynakta yazılı');
    expect(document.body.textContent).not.toMatch(/harcandı/);
  });

  it('varsayılan dönem İstanbul takviminden: 31 Ekim 21:30 UTC → "Kasım 2026"', async () => {
    renderPage({ now: () => new Date('2026-10-31T21:30:00.000Z') });
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    expect(countText('8 kalem · Kasım 2026')).toBeInTheDocument();
  });

  it('gelecek döneme geçince Gerçekleşen "Henüz yok", Fark "Hesaplanmadı", durum "Henüz yok"; plan yazılı kalır', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    await choosePeriod(user, 'Aralık 2026');
    await waitFor(() => expect(countText('8 kalem · Aralık 2026')).toBeInTheDocument());
    expect(cellAt(LABEL_1, 'Planlanan')).toHaveTextContent(tl(plannedOf(LABEL_1, FUTURE).value.decimal!));
    expect(cellAt(LABEL_1, 'Gerçekleşen')).toHaveTextContent(/^Henüz yok$/);
    expect(cellAt(LABEL_1, 'Fark')).toHaveTextContent('Hesaplanmadı');
    expect(cellAt(LABEL_1, 'Durum')).toHaveTextContent('Henüz yok');
    expect(cellAt(LABEL_1, 'Gerçekleşen').textContent).not.toMatch(/₺/);
  });

  it('gerçekleşen kaydı yoksa "Henüz yok", fark "Hesaplanmadı"; plan yoksa "Fiyat yok"', async () => {
    const files = await withPartitions({
      [ACTUAL_PATH]: ACTUAL.filter(r => !(r.label === LABEL_1 && r.period === PERIOD)),
      [PLAN_PATH]: PLAN.filter(r => !(r.label === LABEL_2 && r.period === PERIOD)),
    });
    renderPage({}, { files });
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    expect(cellsOf(rowOf(LABEL_1))).toEqual(expect.arrayContaining(['Henüz yok', 'Hesaplanmadı']));
    expect(cellAt(LABEL_1, 'Durum')).toHaveTextContent('Henüz yok');
    expect(cellsOf(rowOf(LABEL_2))).toEqual(expect.arrayContaining(['Fiyat yok', 'Hesaplanmadı']));
    // İki satırın da bir tarafı var: satır sayısı değişmez, eksik taraf adıyla yazılır.
    expect(countText('8 kalem · Kasım 2026')).toBeInTheDocument();
  });

  it('kanıtlı Gerçekleşen tabloda "Aşıldı" / "Sınıra yakın" ve "%N harcandı" metniyle; "Kaynakta yazılı" yazılmaz', async () => {
    const plan = PLAN.map(r => (r.period === PERIOD && (r.label === LABEL_1 || r.label === LABEL_3) ? { ...r, value: { decimal: '1000.00', currency: 'TRY' } } : r));
    const actual = mapActual(PERIOD, r => (r.label === LABEL_1 ? withValue(r, '1200.00', true) : r.label === LABEL_3 ? withValue(r, '950.00', true) : r));
    const files = await withPartitions({ [PLAN_PATH]: plan, [ACTUAL_PATH]: actual });
    renderPage({}, { files });
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    expect(cellAt(LABEL_1, 'Durum')).toHaveTextContent('Aşıldı');
    expect(cellAt(LABEL_1, 'Durum')).toHaveTextContent('%120 harcandı');
    expect(cellAt(LABEL_1, 'Gerçekleşen')).toHaveTextContent(tl('1200.00'));
    expect(cellAt(LABEL_1, 'Gerçekleşen')).not.toHaveTextContent('Kaynakta yazılı');
    expect(cellAt(LABEL_1, 'Fark')).toHaveTextContent(tl('-200.00'));
    expect(cellAt(LABEL_3, 'Durum')).toHaveTextContent('Sınıra yakın');
    expect(cellAt(LABEL_3, 'Durum')).toHaveTextContent('%95 harcandı');
    // Kanıtsız kalan satırlar oran almaz.
    expect(cellAt(LABEL_2, 'Durum')).toHaveTextContent('Kaynakta yazılı');
    expect(cellAt(LABEL_2, 'Durum')).not.toHaveTextContent(/harcandı/);
  });

  it('Gerçekleşen planın aynasıysa notu yazar; başka dönemde not yok', async () => {
    const planned = new Map(PLAN.filter(r => r.period === PERIOD).map(r => [r.label, r.value.decimal] as const));
    const files = await withPartitions({ [ACTUAL_PATH]: mapActual(PERIOD, r => withValue(r, planned.get(r.label)!)) });
    const user = userEvent.setup();
    renderPage({}, { files });
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    expect(screen.getByRole('note')).toHaveTextContent(MIRRORS_PLAN_NOTE);
    await choosePeriod(user, 'Ekim 2026');
    await waitFor(() => expect(countText('8 kalem · Ekim 2026')).toBeInTheDocument());
    expect(screen.queryByText(MIRRORS_PLAN_NOTE)).toBeNull();
  });

  it('telefonda kalem kalem akordeon: ilk satır açık, Planlanan ve Gerçekleşen gövdede ayrı etiketlerdir, "Kaynakta yazılı" görünür', async () => {
    renderPage({}, { device: 'phone' });
    const heads = await screen.findAllByRole('button', { expanded: true });
    expect(heads).toHaveLength(1);
    const first = heads.find(h => h.textContent?.includes(LABEL_1)) ?? heads[0];
    const panel = panelOf(first);
    expect(panel).toHaveTextContent('Planlanan');
    expect(panel).toHaveTextContent('Gerçekleşen');
    expect(panel).toHaveTextContent(tl(plannedOf(LABEL_1).value.decimal!));
    expect(panel).toHaveTextContent('Kaynakta yazılı');
    expect(screen.queryByRole('table', { name: 'Bütçe kalemleri' })).toBeNull();
    // 8 kalem, her biri ayrı akordeon satırı.
    expect(screen.getAllByRole('button', { expanded: false }).filter(b => b.getAttribute('aria-controls'))).toHaveLength(7);
  });

  it('telefonda akordeon başlığı: kalem adı + tür (meta) başlıkta; tür gövdede yinelenmez', async () => {
    renderPage({}, { device: 'phone' });
    const first = await headOf(LABEL_1);
    // Tasarım (SayfaButceDar): başlıkta Kalem title, Kategori/Tür meta, Fark lead, Durum status. Etiketsiz başlıkta
    // "Bilinmiyor" neyin bilinmediğini söylemez: meta "Tür bilinmiyor", lead "Fark" etiketiyle okunur.
    expect(first).toHaveTextContent('Tür bilinmiyor');
    expect(panelOf(first)).not.toHaveTextContent('Tür');
    const row = budgetRowsFor(ALL, PERIOD, null, TODAY).find(r => r.label === LABEL_1)!;
    expect(first).toHaveTextContent(`Fark ${tl(row.difference!.amount)}`);
    // Fark gövdede yinelenmez; Planlanan ve Gerçekleşen gövdede ayrı etiketlerle kalır.
    expect(panelOf(first)).not.toHaveTextContent('Fark');
  });

  it('telefonda gelecek ayda başlıktaki Fark "Fark Hesaplanmadı" diye etiketlidir', async () => {
    const user = userEvent.setup();
    renderPage({}, { device: 'phone' });
    await headOf(LABEL_1);
    await choosePeriod(user, 'Aralık 2026');
    await waitFor(() => expect(countText('8 kalem · Aralık 2026')).toBeInTheDocument());
    expect(await headOf(LABEL_1)).toHaveTextContent('Fark Hesaplanmadı');
  });

  it('telefonda dönem seçimi alttan açılan "Dönem" diyaloğunda; seçim akordeonu o döneme çevirir ve diyaloğu kapatır', async () => {
    const user = userEvent.setup();
    renderPage({}, { device: 'phone' });
    await headOf(LABEL_1);
    await user.click(screen.getByRole('combobox', { name: 'Dönem' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dönem' });
    expect(within(dialog).getByRole('option', { name: 'Kasım 2026' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(dialog).getByRole('option', { name: 'Aralık 2026' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dönem' })).toBeNull());
    await waitFor(() => expect(countText('8 kalem · Aralık 2026')).toBeInTheDocument());
    const panel = panelOf(await headOf(LABEL_1));
    expect(panel).toHaveTextContent('Henüz yok');
    expect(panel).not.toHaveTextContent('Kaynakta yazılı');
  });
});

describe('ButcePage › geniş eğilim (lazyWide)', () => {
  it('masaüstünde seçili kalemin aylık plan/gerçek çizgisi geniş modülden gelir; yanında tablo; gelecek aylar "Henüz yok"', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    const img = await screen.findByRole('img', { name: `"${LABEL_1}" kaleminin aylara göre planlanan ve gerçekleşen tutarı; değerler yanındaki tabloda` });
    const described = document.getElementById(img.getAttribute('aria-describedby')!)!;
    const trend = within(described).getByRole('table', { name: `${LABEL_1} · aylık plan ve gerçek` });
    expect(within(trend).getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Ay', 'Planlanan', 'Gerçekleşen']);
    const months = within(trend).getAllByRole('row').slice(1);
    expect(months).toHaveLength(24);
    const december = months.find(row => within(row).queryByRole('rowheader', { name: 'Aralık 2026' }))!;
    expect(within(december).getAllByRole('cell')[1]).toHaveTextContent(/^Henüz yok$/);
    const november = months.find(row => within(row).queryByRole('rowheader', { name: 'Kasım 2026' }))!;
    expect(within(november).getAllByRole('cell')[1]).toHaveTextContent(tl(actualOf(LABEL_1).value.decimal!));
    await waitFor(() => expect(mocks.setOption).toHaveBeenCalled());
    const option = mocks.setOption.mock.calls.at(-1)![0] as { series: { name: string; type: string; data: (number | null)[] }[] };
    expect(option.series.map(s => s.name)).toEqual(['Planlanan', 'Gerçekleşen']);
    expect(option.series.every(s => s.type === 'line')).toBe(true);
    // Gerçekleşen serisi gelecek aylarda boş (Kasım 2026 = 11. ay → indeks 10; sonrası null); plan dolu.
    expect(option.series[1]!.data.slice(11).every(value => value === null)).toBe(true);
    expect(option.series[1]!.data[10]).toBe(Number(actualOf(LABEL_1).value.decimal));
    expect(option.series[0]!.data.slice(11).every(value => typeof value === 'number')).toBe(true);
    await user.click(rowOf(LABEL_3));
    expect(await screen.findByRole('img', { name: /"Örnek gider satırı 3" kaleminin/ })).toBeInTheDocument();
  });

  it('eğilim grafiği: legend üstte (ECharts 6 varsayılanı alttır, eksen etiketleriyle çakışır); eksen ve ipucu tr-TR, boş nokta adıyla', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    await waitFor(() => expect(mocks.setOption).toHaveBeenCalled());
    type Formatter = (value: number | null, dataIndex: number) => string;
    const option = mocks.setOption.mock.calls.at(-1)![0] as {
      legend: { top?: number | string; bottom?: number | string };
      grid: { top: number };
      yAxis: { axisLabel: { formatter: (value: number) => string } };
      series: { tooltip: { valueFormatter: Formatter } }[];
    };
    expect(option.legend.top).toBe(0);
    expect(option.legend.bottom).toBeUndefined();
    expect(option.grid.top).toBeGreaterThan(0);
    expect(option.yAxis.axisLabel.formatter(25000)).toBe('25.000');
    const actual = actualOf(LABEL_1).value.decimal!;
    const [plan, real] = option.series.map(s => s.tooltip.valueFormatter);
    expect(real!(Number(actual), 10)).toBe(tl(actual));
    expect(real!(null, 11)).toBe('Henüz yok'); // Aralık 2026: içinde bulunulan aydan sonra
    expect(plan!(Number(plannedOf(LABEL_1).value.decimal), 10)).toBe(tl(plannedOf(LABEL_1).value.decimal!));
  });

  it('telefonda aylık eğilim çizilmez ve grafik motoru yüklenmez', async () => {
    renderPage({}, { device: 'phone' });
    await headOf(LABEL_1);
    // Geniş modülün yüklenmesine fırsat ver: telefonda yine de hiçbir şey gelmemeli.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(screen.queryByRole('region', { name: 'Aylık eğilim' })).toBeNull();
    expect(screen.queryByRole('img', { name: /kaleminin aylara göre/ })).toBeNull();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('kaynak kuralı: telefon yolu (ButcePage + butce/ ortak modüller) Chart, antd, echarts ya da *.wide statik içe aktarmaz', () => {
    const pageDir = here;
    const sources = [join(pageDir, 'ButcePage.tsx'), ...readdirSync(join(pageDir, 'butce')).filter(name => /\.tsx?$/.test(name) && !/\.wide\.|\.test\./.test(name)).map(name => join(pageDir, 'butce', name))];
    const violations: string[] = [];
    for (const file of sources) {
      const source = readFileSync(file, 'utf8');
      for (const ref of importsOf(source)) {
        if (ref.kind !== 'static' || ref.typeOnly) continue;
        if (/^(antd|@ant-design|echarts|zrender)(\/|$)/.test(ref.specifier) || /(^|\/)ui\/(antd|Chart)$/.test(ref.specifier) || /\.wide$/.test(ref.specifier)) {
          violations.push(`${relative(pageDir, file)}: ${ref.specifier}`);
        }
      }
      for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:\.\.\/)+ui['"]/g)) {
        const names = match[1]!.split(',').map(name => name.trim().replace(/^type\s+/, '')).filter(Boolean);
        if (names.includes('Chart')) violations.push(`${relative(pageDir, file)}: ui › Chart`);
      }
    }
    expect(violations).toEqual([]);
    const page = readFileSync(join(pageDir, 'ButcePage.tsx'), 'utf8');
    expect(page).toMatch(/lazyWide\(\s*'butce-egilim'\s*,\s*\(\)\s*=>\s*import\('\.\/butce\/ButceTrend\.wide'\)\s*\)/);
  });
});

describe('ButcePage › veri durumları', () => {
  it('koleksiyon boşsa dürüst metin: "Kaynakta bütçe gözlemi kaydı yok"', async () => {
    const files = await withPartitions({ [PLAN_PATH]: [], [ACTUAL_PATH]: [] });
    renderPage({}, { files });
    expect(await screen.findByRole('heading', { level: 2, name: 'Kaynakta bütçe gözlemi kaydı yok' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Dönem' })).toBeNull();
  });

  it('partition bozuksa ErrorState "Hata: …" + "Yeniden dene"; tutar gösterilmez', async () => {
    const files = { ...FILES, [PLAN_PATH]: '{"schemaVersion":1,"collection":"budget_observations","records":[{"id":"x"}]}' };
    renderPage({}, { files });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Hata: /);
    expect(alert.textContent).not.toMatch(/₺/);
    expect(within(alert).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
  });

  it('yüklenirken LoadingShell (role=status, aria-busy)', () => {
    renderPage();
    expect(screen.getAllByRole('status').some(s => s.getAttribute('aria-busy') === 'true')).toBe(true);
  });

  it('eski veri: yenileme başarısızsa son başarılı nesil gösterilmeye devam eder, tazelik satırı "stale"', async () => {
    const user = userEvent.setup();
    const fixture = new FixtureGenerationSource(FILES, 'sentetik');
    let failing = false;
    const source: GenerationSource = {
      kind: 'fixture',
      label: 'sentetik',
      readText: async (path: string) => {
        if (failing) throw new Error('Nesil kaynağına ulaşılamadı');
        return fixture.readText(path);
      },
    } as GenerationSource;
    renderPage({}, { source });
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    failing = true;
    await user.click(within(header).getByRole('button', { name: 'Yenile' }));
    await waitFor(() => expect(within(header).getByRole('status')).toHaveAttribute('data-state', 'stale'));
    expect(screen.getByRole('table', { name: 'Bütçe kalemleri' })).toBeInTheDocument();
    expect(cellAt(LABEL_1, 'Planlanan')).toHaveTextContent(tl(plannedOf(LABEL_1).value.decimal!));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ButcePage › Canlı Sheet', () => {
  it('başarılı okuma: "Canlı Sheet" satırı, son okuma saati, nesil ile fark sayısı', async () => {
    const rows = budgetRowsFor(ALL, PERIOD, null, TODAY);
    const live = liveOk({
      categories: rows.map((r, i) => ({ id: r.label, label: r.label, group: '', kind: 'expense' as const, planned: { [PERIOD]: i === 0 ? { amount: '1.00', currency: 'TRY' } : r.planned }, actual: { [PERIOD]: r.actual } })),
    });
    const liveBudgetImpl = vi.fn(async () => live);
    renderPage({ liveBudgetImpl });
    const region = await screen.findByRole('region', { name: 'Canlı Sheet' });
    await waitFor(() => expect(within(region).getByRole('status')).toHaveAttribute('data-state', 'fresh'));
    // Fark sayısı nesil (dönem) de okununca çizilir; canlı okuma nesilden önce bitebilir → bekle.
    expect(await within(region).findByText('Nesil ile 1 fark')).toBeInTheDocument();
    expect(liveBudgetImpl).toHaveBeenCalledTimes(1);
    // Sahiplik canlıdan geldi: satırlar artık "Kalem" olarak işaretli.
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    await waitFor(() => expect(cellsOf(rowOf(LABEL_1))).toContain('Kalem'));
  });

  it('hata: "Hata: …" metni, tutar yok, "Yeniden dene" canlı okumayı yineler', async () => {
    const user = userEvent.setup();
    const liveBudgetImpl = vi.fn(async () => liveFail);
    renderPage({ liveBudgetImpl });
    const region = await screen.findByRole('region', { name: 'Canlı Sheet' });
    const status = await within(region).findByText(/^Hata: Google Sheets yanıtı okunamadı/);
    expect(status).toBeInTheDocument();
    expect(region.textContent).not.toMatch(/₺/);
    expect(within(region).queryByText(/Nesil ile/)).toBeNull();
    await user.click(within(region).getByRole('button', { name: 'Yeniden dene' }));
    await waitFor(() => expect(liveBudgetImpl).toHaveBeenCalledTimes(2));
  });

  it('hata + son iyi okuma (lastGood): durum "stale", son iyi okuma zamanı lastReadAtOf, neden adıyla; sahiplik son iyi okumadan', async () => {
    const user = userEvent.setup();
    const lastGood = liveOk({
      readAt: '2026-10-27T11:32:00.000Z',
      categories: [{ id: 'c1', label: LABEL_1, group: '', kind: 'expense', planned: {}, actual: {} }],
    });
    const failure: LiveBudgetResult = {
      ok: false,
      kind: 'network',
      title: "Sheets'e ulaşılamadı",
      message: "Hata: Sheets'e ulaşılamadı. Bağlantı kurulamadı. 3 kez denendi.",
      retryable: true,
      attempts: 3,
      lastGood: lastGood.ok ? lastGood.budget : null,
    };
    expect(lastReadAtOf(failure)).toBe('2026-10-27T11:32:00.000Z');
    const liveBudgetImpl = vi.fn(async () => failure);
    renderPage({ liveBudgetImpl });
    const region = await screen.findByRole('region', { name: 'Canlı Sheet' });
    const status = within(region).getByRole('status');
    await waitFor(() => expect(status).toHaveAttribute('data-state', 'stale'));
    // DataStatus İstanbul saatiyle yazar: 11:32 UTC → 14:32.
    expect(status).toHaveTextContent('Son başarılı nesil 27.10.2026 14:32');
    expect(status).toHaveTextContent('yenilenemedi');
    // Neden sınıflanmış Türkçe metinle yazılır; eski okuma taze gösterilmez, tutar yok.
    expect(region).toHaveTextContent("Sheets'e ulaşılamadı. Bağlantı kurulamadı. 3 kez denendi.");
    expect(region.textContent).not.toMatch(/₺/);
    // Sahiplik son iyi okumanın eşlemesinden gelir (satır "eski" diye işaretli).
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    await waitFor(() => expect(cellAt(LABEL_1, 'Tür')).toHaveTextContent('Kalem'));
    await user.click(within(region).getByRole('button', { name: 'Yeniden dene' }));
    await waitFor(() => expect(liveBudgetImpl).toHaveBeenCalledTimes(2));
  });

  it('açılışta saklı son iyi okuma (lastGoodBudget): canlı okuma sürerken "Okunuyor…" + son okuma zamanı; sahiplik ondan', async () => {
    const lastGood = liveOk({
      readAt: '2026-10-27T11:32:00.000Z',
      categories: [{ id: 'c1', label: LABEL_1, group: '', kind: 'expense', planned: {}, actual: {} }],
    });
    const lastGoodImpl = vi.fn(async () => (lastGood.ok ? lastGood.budget : null));
    const liveBudgetImpl = vi.fn(() => new Promise<LiveBudgetResult>(() => {}));
    renderPage({ liveBudgetImpl, lastGoodImpl });
    const region = await screen.findByRole('region', { name: 'Canlı Sheet' });
    const status = within(region).getByRole('status');
    await waitFor(() => expect(status).toHaveTextContent('Son okuma 27.10.2026 14:32'));
    expect(status).toHaveAttribute('data-state', 'checking');
    expect(status).toHaveTextContent('Okunuyor…');
    expect(lastGoodImpl).toHaveBeenCalledTimes(1);
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    await waitFor(() => expect(cellAt(LABEL_1, 'Tür')).toHaveTextContent('Kalem'));
  });

  it('"Yenile" ile yeniden okurken önceki okuma korunur: Tür sütunu "Bilinmiyor"a dönmez, son okuma zamanı yazılı', async () => {
    const user = userEvent.setup();
    const first = liveOk({ categories: [{ id: 'c1', label: LABEL_1, group: '', kind: 'expense', planned: {}, actual: {} }] });
    const liveBudgetImpl = vi.fn()
      .mockImplementationOnce(async () => first)
      .mockImplementation(() => new Promise<LiveBudgetResult>(() => {}));
    renderPage({ liveBudgetImpl });
    const region = await screen.findByRole('region', { name: 'Canlı Sheet' });
    const status = within(region).getByRole('status');
    await waitFor(() => expect(status).toHaveAttribute('data-state', 'fresh'));
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    await waitFor(() => expect(cellAt(LABEL_1, 'Tür')).toHaveTextContent('Kalem'));
    await user.click(within(region).getByRole('button', { name: 'Yenile' }));
    await waitFor(() => expect(status).toHaveAttribute('data-state', 'checking'));
    expect(liveBudgetImpl).toHaveBeenCalledTimes(2);
    expect(status).not.toHaveTextContent('Son okuma henüz yok');
    expect(cellAt(LABEL_1, 'Tür')).toHaveTextContent('Kalem');
  });

  it('canlı okuyucu reddederse (ham TypeError "Failed to fetch") sınıflanmış Türkçe hata yazılır; ham metin ve sonsuz "Okunuyor…" yok', async () => {
    const liveBudgetImpl = vi.fn(async (): Promise<LiveBudgetResult> => { throw new TypeError('Failed to fetch'); });
    renderPage({ liveBudgetImpl });
    const region = await screen.findByRole('region', { name: 'Canlı Sheet' });
    const status = within(region).getByRole('status');
    await waitFor(() => expect(status).toHaveAttribute('data-state', 'error'));
    expect(status).toHaveTextContent(/^Hata: Sheets'e ulaşılamadı\./);
    expect(region.textContent).not.toMatch(/Failed to fetch|Load failed|TypeError/);
    expect(within(region).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
  });

  it('gerçek liveBudget sınıflandırması: tarayıcının "Failed to fetch" metni yerine "Sheets\'e ulaşılamadı. Bağlantı kurulamadı."', async () => {
    const liveBudgetImpl = vi.fn((options: LiveBudgetOptions) => liveBudget({
      ...options,
      fetchBudgetImpl: async () => { throw new TypeError('Failed to fetch'); },
      retry: { attempts: 1 },
      cache: null,
    }));
    renderPage({ liveBudgetImpl });
    const region = await screen.findByRole('region', { name: 'Canlı Sheet' });
    const status = within(region).getByRole('status');
    await waitFor(() => expect(status).toHaveAttribute('data-state', 'error'));
    expect(status).toHaveTextContent("Hata: Sheets'e ulaşılamadı. Bağlantı kurulamadı.");
    expect(region.textContent).not.toMatch(/Failed to fetch|Load failed/);
  });

  it('sayfa başlığında tek tazelik satırı: canlı Sheet satırı başlığın dışında, başlıktan sonra', async () => {
    const liveBudgetImpl = vi.fn(async () => liveOk());
    renderPage({ liveBudgetImpl });
    const region = await screen.findByRole('region', { name: 'Canlı Sheet' });
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    expect(within(header).getAllByRole('status')).toHaveLength(1);
    expect(header.contains(region)).toBe(false);
    expect(header.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('live=false: canlı okuma yapılmaz, satır çizilmez', async () => {
    const liveBudgetImpl = vi.fn(async () => liveOk());
    renderPage({ live: false, liveBudgetImpl });
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    expect(screen.queryByRole('region', { name: 'Canlı Sheet' })).toBeNull();
    expect(liveBudgetImpl).not.toHaveBeenCalled();
  });
});
