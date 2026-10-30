import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Dashboard from '../dashboard/Dashboard';
import { useBudget } from '../dashboard/useBudget';
import { currentDirectoryLink, directoryGroups, isPlannerRoute } from '../app/family/navigation';

vi.mock('wouter/use-hash-location', () => ({ useHashLocation: () => ['/finansman', vi.fn()] }));
vi.mock('../dashboard/useBudget', () => ({ useBudget: vi.fn(() => ({ data: null, error: null, loading: false, updatedAt: null, refresh: vi.fn() })) }));
vi.mock('./FinancePage', () => ({ default: () => <h1>Finansman çalışma alanı</h1> }));
afterEach(cleanup);
it('uses the shared global page navigation and never treats financing as a local tab or legacy route', () => {
  expect(directoryGroups.flatMap(group => group.links).filter(link => link.path === '/finansman')).toHaveLength(1);
  expect(currentDirectoryLink('/finansman')).toMatchObject({ path: '/finansman', label: 'Finansman' });
  expect(isPlannerRoute('/finansman')).toBe(false);
});
it('loads the selected finance page without starting unrelated budget feeds', async () => {
  render(<Dashboard />);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Finansman çalışma alanı' })).toBeInTheDocument());
  expect(useBudget).toHaveBeenCalledWith(false);
  expect(screen.queryByText('Google Sheets bağlantısı')).not.toBeInTheDocument();
});
