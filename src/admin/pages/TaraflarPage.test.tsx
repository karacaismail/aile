import type { ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { wideManifest } from '../adaptive';
import { FixtureGenerationSource, GenerationProvider } from '../data';
import type { PurchaseNeedRecord } from '../data/types';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { adminPages } from '../shell/navigation';
import { FILES, GENERATION_ID, kaynak, kayitlar, nesil } from './taraflar/testNesli';
import { TaraflarPage } from './TaraflarPage';

// Tasarım: bundle.js Aile.Pages.Taraflar (masaüstü / tablet / telefon), README "Sayfa iskeleti", "Veri durumları",
// "İçerik ilkeleri" (eksik bilgi adıyla; plan ve gerçek ayrı) ve "Uyarlanır teslim" (telefonda tablo akordeon, ilk satır
// açık; geniş sunum yalnız geniş profilde ve tembel). Veri: sentetik nesil (fixtures/generation-synthetic)
// FixtureGenerationSource ile belleğe okunur. Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok.
//
// Bu dosyada panel sözleşmesi providers koleksiyonunu TANIMAZ: sözleşme bugün tanır (data/contract.ts), ama sayfanın
// tanımayan sözleşmeyle (eski/ayrık sürüm) dürüst kalan yolu burada sınanır; koleksiyon açıkça çıkarılır. Sözleşmenin
// providers'ı tanıdığı yol taraflar/providers.test.tsx'tedir.
vi.mock('../data/contract', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/contract')>();
  const { providers: _yok, ...schemas } = original.collectionSchemas as Record<string, unknown>;
  return { ...original, collectionSchemas: schemas };
});

const TARAFLAR = adminPages.find((page) => page.key === 'taraflar')!;
const WORK_ORDERS = kayitlar('work_orders');
const PURCHASES = kayitlar('purchase_needs');
const canliIs = (index: number) => WORK_ORDERS.filter((record) => !record.deleted_at)[index]!;
const canliAlim = (index: number) => PURCHASES.filter((record) => !record.deleted_at)[index]!;

function renderPage({ device = 'desktop', source = kaynak() }: { device?: Device; source?: FixtureGenerationSource } = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={source} cache={null} changeSet={null}>
        {children}
      </GenerationProvider>
    </DeviceContext.Provider>
  );
  return render(<TaraflarPage />, { wrapper: Wrapper });
}

/** Tazelik satırı (DataStatus): role=status + data-state; LoadingShell/EmptyState status'larından böyle ayrılır. */
function dataStatus(): HTMLElement {
  const found = screen.getAllByRole('status').find((element) => element.hasAttribute('data-state'));
  if (!found) throw new Error('Tazelik satırı yok');
  return found;
}
/** LoadingShell: role=status + aria-busy. */
const loadingShells = () => screen.queryAllByRole('status').filter((element) => element.getAttribute('aria-busy') === 'true');
/** Yük altındaki paralel koşularda varsayılan 1 sn dar kalır; veri bekleyen sorgular bu üst sınırı kullanır. */
const VERI = { timeout: 5_000 };
async function waitForFresh() {
  await waitFor(() => expect(dataStatus()).toHaveTextContent(/Nesil/), VERI);
}
const bolum = (name: string) => screen.getByRole('region', { name });
const ozet = (label: string) => within(screen.getByRole('list', { name: 'Özet' })).getByText(label).closest('li')!;

/** İki teklifli veri: bir iş emrinde ve bir alımda teklif tutarı; iş emrinde plan ve gerçek de var. */
async function teklifliNesil() {
  return nesil({
    work_orders: (records) => {
      const record = records.find((r) => r.id === canliIs(0).id)!;
      record.amounts = { ...record.amounts, quote: { amount: '9000.00', currency: 'TRY' }, planned: { amount: '17000.00', currency: 'TRY' }, actual: { amount: '8200.00', currency: 'TRY' } };
    },
    purchase_needs: (records) => {
      const record = records.find((r) => r.id === canliAlim(0).id)!;
      record.amounts = { ...record.amounts, quote: { amount: '650', currency: 'TRY' } };
    },
  });
}
/** İşi yapan (is_kim) kodları iki iş emrinde. */
async function isiYapanliNesil() {
  return nesil({
    work_orders: (records: PurchaseNeedRecord[]) => {
      records.find((r) => r.id === canliIs(0).id)!.attributes!.is_kim = ['elektrikci', 'boyaci'];
      records.find((r) => r.id === canliIs(1).id)!.attributes!.is_kim = ['elektrikci'];
    },
  });
}

