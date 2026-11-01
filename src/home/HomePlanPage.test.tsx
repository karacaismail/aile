import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, expect, it, vi } from 'vitest';
import HomePlanPage from './HomePlanPage';
import { buildCurrentBudget } from '../dashboard/current';
import { syntheticCurrentSheets } from '../dashboard/currentFixtures';

vi.mock('../dashboard/Select', () => ({ Select: (props: { label: string; value: string; onChange: (value: string) => void; data: { value: string; label: string }[] }) => <select aria-label={props.label} value={props.value} onChange={event => props.onChange(event.target.value)}>{props.data.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select> }));

afterEach(cleanup);
it('finds missing prices within the source category without treating zero as missing, and preserves the plan source', () => {
  const data = buildCurrentBudget(syntheticCurrentSheets());
  render(<MantineProvider><HomePlanPage data={data} loading={false} updatedAt={null} refresh={() => {}} /></MantineProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Tutarı eksik' }));
  const table = screen.getByRole('table', { name: 'Bütçedeki alım planı' });
  expect(within(table).getByText('Fiyatı beklenen ürün')).toBeInTheDocument();
  expect(within(table).queryByText('İptal edilen ürün')).not.toBeInTheDocument();
  expect(within(table).queryByText('Örnek mobilya')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tüm alımlar' }));
  expect(within(table).getByText('İptal edilen ürün')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Alım kategorisi' }), { target: { value: 'Taşınma' } });
  expect(within(table).queryByText('İptal edilen ürün')).not.toBeInTheDocument();
  expect(within(table).getByText('Örnek mobilya')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Alım planında ara' }), { target: { value: 'Fiyatı' } });
  expect(within(table).queryByText('Örnek mobilya')).not.toBeInTheDocument();
  expect(within(table).getByText('Fiyatı beklenen ürün')).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Alımdan sonraki adım' })).toHaveTextContent('Hazırlık listesine git');
  expect(screen.getByText(/Plan tutarı ödeme yapıldığı anlamına gelmez/)).toBeInTheDocument();
});

it('answers what and how much before when and category, so narrow screens show the amount first', () => {
  const data = buildCurrentBudget(syntheticCurrentSheets());
  render(<MantineProvider><HomePlanPage data={data} loading={false} updatedAt={null} refresh={() => {}} /></MantineProvider>);
  const headers = within(screen.getByRole('table', { name: 'Bütçedeki alım planı' })).getAllByRole('columnheader').map(cell => cell.textContent?.replace(/[↕↑↓]/g, '').trim());
  expect(headers.slice(0, 4)).toEqual(['Alınacak / yapılacak', 'Güncel tutar', 'Plan ayı', 'Kategori']);
  // Narrow screens see only the first column: it repeats the amount and plan month as a glance line (the cells keep the semantics).
  const first = within(screen.getByRole('row', { name: /Fiyatı beklenen ürün/ })).getAllByRole('cell')[0];
  expect(first.querySelector('.home-plan-glance')).toHaveTextContent('Tutar yok');
  expect(first.querySelector('.home-plan-glance')).toHaveAttribute('aria-hidden', 'true');
});

it('summarises the active filters with a count and clears all of them in one step', () => {
  const data = buildCurrentBudget(syntheticCurrentSheets());
  render(<MantineProvider><HomePlanPage data={data} loading={false} updatedAt={null} refresh={() => {}} /></MantineProvider>);
  expect(screen.queryByRole('button', { name: 'Filtreleri temizle' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tutarı eksik' }));
  const search = screen.getByRole('textbox', { name: 'Alım planında ara' });
  fireEvent.change(search, { target: { value: 'Fiyatı' } });
  // Plain labelled text: the table toolbar is the single live count, so the summary does not announce twice.
  const summary = screen.getByRole('group', { name: 'Etkin filtreler' });
  expect(summary.closest('[aria-live], [role="status"]')).toBeNull();
  expect(summary).toHaveTextContent('Tutarı eksik');
  expect(summary).toHaveTextContent('“Fiyatı”');
  expect(summary).toHaveTextContent(`1 / ${data.irregular.length} kalem`);
  fireEvent.click(screen.getByRole('button', { name: 'Filtreleri temizle' }));
  expect(search).toHaveValue('');
  expect(search).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Tüm alımlar' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('group', { name: 'Etkin filtreler' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('table', { name: 'Bütçedeki alım planı' })).getByText('İptal edilen ürün')).toBeInTheDocument();
});
