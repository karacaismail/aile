// Ödemeler sayfası (RTL, sentetik nesil). Nesilde `payments` koleksiyonu yok: sayfa "Kaynakta ödeme kaydı yok" der ve
// bütçe tahmin olaylarını (forecast_events) "tahmini ödeme" olarak listeler; tahmin olayı ödeme gibi görünmez ("Ödendi",
// "Gecikti" yok; gerçekleşen "Ödeme kaydı yok"). Telefon: tarih gruplu akordeon, ilk 10 satır + "daha fazla göster".
// Geniş: tablo ve zaman çizelgesi pages/odemeler/OdemelerGenis.wide.tsx (lazyWide) içinden gelir; telefon onu yüklemez.
// Profil DeviceContext (=ProfileContext) ile zorlanır; seçiciler role/label.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { wideManifest } from '../adaptive';
import { FixtureGenerationSource, GenerationProvider, type GenerationSource } from '../data';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { OdemelerPage, sumMoney } from './OdemelerPage';

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

interface ManifestFile { path: string; kind: string; sha256: string; bytes: number; collection?: string; count?: number }
interface ManifestShape { files: ManifestFile[]; counts: Record<string, number> }
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const ILK_PARCA = 'data/forecast_events/budget/2026-11/00000.json';

function manifestile(degistir: (manifest: ManifestShape) => void): string {
  const manifest = JSON.parse(FILES['manifest.json']!) as ManifestShape;
  degistir(manifest);
  return JSON.stringify(manifest);
}

/** Bir parçanın içeriğini değiştirir ve manifestteki sha256/bytes'ı günceller (bütünlük doğrulaması geçer). */
function parcaDegistir(yol: string, degistir: (records: Record<string, unknown>[]) => void): Record<string, string> {
  const envelope = JSON.parse(FILES[yol]!) as { records: Record<string, unknown>[] };
  degistir(envelope.records);
  const text = JSON.stringify(envelope);
  const manifest = manifestile((m) => {
    const file = m.files.find((f) => f.path === yol)!;
    file.sha256 = sha256(text);
    file.bytes = Buffer.byteLength(text);
  });
  return { [yol]: text, 'manifest.json': manifest };
}

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

/** İlk okumadan sonra manifest okunamaz hâle getirilebilen kaynak (eski veri durumu). */
class KesilenKaynak implements GenerationSource {
  readonly kind = 'fixture' as const;
  readonly label = 'sentetik-kesilen';
  kesik = false;
  private readonly ic = fixtureSource();
  async readText(path: string): Promise<string> {
    if (this.kesik) throw new Error('Sentetik kesinti');
    return this.ic.readText(path);
  }
}

// Fixture: ilk olay 01.11.2026 (₺16.600,00), ikincisi 08.12.2026 (₺15.400,00), sonrası 2027–2028 (ayda bir).
const BUGUN = () => new Date('2026-11-02T10:00:00+03:00');
const ARALIK_BASI = () => new Date('2026-12-05T10:00:00+03:00');

interface RenderOptions { device?: Device; now?: () => Date; overrides?: Record<string, string | null>; source?: GenerationSource }

function renderPage({ device = 'phone', now = BUGUN, overrides, source }: RenderOptions = {}) {
  const kaynak = source ?? fixtureSource(overrides);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={kaynak} cache={null} changeSet={null}>
        {children}
      </GenerationProvider>
    </DeviceContext.Provider>
  );
  return render(<OdemelerPage location="/odemeler" now={now} />, { wrapper: Wrapper });
}

/** Etkileşimli testlerin süre bütçesi: jsdom + user-event, yük altındaki makinede 5 sn varsayılanını aşabiliyor. */
const YUK_SURESI = 20_000;

