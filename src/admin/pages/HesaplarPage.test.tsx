// Hesaplar ve borçlar sayfası: PageHeader (Para › Hesaplar ve borçlar) → Hesaplar / Borçlar bölümleri (nesilde koleksiyon
// yok → "Kaynakta … kaydı yok") → Nakit projeksiyonu (forecast_months, dönem anahtarlı tablo + bakiye çizgisi). Veri
// sentetik fixture'dan GenerationProvider + FixtureGenerationSource ile gelir; echarts yüklenmez, Chart sarmalayıcısı
// sözleşmesiyle taklit edilir (option yakalanır). Seçiciler role/label ile; antd iç sınıfı yok.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { GenerationProvider } from '../data/useGeneration';
import { FixtureGenerationSource } from '../data/sources';
import type { ForecastMonth, Manifest } from '../data/types';

/** Sayfanın Chart'a verdiği option'ın sınanan kısmı; ham 'echarts' importu test dosyasında da yok. */
interface ChartOption { xAxis?: unknown; series?: unknown }
const chartMock = vi.hoisted(() => ({ options: [] as ChartOption[] }));
vi.mock('../ui/Chart', () => ({
  Chart: (p: { option: ChartOption; ariaLabel: string; description: ReactNode }) => {
    chartMock.options.push(p.option);
    return (
      <div data-testid="chart">
        <div role="img" aria-label={p.ariaLabel} />
        <div>{p.description}</div>
      </div>
    );
  },
  chartSeriesColors: { plan: '#A6BED0', gercek: '#326B94', olumlu: '#316653', uyari: '#805C22', hata: '#9F4E48', notr: '#52697C' },
}));

import { HesaplarPage } from './HesaplarPage';

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
const MONTH_FILES = MANIFEST.files.filter(file => file.kind === 'partition' && file.collection === 'forecast_months');
const MONTHS: ForecastMonth[] = MONTH_FILES.flatMap(file => (JSON.parse(FILES[file.path]!) as { records: ForecastMonth[] }).records);
const PERIODS = [...new Set(MONTHS.map(month => month.period!))].sort();
const monthOf = (period: string) => MONTHS.find(month => month.period === period)!;
const amountOf = (period: string, measure: string) => (monthOf(period).measures as Record<string, { amount: string }>)[measure]!.amount;
const tl = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const para = (decimal: string) => tl.format(decimal as `${number}`);
/** "2026-11" → "11.2026" (tasarım: tarih 28.10.2026, dönem 09.2033). */
const donem = (period: string) => `${period.slice(5, 7)}.${period.slice(0, 4)}`;

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

/** forecast_months parçaları manifestten çıkarılmış nesil: koleksiyon var ama kayıt yok. */
function withoutMonths(): FixtureGenerationSource {
  const manifest: Manifest = {
    ...MANIFEST,
    files: MANIFEST.files.filter(file => file.collection !== 'forecast_months'),
    counts: { ...MANIFEST.counts, forecast_months: 0 },
  };
  return fixtureSource({ 'manifest.json': JSON.stringify(manifest) });
}

function renderPage(device: Device = 'desktop', source: FixtureGenerationSource = fixtureSource()) {
  chartMock.options.length = 0;
  return render(
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={source} cache={null} changeSet={null}>
        <HesaplarPage location="/hesaplar" />
      </GenerationProvider>
    </DeviceContext.Provider>,
  );
}

async function hazir() {
  await waitFor(() => expect(screen.getByRole('table', { name: /Nakit projeksiyonu/ })).toBeInTheDocument());
}

const TABLO_ADI = 'Nakit projeksiyonu (forecast)';
const FORECAST_NOTU = 'Bu forecast; gerçek banka hesabı kaydı değil.';

