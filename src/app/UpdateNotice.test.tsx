import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
const pwa = vi.hoisted(() => ({ callbacks: {} as { onNeedReload?: () => void; onRegisteredSW?: (url: string, registration?: ServiceWorkerRegistration) => void }, register: vi.fn() }));
vi.mock('virtual:pwa-register', () => ({ registerSW: (callbacks: typeof pwa.callbacks) => { pwa.callbacks = callbacks; pwa.register(); return vi.fn(); } }));

beforeEach(() => { vi.resetModules(); pwa.callbacks = {}; pwa.register.mockClear(); });

test('an activated update asks before reload and preserves the current input', async () => {
  const reload = vi.fn(); vi.stubGlobal('location', { reload });
  const { UpdateNotice } = await import('./UpdateNotice');
  const { unmount } = render(<><UpdateNotice /><input aria-label="Taslak" defaultValue="kaydedilmemiş içerik" /></>);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  act(() => pwa.callbacks.onNeedReload?.());
  expect(screen.getByRole('status')).toHaveTextContent('Yeni sürüm hazır');
  expect(screen.getByLabelText('Taslak')).toHaveValue('kaydedilmemiş içerik');
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Yeni sürümü aç' }));
  expect(reload).toHaveBeenCalledTimes(1);
  unmount(); vi.unstubAllGlobals();
});

test('registers once across remounts and checks updates when the user returns, without a timer', async () => {
  const { UpdateNotice } = await import('./UpdateNotice');
  const first = render(<UpdateNotice />); first.unmount();
  const second = render(<UpdateNotice />);
  expect(pwa.register).toHaveBeenCalledTimes(1);
  const update = vi.fn().mockResolvedValue(undefined);
  pwa.callbacks.onRegisteredSW?.('/aile/sw.js', { update } as unknown as ServiceWorkerRegistration);
  window.dispatchEvent(new Event('focus'));
  expect(update).toHaveBeenCalledTimes(1);
  second.unmount();
  window.dispatchEvent(new Event('focus'));
  expect(update).toHaveBeenCalledTimes(1);
});
