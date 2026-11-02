// Bütçe ve nakit sayfası: sentetik nesil (fixtures/generation-synthetic) GenerationProvider + FixtureGenerationSource ile
// belleğe okunur; budget_observations plan (basis planned) ve gerçek (recorded_aggregate) AYRI sütunlardır, hiçbir yerde
// tek sayıda birleşmez. Dönem seçici Select; tablo ResponsiveTable (telefonda akordeon, ilk satır açık); Chart seçili
// kalemin aylık plan/gerçek çizgisi + yanında tablo. Canlı GViz (live.liveBudget) ikinci DataStatus satırıdır: başarılıysa
// nesil ile fark sayısı, hata ise "Hata: …" metni ve tutar yok. Seçiciler role/label ile; antd iç sınıfı yok.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { FixtureGenerationSource, GenerationProvider, type BudgetObservation, type BudgetViewModel, type LiveBudgetResult } from '../data';
import { ButcePage, budgetRowsFor, compareWithLive, defaultPeriod, periodLabel, type ButcePageProps } from './ButcePage';

const mocks = vi.hoisted(() => {
  const setOption = vi.fn();
  const init = vi.fn(() => ({ setOption, resize: vi.fn(), dispose: vi.fn() }));
  return { setOption, init };
});
vi.mock('echarts/core', () => ({ init: mocks.init, use: vi.fn(), registerTheme: vi.fn() }));
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {} }));
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

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
const PERIOD = '2026-11';
const LABEL_1 = 'Örnek gider satırı 1';
const plannedOf = (label: string, period = PERIOD) => PLAN.find(r => r.label === label && r.period === period)!;
const actualOf = (label: string, period = PERIOD) => ACTUAL.find(r => r.label === label && r.period === period)!;
const tl = (decimal: string) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 }).format(decimal as `${number}`);

/** Partition dosyasını yeni kayıt listesiyle yazar; manifest hash'i tutmaz → store'un bütünlük denetimi devre dışı mı? Hayır:
 *  manifest sha256 eşleşmez. Bu yüzden değişen partition için manifest girdisi de yeniden hesaplanır. */
async function withRecords(path: string, records: BudgetObservation[]): Promise<Record<string, string>> {
  const files = { ...FILES };
  const text = JSON.stringify({ schemaVersion: 1, collection: 'budget_observations', records });
  files[path] = text;
  const manifest = JSON.parse(files['manifest.json']!) as { files: { path: string; sha256: string; bytes: number; count?: number }[]; counts: Record<string, number> };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const sha = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  const entry = manifest.files.find(file => file.path === path)!;
  entry.sha256 = sha;
  entry.bytes = new TextEncoder().encode(text).byteLength;
  if (entry.count !== undefined) entry.count = records.length;
  const otherPath = path === PLAN_PATH ? ACTUAL_PATH : PLAN_PATH;
  const other = manifest.files.find(file => file.path === otherPath)!;
  manifest.counts.budget_observations = records.length + (other.count ?? 0);
  files['manifest.json'] = JSON.stringify(manifest);
  return files;
}

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

function renderPage(props: Partial<ButcePageProps> = {}, { device = 'desktop' as Device, files = FILES } = {}) {
  const liveBudgetImpl = props.liveBudgetImpl ?? vi.fn(async () => liveOk());
  const Wrapper = onDevice(device);
  const utils = render(
    <Wrapper>
      <GenerationProvider source={new FixtureGenerationSource(files, 'sentetik')} cache={null} changeSet={null}>
        <ButcePage now={NOW} liveBudgetImpl={liveBudgetImpl} {...props} />
      </GenerationProvider>
    </Wrapper>,
  );
  return { ...utils, liveBudgetImpl };
}

