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
