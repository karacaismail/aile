import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TimelinePage from './TimelinePage';
import { buildTimeline } from './data';
import { syntheticLongTimeline } from './fixtures';
import { useTimeline } from './useTimeline';

vi.mock('./useTimeline', () => ({ useTimeline: vi.fn() }));
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
  vi.mocked(useTimeline).mockReturnValue({ data: buildTimeline(syntheticLongTimeline()), loading: false, error: null, updatedAt: null, refresh: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('renders the first eight verified steps immediately, then sixteen per frame without changing source totals', () => {
  mount();
  expect(rows()).toBe(8);
  expect(panel()).toHaveAttribute('aria-busy', 'true');
  const summary = screen.getByRole('region', { name: 'Kasım 2098 özeti' });
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
  selectPeriod('2098-12');
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
  vi.mocked(useTimeline).mockReturnValue({ data: buildTimeline(syntheticLongTimeline()), loading: false, error: null, updatedAt: new Date(), refresh: vi.fn() });
  view.rerender(<MantineProvider><TimelinePage /></MantineProvider>);
  expect(rows()).toBe(28);
  expect(panel()).toHaveAttribute('aria-busy', 'false');
  expect(frames.size).toBe(0);
});
