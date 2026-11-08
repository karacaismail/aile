import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, useState, type ReactNode } from 'react';
import { wideRuleViolations } from '../adaptive/sourceRules';
import { DeviceContext } from '../device';
import type { Device, RecordRow, StatusLabel } from '../shell/contracts';
import { Kanban, KANBAN_ETIKET } from './Kanban';

// Tasarım: components/Kanban/README.md + index.d.ts KanbanProps; referans davranış bundle.js Kanban/KanbanCard.
// Durum = tedarik durumu (RecordRow.status). Başlık: durum etiketi + "N kayıt" + grubun planlanan toplamı (gerçek
// toplanmaz) + "N fiyatsız". Kart: 56 px foto ya da "Fotoğraf yok", ad, kod · oda, Planlanan/Gerçekleşen ayrı, ödeme
// etiketi. Uyarlamalı teslim (W0): telefonda duruma göre gruplu dikey liste (yatay kaydırma yok) ve klavyeli
// "Durumu değiştir" (alt sayfa, APG menuitemradio); genişte (tablet/masaüstü) yatay pano ui/wide/Kanban.wide.tsx'ten
// lazyWide ile tembel gelir, beklerken liste yedektir. Sürükleme yok. Seçiciler role/label ile; antd iç sınıfı yok.
// Sentetik veri; gerçek aile kaydı değildir.

const onDevice = (device: Device) => ({ children }: { children: ReactNode }) =>
  createElement(DeviceContext.Provider, { value: device }, children);

const siparis: StatusLabel = { label: 'Sipariş verildi', tone: 'bilgi' };
const teslim: StatusLabel = { label: 'Teslim alındı', tone: 'olumlu' };
const teklif: StatusLabel = { label: 'Teklif bekleniyor', tone: 'notr' };
const fiyatEksik: StatusLabel = { label: 'Fiyat eksik', tone: 'uyari' };

const row = (over: Partial<RecordRow> & Pick<RecordRow, 'id' | 'code' | 'label' | 'status'>): RecordRow => ({
  planned: null, actual: null, kind: 'purchase_need', ...over,
});

const alimlar: readonly RecordRow[] = [
  row({ id: 'r1', code: 'ALM-0142', label: 'Bebek karyolası', status: siparis, room: 'Bebek odası',
    planned: { amount: '8500.00', currency: 'TRY' }, actual: { amount: '7940.00', currency: 'TRY' },
    payment: { label: 'Kısmen ödendi', tone: 'uyari' }, photo: { url: 'data:image/svg+xml,<svg/>', verified: true } }),
  row({ id: 'r2', code: 'ALM-0137', label: 'Bulaşık makinesi', status: siparis, room: 'Mutfak',
    planned: { amount: '18000.00', currency: 'TRY' }, payment: { label: 'Ödenmedi', tone: 'notr' }, photo: null }),
  row({ id: 'r3', code: 'ALM-0125', label: 'Oto koltuğu', status: siparis,
    planned: null, payment: { label: 'Ödenmedi', tone: 'notr' }, photo: { url: 'https://example.invalid/baska-urun.jpg', verified: false } }),
  row({ id: 'r4', code: 'ALM-0139', label: 'Köpek yatağı', status: teslim, room: 'Salon',
    planned: { amount: '1200.00', currency: 'TRY' }, actual: { amount: '1349.90', currency: 'TRY' }, payment: { label: 'Ödendi', tone: 'olumlu' } }),
  row({ id: 'r5', code: 'ALM-0131', label: 'Emzirme koltuğu', status: fiyatEksik, room: 'Bebek odası' }),
];

const sutunlar: readonly StatusLabel[] = [teklif, fiyatEksik, siparis, teslim];

