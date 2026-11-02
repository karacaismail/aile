import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FixtureGenerationSource, GenerationProvider } from '../data';
import type { PurchaseNeedRecord } from '../data/types';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { adminPages } from '../shell/navigation';
import { TaraflarPage } from './TaraflarPage';

// Tasarım: bundle.js Aile.Pages.Taraflar (masaüstü / tablet / telefon), README "Sayfa iskeleti", "Veri durumları",
// "İçerik ilkeleri" (eksik bilgi adıyla; plan ve gerçek ayrı). Veri: sentetik nesil (fixtures/generation-synthetic)
// FixtureGenerationSource ile belleğe okunur; providers koleksiyonu nesilde YOK → sayfa bunu dürüstçe söyler.
// Adaylar yalnız work_orders.attributes.is_kim / usta kaynak metninden türetilir; ilişki uydurulmaz.
// Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok.

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
const MANIFEST = JSON.parse(FILES['manifest.json']!) as { counts: Record<string, number>; files: { path: string; collection?: string; sha256: string; bytes: number }[] };
const WORK_ORDERS_PATH = MANIFEST.files.find((file) => file.collection === 'work_orders')!.path;
const WORK_ORDERS = JSON.parse(FILES[WORK_ORDERS_PATH]!) as { schemaVersion: 1; collection: string; records: PurchaseNeedRecord[] };

const TARAFLAR = adminPages.find((page) => page.key === 'taraflar')!;
const PURCHASES_WITH_QUOTE = WORK_ORDERS.records.filter((record) => record.amounts.quote).length;
const PURCHASES_WITH_ACTUAL = WORK_ORDERS.records.filter((record) => record.amounts.actual).length;

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

/** work_orders bölümünü değiştirilmiş kayıtlarla yeniden yazar; manifest hash'i de güncellenir (bütünlük denetimi). */
async function workOrdersOverride(mutate: (records: PurchaseNeedRecord[]) => void): Promise<Record<string, string>> {
  const records = structuredClone(WORK_ORDERS.records);
  mutate(records);
  const text = JSON.stringify({ ...WORK_ORDERS, records });
  const { sha256Hex } = await import('../data');
  const manifest = JSON.parse(FILES['manifest.json']!) as { files: { path: string; sha256: string; bytes: number; count?: number }[] };
  const file = manifest.files.find((entry) => entry.path === WORK_ORDERS_PATH)!;
  file.sha256 = await sha256Hex(text);
  file.bytes = new TextEncoder().encode(text).byteLength;
  return { [WORK_ORDERS_PATH]: text, 'manifest.json': JSON.stringify(manifest) };
}

function renderPage({ device = 'desktop', source = fixtureSource() }: { device?: Device; source?: FixtureGenerationSource } = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={source} cache={null} changeSet={null}>
        {children}
      </GenerationProvider>
    </DeviceContext.Provider>
  );
  return render(<TaraflarPage />, { wrapper: Wrapper });
}

/** Tazelik satırı (DataStatus): role=status + data-state; LoadingShell'in status'undan böyle ayrılır. */
function dataStatus(): HTMLElement {
  const found = screen.getAllByRole('status').find((element) => element.hasAttribute('data-state'));
  if (!found) throw new Error('Tazelik satırı yok');
  return found;
}
/** LoadingShell: role=status + aria-busy. */
function loadingShell(): HTMLElement | undefined {
  return screen.queryAllByRole('status').find((element) => element.getAttribute('aria-busy') === 'true');
}
async function waitForFresh() {
  await waitFor(() => expect(dataStatus()).toHaveTextContent(/Nesil/));
}

