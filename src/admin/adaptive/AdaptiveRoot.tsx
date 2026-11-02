import { useLayoutEffect, useState, type ComponentType, type HTMLAttributes, type ReactNode } from 'react';
import { InputLayersContext, ProfileContext, useAdaptiveWatcher } from './context';
import { PHONE_WITHOUT_ANTD } from './flags';
import { WideNotice, useWideModule, type WideResource } from './loader';
import { adaptiveAttributes, applyAdaptiveAttributes, type Profile } from './profile';
import { reloadPage } from './reload';

export type ProvidersComponent = ComponentType<{ children: ReactNode }>;
/** Statik sağlayıcı bileşeni ya da tembel kaynak: wideResource('wide-providers', () => import('./adaptive/WideProviders')). */
export type ProvidersSource = ProvidersComponent | WideResource<{ default: ProvidersComponent }>;

export interface AdaptiveRootProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  providers: ProvidersSource;
  /** Varsayılan flags.ts PHONE_WITHOUT_ANTD. Testler iki modu bununla sınar. */
  phoneWithoutAntd?: boolean;
}

function isResource(source: ProvidersSource): source is WideResource<{ default: ProvidersComponent }> {
  return typeof source === 'object' && source !== null && 'getState' in source && 'load' in source;
}

interface ProvidersGateState {
  /** Bağlı sağlayıcı bileşeni; yoksa içerik sağlayıcısız çizilir. */
  Providers: ProvidersComponent | null;
  /** Tembel sağlayıcı yüklenemediyse geniş bildirim (Yeniden dene / Yenile). */
  notice: ReactNode;
  /** Sağlayıcı isteniyor ama henüz bağlanmadı (tembel kaynak boşta ya da yükleniyor): bağlanınca alt ağaç yeniden kurulur. */
  busy: boolean;
}

/**
 * Sağlayıcı geçidi. Mod kapalı: sağlayıcı her profilde. Mod açık: telefonda yok; geniş profilde bağlanır ve yapışkan
 * kalır. İlk geniş geçişte alt ağaç bir kez yeniden bağlanır (sarmalayıcı eklenir); bilinen bedel. Tembel kaynak
 * beklerken ya da yüklenemezse içerik sağlayıcısız kullanılabilir kalır; beklerken `busy` doğrudur (kök aria-busy).
 */
function useProvidersGate(providers: ProvidersSource, phoneWithoutAntd: boolean, profile: Profile): ProvidersGateState {
  const wantProviders = !phoneWithoutAntd || profile !== 'phone';
  const [sticky, setSticky] = useState(wantProviders);
  if (wantProviders && !sticky) setSticky(true);
  const active = wantProviders || sticky;
  const resource = isResource(providers) ? providers : null;
  const state = useWideModule(resource, active);
  if (!resource) return { Providers: active ? (providers as ProvidersComponent) : null, notice: null, busy: false };
  const Providers = active && state.status === 'ready' ? state.module.default : null;
  const notice = active && (state.status === 'error' || state.status === 'stale-build')
    ? <WideNotice kind={state.status} onAction={state.status === 'error' ? () => { resource.retry().catch(() => {}); } : reloadPage} />
    : null;
  return { Providers, notice, busy: active && (state.status === 'idle' || state.status === 'loading') };
}

/**
 * Yönetim kökü: profil + katmanları bir kez izler, bağlamları verir, kök öğeye data-profile / data-input-* yazar ve
 * body'ye portallanan katmanlar için <html> öğesine yansıtır (unmount'ta siler). İlk profil ilk render'dan önce
 * eşzamanlı okunur. Tembel sağlayıcı geniş profilde beklenirken kök aria-busy="true" taşır: bağlanınca alt ağaç bir kez
 * yeniden kurulacağı için o ana kadarki ağaç bitmiş sayılmaz (yardımcı teknoloji ve e2e hazır sinyali).
 */
export function AdaptiveRoot({ children, providers, phoneWithoutAntd = PHONE_WITHOUT_ANTD, ...rest }: AdaptiveRootProps) {
  const snapshot = useAdaptiveWatcher();
  useLayoutEffect(() => applyAdaptiveAttributes(document.documentElement, snapshot), [snapshot]);
  const { Providers, notice, busy } = useProvidersGate(providers, phoneWithoutAntd, snapshot.profile);
  return (
    <div {...rest} {...adaptiveAttributes(snapshot)} aria-busy={busy ? true : rest['aria-busy']}>
      <ProfileContext.Provider value={snapshot.profile}>
        <InputLayersContext.Provider value={snapshot.input}>
          {Providers ? <Providers>{children}</Providers> : <>{notice}{children}</>}
        </InputLayersContext.Provider>
      </ProfileContext.Provider>
    </div>
  );
}
