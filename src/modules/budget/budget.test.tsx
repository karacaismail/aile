import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { BudgetPlan, CashEntry } from '@shared/schema';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert, remove } from '@/sync/controller';
import { BudgetModule, ExpenseHost } from './index';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(() => 'NEWID'), remove: vi.fn(), restore: vi.fn() }));

const m = (n: number) => Array(12).fill(n) as number[];
const plan: BudgetPlan = {
  year: 2099,
  groups: [
    { name: 'BORÇLAR', rows: [{ label: 'Kredi A', plan: m(1000) }] },
    { name: 'DİĞERLERİ', rows: [{ label: 'Market', plan: m(300) }, { label: 'Okul', plan: m(0) }] },
  ],
};
const cash: CashEntry[] = [
  { id: 'C1', tarih: '2099-03-02', tutar: 120, kalem: 'Market', not: 'haftalık', created_at: '2099-03-02T10:00:00Z' },
  { id: 'C2', tarih: '2099-02-10', tutar: 50, kalem: 'Market', created_at: '2099-02-10T10:00:00Z' },
];

function mount(path = '/butce', data: { cash?: CashEntry[]; plan?: BudgetPlan } = { cash, plan }) {
  setState({ hydrated: true, status: 'synced' });
  applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 2, items: [], settings: [], ...data });
  const loc = memoryLocation({ path, static: false, record: true });
  render(<Router hook={loc.hook}><Route path="/butce" nest><BudgetModule /></Route><ExpenseHost /></Router>);
  return loc;
}

beforeEach(() => {
  resetStore();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2099-03-15T12:00:00'));
  vi.mocked(upsert).mockClear();
  vi.mocked(remove).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('Bütçe ekranı', () => {
  it('içinde bulunulan ayı plan × kayıt olarak gösterir; ay değiştirilebilir', async () => {
    mount();
    expect(screen.getByTestId('month-label')).toHaveTextContent('Mart 2099');
    expect(screen.getByTestId('month-actual')).toHaveTextContent('120');
    expect(screen.getByTestId('month-plan')).toHaveTextContent('1.300');
    expect(screen.getByTestId('kalem-Market')).toHaveTextContent('120');
    expect(screen.queryByTestId('kalem-Okul')).toBeNull();
    expect(within(screen.getByTestId('entries')).getByText(/haftalık/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('month-prev'));
    expect(screen.getByTestId('month-label')).toHaveTextContent('Şubat 2099');
    expect(screen.getByTestId('month-actual')).toHaveTextContent('50');
  });

  it('kalem satırına dokununca form o kalemle açılır; tutar + Kaydet tek kayıt yazar', async () => {
    mount();
    await userEvent.click(screen.getByTestId('kalem-Kredi A'));
    const form = await screen.findByTestId('expense-form');
    expect(within(form).getByTestId('kalem-select')).toHaveValue('Kredi A');
    await userEvent.type(within(form).getByLabelText(/Tutar/), '1000');
    await userEvent.click(within(form).getByTestId('expense-save'));
    expect(upsert).toHaveBeenCalledWith('nakit', undefined, { tarih: '2099-03-15', tutar: 1000, kalem: 'Kredi A', not: null });
  });

  it('tutar boşsa kaydetmez; çip ile kalem seçilir', async () => {
    mount();
    await userEvent.click(screen.getByTestId('fab'));
    const form = await screen.findByTestId('expense-form');
    await userEvent.click(within(form).getByTestId('expense-save'));
    expect(upsert).not.toHaveBeenCalled();
    expect(within(form).getByText('Tutar girin')).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText(/Tutar/), '45');
    await userEvent.click(within(form).getByRole('radio', { name: 'Kredi A' }));
    await userEvent.click(within(form).getByTestId('expense-save'));
    expect(upsert).toHaveBeenCalledWith('nakit', undefined, expect.objectContaining({ tutar: 45, kalem: 'Kredi A' }));
  });

  it('kayda dokununca düzenlenir ve silinebilir', async () => {
    mount();
    await userEvent.click(screen.getByTestId('entry-C1'));
    const form = await screen.findByTestId('expense-form');
    expect(within(form).getByLabelText(/Not/)).toHaveValue('haftalık');
    await userEvent.click(within(form).getByTestId('expense-delete'));
    expect(remove).toHaveBeenCalledWith('nakit', 'C1');
  });

  it('sunucu günlüğü desteklemiyorsa uyarır; /butce/yeni formu doğrudan açar', async () => {
    const loc = mount('/butce/yeni', { plan });
    expect(await screen.findByTestId('expense-form')).toBeInTheDocument();
    expect(screen.getByText('Tablo tarafı güncellenmedi')).toBeInTheDocument();
    expect(screen.getByTestId('expense-save')).toBeDisabled();
    expect(loc.history.at(-1)).toBe('/butce');
  });
});