describe('TaraflarPage › başlık ve özet', () => {
  it('bölüm, h1 ve amaç cümlesi menü tanımıyla aynıdır; başlık okunurken bile görünür', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: TARAFLAR.label })).toBeInTheDocument();
    expect(screen.getByText(TARAFLAR.section)).toBeInTheDocument();
    expect(screen.getByText(TARAFLAR.purpose)).toBeInTheDocument();
  });

  it('tazelik satırı: okunuyor → nesil kısaltması; en çok üç özet, plan ve gerçek ayrı girdilerdir', async () => {
    renderPage();
    expect(dataStatus()).toHaveTextContent(/Okunuyor/);
    await waitForFresh();
    expect(dataStatus()).toHaveTextContent(`Nesil ${GENERATION_ID.slice(0, 6)}`);

    const ozet = screen.getByRole('list', { name: 'Özet' });
    const olculer = within(ozet).getAllByRole('listitem');
    expect(olculer.length).toBeLessThanOrEqual(3);
    // Taraf kaydı: providers koleksiyonu nesilde yok → "Henüz yok" (sıfır değil, yok).
    expect(within(ozet).getByText('Taraf kaydı').closest('li')).toHaveTextContent('Henüz yok');
    // Plan (teklif) ve gerçek (ödeme) ayrı ölçüler; tek sayıda birleşmez.
    const plan = within(ozet).getByText('Teklifli iş (plan)').closest('li')!;
    const gercek = within(ozet).getByText('Ödenmiş iş (gerçek)').closest('li')!;
    expect(plan).not.toBe(gercek);
    expect(plan).toHaveTextContent(String(PURCHASES_WITH_QUOTE));
    expect(gercek).toHaveTextContent(String(PURCHASES_WITH_ACTUAL));
  });

  it('birincil eylem "Teklif kaydet" bu dilimde devre dışıdır ve nedeni açıklanır (Sheets\'e yazma yok)', async () => {
    renderPage();
    await waitForFresh();
    const kaydet = screen.getByRole('button', { name: 'Teklif kaydet' });
    expect(kaydet).toBeDisabled();
    expect(kaydet).toHaveAccessibleDescription(/e-tablo/i);
  });
});

describe('TaraflarPage › taraflar (providers koleksiyonu yok)', () => {
  it('kaynakta taraf/usta kaydı olmadığını adıyla söyler; sahte sıfır ya da uydurma kayıt yok', async () => {
    renderPage();
    await waitForFresh();
    const bolum = screen.getByRole('region', { name: 'Taraflar' });
    expect(within(bolum).getByRole('heading', { level: 2, name: 'Taraflar' })).toBeInTheDocument();
    expect(within(bolum).getByText('Kaynakta taraf/usta kaydı yok')).toBeInTheDocument();
    expect(within(bolum).queryByRole('table')).toBeNull();
  });
});

describe('TaraflarPage › adaylar (iş emirlerinden kaynak metin)', () => {
  it('is_kim / usta boşsa "Kaynakta aday yok" der', async () => {
    renderPage();
    await waitForFresh();
    const bolum = screen.getByRole('region', { name: 'Adaylar' });
    await waitFor(() => expect(within(bolum).getByText('Kaynakta aday yok')).toBeInTheDocument());
    expect(within(bolum).getByText('İş emirlerinde İşi yapan (is_kim) ya da usta alanı dolu değil.')).toBeInTheDocument();
    expect(within(bolum).queryByRole('table')).toBeNull();
  });

  it('is_kim ve usta metinleri ad bazında toplanır; iş sayısı ve kaynak alan yazılır, ilişki uydurulmaz', async () => {
    const overrides = await workOrdersOverride((records) => {
      records[0]!.attributes = { ...records[0]!.attributes, is_kim: ['Usta Ali', 'Boya Ekibi'] };
      records[1]!.attributes = { ...records[1]!.attributes, is_kim: 'Usta Ali' };
      records[2]!.attributes = { ...records[2]!.attributes, usta: 'Perde Atölyesi' };
    });
    renderPage({ source: fixtureSource(overrides) });
    await waitForFresh();
    const bolum = screen.getByRole('region', { name: 'Adaylar' });
    const tablo = await within(bolum).findByRole('table', { name: /Adaylar/ });
    const ali = within(tablo).getByRole('row', { name: /Usta Ali/ });
    expect(ali).toHaveTextContent('2');
    expect(ali).toHaveTextContent('is_kim');
    const atolye = within(tablo).getByRole('row', { name: /Perde Atölyesi/ });
    expect(atolye).toHaveTextContent('usta');
    expect(within(tablo).getByRole('row', { name: /Boya Ekibi/ })).toHaveTextContent('1');
    // Aday yalnız kaynak metindir: taraf kaydına bağ, iletişim ya da ödeme uydurulmaz.
    expect(within(bolum).getByText(/yalnız kaynak metin/)).toBeInTheDocument();
    expect(within(bolum).queryByText(/İletişim/)).toBeNull();
  });

  it('telefonda tablo akordeona iner (tablo yok, liste var)', async () => {
    const overrides = await workOrdersOverride((records) => {
      records[0]!.attributes = { ...records[0]!.attributes, is_kim: 'Usta Ali' };
    });
    renderPage({ device: 'phone', source: fixtureSource(overrides) });
    await waitForFresh();
    const bolum = screen.getByRole('region', { name: 'Adaylar' });
    await waitFor(() => expect(within(bolum).getByText('Usta Ali')).toBeInTheDocument());
    expect(within(bolum).queryByRole('table')).toBeNull();
  });
});

