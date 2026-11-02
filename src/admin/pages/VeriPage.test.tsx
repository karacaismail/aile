// Veri kalitesi ve içe aktarma sayfası. Tasarım: bundle.js Pages.VeriKalitesi (Sec blokları: sorun listesi, geçmiş
// tablosu), README "Sayfa iskeleti" ve "Veri durumları". Veri gerçek katmandan gelir: GenerationProvider +
// FixtureGenerationSource (sentetik nesil belleğe okunur); depo, sözleşme ve koleksiyon yükleyici gerçektir.
// Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok. Para yok: bu sayfada plan ve gerçek tutar yoktur,
// yalnız sayımlar vardır; sayımlar koleksiyon başına ayrı yazılır, hiçbir yerde toplanıp tek sayıya indirilmez.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { FixtureGenerationSource, GenerationProvider, type GenerationHandle, type GenerationSource, type Manifest } from '../data';
import { VeriPage, dataStatusFor } from './VeriPage';

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
const ISSUE_COUNT = MANIFEST.counts.issues!;
const SOURCE_COUNT = MANIFEST.counts.sources!;
const SHEET_COUNT = MANIFEST.counts.sheets!;
const sayi = new Intl.NumberFormat('tr-TR');

function fixtureSource(files: Record<string, string> = FILES): FixtureGenerationSource {
  return new FixtureGenerationSource(files, 'sentetik');
}

/** issues koleksiyonu nesilde hiç yoksa (manifest + parçalar): sayfa "Kaynakta sorun kaydı yok" demeli. */
function withoutIssues(): Record<string, string> {
  const files = { ...FILES };
  for (const path of Object.keys(files)) if (path.startsWith('data/issues/')) delete files[path];
  const manifest = JSON.parse(files['manifest.json']!) as Manifest;
  manifest.files = manifest.files.filter(file => file.collection !== 'issues');
  delete manifest.counts.issues;
  files['manifest.json'] = JSON.stringify(manifest);
  return files;
}

/** İlk okuma başarılı, sonra her okuma başarısız: refresh → stale (son iyi nesil korunur). */
class FlakySource implements GenerationSource {
  readonly kind = 'fixture' as const;
  readonly label = 'kesintili';
  failing = false;
  readonly reads: string[] = [];
  private readonly inner = fixtureSource();
  async readText(path: string): Promise<string> {
    this.reads.push(path);
    if (this.failing) throw new Error('bağlantı kesildi');
    return this.inner.readText(path);
  }
}

function renderPage({ source = fixtureSource(), device = 'desktop' as Device }: { source?: GenerationSource; device?: Device } = {}) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DeviceContext.Provider value={device}>
        <GenerationProvider source={source} cache={null} changeSet={null}>
          {children}
        </GenerationProvider>
      </DeviceContext.Provider>
    );
  }
  return render(<VeriPage />, { wrapper: Wrapper });
}

const section = (name: string) => screen.getByRole('region', { name });
// role="status" ad almaz (yalnız yazar adı); DataStatus data-state, LoadingShell aria-busy ile ayrılır.
const veriDurumu = () => {
  const el = screen.getAllByRole('status').find(node => node.hasAttribute('data-state'));
  if (!el) throw new Error('Veri durumu satırı yok');
  return el;
};
const yukleniyor = () => screen.queryAllByRole('status').filter(node => node.getAttribute('aria-busy') === 'true');
const waitForFresh = () => waitFor(() => expect(veriDurumu()).toHaveAttribute('data-state', 'fresh'));
/**
 * Sayfa durulana dek bekler: nesil taze, hiçbir bölüm okunmuyor ve "Yenile" etkin. Yalnız "fresh" yetmez: manifest
 * hazır olunca alt bölümler (Kaynaklar/Sayfalar) etkilerinde koleksiyon ister; depo yeniden "checking" olur ve DataStatus
 * sözleşmesi gereği "Yenile" bu sürede devre dışıdır. Bu arada tıklanan düğme hiçbir şey yapmaz (yük altında kararsızlık).
 */
const waitForSettled = () =>
  waitFor(() => {
    expect(veriDurumu()).toHaveAttribute('data-state', 'fresh');
    expect(yukleniyor()).toHaveLength(0);
    expect(within(veriDurumu()).getByRole('button', { name: 'Yenile' })).toBeEnabled();
  });
// antd yapışkan başlık ayrı bir <table> içindedir: gövde satırları hücresi olan satırlardır (başlık satırı değil).
const bodyRows = (scope: HTMLElement) => within(scope).getAllByRole('row').filter(row => within(row).queryAllByRole('cell').length > 0);

