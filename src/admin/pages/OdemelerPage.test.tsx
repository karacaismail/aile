// Ödemeler sayfası: payments koleksiyonu nesilde yok → üstte dürüst not; forecast_events "tahmini ödeme" olarak
// gruplu tablo (Gecikenler · Bu hafta · Sonra · Ödenenler, geciken üstte) ve Zaman çizelgesi modu; plan ve gerçek ayrı
// sütun; tarih ve tutar filtresi. Sentetik fixture + FixtureGenerationSource; seçiciler role/label ile.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { FixtureGenerationSource, GenerationProvider } from '../data';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { OdemelerPage } from './OdemelerPage';

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

interface ManifestShape { files: { path: string; collection?: string }[]; counts: Record<string, number> }

/** forecast_events dosyaları manifestten düşürülür: koleksiyon nesilde yok → sayfa "Kaynakta … kaydı yok" der. */
function manifestWithoutForecastEvents(): string {
  const manifest = JSON.parse(FILES['manifest.json']!) as ManifestShape;
  manifest.files = manifest.files.filter((file) => file.collection !== 'forecast_events');
  manifest.counts = { ...manifest.counts, forecast_events: 0 };
  return JSON.stringify(manifest);
}

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

// Fixture: ilk olay 01.11.2026 (₺16.600,00), ikincisi 08.12.2026 (₺15.400,00), sonrası 2027–2028.
const BUGUN = () => new Date(2026, 10, 2, 10, 0, 0);
const ARALIK_BASI = () => new Date(2026, 11, 5, 10, 0, 0);

interface RenderOptions { device?: Device; now?: () => Date; overrides?: Record<string, string | null> }

function renderPage({ device = 'desktop', now = BUGUN, overrides }: RenderOptions = {}) {
  const source = fixtureSource(overrides);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={source} cache={null} changeSet={null}>
        {children}
      </GenerationProvider>
    </DeviceContext.Provider>
  );
  return render(<OdemelerPage location="/odemeler" now={now} />, { wrapper: Wrapper });
}

const bekleTablo = async (name = 'Tahmini ödemeler') => screen.findByRole('table', { name });

describe('OdemelerPage › başlık ve dürüst not', () => {
  it('bölüm "Para", h1 "Ödemeler", amaç cümlesi ve "Kaynakta kaydedilmiş ödeme yok (app_nakit boş)" notu', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Ödemeler' })).toBeInTheDocument();
    expect(screen.getByText('Para')).toBeInTheDocument();
    expect(screen.getByText('Planlanan, yapılan ve geciken ödemeleri tarihleriyle izleyin.')).toBeInTheDocument();
    const not = screen.getByRole('note');
    expect(not).toHaveTextContent('Kaynakta kaydedilmiş ödeme yok (app_nakit boş)');
    await bekleTablo();
  });

  it('tazelik satırı nesil kimliğini yazar; yüklenirken iskelet, sonra tablo', async () => {
    renderPage();
    expect(screen.getByRole('status', { busy: true })).toBeInTheDocument();
    await bekleTablo();
    await waitFor(() => expect(screen.getByText(/Nesil/)).toHaveTextContent(GENERATION_ID.slice(0, 6)));
  });
});

describe('OdemelerPage › özet (plan ve gerçek ayrı)', () => {
  it('Geciken (plan) ₺16.600,00 · 1 tahmini ödeme; Bu hafta (plan) "Ödeme yok"; Ödenen (gerçek) "Henüz yok"', async () => {
    renderPage();
    await bekleTablo();
    const ozet = screen.getByRole('list', { name: 'Özet' });
    const maddeler = within(ozet).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(maddeler).toHaveLength(3);
    expect(maddeler[0]).toContain('Geciken (plan)');
    expect(maddeler[0]).toContain('₺16.600,00');
    expect(maddeler[0]).toContain('1 tahmini ödeme');
    expect(maddeler[1]).toContain('Bu hafta (plan)');
    expect(maddeler[1]).toContain('Ödeme yok');
    expect(maddeler[2]).toContain('Ödenen (gerçek)');
    expect(maddeler[2]).toContain('Henüz yok');
    expect(maddeler[2]).toContain('Kaynakta kaydedilmiş ödeme yok');
  });

  it('Bu hafta: 05.12.2026 bakışıyla 08.12.2026 olayı bu haftadadır (₺15.400,00)', async () => {
    renderPage({ now: ARALIK_BASI });
    await bekleTablo();
    const ozet = screen.getByRole('list', { name: 'Özet' });
    const maddeler = within(ozet).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(maddeler[1]).toContain('₺15.400,00');
    expect(maddeler[1]).toContain('1 tahmini ödeme');
  });
});

