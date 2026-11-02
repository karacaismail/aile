import { act, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DeviceContext, useDevice } from '../device';
import { AdaptiveProvider, ProfileContext, useInputLayers, useProfile } from './context';
import { installViewport } from './testing';

const provider = ({ children }: { children: ReactNode }) => <AdaptiveProvider>{children}</AdaptiveProvider>;

describe('useProfile', () => {
  it.each([[1440, 900, 'desktop'], [844, 390, 'phone'], [820, 1180, 'tablet']] as const)(
    'first render already sees the right profile at %i×%i (no layout jump)', (width, height, profile) => {
      installViewport({ width, height });
      const seen: string[] = [];
      function Probe() { seen.push(useProfile()); return null; }
      render(<AdaptiveProvider><Probe /></AdaptiveProvider>);
      expect(seen).toEqual([profile]);
    },
  );

  it('keeps a rotated phone on the phone profile and follows real space changes', () => {
    const viewport = installViewport({ width: 390, height: 844, coarse: true });
    const { result } = renderHook(() => useProfile(), { wrapper: provider });
    expect(result.current).toBe('phone');
    act(() => viewport.set({ width: 844, height: 390 }));
    expect(result.current).toBe('phone');
    act(() => viewport.set({ width: 820, height: 1180 }));
    expect(result.current).toBe('tablet');
    act(() => viewport.set({ width: 1180, height: 820 }));
    expect(result.current).toBe('desktop');
  });

  it('works without a provider and unsubscribes on unmount', () => {
    const viewport = installViewport({ width: 1440, height: 900 });
    const { result, unmount } = renderHook(() => useProfile());
    expect(result.current).toBe('desktop');
    act(() => viewport.set({ width: 500, height: 900 }));
    expect(result.current).toBe('phone');
    expect(viewport.listenerCount()).toBeGreaterThan(0);
    unmount();
    expect(viewport.listenerCount()).toBe(0);
  });

  it('honours a forced profile through ProfileContext and the legacy DeviceContext alike', () => {
    installViewport({ width: 320, height: 568 });
    expect(DeviceContext).toBe(ProfileContext);
    const forced = ({ children }: { children: ReactNode }) => <DeviceContext.Provider value="desktop">{children}</DeviceContext.Provider>;
    const { result } = renderHook(() => [useProfile(), useDevice()], { wrapper: forced });
    expect(result.current).toEqual(['desktop', 'desktop']);
  });

  it('a provider subscribes once; consumers below it add no matchMedia listeners', () => {
    const viewport = installViewport({ width: 1440, height: 900 });
    function Many() { useProfile(); useProfile(); useDevice(); useInputLayers(); return null; }
    const { unmount } = render(<AdaptiveProvider><Many /><Many /></AdaptiveProvider>);
    expect(viewport.listenerCount()).toBe(6);
    unmount();
    expect(viewport.listenerCount()).toBe(0);
  });
});

describe('useInputLayers', () => {
  it('reports every layer at once and follows input changes without touching the profile', () => {
    const viewport = installViewport({ width: 1280, height: 800, fine: true, hover: true });
    const { result } = renderHook(() => ({ input: useInputLayers(), profile: useProfile() }), { wrapper: provider });
    expect(result.current).toEqual({ input: { coarse: false, fine: true, hover: true }, profile: 'desktop' });
    act(() => viewport.set({ coarse: true }));
    expect(result.current).toEqual({ input: { coarse: true, fine: true, hover: true }, profile: 'desktop' });
    act(() => viewport.set({ fine: false, hover: false }));
    expect(result.current).toEqual({ input: { coarse: true, fine: false, hover: false }, profile: 'desktop' });
  });

  it('keeps the same object while nothing changes (stable for memo dependencies)', () => {
    const viewport = installViewport({ width: 1280, height: 800, fine: true });
    const { result } = renderHook(() => useInputLayers(), { wrapper: provider });
    const first = result.current;
    act(() => { window.dispatchEvent(new Event('resize')); });
    act(() => viewport.set({ width: 1300 }));
    expect(result.current).toBe(first);
  });
});
