import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { DeviceContext } from '../device';
import type { Device, RecordRow, StatusLabel } from '../shell/contracts';
import { Kanban } from './Kanban';

// Tasarım: components/Kanban/README.md + index.d.ts KanbanProps; referans davranış bundle.js Kanban/KanbanCard.
// Sütun = tedarik durumu (RecordRow.status). Başlık: durum etiketi + "N kayıt" + sütunun planlanan toplamı (gerçek
// toplanmaz) + "N fiyatsız". Kart: 56 px foto ya da "Fotoğraf yok", ad, kod · oda, Planlanan/Gerçekleşen ayrı, ödeme
// etiketi. Pano kendi içinde yatay kayar; telefonda 264 px sütun + scroll-snap. Sürükleme yok; kart tıklanır/Enter.
// Seçiciler role/label ile; antd iç sınıfı yok. Sentetik veri; gerçek aile kaydı değildir.

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

describe('Kanban › klavye', () => {
  const wrapper = onDevice('desktop');

  it('pano sekme sırasına girer, ardından kartlar; Enter ve Space kartı açar', async () => {
    const onOpen = vi.fn();
    render(<Kanban items={alimlar} columns={sutunlar} onOpen={onOpen} />, { wrapper });
    const board = screen.getByRole('region', { name: 'Tedarik durumuna göre alımlar' });
    await userEvent.tab();
    expect(board).toHaveFocus();
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
});

describe('Kanban › kaydırma kapsayıcısı ve cihaz', () => {
  const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

  it('masaüstünde pano dar değildir; data-device desktop', () => {
    render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper: onDevice('desktop') });
    const board = screen.getByRole('region', { name: 'Tedarik durumuna göre alımlar' });
    expect(board).toHaveClass('aile-kanban');
    expect(board).not.toHaveClass('aile-kanban--dar');
    expect(board).toHaveAttribute('data-device', 'desktop');
  });

  it('telefonda dar biçim (264 px sütun, scroll-snap); narrow prop cihazı ezer', () => {
    const { unmount } = render(<Kanban items={alimlar} columns={sutunlar} />, { wrapper: onDevice('phone') });
    expect(screen.getByRole('region', { name: 'Tedarik durumuna göre alımlar' })).toHaveClass('aile-kanban--dar');
    unmount();
    render(<Kanban items={alimlar} columns={sutunlar} narrow />, { wrapper: onDevice('desktop') });
    expect(screen.getByRole('region', { name: 'Tedarik durumuna göre alımlar' })).toHaveClass('aile-kanban--dar');
  });

  it('CSS: pano kendi içinde yatay kayar; dar biçimde 264 px sütun ve scroll-snap; geniş 248 px', () => {
    const css = read('Kanban.css');
    const board = css.match(/\.aile-kanban\s*\{[^}]*\}/)?.[0] ?? '';
    expect(board).toMatch(/overflow-x:\s*auto/);
    expect(board).toMatch(/248px/);
    const dar = css.match(/\.aile-kanban--dar\s*\{[^}]*\}/)?.[0] ?? '';
    expect(dar).toMatch(/264px/);
    expect(dar).toMatch(/scroll-snap-type:\s*x/);
    expect(css).toMatch(/\.aile-kanban--dar\s*>\s*\.aile-kanban-sutun\s*\{[^}]*scroll-snap-align:\s*start/);
  });

  it('bölge etiketi değiştirilebilir', () => {
    render(<Kanban items={alimlar} label="Duruma göre iş emirleri" />, { wrapper: onDevice('desktop') });
    expect(screen.getByRole('region', { name: 'Duruma göre iş emirleri' })).toBeInTheDocument();
  });
});

describe('Kanban › kaynak kuralları', () => {
  const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

  it('ham antd/pro/phosphor/echarts/mantine yok; Tag ./Tag, para ./Money, simge ./icons, cihaz ../device üzerinden', () => {
    const tsx = read('Kanban.tsx');
    expect(tsx).not.toMatch(/from\s+['"](antd|@ant-design\/|@phosphor-icons\/|echarts|@mantine\/)/);
    expect(tsx).toMatch(/from ['"]\.\/Tag['"]/);
    expect(tsx).toMatch(/from ['"]\.\/Money['"]/);
    // Para biçimi tek kaynaktan (Money); bileşen kendi Intl biçimleyicisini kurmaz.
    expect(tsx).not.toMatch(/Intl\.NumberFormat/);
    expect(tsx).toMatch(/from ['"]\.\/icons['"]/);
    expect(tsx).toMatch(/from ['"]\.\.\/device['"]/);
    expect(tsx).toMatch(/useDevice\(\)/);
    expect(tsx).toContain("import './Kanban.css'");
    // Sabit renk ve inline stil yok; görsel kurallar CSS'te, tokenlardan.
    expect(tsx).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(tsx).not.toMatch(/style=\{/);
    expect(tsx).not.toMatch(/draggable|onDragStart/);
  });

  it('CSS: hex yok, outline/box-shadow yok, metin 14 px altına inmez, tokenlar ve tek hareket eğrisi', () => {
    const css = read('Kanban.css');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/outline\s*:(?!\s*none)/);
    expect(css).not.toMatch(/box-shadow\s*:(?!\s*none)/);
    const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    for (const token of ['--aile-liste-zemin', '--aile-yuzey', '--aile-secili', '--aile-bilgi-yuzey', '--aile-cizgi', '--aile-fotograf-liste', '--aile-hedef-asgari', '--aile-kose-kart', '--aile-kose-kontrol', '--aile-sure', '--aile-egri']) {
      expect(css, token).toContain(`var(${token})`);
    }
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    // Radiuslu kutuda tek kenar renkli şerit yok.
    expect(css).not.toMatch(/border-(left|right|top|bottom)\s*:\s*\d+px\s+solid\s+var\(--aile-(eylem|olumlu|uyari|hata|secili|acik-mavi)\)/);
  });
});
