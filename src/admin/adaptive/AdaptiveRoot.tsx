import { useLayoutEffect, useState, type ComponentType, type HTMLAttributes, type ReactNode } from 'react';
import { InputLayersContext, ProfileContext, useAdaptiveWatcher, useProfile } from './context';
import { PHONE_WITHOUT_ANTD } from './flags';
import { WideNotice, useWideModule, type WideResource } from './loader';
import { adaptiveAttributes, applyAdaptiveAttributes } from './profile';
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

/**
 * Sağlayıcı geçidi. Mod kapalı: sağlayıcı her profilde. Mod açık: telefonda yok; geniş profilde bağlanır ve yapışkan
 * kalır. İlk geniş geçişte alt ağaç bir kez yeniden bağlanır (sarmalayıcı eklenir); bilinen bedel. Tembel kaynak
 * beklerken ya da yüklenemezse içerik sağlayıcısız kullanılabilir kalır.
 */
function ProvidersGate({ providers, phoneWithoutAntd, children }: { providers: ProvidersSource; phoneWithoutAntd: boolean; children: ReactNode }) {
  const profile = useProfile();
  const wantProviders = !phoneWithoutAntd || profile !== 'phone';
  const [sticky, setSticky] = useState(wantProviders);
  if (wantProviders && !sticky) setSticky(true);
  const active = wantProviders || sticky;
  const resource = isResource(providers) ? providers : null;
  const state = useWideModule(resource, active);
  const Providers: ProvidersComponent | null = resource ? (state.status === 'ready' ? state.module.default : null) : (providers as ProvidersComponent);
  if (active && Providers) return <Providers>{children}</Providers>;
  const notice = resource && (state.status === 'error' || state.status === 'stale-build')
    ? <WideNotice kind={state.status} onAction={state.status === 'error' ? () => { resource.retry().catch(() => {}); } : reloadPage} />
    : null;
  return <>{notice}{children}</>;
}

/**
 * Yönetim kökü: profil + katmanları bir kez izler, bağlamları verir, kök öğeye data-profile / data-input-* yazar ve
 * body'ye portallanan katmanlar için <html> öğesine yansıtır (unmount'ta siler). İlk profil ilk render'dan önce
 * eşzamanlı okunur.
 */
export function AdaptiveRoot({ children, providers, phoneWithoutAntd = PHONE_WITHOUT_ANTD, ...rest }: AdaptiveRootProps) {
  const snapshot = useAdaptiveWatcher();
  useLayoutEffect(() => applyAdaptiveAttributes(document.documentElement, snapshot), [snapshot]);
  return (
    <div {...rest} {...adaptiveAttributes(snapshot)}>
      <ProfileContext.Provider value={snapshot.profile}>
        <InputLayersContext.Provider value={snapshot.input}>
          <ProvidersGate providers={providers} phoneWithoutAntd={phoneWithoutAntd}>{children}</ProvidersGate>
        </InputLayersContext.Provider>
      </ProfileContext.Provider>
    </div>
  );
}
