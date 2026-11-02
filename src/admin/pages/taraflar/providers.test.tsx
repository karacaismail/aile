import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GenerationProvider } from '../../data';
import { DeviceContext } from '../../device';
import type { Device } from '../../shell/contracts';
import { TaraflarPage } from '../TaraflarPage';
import { bag, kaynak, kayitlar, nesil, usta } from './testNesli';

// Panel sözleşmesi providers koleksiyonunu tanıdığında (data-platform/normalize.mjs: usta satırı → providers; şema
// PurchaseNeed gövdesi) sayfanın taraf ve teklif yolu. Bugünkü sözleşme bu koleksiyonu tanımadığı için burada sözleşme
// modülü, d05-contract'tan istenen değişikliğin aynısıyla genişletilir: collectionSchemas.providers = PurchaseNeed ve
// parsePartition('providers') bu şemayla doğrular. Depo, yükleyici ve bütünlük denetimi gerçektir.
vi.mock('../../data/contract', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data/contract')>();
  const { z } = await import('zod');
  const collectionSchemas = { ...original.collectionSchemas, providers: original.PurchaseNeed };
  const parsePartition = (collection: string, input: unknown) => {
    if (collection !== 'providers') return original.parsePartition(collection as never, input);
    return z.object({ schemaVersion: z.literal(1), collection: z.literal('providers'), records: z.array(original.PurchaseNeed) }).parse(input);
  };
  return { ...original, collectionSchemas, parsePartition };
});

const ALIM = kayitlar('purchase_needs').find((record) => !record.deleted_at)!;
const ALI = usta(1, { ad: 'Usta Ali', meslek: 'elektrik', telefon: '0532 123 45 67', teklif_sure_gun: '5', garanti_ay: '24', myk_dogrulandi: true }, '17450.00');
const MUTFAK = usta(2, { ad: 'Mutfak Dünyası', meslek: 'diger', telefon: '0212 555 10 10' }, '18900');
const ADSIZ = usta(3, { ad: null, meslek: null, telefon: null });

async function ustaliNesil() {
  return nesil({
    providers: [ALI, MUTFAK, ADSIZ],
    relations: (records) => {
      records.push(bag(ALI.id, ALIM.id, 1), bag(ALIM.id, MUTFAK.id, 2));
    },
  });
}

function renderPage(device: Device, overrides: Record<string, string>) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={kaynak(overrides)} cache={null} changeSet={null}>
        {children}
      </GenerationProvider>
    </DeviceContext.Provider>
  );
  return render(<TaraflarPage />, { wrapper: Wrapper });
}
/** Yük altındaki paralel koşularda varsayılan 1 sn dar kalır. */
const VERI = { timeout: 5_000 };
const bolum = (name: string) => screen.getByRole('region', { name });
const ozet = (label: string) => within(screen.getByRole('list', { name: 'Özet' })).getByText(label).closest('li')!;

