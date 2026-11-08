// Hesaplar ve borçlar sayfası (RTL, sentetik nesil). Yapı: PageHeader (Para › Hesaplar ve borçlar) → Hesaplar (tek bakiye
// kaynağı forecast_months: dönem seçici + seçili dönemin düz liste satırları, "Tahmin" metniyle) → Borçlar (nesilde
// koleksiyon yok) → geniş profilde lazyWide ile Nakit projeksiyonu (tüm dönemler tablosu + kapanış çizgisi).
// Veri GenerationProvider + FixtureGenerationSource ile gelir; echarts yüklenmez (Chart taklit edilir, option yakalanır).
// "Bugün" sabittir (today prop): 15.03.2027 → varsayılan dönem 2027-03. Seçiciler role/label ile; antd iç sınıfı yok.
// Sıra önemli: telefonda geniş modülün hiç istenmediği test, masaüstü testleri modülü yüklemeden önce koşar.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { wideManifest } from '../adaptive';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { GenerationProvider } from '../data/useGeneration';
import { FixtureGenerationSource } from '../data/sources';
import type { Forecast, ForecastMonth, Manifest } from '../data/types';

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
/** "2027-03" → "03.2027" (tasarım: tarih 28.10.2026, dönem 09.2033). */
const donem = (period: string) => `${period.slice(5, 7)}.${period.slice(0, 4)}`;

const BUGUN = new Date('2027-03-15T09:00:00Z');
const BU_DONEM = '2027-03';
const DIGER = PERIODS[PERIODS.length - 3]!;
const OLCULER = [
  ['opening_balance', 'Açılış bakiyesi'],
  ['planned_outflow', 'Planlanan çıkış'],
  ['closing_balance', 'Kapanış bakiyesi'],
] as const;

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

/** İki tahminli nesil: ikinci tahmin ("Kötümser") her dönemi farklı tutarla taşır; parça hash'leri yeniden yazılır. */
const IKINCI = { id: '00000000-0000-5000-8000-0000000000f2', label: 'Kötümser' };
const KOTUMSER_KAPANIS = '1234.56';
function withTwoForecasts(): FixtureGenerationSource {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const overrides: Record<string, string> = {};
  const files = MANIFEST.files.map(file => {
    if (file.kind !== 'partition' || (file.collection !== 'forecasts' && file.collection !== 'forecast_months')) return file;
    const envelope = JSON.parse(FILES[file.path]!) as { records: (Forecast | ForecastMonth)[] };
    const extra = file.collection === 'forecasts'
      ? envelope.records.map(record => ({ ...record, id: IKINCI.id, label: IKINCI.label }))
      : envelope.records.map((record, index) => ({
          ...record,
          id: `00000000-0000-5000-8000-${String(index).padStart(12, '0')}`,
          forecast_id: IKINCI.id,
          measures: { ...(record.measures as object), closing_balance: { amount: KOTUMSER_KAPANIS, currency: 'TRY' } },
        }));
    const text = JSON.stringify({ ...envelope, records: [...envelope.records, ...extra] });
    overrides[file.path] = text;
    return { ...file, sha256: sha(text), bytes: Buffer.byteLength(text), count: (file.count ?? 0) + extra.length };
  });
  const counts = { ...MANIFEST.counts, forecasts: MANIFEST.counts.forecasts! * 2, forecast_months: MANIFEST.counts.forecast_months! * 2 };
  return fixtureSource({ ...overrides, 'manifest.json': JSON.stringify({ ...MANIFEST, files, counts }) });
}

/** Yenilemede manifesti okuyamayan kaynak: ilk okuma başarılı, sonra "kesinti" (stale). */
class KesintiliKaynak extends FixtureGenerationSource {
  kesik = false;
  override async readText(path: string): Promise<string> {
    if (this.kesik) throw new Error('sentetik kesinti');
    return super.readText(path);
  }
}

function renderPage(device: Device = 'desktop', source: FixtureGenerationSource = fixtureSource()) {
  chartMock.options.length = 0;
  return render(
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={source} cache={null} changeSet={null}>
        <HesaplarPage location="/hesaplar" today={BUGUN} />
      </GenerationProvider>
    </DeviceContext.Provider>,
  );
}

const hesaplarBolumu = () => screen.getByRole('region', { name: 'Hesaplar' });
const listeAdi = (period: string) => `${donem(period)} dönemi bakiye tahmini`;
async function bakiyeListesi(period: string) {
  return within(hesaplarBolumu()).findByRole('list', { name: listeAdi(period) });
}

