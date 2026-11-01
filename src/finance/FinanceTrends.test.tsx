import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LineSeriesOption, XAXisComponentOption, YAXisComponentOption } from 'echarts';
import FinanceTrends, { financeTrendOption } from './FinanceTrends';
import { buildFinance } from './data';
import { syntheticFinance } from './fixtures';
import { tokens } from '../dashboard/tokens';

const plot = vi.hoisted(() => ({ fail: false }));
vi.mock('../dashboard/Charts', () => ({ Chart: () => { if (plot.fail) throw Error('Synthetic chart failure'); return <span>Çizim hazır</span>; } }));
afterEach(() => { cleanup(); plot.fail = false; vi.restoreAllMocks(); });

it('uses the exact three source series on one zero-based scale, excluding costs and future commitments', () => {
  const months = buildFinance(syntheticFinance()).months;
  const original = structuredClone(months);
  for (const key of ['cash', 'cardDebt', 'kmhPrincipal'] as const) {
    const option = financeTrendOption(months, '2098-02', key, tokens.blue);
    expect(option.yAxis).toMatchObject({ min: 0, max: 1400 });
    const series = (option.series as LineSeriesOption[])[0];
    expect(series).toMatchObject({ smooth: false, connectNulls: false });
    expect(series.data).toEqual(months.map((month, index) => ({ value: [Date.parse(`${month.month}-01T00:00:00Z`), month[key]], symbol: index === 1 ? 'diamond' : 'circle', symbolSize: index === 1 ? 12 : 5 })));
  }
  expect(months).toEqual(original);
});

it('keeps a single all-zero month as real zero values and a single marked point', async () => {
  const months = [{ ...buildFinance(syntheticFinance()).months[0], cash: 0, cardDebt: 0, kmhPrincipal: 0 }];
  const option = financeTrendOption(months, '2098-01', 'cash', tokens.green);
  expect((option.xAxis as XAXisComponentOption).type).toBe('category');
  expect((option.series as LineSeriesOption[])[0].data).toEqual([{ value: 0, symbol: 'diamond', symbolSize: 12 }]);
  expect((option.yAxis as YAXisComponentOption).min).toBe(0);
  render(<FinanceTrends months={months} selected="2098-01" tableId="test-table" />);
  for (const label of ['Harcanabilir nakit', 'Toplam kart borcu', 'KMH anaparası']) {
    expect(within(screen.getByRole('group', { name: label })).getByText('0 ₺')).toBeVisible();
  }
  expect(screen.getAllByText('Dönemin tüm ay sonlarında 0 ₺.')).toHaveLength(3);
  await screen.findAllByText('Çizim hazır');
});

it('breaks the line across missing source months and never fills their amounts with zero', () => {
  const months = buildFinance(syntheticFinance()).months;
  months[1].month = '2098-04';
  const option = financeTrendOption(months, '2098-04', 'cash', tokens.green);
  const series = (option.series as LineSeriesOption[])[0];
  expect(series.connectNulls).toBe(false);
  expect(series.data).toEqual([
    { value: [Date.parse('2098-01-01T00:00:00Z'), 500], symbol: 'circle', symbolSize: 5 },
    { value: [Date.parse('2098-02-01T00:00:00Z'), null] },
    { value: [Date.parse('2098-04-01T00:00:00Z'), 1400], symbol: 'diamond', symbolSize: 12 },
  ]);
});

it('retains the source-backed values and table link when the optional chart fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  plot.fail = true;
  render(<FinanceTrends months={buildFinance(syntheticFinance()).months} selected="2098-02" tableId="test-table" />);
  expect((await screen.findAllByRole('status'))[0]).toHaveTextContent('Grafik yüklenemedi');
  expect(within(screen.getByRole('group', { name: 'Harcanabilir nakit' })).getByText('1.400 ₺')).toBeVisible();
  expect(within(screen.getByRole('group', { name: 'Toplam kart borcu' })).getByText('305 ₺')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Bütün aylık tutarlara git' })).toHaveAttribute('href', '#test-table');
});