describe('Kanban › sütunlar', () => {
  const wrapper = onDevice('desktop');

  it('verilen sütun sırasını korur; boş sütun "Bu durumda kayıt yok." der', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    const board = screen.getByRole('region', { name: 'Tedarik durumuna göre alımlar' });
    const columns = within(board).getAllByRole('region');
    expect(columns.map(c => c.getAttribute('aria-label'))).toEqual(['Teklif bekleniyor', 'Fiyat eksik', 'Sipariş verildi', 'Teslim alındı']);
    expect(within(columns[0]).getByText('Bu durumda kayıt yok.')).toBeInTheDocument();
    expect(within(columns[0]).queryAllByRole('button')).toHaveLength(0);
  });

  it('sütun verilmezse durumları kayıtların ilk görülme sırasıyla türetir', () => {
    render(<Kanban items={alimlar} />, { wrapper });
    const columns = within(screen.getByRole('region', { name: 'Tedarik durumuna göre alımlar' })).getAllByRole('region');
    expect(columns.map(c => c.getAttribute('aria-label'))).toEqual(['Sipariş verildi', 'Teslim alındı', 'Fiyat eksik']);
  });

  it('başlıkta durum etiketi tonuyla ve kayıt sayısı vardır', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    const column = screen.getByRole('region', { name: 'Sipariş verildi' });
    const heading = within(column).getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Sipariş verildi');
    expect(heading).toHaveTextContent('3 kayıt');
    expect(within(heading).getByText('Sipariş verildi').closest('[data-tone]')).toHaveAttribute('data-tone', 'bilgi');
    expect(within(screen.getByRole('region', { name: 'Fiyat eksik' })).getByText('Fiyat eksik').closest('[data-tone]')).toHaveAttribute('data-tone', 'uyari');
  });

  it('kartlar her sütunda bir liste içindedir', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    const column = screen.getByRole('region', { name: 'Sipariş verildi' });
    expect(within(column).getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('Kanban › toplamlar', () => {
  const wrapper = onDevice('desktop');

  it('sütunun planlanan toplamını tr-TR biçimiyle yazar ve fiyatsız kayıt sayısını ayrıca söyler', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    const column = screen.getByRole('region', { name: 'Sipariş verildi' });
    expect(within(column).getByText('Planlanan ₺26.500,00 · 1 fiyatsız')).toBeInTheDocument();
  });

  it('hepsi fiyatlıysa "fiyatsız" eki yoktur; gerçekleşen toplama girmez', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    const column = screen.getByRole('region', { name: 'Teslim alındı' });
    expect(within(column).getByText('Planlanan ₺1.200,00')).toBeInTheDocument();
    expect(within(column).queryByText(/₺2\.549,90/)).toBeNull();
  });

  it('hiç fiyat yoksa "Planlanan: fiyat yok" der', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    expect(within(screen.getByRole('region', { name: 'Fiyat eksik' })).getByText('Planlanan: fiyat yok')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Teklif bekleniyor' })).getByText('Planlanan: fiyat yok')).toBeInTheDocument();
  });

  it('kuruşları kayıpsız toplar ve para birimine göre ayırır', () => {
    const items = [
      row({ id: 'k1', code: 'K-1', label: 'Bir', status: siparis, planned: { amount: '0.10', currency: 'TRY' } }),
      row({ id: 'k2', code: 'K-2', label: 'İki', status: siparis, planned: { amount: '0.20', currency: 'TRY' } }),
      row({ id: 'k3', code: 'K-3', label: 'Üç', status: siparis, planned: { amount: '120.00', currency: 'EUR' } }),
    ];
    render(<Kanban items={items} />, { wrapper });
    expect(screen.getByText('Planlanan ₺0,30 · €120,00')).toBeInTheDocument();
  });

  it('büyük tutarları kayan noktaya düşmeden (kesin ondalık) toplar', () => {
    const items = [
      row({ id: 'g1', code: 'G-1', label: 'Büyük bir', status: siparis, planned: { amount: '45035996273704.96', currency: 'TRY' } }),
      row({ id: 'g2', code: 'G-2', label: 'Büyük iki', status: siparis, planned: { amount: '45035996273704.97', currency: 'TRY' } }),
    ];
    render(<Kanban items={items} />, { wrapper });
    expect(screen.getByText('Planlanan ₺90.071.992.547.409,93')).toBeInTheDocument();
  });

  it('sayı olmayan tutar kartta "Bilinmiyor" olur, toplama girmez ve fiyatsız sayılır', () => {
    const items = [
      row({ id: 'b1', code: 'B-1', label: 'Bozuk', status: siparis, planned: { amount: 'yok', currency: 'TRY' } }),
      row({ id: 'b2', code: 'B-2', label: 'Sağlam', status: siparis, planned: { amount: '50.00', currency: 'TRY' } }),
    ];
    render(<Kanban items={items} />, { wrapper });
    expect(within(screen.getByRole('button', { name: /Bozuk/ })).getByText('Bilinmiyor')).toBeInTheDocument();
    expect(screen.getByText('Planlanan ₺50,00 · 1 fiyatsız')).toBeInTheDocument();
  });
});

