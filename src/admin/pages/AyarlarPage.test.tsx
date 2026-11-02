// Ayarlar sayfası: PageHeader (Uygulama › Ayarlar) → tasarım satır düzeni (başlık solda, alanlar sağda; telefonda alt
// alta) → veri kaynağı ayarları. Sentetik nesil FixtureGenerationSource ile belleğe okunur; GenerationProvider gerçektir.
// Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok. Gerçek Sheet kimliği, gerçek aile verisi yok.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { ChangeSet, createMemoryStorage } from '../data/changeSet';
import { FixtureGenerationSource } from '../data/sources';
import { GenerationProvider, type GenerationProviderProps } from '../data/useGeneration';
import type { Manifest, PurchaseNeedRecord } from '../data/types';
import { AyarlarPage, type AyarlarPageProps } from './AyarlarPage';
import type { PartitionCacheControl } from './ayarlar/onbellek';

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
const MANIFEST = JSON.parse(FILES['manifest.json']!) as Manifest;
const NEEDS = (JSON.parse(FILES['data/purchase_needs/household/00000.json']!) as { records: PurchaseNeedRecord[] }).records;
const LAMBADER = NEEDS.find((record) => record.source_record_id === 'kalem-027')!;

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

/** Tam paketteki yükü taklit eder: manifest ve ayar parçası okuması gecikir (varsayılan 50 ms). */
class SlowFixtureSource extends FixtureGenerationSource {
  constructor(files: Record<string, string>, label: string, private readonly delayMs = 50) {
    super(files, label);
  }
  override async readText(path: string): Promise<string> {
    if (path === 'manifest.json' || path.startsWith('data/settings/')) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return super.readText(path);
  }
}

/** İlk okuma başarılı; failNext() sonrası manifest okunamaz (ağ kesintisi) → depo son iyi nesli korur: stale. */
class FlakyFixtureSource extends FixtureGenerationSource {
  private failing = false;
  failNext() {
    this.failing = true;
  }
  /** Kaynak düzelir: sonraki manifest okuması başarılı. */
  recover() {
    this.failing = false;
  }
  override async readText(path: string): Promise<string> {
    if (this.failing && path === 'manifest.json') throw new Error('Sentetik kesinti: kaynağa ulaşılamadı');
    return super.readText(path);
  }
}

/** Önbellek denetimi sahtesi: sayım ve silme çağrıları izlenir; IndexedDB'ye dokunmaz. */
function fakeCache(initial = 3, overrides: Partial<PartitionCacheControl> = {}) {
  let entries = initial;
  const count = vi.fn(async () => entries);
  const clear = vi.fn(async () => {
    const removed = entries;
    entries = 0;
    return removed;
  });
  return { control: { available: true, count, clear, ...overrides } as PartitionCacheControl, count, clear };
}

/** Ayar koleksiyonu nesilde hiç yokmuş gibi: manifest files/counts'tan çıkar (generation_id biçimi korunur). */
function manifestWithoutSettings(): string {
  const counts = { ...MANIFEST.counts };
  delete counts.settings;
  const files = MANIFEST.files.filter((file) => file.collection !== 'settings');
  return JSON.stringify({ ...MANIFEST, counts, files });
}

interface RenderOptions extends Partial<GenerationProviderProps>, Omit<AyarlarPageProps, 'budgetSheetId'> {
  device?: Device;
  budgetSheetId?: string;
}

function renderPage({ device = 'desktop', budgetSheetId = '', source, cacheControl, saveFile, now, liveLastRead = async () => null, ...props }: RenderOptions = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={source ?? fixtureSource()} cache={null} changeSet={props.changeSet ?? null} {...props}>
        {children}
      </GenerationProvider>
    </DeviceContext.Provider>
  );
  const cache = cacheControl ?? fakeCache().control;
  return render(<AyarlarPage budgetSheetId={budgetSheetId} cacheControl={cache} saveFile={saveFile} now={now} liveLastRead={liveLastRead} />, { wrapper: Wrapper });
}

/** Başlıktaki tazelik satırı (DataStatus): <header> banner içindeki tek role="status". */
const headerStatus = () => within(screen.getByRole('banner')).getByRole('status');
/**
 * Gerçek hazır sinyali (e2e openAdmin ile aynı): belgede aria-busy="true" öğe kalmadı. Meşgul olan yalnız yüklenen
 * bölümdür — ayar iskeleti (LoadingShell) ve nesil okunurken (idle/checking) "Nesil kaynağı" satırı; sayfa kökü değil.
 * Yalnız başlık metnine bakmak yarışlıdır: depo her koleksiyon okumasında durumu yeniden "checking" yapar, bu yüzden
 * nesil "ready" olduktan sonra ayar koleksiyonu yüklenirken başlık yeniden "Okunuyor…" der; yük altında okuma
 * testing-library'nin 1 sn varsayılan bekleyişini de aşar (tam pakette görülen kararsızlık). Bütçe üst sınırdır, sabit
 * bekleme değildir: sinyal gelince hemen döner. Test zaman aşımından (5 sn) kısadır; düşen test nedenini söyler.
 */
