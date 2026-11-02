import { createElement, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { AdaptiveProvider, ProfileContext, useProfile } from './adaptive/context';
import type { Device } from './shell/contracts';

// Geriye uyumlu cihaz API'si. Kaynak artık src/admin/adaptive: tek üst düzey yerleşim profili genişlik + yükseklik +
// kısa kenardan seçilir (phone: <600 ya da kısa kenar <480; tablet: 600–1023; desktop: ≥1024). Yatay telefon phone
// kalır. Kırılımlar tokens.ts (kirilimTablet, kirilimGenis, adaptiveTokens.kirilimKisaKenar); UA veya isMobile yok.
// Yeni kod useProfile / useInputLayers kullanır (../adaptive); useDevice aynı değeri verir.
export { useInputLayers, useProfile } from './adaptive/context';

/** Eski ad; ProfileContext ile aynı nesne. Testler <DeviceContext.Provider value="phone"> ile profili zorlar. */
export const DeviceContext = ProfileContext;

export function DeviceProvider({ children }: { children: ReactNode }) {
  return createElement(AdaptiveProvider, null, children);
}

/** Sağlayıcı varsa onun değeri; yoksa doğrudan matchMedia (test ve yalıtık bileşen için). */
export function useDevice(): Device {
  return useProfile();
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