describe('Kanban › kart', () => {
  const wrapper = onDevice('desktop');

  it('ad, kod · oda, Planlanan ve Gerçekleşen ayrı, ödeme etiketi', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    const card = screen.getByRole('button', { name: /Bebek karyolası/ });
    expect(card).toHaveTextContent('ALM-0142 · Bebek odası');
    expect(within(card).getByText('Planlanan')).toBeInTheDocument();
    expect(within(card).getByText('₺8.500,00')).toBeInTheDocument();
    expect(within(card).getByText('Gerçekleşen')).toBeInTheDocument();
    expect(within(card).getByText('₺7.940,00')).toBeInTheDocument();
    const payment = within(card).getByText('Ödeme: Kısmen ödendi');
    expect(payment.closest('[data-tone]')).toHaveAttribute('data-tone', 'uyari');
  });

  it('eksik bilgi adıyla yazılır: "Fiyat yok", "Henüz yok", oda "Bilinmiyor", ödeme "Bilinmiyor"', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    const otoKoltugu = screen.getByRole('button', { name: /Oto koltuğu/ });
    expect(otoKoltugu).toHaveTextContent('ALM-0125 · Bilinmiyor');
    expect(within(otoKoltugu).getByText('Fiyat yok')).toBeInTheDocument();
    expect(within(otoKoltugu).getByText('Henüz yok')).toBeInTheDocument();
    const emzirme = screen.getByRole('button', { name: /Emzirme koltuğu/ });
    expect(within(emzirme).getByText('Ödeme: Bilinmiyor')).toBeInTheDocument();
    expect(within(emzirme).getByText('Henüz yok')).toBeInTheDocument();
  });

  it('yalnız doğrulanmış fotoğraf gösterilir; aksi hâlde "Fotoğraf yok" ve img yok', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    const karyola = screen.getByRole('button', { name: /Bebek karyolası/ });
    const img = within(karyola).getByRole('presentation');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', 'data:image/svg+xml,<svg/>');
    expect(img).toHaveAttribute('width', '56');
    expect(within(karyola).queryByText('Fotoğraf yok')).toBeNull();

    // Doğrulanmamış görsel asla çizilmez: başka ürünün resmi olabilir.
    const oto = screen.getByRole('button', { name: /Oto koltuğu/ });
    expect(oto.querySelector('img')).toBeNull();
    expect(within(oto).getByText('Fotoğraf yok')).toBeInTheDocument();
    expect(oto.innerHTML).not.toContain('baska-urun');

    const bulasik = screen.getByRole('button', { name: /Bulaşık makinesi/ });
    expect(bulasik.querySelector('img')).toBeNull();
    expect(within(bulasik).getByText('Fotoğraf yok')).toBeInTheDocument();
  });

  it('tıklama onOpen(kayıt) çağırır; selectedKey kartı aria-current yapar', async () => {
    const onOpen = vi.fn();
    render(<Kanban items={alimlar} columns={sutunlar} selectedKey="r4" onOpen={onOpen} />, { wrapper });
    await panoyuBekle();
    await userEvent.click(screen.getByRole('button', { name: /Bulaşık makinesi/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(alimlar[1]);
    expect(screen.getByRole('button', { name: /Köpek yatağı/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'true')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Bulaşık makinesi/ })).not.toHaveAttribute('aria-current');
  });

  it('sürükleme yoktur: kart draggable değildir', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    for (const card of screen.getAllByRole('button')) expect(card).not.toHaveAttribute('draggable', 'true');
  });
});

