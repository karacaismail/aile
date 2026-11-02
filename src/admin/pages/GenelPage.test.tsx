import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangeSet, FixtureGenerationSource, GenerationProvider, createMemoryStorage, type GenerationProviderProps } from '../data';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { GenelPage } from './GenelPage';

// Genel durum sayfası: tasarım README "Sayfa iskeleti" 1–2 (başlık → en çok üç ölçü), components/Overview/README.md
// (dört blok) ve bundle.js Aile.Pages.Genel (desktop/tablet/phone üç biçim; Overview narrow). Veri sentetik nesilden
// (FixtureGenerationSource + GenerationProvider); sayfa ölçüleri forecast_months / forecast_events /
// budget_observations'tan, dikkat isteyenleri purchase_needs / media_references / issues'tan, görevleri work_orders'tan
// türetir. "Bugün" sabitlenir (now) ki ölçüler fixture'a göre deterministik olsun. Seçiciler role/label ile.

// --- ECharts mock: tembel yüklenen çekirdek jsdom'da çizilmez; Chart'ın option'ı setOption ile yakalanır. ----------
const echartsMocks = vi.hoisted(() => {
  const setOption = vi.fn();
  const init = vi.fn(() => ({ setOption, resize: vi.fn(), dispose: vi.fn() }));
  return { setOption, init };
});
vi.mock('echarts/core', () => ({ init: echartsMocks.init, use: vi.fn(), registerTheme: vi.fn() }));
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {} }));
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

// --- Sentetik nesil → bellek -------------------------------------------------------------------------------------
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

/** Fixture'da ödeme penceresine düşen tek olay 08.12.2026'dadır; "bugün" 05.12.2026 seçilir. */
const BUGUN = () => new Date(2026, 11, 5, 10, 0, 0);

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

/** Manifestten bir koleksiyonun bütün parçalarını düşürür: depo koleksiyonu "nesilde yok" sayar (boş, hatasız). */
function manifestWithout(collection: string): string {
  const manifest = JSON.parse(FILES['manifest.json']!) as { files: { collection?: string }[]; counts: Record<string, number> };
  manifest.files = manifest.files.filter(file => file.collection !== collection);
  delete manifest.counts[collection];
  return JSON.stringify(manifest);
}

interface RenderOptions { device?: Device; provider?: Partial<GenerationProviderProps> }

function renderPage({ device = 'desktop', provider = {} }: RenderOptions = {}) {
  const changeSet = () => ChangeSet.load({ storage: createMemoryStorage() });
  const wrap = (children: ReactNode) => (
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={provider.source ?? fixtureSource()} cache={null} changeSet={changeSet} {...provider}>
        {children}
      </GenerationProvider>
    </DeviceContext.Provider>
  );
  return render(wrap(<GenelPage now={BUGUN} />));
}

const region = (name: string | RegExp) => screen.getByRole('region', { name });
const beklenenOzet = async () => {
  const ozet = await screen.findByRole('list', { name: 'Özet' });
  return ozet;
};

afterEach(() => {
  echartsMocks.setOption.mockClear();
});

describe('GenelPage › başlık ve iskelet', () => {
  it('başlık: bölüm "Genel", h1 "Genel durum", amaç cümlesi, tek birincil eylem ve tazelik satırı', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Genel durum' })).toBeInTheDocument();
    expect(screen.getByText('Genel')).toBeInTheDocument();
    expect(screen.getByText('Bu ayın nakdini, yaklaşan ödemeleri ve dikkat isteyen kayıtları tek yerde görün.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aylık rapor' })).toBeInTheDocument();
    // Okunurken "Okunuyor…", hazır olunca "Son okuma … · Nesil <ilk 6>".
    await waitFor(() => expect(screen.getByText(`Nesil ${GENERATION_ID.slice(0, 6)}`)).toBeInTheDocument());
    expect(screen.getByText(/^Son okuma /)).toBeInTheDocument();
  });

  it('yüklenirken iskelet, veri gelince dört blok bölge olarak çizilir (masaüstü: iki sütun)', async () => {
    renderPage();
    expect(screen.getByText('Genel durum okunuyor')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('overview')).toBeInTheDocument());
    expect(screen.getByTestId('overview')).toHaveAttribute('data-layout', 'genis');
    expect(region(/^Yaklaşan ödemeler/)).toBeInTheDocument();
    expect(region(/^Bütçe · Aralık 2026/)).toBeInTheDocument();
    expect(region('Dikkat isteyenler')).toBeInTheDocument();
    expect(region('Bekleyen işler')).toBeInTheDocument();
    expect(region('Aylık plan ve gerçek')).toBeInTheDocument();
    expect(screen.queryByText('Genel durum okunuyor')).not.toBeInTheDocument();
  });

  it('telefonda tek sütun: Overview dar, bütçe tablosu akordeon olur', async () => {
    renderPage({ device: 'phone' });
    await waitFor(() => expect(screen.getByTestId('overview')).toHaveAttribute('data-layout', 'dar'));
    const butce = region(/^Bütçe · Aralık 2026/);
    expect(within(butce).queryByRole('table')).not.toBeInTheDocument();
    expect(within(butce).getAllByRole('button', { expanded: true }).length).toBeGreaterThan(0);
  });
});

