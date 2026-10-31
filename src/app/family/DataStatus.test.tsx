import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DataStatus } from './DataStatus';

afterEach(cleanup);

it('announces loading, last read time and an unknown source as one polite status line', () => {
  const view = render(<DataStatus loading updatedAt={null} />);
  const status = screen.getByRole('status');
  expect(status).toHaveAttribute('aria-live', 'polite');
  expect(status).toHaveTextContent('Kaynak kontrol ediliyor…');
  view.rerender(<DataStatus loading={false} updatedAt={new Date('2098-11-01T09:05:00Z')} />);
  expect(screen.getByRole('status')).toHaveTextContent(/^Son okuma \d{2}:\d{2} · Açıkken her dakika yenilenir$/);
  view.rerender(<DataStatus loading={false} updatedAt={null} idle="Kaynak doğrulaması tamamlanmadı." />);
  expect(screen.getByRole('status')).toHaveTextContent('Kaynak doğrulaması tamamlanmadı.');
});
