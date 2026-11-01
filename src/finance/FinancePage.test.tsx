import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FinancePage from './FinancePage';
import { buildFinance } from './data';
import { syntheticFinance } from './fixtures';
import { useFinance } from './useFinance';
import { FinancePeriodProvider, useFinancePeriod } from '../app/family/FinancePeriod';
import { useEffect } from 'react';

vi.mock('../dashboard/Charts', () => ({ Chart: () => <div aria-label="Sentetik çizim" /> }));

vi.mock('./useFinance', () => ({ useFinance: vi.fn() }));
vi.mock('../dashboard/Select', () => ({ Select: (props: { value: string; onChange: (value: string) => void; data: { value: string; label: string }[] }) => <select aria-label="Dönem" value={props.value} onChange={event => props.onChange(event.target.value)}>{props.data.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select> }));
const mount = () => render(<MantineProvider><FinancePage /></MantineProvider>);
beforeEach(() => vi.mocked(useFinance).mockReturnValue({ data: buildFinance(syntheticFinance()), error: null, loading: false, updatedAt: null, refresh: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('shows native month-end cash and card debt with conditional source and separate KMH costs', () => {
  mount();
  const summary = screen.getByRole('region', { name: 'Ocak 2098 ay sonu' });
  expect(within(summary).getByText('500 ₺')).toBeInTheDocument();
  expect(within(summary).getByText('155 ₺')).toBeInTheDocument();
  expect(screen.getByText(/gerçekleşmiş ödeme değildir/i)).toBeInTheDocument();
  expect(screen.getByText(/banka oranı ve geçmiş faiz teyitsiz/)).toBeInTheDocument();
  expect(screen.getByText('Harcanabilir nakit ayrılan bütçeler sonrasıdır; banka bakiyesi değildir.')).toBeInTheDocument();
  const opening = screen.getByRole('row', { name: /Sentetik dönem başlangıcı/ });
  expect(within(opening).getByText('512 ₺')).toBeInTheDocument();
  expect(within(opening).getByText('50 ₺')).toBeInTheDocument();
  expect(within(opening).getByText('2 ₺')).toBeInTheDocument();
  expect(screen.getByText(/gelecek taksit.*kart borcuna dahildir/i)).toBeInTheDocument();
});

it('keeps the selected month while switching local views and shows source rows in original order', () => {
  mount();
  fireEvent.change(screen.getByRole('combobox', { name: 'Dönem' }), { target: { value: '2098-02' } });
  expect(screen.queryByText('Sentetik dönem başlangıcı')).not.toBeInTheDocument();
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Sentetik iç aktarım');
  fireEvent.click(screen.getByRole('tab', { name: 'Aylık özet' }));
  expect(screen.getByRole('table', { name: 'Aylık finansman özeti' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Dönem' })).toHaveValue('2098-02');
  fireEvent.click(screen.getByRole('tab', { name: 'Günlük adımlar' }));
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Sentetik iç aktarım');
});

it('hides all financial values when the current native source is rejected', () => {
  vi.mocked(useFinance).mockReturnValue({ data: null, error: 'Kaynak değişti; hesap yenilenmeli.', loading: false, updatedAt: null, refresh: vi.fn() });
  mount();
  expect(screen.getByRole('alert')).toHaveTextContent(/yenilenmeli/);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText(/₺/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Finansman e-tablosunu aç' })).toBeInTheDocument();
});

it('renders small funding gaps and instalment cents without rounding away obligations', () => {
  const data = buildFinance(syntheticFinance());
  data.months[0].fundingGap = .49;
  data.events[0].futureInstalments = 12222.22;
  vi.mocked(useFinance).mockReturnValue({ data, error: null, loading: false, updatedAt: null, refresh: vi.fn() });
  mount();
  expect(screen.getByRole('note')).toHaveTextContent('0,49 ₺');
  expect(screen.getByText('12.222,22 ₺')).toBeInTheDocument();
});

it('loads an accessible skeleton without invented dates, numbers or percentages', () => {
  vi.mocked(useFinance).mockReturnValue({ data: null, error: null, loading: true, updatedAt: null, refresh: vi.fn() });
  mount();
  expect(screen.getByRole('status')).toHaveTextContent(/kontrol ediliyor/i);
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.queryByText(/₺|%/)).not.toBeInTheDocument();
});

it('groups spendable cash separately from financing commitments without dropping native facts', () => {
  mount();
  const summary = screen.getByRole('region', { name: 'Ocak 2098 ay sonu' });
  expect(within(summary).getByRole('group', { name: 'Nakit sonucu' })).toHaveTextContent('500 ₺');
  const commitments = within(summary).getByRole('group', { name: 'Borç ve taahhütler' });
  expect(commitments).toHaveTextContent('155 ₺');
  expect(commitments).toHaveTextContent('KMH anaparası');
  expect(commitments).toHaveTextContent('Gelecek taksit');
});

it('steps between months with controls named by their destination and keeps the selection shared', () => {
  mount();
  const previous = screen.getByRole('button', { name: /^Önceki ay/ });
  expect(previous).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Sonraki ay · Şubat 2098' }));
  expect(screen.getByRole('combobox', { name: 'Dönem' })).toHaveValue('2098-02');
  expect(screen.getByRole('region', { name: 'Şubat 2098 ay sonu' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Önceki ay · Ocak 2098' })).toBeEnabled();
  expect(screen.getByRole('button', { name: /^Sonraki ay/ })).toBeDisabled();
});

it('states every month-end figure against the previous month end, and a first month as having none', () => {
  mount();
  const january = screen.getByRole('region', { name: 'Ocak 2098 ay sonu' });
  expect(january).toHaveTextContent('İlk ay · önceki ayla karşılaştırma yok');
  fireEvent.change(screen.getByRole('combobox', { name: 'Dönem' }), { target: { value: '2098-02' } });
  const february = screen.getByRole('region', { name: 'Şubat 2098 ay sonu' });
  const fact = (group: string, label: string) => within(within(february).getByRole('group', { name: group })).getByText(label).closest('div')!;
  expect(fact('Nakit sonucu', 'Harcanabilir nakit')).toHaveTextContent('Ocak 2098 ay sonuna göre +900 ₺');
  expect(fact('Nakit sonucu', 'Net nakit ve borç')).toHaveTextContent('Ocak 2098 ay sonuna göre +750 ₺');
  expect(fact('Borç ve taahhütler', 'Toplam kart borcu')).toHaveTextContent('Ocak 2098 ay sonuna göre +150 ₺');
  // The principal change is named and sits before the interest, so it cannot read as an interest change.
  const kmh = fact('Borç ve taahhütler', 'KMH anaparası');
  expect(kmh).toHaveTextContent('Anapara değişimi: Ocak 2098 ay sonuna göre değişmedi');
  expect(kmh.textContent!.indexOf('Anapara değişimi')).toBeLessThan(kmh.textContent!.indexOf('Faiz + vergi'));
});

it('ends the month summary with the month-specific payment steps as the next step', () => {
  mount();
  const next = screen.getByRole('navigation', { name: 'Bu aydan sonraki adım' });
  expect(within(next).getByRole('link', { name: /Ocak 2098 ödeme adımları/ })).toHaveAttribute('href', '#/timeline');
  const summary = screen.getByRole('region', { name: 'Ocak 2098 ay sonu' });
  expect(summary.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('says so when the shared month is not in this ledger instead of silently showing another month', () => {
  function Preset() { const [, set] = useFinancePeriod(); useEffect(() => set('2099-05'), [set]); return null; }
  render(<MantineProvider><FinancePeriodProvider><Preset /><FinancePage /></FinancePeriodProvider></MantineProvider>);
  expect(screen.getByRole('note', { name: 'Seçilen dönem' })).toHaveTextContent('Mayıs 2099 bu hesapta yok; Ocak 2098 gösteriliyor.');
  fireEvent.click(screen.getByRole('button', { name: 'Sonraki ay · Şubat 2098' }));
  expect(screen.queryByRole('note', { name: 'Seçilen dönem' })).not.toBeInTheDocument();
});

// Narrow scroll planes show only the first column: it repeats what happened, how much and (only when unambiguous) which account moved.
const glance = (row: HTMLElement) => within(row).getAllByRole('cell')[0].querySelector('.finance-glance');

it('answers what happened and how much in the first cell, keeping zero amounts and the real cells', () => {
  mount();
  const opening = screen.getByRole('row', { name: /Sentetik dönem başlangıcı/ });
  expect(glance(opening)).toHaveAttribute('aria-hidden', 'true');
  expect(glance(opening)).toHaveTextContent('Sentetik dönem başlangıcı');
  expect(glance(opening)).toHaveTextContent('Nakit etkisi 0 ₺');
  // The first step has no earlier step to compare with, and the month close moves all three accounts: no account is named.
  expect(glance(opening)).not.toHaveTextContent(/anaparası değişti/);
  const close = screen.getByRole('row', { name: /Sentetik ay sonu/ });
  expect(glance(close)).toHaveTextContent('Nakit etkisi +550 ₺');
  expect(glance(close)).not.toHaveTextContent(/anaparası değişti/);
  expect(within(opening).getAllByRole('cell')[1]).toHaveTextContent('Nakit etkisi 0 ₺');
  expect(within(opening).getAllByRole('cell')).toHaveLength(11);
});

it('names the moved account only when exactly one principal changed against the previous ledger step, across month boundaries', () => {
  const data = buildFinance(syntheticFinance());
  // Only the Denizbank principal moves between the January close and the first February step.
  data.events[2].denizPrincipal = 80;
  vi.mocked(useFinance).mockReturnValue({ data, error: null, loading: false, updatedAt: null, refresh: vi.fn() });
  mount();
  fireEvent.change(screen.getByRole('combobox', { name: 'Dönem' }), { target: { value: '2098-02' } });
  const transfer = screen.getByRole('row', { name: /Sentetik iç aktarım/ });
  expect(glance(transfer)).toHaveTextContent('Nakit etkisi +1.000 ₺');
  expect(glance(transfer)).toHaveTextContent('Denizbank kartı anaparası değişti');
  // The February close moves Denizbank and İşbank principals together: ambiguous, so no account is named.
  const close = screen.getByRole('row', { name: /Sentetik ay sonu/ });
  expect(glance(close)).toHaveTextContent('Nakit etkisi -100 ₺');
  expect(glance(close)).not.toHaveTextContent(/anaparası değişti/);
});

it('names no account when no principal changed against the previous ledger step', () => {
  mount();
  fireEvent.change(screen.getByRole('combobox', { name: 'Dönem' }), { target: { value: '2098-02' } });
  const transfer = screen.getByRole('row', { name: /Sentetik iç aktarım/ });
  expect(glance(transfer)).toHaveTextContent('Sentetik iç aktarım');
  expect(glance(transfer)).not.toHaveTextContent(/anaparası değişti/);
});

it('names an all-period scope carried from Timeline instead of formatting it as a month, and commits the shown month on the named link', () => {
  function Preset() { const [period, set] = useFinancePeriod(); useEffect(() => set('all'), [set]); return <output aria-label="Paylaşılan dönem">{period}</output>; }
  render(<MantineProvider><FinancePeriodProvider><Preset /><FinancePage /></FinancePeriodProvider></MantineProvider>);
  expect(screen.getByRole('note', { name: 'Seçilen dönem' })).toHaveTextContent('Tüm dönem bu sayfada aylık özet olarak gösterilmez; Ocak 2098 gösteriliyor.');
  expect(screen.queryByText(/Invalid|NaN/)).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Bu aydan sonraki adım' })).getByRole('link', { name: /Ocak 2098 ödeme adımları/ }));
  expect(screen.getByRole('status', { name: 'Paylaşılan dönem' })).toHaveTextContent('2098-01');
});

it('states the moved account in the real step cell, not only in the hidden narrow glance', () => {
  const data = buildFinance(syntheticFinance());
  data.events[2].denizPrincipal = 80;
  vi.mocked(useFinance).mockReturnValue({ data, error: null, loading: false, updatedAt: null, refresh: vi.fn() });
  mount();
  fireEvent.change(screen.getByRole('combobox', { name: 'Dönem' }), { target: { value: '2098-02' } });
  const transfer = screen.getByRole('row', { name: /Sentetik iç aktarım/ });
  const step = within(transfer).getAllByRole('cell')[1];
  expect(step).toHaveTextContent('Denizbank kartı anaparası değişti');
  expect(within(step).getByText('Denizbank kartı anaparası değişti').closest('[aria-hidden="true"]')).toBeNull();
  // The row's accessible name carries it too.
  expect(transfer).toHaveAccessibleName(/Denizbank kartı anaparası değişti/);
});

it('adds source-backed monthly trends only in the monthly view, with exact selected values and the complete source table', async () => {
  mount();
  expect(screen.queryByRole('region', { name: 'Nakit ve borcun seyri' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Aylık özet' }));
  const trends = screen.getByRole('region', { name: 'Nakit ve borcun seyri' });
  expect(within(trends).getByRole('group', { name: 'Harcanabilir nakit' })).toHaveTextContent('Ocak 2098500 ₺');
  expect(within(trends).getByRole('group', { name: 'Toplam kart borcu' })).toHaveTextContent('Ocak 2098155 ₺');
  expect(within(trends).getByRole('group', { name: 'KMH anaparası' })).toHaveTextContent('Ocak 20980 ₺');
  expect(trends).toHaveTextContent(/ortak TL ölçeği/);
  expect(screen.getByRole('table', { name: 'Aylık finansman özeti' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sonraki ay · Şubat 2098' }));
  expect(within(trends).getByRole('group', { name: 'Harcanabilir nakit' })).toHaveTextContent('Şubat 20981.400 ₺');
  expect(within(trends).getByRole('group', { name: 'Toplam kart borcu' })).toHaveTextContent('Şubat 2098305 ₺');
  expect(screen.getByText(/banka oranı ve geçmiş faiz teyitsiz/)).toBeInTheDocument();
  await screen.findAllByLabelText('Sentetik çizim');
});

it('restores a validated chart month after explicit recovery and consumes only its query parameter', async () => {
  const before = window.location.href;
  window.history.replaceState({ keep: 'navigation-state' }, '', '?keep=1&financeChartMonth=2098-02#/finansman');
  try {
    render(<MantineProvider><FinancePeriodProvider><FinancePage /></FinancePeriodProvider></MantineProvider>);
    expect(screen.getByRole('combobox', { name: 'Dönem' })).toHaveValue('2098-02');
    expect(screen.getByRole('tab', { name: 'Aylık özet' })).toHaveAttribute('aria-selected', 'true');
    expect(new URL(window.location.href).search).toBe('?keep=1');
    expect(window.history.state).toEqual({ keep: 'navigation-state' });
    expect(window.location.hash).toBe('#/finansman');
    await screen.findAllByLabelText('Sentetik çizim');
    fireEvent.change(screen.getByRole('combobox', { name: 'Dönem' }), { target: { value: '2098-01' } });
    expect(screen.getByRole('region', { name: 'Ocak 2098 ay sonu' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Dönem' })).toHaveValue('2098-01');
  } finally { window.history.replaceState(null, '', before); }
});

it.each(['not-a-month', '2097-12'])('ignores invalid or out-of-ledger recovery month %s without inventing a period', month => {
  const before = window.location.href;
  window.history.replaceState(null, '', `?financeChartMonth=${month}#/finansman`);
  try {
    mount();
    expect(screen.getByRole('combobox', { name: 'Dönem' })).toHaveValue('2098-01');
    expect(screen.getByRole('tab', { name: 'Günlük adımlar' })).toHaveAttribute('aria-selected', 'true');
    expect(new URL(window.location.href).searchParams.has('financeChartMonth')).toBe(false);
  } finally { window.history.replaceState(null, '', before); }
});

it('consumes recovery even during a load error and does not override a later shared month after leaving', () => {
  const before = window.location.href;
  window.history.replaceState(null, '', '?keep=1&financeChartMonth=2098-02#/finansman');
  const PeriodChoice = () => { const [, select] = useFinancePeriod(); return <button onClick={() => select('2098-01')}>Ocak seç</button>; };
  const tree = (finance: boolean) => <MantineProvider><FinancePeriodProvider>{finance ? <FinancePage /> : <PeriodChoice />}</FinancePeriodProvider></MantineProvider>;
  vi.mocked(useFinance).mockReturnValue({ data: null, loading: false, error: 'Kaynak doğrulanamadı.', updatedAt: null, refresh: vi.fn() });
  try {
    const screenView = render(tree(true));
    expect(new URL(window.location.href).search).toBe('?keep=1');
    screenView.rerender(tree(false));
    fireEvent.click(screen.getByRole('button', { name: 'Ocak seç' }));
    vi.mocked(useFinance).mockReturnValue({ data: buildFinance(syntheticFinance()), loading: false, error: null, updatedAt: null, refresh: vi.fn() });
    screenView.rerender(tree(true));
    expect(screen.getByRole('combobox', { name: 'Dönem' })).toHaveValue('2098-01');
    expect(screen.getByRole('tab', { name: 'Günlük adımlar' })).toHaveAttribute('aria-selected', 'true');
  } finally { window.history.replaceState(null, '', before); }
});

it('holds consumed recovery in this page while loading and applies it only to a validated ledger', async () => {
  const before = window.location.href;
  window.history.replaceState(null, '', '?financeChartMonth=2098-02#/finansman');
  vi.mocked(useFinance).mockReturnValue({ data: null, loading: true, error: null, updatedAt: null, refresh: vi.fn() });
  try {
    const screenView = mount();
    expect(new URL(window.location.href).searchParams.has('financeChartMonth')).toBe(false);
    vi.mocked(useFinance).mockReturnValue({ data: buildFinance(syntheticFinance()), loading: false, error: null, updatedAt: null, refresh: vi.fn() });
    screenView.rerender(<MantineProvider><FinancePage /></MantineProvider>);
    expect(screen.getByRole('combobox', { name: 'Dönem' })).toHaveValue('2098-02');
    expect(screen.getByRole('tab', { name: 'Aylık özet' })).toHaveAttribute('aria-selected', 'true');
    await screen.findAllByLabelText('Sentetik çizim');
  } finally { window.history.replaceState(null, '', before); }
});
