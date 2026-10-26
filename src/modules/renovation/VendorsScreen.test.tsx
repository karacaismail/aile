import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
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
    expect(within(cards[0]).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80');
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
