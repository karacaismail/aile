import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { label, type Item } from '@shared/schema';
import { DEFAULT_FILTERS, filterPurchases, normalizeFilters, totalsFor } from '@/data/selectors';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { PurchaseList } from './PurchaseList';
import { TotalsBar } from './TotalsBar';
import { ItemCard } from './ItemCard';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(() => 'NEWID'), remove: vi.fn(), refresh: vi.fn(), startSync: vi.fn() }));
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn(), hide: vi.fn() } }));

const pending: Item = { id: 'AFTER', tip: 'satinalma', ad: 'Araştırılan sehpa', faz: '2', durum: 'fikir', karar_bekliyor: true, tahmini_tl_min: 100, tahmini_tl_max: 200, adet: 2 };
const items: Item[] = [
  { id: 'BEFORE', tip: 'satinalma', ad: 'Önceki kalem', faz: '1', tahmini_tl_min: 1000 },
  pending,
  { id: 'BABY', tip: 'satinalma', ad: 'Bebek kalemi', faz: '3', tahmini_tl_min: 500 },
];
function mount(path = '/satinalma') {
  setState({ hydrated: true, status: 'synced' });
  applyRead({ ok: true, fingerprint: 'phase-fixture', serverTime: '2099-01-01', schemaVersion: 2, items, settings: [] });
  const location = memoryLocation({ path, static: false });
  render(<Router hook={location.hook}><Route path="/satinalma" nest><PurchaseList /></Route></Router>);
}
beforeEach(() => { resetStore(); localStorage.clear(); vi.clearAllMocks(); });

it('Sonra retains stored phase 2, the same records and totals without including Before or Baby', async () => {
  const filters = normalizeFilters({ ...DEFAULT_FILTERS, faz: '2' });
  expect(filters.faz).toBe('2');
  expect(filterPurchases(items, filters).map(item => item.id)).toEqual(['AFTER']);
  const totals = totalsFor(items, filters.faz);
  expect(totals).toMatchObject({ count: 1, sumMin: 200, sumMax: 400, pendingDecision: 1 });
  const onFaz = vi.fn();
  render(<TotalsBar faz="2" onFaz={onFaz} totals={totals} />);
  expect(screen.getByRole('radio', { name: 'Sonra' })).toBeChecked();
  expect(screen.getAllByRole('radio').map(input => input.getAttribute('value'))).toEqual(['hepsi', '1', '2', '3']);
  await userEvent.click(screen.getByRole('radio', { name: 'Önce' }));
  expect(onFaz).toHaveBeenLastCalledWith('1');
});

it('new form from the saved Sonra filter defaults to and saves phase 2', async () => {
  localStorage.setItem('aile:purchase:filters', JSON.stringify({ ...DEFAULT_FILTERS, faz: '2' }));
  mount('/satinalma/yeni');
  const dialog = await screen.findByRole('dialog', { name: 'Yeni kalem' });
  const phase = within(dialog).getByRole('group', { name: 'Faz' });
  expect(within(phase).getByRole('radio', { name: 'Sonra' })).toBeChecked();
  expect(phase).toHaveTextContent('Taşınma sonrası · yerleşme');
  await userEvent.type(within(dialog).getByLabelText(/^Ad\b/), 'Sonraki alım planı');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
  expect(upsert).toHaveBeenCalledWith('kalemler', undefined, expect.objectContaining({ ad: 'Sonraki alım planı', faz: '2' }));
});

it('shared Sonra label does not turn a pending estimate into a completed purchase', () => {
  const location = memoryLocation({ path: '/satinalma', static: true });
  render(<Router hook={location.hook}><ItemCard item={pending} onToggleDone={vi.fn()} /></Router>);
  expect(label('faz', '2')).toBe('Sonra');
  expect(screen.getByRole('group', { name: 'Durum ve kapsam' })).toHaveTextContent('Sonra');
  expect(screen.getByText('Karar bekliyor')).toBeVisible();
  expect(screen.getByText('Tahmini bedel')).toBeVisible();
  expect(screen.getByText('Ödeme kaydı değildir.')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: /alındı/ })).not.toBeChecked();
});

it('editing a phase 2 note retains the pending decision and does not rewrite the stored phase', async () => {
  mount('/satinalma/AFTER');
  const dialog = await screen.findByRole('dialog', { name: pending.ad });
  expect(within(dialog).getByRole('radio', { name: 'Sonra' })).toBeChecked();
  expect(within(dialog).getByRole('switch', { name: 'Karar bekliyor' })).toBeChecked();
  await userEvent.type(within(dialog).getByLabelText('Not'), 'Teklif bekleniyor');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
  expect(upsert).toHaveBeenCalledWith('kalemler', 'AFTER', { tip: 'satinalma', not: 'Teklif bekleniyor' });
});