afterEach(() => {
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

// --- Başlık ve özet -----------------------------------------------------------------------------------
describe('VeriPage › başlık', () => {
  it('bölüm, h1, amaç ve tazelik satırı; özet en çok üç ölçü ve sayımlar ayrı', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Veri kalitesi ve içe aktarma' })).toBeInTheDocument();
    expect(screen.getByText('Yapı')).toBeInTheDocument();
    expect(screen.getByText('E-tablodan gelen veriyi içe aktarın, eşleşmeyen satırları ve çakışmaları çözün.')).toBeInTheDocument();

    await waitForFresh();
    const durum = veriDurumu();
    expect(durum).toHaveTextContent(`Nesil ${GENERATION_ID.slice(0, 6)}`);

    const ozet = screen.getByRole('list', { name: 'Özet' });
    const olculer = within(ozet).getAllByRole('listitem');
    expect(olculer).toHaveLength(3);
    expect(olculer[0]).toHaveTextContent('Çözülecek sorun');
    expect(olculer[0]).toHaveTextContent(sayi.format(ISSUE_COUNT));
    expect(olculer[1]).toHaveTextContent('Kaynak');
    expect(olculer[1]).toHaveTextContent(sayi.format(SOURCE_COUNT));
    expect(olculer[1]).toHaveTextContent(`${sayi.format(SHEET_COUNT)} sayfa`);
    expect(olculer[2]).toHaveTextContent('Koleksiyon');
    expect(olculer[2]).toHaveTextContent(sayi.format(Object.keys(MANIFEST.counts).length));
  });

  it('para ya da birleşik plan/gerçek toplamı yoktur; sayımlar koleksiyon başına ayrı yazılır', async () => {
    const view = renderPage();
    await waitForFresh();
    await waitFor(() => expect(section('Nesil')).toHaveTextContent('purchase_needs'));
    expect(view.container.textContent).not.toMatch(/₺/);
    const nesil = section('Nesil');
    // Her koleksiyonun kendi sayısı; toplam satırı yok.
    expect(within(nesil).getByRole('row', { name: /purchase_needs/ })).toHaveTextContent(sayi.format(MANIFEST.counts.purchase_needs!));
    expect(within(nesil).getByRole('row', { name: /budget_observations/ })).toHaveTextContent(sayi.format(MANIFEST.counts.budget_observations!));
    expect(within(nesil).queryByRole('row', { name: /Toplam/ })).toBeNull();
  });
});

// --- Sorun kuyruğu -------------------------------------------------------------------------------------
describe('VeriPage › çözülecek sorunlar', () => {
  it('issues koleksiyonunu tür, kaynak, etki ve durum sütunlarıyla tabloda gösterir', async () => {
    renderPage();
    await waitFor(() => expect(section('Çözülecek sorunlar')).not.toHaveTextContent('Yükleniyor'));
    const sorunlar = section('Çözülecek sorunlar');
    expect(within(sorunlar).getByRole('heading', { level: 2, name: 'Çözülecek sorunlar' })).toBeInTheDocument();
    expect(within(sorunlar).getByText(`${sayi.format(ISSUE_COUNT)} kayıt`)).toBeInTheDocument();

    expect(within(sorunlar).getByRole('table', { name: 'Çözülecek sorunlar' })).toBeInTheDocument();
    const basliklar = within(sorunlar).getAllByRole('columnheader').map(cell => cell.textContent);
    expect(basliklar).toEqual(['Tür', 'Kaynak', 'Etki', 'Durum']);
    expect(bodyRows(sorunlar)).toHaveLength(ISSUE_COUNT);

    // Kod → Türkçe tür; kaynak sayfa + hücre; etki ayrıntıdan; durum sözcükle (renk tek işaret değil).
    expect(within(sorunlar).getAllByText('Formül hatası')).toHaveLength(2);
    expect(within(sorunlar).getByRole('row', { name: /Gerçekleşen · G9/ })).toHaveTextContent('Formül hatası');
    expect(within(sorunlar).getByRole('row', { name: /Bilinmeyen terim/ })).toHaveTextContent('Sözlük: category');
    expect(within(sorunlar).getAllByText('Gözden geçirilecek')).toHaveLength(ISSUE_COUNT);
  });

  it('telefonda türe göre gruplanmış akordeondur; ilk satır açık gelir', async () => {
    const { container } = renderPage({ device: 'phone' });
    await waitFor(() => expect(section('Çözülecek sorunlar')).not.toHaveTextContent('Yükleniyor'));
    const sorunlar = section('Çözülecek sorunlar');
    expect(within(sorunlar).queryByRole('table')).toBeNull();
    expect(container.querySelector('[data-layout="accordion"]')).not.toBeNull();
    expect(within(sorunlar).getByRole('region', { name: 'Formül hatası' })).toBeInTheDocument();
    expect(within(sorunlar).getByText(new RegExp(`${sayi.format(ISSUE_COUNT)} sorun`))).toBeInTheDocument();
    const acik = within(sorunlar).getAllByRole('button', { expanded: true });
    expect(acik).toHaveLength(1);
  });

  it('issues koleksiyonu nesilde yoksa dürüstçe "Kaynakta sorun kaydı yok" der', async () => {
    renderPage({ source: fixtureSource(withoutIssues()) });
    await waitForFresh();
    await waitFor(() => expect(section('Çözülecek sorunlar')).toHaveTextContent('Kaynakta sorun kaydı yok'));
    expect(within(section('Çözülecek sorunlar')).queryByRole('table')).toBeNull();
    // Özet rakamı da uydurulmaz: sayım yok → "Henüz yok".
    const olculer = within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem');
    expect(olculer[0]).toHaveTextContent('Henüz yok');
  });
});

// --- Kaynaklar, sayfalar ve nesil -----------------------------------------------------------------------
describe('VeriPage › kaynaklar ve nesil', () => {
  it('kaynak tablosu yakalama zamanı, kapsam ve sayfa sayısı; sayfa tablosu dolu satır/hücre sayıları', async () => {
    renderPage();
    await waitFor(() => expect(section('Kaynaklar')).not.toHaveTextContent('Yükleniyor'));
    const kaynaklar = section('Kaynaklar');
    expect(within(kaynaklar).getByRole('table', { name: 'Kaynaklar' })).toBeInTheDocument();
    expect(bodyRows(kaynaklar)).toHaveLength(SOURCE_COUNT);
    const household = within(kaynaklar).getByRole('row', { name: /household/ });
    // 2026-10-28T08:00:05Z → İstanbul 11:00; tarih 28.10.2026.
    expect(household).toHaveTextContent('28.10.2026 11:00');
    expect(household).toHaveTextContent('synthetic');
    expect(household).toHaveTextContent('İşlem değil');

    await waitFor(() => expect(section('Sayfalar')).not.toHaveTextContent('Yükleniyor'));
    const sayfalar = section('Sayfalar');
    expect(within(sayfalar).getByRole('table', { name: 'Sayfalar' })).toBeInTheDocument();
    expect(bodyRows(sayfalar)).toHaveLength(SHEET_COUNT);
    const kalemler = within(sayfalar).getByRole('row', { name: /app_kalemler/ });
    expect(kalemler).toHaveTextContent('household');
    expect(within(kalemler).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['app_kalemler', 'household', '0', '0']);
  });

  it('nesil bilgisi: kimlik, tutarlılık, kaynak türü ve koleksiyon sayıları', async () => {
    renderPage();
    await waitForFresh();
    const nesil = section('Nesil');
    expect(within(nesil).getByText(GENERATION_ID)).toBeInTheDocument();
    expect(nesil).toHaveTextContent('Anlık görüntü; işlem değil');
    expect(nesil).toHaveTextContent('Fixture · sentetik');
    expect(within(nesil).getByRole('table', { name: 'Koleksiyon sayıları' })).toBeInTheDocument();
    expect(nesil).toHaveTextContent('Bekleyen yerel değişiklik');
    expect(nesil).toHaveTextContent('Kapalı');
  });
});

// --- Veri durumları -------------------------------------------------------------------------------------
describe('VeriPage › veri durumları', () => {
  it('okunurken iskelet; nesil hazır olunca içerik', async () => {
    renderPage();
    expect(yukleniyor().length).toBeGreaterThan(0);
    expect(veriDurumu()).toHaveAttribute('data-state', 'checking');
    await waitForFresh();
    await waitFor(() => expect(yukleniyor()).toHaveLength(0));
  });

  it('manifest okunamazsa ErrorState "Hata: …" ve "Yeniden dene"; eski tutar/kayıt gösterilmez', async () => {
    const files = { ...FILES };
    delete files['manifest.json'];
    const source = fixtureSource(files);
    const spy = vi.spyOn(source, 'readText');
    renderPage({ source });
    await waitFor(() => expect(veriDurumu()).toHaveAttribute('data-state', 'error'));
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent(/^Hata: /);
    expect(alert).toHaveTextContent('manifest.json');
    expect(screen.queryByRole('table')).toBeNull();
    const before = spy.mock.calls.length;
    await userEvent.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before));
  });

  it('yenileme başarısızsa eski veri kalır, tazelik satırı "yenilenemedi" der', async () => {
    const source = new FlakySource();
    renderPage({ source });
    await waitForSettled();
    source.failing = true;
    await userEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    await waitFor(() => expect(veriDurumu()).toHaveAttribute('data-state', 'stale'));
    expect(veriDurumu()).toHaveTextContent('yenilenemedi');
    // Son iyi nesil korunur.
    expect(within(section('Çözülecek sorunlar')).getByRole('table', { name: 'Çözülecek sorunlar' })).toBeInTheDocument();
  });

  it('dataStatusFor her nesil durumunu DataStatus durumuna çevirir', () => {
    const base: GenerationHandle = {
      state: 'ready', manifest: null, generationId: GENERATION_ID, lastReadAt: '2026-10-28T11:32:00Z', lastGoodAt: '2026-10-28T11:32:00Z',
      message: null, refresh: async () => undefined, pickDirectory: async () => false, canPickDirectory: false,
      source: { kind: 'fixture', label: 'sentetik' }, sourceMessage: null,
    };
    expect(dataStatusFor({ ...base, state: 'idle' }).state).toBe('checking');
    expect(dataStatusFor({ ...base, state: 'checking' }).state).toBe('checking');
    expect(dataStatusFor(base)).toMatchObject({ state: 'fresh', generationId: GENERATION_ID, lastReadAt: base.lastReadAt });
    expect(dataStatusFor({ ...base, state: 'stale', message: 'Hata: ağ yok' })).toMatchObject({ state: 'stale', lastGoodAt: base.lastGoodAt, message: 'Hata: ağ yok' });
    expect(dataStatusFor({ ...base, state: 'error', message: 'Hata: manifest yok' })).toMatchObject({ state: 'error', message: 'Hata: manifest yok' });
  });
});

