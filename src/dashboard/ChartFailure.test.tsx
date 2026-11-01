import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';
import { buildBudget } from './data';
import { syntheticSheets } from './fixtures';
import { useBudget } from './useBudget';

vi.mock('wouter/use-hash-location', () => ({ useHashLocation: () => ['/pano', vi.fn()] }));
vi.mock('./useBudget', () => ({ useBudget: vi.fn() }));
vi.mock('./Charts', () => ({ default: () => { throw new Error('Optional chart failed'); } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('keeps Pano amounts, table and navigation usable after a completed optional chart failure', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  window.IntersectionObserver = class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  vi.mocked(useBudget).mockReturnValue({ data: buildBudget(syntheticSheets()), error: null, loading: false, updatedAt: null, refresh: vi.fn() });
  render(<MantineProvider><Dashboard /></MantineProvider>);
  expect(await screen.findByText(/Grafikler yüklenemedi/)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Seçili ay özeti' })).toHaveTextContent('4.000 ₺');
  expect(within(screen.getByRole('navigation', { name: 'Bütçeden sonraki adım' })).getByRole('link', { name: /finansman özeti/ })).toHaveAttribute('href', '#/finansman');
  fireEvent.click(screen.getByRole('button', { name: 'Aylık tablo' }));
  expect(screen.getByRole('table')).toHaveTextContent('Kasım 2098');
});