const bekleListe = () => screen.findByRole('region', { name: 'Tahmini ödemeler' });
const satirlar = (alan: HTMLElement) => Array.from(alan.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'));
const grupAdlari = (alan: HTMLElement) => within(alan).getAllByRole('heading', { level: 3 }).map((h) => h.firstChild?.textContent?.trim());

describe('OdemelerPage › telefon: başlık ve kaynak gerçeği', () => {
  it('bölüm "Para", h1, amaç; "Ödeme kaydet" devre dışı ve gerekçesi "Kaynakta ödeme kaydı yok."', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Ödemeler' })).toBeInTheDocument();
    expect(screen.getByText('Para')).toBeInTheDocument();
    expect(screen.getByText('Planlanan, yapılan ve geciken ödemeleri tarihleriyle izleyin.')).toBeInTheDocument();
    await bekleListe();
    const birincil = screen.getByRole('button', { name: 'Ödeme kaydet' });
    expect(birincil).toBeDisabled();
    expect(birincil).toHaveAccessibleDescription('Kaynakta ödeme kaydı yok.');
    expect(screen.getByText('Kaynakta ödeme kaydı yok.')).toBeInTheDocument();
  });

  it('manifest okunmadan kaynak hakkında hüküm yok: gerekçe "Ödeme kaynağı bilinmiyor."', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Ödeme kaydet' })).toHaveAccessibleDescription('Ödeme kaynağı bilinmiyor.');
  });

  it('özet: Tarihi geçen (plan) ₺16.600,00; Sıradaki (plan) ₺15.400,00 · 08.12.2026; Yapılan (gerçek) Bilinmiyor', async () => {
    renderPage();
    await bekleListe();
    const maddeler = within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(maddeler).toHaveLength(3);
    expect(maddeler[0]).toContain('Tarihi geçen (plan)');
    expect(maddeler[0]).toContain('₺16.600,00');
    expect(maddeler[0]).toContain('1 tahmin · ödeme durumu bilinmiyor');
    expect(maddeler[1]).toContain('Sıradaki (plan)');
    expect(maddeler[1]).toContain('₺15.400,00');
    expect(maddeler[1]).toContain('08.12.2026 · Ödeme');
    expect(maddeler[2]).toContain('Yapılan (gerçek)');
    expect(maddeler[2]).toContain('Bilinmiyor');
    expect(maddeler[2]).toContain('Kaynakta ödeme kaydı yok');
  });

  it('manifestte payments varsa yokluk iddia edilmez: "Kaynakta 3 ödeme kaydı var; panel bunları okumuyor"', async () => {
    renderPage({ overrides: { 'manifest.json': manifestile((m) => { m.counts.payments = 3; }) } });
    await bekleListe();
    expect(screen.getByRole('button', { name: 'Ödeme kaydet' })).toHaveAccessibleDescription('Kaynakta 3 ödeme kaydı var; panel bunları okumuyor.');
    expect(screen.queryByText('Kaynakta ödeme kaydı yok.')).not.toBeInTheDocument();
  });
});

