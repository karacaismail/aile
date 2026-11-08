import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { wideManifest } from '../adaptive';
import {
  ChangeSet,
  FixtureGenerationSource,
  GenerationProvider,
  MIRRORS_PLAN_NOTE,
  RECORDED_IN_SOURCE_TEXT,
  TOTAL_UNAVAILABLE_TEXT,
  createMemoryStorage,
  type GenerationProviderProps,
  type GenerationSource,
} from '../data';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { GenelPage } from './GenelPage';

// Genel durum sayfası: tasarım README "Sayfa iskeleti" 1–2 (başlık → en çok üç ölçü), components/Overview/README.md
// (dört blok), bundle.js Aile.Pages.Genel ve W0 uyarlamalı teslim sözleşmesi:
//  - Telefon (temel sunum, yerel HTML): özet ölçüler, yaklaşan ödemeler (7 gün) ve dikkat isteyenler önce; bütçe tablosu
//    akordeon (ilk satır açık); bekleyen işler yerel onay kutusu; aylık blok ay akordeonu. Geniş modül (GenelPage.wide:
//    Overview) telefonda indirilmez.
//  - Geniş (tablet/masaüstü): lazyWide ile Overview + aylık tablo.
//  - Aylık plan ve gerçek: nesilde satır düzeyinde yaprak sahipliği haritası yok (views.sumUnavailableReason); ayın
//    satırları (gelir, "… toplamı", "Toplam …", adet satırları olabilir) tek sayıda toplanmaz: "Toplam kullanılamaz",
//    nedeni yazılı; kayıtlar ayrı sayılır. Çizilecek tutar olmadığından grafik ve ECharts yok.
//  - Gerçekleşen anlamı yalnız data/actuals.ts'ten: gelecek ay "Henüz yok", kanıtsız değer "Kaynakta yazılı" (yüzde ve
//    "harcandı" yok), unclassified/silinmiş gözlem hiçbir sayıya girmez, tutarlar kesin ondalık, dönem Europe/Istanbul,
//    plan aynası notu. Plan ve gerçek tek sayıda birleşmez.
// Veri yalnız sentetik nesilden (FixtureGenerationSource + GenerationProvider); gerektiğinde bütçe parçası testte
// düzenlenir ve manifest hash'i yeniden hesaplanır (bütünlük doğrulaması atlanmaz). "Bugün" now ile sabitlenir.

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

interface ManifestShape { files: { path: string; kind?: string; collection?: string; sha256: string; bytes?: number; count?: number }[]; counts: Record<string, number> }

/** Manifestten bir koleksiyonun bütün parçalarını düşürür: depo koleksiyonu "nesilde yok" sayar (boş, hatasız). */
function manifestWithout(collection: string): string {
  const manifest = JSON.parse(FILES['manifest.json']!) as ManifestShape;
  manifest.files = manifest.files.filter(file => file.collection !== collection);
  delete manifest.counts[collection];
  return JSON.stringify(manifest);
}

/** Geçerli ama kayıtsız nesil (yeni kurulan hane): hiçbir parça yok, bütün sayımlar sıfır (f05 'boş' durumu). */
function manifestEmpty(): string {
  const manifest = JSON.parse(FILES['manifest.json']!) as ManifestShape;
  manifest.files = manifest.files.filter(file => file.kind !== 'partition');
  manifest.counts = Object.fromEntries(Object.keys(manifest.counts).map(name => [name, 0]));
  return JSON.stringify(manifest);
}

// --- Bütçe parçası düzenleme (manifest hash'i yeniden hesaplanır) -------------------------------------------------
type Obs = { id: string; label: string; period: string; basis: string; payment_evidence: boolean; deleted_at?: string | null; value: { decimal: string | null; currency: string | null }; provenance?: unknown; [key: string]: unknown };
const BUDGET_PARTS = Object.keys(FILES).filter(path => path.startsWith('data/budget_observations/')).sort();
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Bütçe gözlemlerini düzenler: edit tüm kayıtları alır, yeni listeyi döner; sonuç ilk parçaya yazılır, diğerleri boşalır. */
function withBudget(edit: (records: Obs[]) => Obs[]): Record<string, string> {
  const envelopes = BUDGET_PARTS.map(path => JSON.parse(FILES[path]!) as { records: Obs[] });
  const next = edit(envelopes.flatMap(envelope => envelope.records));
  const manifest = JSON.parse(FILES['manifest.json']!) as ManifestShape;
  const out: Record<string, string> = {};
  BUDGET_PARTS.forEach((path, index) => {
    const text = JSON.stringify({ ...envelopes[index], records: index === 0 ? next : [] });
    out[path] = text;
    const entry = manifest.files.find(file => file.path === path)!;
    entry.sha256 = sha256(text);
    entry.bytes = Buffer.byteLength(text);
    entry.count = index === 0 ? next.length : 0;
  });
  manifest.counts.budget_observations = next.length;
  out['manifest.json'] = JSON.stringify(manifest);
  return out;
}

