import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, expect, it } from 'vitest';
import VehiclePage from './VehiclePage';
import { buildCurrentBudget } from '../dashboard/current';
import { syntheticCurrentSheets } from '../dashboard/currentFixtures';

afterEach(cleanup);

it('does not present debt or reserve financed positive cash as capacity for a vehicle payment', () => {
  const budget = buildCurrentBudget(syntheticCurrentSheets());
  budget.months[0].selfFundedCashFlow = { plan: -200, current: -200 };
  render(<MantineProvider><VehiclePage budget={budget} /></MantineProvider>);
  fireEvent.click(screen.getByRole('tab', { name: 'Bütçeye etkisi' }));
  const table = screen.getByRole('table', { name: 'E-tablo dönemi içindeki ek araç yükü' });
  const first = within(table).getAllByRole('row')[1];
  expect(within(first).getAllByRole('cell')[1]).toHaveTextContent('-200 ₺');
  expect(within(first).getAllByRole('cell')[3]).toHaveTextContent('-200 ₺');
});

it('keeps unavailable capacity unknown instead of falling back to old monthly cash', () => {
  const budget = buildCurrentBudget(syntheticCurrentSheets());
  render(<MantineProvider><VehiclePage budget={budget} /></MantineProvider>);
  fireEvent.click(screen.getByRole('tab', { name: 'Bütçeye etkisi' }));
  const table = screen.getByRole('table', { name: 'E-tablo dönemi içindeki ek araç yükü' });
  const first = within(table).getAllByRole('row')[1];
  expect(within(first).getAllByRole('cell')[1]).toHaveTextContent('Tutar yok');
  expect(within(first).getAllByRole('cell')[3]).toHaveTextContent('Tutar yok');
});