describe('TaraflarPage › teklif karşılaştırması iskeleti', () => {
  it('masaüstünde üç yan yana yuva; her yuva eksik bilgiyi adıyla yazar ("Fiyat yok", "Bilinmiyor")', async () => {
    renderPage();
    await waitForFresh();
    const bolum = screen.getByRole('region', { name: 'Teklif karşılaştırması' });
    expect(within(bolum).getByText('Karşılaştırılacak teklif yok')).toBeInTheDocument();
    const yuvalar = within(bolum).getAllByRole('group');
    expect(yuvalar).toHaveLength(3);
    for (const yuva of yuvalar) {
      expect(yuva).toHaveTextContent('Fiyat yok');
      expect(yuva).toHaveTextContent('Bilinmiyor');
    }
    expect(within(bolum).getByTestId('teklif-karsilastirma')).toHaveAttribute('data-layout', 'yan-yana');
  });

  it('telefonda yuvalar alt alta gelir', async () => {
    renderPage({ device: 'phone' });
    await waitForFresh();
    const bolum = screen.getByRole('region', { name: 'Teklif karşılaştırması' });
    expect(within(bolum).getByTestId('teklif-karsilastirma')).toHaveAttribute('data-layout', 'alt-alta');
    expect(within(bolum).getAllByRole('group')).toHaveLength(3);
  });
});

describe('TaraflarPage › veri durumları', () => {
  it('iş emirleri okunurken iskelet (Yükleniyor) görünür, sonra kaybolur', async () => {
    renderPage();
    expect(loadingShell()).toHaveTextContent('Yükleniyor');
    await waitForFresh();
    await waitFor(() => expect(loadingShell()).toBeUndefined());
  });

  it('manifest bozuksa ErrorState: "Hata: …" ve "Yeniden dene"; tutar gösterilmez', async () => {
    renderPage({ source: fixtureSource({ 'manifest.json': '{bozuk' }) });
    // Önce tazelik satırı hata durumuna otursun; ara durumda bölüm hatası görünebilir, kalıcı olan sayfa hatasıdır.
    await waitFor(() => expect(dataStatus()).toHaveAttribute('data-state', 'error'));
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent(/^Hata: Nesil okunamadı/);
    expect(alert).toHaveTextContent(/Hata: manifest\.json/);
    expect(within(alert).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    // Bölümler çizilmez: tutar, teklif yuvası ya da aday tablosu yok.
    expect(screen.queryByText(/₺/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Teklif karşılaştırması' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: TARAFLAR.label })).toBeInTheDocument();
  });

  it('iş emirleri bölümü bozuksa yalnız o alan hata verir; başlık ve taraflar bölümü kalır', async () => {
    renderPage({ source: fixtureSource({ [WORK_ORDERS_PATH]: '{bozuk' }) });
    // Depo bütünlük hatasını nesil durumuna da yazar (IntegrityError → error); manifest elde kaldığı için sayfa bölümleri çizilir.
    await waitFor(() => expect(dataStatus()).toHaveAttribute('data-state', 'error'));
    const bolum = screen.getByRole('region', { name: 'Adaylar' });
    const alert = await within(bolum).findByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent(/^Hata: İş emirleri okunamadı/);
    expect(within(alert).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: TARAFLAR.label })).toBeInTheDocument();
    expect(screen.getByText('Kaynakta taraf/usta kaydı yok')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Teklif karşılaştırması' })).toBeInTheDocument();
    // Plan ve gerçek sayımı okunamadı: sıfır değil, "Bilinmiyor".
    const ozet = screen.getByRole('list', { name: 'Özet' });
    expect(within(ozet).getByText('Teklifli iş (plan)').closest('li')).toHaveTextContent('Bilinmiyor');
    expect(within(ozet).getByText('Ödenmiş iş (gerçek)').closest('li')).toHaveTextContent('Bilinmiyor');
  });
});