let uuidSayac = 0;
/** Sözleşmeye uygun (RFC 4122 v4 biçimli) sentetik kimlik. */
const yeniKimlik = () => `00000000-0000-4000-8000-${(++uuidSayac).toString(16).padStart(12, '0')}`;
function gozlem(sablon: Obs, alanlar: Partial<Obs>): Obs {
  return { ...sablon, id: yeniKimlik(), deleted_at: null, ...alanlar };
}

interface RenderOptions { device?: Device; provider?: Partial<GenerationProviderProps>; now?: () => Date }

function renderPage({ device = 'desktop', provider = {}, now = BUGUN }: RenderOptions = {}) {
  const changeSet = () => ChangeSet.load({ storage: createMemoryStorage() });
  const wrap = (children: ReactNode) => (
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={provider.source ?? fixtureSource()} cache={null} changeSet={changeSet} {...provider}>
        {children}
      </GenerationProvider>
    </DeviceContext.Provider>
  );
  return render(wrap(<GenelPage now={now} />));
}

const region = (name: string | RegExp) => screen.getByRole('region', { name });
const beklenenOzet = () => screen.findByRole('list', { name: 'Özet' });
/** Veri çizildi: bütçe bloğu (telefon ve geniş sunumda aynı ad) görünür. Davranışa bağlı; sınıf/test kimliğine değil. */
const telefonHazir = () => screen.findByRole('region', { name: /^Bütçe · / }, { timeout: 5000 });
/** Geniş modül (lazyWide) yüklendi ve Overview çizildi. */
const genisHazir = () => screen.findByTestId('overview', {}, { timeout: 5000 });
/** Akordeon satırı: başlık düğmesinin ait olduğu liste öğesi. */
const akordeonSatiri = (kok: HTMLElement, ad: RegExp) => within(kok).getByRole('button', { name: ad }).closest('li') as HTMLElement;
const bolgeSirasi = () => screen.getAllByRole('region').map(bolge => bolge.getAttribute('aria-labelledby') ? (document.getElementById(bolge.getAttribute('aria-labelledby')!)?.textContent ?? '') : '');

afterEach(() => {
  echartsMocks.setOption.mockClear();
  echartsMocks.init.mockClear();
});