describe('GenelPage › ölçüler (plan ve gerçek ayrı, eksik bilgi adıyla)', () => {
  it('üç ölçü: bu ay kalan nakit "tahmin" etiketli, 7 günde ödenecek, geciken; hepsi ₺ biçiminde', async () => {
    renderPage();
    const ozet = await beklenenOzet();
    const items = within(ozet).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // forecast_months 2026-12 closing_balance 300.00 → tahmin.
    expect(items[0]).toHaveTextContent('Bu ay kalan nakit');
    expect(items[0]).toHaveTextContent('₺300,00');
    expect(items[0]).toHaveTextContent(/tahmin/);
    // forecast_events: 08.12.2026, cash_change −15.400 (tek çıkış) → 7 gün içinde ödenecek.
    expect(items[1]).toHaveTextContent('7 gün içinde ödenecek');
    expect(items[1]).toHaveTextContent('₺15.400,00');
    expect(items[1]).toHaveTextContent('1 ödeme');
    // Geciken: 3 kayıt (sehpa 35.400 + masa 27.100 planlı, koltuk fiyatsız) → yalnız plan toplamı, fiyatsız sayısı adıyla.
    expect(items[2]).toHaveTextContent('Geciken');
    expect(items[2]).toHaveTextContent('₺62.500,00');
    expect(items[2]).toHaveTextContent('3 kayıt');
    expect(items[2]).toHaveTextContent('1 fiyatsız');
    expect(items[2]).toHaveTextContent(/plan/);
  });

  it('forecast_months nesilde yoksa kalan nakit "Bilinmiyor" ve nedeni adıyla yazılır', async () => {
    renderPage({ provider: { source: fixtureSource({ 'manifest.json': manifestWithout('forecast_months') }) } });
    const ozet = await beklenenOzet();
    const nakit = within(ozet).getAllByRole('listitem')[0]!;
    expect(nakit).toHaveTextContent('Bilinmiyor');
    expect(nakit).toHaveTextContent('Kaynakta tahmin ayı kaydı yok');
    expect(nakit).not.toHaveTextContent('₺');
  });
});

