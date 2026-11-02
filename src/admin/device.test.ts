import { act, renderHook } from '@testing-library/react';
import { createElement, useRef, type ReactNode } from 'react';
import { DeviceProvider, useContainerWidth, useDevice } from './device';
import { installViewport } from './adaptive/testing';

type Listener = (event: { matches: boolean; media: string }) => void;
interface FakeQuery { matches: boolean; media: string; listeners: Set<Listener> }

// matchMedia mock'u genişliğe göre cevap verir; (min-width: Npx) sorgularını çözer, change olaylarını yayar.
function installMatchMedia(initialWidth: number) {
  let width = initialWidth;
  const queries: FakeQuery[] = [];
  const evaluate = (media: string) => {
    const match = media.match(/min-width:\s*(\d+)px/);
    return match ? width >= Number(match[1]) : false;
  };
  window.matchMedia = vi.fn().mockImplementation((media: string) => {
    const query: FakeQuery = { matches: evaluate(media), media, listeners: new Set() };
    queries.push(query);
    return {
      get matches() { return query.matches; },
      media,
      onchange: null,
      addEventListener: (_type: string, listener: Listener) => { query.listeners.add(listener); },
      removeEventListener: (_type: string, listener: Listener) => { query.listeners.delete(listener); },
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
  return {
    resize(next: number) {
      width = next;
      for (const query of queries) {
        const matches = evaluate(query.media);
        if (matches === query.matches) continue;
        query.matches = matches;
        for (const listener of query.listeners) listener({ matches, media: query.media });
      }
    },
    listenerCount: () => queries.reduce((sum, query) => sum + query.listeners.size, 0),
  };
}

const wrapper = ({ children }: { children: ReactNode }) => createElement(DeviceProvider, null, children);

describe('useDevice', () => {
  it.each([[320, 'phone'], [599, 'phone'], [600, 'tablet'], [768, 'tablet'], [1023, 'tablet'], [1024, 'desktop'], [1440, 'desktop']] as const)(
    '%i px → %s', (width, device) => {
      installMatchMedia(width);
      const { result } = renderHook(() => useDevice(), { wrapper });
      expect(result.current).toBe(device);
    },
  );

  it('follows matchMedia change events and unsubscribes on unmount', () => {
    const media = installMatchMedia(1440);
    const { result, unmount } = renderHook(() => useDevice(), { wrapper });
    expect(result.current).toBe('desktop');
    act(() => media.resize(768));
    expect(result.current).toBe('tablet');
    act(() => media.resize(320));
    expect(result.current).toBe('phone');
    act(() => media.resize(1200));
    expect(result.current).toBe('desktop');
    expect(media.listenerCount()).toBeGreaterThan(0);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('works without a provider (falls back to matchMedia directly)', () => {
    installMatchMedia(700);
    const { result } = renderHook(() => useDevice());
    expect(result.current).toBe('tablet');
  });
});

// Uyarlamalı profil (adaptive/profile.ts): useDevice aynı API ile genişlik + yükseklik + kısa kenara bakar.
describe('useDevice · uyarlamalı profil', () => {
  it.each([[568, 320], [667, 375], [844, 390], [932, 430]] as const)('a landscape phone %i×%i stays on the phone profile', (width, height) => {
    installViewport({ width, height, coarse: true });
    const { result } = renderHook(() => useDevice(), { wrapper });
    expect(result.current).toBe('phone');
  });

  it('a 500×900 desktop window with a fine pointer gets the phone layout', () => {
    installViewport({ width: 500, height: 900, fine: true, hover: true });
    const { result } = renderHook(() => useDevice(), { wrapper });
    expect(result.current).toBe('phone');
  });

  it('tablet portrait 820×1180 is tablet; rotated 1180×820 has desktop space', () => {
    const viewport = installViewport({ width: 820, height: 1180, coarse: true });
    const { result } = renderHook(() => useDevice(), { wrapper });
    expect(result.current).toBe('tablet');
    act(() => viewport.set({ width: 1180, height: 820 }));
    expect(result.current).toBe('desktop');
  });
});

describe('useContainerWidth', () => {
  it('reports the width from the ResizeObserver callback', () => {
    let callback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) { callback = cb; }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    const element = document.createElement('div');
    element.getBoundingClientRect = () => ({ width: 300, height: 10, top: 0, left: 0, right: 300, bottom: 10, x: 0, y: 0, toJSON: () => ({}) });
    const { result, unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement | null>(element);
      return useContainerWidth(ref);
    });
    // İlk ölçüm layout effect'te: getBoundingClientRect
    expect(result.current).toBe(300);
    expect(observe).toHaveBeenCalledWith(element);
    act(() => {
      callback?.([{ contentRect: { width: 512 } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect(result.current).toBe(512);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('is 0 while the ref is empty', () => {
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement | null>(null);
      return useContainerWidth(ref);
    });
    expect(result.current).toBe(0);
  });
});