// Telefon testleri önce koşar: geniş modül kayıt defteri modül düzeyindedir; telefonda hiç istenmediği burada sınanır.
describe('GenelPage › telefon temel sunumu (yerel HTML, geniş modül indirilmez)', () => {
  it('sıra: özet ölçüler, yaklaşan ödemeler ve dikkat isteyenler bütçeden önce; sonra bekleyen işler ve aylık tablo', async () => {
    renderPage({ device: 'phone' });
    await telefonHazir();
    expect(within(await beklenenOzet()).getAllByRole('listitem')).toHaveLength(3);
    const sira = bolgeSirasi().filter(Boolean);
    const konum = (onEk: string) => sira.findIndex(ad => ad.startsWith(onEk));
    expect(konum('Yaklaşan ödemeler')).toBeGreaterThanOrEqual(0);
    expect(konum('Yaklaşan ödemeler')).toBeLessThan(konum('Dikkat isteyenler'));
    expect(konum('Dikkat isteyenler')).toBeLessThan(konum('Bütçe · Aralık 2026'));
    expect(konum('Bütçe · Aralık 2026')).toBeLessThan(konum('Bekleyen işler'));
    expect(konum('Bekleyen işler')).toBeLessThan(konum('Aylık plan ve gerçek'));
    // Telefon geniş modülü (Overview + ECharts) istemez.
    expect(screen.queryByTestId('overview')).not.toBeInTheDocument();
    expect(wideManifest().find(entry => entry.key === 'genel-genis')?.status ?? 'idle').toBe('idle');
  });

  it('bütçe akordeon (ilk satır açık): kanıtsız gerçekleşen "Kaynakta yazılı"; yüzde, "harcandı" ve kalan yok', async () => {
    renderPage({ device: 'phone' });
    await telefonHazir();
    const blok = region(/^Bütçe · Aralık 2026/);
    expect(within(blok).queryByRole('table')).not.toBeInTheDocument();
    const basliklar = within(blok).getAllByRole('button', { name: /Örnek gider satırı/ });
    expect(basliklar).toHaveLength(8);
    expect(basliklar[0]).toHaveAttribute('aria-expanded', 'true');
    expect(basliklar.slice(1).every(baslik => baslik.getAttribute('aria-expanded') === 'false')).toBe(true);
    // 2026-12 "Örnek gider satırı 1": plan 5.500, Gerçekleşen sekmesinde 23.700 (ödeme kanıtı yok).
    const satir = akordeonSatiri(blok, /Örnek gider satırı 1(?!\d)/);
    expect(satir).toHaveTextContent('Planlanan₺5.500,00');
    expect(satir).toHaveTextContent('Gerçekleşen₺23.700,00');
    expect(satir).toHaveTextContent(RECORDED_IN_SOURCE_TEXT);
    expect(blok).not.toHaveTextContent(/harcandı/i);
    expect(blok).not.toHaveTextContent('%');
    // Kalan = plan − gerçek; kanıtsız değerden "kalan" türetilmez.
    expect(blok).not.toHaveTextContent('-₺18.200,00');
    expect(within(blok).getByRole('link', { name: 'Bütçe ve nakit' })).toHaveAttribute('href', '#/butce');
  });

  it('aylık blok akordeon (grafik yok): her ay Planlanan ve Gerçekleşen ayrı etiketli, toplam üretilmez ("Toplam kullanılamaz"), kayıtlar sayılır', async () => {
    renderPage({ device: 'phone' });
    await telefonHazir();
    const blok = region('Aylık plan ve gerçek');
    expect(within(blok).queryByRole('img')).not.toBeInTheDocument();
    expect(within(blok).queryByRole('table')).not.toBeInTheDocument();
    const aylar = within(blok).getAllByRole('button', { name: /20\d\d/ });
    expect(aylar).toHaveLength(6);
    expect(aylar[0]).toHaveAttribute('aria-expanded', 'true');
    // Nesilde satır düzeyinde yaprak sahipliği haritası yok: ayın satırları (gelir, ara toplam, genel toplam, adet olabilir)
    // tek Planlanan/Gerçekleşen sayısında toplanmaz; eksik toplam adıyla, nedeni blokta yazılı.
    const aralik = akordeonSatiri(blok, /Ara 2026/);
    expect(aralik).toHaveTextContent(`Planlanan${TOTAL_UNAVAILABLE_TEXT}`);
    expect(aralik).toHaveTextContent(`Gerçekleşen${TOTAL_UNAVAILABLE_TEXT}`);
    expect(aralik).toHaveTextContent('Kayıt8 plan · 8 gerçekleşen');
    expect(aralik).toHaveTextContent(RECORDED_IN_SOURCE_TEXT);
    expect(blok).not.toHaveTextContent('₺');
    expect(within(blok).getByText(/^Toplam kullanılamaz: bütçe gözlemlerinin /)).toBeInTheDocument();
    expect(blok).not.toHaveTextContent(/harcandı/i);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(echartsMocks.init).not.toHaveBeenCalled();
  });

  it('gelir, ara toplam ("… toplamı"), genel toplam ("Toplam …") ve adet satırları aylık harcama toplamına girmez', async () => {
    const overrides = withBudget(records => {
      const plan = records.find(r => r.basis === 'planned' && r.period === '2026-12')!;
      const gercek = records.find(r => r.basis === 'recorded_aggregate' && r.period === '2026-12')!;
      const ekle = (sablon: Obs) => [
        gozlem(sablon, { label: 'Maaş', value: { decimal: '85000.00', currency: 'TRY' } }),
        gozlem(sablon, { label: 'Toplam gelir', value: { decimal: '85000.00', currency: 'TRY' } }),
        gozlem(sablon, { label: 'Faturalar toplamı', value: { decimal: '12000.00', currency: 'TRY' } }),
        gozlem(sablon, { label: 'Toplam ödemeler', value: { decimal: '121800.00', currency: 'TRY' } }),
        gozlem(sablon, { label: 'Doğalgaz · adet', value: { decimal: '3', currency: null } }),
      ];
      return [...records, ...ekle(plan), ...ekle(gercek)];
    });
    renderPage({ device: 'phone', provider: { source: fixtureSource(overrides) } });
    await telefonHazir();
    const blok = region('Aylık plan ve gerçek');
    const aralik = akordeonSatiri(blok, /Ara 2026/);
    expect(aralik).toHaveTextContent(`Planlanan${TOTAL_UNAVAILABLE_TEXT}`);
    expect(aralik).toHaveTextContent(`Gerçekleşen${TOTAL_UNAVAILABLE_TEXT}`);
    expect(aralik).toHaveTextContent('Kayıt13 plan · 13 gerçekleşen');
    // 121.800 + 85.000 + 85.000 + 12.000 + 121.800 + 3 = 425.603 gibi karışık bir toplam hiçbir biçimde görünmez.
    expect(blok).not.toHaveTextContent('₺');
  });

  it('yaklaşan ödemeler ve dikkat isteyenler: yerel liste; satır bağlantısı sayfaya gider', async () => {
    renderPage({ device: 'phone' });
    await telefonHazir();
    const odemeler = region(/^Yaklaşan ödemeler/);
    const satirlar = within(odemeler).getAllByRole('listitem');
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0]).toHaveTextContent('08.12.2026');
    expect(satirlar[0]).toHaveTextContent('Örnek tahmin olayı 2');
    expect(satirlar[0]).toHaveTextContent('₺15.400,00');
    expect(satirlar[0]).toHaveTextContent('Planlandı');
    expect(satirlar[0]).toHaveTextContent('Taraf bilinmiyor');
    const dikkat = region('Dikkat isteyenler');
    expect(within(dikkat).getByRole('link', { name: /Fiyatı eksik alım/ })).toHaveAttribute('href', '#/alimlar');
    expect(within(dikkat).getByRole('link', { name: /Açık sorun/ })).toHaveAttribute('href', '#/veri');
  });

  it('bekleyen işler yerel onay kutusu (antd yok): işaretle → yerel değişiklik kümesi, yeniden dokun → geri alınır', async () => {
    const user = userEvent.setup();
    renderPage({ device: 'phone' });
    await telefonHazir();
    const blok = region('Bekleyen işler');
    expect(blok.querySelector('[class*="ant-"]')).toBeNull();
    const kutular = within(blok).getAllByRole('checkbox');
    expect(kutular).toHaveLength(5);
    expect(kutular[0]).toHaveAccessibleName(/Örnek tadilat işi 4/);
    expect(blok).toHaveTextContent('IS-4');
    expect(blok).toHaveTextContent('03.02.2027');
    await waitFor(() => expect(kutular[0]).toBeEnabled());
    await user.click(kutular[0]!);
    await waitFor(() => expect(kutular[0]).toBeChecked());
    await user.click(kutular[0]!);
    await waitFor(() => expect(kutular[0]).not.toBeChecked());
  });
});