describe('TaraflarPage › telefon temel sunumu geniş modülleri indirmez', () => {
  it('telefonda veri çizilir ama taraflar-* geniş kaynakları boşta kalır (indirme yok)', async () => {
    renderPage({ device: 'phone', source: kaynak(await teklifliNesil()) });
    await waitForFresh();
    expect(await within(bolum('Teklifler')).findAllByRole('button', { name: /Taraf bilinmiyor/ }, VERI)).toHaveLength(2);
    const taraflar = wideManifest().filter((entry) => entry.key.startsWith('taraflar-'));
    expect(taraflar.map((entry) => entry.key).sort()).toEqual(['taraflar-isi-yapanlar', 'taraflar-tablo', 'taraflar-teklifler']);
    expect(taraflar.every((entry) => entry.status === 'idle')).toBe(true);
  });
});

describe('TaraflarPage › başlık ve özet', () => {
  it('bölüm, h1 ve amaç cümlesi menü tanımıyla aynıdır; başlık okunurken bile görünür', () => {
    renderPage({ device: 'phone' });
    expect(screen.getByRole('heading', { level: 1, name: TARAFLAR.label })).toBeInTheDocument();
    expect(screen.getByText(TARAFLAR.section)).toBeInTheDocument();
    expect(screen.getByText(TARAFLAR.purpose)).toBeInTheDocument();
  });

  it('tazelik satırı okunuyor → nesil; en çok üç özet ve eksik bilgi adıyla ("Henüz yok", sıfır değil)', async () => {
    renderPage();
    expect(dataStatus()).toHaveTextContent(/Okunuyor/);
    await waitForFresh();
    expect(dataStatus()).toHaveTextContent(`Nesil ${GENERATION_ID.slice(0, 6)}`);
    expect(within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem')).toHaveLength(3);
    await waitFor(() => expect(ozet('Teklif')).toHaveTextContent('Henüz yok'), VERI);
    expect(ozet('Taraf kaydı')).toHaveTextContent('Henüz yok');
    expect(ozet('Karşılaştırma')).toHaveTextContent('Henüz yok');
  });

  it('teklif ve karşılaştırma sayımı kaynaktan; teklif tutarı plan ya da gerçekle birleşmez', async () => {
    renderPage({ source: kaynak(await teklifliNesil()) });
    await waitForFresh();
    await waitFor(() => expect(ozet('Teklif')).toHaveTextContent('2'), VERI);
    expect(ozet('Teklif')).toHaveTextContent('2 kayıt için');
    expect(ozet('Karşılaştırma')).toHaveTextContent('Henüz yok');
  });

  it('birincil eylem "Teklif kaydet" görünür, devre dışı ve nedeni açıklanır (Sheets\'e yazma yok)', async () => {
    renderPage({ device: 'phone' });
    await waitForFresh();
    const kaydet = screen.getByRole('button', { name: 'Teklif kaydet' });
    expect(kaydet).toBeDisabled();
    expect(kaydet).toHaveAccessibleDescription(/e-tablo/i);
  });
});

describe('TaraflarPage › teklifler', () => {
  it('kaynakta teklif yoksa bunu adıyla söyler; liste ya da tablo çizilmez', async () => {
    renderPage({ device: 'phone' });
    await waitForFresh();
    const teklifler = bolum('Teklifler');
    expect(within(teklifler).getByRole('heading', { level: 2, name: 'Teklifler' })).toBeInTheDocument();
    expect(await within(teklifler).findByText('Kaynakta teklif yok', {}, VERI)).toBeInTheDocument();
    expect(within(teklifler).queryByRole('table')).toBeNull();
    expect(within(teklifler).queryByRole('list')).toBeNull();
  });

  it('telefonda akordeon: kayıt başına grup, ilk satır açık; Teklif, Planlanan, Gerçekleşen ayrı satırlar', async () => {
    renderPage({ device: 'phone', source: kaynak(await teklifliNesil()) });
    await waitForFresh();
    const teklifler = bolum('Teklifler');
    const satirlar = await within(teklifler).findAllByRole('button', { name: /Taraf bilinmiyor/ }, VERI);
    expect(satirlar.map((satir) => satir.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
    expect(within(teklifler).queryByRole('table')).toBeNull();

    const grup = (label: string) => within(teklifler).getByRole('heading', { level: 3, name: new RegExp(label) }).closest('section')!;
    const satirOf = (label: string) => within(grup(label)).getByRole('button', { name: /Taraf bilinmiyor/ });
    const deger = (satir: HTMLElement, etiket: string) =>
      within(document.getElementById(satir.getAttribute('aria-controls')!)!).getByText(etiket, { selector: 'dt' }).nextElementSibling;

    const isSatiri = satirOf(canliIs(0).label!);
    if (isSatiri.getAttribute('aria-expanded') !== 'true') await userEvent.setup().click(isSatiri);
    expect(isSatiri).toHaveAttribute('aria-expanded', 'true');
    expect(deger(isSatiri, 'Teklif')).toHaveTextContent('₺9.000,00');
    expect(deger(isSatiri, 'Planlanan')).toHaveTextContent('₺17.000,00');
    expect(deger(isSatiri, 'Gerçekleşen')).toHaveTextContent('₺8.200,00');
    expect(deger(isSatiri, 'İletişim')).toHaveTextContent('Bilinmiyor');
    // Alımın gerçeği yok: "Henüz yok" (sıfır değil); teklif kendi değeriyle.
    const alimSatiri = satirOf(canliAlim(0).label!);
    expect(deger(alimSatiri, 'Teklif')).toHaveTextContent('₺650,00');
    expect(deger(alimSatiri, 'Gerçekleşen')).toHaveTextContent('Henüz yok');
  });

  it('geniş profilde karşılaştırma yuvaları (tembel geniş modül): her teklif adlı bir grup, tutar ve eksik bilgi adıyla', async () => {
    renderPage({ device: 'desktop', source: kaynak(await teklifliNesil()) });
    await waitForFresh();
    const teklifler = bolum('Teklifler');
    const yuvalar = await within(teklifler).findAllByRole('group', { name: /Taraf bilinmiyor/ }, { timeout: 15_000 });
    expect(yuvalar).toHaveLength(2);
    const isYuvasi = yuvalar.find((yuva) => within(yuva).queryByText('₺9.000,00'))!;
    expect(isYuvasi).toHaveTextContent('Süre');
    expect(isYuvasi).toHaveTextContent('Bilinmiyor');
    // Plan ve gerçek kayıt başlığında ayrı değerler.
    const baslik = within(teklifler).getByRole('heading', { level: 3, name: new RegExp(canliIs(0).label!) });
    const grup = baslik.closest('section')!;
    expect(grup).toHaveTextContent('Planlanan ₺17.000,00');
    expect(grup).toHaveTextContent('Gerçekleşen ₺8.200,00');
    expect(wideManifest().find((entry) => entry.key === 'taraflar-teklifler')?.status).toBe('ready');
  }, 20_000);
});

describe('TaraflarPage › taraflar', () => {
  it('nesilde providers yoksa "Kaynakta taraf kaydı yok"; sahte kayıt ya da sıfır yok', async () => {
    renderPage({ device: 'phone' });
    await waitForFresh();
    const taraflar = bolum('Taraflar');
    expect(within(taraflar).getByRole('heading', { level: 2, name: 'Taraflar' })).toBeInTheDocument();
    expect(await within(taraflar).findByText('Kaynakta taraf kaydı yok', {}, VERI)).toBeInTheDocument();
    expect(within(taraflar).queryByRole('link')).toBeNull();
    expect(ozet('Taraf kaydı')).toHaveTextContent('Henüz yok');
  });

  it('nesilde taraf kaydı var ama panel sözleşmesi okuyamıyorsa: sayı ve neden yazılır, iletişim "Bilinmiyor"', async () => {
    renderPage({ device: 'phone', source: kaynak(await nesil({ providersYalnizManifest: 4 })) });
    await waitForFresh();
    const taraflar = bolum('Taraflar');
    expect(await within(taraflar).findByText('Taraf kayıtları bu sürümde okunmuyor', {}, VERI)).toBeInTheDocument();
    expect(taraflar).toHaveTextContent('Nesilde 4 taraf kaydı var');
    expect(taraflar).toHaveTextContent('İletişim ve teklif bilgisi: Bilinmiyor');
    expect(ozet('Taraf kaydı')).toHaveTextContent('Bilinmiyor');
    // Okunamayan koleksiyon nesli bozuk saydırmaz: tazelik satırı hata değil.
    expect(dataStatus()).toHaveAttribute('data-state', 'fresh');
  });
});

describe('TaraflarPage › işi yapanlar (iş emirlerindeki is_kim)', () => {
  it('is_kim boşsa adıyla söyler', async () => {
    renderPage({ device: 'phone' });
    await waitForFresh();
    const alan = bolum('İşi yapanlar');
    expect(await within(alan).findByText('Kaynakta işi yapan bilgisi yok', {}, VERI)).toBeInTheDocument();
  });

  it('telefonda düz liste: kod etiketi (Elektrikçi), iş sayısı ve işler; tablo yok', async () => {
    renderPage({ device: 'phone', source: kaynak(await isiYapanliNesil()) });
    await waitForFresh();
    const alan = bolum('İşi yapanlar');
    const elektrikci = (await within(alan).findByText('Elektrikçi', {}, VERI)).closest('li')!;
    expect(elektrikci).toHaveTextContent('2 iş');
    expect(elektrikci).toHaveTextContent(canliIs(0).label!);
    expect(within(alan).getByText('Boyacı').closest('li')).toHaveTextContent('1 iş');
    expect(within(alan).queryByRole('table')).toBeNull();
    expect(alan).toHaveTextContent('taraf kaydına bağ değil');
  });

  it('geniş profilde tablo (tembel geniş modül)', async () => {
    renderPage({ device: 'desktop', source: kaynak(await isiYapanliNesil()) });
    await waitForFresh();
    const tablo = await within(bolum('İşi yapanlar')).findByRole('table', { name: /İşi yapanlar/ }, { timeout: 15_000 });
    expect(within(tablo).getByRole('row', { name: /Elektrikçi/ })).toHaveTextContent('2');
  }, 20_000);
});

describe('TaraflarPage › veri durumları', () => {
  it('okunurken bölümlerde iskelet (Yükleniyor), sonra kaybolur', async () => {
    renderPage({ device: 'phone' });
    expect(loadingShells().length).toBeGreaterThan(0);
    expect(loadingShells()[0]).toHaveTextContent('Yükleniyor');
    await waitForFresh();
    await waitFor(() => expect(loadingShells()).toHaveLength(0), VERI);
  });

  it('manifest bozuksa sayfa hatası: "Hata: …" ve "Yeniden dene"; bölüm ya da tutar çizilmez', async () => {
    renderPage({ device: 'phone', source: kaynak({ 'manifest.json': '{bozuk' }) });
    await waitFor(() => expect(dataStatus()).toHaveAttribute('data-state', 'error'), VERI);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent(/^Hata: Nesil okunamadı/);
    expect(alert).toHaveTextContent(/Hata: manifest\.json/);
    expect(within(alert).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.queryByText(/₺/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Teklifler' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: TARAFLAR.label })).toBeInTheDocument();
  });

  it('iş emirleri bölümü bozuksa ona dayanan bölümler hata verir; başlık ve taraflar bölümü kalır, sayımlar "Bilinmiyor"', async () => {
    const path = Object.keys(FILES).find((p) => p.startsWith('data/work_orders/'))!;
    renderPage({ device: 'phone', source: kaynak({ [path]: '{bozuk' }) });
    // Tazelik satırı burada sabitlenmez: depo, sonraki başarılı koleksiyon okumasında durumu yeniden 'ready' yapar
    // (d02-loading'e iletildi). Hatanın adıyla söylendiği yer bölümlerdir.
    const teklifHatasi = await within(await screen.findByRole('region', { name: 'Teklifler' }, VERI)).findByRole('alert', {}, VERI);
    expect(within(teklifHatasi).getByRole('heading', { level: 2 })).toHaveTextContent(/^Hata: Teklifler okunamadı/);
    const isHatasi = await within(bolum('İşi yapanlar')).findByRole('alert', {}, VERI);
    expect(within(isHatasi).getByRole('heading', { level: 2 })).toHaveTextContent(/^Hata: İş emirleri okunamadı/);
    expect(within(isHatasi).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: TARAFLAR.label })).toBeInTheDocument();
    expect(within(bolum('Taraflar')).getByText('Kaynakta taraf kaydı yok')).toBeInTheDocument();
    expect(ozet('Teklif')).toHaveTextContent('Bilinmiyor');
    expect(ozet('Karşılaştırma')).toHaveTextContent('Bilinmiyor');
  });

  it('eski veri: yenileme başarısızsa son iyi veri kalır, tazelik satırı "yenilenemedi" der', async () => {
    const overrides = await teklifliNesil();
    const fixture = kaynak(overrides);
    let kapali = false;
    const source = Object.assign(Object.create(fixture) as FixtureGenerationSource, {
      readText: (path: string) => (kapali ? Promise.reject(new Error('ağ yok')) : fixture.readText(path)),
    });
    renderPage({ device: 'phone', source });
    await waitForFresh();
    await within(bolum('Teklifler')).findAllByRole('button', { name: /Taraf bilinmiyor/ }, VERI);
    kapali = true;
    await act(async () => {
      await userEvent.setup().click(within(dataStatus()).getByRole('button', { name: 'Yenile' }));
    });
    await waitFor(() => expect(dataStatus()).toHaveAttribute('data-state', 'stale'), VERI);
    expect(dataStatus()).toHaveTextContent('yenilenemedi');
    expect(within(bolum('Teklifler')).getAllByRole('button', { name: /Taraf bilinmiyor/ })).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
