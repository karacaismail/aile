import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { DeviceContext } from '../device';
import type { Device, RecordRow, StatusLabel } from '../shell/contracts';
import { DetailPanel, differenceText } from './DetailPanel';

// Tasarım: components/DetailPanel/README.md (sıra sabit: kimlik + fotoğraf → Plan | Gerçek → durum ve eylemler →
// bağlı kayıtlar → kaynak ve değişiklik izi; "Fotoğraf yok" + "Fotoğraf ekle"; fark sözcükle) ve envanter.md
// (masaüstü sağda 384 px; tablet ve telefon tam sayfa, üstte "Listeye dön"). Seçiciler role/label; antd iç sınıfı yok.
// Veri sentetiktir (gerçek aile kaydı değil).

const row: RecordRow = {
  id: 'ornek-0001',
  code: 'ALM-0001',
  label: 'Çalışma masası',
  kind: 'purchase_need',
  status: { label: 'Sipariş verildi', tone: 'bilgi' },
  room: 'Çalışma odası',
  category: 'Mobilya',
  owner: 'Ortak',
  planned: { amount: '8500.00', currency: 'TRY' },
  actual: { amount: '7940.00', currency: 'TRY' },
  payment: { label: 'Ödeme bekleniyor', tone: 'uyari' },
  confidence: 'Doğrulandı',
  photo: null,
  dates: { planned: '2026-11-15', ordered: '2026-10-28' },
};

const statusOptions: readonly StatusLabel[] = [
  { label: 'Araştırılıyor', tone: 'notr' },
  { label: 'Sipariş verildi', tone: 'bilgi' },
  { label: 'Teslim alındı', tone: 'olumlu' },
];

const related = [
  { label: 'Ödeme ODM-0001', href: '#/odemeler/ODM-0001' },
  { label: 'Proje PRJ-01', href: '#/projeler/PRJ-01' },
];
const source = [
  { label: 'Sayfa', value: 'Alımlar' },
  { label: 'Hücre', value: 'B14' },
  { label: 'Nesil', value: 'a1b2c3' },
];

function renderOn(device: Device, ui: ReactNode) {
  return render(<DeviceContext.Provider value={device}>{ui}</DeviceContext.Provider>);
}

const SECTION_HEADINGS = ['Plan', 'Gerçek', 'Durum ve eylemler', 'Bağlı kayıtlar', 'Kaynak ve değişiklik izi'];

describe('DetailPanel › dar ekran (telefon)', () => {
  it('tam sayfa diyalog: role dialog, aria-modal, h2 ile adlandırılır; üstte "Listeye dön" onClose çağırır', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderOn('phone', <DetailPanel row={row} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: row.label });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { level: 2, name: row.label })).toBeInTheDocument();
    // Geniş ekranın "Kapat" düğmesi yok; dar ekranda "Listeye dön".
    expect(screen.queryByRole('button', { name: 'Kapat' })).toBeNull();
    const back = screen.getByRole('button', { name: 'Listeye dön' });
    // Üstte: diyaloğun ilk düğmesi.
    expect(within(dialog).getAllByRole('button')[0]).toBe(back);
    await user.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape onClose çağırır', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderOn('phone', <DetailPanel row={row} onClose={onClose} />);
    screen.getByRole('button', { name: 'Listeye dön' }).focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('bölüm sırası sabittir: kimlik (h2) → Plan | Gerçek → Durum ve eylemler → Bağlı kayıtlar → Kaynak ve değişiklik izi', () => {
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} related={related} source={source} />);
    const headings = screen.getAllByRole('heading').map(h => h.textContent);
    expect(headings).toEqual([row.label, ...SECTION_HEADINGS]);
    // Plan ve gerçek iki ayrı sütun olarak adlandırılmış bir bölgedir.
    expect(screen.getByRole('region', { name: 'Plan ve gerçek' })).toBeInTheDocument();
    // Kimlik: kod ve kategori, oda ve sorumlu.
    expect(screen.getByText(`${row.code} · ${row.category}`)).toBeInTheDocument();
    expect(screen.getByText(`Oda: ${row.room} · Sorumlu: ${row.owner}`)).toBeInTheDocument();
  });

  it('tablet de tam sayfadır (envanter: ayrıntı tam sayfa, "Listeye dön")', () => {
    renderOn('tablet', <DetailPanel row={row} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Listeye dön' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kapat' })).toBeNull();
  });
});