describe('OdemelerPage › tablo (masaüstü)', () => {
  it('geciken satır üstte; Planlanan ₺16.600,00 ve Gerçekleşen "Henüz yok" ayrı sütunlar; durum sözcükle "Gecikti · 1 gün"', async () => {
    renderPage();
    await bekleTablo();
    // antd Table başlığı ayrı bir <table> içinde çizer; başlık ve satırlar sayfa genelinde aranır (Table.test ile aynı).
    const basliklar = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(basliklar).toEqual(expect.arrayContaining(['Tarih', 'Ödeme', 'Planlanan', 'Gerçekleşen', 'Durum']));
    const satirlar = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
    expect(satirlar).toHaveLength(20);
    const ilk = satirlar[0]!;
    expect(ilk).toHaveTextContent('01.11.2026');
    expect(ilk).toHaveTextContent('Örnek tahmin olayı 1');
    expect(ilk).toHaveTextContent('₺16.600,00');
    expect(ilk).toHaveTextContent('Henüz yok');
    expect(ilk).toHaveTextContent('Gecikti · 1 gün');
    expect(satirlar[1]).toHaveTextContent('Planlandı');
    expect(screen.getByText('20 tahmini ödeme · 1 geciken')).toBeInTheDocument();
  });

  it('tutar filtresi: En az 20.000 → yalnız 4 satır; etkin filtre etiketi; temizleyince 20', async () => {
    const user = userEvent.setup();
    renderPage();
    await bekleTablo();
    // Tablo modunda filtre paneli şerittir (FilterArea defaultOpen=false); önce açılır.
    await user.click(screen.getByRole('button', { name: /^Filtreleri göster/ }));
    const enAz = screen.getByRole('textbox', { name: 'En az' });
    await user.type(enAz, '20.000');
    await user.tab();
    await waitFor(() => expect(screen.getByText('4 tahmini ödeme')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Tutar: en az ₺20\.000,00 filtresini kaldır/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tümünü temizle' }));
    await waitFor(() => expect(screen.getByText('20 tahmini ödeme · 1 geciken')).toBeInTheDocument());
  });

  it('tarih filtresi: Bitiş 31.12.2026 → 2 satır; aralık dışı bitişle sonuç yok → boş durum filtreleri yazar', async () => {
    const user = userEvent.setup();
    renderPage();
    await bekleTablo();
    await user.click(screen.getByRole('button', { name: /^Filtreleri göster/ }));
    const bitis = screen.getByRole('textbox', { name: 'Bitiş' });
    await user.type(bitis, '31.12.2026');
    await user.tab();
    await waitFor(() => expect(screen.getByText('2 tahmini ödeme · 1 geciken')).toBeInTheDocument());
    await user.clear(bitis);
    await user.type(bitis, '31.10.2026');
    await user.tab();
    const baslik = await screen.findByRole('heading', { level: 2, name: 'Bu filtrelerle kayıt yok' });
    // Aynı etiket sorgu çubuğunda da durur; boş durumun kendi listesi aranır.
    const bos = screen.getAllByRole('status').find((el) => el.contains(baslik))!;
    expect(within(bos).getByText('Tarih: 31.10.2026 ve öncesi')).toBeInTheDocument();
    expect(within(bos).getByRole('button', { name: 'Filtreleri temizle' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('OdemelerPage › Zaman çizelgesi modu', () => {
  it('"Zaman çizelgesi" seçilince aylar bölge olur; Kasım 2026 1 kayıt, "Ödeme 01.11.2026"; Gantt devre dışı', async () => {
    const user = userEvent.setup();
    renderPage();
    await bekleTablo();
    expect(screen.getByRole('radio', { name: 'Gantt' })).toBeDisabled();
    // antd Segmented girdisi pointer-events: none; etiket tıklanır (QueryBar.test ile aynı).
    await user.click(screen.getByText('Zaman çizelgesi'));
    expect(screen.getByRole('radio', { name: 'Zaman çizelgesi' })).toBeChecked();
    const kasim = await screen.findByRole('region', { name: 'Kasım 2026 1 kayıt' });
    expect(within(kasim).getByRole('button', { name: /Örnek tahmin olayı 1/ })).toHaveTextContent('Ödeme 01.11.2026');
    // Zaman çizelgesinde filtre paneli açık başlar (README: Liste/Zaman çizelgesi açık).
    expect(screen.getByRole('button', { name: 'Paneli gizle' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Tahmini ödemeler' })).not.toBeInTheDocument();
  });
});

describe('OdemelerPage › telefon', () => {
  it('akordeon gruplar: Gecikenler üstte, sonra Sonra; "Bu hafta" ve "Ödenenler" boşsa çizilmez', async () => {
    renderPage({ device: 'phone' });
    const gecikenler = await screen.findByRole('region', { name: 'Gecikenler' });
    const bolgeler = screen.getAllByRole('region').filter((r) => ['Gecikenler', 'Bu hafta', 'Sonra', 'Ödenenler'].includes(r.getAttribute('aria-label') ?? ''));
    expect(bolgeler[0]).toBe(gecikenler);
    expect(bolgeler.map((r) => r.getAttribute('aria-label'))).toEqual(['Gecikenler', 'Sonra']);
    expect(within(gecikenler).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('OdemelerPage › veri durumları', () => {
  it('forecast_events nesilde yoksa: "Kaynakta tahmini ödeme kaydı yok", tablo yok, not kalır', async () => {
    renderPage({ overrides: { 'manifest.json': manifestWithoutForecastEvents() } });
    const bos = await screen.findByRole('heading', { level: 2, name: 'Kaynakta tahmini ödeme kaydı yok' });
    expect(bos).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('app_nakit boş');
  });

  it('bozuk manifest: ErrorState "Hata: …" + "Yeniden dene"; tutar gösterilmez', async () => {
    renderPage({ overrides: { 'manifest.json': '{bozuk' } });
    const hata = await screen.findByRole('alert');
    expect(within(hata).getByRole('heading', { level: 2 })).toHaveTextContent(/^Hata: /);
    expect(within(hata).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.queryByText('₺16.600,00')).not.toBeInTheDocument();
  });
});