describe('GenelPage › gerçekleşen anlamı (data/actuals.ts)', () => {
  it('gelecek ayın Gerçekleşeni "Henüz yok": kaynaktaki ayna değer aylık tabloda gösterilmez', async () => {
    // 15.12.2025: nesildeki bütün aylar gelecekte; aylık blok en erken altı ayı gösterir.
    renderPage({ device: 'phone', now: () => new Date(2025, 11, 15, 10, 0, 0) });
    await telefonHazir();
    const blok = region('Aylık plan ve gerçek');
    const ocak = akordeonSatiri(blok, /Oca 2026/);
    expect(ocak).toHaveTextContent(`Planlanan${TOTAL_UNAVAILABLE_TEXT}`);
    expect(ocak).toHaveTextContent('GerçekleşenHenüz yok');
    expect(ocak).toHaveTextContent('Kayıt8 plan kaydı');
    // 2026-01 Gerçekleşen sekmesindeki değerler gelecek ay olduğundan gösterilmez (ne tutar ne kayıt sayısı).
    expect(blok).not.toHaveTextContent('₺');
    expect(blok).not.toHaveTextContent(RECORDED_IN_SOURCE_TEXT);
  });

  it('unclassified ve silinmiş gözlem hiçbir toplama girmez (kalem ve ay)', async () => {
    const overrides = withBudget(records => {
      const sablon = records.find(r => r.basis === 'recorded_aggregate' && r.period === '2026-12' && r.label === 'Örnek gider satırı 1')!;
      return [
        ...records,
        gozlem(sablon, { basis: 'unclassified', value: { decimal: '1000.00', currency: 'TRY' } }),
        gozlem(sablon, { deleted_at: '2026-12-01T00:00:00Z', value: { decimal: '500.00', currency: 'TRY' } }),
      ];
    });
    renderPage({ device: 'phone', provider: { source: fixtureSource(overrides) } });
    await telefonHazir();
    expect(akordeonSatiri(region(/^Bütçe · Aralık 2026/), /Örnek gider satırı 1(?!\d)/)).toHaveTextContent('Gerçekleşen₺23.700,00');
    // Ay satırında yalnız canlı plan ve Gerçekleşen kayıtları sayılır (unclassified ve silinmiş sayılmaz).
    expect(akordeonSatiri(region('Aylık plan ve gerçek'), /Ara 2026/)).toHaveTextContent('Kayıt8 plan · 8 gerçekleşen');
  });

  it('kalem tutarı kesin ondalıkla yazılır; büyük tutarlı satır aylık sayıya tutar olarak eklenmez', async () => {
    const overrides = withBudget(records => {
      const sablon = records.find(r => r.basis === 'recorded_aggregate' && r.period === '2026-12')!;
      return [...records, gozlem(sablon, { label: 'Büyük kalem', value: { decimal: '90071992547409.93', currency: 'TRY' } })];
    });
    renderPage({ device: 'phone', provider: { source: fixtureSource(overrides) } });
    await telefonHazir();
    // Kalem satırı kendi değerini kayan noktasız yazar (Number ile ,94 olurdu).
    expect(akordeonSatiri(region(/^Bütçe · Aralık 2026/), /Büyük kalem/)).toHaveTextContent('₺90.071.992.547.409,93');
    const aralik = akordeonSatiri(region('Aylık plan ve gerçek'), /Ara 2026/);
    expect(aralik).toHaveTextContent('Kayıt8 plan · 9 gerçekleşen');
    expect(aralik).not.toHaveTextContent('₺');
  });

  it('plan aynası: bu ayın Gerçekleşeni planın kopyasıysa bütçe bloğu bunu adıyla söyler', async () => {
    const overrides = withBudget(records => {
      const planlar = records.filter(r => r.basis === 'planned' && r.period === '2026-12');
      return records.map(r => {
        if (r.basis !== 'recorded_aggregate' || r.period !== '2026-12') return r;
        const plan = planlar.find(p => p.label === r.label);
        return plan ? { ...r, value: { ...plan.value } } : r;
      });
    });
    renderPage({ device: 'phone', provider: { source: fixtureSource(overrides) } });
    await telefonHazir();
    const blok = region(/^Bütçe · Aralık 2026/);
    expect(blok).toHaveTextContent(MIRRORS_PLAN_NOTE);
    expect(blok).not.toHaveTextContent(/harcandı/i);
  });

  it('dönem Europe/Istanbul takviminden: 30.11.2026 22:30 UTC Aralık, 20:30 UTC Kasım', async () => {
    const { unmount } = renderPage({ device: 'phone', now: () => new Date('2026-11-30T22:30:00Z') });
    await telefonHazir();
    expect(region(/^Bütçe · Aralık 2026/)).toBeInTheDocument();
    unmount();
    renderPage({ device: 'phone', now: () => new Date('2026-11-30T20:30:00Z') });
    await telefonHazir();
    expect(region(/^Bütçe · Kasım 2026/)).toBeInTheDocument();
    // Kasım "Bu ay kalan nakit": forecast_months 2026-11, ayın son günü 30.11.
    expect(within(await beklenenOzet()).getAllByRole('listitem')[0]).toHaveTextContent("30.11'e kadar");
  });
});