describe('HesaplarPage › başlık', () => {
  it('bölüm, h1 (menü adı), amaç cümlesi ve tazelik satırı nesilden gelir', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Hesaplar ve borçlar' })).toBeInTheDocument();
    expect(screen.getByText('Para')).toBeInTheDocument();
    expect(screen.getByText('Hesap bakiyelerini ve kalan borçları, taksit planıyla birlikte görün.')).toBeInTheDocument();
    await hazir();
    const durum = screen.getAllByRole('status').find(node => node.textContent?.includes('Nesil'))!;
    expect(durum).toHaveTextContent(`Nesil ${GENERATION_ID.slice(0, 6)}`);
    expect(durum).toHaveTextContent(/Son okuma/);
    expect(within(durum).getByRole('button', { name: 'Yenile' })).toBeInTheDocument();
  });

  it('özet en çok üç ölçüdür; hesap ve borç toplamı uydurulmaz, forecast kapanışı tahmin diye adlandırılır', async () => {
    renderPage();
    await hazir();
    const ozet = screen.getByRole('list', { name: 'Özet' });
    const olculer = within(ozet).getAllByRole('listitem');
    expect(olculer).toHaveLength(3);
    expect(olculer[0]).toHaveTextContent('Hesaplardaki toplam');
    expect(olculer[0]).toHaveTextContent('Kaynakta kayıt yok');
    expect(olculer[1]).toHaveTextContent('Kalan borç');
    expect(olculer[1]).toHaveTextContent('Kaynakta kayıt yok');
    const son = PERIODS.at(-1)!;
    expect(olculer[2]).toHaveTextContent('Kapanış bakiyesi (forecast)');
    expect(olculer[2]).toHaveTextContent(para(amountOf(son, 'closing_balance')));
    expect(olculer[2]).toHaveTextContent(donem(son));
    expect(olculer[2]).toHaveTextContent(/tahmin/);
  });

  it('tek birincil eylem "Hesap ekle"; masaüstünde "Borç ekle" ikincil; ikisi de kaynakta koleksiyon olmadığını açıklar', async () => {
    const user = userEvent.setup();
    renderPage();
    await hazir();
    const birincil = screen.getByRole('button', { name: 'Hesap ekle' });
    expect(screen.getByRole('button', { name: 'Borç ekle' })).toBeInTheDocument();
    await user.click(birincil);
    const dialog = await screen.findByRole('dialog', { name: 'Hesap ekle' });
    expect(dialog).toHaveTextContent(/Kaynakta hesap koleksiyonu yok/);
    expect(dialog).toHaveTextContent(/e-tabloya yazma bu sürümde yok/i);
  });
});

describe('HesaplarPage › hesaplar ve borçlar', () => {
  it('nesilde hesap ve borç koleksiyonu yok: iki bölüm de bunu adıyla söyler, tutar uydurulmaz', async () => {
    renderPage();
    await hazir();
    const hesaplar = screen.getByRole('region', { name: 'Hesaplar' });
    expect(within(hesaplar).getByRole('heading', { level: 2, name: 'Hesaplar' })).toBeInTheDocument();
    expect(hesaplar).toHaveTextContent('Kaynakta hesap kaydı yok');
    const borclar = screen.getByRole('region', { name: 'Borçlar' });
    expect(within(borclar).getByRole('heading', { level: 2, name: 'Borçlar' })).toBeInTheDocument();
    expect(borclar).toHaveTextContent('Kaynakta borç kaydı yok');
    expect(within(hesaplar).queryByText(/₺/)).toBeNull();
    expect(within(borclar).queryByText(/₺/)).toBeNull();
  });
});

