import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, userEvent, within } from '@/test-utils/render';
import type { Item } from '@shared/schema';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { RenovationModule } from './index';
import { readFull } from './testData';
import { VendorDetail } from './VendorDetail';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(), remove: vi.fn(), restore: vi.fn() }));

function mount(path = '/tadilat/ustalar') {
  const { hook } = memoryLocation({ path, static: false });
  return render(<Router hook={hook}><Route path="/tadilat" nest><RenovationModule /></Route></Router>);
}

beforeEach(() => { resetStore(); vi.mocked(upsert).mockClear(); setState({ hydrated: true, status: 'synced' }); });

describe('Ustalar', () => {
  it('teklifi ödeme olarak sunmaz; bedel ve koşullar ayrı adlandırılır', () => {
    applyRead(readFull());
    mount();
    const cards = screen.getAllByTestId('vendor-card');
    expect(within(cards[0]).getByText('Teklif bedeli')).toBeInTheDocument();
    expect(within(cards[0]).getByText('İş süresi')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Garanti')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Teklif, yapılmış ödeme değildir.')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Teklif girilmedi')).toBeInTheDocument();
    expect(within(cards[1]).queryByText('₺0')).not.toBeInTheDocument();
  });
  it('sayaç, MYK rozetleri, telefon ve WhatsApp bağlantıları, teklif alanları', () => {
    applyRead(readFull());
    mount();
    expect(screen.getByTestId('vendor-stats')).toHaveTextContent('2 aday · 1 teklif (hedef: 5 aday → 3 teklif)');
    const cards = screen.getAllByTestId('vendor-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('MYK doğrulandı')).toBeInTheDocument();
    expect(within(cards[1]).getByText('MYK doğrulanmadı')).toBeInTheDocument();
    expect(within(cards[0]).getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/905321112233');
    expect(within(cards[0]).getByRole('link', { name: /0532 111 22 33/ })).toHaveAttribute('href', 'tel:+905321112233');
    expect(within(cards[0]).getByText('₺12.000')).toBeInTheDocument();
    expect(within(cards[0]).getByText(/4 gün/)).toBeInTheDocument();
    expect(within(cards[0]).getByText(/12 ay/)).toBeInTheDocument();
    expect(within(cards[0]).getByRole('meter', { name: 'Şartname uyumu' })).toHaveAttribute('aria-valuenow', '80');
  });
  it('meslek filtresi listeyi ve sayacı daraltır', async () => {
    applyRead(readFull());
    mount();
    await userEvent.click(screen.getByRole('radio', { name: 'Boya' }));
    expect(screen.getAllByTestId('vendor-card')).toHaveLength(1);
    expect(screen.getByText('Usta İki')).toBeInTheDocument();
    expect(screen.getByTestId('vendor-stats')).toHaveTextContent('1 aday · 0 teklif');
  });
  it('karta dokununca detay modalı; Fab yeni usta', async () => {
    applyRead(readFull());
    mount();
    await userEvent.click(screen.getByRole('link', { name: 'Usta Bir detayı' }));
    const form = await screen.findByTestId('vendor-detail');
    expect(within(form).getByLabelText(/^Ad/)).toHaveValue('Usta Bir');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('fab'));
    expect(await screen.findByText('Yeni usta')).toBeInTheDocument();
  });
  it('yeni ustada boş Ad ile Kaydet: yazmaz, odak Ad alanına döner, hata sayısı duyurulur', async () => {
    applyRead(readFull());
    mount();
    await userEvent.click(screen.getByTestId('fab'));
    const form = await screen.findByTestId('vendor-detail');
    await userEvent.click(within(form).getByLabelText('Not'));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(within(form).getByLabelText(/^Ad\b/)).toHaveFocus();
    expect(within(form).getByRole('status')).toHaveTextContent('1 alan düzeltilmeli');
  });
});

describe('VendorDetail: kayıt zamanlaması', () => {
  const mountDetail = (id: string) => {
    const { hook } = memoryLocation({ path: `/tadilat/ustalar/${id}`, static: false });
    return render(<Router hook={hook}><VendorDetail id={id} /></Router>);
  };
  const vendorId = () => readFull().items.find((i) => i.tip === 'usta' && i.ad === 'Usta Bir')!.id;
  it('derin bağlantıda kayıt sonradan gelince form dolu açılır (önce iskelet, form kurulmaz)', async () => {
    setState({ hydrated: false, status: 'loading' });
    mountDetail(vendorId());
    expect(screen.getByTestId('vendor-detail-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('vendor-detail')).not.toBeInTheDocument();
    applyRead(readFull());
    expect(await screen.findByTestId('vendor-detail')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Ad/)).toHaveValue('Usta Bir');
    expect(screen.getByLabelText('MYK doğrulandı (myk.gov.tr sorgusu yapıldı)')).toBeChecked();
  });
  it('yükleme bitti ve kayıt yoksa "bulunamadı"', () => {
    applyRead(readFull());
    mountDetail('yok');
    expect(screen.getByText(/Usta bulunamadı/)).toBeInTheDocument();
  });
  it('kaydet yalnız değişen alanı patch\'ler; boş alanlar null ile silinmez', async () => {
    applyRead(readFull());
    mountDetail(vendorId());
    await userEvent.type(screen.getByLabelText('Garanti (ay)'), '4'); // 12 → 124
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', vendorId(), { tip: 'usta', garanti_ay: 124 });
  });
});

describe('VendorDetail: alan sahipliği (Tur 5)', () => {
  const U1 = readFull().items.find((i) => i.id === 'u1')!;
  const open = async () => {
    applyRead(readFull());
    mount('/tadilat/ustalar/u1');
    return screen.findByTestId('vendor-detail');
  };
  const refresh = (record: Item) => act(() => { applyRead(readFull({ items: [...readFull().items.filter((i) => i.id !== record.id), record], fingerprint: 'g' })); });
  const lastPatch = () => vi.mocked(upsert).mock.calls.at(-1)![2];

  it('yalnız Not değişince, sunucuda değişen teklif, MYK ve uyum geri yazılmaz', async () => {
    const form = await open();
    await userEvent.type(within(form).getByLabelText('Not'), 'Yeni not');
    refresh({ ...U1, teklif_tl: 14000, myk_dogrulandi: false, uyum_pct: 0, version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(lastPatch()).toEqual({ tip: 'usta', not: 'Yeni not' });
  });

  it('aynı alanı (Telefon) sunucu da değiştirdiyse yazmaz; çakışma çözülünce yalnız o alan yazılır', async () => {
    const form = await open();
    const tel = within(form).getByLabelText('Telefon');
    await userEvent.clear(tel);
    await userEvent.type(tel, '0532 999 99 99');
    refresh({ ...U1, telefon: '0532 777 77 77', version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    const alert = within(form).getByRole('alert');
    expect(alert).toHaveTextContent('Telefon');
    expect(alert).toHaveTextContent('0532 999 99 99');
    expect(alert).toHaveTextContent('0532 777 77 77');
    await userEvent.click(within(alert).getByRole('button', { name: 'Benim değerim kalsın' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(lastPatch()).toEqual({ tip: 'usta', telefon: '0532 999 99 99' });
  });

  it('yalnız boşluk değişikliği (Telefon) sunucu değeri değişse de yazmaz', async () => {
    const form = await open();
    await userEvent.type(within(form).getByLabelText('Telefon'), '  ');
    refresh({ ...U1, telefon: '0532 777 77 77', version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
  });

  it('0 boş değildir: garanti 0 yazılır', async () => {
    const form = await open();
    const g = within(form).getByLabelText('Garanti (ay)');
    await userEvent.clear(g);
    await userEvent.type(g, '0');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(lastPatch()).toEqual({ tip: 'usta', garanti_ay: 0 });
  });
});

describe('Usta kartı: kayıt dili (Tur 5)', () => {
  it('meslek düz metin, MYK simgeli dikkat metni; renkli rozet yok', () => {
    applyRead(readFull());
    mount();
    const [u1, u2] = screen.getAllByTestId('vendor-card');
    expect(u1.querySelector('.mantine-Badge-root')).toBeNull();
    expect(within(u1).getByText('Elektrik').closest('.record-meta')).not.toBeNull();
    const ok = within(u1).getByText('MYK doğrulandı').closest('li')!;
    expect(ok).toHaveAttribute('data-tone', 'ok');
    expect(ok.querySelector('svg')).not.toBeNull();
    expect(within(u2).getByText('MYK doğrulanmadı').closest('li')).toHaveAttribute('data-tone', 'warn');
  });
  it('puan çubuğu görünür etiketli bir meter: Şartname uyumu', () => {
    applyRead(readFull());
    mount();
    const [u1] = screen.getAllByTestId('vendor-card');
    const meter = within(u1).getByRole('meter', { name: 'Şartname uyumu' });
    expect(meter).toHaveAttribute('aria-valuenow', '80');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '%80');
    expect(document.getElementById(meter.getAttribute('aria-labelledby')!)).toBeVisible();
    // Telefon bağlantısı puanla aynı satırda değildir.
    const tel = within(u1).getByRole('link', { name: /0532 111 22 33/ });
    expect(meter.parentElement!.contains(tel)).toBe(false);
  });
});
