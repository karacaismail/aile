import { cleanup, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FamilyFrame } from './FamilyFrame';
import { currentDirectoryLink } from './navigation';
import Dashboard from '../../dashboard/Dashboard';
import { useBudget } from '../../dashboard/useBudget';
import { buildBudget } from '../../dashboard/data';
import { syntheticSheets } from '../../dashboard/fixtures';

vi.mock('wouter/use-hash-location', () => ({ useHashLocation: () => ['/pano', vi.fn()] }));
vi.mock('../../dashboard/useBudget', () => ({ useBudget: vi.fn() }));
vi.mock('../../dashboard/Charts', () => ({ default: () => <p>Grafik</p> }));

beforeEach(() => {
  // jsdom has no IntersectionObserver; the deferred chart host only needs a stub.
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; } as unknown as typeof IntersectionObserver;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.title = ''; });

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
