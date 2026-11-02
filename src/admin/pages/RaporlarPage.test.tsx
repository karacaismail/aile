import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { FixtureGenerationSource, GenerationProvider, type BudgetObservation } from '../data';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { RaporlarPage, REPORTS, periodLabel, toCsv } from './RaporlarPage';

// Tasarım: README.md "Sayfa iskeleti" + bundle.js Aile.Pages.Raporlar (masaüstünde solda rapor menüsü, dar ekranda
// "Rapor" seçimi; Dönem seçimi; "Raporu dışa aktar"; plan acik-mavi / gerçek eylem çubukları + yanında tablo).
// Veri: budget_observations (basis planned | recorded_aggregate; period YYYY-MM). Plan ve gerçek ayrı sütun ve ayrı
// özet ölçüsüdür; eksik değer adıyla söylenir; tahminler (forecast_*) toplanmaz. Seçiciler role/label ile.

// Chart: echarts tembel yüklenir; burada yalnız sözleşmesi (role=img + aria-label, açıklama görünür) taklit edilir.
vi.mock('../ui/Chart', () => ({
  Chart: (p: { ariaLabel: string; description: ReactNode }) => (
    <div>
      <div role="img" aria-label={p.ariaLabel} />
      <div>{p.description}</div>
    </div>
  ),
}));
// Telefonda Select ve OverflowActions alttan sayfada açılır; burada yalnız sözleşmesi (dialog + Kapat) taklit edilir.
vi.mock('../ui/BottomSheet', () => ({
  BottomSheet: (p: { title: string; children?: ReactNode; onClose?: () => void; open?: boolean }) =>
    p.open === false ? null : (
      <div role="dialog" aria-modal="true" aria-label={p.title}>
        <button type="button" onClick={p.onClose}>Kapat</button>
        {p.children}
      </div>
    ),
}));

// --- Sentetik nesil → bellek -------------------------------------------------------------------------
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
interface ManifestLike { files: { path: string; collection?: string }[]; counts: Record<string, number> }
const MANIFEST = JSON.parse(FILES['manifest.json']!) as ManifestLike;
const OBS: BudgetObservation[] = MANIFEST.files
  .filter((file) => file.collection === 'budget_observations')
  .flatMap((file) => (JSON.parse(FILES[file.path]!) as { records: BudgetObservation[] }).records);

const TRY = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const YEARS = [...new Set(OBS.map((o) => o.period.slice(0, 4)))].sort();
const LATEST_YEAR = YEARS[YEARS.length - 1]!;
/** Beklenen toplam: kuruş tam sayısıyla; panelle aynı yuvarlama kuralı (ondalık metin → kuruş). */
function sumOf(rows: readonly BudgetObservation[], basis: string, year?: string): number {
  let kurus = 0;
  for (const row of rows) {
    if (row.basis !== basis || row.value.decimal === null) continue;
    if (year && !row.period.startsWith(year)) continue;
    kurus += Math.round(Number(row.value.decimal) * 100);
  }
  return kurus / 100;
}

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

/** Nesilde budget_observations hiç yokmuş gibi: manifestten parça girdileri düşer, koleksiyon boş ve hatasız gelir. */
function withoutBudgetObservations(): FixtureGenerationSource {
  const manifest: ManifestLike = {
    ...MANIFEST,
    files: MANIFEST.files.filter((file) => file.collection !== 'budget_observations'),
    counts: { ...MANIFEST.counts, budget_observations: 0 },
  };
  return fixtureSource({ 'manifest.json': JSON.stringify(manifest) });
}

function renderPage(device: Device = 'desktop', source: FixtureGenerationSource = fixtureSource()) {
  return render(
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={source} cache={null} changeSet={null}>
        <RaporlarPage location="/raporlar" />
      </GenerationProvider>
    </DeviceContext.Provider>,
  );
}