const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');
const pano = () => screen.getByRole('region', { name: KANBAN_ETIKET });
/** Geniş pano ızgarası tembel yüklenir; beklerken aynı bölgede, aynı rol/adlarla liste yedeği çizilir. */
const panoyuBekle = () => waitFor(() => expect(pano().querySelector('[data-kanban-izgara]')).not.toBeNull());
const ogesi = (name: RegExp) => screen.getByRole('button', { name }).closest('li')!;
const degistir = (name: RegExp) => within(ogesi(name)).getByRole('button', { name: 'Durumu değiştir' });

describe('Kanban › telefon: duruma göre gruplu liste', () => {
  const wrapper = onDevice('phone');

  it('liste görünümü: bölge sekme durağı değildir, yatay pano sınıfı yoktur; gruplar sırayla dikey', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    const list = pano();
    expect(list).toHaveAttribute('data-gorunum', 'liste');
    expect(list).toHaveAttribute('data-device', 'phone');
    expect(list).not.toHaveAttribute('tabindex');
    expect(list).not.toHaveClass('aile-kanban--pano');
    const groups = within(list).getAllByRole('region');
    expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(['Teklif bekleniyor', 'Fiyat eksik', 'Sipariş verildi', 'Teslim alındı']);
    for (const group of groups) expect(within(group).getByRole('heading', { level: 3 })).toBeInTheDocument();
  });

  it('Tab doğrudan ilk karta gider (liste kaydırma bölgesi değil); Shift+Tab geri döner', async () => {
    const user = userEvent.setup();
    render(<><button type="button">Önce</button><Kanban items={alimlar} columns={sutunlar} /></>, { wrapper });
    await user.tab();
    expect(screen.getByRole('button', { name: 'Önce' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /Emzirme koltuğu/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /Bebek karyolası/ })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: /Emzirme koltuğu/ })).toHaveFocus();
  });

  it('narrow=true masaüstünde de liste verir; pano yüklenmez', async () => {
    render(<Kanban items={alimlar} columns={sutunlar} narrow />, { wrapper: onDevice('desktop') });
    expect(pano()).toHaveAttribute('data-gorunum', 'liste');
    await new Promise(r => setTimeout(r, 20));
    expect(pano()).toHaveAttribute('data-gorunum', 'liste');
  });

  it('onChangeStatus yoksa "Durumu değiştir" eylemi yoktur', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    expect(screen.queryByRole('button', { name: 'Durumu değiştir' })).toBeNull();
  });
});