/** Düz liste satırları: üç ölçü, her biri "Tahmin" metni ve fixture tutarıyla. */
async function bakiyelerGorunur(period: string) {
  const liste = await bakiyeListesi(period);
  const satirlar = within(liste).getAllByRole('listitem');
  expect(satirlar).toHaveLength(OLCULER.length);
  OLCULER.forEach(([key, ad], index) => {
    expect(satirlar[index]).toHaveTextContent(ad);
    expect(satirlar[index]).toHaveTextContent('Tahmin');
    expect(satirlar[index]).toHaveTextContent(para(amountOf(period, key)));
  });
  return liste;
}

describe('HesaplarPage › telefon (temel sunum)', () => {
  it('geniş modül telefonda hiç istenmez: tablo, grafik ve projeksiyon bölümü yok', async () => {
    renderPage('phone');
    await bakiyelerGorunur(BU_DONEM);
    expect(screen.queryByRole('region', { name: 'Nakit projeksiyonu' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByTestId('chart')).toBeNull();
    expect(wideManifest().find(entry => entry.key === 'hesaplar-projeksiyon')?.status).toBe('idle');
  });

  it('Hesaplar: bakiye tek kaynaktan (tahmin), toplanmadığı yazılır; seçili dönemin ölçüleri düz liste satırı', async () => {
    renderPage('phone');
    await bakiyelerGorunur(BU_DONEM);
    const bolum = hesaplarBolumu();
    expect(within(bolum).getByRole('heading', { level: 2, name: 'Hesaplar' })).toBeInTheDocument();
    expect(bolum).toHaveTextContent(/nakit tahmini/i);
    expect(bolum).toHaveTextContent(/toplanmaz/);
    expect(bolum).toHaveTextContent(`${donem(BU_DONEM)} · Bu ay · tahmin`);
    expect(bolum).toHaveTextContent('Kaynakta hesap kaydı yok');
    // Kart değil düz satır: satır içinde düğme/bağlantı yok, liste dışında ızgara yok.
    const liste = await bakiyeListesi(BU_DONEM);
    expect(within(liste).queryAllByRole('button')).toHaveLength(0);
    expect(within(liste).queryAllByRole('link')).toHaveLength(0);
  });

  it('dönem seçimi alt sayfada: "Dönem" seçicisi alttan açılır, seçilen dönemin bakiyeleri gelir', async () => {
    const user = userEvent.setup();
    renderPage('phone');
    await bakiyelerGorunur(BU_DONEM);
    await user.click(screen.getByLabelText('Dönem'));
    const sayfa = await screen.findByRole('dialog', { name: 'Dönem' });
    await user.click(within(sayfa).getByRole('option', { name: donem(DIGER) }));
    await bakiyelerGorunur(DIGER);
    expect(within(hesaplarBolumu()).queryByRole('list', { name: listeAdi(BU_DONEM) })).toBeNull();
  });

  it('başlıkta birincil "Hesap ekle" + "Diğer"; "Borç ekle" telefonda menüdedir', async () => {
    renderPage('phone');
    await bakiyelerGorunur(BU_DONEM);
    expect(screen.getByRole('button', { name: 'Hesap ekle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diğer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Borç ekle' })).toBeNull();
  });
});

describe('HesaplarPage › başlık', () => {
  it('bölüm, h1 (menü adı), amaç cümlesi ve tazelik satırı nesilden gelir', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Hesaplar ve borçlar' })).toBeInTheDocument();
    expect(screen.getByText('Para')).toBeInTheDocument();
    expect(screen.getByText('Hesap bakiyelerini ve kalan borçları, taksit planıyla birlikte görün.')).toBeInTheDocument();
    await bakiyelerGorunur(BU_DONEM);
    const durum = screen.getAllByRole('status').find(node => node.textContent?.includes('Nesil'))!;
    expect(durum).toHaveTextContent(`Nesil ${GENERATION_ID.slice(0, 6)}`);
    expect(within(durum).getByRole('button', { name: 'Yenile' })).toBeInTheDocument();
  });

  it('özet en çok üç ölçü; hesap ve borç toplamı uydurulmaz; kapanış bakiyesi bu ayın tahmini, toplam değil', async () => {
    renderPage();
    await bakiyelerGorunur(BU_DONEM);
    const olculer = within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem');
    expect(olculer).toHaveLength(3);
    expect(olculer[0]).toHaveTextContent('Hesaplardaki toplam');
    expect(olculer[0]).toHaveTextContent('Kaynakta kayıt yok');
    expect(olculer[1]).toHaveTextContent('Kalan borç');
    expect(olculer[1]).toHaveTextContent('Kaynakta kayıt yok');
    expect(olculer[2]).toHaveTextContent('Kapanış bakiyesi (tahmin)');
    expect(olculer[2]).toHaveTextContent(para(amountOf(BU_DONEM, 'closing_balance')));
    expect(olculer[2]).toHaveTextContent(`${donem(BU_DONEM)} · tahmin, gerçek değil`);
    const toplam = MONTHS.reduce((sum, month) => sum + Number(amountOf(month.period!, 'closing_balance')), 0);
    expect(document.body).not.toHaveTextContent(para(toplam.toFixed(2)));
  });

  it('tek birincil eylem "Hesap ekle"; geniş profilde "Borç ekle" ikincil; ikisi de kaynakta koleksiyon olmadığını açıklar', async () => {
    const user = userEvent.setup();
    renderPage();
    await bakiyelerGorunur(BU_DONEM);
    await user.click(screen.getByRole('button', { name: 'Borç ekle' }));
    const borc = await screen.findByRole('dialog', { name: 'Borç ekle' });
    expect(borc).toHaveTextContent(/Kaynakta borç koleksiyonu yok/);
    await user.click(within(borc).getByRole('button', { name: 'Kapat' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Borç ekle' })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Hesap ekle' }));
    const hesap = await screen.findByRole('dialog', { name: 'Hesap ekle' });
    expect(hesap).toHaveTextContent(/Kaynakta hesap koleksiyonu yok/);
    expect(hesap).toHaveTextContent(/e-tabloya yazma bu sürümde yok/i);
  });
});

describe('HesaplarPage › borçlar', () => {
  it('nesilde borç koleksiyonu yok: bölüm bunu adıyla söyler, tutar uydurulmaz', async () => {
    renderPage();
    await bakiyelerGorunur(BU_DONEM);
    const borclar = screen.getByRole('region', { name: 'Borçlar' });
    expect(within(borclar).getByRole('heading', { level: 2, name: 'Borçlar' })).toBeInTheDocument();
    expect(borclar).toHaveTextContent('Kaynakta borç kaydı yok');
    expect(within(borclar).queryByText(/₺/)).toBeNull();
  });
});

describe('HesaplarPage › nakit projeksiyonu (geniş modül)', () => {
  it('dönem anahtarlı tablo: dönemler artan, ölçüler ayrı sütun, para ₺ tr-TR, toplam satırı yok', async () => {
    renderPage();
    const bolge = await screen.findByRole('region', { name: 'Nakit projeksiyonu' });
    expect(bolge).toHaveTextContent(/tahmin/);
    const tablo = within(bolge).getByRole('table', { name: 'Nakit projeksiyonu (tahmin)' });
    const basliklar = within(bolge).getAllByRole('columnheader').map(th => th.textContent);
    expect(basliklar).toEqual(['Dönem', 'Açılış bakiyesi', 'Planlanan çıkış', 'Kapanış bakiyesi']);
    const satirlar = within(tablo).getAllByRole('row').filter(row => within(row).queryAllByRole('cell').length > 0);
    expect(satirlar).toHaveLength(PERIODS.length);
    expect(satirlar[0]).toHaveTextContent(donem(PERIODS[0]!));
    expect(satirlar[0]).toHaveTextContent(para(amountOf(PERIODS[0]!, 'closing_balance')));
    expect(satirlar.at(-1)).toHaveTextContent(donem(PERIODS.at(-1)!));
    expect(within(bolge).queryByText(/Toplam/)).toBeNull();
    expect(within(bolge).getByText(`${PERIODS.length} dönem · tahmin`)).toBeInTheDocument();
  });

  it('kapanış çizgisi: tek line serisi, yığılmaz, dönem sırasında; grafik tabloyla açıklanır', async () => {
    renderPage();
    const bolge = await screen.findByRole('region', { name: 'Nakit projeksiyonu' });
    expect(within(bolge).getByRole('img', { name: /kapanış bakiyesi.*değerler/i })).toBeInTheDocument();
    const option = chartMock.options.at(-1)!;
    const seriler = option.series as { type: string; name: string; stack?: string; data: number[] }[];
    expect(seriler).toHaveLength(1);
    expect(seriler[0]!.type).toBe('line');
    expect(seriler[0]!.name).toMatch(/Kapanış bakiyesi/);
    expect(seriler[0]!.stack).toBeUndefined();
    expect(seriler[0]!.data).toEqual(PERIODS.map(period => Number(amountOf(period, 'closing_balance'))));
    expect((option.xAxis as { data: string[] }).data).toEqual(PERIODS.map(donem));
  });

  it('tablo satırı dönemi seçer: Hesaplar listesi o dönemin bakiyelerine geçer', async () => {
    const user = userEvent.setup();
    renderPage();
    const bolge = await screen.findByRole('region', { name: 'Nakit projeksiyonu' });
    const satir = within(bolge).getAllByRole('row').find(row => row.textContent?.includes(donem(DIGER)) && within(row).queryAllByRole('cell').length > 0)!;
    await user.click(satir);
    await bakiyelerGorunur(DIGER);
  });
});

describe('HesaplarPage › tahminler toplanmaz', () => {
  it('iki tahmin: dönem bakiyeleri tahmin başına ayrı liste; özet tahmin sayısını söyler, toplamı göstermez', async () => {
    renderPage('phone', withTwoForecasts());
    const bolum = await waitFor(() => hesaplarBolumu());
    await waitFor(() => expect(within(bolum).getAllByRole('list')).toHaveLength(2));
    const kotumser = within(bolum).getByRole('list', { name: `${listeAdi(BU_DONEM)} · ${IKINCI.label}` });
    expect(kotumser).toHaveTextContent(para(KOTUMSER_KAPANIS));
    const ozet = within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem')[2]!;
    expect(ozet).toHaveTextContent('2 tahmin');
    expect(ozet).toHaveTextContent('bakiyeler toplanmaz');
    const toplam = (Number(amountOf(BU_DONEM, 'closing_balance')) + Number(KOTUMSER_KAPANIS)).toFixed(2);
    expect(document.body).not.toHaveTextContent(para(toplam));
  });
});

describe('HesaplarPage › veri durumları', () => {
  it('yükleniyor: Hesaplar bölümünde iskelet (aria-busy, döner simge yok); veri gelince kalkar; özet "Yükleniyor"', async () => {
    renderPage('phone');
    const yukleniyor = within(hesaplarBolumu()).getByText('Yükleniyor');
    expect(yukleniyor.closest('[role="status"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem')[2]).toHaveTextContent('Yükleniyor');
    await bakiyelerGorunur(BU_DONEM);
    expect(within(hesaplarBolumu()).queryByText('Yükleniyor')).toBeNull();
  });

  it('boş: forecast_months yoksa "Kaynakta tahmin dönemi kaydı yok"; dönem seçici ve liste yok; özet "Henüz yok"', async () => {
    renderPage('phone', withoutMonths());
    await waitFor(() => expect(hesaplarBolumu()).toHaveTextContent('Kaynakta tahmin dönemi kaydı yok'));
    expect(screen.queryByLabelText('Dönem')).toBeNull();
    expect(within(hesaplarBolumu()).queryByRole('list')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem')[2]).toHaveTextContent('Henüz yok');
  });

  it('hata: parça okunamazsa Hesaplar bölümünde "Hata: …" + "Yeniden dene"; tutar yok; özet "Bilinmiyor"', async () => {
    renderPage('phone', fixtureSource(Object.fromEntries(MONTH_FILES.map(file => [file.path, null]))));
    const hata = await within(hesaplarBolumu()).findByRole('alert');
    expect(hata).toHaveTextContent(/^Hata: /);
    expect(within(hata).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(hesaplarBolumu()).not.toHaveTextContent('₺');
    expect(hesaplarBolumu()).not.toHaveTextContent('Eski veri');
    expect(within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem')[2]).toHaveTextContent('Bilinmiyor');
  });

  it('nesil okunamazsa sayfa düzeyinde tek hata; hesap/borç yokluğu iddia edilmez, tutar yok', async () => {
    renderPage('phone', fixtureSource({ 'manifest.json': '{bozuk' }));
    const hata = await screen.findByRole('alert');
    expect(hata).toHaveTextContent(/^Hata: /);
    expect(within(hata).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Hesaplar' })).toBeNull();
    expect(screen.queryByText('Kaynakta borç kaydı yok')).toBeNull();
    expect(screen.queryByText(/₺/)).toBeNull();
  });

  it('eski veri: yenileme başarısızsa son başarılı tahmin kalır ve "Eski veri" diye adlandırılır', async () => {
    const user = userEvent.setup();
    const kaynak = new KesintiliKaynak(FILES, 'sentetik');
    renderPage('phone', kaynak);
    await bakiyelerGorunur(BU_DONEM);
    kaynak.kesik = true;
    const durum = screen.getAllByRole('status').find(node => node.textContent?.includes('Nesil'))!;
    await user.click(within(durum).getByRole('button', { name: 'Yenile' }));
    await waitFor(() => expect(hesaplarBolumu()).toHaveTextContent(/Eski veri/));
    // Not canlı durum bölgesidir (role=status): duyurulur ve kaydın kendisi sayılmaz; içerik (liste, tutarlar) aynen kalır.
    const not = within(hesaplarBolumu()).getByText(/^Eski veri/);
    expect(not.closest('[role="status"]')).not.toBeNull();
    await bakiyelerGorunur(BU_DONEM);
  });
});
