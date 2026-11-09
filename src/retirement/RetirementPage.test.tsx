import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, expect, it, vi } from 'vitest';
import Dashboard from '../dashboard/Dashboard';
import { buildBudget, type Budget, type Category, type Irregular } from '../dashboard/data';
import { buildCurrentBudget } from '../dashboard/current';
import { syntheticCurrentSheets } from '../dashboard/currentFixtures';
import { syntheticSheets } from '../dashboard/fixtures';
import { useBudget } from '../dashboard/useBudget';
import { currentDirectoryLink, directoryGroups } from '../app/family/navigation';
import { FinancePeriodProvider } from '../app/family/FinancePeriod';
import RetirementPage from './RetirementPage';
import { retirementPlan } from './retirement';

vi.mock('wouter/use-hash-location', () => ({ useHashLocation: () => ['/emeklilik', vi.fn()] }));
vi.mock('../dashboard/useBudget', () => ({ useBudget: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const payment = (over: Partial<Irregular>): Irregular => ({
  id: 'A', label: 'Sentetik Bağ-Kur borcu', type: 'Tek seferlik', planMonth: 'Aralık 2098', month: 'Aralık 2098', plan: 1000, current: 1000,
  status: 'Planlı', room: 'Emeklilik', note: 'Sentetik kaynak notu', manual: false, ...over,
});
const budget = (irregular: Irregular[]): Budget => {
  const base = buildBudget(syntheticSheets());
  const reserve = { id: 'Borç/Bağkur', label: 'Vergi ve Bağkur', group: 'Borç ve vergi', kind: 'expense' as const, plan: [0, 300, 300], current: [0, 999, 999] };
  return { ...base, irregular, categories: [...base.categories, reserve] };
};
const message = (text: RegExp) => screen.getAllByRole('status').find(node => text.test(node.textContent ?? ''));
const page = (data: Budget | null, loading = false) => render(<MantineProvider><FinancePeriodProvider>
  <RetirementPage data={data} loading={loading} updatedAt={null} refresh={vi.fn()} />
</FinancePeriodProvider></MantineProvider>);

it('adds only rows of the Emeklilik section and leaves cancelled rows out of the total', () => {
  const plan = retirementPlan(budget([
    payment({ id: 'A', current: 1000 }), payment({ id: 'B', current: 234.5 }),
    payment({ id: 'C', status: 'İptal', current: 9000 }), payment({ id: 'D', room: 'Salon', current: 7000 }),
  ]));
  expect(plan.payments.map(row => row.id)).toEqual(['A', 'B']);
  expect(plan.total).toBe(1234.5);
  expect(plan.missing).toBe(0);
  expect(plan.months).toEqual(['Aralık 2098']);
});

it('counts a missing amount as missing, never as a zero payment', () => {
  const plan = retirementPlan(budget([payment({ id: 'A', current: null }), payment({ id: 'B', current: 50, month: 'Ocak 2099' })]));
  expect(plan.total).toBe(50);
  expect(plan.missing).toBe(1);
  expect(plan.months).toEqual(['Aralık 2098', 'Ocak 2099']);
});

it('sums the monthly Bağ-Kur reserve over the months that really have one', () => {
  const [reserve] = retirementPlan(budget([])).reserves;
  expect(reserve).toMatchObject({ label: 'Vergi ve Bağkur', total: 600, count: 2, first: 'Aralık 2098', last: 'Ocak 2099' });
});

const withReserve = (over: Partial<Category>): Budget => {
  const base = budget([]);
  return { ...base, categories: [{ id: 'X', label: 'Vergi ve Bağkur', group: 'Borç ve vergi', kind: 'expense', plan: [0, 0, 0], current: [0, 0, 0], ...over }] };
};

it('reads the reserve from Plan, the sheet the user edits, not from Gerçekleşen', () => {
  expect(retirementPlan(budget([])).reserves[0].total).toBe(600);
});

it('says a reserve month is missing instead of hiding it inside the total', () => {
  const [reserve] = retirementPlan(withReserve({ plan: [300, null, 300] })).reserves;
  expect(reserve).toMatchObject({ total: 600, count: 2, gaps: 1 });
  expect(retirementPlan(withReserve({ plan: [null, null, null] })).reserves[0]).toMatchObject({ total: null, count: 0 });
});

it('never treats income such as a pension as money set aside', () => {
  expect(retirementPlan(withReserve({ kind: 'income', label: 'SGK emekli aylığı', plan: [100, 100, 100] })).reserves).toEqual([]);
});

it('accepts the section name however it is cased in the Sheet', () => {
  expect(retirementPlan(budget([payment({ room: 'EMEKLİLİK' }), payment({ id: 'B', room: ' emeklilik ' })])).payments).toHaveLength(2);
});

it('shows no total at all when every amount is missing, and names a partial total', () => {
  expect(retirementPlan(budget([payment({ current: null })])).total).toBeNull();
  page(budget([payment({ current: null })]));
  const empty = screen.getByRole('group', { name: 'SGK ödemeleri özeti' });
  expect(empty).toHaveTextContent('Tutar yok');
  expect(empty).not.toHaveTextContent('0 ₺');
  cleanup();
  page(budget([payment({ current: null }), payment({ id: 'B', current: 50 })]));
  const partial = screen.getByRole('group', { name: 'SGK ödemeleri özeti' });
  expect(partial).toHaveTextContent('Bilinen toplam');
  expect(partial).toHaveTextContent('1 kalemin tutarı eksik');
});

it('repeats amount and month in the first column for narrow screens', () => {
  page(budget([payment({})]));
  expect(document.querySelector('.retirement-glance')).toHaveTextContent('1.000 ₺ · Aralık 2098');
});

it('calls the reserve a period total, so it cannot be read as a monthly amount', () => {
  page(budget([payment({})]));
  expect(screen.getByRole('heading', { name: 'Dönem boyunca ayrılan' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Dönem boyunca ayrılan tutarlar' })).toHaveTextContent('Aralık 2098 ile Ocak 2099 arasında, 2 ay');
});

it('does not promise a calendar month that the budget period does not contain', () => {
  page(budget([payment({ month: 'Mayıs 3000', planMonth: 'Mayıs 3000' })]));
  expect(screen.getByRole('link', { name: /Ödeme takvimine bak/ })).not.toHaveTextContent('Mayıs 3000');
});

it('reads a live-schema Sheet row through its Yer / Bölüm cell', () => {
  const raw = syntheticCurrentSheets();
  raw.irregular[1][8] = 'Emeklilik';
  expect(retirementPlan(buildCurrentBudget(raw))).toMatchObject({ total: 500, months: ['Aralık 2098'], payments: [{ label: 'Örnek mobilya', note: 'Örnek not' }] });
});

it('shows the amount, the month and the Sheet note of every SGK payment', () => {
  page(budget([payment({})]));
  expect(screen.getByRole('heading', { level: 1, name: 'Emeklilik ve SGK' })).toBeInTheDocument();
  const summary = screen.getByRole('group', { name: 'SGK ödemeleri özeti' });
  expect(summary).toHaveTextContent('1.000 ₺');
  expect(summary).toHaveTextContent('Aralık 2098');
  const row = within(screen.getByRole('table')).getByRole('row', { name: /Sentetik Bağ-Kur borcu/ });
  expect(row).toHaveTextContent('Sentetik kaynak notu');
  expect(row).toHaveTextContent('Planlı');
});

it('tells where to write a payment when the Sheet has none', () => {
  page(budget([]));
  expect(message(/Arızi Giderler sekmesinde Yer \/ Bölüm sütununa Emeklilik yazın/)).toBeDefined();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('links to the payment calendar and to the panel calculator, and says the calculator needs a profile file', () => {
  page(budget([payment({})]));
  expect(screen.getByRole('link', { name: /Ödeme takvimine bak/ })).toHaveAttribute('href', '#/timeline');
  const calculator = screen.getByRole('link', { name: /Emeklilik seçeneklerini karşılaştır/ });
  expect(calculator).toHaveAttribute('href', 'admin.html#/emeklilik');
  expect(calculator).toHaveTextContent('profil dosyası');
});

it('keeps the page heading while the Sheet is loading or cannot be read', () => {
  page(null, true);
  expect(screen.getByRole('heading', { level: 1, name: 'Emeklilik ve SGK' })).toBeInTheDocument();
  expect(message(/SGK ödemeleri yükleniyor/)).toBeDefined();
  cleanup();
  page(null);
  expect(message(/Yenile düğmesiyle/)).toBeDefined();
});

it('is one global menu destination that Dashboard opens with the live budget feed', async () => {
  expect(directoryGroups.flatMap(group => group.links).filter(link => link.path === '/emeklilik')).toHaveLength(1);
  expect(currentDirectoryLink('/emeklilik').label).toBe('Emeklilik ve SGK');
  vi.mocked(useBudget).mockReturnValue({ data: budget([payment({})]), error: null, loading: false, updatedAt: null, refresh: vi.fn() });
  render(<MantineProvider><FinancePeriodProvider><Dashboard /></FinancePeriodProvider></MantineProvider>);
  await waitFor(() => expect(screen.getByRole('table')).toHaveTextContent('Sentetik Bağ-Kur borcu'));
  expect(useBudget).toHaveBeenCalledWith(true);
});