describe('Kanban › telefon: klavyeli "Durumu değiştir"', () => {
  const wrapper = onDevice('phone');

  /** Üst bileşen gibi davranır: durum değişince kayıt yeni gruba taşınır. */
  function Harness({ onChange }: { onChange?: (row: RecordRow, next: StatusLabel) => void }) {
    const [items, setItems] = useState<readonly RecordRow[]>(alimlar);
    return (
      <Kanban
        items={items}
        columns={sutunlar}
        onChangeStatus={(row, next) => {
          onChange?.(row, next);
          setItems(list => list.map(r => (r.id === row.id ? { ...r, status: next } : r)));
        }}
      />
    );
  }

  it('her kartın yanında "Durumu değiştir" düğmesi: alt sayfa açar, kaydı açıklamada adlandırır, kart düğmesinin içinde değildir', () => {
    render(<Harness />, { wrapper });
    const trigger = degistir(/Bulaşık makinesi/);
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAccessibleDescription(/Bulaşık makinesi/);
    expect(screen.getByRole('button', { name: /Bulaşık makinesi/ }).contains(trigger)).toBe(false);
    expect(screen.getAllByRole('button', { name: 'Durumu değiştir' })).toHaveLength(alimlar.length);
  });

  it('alt sayfa: "Yeni durum" menüsü sütun sırasıyla menuitemradio; şu anki durum işaretli ve odakta', async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper });
    const trigger = degistir(/Bulaşık makinesi/);
    await user.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'Durumu değiştir' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(sheet).getByText(/Bulaşık makinesi/)).toBeInTheDocument();
    const menu = within(sheet).getByRole('menu', { name: 'Yeni durum' });
    const options = within(menu).getAllByRole('menuitemradio');
    expect(options.map(o => o.textContent)).toEqual(sutunlar.map(s => s.label));
    expect(options.map(o => o.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false']);
    // Dolaşan tabindex: menüde yalnız bir sekme durağı.
    expect(options.filter(o => o.tabIndex === 0)).toHaveLength(1);
    await waitFor(() => expect(options[2]).toHaveFocus());
  });

  it('oklar sarmalı dolaşır, Home/End uçlara gider', async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper });
    await user.click(degistir(/Bulaşık makinesi/));
    const options = screen.getAllByRole('menuitemradio');
    await waitFor(() => expect(options[2]).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(options[3]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(options[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(options[3]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(options[0]).toHaveFocus();
    await user.keyboard('{End}');
    expect(options[3]).toHaveFocus();
    expect(options.filter(o => o.tabIndex === 0)).toEqual([options[3]]);
  });

  it('Enter yeni durumu seçer: onChangeStatus(kayıt, durum), alt sayfa kapanır, kayıt yeni grupta ve odak onun "Durumu değiştir" düğmesinde', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />, { wrapper });
    await user.click(degistir(/Bulaşık makinesi/));
    const options = screen.getAllByRole('menuitemradio');
    await waitFor(() => expect(options[2]).toHaveFocus());
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(alimlar[1], teslim);
    expect(screen.queryByRole('dialog')).toBeNull();
    const yeniGrup = screen.getByRole('region', { name: 'Teslim alındı' });
    expect(within(yeniGrup).getByRole('button', { name: /Bulaşık makinesi/ })).toBeInTheDocument();
    expect(within(yeniGrup).getByText('2 kayıt')).toBeInTheDocument();
    await waitFor(() => expect(degistir(/Bulaşık makinesi/)).toHaveFocus());
    expect(degistir(/Bulaşık makinesi/)).toHaveAttribute('aria-expanded', 'false');
  });

  it('Space de seçer; şu anki durumu seçmek değişiklik yazmadan kapatır', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />, { wrapper });
    await user.click(degistir(/Köpek yatağı/));
    let options = screen.getAllByRole('menuitemradio');
    await waitFor(() => expect(options[3]).toHaveFocus());
    await user.keyboard(' ');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(degistir(/Köpek yatağı/)).toHaveFocus());

    await user.keyboard(' ');
    options = await screen.findAllByRole('menuitemradio');
    await waitFor(() => expect(options[3]).toHaveFocus());
    await user.keyboard('{ArrowUp}{ArrowUp} ');
    expect(onChange).toHaveBeenCalledWith(alimlar[3], fiyatEksik);
    await waitFor(() => expect(degistir(/Köpek yatağı/)).toHaveFocus());
    expect(within(screen.getByRole('region', { name: 'Fiyat eksik' })).getByRole('button', { name: /Köpek yatağı/ })).toBeInTheDocument();
  });

  it('Escape değişiklik yapmadan kapatır; odak açan düğmeye döner', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />, { wrapper });
    const trigger = degistir(/Oto koltuğu/);
    await user.click(trigger);
    await waitFor(() => expect(screen.getAllByRole('menuitemradio')[2]).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('statusOptions verilirse seçenekler oradan gelir (iş akışı); yoksa sütunlar', async () => {
    const user = userEvent.setup();
    const yalniz = [siparis, teslim];
    render(<Kanban items={alimlar} columns={sutunlar} statusOptions={yalniz} onChangeStatus={vi.fn()} />, { wrapper });
    await user.click(degistir(/Bebek karyolası/));
    expect(screen.getAllByRole('menuitemradio').map(o => o.textContent)).toEqual(['Sipariş verildi', 'Teslim alındı']);
  });
});

