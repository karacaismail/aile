import { screen, waitFor, within } from '@testing-library/react';
import { wideManifest } from '../adaptive';
import { kayitOgesi, setup } from './alimlar/testkit';

// Alımlar: çizim maliyeti ve uyarlamalı teslim. Kök neden (tam pakette "Durumu değiştir" testi 5 sn'yi aşıyordu):
// her yerel değişiklik ve seçim bütün liste satırlarını (28 ListRow) yeniden çiziyordu. Burada ListRow çizimleri
// sayılır; değişiklik yalnız değişen satırı çizmelidir. Ayrı dosya: geniş modül kayıt defteri (wideManifest) bu
// dosyada temiz başlar, telefonun geniş modül indirmediği ve masaüstünün indirdiği aynı süreçte gözlenir.

const { cizimler } = vi.hoisted(() => ({ cizimler: [] as string[] }));
vi.mock('../ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('../ui')>();
  const Gercek = real.ListRow;
  function SayanListRow(props: Parameters<typeof Gercek>[0]) {
    cizimler.push(props.row.label);
    return <Gercek {...props} />;
  }
  return { ...real, ListRow: Object.assign(SayanListRow, { Header: Gercek.Header }) };
});

const sonuclar = () => screen.findByRole('region', { name: 'Sonuçlar' });
const alimModulleri = () => wideManifest().filter((item) => item.key.startsWith('alimlar-')).sort((a, b) => a.key.localeCompare(b.key));
const cizilenler = () => [...new Set(cizimler)].sort();

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  cizimler.length = 0;
});

describe('AlimlarPage › çizim maliyeti ve geniş modüller', () => {
  it('telefon: durum değişikliği ve geri al yalnız değişen satırı çizer; geniş modüller indirilmez', async () => {
    const { user } = setup({ device: 'phone' });
    const region = await sonuclar();
    await user.click(kayitOgesi(region, 'Örnek kase'));
    const ayrinti = await screen.findByRole('dialog', { name: 'Örnek kase' });

    cizimler.length = 0;
    await user.click(within(ayrinti).getByRole('combobox', { name: 'Durumu değiştir' }));
    // Telefonda seçim alttan açılan sayfadadır; liste "Durumu değiştir" etiketiyle adlanır.
    const sayfa = await screen.findByRole('listbox', { name: 'Durumu değiştir' });
    await user.click(within(sayfa).getByRole('option', { name: 'Karar bekliyor' }));
    await screen.findByText(/Araştırılıyor → Karar bekliyor/);
    expect(cizilenler()).toEqual(['Örnek kase']);
    expect(cizimler.length).toBeLessThanOrEqual(2);

    cizimler.length = 0;
    await user.click(within(screen.getByRole('dialog', { name: 'Örnek kase' })).getByRole('button', { name: 'Geri al' }));
    await screen.findByText('Değişiklik geri alındı.');
    expect(cizilenler()).toEqual(['Örnek kase']);
    expect(cizimler.length).toBeLessThanOrEqual(2);

    expect(alimModulleri()).toEqual([
      { key: 'alimlar-genis', status: 'idle' },
      { key: 'alimlar-pivot', status: 'idle' },
    ]);
  });

  it('masaüstü: geniş yerleşim lazyWide ile yüklenir; durum değişikliği yalnız değişen satırı çizer', async () => {
    const { user } = setup({ device: 'desktop' });
    await sonuclar();
    // Filtre paneli (solda açık) ve sağ ayrıntı geniş yerleşim modülündedir.
    expect((await screen.findAllByRole('region', { name: 'Filtreler' }, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(alimModulleri().find((item) => item.key === 'alimlar-genis')?.status).toBe('ready');

    const kaseSatiri = kayitOgesi(await sonuclar(), 'Örnek kase');
    await user.click(kaseSatiri);
    const panel = await screen.findByRole('dialog', { name: 'Örnek kase' });

    cizimler.length = 0;
    await user.click(within(panel).getByRole('combobox', { name: 'Durumu değiştir' }));
    const liste = await screen.findByRole('listbox');
    await user.click(within(liste).getByRole('option', { name: 'Karar bekliyor' }));
    await screen.findByText(/Araştırılıyor → Karar bekliyor/);
    await waitFor(() => expect(kaseSatiri).toHaveTextContent('Karar bekliyor'));
    expect(kaseSatiri.isConnected).toBe(true);
    expect(cizilenler()).toEqual(['Örnek kase']);
    expect(cizimler.length).toBeLessThanOrEqual(2);
  });
});
