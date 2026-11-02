import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GenelTelefon } from './GenelTelefon';
import { AYLIK_BASLIK, AYLIK_TOPLAM_NOTU, BAGLANTI, type GenelGorev, type GenelGorunum } from './model';

// Genel durum › telefon sunumu, Bekleyen işler: yerel onay kutusu (antd yok). Erişilebilir ad görev adıdır (görünür
// başlık; aria-labelledby), kod · sorumlu · tarih satırı ad değil açıklamadır (aria-describedby). Geniş sunumdaki
// Overview görev satırıyla aynı ad/açıklama ayrımı: ekran okuyucu listede görevi adıyla duyurur, ayrıntıyı sonra okur.
// Satırın tamamı etikettir (dokunma hedefi 44/48 GenelPage.css'te); etikete dokunmak kutuyu değiştirir.
// Veri: sentetik görünüm modeli (gerçek veri yok).

const GOREVLER: GenelGorev[] = [
  { id: 'gorev-1', label: 'Örnek tadilat işi 4', code: 'IS-4', owner: 'Örnek sorumlu', due: '2027-02-03', done: false },
  { id: 'gorev-2', label: 'Örnek görev 2', done: true },
];

function gorunum(gorevler: readonly GenelGorev[] = GOREVLER): GenelGorunum {
  return {
    odemeler: { title: 'Yaklaşan ödemeler', link: BAGLANTI.butce, items: [], empty: 'Önümüzdeki 7 günde ödeme yok' },
    dikkat: { title: 'Dikkat isteyenler', link: BAGLANTI.veri, items: [], empty: 'Dikkat isteyen kayıt yok' },
    butce: { title: 'Bütçe', link: BAGLANTI.butce, items: [], empty: 'Bu ay bütçe kaydı yok', note: null },
    gorevler: { title: 'Bekleyen işler', link: BAGLANTI.projeler, items: gorevler, empty: 'Bekleyen iş yok' },
    aylik: { title: AYLIK_BASLIK, link: BAGLANTI.butce, items: [], empty: 'Aylık kayıt yok', note: AYLIK_TOPLAM_NOTU },
  };
}

const bekleyenIsler = () => screen.getByRole('region', { name: 'Bekleyen işler' });

describe('GenelTelefon › Bekleyen işler onay kutusu', () => {
  it('her onay kutusunun erişilebilir adı görev adıdır; kod · sorumlu · tarih açıklamadır, ada karışmaz', () => {
    render(<GenelTelefon gorunum={gorunum()} onToggleTask={() => {}} />);
    const kutular = within(bekleyenIsler()).getAllByRole('checkbox');
    expect(kutular).toHaveLength(GOREVLER.length);
    expect(kutular[0]).toHaveAccessibleName('Örnek tadilat işi 4');
    expect(kutular[0]).toHaveAccessibleDescription('IS-4 · Örnek sorumlu · 03.02.2027');
    expect(kutular[1]).toHaveAccessibleName('Örnek görev 2');
    expect(kutular[1]).not.toHaveAttribute('aria-describedby');
    expect(kutular[1]).toBeChecked();
    // Ad görünür başlığa bağlıdır (aria-labelledby → görev adı); görünmeyen ayrı etiket yazılmaz.
    for (const [index, kutu] of kutular.entries()) {
      const ad = document.getElementById(kutu.getAttribute('aria-labelledby') ?? '');
      expect(ad).toHaveTextContent(GOREVLER[index]!.label);
      expect(kutu).not.toHaveAttribute('aria-label');
    }
  });

  it('adla bulunur ve satıra (etikete) dokunmak kutuyu değiştirir; değişiklik kümesi yokken kutu devre dışı', async () => {
    const user = userEvent.setup();
    const degisti = vi.fn();
    const { rerender } = render(<GenelTelefon gorunum={gorunum()} onToggleTask={degisti} />);
    const kutu = screen.getByRole('checkbox', { name: 'Örnek tadilat işi 4' });
    expect(kutu).toBeEnabled();
    await user.click(within(bekleyenIsler()).getByText('Örnek tadilat işi 4'));
    expect(degisti).toHaveBeenCalledWith('gorev-1', true);

    rerender(<GenelTelefon gorunum={gorunum()} />);
    expect(screen.getByRole('checkbox', { name: 'Örnek tadilat işi 4' })).toBeDisabled();
  });
});