describe('Kanban › geniş: tembel pano (ui/wide/Kanban.wide.tsx)', () => {
  const wrapper = onDevice('desktop');

  it('masaüstünde aynı bölge düğümü önce liste yedeğini, sonra yatay pano ızgarasını taşır: sekme durağı, data-gorunum pano', async () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    const before = pano();
    await panoyuBekle();
    const board = pano();
    // Bölge yerinde kalır: geçişte ona tutunan odak ya da sorgu kopmaz (sayfa testleri within(pano) kullanır).
    expect(board).toBe(before);
    expect(board.querySelector('.aile-kanban-liste')).toBeNull();
    expect(board).toHaveClass('aile-kanban', 'aile-kanban--pano');
    expect(board).toHaveAttribute('tabindex', '0');
    expect(board).toHaveAttribute('data-device', 'desktop');
    expect(within(board).getAllByRole('region').map(c => c.getAttribute('aria-label'))).toEqual(sutunlar.map(s => s.label));
    expect(within(screen.getByRole('region', { name: 'Sipariş verildi' })).getByText('Planlanan ₺26.500,00 · 1 fiyatsız')).toBeInTheDocument();
  });

  it('tablette de pano; panoda kart içi "Durumu değiştir" yoktur (ayrıntıdaki eylem aynı işi yapar)', async () => {
    render(<Kanban items={alimlar} columns={sutunlar} onChangeStatus={vi.fn()} />, { wrapper: onDevice('tablet') });
    await panoyuBekle();
    expect(screen.queryByRole('button', { name: 'Durumu değiştir' })).toBeNull();
  });

  it('pano sekme sırasına girer, ardından kartlar; Enter ve Space kartı açar', async () => {
    const onOpen = vi.fn();
    render(<Kanban items={alimlar} columns={sutunlar} onOpen={onOpen} />, { wrapper });
    await panoyuBekle();
    await userEvent.tab();
    expect(pano()).toHaveFocus();
    await userEvent.tab();
    const first = screen.getByRole('button', { name: /Emzirme koltuğu/ });
    expect(first).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenLastCalledWith(alimlar[4]);
    await userEvent.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('kart odak çizgisini admin.css ile alır (data-focus-line); halka yoktur', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper });
    const card = screen.getByRole('button', { name: /Bebek karyolası/ });
    expect(card).toHaveAttribute('data-focus-line');
    expect(card).toHaveAttribute('type', 'button');
  });

  it('bölge etiketi değiştirilebilir', () => {
    render(<Kanban items={alimlar} label="Duruma göre iş emirleri" />, { wrapper });
    expect(screen.getByRole('region', { name: 'Duruma göre iş emirleri' })).toBeInTheDocument();
  });
});

describe('Kanban › dokunma (Pointer Events)', () => {
  it.each(['phone', 'desktop'] as const)('%s: basılınca data-pressed; pointercancel (kaydırma) basılı durumu siler ve kartı açmaz', async device => {
    const onOpen = vi.fn();
    render(<Kanban items={alimlar} columns={sutunlar} onOpen={onOpen} />, { wrapper: onDevice(device) });
    if (device === 'desktop') await panoyuBekle();
    const card = screen.getByRole('button', { name: /Bebek karyolası/ });
    fireEvent.pointerDown(card, { pointerType: 'touch', button: 0, isPrimary: true });
    expect(card).toHaveAttribute('data-pressed', 'true');
    fireEvent.pointerCancel(card, { pointerType: 'touch' });
    expect(card).not.toHaveAttribute('data-pressed');
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.pointerDown(card, { pointerType: 'touch', button: 0, isPrimary: true });
    fireEvent.pointerUp(card, { pointerType: 'touch' });
    expect(card).not.toHaveAttribute('data-pressed');
  });

  it('farenin ikincil düğmesi basılı durum vermez', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper: onDevice('phone') });
    const card = screen.getByRole('button', { name: /Bebek karyolası/ });
    fireEvent.pointerDown(card, { pointerType: 'mouse', button: 2 });
    expect(card).not.toHaveAttribute('data-pressed');
  });
});