const READY_BUDGET_MS = 4_500;
const busyElements = () => Array.from(document.querySelectorAll('[aria-busy="true"]'));
const waitReady = () =>
  waitFor(() => {
    expect(busyElements()).toEqual([]);
    expect(headerStatus()).not.toHaveTextContent('Okunuyor…');
  }, { timeout: READY_BUDGET_MS });

beforeEach(() => {
  localStorage.clear();
});

describe('AyarlarPage › başlık ve özet', () => {
  it('bölüm → h1 → amaç; özet en çok 3 ölçü: Nesil, Bekleyen değişiklik, Canlı bağlantı', async () => {
    renderPage();
    expect(screen.getByText('Uygulama')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Ayarlar' })).toBeInTheDocument();
    expect(screen.getByText('Aile bilgilerini, biçimleri, e-tablo bağlantısını ve üyeleri yönetin.')).toBeInTheDocument();
    await waitReady();
    const ozet = screen.getByRole('list', { name: 'Özet' });
    const olculer = within(ozet).getAllByRole('listitem');
    expect(olculer).toHaveLength(3);
    expect(olculer[0]).toHaveTextContent('Nesil');
    expect(olculer[0]).toHaveTextContent(GENERATION_ID.slice(0, 6));
    expect(olculer[1]).toHaveTextContent('Bekleyen değişiklik');
    expect(olculer[2]).toHaveTextContent('Canlı bağlantı');
    expect(olculer[2]).toHaveTextContent('Adres yok');
  });

  it('nesil okunurken DataStatus "Okunuyor…"; meşgul yalnız yüklenen bölüm (iskelet), kök değil; sonra "Nesil …" ve meşgul öğe yok', async () => {
    const { container } = renderPage({ source: new SlowFixtureSource(FILES, 'sentetik') });
    expect(headerStatus()).toHaveTextContent('Okunuyor…');
    // f05 sözleşmesi (e2e/admin-data-states): ilk meşgul öğe iskelet satırı taşır ve yükleme etiketi rakam/yüzde içermez.
    // Sayfa kökü meşgul olsaydı önbellek sayımı, kaynak adresi ve tarih biçimi örneği de "yükleme etiketi" sayılırdı.
    expect(container.querySelector('.aile-ayarlar')).not.toHaveAttribute('aria-busy', 'true');
    const ilk = busyElements()[0];
    expect(ilk, 'yüklenirken meşgul bir bölge var').toBeDefined();
    expect(ilk!.querySelector('[data-part="row"]'), 'iskelet satırı').not.toBeNull();
    expect(ilk!.textContent).not.toMatch(/\d|%/);
    expect(screen.getByRole('region', { name: 'Nesil kaynağı' })).toHaveAttribute('aria-busy', 'true');
    // Yüklenirken nesil içeriği "eksik" değil "okunuyor": "Henüz yok" yükleme sırasında yazılmaz.
    expect(within(screen.getByRole('region', { name: 'Nesil kaynağı' })).getByText('İçerik').nextElementSibling).toHaveTextContent('Okunuyor…');
    await waitReady();
    expect(headerStatus()).toHaveTextContent(`Nesil ${GENERATION_ID.slice(0, 6)}`);
    expect(headerStatus()).not.toHaveTextContent('Okunuyor…');
    // Hazır sinyali ayar koleksiyonunu da kapsar: Aile satırında iskelet kalmadı, değerler yazılı.
    expect(within(screen.getByRole('region', { name: 'Aile' })).queryByRole('status')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Biçimler' })).getByText('Türk lirası (₺)')).toBeInTheDocument();
  });

  it('kararsızlık regresyonu: okuma 1 sn varsayılan bekleyişten uzun sürse de hazır sinyali gerçek sonucu bekler', async () => {
    // Manifest (sağlayıcı + koleksiyon yükleyicisi) ve ayar parçası her biri 1,1 sn gecikir: toplam ≈ 3,3 sn.
    renderPage({ source: new SlowFixtureSource(FILES, 'sentetik', 1_100) });
    expect(busyElements().length).toBeGreaterThan(0);
    await waitFor(() => expect(busyElements()).toEqual([]), { timeout: 12_000 });
    expect(headerStatus()).toHaveTextContent(`Nesil ${GENERATION_ID.slice(0, 6)}`);
    expect(within(screen.getByRole('region', { name: 'Biçimler' })).getByText('Türk lirası (₺)')).toBeInTheDocument();
  }, 15_000);

  it('bozuk manifest: tazelik satırı "Hata:" der, özet nesil "Henüz yok"', async () => {
    renderPage({ source: fixtureSource({ 'manifest.json': '{bozuk' }) });
    await waitFor(() => expect(headerStatus()).toHaveTextContent(/^Hata: /));
    const ozet = screen.getByRole('list', { name: 'Özet' });
    expect(within(ozet).getAllByRole('listitem')[0]).toHaveTextContent('Henüz yok');
  });
});

describe('AyarlarPage › nesil okunamadı → Yeniden dene', () => {
  it('manifest okunamazsa tek ErrorState nesil nedenini yazar; kaynak düzelince Yeniden dene ayarları getirir', async () => {
    const user = userEvent.setup();
    const source = new FlakyFixtureSource(FILES, 'sentetik');
    source.failNext();
    renderPage({ source });
    await waitFor(() => expect(headerStatus()).toHaveTextContent(/^Hata: /));
    const hatalar = await screen.findAllByRole('alert');
    expect(hatalar, 'aynı neden iki kez duyurulmaz').toHaveLength(1);
    expect(hatalar[0]).toHaveTextContent('Sentetik kesinti: kaynağa ulaşılamadı');
    expect(within(screen.getByRole('region', { name: 'Aile' })).getByRole('alert')).toBe(hatalar[0]);
    expect(within(screen.getByRole('region', { name: 'Biçimler' })).getByText('Para birimi').nextElementSibling).toHaveTextContent('Bilinmiyor');
    expect(busyElements()).toEqual([]);

    source.recover();
    await user.click(within(hatalar[0]!).getByRole('button', { name: 'Yeniden dene' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Biçimler' })).getByText('Türk lirası (₺)')).toBeInTheDocument(), { timeout: READY_BUDGET_MS });
    expect(screen.queryAllByRole('alert'), 'kaynak düzelince ErrorState kalkar').toEqual([]);
    await waitReady();
    expect(headerStatus()).toHaveTextContent(`Nesil ${GENERATION_ID.slice(0, 6)}`);
  });
});

describe('AyarlarPage › Aile ve Biçimler (ayar koleksiyonu, salt okunur)', () => {
  it('fixture: para birimi TRY → "Türk lirası (₺)", aile adı ve ay başlangıcı "Henüz yok", tarih biçimi sabit', async () => {
    renderPage();
    await waitReady();
    const aile = screen.getByRole('region', { name: 'Aile' });
    await waitFor(() => expect(within(aile).getByText('Aile adı').nextElementSibling).toHaveTextContent('Henüz yok'));
    expect(within(aile).getByText('Ay başlangıç günü').nextElementSibling).toHaveTextContent('Henüz yok');
    expect(within(aile).getByText(/panel bu alanları yazmaz/i)).toBeInTheDocument();
    const bicimler = screen.getByRole('region', { name: 'Biçimler' });
    expect(within(bicimler).getByText('Para birimi').nextElementSibling).toHaveTextContent('Türk lirası (₺)');
    expect(within(bicimler).getByText('Tarih biçimi').nextElementSibling).toHaveTextContent('gg.aa.yyyy (28.10.2026)');
  });

  it('ayar koleksiyonu nesilde yoksa dürüst metin: "Kaynakta ayar kaydı yok"', async () => {
    renderPage({ source: fixtureSource({ 'manifest.json': manifestWithoutSettings() }) });
    await waitReady();
    const aile = screen.getByRole('region', { name: 'Aile' });
    await waitFor(() => expect(within(aile).getByText('Kaynakta ayar kaydı yok.')).toBeInTheDocument());
    const bicimler = screen.getByRole('region', { name: 'Biçimler' });
    expect(within(bicimler).getByText('Kaynakta ayar kaydı yok.')).toBeInTheDocument();
  });

  it('ayar parçası okunamazsa ErrorState "Hata: …" + "Yeniden dene"; eski değer gösterilmez', async () => {
    renderPage({ source: fixtureSource({ 'data/settings/household/00000.json': null }) });
    await waitReady();
    const aile = screen.getByRole('region', { name: 'Aile' });
    await waitFor(() => expect(within(aile).getAllByText(/^Hata: /).length).toBeGreaterThan(0));
    expect(within(aile).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(within(aile).queryByText('Türk lirası (₺)')).not.toBeInTheDocument();
  });
});

describe('AyarlarPage › Nesil kaynağı', () => {
  it('kaynak etiketi, koleksiyon/kayıt sayısı; klasör seçimi desteklenmiyorsa düğme yok, nedeni yazılı', async () => {
    renderPage();
    await waitReady();
    const nesil = screen.getByRole('region', { name: 'Nesil kaynağı' });
    expect(within(nesil).getByText('Sentetik nesil (sentetik)')).toBeInTheDocument();
    const toplam = Object.values(MANIFEST.counts).reduce((sum, count) => sum + count, 0);
    expect(within(nesil).getByText(`${Object.keys(MANIFEST.counts).length} koleksiyon · ${toplam} kayıt`)).toBeInTheDocument();
    expect(within(nesil).queryByRole('button', { name: 'Klasör seç' })).not.toBeInTheDocument();
    expect(within(nesil).getByText(/klasör seçmeyi desteklemiyor/i)).toBeInTheDocument();
    expect(within(nesil).getByRole('button', { name: 'Yenile' })).toBeInTheDocument();
    expect(within(nesil).queryByText(/Eski veri/)).not.toBeInTheDocument();
  });

  it('eski veri (stale): yenileme başarısızsa son iyi nesil kalır, "Eski veri" ve "yenilenemedi" ayrı adıyla yazılır', async () => {
    const user = userEvent.setup();
    const source = new FlakyFixtureSource(FILES, 'sentetik');
    renderPage({ source });
    await waitReady();
    const nesil = screen.getByRole('region', { name: 'Nesil kaynağı' });
    source.failNext();
    await user.click(within(nesil).getByRole('button', { name: 'Yenile' }));
    await waitFor(() => expect(headerStatus()).toHaveTextContent('yenilenemedi'));
    await waitReady();
    // Eski veri notu canlı bölgede (role=status): duyurulur, içerik metnine karışmaz (f05: son iyi veri aynen yerinde).
    expect(within(nesil).getByText(/^Eski veri: son başarılı nesil gösteriliyor/).closest('[role="status"]')).not.toBeNull();
    // Son iyi nesil korunur: içerik sayımı ve ayar değerleri gösterilmeye devam eder; hata sayılmaz.
    const toplam = Object.values(MANIFEST.counts).reduce((sum, count) => sum + count, 0);
    expect(within(nesil).getByText(`${Object.keys(MANIFEST.counts).length} koleksiyon · ${toplam} kayıt`)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Biçimler' })).getByText('Türk lirası (₺)')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem')[0]).toHaveTextContent(GENERATION_ID.slice(0, 6));
  });
});

describe('AyarlarPage › Canlı bağlantı (Apps Script, yalnız bu tarayıcıda)', () => {
  it('adres ve anahtar alanları; anahtar maskeli; saklama notu; başta "Adres yok", "Anahtar yok" ve Kaydet devre dışı', async () => {
    renderPage();
    await waitReady();
    const canli = screen.getByRole('region', { name: 'Canlı bağlantı' });
    const adres = within(canli).getByLabelText('Apps Script adresi');
    const anahtar = within(canli).getByLabelText('Uygulama anahtarı');
    expect(adres).toHaveValue('');
    expect(anahtar).toHaveAttribute('type', 'password');
    expect(anahtar).toHaveValue('');
    expect(within(canli).getAllByText(/yalnız bu tarayıcıda saklanır/i).length).toBeGreaterThan(0);
    expect(within(canli).getByText('Adres yok')).toBeInTheDocument();
    expect(within(canli).getByText('Anahtar yok')).toBeInTheDocument();
    expect(within(canli).queryByRole('button', { name: 'Anahtarı sil' })).not.toBeInTheDocument();
    expect(within(canli).getByRole('button', { name: 'Kaydet' })).toBeDisabled();
    expect(within(canli).getByText('Değişiklik yok')).toBeInTheDocument();
  });

  it('geçersiz adres: alan hatası "Hata: …", altlık "Hata: 1 alan düzeltilmeli"; geçerli adres ve anahtar kaydedilir, anahtar alanı boşalır', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await waitReady();
    const canli = screen.getByRole('region', { name: 'Canlı bağlantı' });
    const adres = within(canli).getByLabelText('Apps Script adresi');
    await user.type(adres, 'https://ornek.invalid/x');
    expect(adres).toHaveAccessibleDescription(/^Hata: /);
    expect(within(canli).getByText(/^Hata: 1 alan düzeltilmeli/)).toBeInTheDocument();
    expect(within(canli).getByRole('button', { name: 'Kaydet' })).toBeDisabled();

    await user.clear(adres);
    await user.type(adres, 'https://script.google.com/macros/s/ORNEK/exec');
    expect(within(canli).getByText('Kaydedilmemiş değişiklik var')).toBeInTheDocument();
    const anahtar = within(canli).getByLabelText('Uygulama anahtarı');
    await user.type(anahtar, 'test-anahtar');
    await user.click(within(canli).getByRole('button', { name: 'Kaydet' }));
    expect(localStorage.getItem('aile:apiUrl')).toBe('https://script.google.com/macros/s/ORNEK/exec');
    expect(localStorage.getItem('aile:appKey')).toBe('test-anahtar');
    expect(within(canli).getByText('Hazır')).toBeInTheDocument();
    expect(within(canli).getByText('Anahtar kayıtlı')).toBeInTheDocument();
    expect(within(canli).getByText('Değişiklik yok')).toBeInTheDocument();
    // Kaydedilen anahtar alana geri yazılmaz; DOM'da (metin, öznitelik, alan değeri) hiçbir biçimde yok.
    expect(anahtar).toHaveValue('');
    expect(container.innerHTML).not.toContain('test-anahtar');
    expect(document.body.textContent).not.toContain('test-anahtar');
  });

  it('kayıtlı anahtar asla gösterilmez: alan boş başlar, durum "Anahtar kayıtlı"; boş alan anahtarı silmez', async () => {
    const user = userEvent.setup();
    localStorage.setItem('aile:apiUrl', 'https://script.google.com/macros/s/KAYITLI/exec');
    localStorage.setItem('aile:appKey', 'kayitli-gizli-anahtar');
    const { container } = renderPage();
    await waitReady();
    const canli = screen.getByRole('region', { name: 'Canlı bağlantı' });
    const anahtar = within(canli).getByLabelText('Uygulama anahtarı');
    expect(anahtar).toHaveValue('');
    expect(within(canli).getByText('Anahtar kayıtlı')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('kayitli-gizli-anahtar');
    for (const input of Array.from(document.querySelectorAll('input, textarea'))) {
      expect((input as HTMLInputElement).value).not.toContain('kayitli-gizli-anahtar');
    }
    // Yalnız adres değişir: anahtar korunur (boş alan "sil" demek değildir).
    const adres = within(canli).getByLabelText('Apps Script adresi');
    await user.clear(adres);
    await user.type(adres, 'https://script.google.com/macros/s/YENI/exec');
    await user.click(within(canli).getByRole('button', { name: 'Kaydet' }));
    expect(localStorage.getItem('aile:apiUrl')).toBe('https://script.google.com/macros/s/YENI/exec');
    expect(localStorage.getItem('aile:appKey')).toBe('kayitli-gizli-anahtar');
  });

  it('Anahtarı sil: taslakta işaretlenir, Vazgeç geri alır, Kaydet anahtarı siler', async () => {
    const user = userEvent.setup();
    localStorage.setItem('aile:apiUrl', 'https://script.google.com/macros/s/KAYITLI/exec');
    localStorage.setItem('aile:appKey', 'kayitli-gizli-anahtar');
    renderPage();
    await waitReady();
    const canli = screen.getByRole('region', { name: 'Canlı bağlantı' });
    await user.click(within(canli).getByRole('button', { name: 'Anahtarı sil' }));
    expect(within(canli).getByText('Anahtar kaydedince silinecek')).toBeInTheDocument();
    expect(within(canli).getByText('Kaydedilmemiş değişiklik var')).toBeInTheDocument();
    await user.click(within(canli).getByRole('button', { name: 'Vazgeç' }));
    expect(within(canli).getByText('Anahtar kayıtlı')).toBeInTheDocument();
    expect(localStorage.getItem('aile:appKey')).toBe('kayitli-gizli-anahtar');

    await user.click(within(canli).getByRole('button', { name: 'Anahtarı sil' }));
    await user.click(within(canli).getByRole('button', { name: 'Kaydet' }));
    expect(localStorage.getItem('aile:appKey')).toBeNull();
    expect(within(canli).getByText('Anahtar yok')).toBeInTheDocument();
    expect(localStorage.getItem('aile:apiUrl')).toBe('https://script.google.com/macros/s/KAYITLI/exec');
  });

  it('Vazgeç taslağı kayıtlı değere döndürür', async () => {
    const user = userEvent.setup();
    localStorage.setItem('aile:apiUrl', 'https://script.google.com/macros/s/KAYITLI/exec');
    renderPage();
    await waitReady();
    const canli = screen.getByRole('region', { name: 'Canlı bağlantı' });
    const adres = within(canli).getByLabelText('Apps Script adresi');
    expect(adres).toHaveValue('https://script.google.com/macros/s/KAYITLI/exec');
    await user.type(adres, 'x');
    await user.type(within(canli).getByLabelText('Uygulama anahtarı'), 'yeni');
    await user.click(within(canli).getByRole('button', { name: 'Vazgeç' }));
    expect(adres).toHaveValue('https://script.google.com/macros/s/KAYITLI/exec');
    expect(within(canli).getByLabelText('Uygulama anahtarı')).toHaveValue('');
    expect(within(canli).getByText('Değişiklik yok')).toBeInTheDocument();
  });
});

describe('AyarlarPage › Bütçe e-tablosu (ortam)', () => {
  it('kimlik yoksa "tanımlı değil"; varsa "tanımlı" ve kimlik sayfada yazılmaz', async () => {
    const { unmount } = renderPage({ budgetSheetId: '' });
    await waitReady();
    let butce = screen.getByRole('region', { name: 'Bütçe e-tablosu' });
    expect(within(butce).getByText(/tanımlı değil/i)).toBeInTheDocument();
    unmount();

    renderPage({ budgetSheetId: 'SENTETIK-KIMLIK-123' });
    await waitReady();
    butce = screen.getByRole('region', { name: 'Bütçe e-tablosu' });
    expect(within(butce).getByText(/kimlik tanımlı \(VITE_BUDGET_SHEET_ID\)/i)).toBeInTheDocument();
    expect(butce.textContent).not.toContain('SENTETIK-KIMLIK-123');
  });

  it('son canlı okuma yerel son iyi okumadan (ağ yok): İstanbul saatiyle; hiç okunmadıysa "Henüz yok"; okunamazsa "Bilinmiyor"', async () => {
    const okuma = vi.fn(async () => '2026-10-28T11:32:00.000Z');
    const { unmount } = renderPage({ budgetSheetId: 'SENTETIK-KIMLIK-123', liveLastRead: okuma });
    await waitReady();
    const sonOkuma = () => within(screen.getByRole('region', { name: 'Bütçe e-tablosu' })).getByText('Son canlı okuma').nextElementSibling;
    await waitFor(() => expect(sonOkuma()).toHaveTextContent('28.10.2026 14:32'));
    expect(okuma).toHaveBeenCalledTimes(1);
    unmount();

    const hic = renderPage({ budgetSheetId: 'SENTETIK-KIMLIK-123', liveLastRead: async () => null });
    await waitReady();
    await waitFor(() => expect(sonOkuma()).toHaveTextContent('Henüz yok'));
    expect(within(screen.getByRole('region', { name: 'Bütçe e-tablosu' })).getByText(/Bütçe sayfası açılınca okunur/)).toBeInTheDocument();
    hic.unmount();

    renderPage({ budgetSheetId: 'SENTETIK-KIMLIK-123', liveLastRead: async () => { throw new Error('kilitli'); } });
    await waitReady();
    await waitFor(() => expect(sonOkuma()).toHaveTextContent('Bilinmiyor'));
  });
});

describe('AyarlarPage › Değişiklik kümesi', () => {
  it('küme kapalıyken bekleyen sayısı "Bilinmiyor" ve önizleme kapalı', async () => {
    renderPage({ changeSet: null });
    await waitReady();
    const kume = screen.getByRole('region', { name: 'Değişiklik kümesi' });
    expect(within(kume).getByText('Bekleyen değişiklik: Bilinmiyor')).toBeInTheDocument();
    expect(within(kume).getByRole('button', { name: /Dışa aktarma önizlemesi/ })).toBeDisabled();
  });

  it('bekleyen op sayısı ve dışa aktarma önizlemesi (toBatch JSON; gönderme yok)', async () => {
    const user = userEvent.setup();
    const changeSet = await ChangeSet.load({ storage: createMemoryStorage(), now: () => '2026-10-28T14:05:00.000Z', newId: () => 'OP001' });
    await changeSet.add({ recordId: LAMBADER.id, kind: 'note', before: { note: null }, after: { note: 'Sentetik not' } });
    renderPage({ changeSet: () => Promise.resolve(changeSet) });
    await waitReady();
    const kume = screen.getByRole('region', { name: 'Değişiklik kümesi' });
    await waitFor(() => expect(within(kume).getByText('1 bekleyen değişiklik')).toBeInTheDocument());
    const ozet = screen.getByRole('list', { name: 'Özet' });
    expect(within(ozet).getAllByRole('listitem')[1]).toHaveTextContent('1');
    expect(within(kume).getByText(/e-tabloya gönderme bu sürümde yok/i)).toBeInTheDocument();

    await user.click(within(kume).getByRole('button', { name: /Dışa aktarma önizlemesi/ }));
    const json = await within(kume).findByLabelText('Dışa aktarma JSON');
    await waitFor(() => expect(json).toHaveTextContent('"op": "upsert"'));
    expect(json).toHaveTextContent('"id": "kalem-027"');
    expect(json).toHaveTextContent('"opId": "OP001"');
    expect(json).toHaveTextContent('"not": "Sentetik not"');
    expect(within(kume).getByText(/1 işlem gönderilebilir · 0 atlandı · gönderme yok/)).toBeInTheDocument();
    expect(within(kume).queryByRole('button', { name: /Gönder/ })).not.toBeInTheDocument();
  });
});

describe('AyarlarPage › Değişiklik kümesini dışa aktarma (gizli değer yok)', () => {
  async function bekleyenKume() {
    const changeSet = await ChangeSet.load({ storage: createMemoryStorage(), now: () => '2026-10-28T14:05:00.000Z', newId: () => 'OP001' });
    await changeSet.add({ recordId: LAMBADER.id, kind: 'note', before: { note: null }, after: { note: 'Sentetik not' } });
    return changeSet;
  }

  it('indirme: dosya adı nesil + İstanbul zamanı; içerik önizlemeyle aynı oplar; adres ve anahtar dosyada yok', async () => {
    const user = userEvent.setup();
    localStorage.setItem('aile:apiUrl', 'https://script.google.com/macros/s/GIZLI-DAGITIM/exec');
    localStorage.setItem('aile:appKey', 'gizli-uygulama-anahtari');
    const changeSet = await bekleyenKume();
    const saveFile = vi.fn();
    renderPage({ changeSet: () => Promise.resolve(changeSet), saveFile, now: () => new Date('2026-10-28T21:30:00.000Z') });
    await waitReady();
    const kume = screen.getByRole('region', { name: 'Değişiklik kümesi' });
    await waitFor(() => expect(within(kume).getByText('1 bekleyen değişiklik')).toBeInTheDocument());
    // İndirme düğmesi önizleme açılıp kayıtlar okununca çıkar (yedi kalem koleksiyonu yalnız o zaman yüklenir).
    expect(within(kume).queryByRole('button', { name: 'Değişiklik kümesini indir' })).not.toBeInTheDocument();
    await user.click(within(kume).getByRole('button', { name: /Dışa aktarma önizlemesi/ }));
    const indir = await within(kume).findByRole('button', { name: 'Değişiklik kümesini indir' }, { timeout: READY_BUDGET_MS });
    await user.click(indir);

    expect(saveFile).toHaveBeenCalledTimes(1);
    const [name, text] = saveFile.mock.calls[0] as [string, string];
    expect(name).toBe(`aile-degisiklik-kumesi-${GENERATION_ID.slice(0, 6)}-20261029-0030.json`);
    const parsed = JSON.parse(text) as Record<string, unknown> & { ops: { opId: string }[] };
    expect(Object.keys(parsed)).toEqual(['schemaVersion', 'kind', 'generation_id', 'exported_at', 'pending', 'ops', 'skipped']);
    expect(parsed.kind).toBe('aile-change-set-batch');
    expect(parsed.generation_id).toBe(GENERATION_ID);
    expect(parsed.exported_at).toBe('2026-10-28T21:30:00.000Z');
    expect(parsed.ops.map((op) => op.opId)).toEqual(['OP001']);
    expect(text).not.toContain('gizli-uygulama-anahtari');
    expect(text).not.toContain('GIZLI-DAGITIM');
    expect(within(kume).getByText(`İndirme başlatıldı: ${name}`).closest('[role="status"]')).not.toBeNull();
    // Önizleme de gizli değer taşımaz.
    expect(within(kume).getByLabelText('Dışa aktarma JSON').textContent).not.toContain('gizli-uygulama-anahtari');
  });

  it('bekleyen değişiklik yoksa indirme yok; nedeni yazılı', async () => {
    const changeSet = await ChangeSet.load({ storage: createMemoryStorage() });
    renderPage({ changeSet: () => Promise.resolve(changeSet) });
    await waitReady();
    const kume = screen.getByRole('region', { name: 'Değişiklik kümesi' });
    await waitFor(() => expect(within(kume).getByText('Bekleyen değişiklik yok')).toBeInTheDocument());
    expect(within(kume).getByRole('button', { name: /Dışa aktarma önizlemesi/ })).toBeDisabled();
    expect(within(kume).queryByRole('button', { name: 'Değişiklik kümesini indir' })).not.toBeInTheDocument();
  });
});

describe('AyarlarPage › Önbellek (onaylı temizleme)', () => {
  it('sayım gösterilir; Önbelleği temizle onay ister, Vazgeç hiçbir şey silmez', async () => {
    const user = userEvent.setup();
    const cache = fakeCache(3);
    renderPage({ cacheControl: cache.control });
    await waitReady();
    const onbellek = screen.getByRole('region', { name: 'Önbellek' });
    await waitFor(() => expect(within(onbellek).getByText('3 parça', { exact: true })).toBeInTheDocument());
    expect(within(onbellek).getByText(/bekleyen değişiklikleri, adresi ve anahtarı silmez/i)).toBeInTheDocument();
    await user.click(within(onbellek).getByRole('button', { name: 'Önbelleği temizle' }));
    const onay = await screen.findByRole('alertdialog', { name: 'Önbellek temizlensin mi?' });
    expect(onay).toHaveTextContent('3 parça silinir');
    expect(onay).toHaveTextContent('Geri alınamaz');
    await user.click(within(onay).getByRole('button', { name: 'Vazgeç' }));
    expect(cache.clear).not.toHaveBeenCalled();
    expect(within(onbellek).getByText('3 parça', { exact: true })).toBeInTheDocument();
  });

  it('onay: temizler, sonucu adıyla duyurur, bekleyen değişiklikleri korur ve yeniden sayar', async () => {
    const user = userEvent.setup();
    const cache = fakeCache(4);
    const changeSet = await ChangeSet.load({ storage: createMemoryStorage(), now: () => '2026-10-28T14:05:00.000Z', newId: () => 'OP001' });
    await changeSet.add({ recordId: LAMBADER.id, kind: 'note', before: { note: null }, after: { note: 'Sentetik not' } });
    renderPage({ cacheControl: cache.control, changeSet: () => Promise.resolve(changeSet) });
    await waitReady();
    const onbellek = screen.getByRole('region', { name: 'Önbellek' });
    await waitFor(() => expect(within(onbellek).getByText('4 parça', { exact: true })).toBeInTheDocument());
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Değişiklik kümesi' })).getByText('1 bekleyen değişiklik')).toBeInTheDocument());
    await user.click(within(onbellek).getByRole('button', { name: 'Önbelleği temizle' }));
    const onay = await screen.findByRole('alertdialog', { name: 'Önbellek temizlensin mi?' });
    expect(onay).toHaveTextContent('Korunur: 1 bekleyen değişiklik, Apps Script adresi ve uygulama anahtarı.');
    await user.click(within(onay).getByRole('button', { name: 'Önbelleği temizle' }));
    expect(cache.clear).toHaveBeenCalledTimes(1);
    const sonuc = await within(onbellek).findByText(/^Önbellek temizlendi: 4 parça silindi\./);
    expect(sonuc.closest('[role="status"]')).not.toBeNull();
    expect(sonuc).toHaveTextContent('Bekleyen 1 değişiklik korundu.');
    await waitFor(() => expect(within(onbellek).getByText('0 parça', { exact: true })).toBeInTheDocument());
    expect(changeSet.pending).toBe(1);
  });

  it('temizleme başarısızsa "Hata: …" ve nasıl düzeleceği; sayım değişmez', async () => {
    const user = userEvent.setup();
    const cache = fakeCache(2, { clear: vi.fn(async () => { throw new Error('QuotaExceededError'); }) });
    renderPage({ cacheControl: cache.control });
    await waitReady();
    const onbellek = screen.getByRole('region', { name: 'Önbellek' });
    await waitFor(() => expect(within(onbellek).getByText('2 parça', { exact: true })).toBeInTheDocument());
    await user.click(within(onbellek).getByRole('button', { name: 'Önbelleği temizle' }));
    const onay = await screen.findByRole('alertdialog', { name: 'Önbellek temizlensin mi?' });
    await user.click(within(onay).getByRole('button', { name: 'Önbelleği temizle' }));
    expect(await within(onbellek).findByText(/^Hata: önbellek temizlenemedi \(QuotaExceededError\)\. Sayfayı yenileyip yeniden deneyin\.$/)).toBeInTheDocument();
    expect(within(onbellek).getByText('2 parça', { exact: true })).toBeInTheDocument();
  });

  it('sayım okunamazsa "Bilinmiyor"; IndexedDB yoksa düğme yok, nedeni yazılı', async () => {
    const { unmount } = renderPage({ cacheControl: fakeCache(1, { count: vi.fn(async () => { throw new Error('kilitli'); }) }).control });
    await waitReady();
    let onbellek = screen.getByRole('region', { name: 'Önbellek' });
    await waitFor(() => expect(within(onbellek).getByText('Önbellekteki nesil parçası').nextElementSibling).toHaveTextContent('Bilinmiyor'));
    unmount();

    renderPage({ cacheControl: { available: false, count: vi.fn(async () => 0), clear: vi.fn(async () => 0) } });
    await waitReady();
    onbellek = screen.getByRole('region', { name: 'Önbellek' });
    expect(within(onbellek).getByText('Bu tarayıcıda önbellek yok; temizlenecek bir şey yok.')).toBeInTheDocument();
    expect(within(onbellek).queryByRole('button', { name: 'Önbelleği temizle' })).not.toBeInTheDocument();
  });

  it('telefonda onay alttan sayfa (dialog) olarak açılır ve aynı eylemleri taşır', async () => {
    const user = userEvent.setup();
    const cache = fakeCache(2);
    renderPage({ device: 'phone', cacheControl: cache.control });
    await waitReady();
    const onbellek = screen.getByRole('region', { name: 'Önbellek' });
    await waitFor(() => expect(within(onbellek).getByText('2 parça', { exact: true })).toBeInTheDocument());
    await user.click(within(onbellek).getByRole('button', { name: 'Önbelleği temizle' }));
    const sayfa = await screen.findByRole('dialog', { name: 'Önbellek temizlensin mi?' });
    await user.click(within(sayfa).getByRole('button', { name: 'Önbelleği temizle' }));
    expect(cache.clear).toHaveBeenCalledTimes(1);
    expect(await within(onbellek).findByText(/^Önbellek temizlendi: 2 parça silindi\./)).toBeInTheDocument();
  });
});

describe('AyarlarPage › Üyeler ve yerleşim', () => {
  it('üye koleksiyonu yok: "Kaynakta üye kaydı yok" ve işlevsiz davet düğmesi yok', async () => {
    renderPage();
    await waitReady();
    const uyeler = screen.getByRole('region', { name: 'Üyeler' });
    expect(within(uyeler).getByText('Kaynakta üye kaydı yok.')).toBeInTheDocument();
    expect(within(uyeler).queryByRole('button', { name: /davet/i })).not.toBeInTheDocument();
  });

  it('masaüstünde geniş düzen, telefonda dar düzen (alt alta)', async () => {
    const wide = renderPage({ device: 'desktop' });
    await waitReady();
    expect(wide.container.querySelector('.aile-ayarlar')).toHaveAttribute('data-narrow', 'false');
    wide.unmount();

    const phone = renderPage({ device: 'phone' });
    await waitReady();
    expect(phone.container.querySelector('.aile-ayarlar')).toHaveAttribute('data-narrow', 'true');
    // Satır başlıkları hâlâ sırayla ve kesilmeden var.
    for (const name of ['Aile', 'Biçimler', 'Nesil kaynağı', 'Canlı bağlantı', 'Bütçe e-tablosu', 'Değişiklik kümesi', 'Önbellek', 'Üyeler']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });
});