async function waitForReport(name: string) {
  return await screen.findByRole('table', { name }, { timeout: 4000 });
}
/** antd Table yapışkan başlıkta başlık satırını ayrı tabloda çizer; sütun başlıkları ekran kapsamında, gövde satırları tabloda. */
const headerTitles = () => screen.getAllByRole('columnheader').map((th) => th.textContent);
const bodyRows = (table: HTMLElement) => within(table).getAllByRole('row');

// --- Saf yardımcılar -----------------------------------------------------------------------------------
describe('Raporlar › yardımcılar', () => {
  it('REPORTS tasarımdaki beş hazır rapordur, cümle düzeninde', () => {
    expect(REPORTS.map((r) => r.label)).toEqual([
      'Aylık plan ve gerçek', 'Kaleme göre harcama', 'Borç ödeme planı', 'Oda bazında alımlar', 'Veri güveni özeti',
    ]);
  });

  it('periodLabel YYYY-MM dönemini Türkçe ay adıyla yazar; bozuk dönem olduğu gibi kalır', () => {
    expect(periodLabel('2026-11')).toBe('Kasım 2026');
    expect(periodLabel('2027-01')).toBe('Ocak 2027');
    expect(periodLabel('bilinmiyor')).toBe('bilinmiyor');
  });

  it('toCsv noktalı virgülle ayırır, ayırıcı ve tırnak içeren hücreyi tırnaklar, BOM ile başlar', () => {
    const csv = toCsv([['Ay', 'Planlanan'], ['Kasım 2026', '8500.00 TRY'], ['Not; "a"', 'Henüz yok']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('Ay;Planlanan\r\nKasım 2026;8500.00 TRY\r\n"Not; ""a""";Henüz yok');
  });
});

// --- Sayfa ---------------------------------------------------------------------------------------------
describe('RaporlarPage › başlık ve durumlar', () => {
  it('bölüm, h1, amaç ve rapor menüsü; tazelik satırı nesil kimliğiyle dolar', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Raporlar' })).toBeInTheDocument();
    expect(screen.getByText('Rapor')).toBeInTheDocument();
    expect(screen.getByText('Hazır raporları açın; her rakamın hangi kayıtlardan geldiğini görün.')).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Raporlar' });
    const menu = within(nav).getByRole('menu');
    for (const report of REPORTS) expect(within(menu).getByRole('menuitem', { name: report.label })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Aylık plan ve gerçek' })).toHaveAttribute('aria-current', 'page');

    await waitForReport('Aylık plan ve gerçek');
    const status = screen.getAllByRole('status').find((el) => el.getAttribute('data-state'))!;
    expect(status).toHaveAttribute('data-state', 'fresh');
    expect(status.textContent).toContain('Nesil');
  });

  it('yüklenirken iskelet gösterir; döner simge yok', () => {
    renderPage();
    const loading = screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(loading).toBeDefined();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('manifest bozuksa hata durumu "Hata: …" ve "Yeniden dene" sunar; eski tutar gösterilmez', async () => {
    renderPage('desktop', fixtureSource({ 'manifest.json': '{bozuk' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 }).textContent).toMatch(/^Hata: /);
    expect(within(alert).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/₺/)).not.toBeInTheDocument();
  });

  it('nesilde bütçe gözlemi yoksa dürüstçe "Kaynakta bütçe gözlemi kaydı yok" der', async () => {
    renderPage('desktop', withoutBudgetObservations());
    await screen.findByRole('heading', { level: 2, name: 'Kaynakta bütçe gözlemi kaydı yok' }, { timeout: 4000 });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Özet' })).not.toBeInTheDocument();
  });
});

describe('RaporlarPage › Aylık plan ve gerçek', () => {
  it('özet plan ve gerçeği ayrı ölçü olarak verir; tablo + grafik birlikte; fark sözcükle söylenir', async () => {
    renderPage();
    const table = await waitForReport('Aylık plan ve gerçek');

    expect(headerTitles()).toEqual(['Ay', 'Planlanan', 'Gerçekleşen', 'Fark', 'Kayıt']);
    // Varsayılan dönem: verideki son yıl (12 ay).
    expect(bodyRows(table)).toHaveLength(12);
    expect(within(table).getByText(periodLabel(`${LATEST_YEAR}-01`))).toBeInTheDocument();

    const summary = screen.getByRole('list', { name: 'Özet' });
    const items = within(summary).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(items).toHaveLength(3);
    expect(items[0]).toContain('Planlanan');
    expect(items[0]).toContain(TRY.format(sumOf(OBS, 'planned', LATEST_YEAR)));
    expect(items[1]).toContain('Gerçekleşen');
    expect(items[1]).toContain(TRY.format(sumOf(OBS, 'recorded_aggregate', LATEST_YEAR)));
    expect(items[0]).not.toContain(TRY.format(sumOf(OBS, 'recorded_aggregate', LATEST_YEAR)));
    expect(items[2]).toContain('Gözlem');

    expect(screen.getByRole('img', { name: /planlanan ve gerçekleşen/i })).toBeInTheDocument();
    expect(screen.getByText(/Tahminler .*toplanmaz/)).toBeInTheDocument();
    const fark = within(table).getAllByText(/^(Plan üstü|Plan altı|Planda)/);
    expect(fark.length).toBeGreaterThan(0);
  });

  it('Dönem seçimi tabloyu ve özeti daraltır: Tüm dönemler → 24 ay, 2026 → 12 ay', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');

    await user.click(screen.getByRole('combobox', { name: 'Dönem' }));
    await user.click(await screen.findByRole('option', { name: 'Tüm dönemler' }));
    await waitFor(() => expect(bodyRows(screen.getByRole('table', { name: 'Aylık plan ve gerçek' }))).toHaveLength(OBS.length / 8 / 2));
    let summary = screen.getByRole('list', { name: 'Özet' });
    expect(summary.textContent).toContain(TRY.format(sumOf(OBS, 'planned')));

    await user.click(screen.getByRole('combobox', { name: 'Dönem' }));
    await user.click(await screen.findByRole('option', { name: YEARS[0]! }));
    await waitFor(() => expect(bodyRows(screen.getByRole('table', { name: 'Aylık plan ve gerçek' }))).toHaveLength(12));
    summary = screen.getByRole('list', { name: 'Özet' });
    expect(summary.textContent).toContain(TRY.format(sumOf(OBS, 'planned', YEARS[0])));
  });

  it('"Raporu dışa aktar" yalnız görünen satırları CSV olarak istemci tarafında indirir', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:aile-rapor');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toMatch(/^aile-rapor-aylik-plan-ve-gercek-\d{8}\.csv$/);
      expect(this.href).toBe('blob:aile-rapor');
    });
    try {
      renderPage();
      await waitForReport('Aylık plan ve gerçek');
      await user.click(screen.getByRole('button', { name: 'Raporu dışa aktar' }));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0]![0];
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('text/csv;charset=utf-8');
      expect(click).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:aile-rapor');
    } finally {
      click.mockRestore();
    }
  });
});