// --- Eylemler ---------------------------------------------------------------------------------------------
describe('VeriPage › eylemler', () => {
  it('"Yenile" manifesti yeniden okur', async () => {
    const source = new FlakySource();
    renderPage({ source });
    await waitForSettled();
    const before = source.reads.filter(path => path === 'manifest.json').length;
    await userEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    await waitFor(() => expect(source.reads.filter(path => path === 'manifest.json').length).toBe(before + 1));
  });

  it('tarayıcı klasör seçimini desteklemiyorsa "Klasörden içe aktar" devre dışıdır ve nedeni yanında yazar', async () => {
    renderPage();
    await waitForFresh();
    const ice = screen.getByRole('button', { name: 'Klasörden içe aktar' });
    expect(ice).toBeDisabled();
    expect(ice).toHaveAccessibleDescription(/klasör içe aktarmayı desteklemiyor/);
  });

  it('klasör seçimi iptal edilirse "Hata: Klasör seçimi iptal edildi" yazar; kaynak değişmez', async () => {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn(async () => {
      throw new DOMException('iptal', 'AbortError');
    });
    renderPage();
    await waitForFresh();
    const ice = screen.getByRole('button', { name: 'Klasörden içe aktar' });
    expect(ice).toBeEnabled();
    await userEvent.click(ice);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Hata: Klasör seçimi iptal edildi'));
    expect(section('Nesil')).toHaveTextContent('Fixture · sentetik');
  });

  it('klasör seçilirse kaynak klasöre döner ve nesil oradan okunur', async () => {
    const dirs = new Map<string, Record<string, string>>();
    for (const [path, text] of Object.entries(FILES)) {
      const parts = path.split('/');
      const dir = parts.slice(0, -1).join('/');
      (dirs.get(dir) ?? dirs.set(dir, {}).get(dir)!)[parts[parts.length - 1]!] = text;
    }
    const handleFor = (prefix: string, name: string): unknown => ({
      name,
      getDirectoryHandle: async (segment: string) => handleFor(prefix ? `${prefix}/${segment}` : segment, segment),
      getFileHandle: async (file: string) => ({ getFile: async () => ({ text: async () => dirs.get(prefix)![file]! }) }),
    });
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn(async () => handleFor('', 'nesil-klasoru'));
    renderPage();
    await waitForFresh();
    await userEvent.click(screen.getByRole('button', { name: 'Klasörden içe aktar' }));
    await waitFor(() => expect(section('Nesil')).toHaveTextContent('Klasör · nesil-klasoru'));
    await waitForFresh();
  });

  it('başlıkta tek birincil eylem; "Yenile" yalnız tazelik satırındadır (çift düğme yok)', async () => {
    renderPage({ device: 'phone' });
    await waitForFresh();
    expect(screen.getByRole('button', { name: 'Klasörden içe aktar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Diğer' })).toBeNull();
    const yenile = screen.getAllByRole('button', { name: 'Yenile' });
    expect(yenile).toHaveLength(1);
    expect(veriDurumu()).toContainElement(yenile[0]!);
  });
});
