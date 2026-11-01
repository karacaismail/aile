import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DataTable } from './DataTable';

afterEach(cleanup);
it('shows the visible record range and restores source order after exploration', () => {
  const rows = [{ id: 'b', amount: 2 }, { id: 'c', amount: 3 }, { id: 'a', amount: 1 }];
  render(<DataTable rows={rows} rowKey={r => r.id} caption="Örnek kayıtlar" pageSize={2} columns={[
    { key: 'id', label: 'Kayıt', value: r => r.id, render: r => r.id },
    { key: 'amount', label: 'Tutar', numeric: true, value: r => r.amount, render: r => r.amount },
  ]} />);
  expect(screen.getByRole('status')).toHaveTextContent('1–2 / 3 kayıt');
  fireEvent.click(screen.getByRole('button', { name: 'Tutar' }));
  expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('a');
  fireEvent.click(screen.getByRole('button', { name: 'Kaynak sırasına dön' }));
  expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('b');
  expect(screen.getByRole('button', { name: 'Tutar' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Sonraki' }));
  expect(screen.getByRole('status')).toHaveTextContent('3–3 / 3 kayıt');
});