describe('DetailPanel › plan ve gerçek', () => {
  it('iki ayrı sütunda tr-TR tutar; fark sözcükle: "Planın altında: ₺560,00"', () => {
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
    const region = screen.getByRole('region', { name: 'Plan ve gerçek' });
    const plan = within(region).getByRole('heading', { name: 'Plan' }).parentElement as HTMLElement;
    const actual = within(region).getByRole('heading', { name: 'Gerçek' }).parentElement as HTMLElement;
    expect(within(plan).getByText('₺8.500,00')).toBeInTheDocument();
    expect(within(actual).getByText('₺7.940,00')).toBeInTheDocument();
    // Tarihler 28.10.2026 biçiminde; eksik tarih adıyla.
    expect(within(plan).getByText('15.11.2026')).toBeInTheDocument();
    expect(within(actual).getByText('28.10.2026')).toBeInTheDocument();
    expect(within(actual).getAllByText('Bilinmiyor').length).toBeGreaterThan(0);
    expect(within(region).getByText('Planın altında: ₺560,00')).toBeInTheDocument();
    // Plan ve gerçek tek sayıda birleşmez: toplam ya da birleşik tutar yok.
    expect(within(region).queryByText('₺16.440,00')).toBeNull();
  });

  it('gerçek planın üstündeyse "Planın üstünde", eşitse "Planla aynı"', () => {
    const over: RecordRow = { ...row, actual: { amount: '9100.50', currency: 'TRY' } };
    const first = renderOn('phone', <DetailPanel row={over} onClose={() => {}} />);
    expect(screen.getByText('Planın üstünde: ₺600,50')).toBeInTheDocument();
    first.unmount();
    const same: RecordRow = { ...row, actual: { amount: '8500.00', currency: 'TRY' } };
    renderOn('phone', <DetailPanel row={same} onClose={() => {}} />);
    expect(screen.getByText('Planla aynı')).toBeInTheDocument();
  });

  it('eksik tutar adıyla yazılır ("Fiyat yok", "Henüz yok") ve fark yazılmaz', () => {
    const missing: RecordRow = { ...row, planned: null, actual: null };
    renderOn('phone', <DetailPanel row={missing} onClose={() => {}} />);
    const region = screen.getByRole('region', { name: 'Plan ve gerçek' });
    expect(within(region).getByText('Fiyat yok')).toBeInTheDocument();
    expect(within(region).getByText('Henüz yok')).toBeInTheDocument();
    expect(within(region).queryByText(/Planın/)).toBeNull();
    expect(within(region).queryByText('Planla aynı')).toBeNull();
  });

  it('differenceText: para birimleri farklıysa fark hesaplanmaz, nedeni yazılır', () => {
    expect(differenceText({ amount: '100.00', currency: 'TRY' }, { amount: '90.00', currency: 'TRY' })).toEqual({ text: 'Planın altında: ₺10,00', tone: 'olumlu' });
    expect(differenceText({ amount: '100.00', currency: 'TRY' }, { amount: '90.00', currency: 'EUR' })).toEqual({ text: 'Fark bilinmiyor: para birimleri farklı (TRY, EUR)', tone: 'notr' });
    expect(differenceText(null, { amount: '90.00', currency: 'TRY' })).toBeNull();
  });
});

describe('DetailPanel › fotoğraf', () => {
  it('fotoğraf yoksa "Fotoğraf yok" alanı; "Fotoğraf ekle" yalnız onPhotoAdd verilince', async () => {
    const user = userEvent.setup();
    const first = renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
    expect(screen.getByText('Fotoğraf yok')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fotoğraf ekle' })).toBeNull();
    first.unmount();

    const onPhotoAdd = vi.fn();
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} onPhotoAdd={onPhotoAdd} />);
    const add = screen.getByRole('button', { name: 'Fotoğraf ekle' });
    expect(add).toBeEnabled();
    await user.click(add);
    expect(onPhotoAdd).toHaveBeenCalledTimes(1);
  });

  it('doğrulanmamış fotoğraf asla gösterilmez; doğrulanmış fotoğraf alt metniyle gösterilir', () => {
    const unverified: RecordRow = { ...row, photo: { url: 'https://example.test/yanlis.jpg', verified: false } };
    const first = renderOn('phone', <DetailPanel row={unverified} onClose={() => {}} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Fotoğraf yok')).toBeInTheDocument();
    first.unmount();

    const verified: RecordRow = { ...row, photo: { url: 'https://example.test/masa.jpg', verified: true } };
    renderOn('phone', <DetailPanel row={verified} onClose={() => {}} />);
    const img = screen.getByRole('img', { name: `${row.label} fotoğrafı` });
    expect(img).toHaveAttribute('src', 'https://example.test/masa.jpg');
    expect(screen.queryByText('Fotoğraf yok')).toBeNull();
  });
});