describe('Kanban › CSS (yerleşim, hedef, hareket)', () => {
  it('liste: dikey, yatay kaydırma ve scroll-snap yok; pano CSS\'i yalnız geniş dosyada (248 px, kendi içinde yatay kayar)', () => {
    const css = read('Kanban.css');
    expect(css).not.toMatch(/overflow-x:\s*auto/);
    expect(css).not.toMatch(/scroll-snap/);
    expect(css).not.toMatch(/248px|264px/);
    const wide = read('wide/Kanban.wide.css');
    const board = wide.match(/\.aile-kanban--pano\s*\{[^}]*\}/)?.[0] ?? '';
    expect(board).toMatch(/overflow-x:\s*auto/);
    const grid = wide.match(/\.aile-kanban-izgara\s*\{[^}]*\}/)?.[0] ?? '';
    expect(grid).toMatch(/248px/);
    expect(grid).toMatch(/grid-auto-flow:\s*column/);
  });

  it('pano bölgesinin odak çizgisi: bölgenin kendi ::after\'ı, kaydırmayan kaba göre konumlanır (kırpılmaz); ortak CSS\'te', () => {
    // b04: kaydırma alanı (overflow-x:auto) kendi içine konumlanan ::after'ı kırpar. Bölge konumlanmaz; çizgi saran
    // .aile-kanban-kap'a göre bölgenin 4 px altında, bölge genişliğinde çizilir. Kaba [data-focus-line] konmaz: o,
    // içerideki karta odaklanınca da (:has(:focus-visible)) ikinci bir çizgi çizerdi. Kural ortak Kanban.css'te: geniş
    // CSS yüklenemese de sekme durağı olan bölge göstergesiz kalmaz. Yalnız klavye modu ve :focus-visible.
    const css = read('Kanban.css');
    const line = css.match(/html\[data-keyboard='true'\] \.aile-kanban--pano:focus-visible::after\s*\{[^}]*\}/)?.[0] ?? '';
    expect(line).toMatch(/content:\s*""/);
    expect(line).toMatch(/position:\s*absolute/);
    expect(line).toMatch(/left:\s*0/);
    expect(line).toMatch(/right:\s*0/);
    expect(line).toMatch(/bottom:\s*calc\(-1 \* \(var\(--aile-odak-aralik\) \+ var\(--aile-odak-kalinlik\)\)\)/);
    expect(line).toMatch(/height:\s*var\(--aile-odak-kalinlik\)/);
    expect(line).toMatch(/background:\s*var\(--aile-odak\)/);
    const kap = css.match(/\.aile-kanban-kap\s*\{[^}]*\}/)?.[0] ?? '';
    expect(kap).toMatch(/position:\s*relative/);
    for (const block of css.match(/(^|\n)\.aile-kanban(--pano)?\s*\{[^}]*\}/g) ?? []) expect(block).not.toMatch(/position:/);
    expect(read('wide/Kanban.wide.css')).not.toMatch(/position:\s*relative/);
    expect(read('wide/Kanban.wide.css')).not.toMatch(/::after/);
    expect(read('Kanban.tsx')).not.toMatch(/className="aile-kanban-kap"[^>]*data-focus-line/);
  });

  it('dokunma hedefi: kart ve "Durumu değiştir" 44 px; kaba işaretçide 48 px (hedef-asgari + bosluk-1)', () => {
    const css = read('Kanban.css');
    expect(css).toMatch(/\.aile-kanban-kart\s*\{[^}]*min-height:\s*var\(--aile-kanban-hedef\)/);
    expect(css).toMatch(/--aile-kanban-hedef:\s*var\(--aile-hedef-asgari\)/);
    expect(css).toMatch(/\[data-input-coarse\][^{]*\{[^}]*--aile-kanban-hedef:\s*calc\(var\(--aile-hedef-asgari\)\s*\+\s*var\(--aile-bosluk-1\)\)/);
    expect(css).toMatch(/\.aile-kanban-degistir[^{]*\{[^}]*min-height:\s*var\(--aile-kanban-hedef\)/);
  });

  it('basılı durum: :active ve [data-pressed] aynı secili yüzey; reduced-motion anlık', () => {
    const css = read('Kanban.css');
    expect(css).toMatch(/\.aile-kanban-kart\[data-pressed='true'\]/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*transition-duration:\s*0s/);
    expect(read('wide/Kanban.wide.css')).not.toMatch(/transition/);
  });
});

