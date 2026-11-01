import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, userEvent, within } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Item } from '@shared/schema';
import { applyRead, getState, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { PurchaseList } from './PurchaseList';

vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn(), hide: vi.fn() } }));
vi.mock('@/sync/controller', () => ({
  upsert: vi.fn((_table, id: string, patch: Record<string, unknown>) => {
    setState(state => ({ items: state.items.map(item => item.id === id ? { ...item, ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === null ? undefined : value])) } as Item : item) }));
    return id;
  }), remove: vi.fn(), refresh: vi.fn(), startSync: vi.fn(),
}));
const item: Item = { id: 'recovery-a', tip: 'satinalma', ad: 'Deneme koltuğu', durum: 'siparis', faz: '1', oda: 'salon', not: 'İlk not' };
beforeEach(() => { resetStore(); localStorage.clear(); vi.clearAllMocks(); });
function mount(items: Item[] = [item]) {
  setState({ hydrated: true, status: 'synced', items });
  const { hook } = memoryLocation({ path: '/satinalma' });
  return render(<Router hook={hook}><PurchaseList /></Router>);
}
function undoMessage() {
  return screen.getByRole('region', { name: 'Son alım işlemi' });
}

it('moves checked items to Aldıklarımız and offers a persistent named undo that restores only status', async () => {
  mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  expect(within(screen.getByTestId('item-list')).queryByText('Deneme koltuğu')).not.toBeInTheDocument();
  expect(undoMessage()).toBeInTheDocument();
  expect(screen.getByText(/Deneme koltuğu.*alındı/)).toBeInTheDocument();
  act(() => setState({ items: [{ ...getState().items[0], not: 'Yeni sunucu notu', gercek_tl: 900 }] }));
  await userEvent.click(screen.getByRole('button', { name: 'Geri al' }));
  expect(upsert).toHaveBeenLastCalledWith('kalemler', item.id, { durum: 'siparis' });
  expect(getState().items[0]).toMatchObject({ durum: 'siparis', not: 'Yeni sunucu notu', gercek_tl: 900 });
  expect(screen.getByRole('link', { name: 'Deneme koltuğu detayı' })).toHaveFocus();
});

it('shows completed items by name and allows a later uncheck; cancelled items stay in Tüm kalemler', async () => {
  mount([item, { ...item, id: 'done', ad: 'Alınmış masa', durum: 'kuruldu' }, { ...item, id: 'cancelled', ad: 'İptal edilen lamba', durum: 'iptal' }]);
  await userEvent.click(screen.getByRole('radio', { name: 'Aldıklarımız 1' }));
  expect(screen.getAllByTestId('item-card')).toHaveLength(1);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Alınmış masa alındı' }));
  expect(upsert).toHaveBeenLastCalledWith('kalemler', 'done', { durum: 'karar' });
  await userEvent.click(screen.getByRole('radio', { name: 'Alınacaklar 2' }));
  expect(screen.getByText('Alınmış masa')).toBeInTheDocument();
  expect(screen.queryByText('İptal edilen lamba')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'Tüm kalemler 3' }));
  expect(screen.getByText('İptal edilen lamba')).toBeInTheDocument();
});

it('does not apply an old undo when the status changed remotely', async () => {
  localStorage.setItem('aile:purchase:filters', JSON.stringify({ hideDone: true }));
  mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  undoMessage();
  act(() => setState({ items: [{ ...getState().items[0], durum: 'kuruldu' }] }));
  vi.mocked(upsert).mockClear();
  await userEvent.click(screen.getByRole('button', { name: 'Geri al' }));
  expect(upsert).not.toHaveBeenCalled();
  expect(getState().items[0].durum).toBe('kuruldu');
});

it('restores an originally missing status without inventing Karar', async () => {
  localStorage.setItem('aile:purchase:filters', JSON.stringify({ hideDone: true }));
  mount([{ ...item, durum: undefined }]);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  undoMessage();
  await userEvent.click(screen.getByRole('button', { name: 'Geri al' }));
  expect(upsert).toHaveBeenLastCalledWith('kalemler', item.id, { durum: null });
});

