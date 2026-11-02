import {
  Fragment, cloneElement, createElement, isValidElement, useEffect, useSyncExternalStore,
  type ComponentType, type FunctionComponent, type ReactElement, type ReactNode,
} from 'react';
import { useProfile } from './context';
import { reloadPage } from './reload';
import './adaptive.css';

// Uyarlamalı teslim yükleyicisi: geniş (tablet/masaüstü) yetenekler telefon temel deneyiminin üstüne, yalnız geniş
// profilde ve bundler-görünür açık import() ile yüklenir. Kural: geniş-özel modül "*.wide.tsx" adını taşır
// (src/admin/ui/wide/ ya da ilgili klasör), default export verir, hiçbir yerde statik içe aktarılmaz:
//   const TabloWide = lazyWide('alimlar-tablo', () => import('./AlimlarTablo.wide'));
//   <Adaptive phone={<AlimlarListe … />} wide={<TabloWide … />} />
// Kayıt defteri anahtara göredir: aynı anahtar aynı kaynaktır (ilk importer geçerli), uçuştaki yükleme tekildir.
// Hata: bir kez geri çekilip yeniden dener; yine olmazsa "Yeniden dene" (error) ya da parça artık sunucuda yoksa
// "Yeni sürüm var · Yenile" (stale-build). Bekleme ve hata sırasında telefon/temel sunum kullanılabilir kalır.

export type WideStatus = 'idle' | 'loading' | 'ready' | 'error' | 'stale-build';
export type WideState<M> =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'ready'; readonly module: M }
  | { readonly status: 'error' | 'stale-build'; readonly error: unknown };

export interface WideOptions {
  /** İlk başarısızlıktan sonra tek yeniden denemeden önceki bekleme (ms). Varsayılan WIDE_RETRY_DELAY_MS. */
  retryDelayMs?: number;
}

export interface WideResource<M> {
  readonly key: string;
  getState(): WideState<M>;
  subscribe(listener: () => void): () => void;
  /** Hazırsa modülü verir; yükleniyorsa aynı sözü paylaşır; hata durumunda kendiliğinden yeniden denemez. */
  load(): Promise<M>;
  /** Hata/stale-build durumunu sıfırlayıp yeniden yükler. */
  retry(): Promise<M>;
}

export type WideProps<P> = P & {
  /** Modül hazır değilken (telefon profili, bekleme, hata) gösterilen temel sunum. <Adaptive> bunu phone ile doldurur. */
  wideFallback?: ReactNode;
};
export interface WideComponent<P> extends FunctionComponent<WideProps<P>> {
  readonly resource: WideResource<{ default: ComponentType<P> }>;
  /** Profilden bağımsız açık ön yükleme (ör. geniş profille açılışta). */
  preload(): Promise<void>;
}

export const WIDE_RETRY_DELAY_MS = 800;

const IDLE: WideState<never> = Object.freeze({ status: 'idle' });
const LOADING: WideState<never> = Object.freeze({ status: 'loading' });
const registry = new Map<string, WideResource<unknown>>();

// Tarayıcı iletileri: Chromium, WebKit, Gecko; Vite CSS ön yüklemesi; eksik parça yerine HTML dönen sunucu;
// webpack tarzı ChunkLoadError. Hepsi "parça artık yok ya da alınamadı" demektir.
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script|Loading (?:CSS )?chunk [\w-]+ failed/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return name === 'ChunkLoadError' || (typeof message === 'string' && CHUNK_ERROR.test(message));
}

/** Yeniden deneme de başarısızsa: çevrim içiyken parça hatası sürüm kayması sayılır; çevrim dışı ya da başka hata → error. */
function failureStatus(error: unknown): 'error' | 'stale-build' {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return !offline && isChunkLoadError(error) ? 'stale-build' : 'error';
}

const wait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

/** Düşük düzey kaynak (bileşen olmayan modüller, ör. WideProviders). Çağrı biçimi lazyWide ile aynı kurala uyar. */
export function wideResource<M>(key: string, importer: () => Promise<M>, options: WideOptions = {}): WideResource<M> {
  const existing = registry.get(key);
  if (existing) return existing as WideResource<M>;
  const retryDelayMs = options.retryDelayMs ?? WIDE_RETRY_DELAY_MS;
  let state: WideState<M> = IDLE;
  let inflight: Promise<M> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: WideState<M>) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const attempt = async (): Promise<M> => {
    try {
      return await importer();
    } catch {
      await wait(retryDelayMs);
      return importer();
    }
  };
  const resource: WideResource<M> = {
    key,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load() {
      if (state.status === 'ready') return Promise.resolve(state.module);
      if (inflight) return inflight;
      if (state.status === 'error' || state.status === 'stale-build') return Promise.reject(state.error);
      set(LOADING);
      inflight = attempt().then(
        module => { inflight = null; set({ status: 'ready', module }); return module; },
        (error: unknown) => { inflight = null; set({ status: failureStatus(error), error }); throw error; },
      );
      return inflight;
    },
    retry() {
      if (state.status === 'error' || state.status === 'stale-build') set(IDLE);
      return resource.load();
    },
  };
  registry.set(key, resource as WideResource<unknown>);
  return resource;
}

