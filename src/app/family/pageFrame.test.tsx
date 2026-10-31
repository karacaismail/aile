import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FamilyFrame } from './FamilyFrame';
import { currentDirectoryLink } from './navigation';
import Dashboard from '../../dashboard/Dashboard';
import { useBudget } from '../../dashboard/useBudget';
import { buildBudget } from '../../dashboard/data';
import { syntheticSheets } from '../../dashboard/fixtures';

const route = { value: '/pano' };
vi.mock('wouter/use-hash-location', () => ({ useHashLocation: () => [route.value, vi.fn()] }));
vi.mock('../../home/HomePlanPage', async original => original<typeof import('../../home/HomePlanPage')>());
vi.mock('../../dashboard/useBudget', () => ({ useBudget: vi.fn() }));
vi.mock('../../dashboard/Charts', () => ({ default: () => <p>Grafik</p> }));

beforeEach(() => {
  // jsdom has no IntersectionObserver; the deferred chart host only needs a stub.
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; } as unknown as typeof IntersectionObserver;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.title = ''; route.value = '/pano'; });

it('gives the purchase plan page the same refresh control and freshness line as the budget page', async () => {
  route.value = '/ev';
  vi.mocked(useBudget).mockReturnValue({ data: buildBudget(syntheticSheets()), error: null, loading: false, updatedAt: new Date('2098-11-01T09:05:00Z'), refresh: vi.fn() });
  render(<MantineProvider><Dashboard /></MantineProvider>);
  // Wait for the lazy page itself, not the route shell that shares its heading.
  await screen.findByRole('textbox', { name: 'Alım planında ara' });
  const header = screen.getByRole('heading', { level: 1, name: 'Alım planı' }).closest('header')!;
  expect(within(header).getByRole('button', { name: 'Yenile' })).toBeInTheDocument();
  expect(screen.getAllByRole('status').filter(node => /Son okuma/.test(node.textContent ?? ''))).toHaveLength(1);
  expect(screen.queryByText(/Yukarıdaki Yenile/)).not.toBeInTheDocument();
});

it('keeps a working retry on the purchase plan page when the budget source fails without data', async () => {
  route.value = '/ev';
  const refresh = vi.fn();
  vi.mocked(useBudget).mockReturnValue({ data: null, error: 'Google Sheets bağlantısı başarısız (503).', loading: false, updatedAt: null, refresh });
  render(<MantineProvider><Dashboard /></MantineProvider>);
  await screen.findByText(/Alım planı şu anda alınamıyor/);
  expect(screen.getByRole('alert')).toHaveTextContent('503');
  const retry = within(screen.getByRole('heading', { level: 1, name: 'Alım planı' }).closest('header')!).getByRole('button', { name: 'Yenile' });
  expect(retry).toBeEnabled();
  fireEvent.click(retry);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('names the document after the selected page so the tab title and the navigation label agree', () => {
  for (const [path, title] of [['/timeline', 'Ödeme takvimi · aile'], ['/tadilat/isler', 'Yapılacak işler · aile'], ['/ayarlar', 'Ayarlar · aile']] as const) {
    const view = render(<MantineProvider><FamilyFrame location={path}><p>içerik</p></FamilyFrame></MantineProvider>);
    expect(document.title).toBe(title);
    view.unmount();
  }
});

it('keeps the same heading while the budget is loading or unavailable', () => {
  vi.mocked(useBudget).mockReturnValue({ data: null, error: null, loading: true, updatedAt: null, refresh: vi.fn() });
  const view = render(<MantineProvider><Dashboard /></MantineProvider>);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Genel bütçe');
  expect(screen.getByText('Bütçe ve ödemeler')).toBeInTheDocument();
  view.unmount();
  vi.mocked(useBudget).mockReturnValue({ data: null, error: 'Bağlantı kesildi', loading: false, updatedAt: null, refresh: vi.fn() });
  render(<MantineProvider><Dashboard /></MantineProvider>);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Genel bütçe');
  expect(screen.getByRole('alert')).toHaveTextContent('Bağlantı kesildi');
});

it('keeps the refresh control in the page heading and announces freshness once as a status line', () => {
  vi.mocked(useBudget).mockReturnValue({ data: buildBudget(syntheticSheets()), error: null, loading: false, updatedAt: new Date('2098-11-01T09:05:00Z'), refresh: vi.fn() });
  render(<MantineProvider><Dashboard /></MantineProvider>);
  const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
  expect(within(header).getByRole('button', { name: 'Yenile' })).toBeInTheDocument();
  const statuses = screen.getAllByRole('status').filter(node => /Son okuma/.test(node.textContent ?? ''));
  expect(statuses).toHaveLength(1);
  expect(document.querySelector('.sync-strip')).toBeNull();
  // Decision order: monthly net cash is the first metric, month-end balances follow, then income/payments/savings.
  const summary = screen.getByRole('region', { name: 'Seçili ay özeti' });
  const headings = within(summary).getAllByRole('heading', { level: 2 }).map(node => node.textContent);
  expect(headings[0]).toBe('Aylık net nakit');
  const monthEnd = within(summary).getByText('Seçili ay sonunda nakit');
  expect(within(summary).getByText('Gelir').compareDocumentPosition(monthEnd) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
});

it('leads the budget page with its navigation label and section caption instead of a duplicate eyebrow', () => {
  vi.mocked(useBudget).mockReturnValue({ data: buildBudget(syntheticSheets()), error: null, loading: false, updatedAt: null, refresh: vi.fn() });
  render(<MantineProvider><Dashboard /></MantineProvider>);
  const heading = screen.getByRole('heading', { level: 1 });
  expect(heading).toHaveTextContent(currentDirectoryLink('/pano').label);
  const header = heading.closest('header');
  expect(header).not.toBeNull();
  expect(within(header!).getByText('Bütçe ve ödemeler')).toBeInTheDocument();
  expect(screen.queryByText('AİLE BÜTÇESİ')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Seçili ay özeti' })).toBeInTheDocument();
});