describe('TaraflarPage › providers okunabildiğinde (telefon)', () => {
  it('taraflar akordeonu ada göre, ilk satır açık; tel: ve WhatsApp bağlantıları erişilebilir adlı; eksik bilgi "Bilinmiyor"', async () => {
    renderPage('phone', await ustaliNesil());
    const taraflar = await screen.findByRole('region', { name: 'Taraflar' }, VERI);
    const satirlar = await within(taraflar).findAllByRole('button', { name: /Usta Ali|Mutfak Dünyası|Adı bilinmiyor/ }, VERI);
    expect(satirlar.map((s) => s.textContent)).toEqual([
      expect.stringContaining('Mutfak Dünyası'), expect.stringContaining('Usta Ali'), expect.stringContaining('Adı bilinmiyor'),
    ]);
    expect(satirlar.map((s) => s.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false']);
    const ali = satirlar[1]!;
    expect(ali).toHaveTextContent('Elektrik');
    expect(ali).toHaveTextContent('₺17.450,00');
    await userEvent.setup().click(ali);

    const ara = within(taraflar).getByRole('link', { name: 'Ara: Usta Ali, 0532 123 45 67' });
    expect(ara).toHaveAttribute('href', 'tel:+905321234567');
    expect(ara).toHaveTextContent('Ara');
    const wa = within(taraflar).getByRole('link', { name: 'WhatsApp ile yaz: Usta Ali (yeni sekmede açılır)' });
    expect(wa).toHaveAttribute('href', 'https://wa.me/905321234567');
    expect(wa).toHaveAttribute('target', '_blank');
    expect(wa).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(wa).toHaveTextContent('WhatsApp');

    // Adı olmayan taraf: ad, meslek, fiyat, telefon, iletişim ve MYK adıyla eksik (uydurma yok).
    const adsiz = satirlar[2]!;
    expect(adsiz).toHaveTextContent('Meslek bilinmiyor');
    expect(adsiz).toHaveTextContent('Fiyat yok');
    const govde = document.getElementById(adsiz.getAttribute('aria-controls')!)!;
    expect(within(govde).getByText('İletişim', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Bilinmiyor');
    expect(within(govde).getByText('Telefon', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Bilinmiyor');
    expect(within(govde).getByText('MYK belgesi', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Bilinmiyor');
    expect(within(govde).queryByRole('link')).toBeNull();
  });

  it('sabit hatta yalnız arama; WhatsApp bağlantısı uydurulmaz', async () => {
    renderPage('phone', await ustaliNesil());
    const taraflar = await screen.findByRole('region', { name: 'Taraflar' }, VERI);
    const ara = await within(taraflar).findByRole('link', { name: 'Ara: Mutfak Dünyası, 0212 555 10 10' }, VERI);
    expect(ara).toHaveAttribute('href', 'tel:+902125551010');
    expect(within(taraflar).queryByRole('link', { name: /WhatsApp ile yaz: Mutfak Dünyası/ })).toBeNull();
  });

  it('usta teklifleri bağlı alımda karşılaştırılır: en düşük fiyat etiketi ve kesin fark özeti', async () => {
    renderPage('phone', await ustaliNesil());
    const teklifler = await screen.findByRole('region', { name: 'Teklifler' }, VERI);
    expect(await within(teklifler).findByRole('heading', { level: 3, name: new RegExp(ALIM.label!) }, VERI)).toBeInTheDocument();
    const ali = within(teklifler).getByRole('button', { name: /Usta Ali/ });
    expect(ali).toHaveTextContent('En düşük fiyat');
    expect(within(teklifler).getByRole('button', { name: /Mutfak Dünyası/ })).not.toHaveTextContent('En düşük fiyat');
    expect(teklifler).toHaveTextContent(`${ALIM.label}: en düşük fiyat Usta Ali, ₺1.450,00 daha ucuz.`);
    expect(ozet('Taraf kaydı')).toHaveTextContent('3');
    expect(ozet('Teklif')).toHaveTextContent('2');
    expect(ozet('Karşılaştırma')).toHaveTextContent('1');
  });
});

describe('TaraflarPage › providers okunabildiğinde (geniş)', () => {
  it('taraflar tablosu ve karşılaştırma yuvaları (tembel geniş modüller); iletişim sütunu bağlantılı', async () => {
    renderPage('desktop', await ustaliNesil());
    const tablo = await within(await screen.findByRole('region', { name: 'Taraflar' }, VERI)).findByRole('table', { name: /Taraflar/ }, { timeout: 15_000 });
    const ali = within(tablo).getByRole('row', { name: /Usta Ali/ });
    expect(within(ali).getByRole('link', { name: 'Ara: Usta Ali, 0532 123 45 67' })).toHaveAttribute('href', 'tel:+905321234567');
    expect(ali).toHaveTextContent('₺17.450,00');
    expect(within(tablo).getByRole('row', { name: /Adı bilinmiyor/ })).toHaveTextContent('Bilinmiyor');

    const teklifler = bolum('Teklifler');
    const yuva = await within(teklifler).findByRole('group', { name: /Usta Ali/ }, { timeout: 15_000 });
    expect(yuva).toHaveTextContent('En düşük fiyat');
    expect(yuva).toHaveTextContent('5 gün');
    expect(yuva).toHaveTextContent('24 ay');
  }, 20_000);
});
