import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, expect, it, vi } from 'vitest';
import VehiclePage from './VehiclePage';

// Kök neden (tam pakette ara sıra düşme): VehiclePage'in tembel PaymentChart'ı Promise.all([import('./PaymentChart'),
// loadCharts()]) ile çözülür; loadCharts gerçek ECharts parçasını (../dashboard/Charts → echarts/*) dönüştürüp yükler.
// Bu yüklemeyle test tek başına ~0,7 sn sürüyordu; yük altında yükleme findByText'in 1 sn sınırını aşıyordu (1,2 sn
// gecikme enjekte edilince aynı hata deterministik olarak yeniden üretildi). Bu test grafiğin isteğe bağlı
// başarısızlığını sınar, ECharts'ı değil: paylaşılan yükleyici testin elindeki bir sözle değiştirilir; yükleme durumu
// ve hata yolu sırayla ve süreden bağımsız gözlenir.
const charts = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { ready, release };
});
vi.mock('../dashboard/chartLoader', () => ({ loadCharts: vi.fn(() => charts.ready.then(() => ({}))) }));
vi.mock('./PaymentChart', () => ({ default: () => { throw new Error('Optional payment chart failed'); } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('keeps the vehicle calculator, photo and exact payment table after an optional chart failure', async () => {
  const { loadCharts } = await import('../dashboard/chartLoader');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<MantineProvider><VehiclePage budget={null} /></MantineProvider>);
  const before = screen.getByTestId('finance-result').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Grafiği göster' }));
  expect(await screen.findByText('Grafik yükleniyor…')).toBeInTheDocument();
  expect(loadCharts).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('finance-result').textContent).toBe(before);
  charts.release();
  expect(await screen.findByText(/Grafik yüklenemedi/)).toBeInTheDocument();
  expect(screen.queryByText('Grafik yükleniyor…')).not.toBeInTheDocument();
  expect(screen.getByTestId('finance-result').textContent).toBe(before);
  expect(screen.getByRole('img', { name: 'Toyota Corolla · Ön' })).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Taksitler' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Kurallar' }));
  expect(screen.getByRole('tab', { name: 'Kurallar' })).toHaveAttribute('aria-selected', 'true');
});