describe('DetailPanel › durum ve eylemler', () => {
  it('durum sözcükle yazılır; ödeme ve veri güveni ayrı satırlarda', () => {
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
    const section = screen.getByRole('heading', { name: 'Durum ve eylemler' }).parentElement as HTMLElement;
    expect(within(section).getByText('Sipariş verildi')).toBeInTheDocument();
    expect(within(section).getByText('Ödeme bekleniyor')).toBeInTheDocument();
    expect(within(section).getByText('Doğrulandı')).toBeInTheDocument();
    // Eylem verilmedi: ne "Durumu değiştir" ne "Geri al".
    expect(screen.queryByRole('combobox', { name: 'Durumu değiştir' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Durumu değiştir' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Geri al' })).toBeNull();
  });

  it('"Durumu değiştir" seçimi onChangeStatus(next) verir; "Geri al" onUndo çağırır (masaüstü)', async () => {
    const user = userEvent.setup();
    const onChangeStatus = vi.fn();
    const onUndo = vi.fn();
    renderOn('desktop', <DetailPanel row={row} onClose={() => {}} statusOptions={statusOptions} onChangeStatus={onChangeStatus} onUndo={onUndo} inline />);
    const select = screen.getByRole('combobox', { name: 'Durumu değiştir' });
    await user.click(select);
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('option', { name: 'Sipariş verildi' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(list).getByRole('option', { name: 'Teslim alındı' }));
    expect(onChangeStatus).toHaveBeenCalledTimes(1);
    expect(onChangeStatus).toHaveBeenCalledWith({ label: 'Teslim alındı', tone: 'olumlu' });
    await user.click(screen.getByRole('button', { name: 'Geri al' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('onChangeStatus var ama seçenek yoksa düğme devre dışıdır ve nedeni yakınında yazılıdır', () => {
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} onChangeStatus={() => {}} />);
    const button = screen.getByRole('button', { name: 'Durumu değiştir' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Seçilebilir durum yok');
  });
});

describe('DetailPanel › bağlı kayıtlar, kaynak', () => {
  it('bağlı kayıtlar bağlantı listesidir; yoksa "Bağlı kayıt yok"', () => {
    const first = renderOn('phone', <DetailPanel row={row} onClose={() => {}} related={related} />);
    const list = screen.getByRole('list', { name: 'Bağlı kayıtlar' });
    const links = within(list).getAllByRole('link');
    expect(links.map(a => a.textContent)).toEqual(related.map(r => r.label));
    expect(links[0]).toHaveAttribute('href', related[0].href);
    first.unmount();
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
    expect(screen.getByText('Bağlı kayıt yok')).toBeInTheDocument();
  });

  it('kaynak etiket–değer listesidir (dl); yoksa "Kaynak bilgisi yok"', () => {
    const first = renderOn('phone', <DetailPanel row={row} onClose={() => {}} source={source} />);
    const section = screen.getByRole('heading', { name: 'Kaynak ve değişiklik izi' }).parentElement as HTMLElement;
    const terms = Array.from(section.querySelectorAll('dl dt')).map(dt => dt.textContent);
    const values = Array.from(section.querySelectorAll('dl dd')).map(dd => dd.textContent);
    expect(terms).toEqual(source.map(s => s.label));
    expect(values).toEqual(source.map(s => s.value));
    first.unmount();
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
    expect(screen.getByText('Kaynak bilgisi yok')).toBeInTheDocument();
  });
});

describe('DetailPanel › geniş ekran (masaüstü)', () => {
  it('sağdan 384 px çekmece: role dialog kayıt adıyla, "Kapat" onClose; "Listeye dön" yok; bölüm sırası aynı', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderOn('desktop', <DetailPanel row={row} onClose={onClose} related={related} source={source} />);
    const dialog = await screen.findByRole('dialog', { name: row.label });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const wrapper = document.querySelector('.aile-drawer-wrapper') as HTMLElement;
    expect(wrapper.style.width).toBe('384px');
    expect(dialog.closest('.aile-drawer')).toHaveClass('aile-drawer--right');
    expect(screen.queryByRole('button', { name: 'Listeye dön' })).toBeNull();
    const headings = screen.getAllByRole('heading').map(h => h.textContent);
    expect(headings).toEqual([row.label, ...SECTION_HEADINGS]);
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('inline çizim portal kullanmaz (önizleme ve test)', async () => {
    const { container } = renderOn('desktop', <DetailPanel row={row} onClose={() => {}} inline />);
    await waitFor(() => expect(container.contains(screen.getByRole('dialog', { name: row.label }))).toBe(true));
  });
});