const rowOf = (name: string) => screen.getAllByRole('row').find(row => within(row).queryByText(name))!;
const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell').map(cell => cell.textContent);
/** "8 kalem · Kasım 2026" sayımı: strong + span olarak çizilir; paragrafın tam metniyle eşleşir. */
const countText = (text: string) => screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === text);

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

  it('budgetRowsFor: plan ve gerçek ayrı alanlar; fark planlanan − gerçekleşen; yinelenen gözlem toplanmaz, "Bilinmiyor"', () => {
    const rows = budgetRowsFor(ALL, PERIOD, null);
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
    const dupRow = budgetRowsFor([...ALL, dup], PERIOD, null).find(r => r.label === LABEL_1)!;
    expect(dupRow.planned).toBeNull();
    expect(dupRow.plannedAmbiguous).toBe(true);
    expect(dupRow.difference).toBeNull();
  });

  it('budgetRowsFor: canlı sahiplik eşlemesiyle ara toplam / kalem işaretlenir ve ağaç sırası kurulur', () => {
    const live = liveOk({
      groups: [{ id: 'g1', label: 'Örnek gider satırı 1', group: '', kind: 'expense', planned: {}, actual: {} }],
      categories: [{ id: 'c2', label: 'Örnek gider satırı 2', group: 'Örnek gider satırı 1', kind: 'expense', planned: {}, actual: {} }],
    });
    const rows = budgetRowsFor(ALL, PERIOD, live.ok ? live.budget : null);
    const g = rows.find(r => r.label === 'Örnek gider satırı 1')!;
    const c = rows.find(r => r.label === 'Örnek gider satırı 2')!;
    expect(g.ownership).toBe('subtotal');
    expect(c.ownership).toBe('leaf');
    expect(c.parent).toBe('Örnek gider satırı 1');
    expect(rows.indexOf(c)).toBe(rows.indexOf(g) + 1);
  });

  it('compareWithLive: aynı dönemde tutarı farklı ya da tek tarafta olan etiketleri sayar', () => {
    const rows = budgetRowsFor(ALL, PERIOD, null);
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
    expect(items[2]).toMatch(/^Gerçekleşen8 gözlem/);
    // Gözlemler toplanmaz: özet tutar değil sayımdır (data-platform: additive totals değil).
    expect(summary.textContent).not.toMatch(/₺/);
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
    const row = rowOf(LABEL_1);
    const cells = cellsOf(row);
    expect(cells).toContain(tl(plannedOf(LABEL_1).value.decimal!));
    expect(cells).toContain(tl(actualOf(LABEL_1).value.decimal!));
    expect(cells).toContain('Bilinmiyor'); // sahiplik canlı eşleme olmadan bilinmez
  });

  it('dönem değişince satırlar o dönemin gözlemlerine döner', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    await user.click(screen.getByRole('combobox', { name: 'Dönem' }));
    await user.click(await screen.findByRole('option', { name: 'Aralık 2026' }));
    await waitFor(() => expect(countText('8 kalem · Aralık 2026')).toBeInTheDocument());
    expect(cellsOf(rowOf(LABEL_1))).toContain(tl(plannedOf(LABEL_1, '2026-12').value.decimal!));
  });

  it('gerçekleşen yoksa "Henüz yok", fark "Hesaplanmadı", durum "Bekliyor"; plan yoksa "Fiyat yok"', async () => {
    const files = await withRecords(ACTUAL_PATH, ACTUAL.filter(r => !(r.label === LABEL_1 && r.period === PERIOD)));
    const files2 = { ...files, ...(await withRecords(PLAN_PATH, PLAN.filter(r => !(r.label === 'Örnek gider satırı 2' && r.period === PERIOD)))) };
    // İki değişiklik aynı manifestte: ikinci çağrı ilk dosyadaki manifesti bilmez; manifesti birleştir.
    const m1 = JSON.parse(files['manifest.json']!) as { files: { path: string; sha256: string; bytes: number; count?: number }[]; counts: Record<string, number> };
    const m2 = JSON.parse(files2['manifest.json']!) as typeof m1;
    const actualEntry = m1.files.find(f => f.path === ACTUAL_PATH)!;
    const merged = { ...m2, files: m2.files.map(f => (f.path === ACTUAL_PATH ? actualEntry : f)), counts: { ...m2.counts, budget_observations: (m2.files.find(f => f.path === PLAN_PATH)!.count ?? 0) + (actualEntry.count ?? 0) } };
    files2['manifest.json'] = JSON.stringify(merged);
    files2[ACTUAL_PATH] = files[ACTUAL_PATH]!;
    renderPage({}, { files: files2 });
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    expect(cellsOf(rowOf(LABEL_1))).toEqual(expect.arrayContaining(['Henüz yok', 'Hesaplanmadı', 'Bekliyor']));
    expect(cellsOf(rowOf('Örnek gider satırı 2'))).toEqual(expect.arrayContaining(['Fiyat yok', 'Hesaplanmadı', 'Plan yok']));
    // İki satırın da bir tarafı var: satır sayısı değişmez, eksik taraf adıyla yazılır.
    expect(countText('8 kalem · Kasım 2026')).toBeInTheDocument();
  });

  it('telefonda akordeon: ilk satır açık, Planlanan ve Gerçekleşen gövdede ayrı etiketlerdir', async () => {
    renderPage({}, { device: 'phone' });
    const heads = await screen.findAllByRole('button', { expanded: true });
    expect(heads.length).toBeGreaterThanOrEqual(1);
    const first = heads.find(h => h.textContent?.includes(LABEL_1)) ?? heads[0];
    const panel = document.getElementById(first.getAttribute('aria-controls')!)!;
    expect(panel).toHaveTextContent('Planlanan');
    expect(panel).toHaveTextContent('Gerçekleşen');
    expect(screen.queryByRole('table', { name: 'Bütçe kalemleri' })).toBeNull();
  });

  it('telefonda akordeon başlığı: kalem adı + tür (meta) başlıkta; tür gövdede yinelenmez', async () => {
    renderPage({}, { device: 'phone' });
    const heads = await screen.findAllByRole('button', { expanded: true });
    const first = heads.find(h => h.textContent?.includes(LABEL_1)) ?? heads[0];
    // Tasarım (SayfaButceDar): başlıkta Kalem title, Kategori/Tür meta, Fark lead, Durum status.
    expect(first).toHaveTextContent('Bilinmiyor');
    const panel = document.getElementById(first.getAttribute('aria-controls')!)!;
    expect(panel).not.toHaveTextContent('Tür');
  });
});

