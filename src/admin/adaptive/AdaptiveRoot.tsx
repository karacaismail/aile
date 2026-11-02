import { useLayoutEffect, type ComponentType, type HTMLAttributes, type ReactNode } from 'react';
import { InputLayersContext, ProfileContext, useAdaptiveWatcher } from './context';
import { useWideLoading } from './loader';
import { adaptiveAttributes, applyAdaptiveAttributes } from './profile';

export type ProvidersComponent = ComponentType<{ children: ReactNode }>;
/** @deprecated ProvidersComponent kullanın. Tembel sağlayıcı kaynağı artık kabul edilmez (ağacı profil değişiminde yeniden kurardı). */
export type ProvidersSource = ProvidersComponent;

export interface AdaptiveRootProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  /**
   * İsteğe bağlı statik sağlayıcı: ilk render'dan itibaren her profilde sarar, profil değişiminde eklenip kaldırılmaz.
   * antd sağlayıcısı buraya verilmez: antd gerektiren geniş ada lazyWide(…, { antd: true }) ile yalnız kendini sarar.
   */
  providers?: ProvidersComponent;
  /**
   * @deprecated Etkisi yok. Geçiş kesimi (plan D8) tamamlandı: uygulama ağacı hiçbir profilde antd sağlayıcısıyla
   * sarılmaz; profile göre sarmalayıcı eklemek ağacı yeniden kurardı (main, odak, açık katmanlar, taslaklar kaybolurdu).
   */
  phoneWithoutAntd?: boolean;
}

/**
 * Yönetim kökü: profil + katmanları bir kez izler, bağlamları verir, kök öğeye data-profile / data-input-* yazar ve
 * body'ye portallanan katmanlar için <html> öğesine yansıtır (unmount'ta siler). İlk profil ilk render'dan önce
 * eşzamanlı okunur. Ağaç biçimi profile bağlı değildir: profil değişiminde yalnız bağlam değerleri ve öznitelikler
 * değişir, alt ağaç yeniden kurulmaz. Geniş bir modül (lazyWide/wideResource) yüklenirken kök data-wide-loading taşır
 * (e2e openAdmin hazır sinyali); aria-busy değildir, çünkü bekleme boyunca telefon sunumu kullanılabilir kalır.
 */
export function AdaptiveRoot({ children, providers: Providers, phoneWithoutAntd, ...rest }: AdaptiveRootProps) {
  void phoneWithoutAntd;
  const snapshot = useAdaptiveWatcher();
  const wideLoading = useWideLoading();
  useLayoutEffect(() => applyAdaptiveAttributes(document.documentElement, snapshot), [snapshot]);
  return (
    <div {...rest} {...adaptiveAttributes(snapshot)} data-wide-loading={wideLoading ? '' : undefined}>
      <ProfileContext.Provider value={snapshot.profile}>
        <InputLayersContext.Provider value={snapshot.input}>
          {Providers ? <Providers>{children}</Providers> : children}
        </InputLayersContext.Provider>
      </ProfileContext.Provider>
    </div>
  );
}
