import { createContext, createElement, useContext, useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { designTokens } from '../design/tokens.ts';
import type { Device } from './shell/contracts';

// Cihaz sınıfı yerleşim alanına göre: phone (<600) | tablet (600–1023) | desktop (≥1024).
// Kırılımlar tokens.json (kirilimTablet / kirilimGenis). matchMedia 'change' dinlenir; UA veya isMobile yok.
const wideQuery = `(min-width: ${designTokens.kirilimGenis}px)`;
const tabletQuery = `(min-width: ${designTokens.kirilimTablet}px)`;

function classify(wide: boolean, tablet: boolean): Device {
  return wide ? 'desktop' : tablet ? 'tablet' : 'phone';
}

function readDevice(): Device {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  return classify(window.matchMedia(wideQuery).matches, window.matchMedia(tabletQuery).matches);
}

/** matchMedia tabanlı cihaz sınıfı; iki sorgunun change olayını dinler, unmount'ta bırakır. */
function useMatchedDevice(): Device {
  const [device, setDevice] = useState<Device>(readDevice);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia(wideQuery);
    const tablet = window.matchMedia(tabletQuery);
    const update = () => setDevice(classify(wide.matches, tablet.matches));
    update();
    wide.addEventListener('change', update);
    tablet.addEventListener('change', update);
    return () => {
      wide.removeEventListener('change', update);
      tablet.removeEventListener('change', update);
    };
  }, []);
  return device;
}

export const DeviceContext = createContext<Device | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const device = useMatchedDevice();
  return createElement(DeviceContext.Provider, { value: device }, children);
}

/** Sağlayıcı varsa onun değeri; yoksa doğrudan matchMedia (test ve yalıtık bileşen için). */
export function useDevice(): Device {
  const fromContext = useContext(DeviceContext);
  const matched = useMatchedDevice();
  return fromContext ?? matched;
}

/** Kapsayıcı genişliği (CSS px). İlk ölçüm layout effect'te; sonrası ResizeObserver. Ref boşken 0. */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
