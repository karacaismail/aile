import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, userEvent, within } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { notifications } from '@mantine/notifications';
import type { Item } from '@shared/schema';
import { getState, resetStore, setState } from '@/sync/store';
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
  expect(notifications.show).toHaveBeenCalled();
  const notification = vi.mocked(notifications.show).mock.calls.at(-1)![0];
  render(<>{notification.message}</>);
  return notification;
}

it('moves checked items to Aldıklarımız and offers a persistent named undo that restores only status', async () => {
  mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  expect(within(screen.getByTestId('item-list')).queryByText('Deneme koltuğu')).not.toBeInTheDocument();
  const notification = undoMessage();
  expect(notification.autoClose).toBe(false);
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
  expect(undoMessage().autoClose).toBe(false);
});

it('offers the same undo after an accidental uncheck and restores Kuruldu exactly', async () => {
  mount([{ ...item, durum: 'kuruldu' }]);
  await userEvent.click(screen.getByRole('radio', { name: 'Aldıklarımız 1' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  expect(within(screen.getByTestId('item-list')).queryByText('Deneme koltuğu')).not.toBeInTheDocument();
  const notification = undoMessage();
  expect(notification.autoClose).toBe(false);
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

it('invalidates an older undo after another completion action on the same item', async () => {
  mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  undoMessage();
  const olderUndo = screen.getByRole('button', { name: 'Geri al' });
  await userEvent.click(screen.getByRole('radio', { name: 'Aldıklarımız 1' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  await userEvent.click(screen.getByRole('radio', { name: 'Alınacaklar 1' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Deneme koltuğu alındı' }));
  vi.mocked(upsert).mockClear();
  await userEvent.click(olderUndo);
  expect(upsert).not.toHaveBeenCalled();
  expect(getState().items[0].durum).toBe('teslim');
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