describe('GenelPage › bloklar', () => {
  it('yaklaşan ödemeler: 7 gün penceresindeki tahmin olayı tarih, ad, tutar ve durum sözcüğüyle; taraf bilinmiyor', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('overview')).toBeInTheDocument());
    const blok = region(/^Yaklaşan ödemeler/);
    const satirlar = within(blok).getAllByRole('listitem');
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0]).toHaveTextContent('08.12.2026');
    expect(satirlar[0]).toHaveTextContent('Örnek tahmin olayı 2');
    expect(satirlar[0]).toHaveTextContent('₺15.400,00');
    expect(satirlar[0]).toHaveTextContent('Planlandı');
    expect(satirlar[0]).toHaveTextContent('Taraf bilinmiyor');
    expect(within(blok).getByRole('link', { name: 'Bütçe ve nakit' })).toHaveAttribute('href', '#/butce');
  });

  it('bütçe tablosu: kalem başına Planlanan, Gerçekleşen ve Kalan ayrı sütunlar; tek sayıda birleşmez', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('overview')).toBeInTheDocument());
    const blok = region(/^Bütçe · Aralık 2026/);
    // antd Table başlık ve gövdeyi ayrı <table> öğelerinde çizebilir; sorgular bloğa göre yapılır.
    expect(within(blok).getByRole('columnheader', { name: 'Planlanan' })).toBeInTheDocument();
    expect(within(blok).getByRole('columnheader', { name: 'Gerçekleşen' })).toBeInTheDocument();
    expect(within(blok).getByRole('columnheader', { name: 'Kalan' })).toBeInTheDocument();
    // 2026-12 "Örnek gider satırı 1": plan 5.500, gerçek 23.700 → kalan −18.200.
    const satir = within(blok).getByRole('row', { name: /Örnek gider satırı 1\b/ });
    expect(satir).toHaveTextContent('₺5.500,00');
    expect(satir).toHaveTextContent('₺23.700,00');
    expect(satir).toHaveTextContent('-₺18.200,00');
    expect(within(blok).getAllByRole('row', { name: /Örnek gider satırı/ })).toHaveLength(8);
    expect(within(blok).getByRole('link', { name: 'Bütçe ve nakit' })).toHaveAttribute('href', '#/butce');
  });

  it('dikkat isteyenler: fiyatsız alım, fotoğrafsız alım, açık sorun, geciken kayıt; sayı + sayfa bağlantısı', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('overview')).toBeInTheDocument());
    const blok = region('Dikkat isteyenler');
    const fiyatsiz = within(blok).getByRole('link', { name: /Fiyatı eksik alım/ });
    expect(fiyatsiz).toHaveTextContent('3');
    expect(fiyatsiz).toHaveAttribute('href', '#/alimlar');
    const fotografsiz = within(blok).getByRole('link', { name: /Doğrulanmış fotoğrafı olmayan alım/ });
    expect(fotografsiz).toHaveTextContent('20');
    const sorun = within(blok).getByRole('link', { name: /Açık sorun/ });
    expect(sorun).toHaveTextContent('10');
    expect(sorun).toHaveAttribute('href', '#/veri');
    const geciken = within(blok).getByRole('link', { name: /Geciken kayıt/ });
    expect(geciken).toHaveTextContent('3');
  });

  it('bekleyen işler: kurulmamış iş emirleri tarih sırasıyla, onay kutusu yerel değişiklik kümesine yazar ve geri alınır', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('overview')).toBeInTheDocument());
    const blok = region('Bekleyen işler');
    const kutular = within(blok).getAllByRole('checkbox');
    expect(kutular).toHaveLength(5);
    expect(kutular[0]).toHaveAccessibleName(/Örnek tadilat işi 4/);
    expect(blok).toHaveTextContent('IS-4');
    expect(blok).toHaveTextContent('03.02.2027');
    expect(within(blok).getByRole('link', { name: 'Projeler ve görevler' })).toHaveAttribute('href', '#/projeler');

    await user.click(kutular[0]!);
    await waitFor(() => expect(kutular[0]).toBeChecked());
    await user.click(kutular[0]!);
    await waitFor(() => expect(kutular[0]).not.toBeChecked());
  });

  it('grafik: aylık plan ve gerçek iki ayrı seri, yanında aynı değerlerin tablosu', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('overview')).toBeInTheDocument());
    const blok = region('Aylık plan ve gerçek');
    const tablo = within(blok).getByRole('table');
    expect(within(tablo).getByRole('columnheader', { name: 'Planlanan' })).toBeInTheDocument();
    expect(within(tablo).getByRole('columnheader', { name: 'Gerçekleşen' })).toBeInTheDocument();
    // 2026-12 toplamı: plan 121.800, gerçek 99.000; altı ay gösterilir.
    const aralik = within(tablo).getByRole('row', { name: /Ara 2026/ });
    expect(aralik).toHaveTextContent('₺121.800,00');
    expect(aralik).toHaveTextContent('₺99.000,00');
    expect(within(tablo).getAllByRole('row')).toHaveLength(1 + 6);
    await waitFor(() => expect(echartsMocks.setOption).toHaveBeenCalled());
    const option = echartsMocks.setOption.mock.calls.at(-1)![0] as { series: { name: string; data: number[] }[] };
    expect(option.series.map(s => s.name)).toEqual(['Planlanan', 'Gerçekleşen']);
    expect(option.series[0]!.data.at(-1)).toBe(121800);
    expect(option.series[1]!.data.at(-1)).toBe(99000);
    expect(within(blok).getByRole('img', { name: /değerler yanındaki tabloda/ })).toBeInTheDocument();
  });
});

describe('GenelPage › veri durumları', () => {
  it('koleksiyon nesilde yoksa blok dürüstçe "Kaynakta … kaydı yok" der', async () => {
    renderPage({ provider: { source: fixtureSource({ 'manifest.json': manifestWithout('forecast_events') }) } });
    await waitFor(() => expect(screen.getByTestId('overview')).toBeInTheDocument());
    expect(within(region(/^Yaklaşan ödemeler/)).getByText('Kaynakta tahmin olayı kaydı yok')).toBeInTheDocument();
  });

  it('pencerede ödeme yoksa kaynak dolu olsa da "Önümüzdeki 7 günde ödeme yok" ve ölçü ₺0,00 · Ödeme yok', async () => {
    const changeSet = () => ChangeSet.load({ storage: createMemoryStorage() });
    render(
      <DeviceContext.Provider value="desktop">
        <GenerationProvider source={fixtureSource()} cache={null} changeSet={changeSet}>
          <GenelPage now={() => new Date(2026, 10, 2, 9, 0, 0)} />
        </GenerationProvider>
      </DeviceContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('overview')).toBeInTheDocument());
    expect(within(region(/^Yaklaşan ödemeler/)).getByText('Önümüzdeki 7 günde ödeme yok')).toBeInTheDocument();
    const odenecek = within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem')[1]!;
    expect(odenecek).toHaveTextContent('₺0,00');
    expect(odenecek).toHaveTextContent('Ödeme yok');
    expect(screen.getByRole('region', { name: /^Bütçe · Kasım 2026/ })).toBeInTheDocument();
  });

  it('bozuk manifest: hata durumu "Hata: …" ile, "Yeniden dene" düğmesi; eski tutar gösterilmez', async () => {
    renderPage({ provider: { source: fixtureSource({ 'manifest.json': '{bozuk' }) } });
    const hata = await screen.findByRole('alert');
    expect(hata).toHaveTextContent(/Hata: /);
    // Tazelik satırı (DataStatus) da "Yeniden dene" sunar; hata bloğununki ayrıca aranır.
    expect(within(hata).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Yeniden dene' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('overview')).not.toBeInTheDocument();
    expect(screen.queryByText(/₺/)).not.toBeInTheDocument();
  });
});