describe('RaporlarPage › Kaleme göre harcama (pivot)', () => {
  it('ölçü seçici view_definitions pivot ölçülerini sunar; plan ve gerçek ayrı ölçüdür; hücreler kalem × dönem', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    await user.click(screen.getByRole('menuitem', { name: 'Kaleme göre harcama' }));

    const table = await waitForReport('Kaleme göre harcama');
    const headers = headerTitles();
    expect(headers[0]).toBe('Kalem');
    expect(headers).toContain(periodLabel(`${LATEST_YEAR}-01`));
    expect(headers[headers.length - 1]).toBe('Toplam');
    // 8 kalem + genel toplam satırı
    expect(bodyRows(table)).toHaveLength(8 + 1);

    const kalem1 = OBS.filter((o) => o.label === 'Örnek gider satırı 1');
    const planToplam = TRY.format(sumOf(kalem1, 'planned', LATEST_YEAR));
    const gercekToplam = TRY.format(sumOf(kalem1, 'recorded_aggregate', LATEST_YEAR));
    const row1 = within(table).getByRole('row', { name: /Örnek gider satırı 1/ });
    expect(row1.textContent).toContain(planToplam);
    expect(row1.textContent).not.toContain(gercekToplam);

    await user.click(screen.getByRole('combobox', { name: 'Ölçü' }));
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('option', { name: 'Kayıt sayısı' })).toBeInTheDocument();
    expect(within(list).getByRole('option', { name: 'Plan toplamı' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(list).getByRole('option', { name: 'Gerçekleşen toplamı' }));
    await waitFor(() => expect(screen.getByRole('row', { name: /Örnek gider satırı 1/ }).textContent).toContain(gercekToplam));

    expect(screen.getByRole('img', { name: /kalem/i })).toBeInTheDocument();
    expect(screen.getByText(/Tahminler .*toplanmaz/)).toBeInTheDocument();
  });

  it('view_definitions nesilde yoksa pivot gerekçesiyle kullanılamaz', async () => {
    const user = userEvent.setup();
    const manifest: ManifestLike = {
      ...MANIFEST,
      files: MANIFEST.files.filter((file) => file.collection !== 'view_definitions'),
      counts: { ...MANIFEST.counts, view_definitions: 0 },
    };
    renderPage('desktop', fixtureSource({ 'manifest.json': JSON.stringify(manifest) }));
    await waitForReport('Aylık plan ve gerçek');
    await user.click(screen.getByRole('menuitem', { name: 'Kaleme göre harcama' }));
    await screen.findByText(/^Pivot kullanılamaz: /);
    expect(screen.queryByRole('combobox', { name: 'Ölçü' })).not.toBeInTheDocument();
  });
});