/** Kayıtlı geniş modüllerin manifesti (tanı, e2e ağ kanıtı): anahtar + durum. */
export function wideManifest(): { key: string; status: WideStatus }[] {
  return [...registry.values()].map(resource => ({ key: resource.key, status: resource.getState().status }));
}

const noopSubscribe = () => () => {};
const idleState = () => IDLE;
const swallow = () => {};

/** Kaynağın durumunu izler; enabled iken boşta ise yüklemeyi başlatır. resource null olabilir (koşulsuz hook çağrısı). */
export function useWideModule<M>(resource: WideResource<M> | null, enabled: boolean): WideState<M> {
  const state = useSyncExternalStore(
    resource ? resource.subscribe : noopSubscribe,
    resource ? resource.getState : idleState,
    resource ? resource.getState : idleState,
  ) as WideState<M>;
  const status = state.status;
  useEffect(() => {
    if (resource && enabled && status === 'idle') resource.load().catch(swallow);
  }, [resource, enabled, status]);
  return state;
}

/** Kurtarılabilir bildirim: düz <button> (antd'siz), odak çizgisi admin.css [data-focus-line] ile. */
export function WideNotice({ kind, onAction }: { kind: 'error' | 'stale-build'; onAction(): void }) {
  const text = kind === 'stale-build' ? 'Yeni sürüm var' : 'Geniş görünüm yüklenemedi; temel görünüm kullanılıyor.';
  const action = kind === 'stale-build' ? 'Yenile' : 'Yeniden dene';
  return createElement(
    'div',
    { className: 'aile-wide-notice', role: 'status', 'data-kind': kind },
    createElement('p', { className: 'aile-wide-notice__text' }, text),
    createElement('button', { type: 'button', className: 'aile-wide-notice__action', 'data-focus-line': '', onClick: onAction }, action),
  );
}

const WIDE_MARK = Symbol.for('aile.adaptive.wide');

function isWideComponent(type: unknown): type is WideComponent<object> {
  return typeof type === 'function' && (type as unknown as Record<symbol, unknown>)[WIDE_MARK] === true;
}

/**
 * Geniş-özel bileşen. Telefon profilinde yalnız wideFallback'i gösterir ve hiç indirmez (stale guard: yükleme bitse
 * bile telefona dönmüş ekrana geniş arayüz gelmez). Geniş profilde yükler; hazır değilken [bildirim, wideFallback]
 * çizer — iki yuva hep aynı yerde olduğundan temel sunum bekleme/hata boyunca yeniden bağlanmaz.
 */
export function lazyWide<P extends object>(
  key: string,
  importer: () => Promise<{ default: ComponentType<P> }>,
  options?: WideOptions,
): WideComponent<P> {
  const resource = wideResource(key, importer, options);
  function Wide(props: WideProps<P>): ReactNode {
    const { wideFallback = null, ...rest } = props;
    const enabled = useProfile() !== 'phone';
    const state = useWideModule(resource, enabled);
    if (enabled && state.status === 'ready') return createElement(state.module.default, rest as P);
    const notice = !enabled ? null
      : state.status === 'error' ? createElement(WideNotice, { kind: 'error', onAction: () => { resource.retry().catch(swallow); } })
      : state.status === 'stale-build' ? createElement(WideNotice, { kind: 'stale-build', onAction: reloadPage })
      : null;
    return createElement(Fragment, null, notice, wideFallback);
  }
  Wide.displayName = `Wide(${key})`;
  return Object.assign(Wide, {
    [WIDE_MARK]: true,
    resource,
    preload: () => resource.load().then(() => undefined),
  }) as unknown as WideComponent<P>;
}

export interface AdaptiveProps {
  /** Telefon (temel) sunumu: telefon profilinde ve geniş modül beklerken gösterilir. */
  phone: ReactNode;
  /** Geniş sunum: tercihen bir lazyWide bileşeni öğesi; düz düğüm de olur (o zaman yalnız profile göre seçilir). */
  wide: ReactNode;
}

/** Profil seçici. wide bir lazyWide öğesiyse phone onun bekleme sunumu olur (yükleme sırasında da kullanılabilir). */
export function Adaptive({ phone, wide }: AdaptiveProps): ReactNode {
  const profile = useProfile();
  if (isValidElement(wide) && isWideComponent(wide.type)) {
    const element = wide as ReactElement<{ wideFallback?: ReactNode }>;
    return cloneElement(element, { wideFallback: element.props.wideFallback ?? phone });
  }
  return profile === 'phone' ? phone : wide;
}

/** Yalnız geniş profilde çocukları çizer; telefonda fallback (varsayılan hiçbir şey). İçindeki lazyWide'lar telefonda indirilmez. */
export function WideOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }): ReactNode {
  return useProfile() === 'phone' ? fallback : children;
}
