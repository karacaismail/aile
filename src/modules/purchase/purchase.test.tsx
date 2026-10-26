import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Item } from '@shared/schema';
import { ItemCard } from './ItemCard';
import { TotalsBar } from './TotalsBar';
import { totalsFor } from '@/data/selectors';
import { toPatch } from './ItemDetail';
import { applyRead, resetStore, setState } from '@/sync/store';
import { PurchaseList } from './PurchaseList';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(), remove: vi.fn(), refresh: vi.fn(), startSync: vi.fn() }));

const item: Item = { id: 'A', tip: 'satinalma', ad: 'Örnek koltuk takımı uzun bir ad ile', faz: '1', durum: 'karar', oda: 'salon', tahmini_tl_min: 1500, tahmini_tl_max: 1500, karar_bekliyor: true, siparis_son_tarih: '2099-01-01' };

function withRouter(ui: React.ReactElement, path = '/satinalma') {
  const { hook } = memoryLocation({ path, static: false });
  return <Router hook={hook}>{ui}</Router>;
}

beforeEach(() => resetStore());

describe('ItemCard', () => {
  it('ad, fiyat, rozetler ve alındı kutusu', async () => {
    const onToggle = vi.fn();
    render(withRouter(<ItemCard item={item} onToggleDone={onToggle} />));
    expect(screen.getByText(item.ad)).toBeInTheDocument();
    expect(screen.getByText('₺1.500')).toBeInTheDocument();
    expect(screen.getByText('Önce')).toBeInTheDocument();
    expect(screen.getByText('Karar')).toBeInTheDocument();
    expect(screen.getByText('Salon')).toBeInTheDocument();
    expect(screen.getByText('karar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /alındı/ }));
    expect(onToggle).toHaveBeenCalledWith(item, true);
  });
  it('mevcut eşya fiyat yerine "mevcut" gösterir', () => {
    render(withRouter(<ItemCard item={{ ...item, mevcut: true }} onToggleDone={vi.fn()} />));
    expect(screen.getByText('mevcut')).toBeInTheDocument();
  });
});

describe('TotalsBar', () => {
  it('toplam, kalem ve fiyatsız sayısı', () => {
    const items: Item[] = [item, { id: 'B', tip: 'satinalma', ad: 'Fiyatsız', faz: '1' }, { id: 'C', tip: 'satinalma', ad: 'Sonra', faz: '2', tahmini_tl_min: 10 }];
    render(<TotalsBar faz="1" onFaz={vi.fn()} totals={totalsFor(items, '1', new Date(2026, 9, 26))} />);
    expect(screen.getByTestId('totals-sum')).toHaveTextContent('₺1.500');
    expect(screen.getByText('2 kalem')).toBeInTheDocument();
    expect(screen.getByText('1 fiyatsız')).toBeInTheDocument();
  });
});

describe('toPatch', () => {
  it('yeni kalemde tüm alanlar; var olanda yalnız değişenler', () => {
    const base = { ad: 'X', faz: '1' as const, karar_bekliyor: false, oncelik: 2, adet: 1, birim: 'adet', tahmini_tl_min: 5, tahmini_tl_max: null, gercek_tl: null, nereden: '', siparis_son_tarih: null, teslim_suresi_gun: null, teslim_tarihi: null, linkler: [], not: '', mevcut: false };
    const p = toPatch(base);
    expect(p).toMatchObject({ tip: 'satinalma', ad: 'X', tahmini_tl_min: 5, tahmini_tl_max: 5, fiyat_guven: 'tahmini', linkler: null, nereden: null });
    const prev: Item = { id: 'A', tip: 'satinalma', ad: 'X', faz: '1', oncelik: 2, adet: 1, birim: 'adet', tahmini_tl_min: 5, tahmini_tl_max: 5, fiyat_guven: 'tahmini' };
    const p2 = toPatch({ ...base, ad: 'Y' }, prev);
    expect(p2).toEqual({ tip: 'satinalma', ad: 'Y' });
  });
});

describe('PurchaseList', () => {
  it('boş liste EmptyState gösterir; veri gelince kartlar', async () => {
    setState({ hydrated: true, status: 'synced' });
    const { rerender } = render(withRouter(<PurchaseList />));
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [item, { ...item, id: 'B', ad: 'İkinci' }], settings: [] });
    rerender(withRouter(<PurchaseList />));
    const list = screen.getByTestId('item-list');
    expect(within(list).getAllByTestId('item-card')).toHaveLength(2);
  });
  it('arama filtreler', async () => {
    setState({ hydrated: true, status: 'synced' });
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [item, { ...item, id: 'B', ad: 'Perde' }], settings: [] });
    render(withRouter(<PurchaseList />));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Kalem ara' }), 'perde');
    await screen.findByText('Perde');
    await vi.waitFor(() => expect(within(screen.getByTestId('item-list')).getAllByTestId('item-card')).toHaveLength(1));
  });
});