describe('HesaplarPage › nakit projeksiyonu (forecast)', () => {
  it('dönem anahtarlı tablo: dönemler artan sırada, ölçüler ayrı sütun, para ₺ tr-TR, toplam satırı yok', async () => {
    renderPage();
    await hazir();
    expect(screen.getByText(FORECAST_NOTU)).toBeInTheDocument();
    // Yapışkan başlıkta antd başlık ve gövdeyi ayrı tablolara çizer: başlıklar bölge içinde, veri satırları hücresi olanlar.
    const bolge = screen.getByRole('region', { name: 'Nakit projeksiyonu' });
    const tablo = within(bolge).getByRole('table', { name: TABLO_ADI });
    const basliklar = within(bolge).getAllByRole('columnheader').map(th => th.textContent);
    expect(basliklar).toEqual(['Dönem', 'Açılış bakiyesi', 'Planlanan çıkış', 'Kapanış bakiyesi']);
    const satirlar = within(tablo).getAllByRole('row').filter(row => within(row).queryAllByRole('cell').length > 0);
    expect(satirlar).toHaveLength(PERIODS.length);
    expect(satirlar[0]).toHaveTextContent(donem(PERIODS[0]!));
    expect(satirlar[0]).toHaveTextContent(para(amountOf(PERIODS[0]!, 'opening_balance')));
    expect(satirlar[0]).toHaveTextContent(para(amountOf(PERIODS[0]!, 'planned_outflow')));
    expect(satirlar[0]).toHaveTextContent(para(amountOf(PERIODS[0]!, 'closing_balance')));
    expect(satirlar.at(-1)).toHaveTextContent(donem(PERIODS.at(-1)!));
    expect(within(tablo).queryByText(/Toplam/)).toBeNull();
    expect(screen.getByText(`${PERIODS.length} dönem`)).toBeInTheDocument();
  });

  it('bakiye çizgisi: yalnız kapanış bakiyesi, tek line serisi, yığılmaz, dönem sırasında; grafik tabloyla açıklanır', async () => {
    renderPage();
    await hazir();
    expect(screen.getByRole('img', { name: /kapanış bakiyesi.*değerler/i })).toBeInTheDocument();
    const option = chartMock.options.at(-1)!;
    const seriler = option.series as { type: string; name: string; stack?: string; data: number[] }[];
    expect(seriler).toHaveLength(1);
    expect(seriler[0]!.type).toBe('line');
    expect(seriler[0]!.name).toMatch(/Kapanış bakiyesi/);
    expect(seriler[0]!.stack).toBeUndefined();
    expect(seriler[0]!.data).toEqual(PERIODS.map(period => Number(amountOf(period, 'closing_balance'))));
    expect((option.xAxis as { data: string[] }).data).toEqual(PERIODS.map(donem));
  });

  it('forecast_months boşsa dürüst metin: "Kaynakta forecast dönemi kaydı yok"; grafik çizilmez', async () => {
    renderPage('desktop', withoutMonths());
    await waitFor(() => expect(screen.getByText('Kaynakta forecast dönemi kaydı yok')).toBeInTheDocument());
    expect(screen.queryByRole('table', { name: TABLO_ADI })).toBeNull();
    expect(screen.queryByTestId('chart')).toBeNull();
    const ozet = screen.getByRole('list', { name: 'Özet' });
    expect(within(ozet).getAllByRole('listitem')[2]).toHaveTextContent('Henüz yok');
  });

  it('parça okunamazsa bölümde "Hata: …" ve "Yeniden dene"; tutar gösterilmez', async () => {
    const source = fixtureSource(Object.fromEntries(MONTH_FILES.map(file => [file.path, null])));
    renderPage('desktop', source);
    const hata = await screen.findByRole('alert');
    expect(hata).toHaveTextContent(/^Hata: /);
    expect(within(hata).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: TABLO_ADI })).toBeNull();
    expect(screen.queryByText(/₺/)).toBeNull();
  });
});

describe('HesaplarPage › durumlar ve cihaz', () => {
  it('okunurken LoadingShell (döner simge yok), veri gelince kalkar', async () => {
    renderPage();
    const yukleniyor = screen.getByText('Yükleniyor');
    expect(yukleniyor.closest('[role="status"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('progressbar')).toBeNull();
    await hazir();
    expect(screen.queryByText('Yükleniyor')).toBeNull();
  });

  it('manifest bozuksa sayfa ErrorState gösterir: "Hata:" + "Yeniden dene", veri yok', async () => {
    renderPage('desktop', fixtureSource({ 'manifest.json': '{bozuk' }));
    const hata = await screen.findByRole('alert');
    expect(hata).toHaveTextContent(/^Hata: /);
    expect(within(hata).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.queryByText(/₺/)).toBeNull();
  });

  it('telefonda tablo yerine akordeon liste; başlıkta birincil + "Diğer"', async () => {
    renderPage('phone');
    await waitFor(() => expect(screen.getByRole('region', { name: TABLO_ADI })).toBeInTheDocument());
    expect(screen.queryByRole('table')).toBeNull();
    const liste = screen.getByRole('region', { name: TABLO_ADI });
    expect(within(liste).getAllByRole('listitem').length).toBeGreaterThanOrEqual(PERIODS.length);
    expect(liste).toHaveTextContent(donem(PERIODS[0]!));
    expect(screen.getByRole('button', { name: 'Hesap ekle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diğer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Borç ekle' })).toBeNull();
  });
});
