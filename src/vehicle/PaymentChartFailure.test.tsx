import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, expect, it, vi } from 'vitest';
import VehiclePage from './VehiclePage';

vi.mock('./PaymentChart', () => ({ default: () => { throw new Error('Optional payment chart failed'); } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('keeps the vehicle calculator, photo and exact payment table after an optional chart failure', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<MantineProvider><VehiclePage budget={null} /></MantineProvider>);
  const before = screen.getByTestId('finance-result').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Ödeme grafiğini göster' }));
  expect(await screen.findByText(/Ödeme grafiği yüklenemedi/)).toBeInTheDocument();
  expect(screen.getByTestId('finance-result').textContent).toBe(before);
  expect(screen.getByRole('img', { name: 'Toyota Corolla · Ön görünüm' })).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'İki kredinin birleşik ödeme planı' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Kurallar' }));
  expect(screen.getByRole('tab', { name: 'Kurallar' })).toHaveAttribute('aria-selected', 'true');
});
