import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Charts from './Charts';
import { buildBudget } from './data';
import { syntheticSheets } from './fixtures';
import { tokens } from './tokens';

const { setOption } = vi.hoisted(() => ({ setOption: vi.fn() }));
vi.mock('echarts/core', () => ({ use: vi.fn(), init: () => ({ setOption, resize: vi.fn(), dispose: vi.fn() }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('puts exact selected-month values next to every chart without relying on hover', () => {
  const data = buildBudget(syntheticSheets());
  render(<Charts data={data} selected={1} />);
  const cash = screen.getByRole('region', { name: 'Nakit nasıl ilerliyor?' });
  expect(within(cash).getByRole('group', { name: 'Aralık 2098 değerleri' })).toHaveTextContent('Plan7.500 ₺Güncel7.500 ₺');
  const flows = screen.getByRole('region', { name: 'Gelir ve ödemeler' });
  expect(within(flows).getByRole('group', { name: 'Aralık 2098 değerleri' })).toHaveTextContent('Gelir10.000 ₺Ödemeler4.500 ₺');
  const saving = screen.getByRole('region', { name: 'Birikimin seyri' });
  expect(within(saving).getByRole('group', { name: 'Aralık 2098 değerleri' })).toHaveTextContent('Plan4.000 ₺Güncel4.000 ₺');
  const categories = screen.getByRole('table', { name: 'Aralık 2098 kategori tutarları' });
  expect(within(categories).getByRole('row', { name: /Faturalar/ })).toHaveTextContent('4.000 ₺4.000 ₺');
  expect(within(categories).getByRole('row', { name: /Borç ve vergi/ })).toHaveTextContent('0 ₺0 ₺');
});

it('keeps unknown category amounts distinct from real zero and updates all exact values with the selected month', () => {
  const data = buildBudget(syntheticSheets());
  data.groups.find(group => group.kind === 'expense')!.plan[1] = null;
  const view = render(<Charts data={data} selected={1} />);
  expect(within(screen.getByRole('table', { name: 'Aralık 2098 kategori tutarları' })).getByRole('row', { name: /Borç ve vergi/ })).toHaveTextContent('Tutar yok0 ₺');
  view.rerender(<Charts data={data} selected={0} />);
  expect(screen.queryByRole('group', { name: 'Aralık 2098 değerleri' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Nakit nasıl ilerliyor?' })).getByRole('group', { name: 'Kasım 2098 değerleri' })).toHaveTextContent('Plan4.000 ₺Güncel4.000 ₺');
});

it('makes category plan bars distinguishable by outline as well as contrast on white', () => {
  render(<Charts data={buildBudget(syntheticSheets())} selected={0} />);
  const option = setOption.mock.calls.at(-1)![0];
  const plan = option.series[0].itemStyle;
  // A hollow outlined plan bar contrasts with the solid current bar even without colour perception.
  expect(plan.color).toBe(tokens.paper);
  expect(plan.borderWidth).toBeGreaterThanOrEqual(2);
  const luminance = (hex: string) => {
    const rgb = hex.match(/[a-f\d]{2}/gi)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  expect(1.05 / (luminance(plan.borderColor) + .05)).toBeGreaterThanOrEqual(3);
  expect(option.series[1].itemStyle.color).toBe(tokens.blue);
});

it('reads categories in the same top-to-bottom order as the adjacent numeric table', () => {
  render(<Charts data={buildBudget(syntheticSheets())} selected={0} />);
  const option = setOption.mock.calls.at(-1)![0];
  const labels = within(screen.getByRole('table', { name: 'Kasım 2098 kategori tutarları' })).getAllByRole('rowheader').map(cell => cell.textContent);
  const drawnOrder = option.yAxis.inverse ? option.yAxis.data : [...option.yAxis.data].reverse();
  expect(drawnOrder).toEqual(labels);
});
