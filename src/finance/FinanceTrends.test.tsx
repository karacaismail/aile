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

it('retains source values, a page-local jump and explicit page reload when the optional chart fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  plot.fail = true;
  render(<FinanceTrends months={buildFinance(syntheticFinance()).months} selected="2098-02" tableId="test-table" />);
  const failures = await screen.findAllByText('Grafik yüklenemedi. Kaynak tutarları ve aylık tablo kullanılabilir.');
  expect(failures).toHaveLength(3);
  for (const failure of failures) expect(failure).toHaveAttribute('role', 'status');
  expect(within(screen.getByRole('group', { name: 'Harcanabilir nakit' })).getByText('1.400 ₺')).toBeVisible();
  expect(within(screen.getByRole('group', { name: 'Toplam kart borcu' })).getByText('305 ₺')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Bütün aylık tutarlara git' })).not.toHaveAttribute('href');
  expect(screen.getByRole('button', { name: 'Sayfayı yenile' })).toBeVisible();
});

it('keeps calendar-year boundaries and missing winter months as source dates, not fabricated values', () => {
  const source = buildFinance(syntheticFinance()).months[0];
  const months = ['2098-11', '2099-02'].map(month => ({ ...source, month }));
  const option = financeTrendOption(months, '2099-02', 'cash', tokens.green);
  const axis = option.xAxis as XAXisComponentOption;
  const format = axis.axisLabel!.formatter as (time: number) => string;
  expect([Date.UTC(2098, 10, 1), Date.UTC(2098, 11, 1), Date.UTC(2099, 0, 1), Date.UTC(2099, 1, 1)].map(format)).toEqual(['Kas 98', 'Ara 98', 'Oca 99', 'Şub 99']);
  expect((option.series as LineSeriesOption[])[0].data).toEqual([
    { value: [Date.UTC(2098, 10, 1), 500], symbol: 'circle', symbolSize: 5 },
    { value: [Date.UTC(2098, 11, 1), null] },
    { value: [Date.UTC(2099, 1, 1), 500], symbol: 'diamond', symbolSize: 12 },
  ]);
});

it('preserves all 26 source month-end points and a common scale across years', () => {
  const source = buildFinance(syntheticFinance()).months[0];
  const months = Array.from({ length: 26 }, (_, index) => ({ ...source, month: new Date(Date.UTC(2098, 10 + index, 1)).toISOString().slice(0, 7), cash: 500 + index * 100 }));
  const option = financeTrendOption(months, '2099-01', 'cash', tokens.green);
  const axis = option.xAxis as XAXisComponentOption;
  expect(axis).toMatchObject({ min: Date.UTC(2098, 10, 1), max: Date.UTC(2100, 11, 1) });
  expect(option.yAxis).toMatchObject({ min: 0, max: 3000 });
  const data = (option.series as LineSeriesOption[])[0].data!;
  expect(data).toHaveLength(26);
  expect(data[2]).toEqual({ value: [Date.UTC(2099, 0, 1), 700], symbol: 'diamond', symbolSize: 12 });
});