describe('Kanban › kaynak kuralları', () => {
  const FILES = ['Kanban.tsx', 'Kanban.parts.tsx', 'Kanban.press.ts', 'wide/Kanban.wide.tsx'];

  it('ham antd/pro/phosphor/echarts/mantine yok; ./antd yok', () => {
    for (const file of FILES) {
      const tsx = read(file);
      expect(tsx, file).not.toMatch(/from\s+['"](antd|@ant-design\/|@phosphor-icons\/|echarts|@mantine\/)/);
      expect(tsx, file).not.toMatch(/from\s+['"]\.{1,2}\/antd['"]/);
      expect(tsx, file).not.toMatch(/Intl\.NumberFormat/);
      expect(tsx, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(tsx, file).not.toMatch(/style=\{/);
      expect(tsx, file).not.toMatch(/draggable|onDragStart/);
    }
  });

  it('pano yalnız lazyWide ile açık import()\'la gelir; geniş modül statik içe aktarılmaz ve default export verir', () => {
    const tsx = read('Kanban.tsx');
    expect(tsx).toMatch(/lazyWide\(\s*'ui-kanban-pano',\s*\(\)\s*=>\s*import\('\.\/wide\/Kanban\.wide'\)\s*\)/);
    expect(tsx).toMatch(/from ['"]\.\.\/adaptive['"]/);
    for (const file of FILES) expect(wideRuleViolations(`src/admin/ui/${file}`, read(file)), file).toEqual([]);
    expect(read('Kanban.parts.tsx')).not.toMatch(/\.wide['"]/);
    expect(read('wide/Kanban.wide.tsx')).toContain("import './Kanban.wide.css'");
  });

  it('para tek kaynaktan (Money), toplam kesin (data/actuals sumMoney); durum etiketi ./Tag, simge ./icons', () => {
    const parts = read('Kanban.parts.tsx');
    expect(parts).toMatch(/from ['"]\.\/Money['"]/);
    expect(parts).toMatch(/from ['"]\.\.\/data\/actuals['"]/);
    expect(parts).toMatch(/sumMoney\(/);
    expect(parts).toMatch(/from ['"]\.\/Tag['"]/);
    expect(parts).toMatch(/from ['"]\.\/icons['"]/);
    expect(read('Kanban.tsx')).toContain("import './Kanban.css'");
  });

  it('CSS: hex yok, outline/box-shadow yok, metin 14 px altına inmez, tokenlar ve tek hareket eğrisi', () => {
    for (const file of ['Kanban.css', 'wide/Kanban.wide.css']) {
      const css = read(file);
      expect(css, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, file).not.toMatch(/outline\s*:(?!\s*none)/);
      expect(css, file).not.toMatch(/box-shadow\s*:(?!\s*none)/);
      expect(css, file).not.toMatch(/\.ant-/);
      const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
      if (sizes.length) expect(Math.min(...sizes), file).toBeGreaterThanOrEqual(14);
      // Radiuslu kutuda tek kenar renkli şerit yok.
      expect(css, file).not.toMatch(/border-(left|right|top|bottom)\s*:\s*\d+px\s+solid\s+var\(--aile-(eylem|olumlu|uyari|hata|secili|acik-mavi)\)/);
    }
    const css = read('Kanban.css');
    for (const token of ['--aile-liste-zemin', '--aile-yuzey', '--aile-secili', '--aile-bilgi-yuzey', '--aile-cizgi', '--aile-fotograf-liste', '--aile-hedef-asgari', '--aile-kose-kart', '--aile-kose-kontrol', '--aile-sure', '--aile-egri']) {
      expect(css, token).toContain(`var(${token})`);
    }
  });
});
