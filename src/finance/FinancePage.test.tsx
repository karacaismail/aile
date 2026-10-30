import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FinancePage from './FinancePage';
import { buildFinance } from './data';
import { syntheticFinance } from './fixtures';
import { useFinance } from './useFinance';

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