describe('GenelPage › başlık ve ölçüler', () => {
  it('başlık: bölüm "Genel", h1 "Genel durum", amaç cümlesi, tek birincil eylem ve tazelik satırı', async () => {
    renderPage({ device: 'phone' });
    expect(screen.getByRole('heading', { level: 1, name: 'Genel durum' })).toBeInTheDocument();
    expect(screen.getByText('Genel')).toBeInTheDocument();
    expect(screen.getByText('Bu ayın nakdini, yaklaşan ödemeleri ve dikkat isteyen kayıtları tek yerde görün.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aylık rapor' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(`Nesil ${GENERATION_ID.slice(0, 6)}`)).toBeInTheDocument());
    expect(screen.getByText(/^Son okuma /)).toBeInTheDocument();
  });

  it('üç ölçü: bu ay kalan nakit "tahmin" etiketli, 7 günde ödenecek, geciken; hepsi ₺ biçiminde', async () => {
    renderPage({ device: 'phone' });
    const items = within(await beklenenOzet()).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // forecast_months 2026-12 closing_balance 300.00 → tahmin.
    expect(items[0]).toHaveTextContent('Bu ay kalan nakit');
    expect(items[0]).toHaveTextContent('₺300,00');
    expect(items[0]).toHaveTextContent(/tahmin · 31\.12'e kadar/);
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
    renderPage({ device: 'phone', provider: { source: fixtureSource({ 'manifest.json': manifestWithout('forecast_months') }) } });
    const nakit = within(await beklenenOzet()).getAllByRole('listitem')[0]!;
    expect(nakit).toHaveTextContent('Bilinmiyor');
    expect(nakit).toHaveTextContent('Kaynakta tahmin ayı kaydı yok');
    expect(nakit).not.toHaveTextContent('₺');
  });
});

describe('GenelPage › geniş sunum (tablet/masaüstü, lazyWide)', () => {
  it('masaüstü: yüklenirken iskelet, veri gelince geniş modül dört bloğu iki sütunda çizer', async () => {
    renderPage();
    expect(screen.getByText('Genel durum okunuyor')).toBeInTheDocument();
    expect(await genisHazir()).toHaveAttribute('data-layout', 'genis');
    expect(region(/^Yaklaşan ödemeler/)).toBeInTheDocument();
    expect(region(/^Bütçe · Aralık 2026/)).toBeInTheDocument();
    expect(region('Dikkat isteyenler')).toBeInTheDocument();
    expect(region('Bekleyen işler')).toBeInTheDocument();
    expect(region('Aylık plan ve gerçek')).toBeInTheDocument();
    expect(screen.queryByText('Genel durum okunuyor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('genel-telefon')).not.toBeInTheDocument();
  });

  it('tablet: geniş modül, Overview tek sütun', async () => {
    renderPage({ device: 'tablet' });
    expect(await genisHazir()).toHaveAttribute('data-layout', 'dar');
  });

  it('bütçe tablosu: kalem başına Planlanan, Gerçekleşen ve Kalan ayrı sütunlar; plan ayrı', async () => {
    renderPage();
    await genisHazir();
    const blok = region(/^Bütçe · Aralık 2026/);
    expect(within(blok).getByRole('columnheader', { name: 'Planlanan' })).toBeInTheDocument();
    expect(within(blok).getByRole('columnheader', { name: 'Gerçekleşen' })).toBeInTheDocument();
    expect(within(blok).getByRole('columnheader', { name: 'Kalan' })).toBeInTheDocument();
    const satir = within(blok).getByRole('row', { name: /Örnek gider satırı 1\b/ });
    expect(satir).toHaveTextContent('₺5.500,00');
    expect(satir).toHaveTextContent('₺23.700,00');
    expect(within(blok).getAllByRole('row', { name: /Örnek gider satırı/ })).toHaveLength(8);
    expect(within(blok).getByRole('link', { name: 'Bütçe ve nakit' })).toHaveAttribute('href', '#/butce');
  });

  it('bütçe bloğu kanıtsız Gerçekleşende "harcandı" ve yüzde göstermez (a10-overview: satırın recorded alanı)', async () => {
    renderPage();
    await genisHazir();
    const blok = region(/^Bütçe · Aralık 2026/);
    expect(blok).toHaveTextContent(RECORDED_IN_SOURCE_TEXT);
    expect(blok).not.toHaveTextContent(/harcandı/i);
  });

  it('plan aynası notu geniş sunumda da bütçe bloğunun yanında', async () => {
    const overrides = withBudget(records => {
      const planlar = records.filter(r => r.basis === 'planned' && r.period === '2026-12');
      return records.map(r => {
        if (r.basis !== 'recorded_aggregate' || r.period !== '2026-12') return r;
        const plan = planlar.find(p => p.label === r.label);
        return plan ? { ...r, value: { ...plan.value } } : r;
      });
    });
    renderPage({ provider: { source: fixtureSource(overrides) } });
    await genisHazir();
    expect(screen.getByRole('note')).toHaveTextContent(MIRRORS_PLAN_NOTE);
  });

  it('dikkat isteyenler: fiyatsız alım, fotoğrafsız alım, açık sorun, geciken kayıt; sayı + sayfa bağlantısı', async () => {
    renderPage();
    await genisHazir();
    const blok = region('Dikkat isteyenler');
    const fiyatsiz = within(blok).getByRole('link', { name: /Fiyatı eksik alım/ });
    expect(fiyatsiz).toHaveTextContent('3');
    expect(fiyatsiz).toHaveAttribute('href', '#/alimlar');
    expect(within(blok).getByRole('link', { name: /Doğrulanmış fotoğrafı olmayan alım/ })).toHaveTextContent('20');
    const sorun = within(blok).getByRole('link', { name: /Açık sorun/ });
    expect(sorun).toHaveTextContent('10');
    expect(sorun).toHaveAttribute('href', '#/veri');
    expect(within(blok).getByRole('link', { name: /Geciken kayıt/ })).toHaveTextContent('3');
  });

  it('bekleyen işler: onay kutusu yerel değişiklik kümesine yazar ve geri alınır', async () => {
    const user = userEvent.setup();
    renderPage();
    await genisHazir();
    const blok = region('Bekleyen işler');
    const kutular = within(blok).getAllByRole('checkbox');
    expect(kutular).toHaveLength(5);
    expect(kutular[0]).toHaveAccessibleName(/Örnek tadilat işi 4/);
    expect(within(blok).getByRole('link', { name: 'Projeler ve görevler' })).toHaveAttribute('href', '#/projeler');
    await user.click(kutular[0]!);
    await waitFor(() => expect(kutular[0]).toBeChecked());
    await user.click(kutular[0]!);
    await waitFor(() => expect(kutular[0]).not.toBeChecked());
  });

  it('aylık tablo: toplam üretilmez ("Toplam kullanılamaz", nedeni yazılı); grafik çizilmez, ECharts istenmez; kayıtlar ve durum ayrı', async () => {
    renderPage();
    await genisHazir();
    const blok = region('Aylık plan ve gerçek');
    const tablo = within(blok).getByRole('table');
    expect(within(tablo).getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Ay', 'Planlanan', 'Gerçekleşen', 'Durum', 'Kayıt']);
    const aralik = within(tablo).getByRole('row', { name: /Ara 2026/ });
    expect(aralik).toHaveTextContent(TOTAL_UNAVAILABLE_TEXT);
    expect(aralik).toHaveTextContent(RECORDED_IN_SOURCE_TEXT);
    expect(aralik).toHaveTextContent('8 plan · 8 gerçekleşen');
    expect(within(tablo).getAllByRole('row')).toHaveLength(1 + 6);
    expect(blok).not.toHaveTextContent('₺');
    expect(within(blok).getByText(/^Toplam kullanılamaz: bütçe gözlemlerinin /)).toBeInTheDocument();
    // Çizilecek tutar yok: grafik (ve ECharts çalışma zamanı) yok; aynı değerler tabloda adıyla.
    expect(within(blok).queryByRole('img')).not.toBeInTheDocument();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(echartsMocks.init).not.toHaveBeenCalled();
  });

  it('aylık tablo: gelecek ayda Gerçekleşen "Henüz yok", Planlanan "Toplam kullanılamaz"; kaynak değeri yazılmaz', async () => {
    renderPage({ now: () => new Date(2025, 11, 15, 10, 0, 0) });
    await genisHazir();
    const tablo = within(region('Aylık plan ve gerçek')).getByRole('table');
    const ocak = within(tablo).getByRole('row', { name: /Oca 2026/ });
    expect(ocak).toHaveTextContent(TOTAL_UNAVAILABLE_TEXT);
    expect(ocak).toHaveTextContent('Henüz yok');
    expect(ocak).toHaveTextContent('8 plan kaydı');
    expect(ocak).not.toHaveTextContent('₺');
  });
});

describe('GenelPage › veri durumları', () => {
  it('koleksiyon nesilde yoksa blok dürüstçe "Kaynakta … kaydı yok" der', async () => {
    renderPage({ device: 'phone', provider: { source: fixtureSource({ 'manifest.json': manifestWithout('forecast_events') }) } });
    await telefonHazir();
    expect(within(region(/^Yaklaşan ödemeler/)).getByText('Kaynakta tahmin olayı kaydı yok')).toBeInTheDocument();
  });

  it('boş: bütçe gözlemi yoksa bütçe ve aylık blok adıyla boş', async () => {
    renderPage({ device: 'phone', provider: { source: fixtureSource({ 'manifest.json': manifestWithout('budget_observations') }) } });
    await telefonHazir();
    expect(within(region(/^Bütçe · Aralık 2026/)).getByText('Kaynakta bütçe gözlemi kaydı yok')).toBeInTheDocument();
    expect(within(region('Aylık plan ve gerçek')).getByText('Kaynakta bütçe gözlemi kaydı yok')).toBeInTheDocument();
  });

  it('kayıtsız nesil: hiçbir ölçü ve blok tutar uydurmaz; Geciken "Bilinmiyor" ve nedeni adıyla', async () => {
    renderPage({ device: 'phone', provider: { source: fixtureSource({ 'manifest.json': manifestEmpty() }) } });
    await telefonHazir();
    const [nakit, odenecek, geciken] = within(await beklenenOzet()).getAllByRole('listitem');
    expect(nakit).toHaveTextContent('Kaynakta tahmin ayı kaydı yok');
    expect(odenecek).toHaveTextContent('Kaynakta tahmin olayı kaydı yok');
    expect(geciken).toHaveTextContent('Bilinmiyor');
    expect(geciken).toHaveTextContent('Kaynakta alım ve iş emri kaydı yok');
    expect(geciken).not.toHaveTextContent('Geciken yok');
    expect(document.body).not.toHaveTextContent(/₺/);
    expect(within(region('Bekleyen işler')).getByText('Kaynakta iş emri kaydı yok')).toBeInTheDocument();
  });

  it('yaklaşan ödemeler yalnız 7 günlük pencerenin aylarındaki tahmin olayı parçalarını okur (ay sınırında iki ay)', async () => {
    const temel = fixtureSource();
    const okunan: string[] = [];
    const kaynak: GenerationSource = {
      kind: 'fixture',
      label: 'sentetik',
      readText: async path => {
        okunan.push(path);
        return temel.readText(path);
      },
    } as GenerationSource;
    const olayParcalari = () => okunan.filter(path => path.includes('forecast_events/')).map(path => /\/(\d{4}-\d{2})\//.exec(path)?.[1] ?? path);

    // 05.12.2026: pencere 05–11.12 → yalnız 2026-12 (nesilde 20 ayın parçası var).
    const { unmount } = renderPage({ device: 'phone', provider: { source: kaynak } });
    await telefonHazir();
    expect(within(region(/^Yaklaşan ödemeler/)).getAllByRole('listitem')).toHaveLength(1);
    expect([...new Set(olayParcalari())]).toEqual(['2026-12']);
    unmount();

    // 28.11.2026 23:30 İstanbul: pencere Kasım sonundan Aralık başına uzanır → 2026-11 ve 2026-12.
    okunan.length = 0;
    renderPage({ device: 'phone', provider: { source: kaynak }, now: () => new Date('2026-11-28T20:30:00Z') });
    await telefonHazir();
    expect([...new Set(olayParcalari())].sort()).toEqual(['2026-11', '2026-12']);
  });

  it('pencerenin ayında tahmin olayı parçası yoksa kaynak boş sayılmaz: "Önümüzdeki 7 günde ödeme yok" (manifest sayımı)', async () => {
    // 10.04.2027: nesilde 2027-04 parçası yok, koleksiyonda 20 kayıt var.
    renderPage({ device: 'phone', now: () => new Date(2027, 3, 10, 9, 0, 0) });
    await telefonHazir();
    expect(within(region(/^Yaklaşan ödemeler/)).getByText('Önümüzdeki 7 günde ödeme yok')).toBeInTheDocument();
    const odenecek = within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem')[1]!;
    expect(odenecek).toHaveTextContent('Ödeme yok');
    expect(odenecek).not.toHaveTextContent('Kaynakta tahmin olayı kaydı yok');
  });

  it('pencerede ödeme yoksa kaynak dolu olsa da "Önümüzdeki 7 günde ödeme yok" ve ölçü ₺0,00 · Ödeme yok', async () => {
    renderPage({ device: 'phone', now: () => new Date(2026, 10, 2, 9, 0, 0) });
    await telefonHazir();
    expect(within(region(/^Yaklaşan ödemeler/)).getByText('Önümüzdeki 7 günde ödeme yok')).toBeInTheDocument();
    const odenecek = within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem')[1]!;
    expect(odenecek).toHaveTextContent('₺0,00');
    expect(odenecek).toHaveTextContent('Ödeme yok');
    expect(region(/^Bütçe · Kasım 2026/)).toBeInTheDocument();
  });

  it('bozuk manifest: hata durumu "Hata: …" ile, "Yeniden dene" düğmesi; eski tutar gösterilmez', async () => {
    renderPage({ device: 'phone', provider: { source: fixtureSource({ 'manifest.json': '{bozuk' }) } });
    const hata = await screen.findByRole('alert');
    expect(hata).toHaveTextContent(/Hata: /);
    expect(within(hata).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.queryByTestId('genel-telefon')).not.toBeInTheDocument();
    expect(screen.queryByText(/₺/)).not.toBeInTheDocument();
  });

  it('eski veri: yenileme kaynağa ulaşamazsa son iyi veri kalır, tazelik satırı "yenilenemedi" der', async () => {
    const user = userEvent.setup();
    const temel = fixtureSource();
    let ulasilamaz = false;
    const kaynak: GenerationSource = {
      kind: 'fixture',
      label: 'sentetik',
      readText: async path => {
        if (ulasilamaz) throw new Error('Kaynağa ulaşılamadı');
        return temel.readText(path);
      },
    } as GenerationSource;
    renderPage({ device: 'phone', provider: { source: kaynak } });
    await telefonHazir();
    ulasilamaz = true;
    await user.click(screen.getByRole('button', { name: 'Yenile' }));
    const durum = await screen.findByText(/yenilenemedi/);
    expect(durum).toBeInTheDocument();
    // Eski veri ErrorState değildir: bloklar ve tutarlar yerinde, sayfa kendi adıyla işaretlenir.
    expect(screen.getByTestId('genel-telefon')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(akordeonSatiri(region(/^Bütçe · Aralık 2026/), /Örnek gider satırı 1(?!\d)/)).toHaveTextContent('₺5.500,00');
    expect(document.querySelector('.aile-genel')).toHaveAttribute('data-durum', 'eski');
  });
});