describe('RaporlarPage › diğer raporlar', () => {
  it('Borç ödeme planı: payments koleksiyonu nesilde yok, dürüstçe söylenir', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    await user.click(screen.getByRole('menuitem', { name: 'Borç ödeme planı' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Kaynakta ödeme kaydı yok' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Raporu dışa aktar' })).not.toBeInTheDocument();
  });

  it('Oda bazında alımlar: oda satırları plan ve gerçeği ayrı sütunda toplar; odasız alımlar "Bilinmiyor"', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    await user.click(screen.getByRole('menuitem', { name: 'Oda bazında alımlar' }));
    const table = await waitForReport('Oda bazında alımlar');
    expect(headerTitles()).toEqual(['Oda', 'Planlanan', 'Gerçekleşen', 'Alım']);
    expect(bodyRows(table).length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/^(₺|Fiyat yok|Henüz yok)/).length).toBeGreaterThan(0);
  });

  it('Veri güveni özeti: sorun kayıtlarını kod ve önemle sayar', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    await user.click(screen.getByRole('menuitem', { name: 'Veri güveni özeti' }));
    const table = await waitForReport('Veri güveni özeti');
    expect(headerTitles()).toEqual(['Kod', 'Önem', 'Kayıt']);
    const issues = MANIFEST.files
      .filter((file) => file.collection === 'issues')
      .flatMap((file) => (JSON.parse(FILES[file.path]!) as { records: { code: string; severity: string }[] }).records);
    const distinct = new Set(issues.map((issue) => `${issue.code}|${issue.severity}`)).size;
    expect(bodyRows(table)).toHaveLength(distinct);
  });
});

describe('RaporlarPage › telefon', () => {
  it('rapor menüsü yerine "Rapor" seçimi; dışa aktarma başlıkta tek birincil eylem; tablo akordeona iner', async () => {
    renderPage('phone');
    expect(screen.queryByRole('navigation', { name: 'Raporlar' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rapor' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Raporu dışa aktar' })).toBeInTheDocument(), { timeout: 4000 });
    await waitFor(() => expect(screen.getByText(periodLabel(`${LATEST_YEAR}-01`))).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
