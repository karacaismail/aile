import { act, cleanup, render, screen } from '@testing-library/react';
import { lazy, type ComponentType } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { OptionalCharts } from './OptionalCharts';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('clears the same status node after the optional chart resolves', async () => {
  let finish!: (module: { default: ComponentType }) => void;
  const pending = new Promise<{ default: ComponentType }>(resolve => { finish = resolve; });
  const Chart = lazy(() => pending);
  render(<OptionalCharts loading="Grafik yükleniyor" error="Grafik yüklenemedi"><Chart /></OptionalCharts>);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Grafik yükleniyor');
  await act(async () => { finish({ default: () => <span>Grafik hazır</span> }); });
  expect(screen.getByText('Grafik hazır')).toBeInTheDocument();
  expect(screen.getByRole('status')).toBe(status);
  expect(status).toBeEmptyDOMElement();
});

it('updates the existing status if an already rendered optional chart later fails', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { rerender } = render(<OptionalCharts loading="Grafik yükleniyor" error="Grafik yüklenemedi"><span>Grafik</span></OptionalCharts>);
  const status = screen.getByRole('status');
  const FailedChart = () => { throw new Error('Chart render failed'); };
  rerender(<OptionalCharts loading="Grafik yükleniyor" error="Grafik yüklenemedi"><FailedChart /></OptionalCharts>);
  expect(screen.getByRole('status')).toBe(status);
  expect(status).toHaveTextContent('Grafik yüklenemedi');
});