it('does not time out the only immediate undo action', async () => {
  localStorage.setItem('aile:purchase:filters', JSON.stringify({ hideDone: true }));
  mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  vi.useFakeTimers();
  try {
    act(() => vi.advanceTimersByTime(10000));
    expect(within(undoMessage()).getByRole('button', { name: 'Geri al' })).toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});

it('offers the same undo after an accidental uncheck and restores Kuruldu exactly', async () => {
  mount([{ ...item, durum: 'kuruldu' }]);
  await userEvent.click(screen.getByRole('radio', { name: 'Aldıklarımız 1' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  expect(within(screen.getByTestId('item-list')).queryByText('Deneme koltuğu')).not.toBeInTheDocument();
  expect(undoMessage()).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Geri al' }));
  expect(upsert).toHaveBeenLastCalledWith('kalemler', item.id, { durum: 'kuruldu' });
  expect(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' })).toBeChecked();
});

it('does not revive a deleted item', async () => {
  mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  undoMessage();
  act(() => setState({ items: [{ ...getState().items[0], deleted_at: '2026-11-01T08:00:00Z' }] }));
  vi.mocked(upsert).mockClear();
  await userEvent.click(screen.getByRole('button', { name: 'Geri al' }));
  expect(upsert).not.toHaveBeenCalled();
});

it('keeps only the latest of four actions; Undo preserves earlier statuses and every note', async () => {
  const items = Array.from({ length: 4 }, (_, index) => ({ ...item, id: `item-${index}`, ad: `Kalem ${index}`, not: `Not ${index}` }));
  mount(items);
  for (const entry of items) await userEvent.click(screen.getByRole('checkbox', { name: `${entry.ad} alındı` }));
  expect(screen.getAllByRole('region', { name: 'Son alım işlemi' })).toHaveLength(1);
  expect(undoMessage()).toHaveTextContent('Kalem 3');
  await userEvent.click(screen.getByRole('button', { name: 'Geri al' }));
  getState().items.forEach((entry, index) => expect(entry).toMatchObject({ durum: index === 3 ? 'siparis' : 'teslim', not: `Not ${index}` }));
});

it('preserves phase, room, search and sort while removing only an incompatible status filter', async () => {
  localStorage.setItem('aile:purchase:filters', JSON.stringify({ faz: '1', oda: ['salon'], durum: ['siparis'] }));
  localStorage.setItem('aile:purchase:sort', JSON.stringify('ad'));
  mount([item, { ...item, id: 'done', ad: 'Deneme masa', durum: 'teslim' }, { ...item, id: 'other-room', ad: 'Mutfak masası', durum: 'teslim', oda: 'mutfak' }]);
  await userEvent.type(screen.getByRole('searchbox', { name: 'Kalem ara' }), 'Deneme');
  await userEvent.click(screen.getByRole('radio', { name: 'Aldıklarımız 1' }));
  expect(screen.getByRole('radio', { name: 'Önce' })).toBeChecked();
  expect(screen.getByRole('searchbox', { name: 'Kalem ara' })).toHaveValue('Deneme');
  expect(screen.getByTestId('sort-button')).toHaveAccessibleName('Sırala: Ad (A → Z)');
  expect(screen.getByTestId('active-chip-oda-salon')).toBeInTheDocument();
  expect(screen.getByText('Deneme masa')).toBeInTheDocument();
  expect(screen.queryByText('Mutfak masası')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('item-card')).toHaveLength(1);
});


it.each(['kuruldu', 'karar', 'deleted'] as const)('invalidates an old undo across observed %s then teslim, even inside one React batch', async intermediate => {
  mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  undoMessage();
  const delivered = { ...getState().items[0], version: 2 };
  act(() => {
    applyRead({ ok: true, fingerprint: 'remote-3', serverTime: 't3', schemaVersion: 2, settings: [], items: [{ ...delivered, version: 3, ...(intermediate === 'deleted' ? { deleted_at: 't3' } : { durum: intermediate }) }] });
    applyRead({ ok: true, fingerprint: 'remote-4', serverTime: 't4', schemaVersion: 2, settings: [], items: [{ ...delivered, version: 4 }] });
  });
  vi.mocked(upsert).mockClear();
  await userEvent.click(screen.getByRole('button', { name: 'Geri al' }));
  expect(upsert).not.toHaveBeenCalled();
  expect(getState().items[0]).toMatchObject({ durum: 'teslim', version: 4 });
});

it('preserves undo across observed remote note and price updates with unchanged status', async () => {
  mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  undoMessage();
  act(() => applyRead({ ok: true, fingerprint: 'notes', serverTime: 't', schemaVersion: 2, settings: [], items: [{ ...getState().items[0], version: 7, not: 'Sunucudan yeni not', gercek_tl: 12345 }] }));
  await userEvent.click(screen.getByRole('button', { name: 'Geri al' }));
  expect(upsert).toHaveBeenLastCalledWith('kalemler', item.id, { durum: 'siparis' });
  expect(getState().items[0]).toMatchObject({ not: 'Sunucudan yeni not', gercek_tl: 12345 });
});