describe('OdemelerPage › telefon: tarih gruplu liste', () => {
  it('geniş modül telefonda yüklenmez', async () => {
    renderPage();
    await bekleListe();
    expect(wideManifest().find((entry) => entry.key === 'odemeler-genis')?.status ?? 'idle').toBe('idle');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('ilk 10 satır; gruplar Tarihi geçenler üstte, sonra aylar; ilk satır açık ve tahmin olduğunu söyler', async () => {
    renderPage();
    const alan = await bekleListe();
    expect(within(alan).getByRole('heading', { level: 2, name: 'Tahmini ödemeler' })).toBeInTheDocument();
    // Tablonun telefon biçimi: ResponsiveTable sözleşmesindeki yerleşim kancası (f04 seçicisi) akordeonu taşır.
    const yerlesim = alan.querySelectorAll('[data-layout]');
    expect(Array.from(yerlesim, (el) => el.getAttribute('data-layout'))).toEqual(['accordion']);
    expect(satirlar(yerlesim[0] as HTMLElement)).toHaveLength(10);
    expect(satirlar(alan)).toHaveLength(10);
    expect(grupAdlari(alan)).toEqual([
      'Tarihi geçenler', 'Aralık 2026', 'Ocak 2027', 'Şubat 2027', 'Mart 2027', 'Mayıs 2027', 'Haziran 2027', 'Temmuz 2027',
      'Ağustos 2027', 'Eylül 2027',
    ]);
    expect(within(alan).getByText('20 tahmini ödeme · 1 tarihi geçti', { exact: false })).toBeInTheDocument();
    expect(within(alan).getByText('Gösterilen 10 / 20')).toBeInTheDocument();
    const [ilk, ikinci] = satirlar(alan);
    expect(ilk).toHaveAttribute('aria-expanded', 'true');
    expect(ilk).toHaveTextContent('Örnek tahmin olayı 1');
    expect(ilk).toHaveTextContent('01.11.2026 · Alım');
    expect(ilk).toHaveTextContent('Tarihi geçti · 1 gün');
    expect(ilk).toHaveTextContent('₺16.600,00');
    expect(ikinci).toHaveAttribute('aria-expanded', 'false');
    expect(ikinci).toHaveTextContent('Planlandı');
    const panel = document.getElementById(ilk!.getAttribute('aria-controls')!)!;
    const govde = within(panel);
    expect(govde.getByText('Planlanan').nextSibling).toHaveTextContent('₺16.600,00');
    // Tutar ui/Money ile (.aile-tutar: tabular-nums, ₺8.500,00); kapalı satırdaki ve gövdedeki tutar aynı stil.
    expect(govde.getByText('₺16.600,00')).toHaveClass('aile-tutar');
    expect(within(ilk!).getByText('₺16.600,00')).toHaveClass('aile-tutar');
    expect(govde.getByText('Gerçekleşen').nextSibling).toHaveTextContent('Ödeme kaydı yok');
    expect(govde.getByText('Kesinlik').nextSibling).toHaveTextContent('Tutar tahmini');
    expect(govde.getByText('Kimlik').nextSibling).toHaveTextContent('olay-1');
    expect(govde.getByText('Kaynak').nextSibling).toHaveTextContent('_Finans web · satır 40');
    expect(document.body).not.toHaveTextContent(/Ödendi|Gecikti/);
  });

  it('"10 tahmini ödeme daha göster": 20 satır, düğme kalkar, odak 11. satıra geçer', async () => {
    const user = userEvent.setup();
    renderPage();
    const alan = await bekleListe();
    await user.click(within(alan).getByRole('button', { name: '10 tahmini ödeme daha göster' }));
    expect(satirlar(alan)).toHaveLength(20);
    expect(within(alan).getByText('Gösterilen 20 / 20')).toBeInTheDocument();
    expect(within(alan).queryByRole('button', { name: /daha göster$/ })).not.toBeInTheDocument();
    expect(satirlar(alan)[10]).toHaveFocus();
    expect(satirlar(alan)[10]).toHaveTextContent('Örnek tahmin olayı 11');
  }, YUK_SURESI);

  it('05.12.2026 bakışıyla 08.12.2026 olayı "Bu hafta" grubundadır; 01.11.2026 "Tarihi geçti · 34 gün"', async () => {
    renderPage({ now: ARALIK_BASI });
    const alan = await bekleListe();
    expect(grupAdlari(alan).slice(0, 3)).toEqual(['Tarihi geçenler', 'Bu hafta', 'Ocak 2027']);
    expect(satirlar(alan)[0]).toHaveTextContent('Tarihi geçti · 34 gün');
  });

  it('arama kimlik koduyla daraltır; sonuç yoksa boş durum aramayı yazar ve temizler', async () => {
    const user = userEvent.setup();
    renderPage();
    const alan = await bekleListe();
    const ara = screen.getByRole('searchbox', { name: 'Ara' });
    await user.type(ara, 'olay-7');
    await waitFor(() => expect(satirlar(screen.getByRole('region', { name: 'Tahmini ödemeler' }))).toHaveLength(1));
    expect(within(alan).getByText('Gösterilen 1 / 1')).toBeInTheDocument();
    await user.clear(ara);
    await user.type(ara, 'olmayan');
    const baslik = await screen.findByRole('heading', { level: 2, name: 'Bu filtrelerle kayıt yok' });
    const bos = screen.getAllByRole('status').find((el) => el.contains(baslik))!;
    expect(within(bos).getByText('Arama: olmayan')).toBeInTheDocument();
    await user.click(within(bos).getByRole('button', { name: 'Filtreleri temizle' }));
    expect(ara).toHaveValue('');
    expect(satirlar(await bekleListe())).toHaveLength(10);
  }, YUK_SURESI);

  it('silinmiş olay listelenmez; ölçülmüş gerçek tutar ödeme sayılmaz: "Kaynakta yazılı", "Ödendi" yok', async () => {
    const ikinciYol = 'data/forecast_events/budget/2026-12/00000.json';
    const ilk = parcaDegistir(ILK_PARCA, (records) => { records[0]!.measures = { planned: { amount: '16600.00', currency: 'TRY' }, actual: { amount: '16000.00', currency: 'TRY' } }; });
    const ikinciEnvelope = JSON.parse(FILES[ikinciYol]!) as { records: Record<string, unknown>[] };
    ikinciEnvelope.records[0]!.deleted_at = '2026-10-30T00:00:00Z';
    const ikinciText = JSON.stringify(ikinciEnvelope);
    const manifest = JSON.parse(ilk['manifest.json']!) as ManifestShape;
    const dosya = manifest.files.find((f) => f.path === ikinciYol)!;
    dosya.sha256 = sha256(ikinciText);
    dosya.bytes = Buffer.byteLength(ikinciText);
    renderPage({ overrides: { ...ilk, [ikinciYol]: ikinciText, 'manifest.json': JSON.stringify(manifest) } });
    const alan = await bekleListe();
    expect(within(alan).getByText('19 tahmini ödeme · 1 tarihi geçti', { exact: false })).toBeInTheDocument();
    expect(within(alan).queryByText(/Örnek tahmin olayı 2$/)).not.toBeInTheDocument();
    const panel = document.getElementById(satirlar(alan)[0]!.getAttribute('aria-controls')!)!;
    expect(within(panel).getByText('Gerçekleşen').nextSibling).toHaveTextContent('₺16.000,00 · Kaynakta yazılı');
    expect(within(panel).getByText('₺16.000,00')).toHaveClass('aile-tutar');
    expect(document.body).not.toHaveTextContent(/Ödendi|Gecikti/);
  });
});

describe('OdemelerPage › veri durumları', () => {
  it('yükleniyor: iskelet (aria-busy), liste yok; sonra liste', async () => {
    renderPage();
    expect(screen.getByRole('status', { busy: true })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tahmini ödemeler' })).not.toBeInTheDocument();
    await bekleListe();
  });

  it('forecast_events nesilde yoksa "Kaynakta tahmini ödeme yok"; liste yok; ödeme kaydı yokluğu yine yazılı', async () => {
    const manifest = manifestile((m) => {
      m.files = m.files.filter((file) => file.collection !== 'forecast_events');
      m.counts = { ...m.counts, forecast_events: 0 };
    });
    renderPage({ overrides: { 'manifest.json': manifest } });
    expect(await screen.findByRole('heading', { level: 2, name: 'Kaynakta tahmini ödeme yok' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tahmini ödemeler' })).not.toBeInTheDocument();
    expect(screen.getByText('Kaynakta ödeme kaydı yok.')).toBeInTheDocument();
  });

  it('bozuk manifest: ErrorState "Hata: …" + "Yeniden dene"; tutar gösterilmez', async () => {
    renderPage({ overrides: { 'manifest.json': '{bozuk' } });
    const hata = await screen.findByRole('alert');
    expect(within(hata).getByRole('heading', { level: 2 })).toHaveTextContent(/^Hata: /);
    expect(within(hata).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('₺');
  });

  it('eski veri: yenileme başarısızsa son liste kalır, tazelik satırı "yenilenemedi" der', async () => {
    const kaynak = new KesilenKaynak();
    renderPage({ source: kaynak });
    const alan = await bekleListe();
    kaynak.kesik = true;
    await act(async () => { screen.getByRole('button', { name: 'Yenile' }).click(); });
    await waitFor(() => expect(screen.getAllByRole('status').some((el) => /yenilenemedi/.test(el.textContent ?? ''))).toBe(true));
    expect(satirlar(alan)).toHaveLength(10);
  });
});

describe('OdemelerPage › geniş (masaüstü)', () => {
  it('tablo geniş modülden gelir: Tarih · Ödeme · Planlanan · Gerçekleşen · Durum; tarihi geçen üstte, gerçekleşen "Ödeme kaydı yok"', async () => {
    renderPage({ device: 'desktop' });
    await screen.findByRole('table', { name: 'Tahmini ödemeler' }, { timeout: 15000 });
    expect(wideManifest().find((entry) => entry.key === 'odemeler-genis')?.status).toBe('ready');
    const basliklar = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(basliklar).toEqual(expect.arrayContaining(['Tarih', 'Ödeme', 'Planlanan', 'Gerçekleşen', 'Durum']));
    const veriSatirlari = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
    expect(veriSatirlari).toHaveLength(20);
    expect(veriSatirlari[0]).toHaveTextContent('01.11.2026');
    expect(veriSatirlari[0]).toHaveTextContent('Örnek tahmin olayı 1');
    expect(veriSatirlari[0]).toHaveTextContent('Tarihi geçti · 1 gün');
    expect(veriSatirlari[0]).toHaveTextContent('Ödeme kaydı yok');
    expect(within(veriSatirlari[0]!).getByText('₺16.600,00')).toHaveClass('aile-tutar');
    expect(document.body).not.toHaveTextContent(/Ödendi|Gecikti/);
  }, 20000);

  it('Zaman çizelgesi modu: aylar bölge olur; Gantt devre dışı ve gerekçesi yazılı', async () => {
    const user = userEvent.setup();
    renderPage({ device: 'desktop' });
    await screen.findByRole('table', { name: 'Tahmini ödemeler' }, { timeout: 15000 });
    expect(screen.getByText(/Gantt kullanılamaz: ödemelerin tek tarihi var, süresi yok\./)).toBeInTheDocument();
    await user.click(screen.getByText('Zaman çizelgesi'));
    expect(await screen.findByRole('region', { name: 'Kasım 2026 1 kayıt' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Tahmini ödemeler' })).not.toBeInTheDocument();
  }, 20000);
});

describe('OdemelerPage › geriye uyumlu dışa aktarım', () => {
  it('sumMoney: boş liste null; aynı para birimi toplanır; karışık birim ya da bozuk tutar undefined', () => {
    expect(sumMoney([])).toBeNull();
    expect(sumMoney([{ amount: '8500', currency: 'TRY' }, { amount: '0.5', currency: 'TRY' }])).toEqual({ amount: '8500.50', currency: 'TRY' });
    expect(sumMoney([{ amount: '1.00', currency: 'TRY' }, { amount: '1.00', currency: 'EUR' }])).toBeUndefined();
    expect(sumMoney([{ amount: 'bozuk', currency: 'TRY' }])).toBeUndefined();
  });
});