describe('ButcePage › grafik', () => {
  it('seçili kalemin aylık plan/gerçek çizgisi; yanında tablo; satır seçimi grafiği değiştirir', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('table', { name: 'Bütçe kalemleri' });
    const img = await screen.findByRole('img', { name: `"${LABEL_1}" kaleminin aylara göre planlanan ve gerçekleşen tutarı; değerler yanındaki tabloda` });
    const described = document.getElementById(img.getAttribute('aria-describedby')!)!;
    const trend = within(described).getByRole('table', { name: `${LABEL_1} · aylık plan ve gerçek` });
    expect(within(trend).getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Ay', 'Planlanan', 'Gerçekleşen']);
    expect(within(trend).getAllByRole('row').length).toBeGreaterThan(12);
    await waitFor(() => expect(mocks.setOption).toHaveBeenCalled());
    const option = mocks.setOption.mock.calls.at(-1)![0] as { series: { name: string; type: string; data: number[] }[] };
    expect(option.series.map(s => s.name)).toEqual(['Planlanan', 'Gerçekleşen']);
    expect(option.series.every(s => s.type === 'line')).toBe(true);
    await user.click(rowOf('Örnek gider satırı 3'));
    expect(await screen.findByRole('img', { name: /"Örnek gider satırı 3" kaleminin/ })).toBeInTheDocument();
  });
});

describe('ButcePage › veri durumları', () => {
  it('koleksiyon boşsa dürüst metin: "Kaynakta bütçe gözlemi kaydı yok"', async () => {
    const files = await withRecords(PLAN_PATH, []);
    const both = { ...files, ...(await withRecords(ACTUAL_PATH, [])) };
    const m1 = JSON.parse(files['manifest.json']!) as { files: { path: string }[] };
    const m2 = JSON.parse(both['manifest.json']!) as { files: { path: string }[]; counts: Record<string, number> };
    both['manifest.json'] = JSON.stringify({ ...m2, files: m2.files.map(f => (f.path === PLAN_PATH ? m1.files.find(x => x.path === PLAN_PATH)! : f)), counts: { ...m2.counts, budget_observations: 0 } });
    both[PLAN_PATH] = files[PLAN_PATH]!;
    renderPage({}, { files: both });
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
});

describe('ButcePage › Canlı Sheet', () => {
  it('başarılı okuma: "Canlı Sheet" satırı, son okuma saati, nesil ile fark sayısı', async () => {
    const rows = budgetRowsFor(ALL, PERIOD, null);
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
