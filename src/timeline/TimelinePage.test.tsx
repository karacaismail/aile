import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TimelinePage from './TimelinePage';
import { buildFinance } from '../finance/data';
import { syntheticFinance, syntheticLongFinance } from '../finance/fixtures';
import { useFinance } from '../finance/useFinance';

vi.mock('../finance/useFinance', () => ({ useFinance: vi.fn() }));
// The branded Select is covered in browser tests; use its value/onChange contract here.
vi.mock('../dashboard/Select', () => ({ Select: (props: { value: string; onChange: (value: string) => void; data: { value: string; label: string }[] }) => <select aria-label="Gösterilen dönem" value={props.value} onChange={event => props.onChange(event.target.value)}>{props.data.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select> }));
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const mount = () => render(<MantineProvider><TimelinePage /></MantineProvider>);
const panel = () => screen.getByRole('tabpanel');
const rows = () => screen.queryAllByRole('article').length || screen.queryAllByRole('row').length - 1;
function advanceFrame() {
  const pending = [...frames]; frames.clear();
  act(() => { pending.forEach(([, callback]) => callback(performance.now())); });
}
function selectPeriod(value: string) { fireEvent.change(screen.getByRole('combobox', { name: 'Gösterilen dönem' }), { target: { value } }); }
beforeEach(() => {
  frames.clear(); nextFrame = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  vi.mocked(useFinance).mockReturnValue({ data: buildFinance(syntheticLongFinance()), loading: false, error: null, updatedAt: null, refresh: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('renders the first eight verified steps immediately, then sixteen per frame without changing source totals', () => {
  mount();
  expect(rows()).toBe(8);
  expect(panel()).toHaveAttribute('aria-busy', 'true');
  const summary = screen.getByRole('region', { name: 'Ocak 2098 özeti' });
  const totals = summary.textContent;
  expect(totals).toContain('654.321 ₺');
  advanceFrame(); expect(rows()).toBe(24);
  advanceFrame(); expect(rows()).toBe(28);
  expect(panel()).toHaveAttribute('aria-busy', 'false');
  expect(summary.textContent).toBe(totals);
  expect(frames.size).toBe(0);
  selectPeriod('all');
  expect(rows()).toBe(8);
  for (const count of [24, 40, 50]) { advanceFrame(); expect(rows()).toBe(count); }
  expect(panel()).toHaveAttribute('aria-busy', 'false');
  expect(frames.size).toBe(0);
  expect(screen.getAllByRole('article').at(-1)).toHaveAccessibleName(/^50\. adım/);
});

it('shares progressive source rows with table and cancels obsolete work on view, filter, period and page changes', () => {
  const view = mount();
  expect(rows()).toBe(8);
  const firstFrame = nextFrame;
  fireEvent.click(screen.getByRole('tab', { name: 'Tablo' }));
  expect(window.cancelAnimationFrame).toHaveBeenCalledWith(firstFrame);
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(rows()).toBe(8);
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Örnek adım 1');
  advanceFrame(); expect(rows()).toBe(24);
  const tableFrame = nextFrame;
  fireEvent.click(screen.getByRole('button', { name: 'Alışveriş' }));
  expect(window.cancelAnimationFrame).toHaveBeenCalledWith(tableFrame);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(panel()).toHaveAttribute('aria-busy', 'false');
  expect(frames.size).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Tüm adımlar' }));
  selectPeriod('2098-02');
  expect(rows()).toBe(8);
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Örnek adım 29');
  selectPeriod('all');
  const next = within(screen.getByRole('navigation', { name: 'Adım sayfaları üst' })).getByRole('button', { name: 'Sonraki adımlar' });
  next.focus(); fireEvent.click(next);
  expect(rows()).toBe(8);
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Örnek adım 51');
  for (const count of [24, 40, 50]) { advanceFrame(); expect(rows()).toBe(count); }
  expect(next).toHaveFocus();
  expect(panel()).toHaveAttribute('aria-busy', 'false');
  fireEvent.click(next);
  expect(rows()).toBe(8);
  const unmountedFrame = nextFrame;
  view.unmount();
  expect(window.cancelAnimationFrame).toHaveBeenCalledWith(unmountedFrame);
  expect(frames.size).toBe(0);
});

it('keeps a complete visible page during a verified refresh with the same event identities', () => {
  const view = mount();
  advanceFrame(); advanceFrame();
  expect(rows()).toBe(28);
  vi.mocked(useFinance).mockReturnValue({ data: buildFinance(syntheticLongFinance()), loading: false, error: null, updatedAt: new Date(), refresh: vi.fn() });
  view.rerender(<MantineProvider><TimelinePage /></MantineProvider>);
  expect(rows()).toBe(28);
  expect(panel()).toHaveAttribute('aria-busy', 'false');
  expect(frames.size).toBe(0);
});

 it('shows finance cash and KMH independently, without treating net position as spendable cash', () => {
  vi.mocked(useFinance).mockReturnValue({ data: buildFinance(syntheticFinance()), loading: false, error: null, updatedAt: null, refresh: vi.fn() });
  mount();
  const step = screen.getByRole('article', { name: '1. adım · Sentetik dönem başlangıcı' });
  expect(within(step).getByText('Harcanabilir nakit').nextElementSibling).toHaveTextContent('0 ₺');
  expect(within(step).getByText('Net nakit konumu').nextElementSibling).toHaveTextContent('-50 ₺');
  expect(within(step).getByText('KMH anaparası').nextElementSibling).toHaveTextContent('50 ₺');
  expect(within(step).getByText('KMH faiz + vergi').nextElementSibling).toHaveTextContent('2 ₺');
  expect(within(step).getByText('Toplam kart borcu').nextElementSibling).toHaveTextContent('512 ₺');
  expect(within(step).getByText(/banka oranı teyitsiz/)).toBeVisible();
  expect(screen.queryByText(/nakit modeli KMH.*içermez/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Tablo' }));
  const row = screen.getAllByRole('row')[1];
  expect(row.querySelector('[data-balance="cash"]')).toHaveTextContent('0 ₺');
  expect(row.querySelector('[data-balance="requiredBalance"]')).toHaveTextContent('-50 ₺');
  expect(row.querySelector('[data-balance="kmhPrincipal"]')).toHaveTextContent('50 ₺');
});

it('preserves source cents and excludes internal transfers from the income filter', () => {
  const data = buildFinance(syntheticFinance());
  data.events[0].cardDebt = 512.49;
  vi.mocked(useFinance).mockReturnValue({ data, loading: false, error: null, updatedAt: null, refresh: vi.fn() });
  mount();
  expect(screen.getByRole('article', { name: /1. adım/ })).toHaveTextContent('512,49 ₺');
  selectPeriod('2098-02');
  fireEvent.click(screen.getByRole('button', { name: 'Gelir' }));
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(screen.getByText(/gelir adımı yok/)).toBeVisible();
});

it('filters before/after moving purchases chronologically in both views without changing balances', () => {
  const data = buildFinance(syntheticLongFinance());
  data.events[2].type = 'Alışveriş · Taşınma öncesi'; data.events[2].title = 'Koltuk siparişi';
  data.events[4].type = 'Kart alışverişi'; data.events[4].title = 'Elektrik faturası';
  data.events[28].type = 'Alışveriş · Taşınma sonrası'; data.events[28].title = 'Yatak';
  // A before-moving category can be scheduled later: never infer the group from its date.
  data.events[30].type = 'Alışveriş · Taşınma öncesi'; data.events[30].title = 'Perde';
  vi.mocked(useFinance).mockReturnValue({ data, loading:false, error:null, updatedAt:null, refresh:vi.fn() });
  mount(); selectPeriod('all');
  const summary = screen.getByRole('region', {name:'Tüm dönem özeti'}).textContent;
  fireEvent.click(screen.getByRole('button', {name:'Alışveriş'}));
  expect(screen.getAllByRole('article')).toHaveLength(3);
  const groups=screen.getByRole('group',{name:'Alım grubu'});
  fireEvent.click(within(groups).getByRole('button',{name:'Taşınma öncesi'}));
  expect(screen.getAllByRole('article').map(el=>el.getAttribute('aria-label'))).toEqual(['3. adım · Koltuk siparişi','31. adım · Perde']);
  expect(screen.getByRole('region',{name:'Tüm dönem özeti'}).textContent).toBe(summary);
  fireEvent.click(screen.getByRole('tab',{name:'Tablo'}));
  expect(screen.getAllByRole('row').slice(1).map(el=>el.querySelector('time')?.dateTime)).toEqual(['2098-01-03','2098-02-03']);
  fireEvent.click(within(groups).getByRole('button',{name:'Taşınma sonrası'}));
  expect(screen.getAllByRole('row')).toHaveLength(2);
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Yatak');
  selectPeriod('2098-01');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByText('Bu dönemde taşınma sonrası alımı yok.')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Tüm dönemde göster'}));
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Yatak');
  expect(within(groups).getByRole('button',{name:'Taşınma sonrası'})).toHaveAttribute('aria-pressed','true');
});
