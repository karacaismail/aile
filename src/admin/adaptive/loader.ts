import {
  Fragment, cloneElement, createElement, isValidElement, useLayoutEffect, useSyncExternalStore,
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
// Hazır sinyali: uçuştaki her yükleme sayılır (useWideLoading); AdaptiveRoot bu sürede köke data-wide-loading yazar.
// antd: uygulama ağacı hiçbir profilde antd sağlayıcısıyla sarılmaz. antd gerektiren geniş ada lazyWide(…, { antd: true })
// ile tanımlanır; sağlayıcı (adaptive/WideProviders) yalnız o ada geniş profilde render edilince iner ve yalnız onu sarar.

export type WideStatus = 'idle' | 'loading' | 'ready' | 'error' | 'stale-build';
export type WideState<M> =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'ready'; readonly module: M }
  | { readonly status: 'error' | 'stale-build'; readonly error: unknown };

export interface WideOptions {
  /** İlk başarısızlıktan sonra tek yeniden denemeden önceki bekleme (ms). Varsayılan WIDE_RETRY_DELAY_MS. */
  retryDelayMs?: number;
}

export interface LazyWideOptions extends WideOptions {
  /**
   * antd gerektiren geniş ada: modülle birlikte antd sağlayıcısı (adaptive/WideProviders: ConfigProvider + tr_TR + aile
   * teması; DOM öğesi çizmez) yüklenir ve YALNIZ bu adayı sarar. Ada ikisi de hazır olunca çizilir; o ana kadar
   * wideFallback. Telefon profilinde ikisi de indirilmez. Varsayılan false: bugün hiçbir ada antd istemez.
   */
  antd?: boolean;
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

// Uçuştaki yüklemeler (yeniden deneme beklemesi dahil). Hazır sinyalinin tek kaynağı: useWideLoading.
let pendingLoads = 0;
const pendingListeners = new Set<() => void>();
function changePending(delta: 1 | -1) {
  pendingLoads += delta;
  for (const listener of [...pendingListeners]) listener();
}
function subscribePending(listener: () => void) {
  pendingListeners.add(listener);
  return () => { pendingListeners.delete(listener); };
}
const anyPending = () => pendingLoads > 0;
const nonePending = () => false;

/** Herhangi bir geniş kaynak (lazyWide, wideResource, preload) yükleniyor mu? AdaptiveRoot data-wide-loading için. */
export function useWideLoading(): boolean {
  return useSyncExternalStore(subscribePending, anyPending, nonePending);
}

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

/**
 * Dinamik import bir modül ad alanı (nesne) vermelidir. undefined/null ya da ilkel değer başarısız yükleme sayılır: Vite'ın
 * ön yükleme yardımcısı `vite:preloadError` iptal edilince importu undefined ile çözer; bu 'ready' sayılırsa geniş ada
 * render sırasında çöker. Uygulama kodu olayı dinlemez (source-rules.test.ts); bu denetim ikinci savunma hattıdır.
 */
function checkedModule<M>(key: string, module: M, valid: (module: M) => boolean): M {
  if (module === null || (typeof module !== 'object' && typeof module !== 'function') || !valid(module)) {
    throw new TypeError(`Geniş modül '${key}' geçersiz modül verdi`);
  }
  return module;
}
const anyModule = () => true;

/** Modülün default'u React bileşeni mi: işlev ya da memo/forwardRef/lazy nesnesi ($$typeof). */
const hasDefaultComponent = (module: { default?: unknown }): boolean => {
  const value = module.default;
  return typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value);
};

/** Düşük düzey kaynak (bileşen olmayan modüller, ör. WideProviders). Çağrı biçimi lazyWide ile aynı kurala uyar. */
export function wideResource<M>(key: string, importer: () => Promise<M>, options: WideOptions = {}): WideResource<M> {
  return createResource(key, importer, options, anyModule);
}

/**
 * Her profilde kullanılabilen, ilk niyette inen tembel modül (geniş-özel değil; ör. kabuğun Sayfalar çekmecesi). Aynı
 * kayıt, tek yeniden deneme ve hata ayrımı (error / stale-build) wideResource gibidir; hazır sinyaline (useWideLoading,
 * data-wide-loading) sayılmaz ve kendiliğinden yüklenmez: çağıran load()/retry() ile ister (useWideModule(kaynak, false)).
 */
export function lazyResource<M>(key: string, importer: () => Promise<M>, options: WideOptions = {}): WideResource<M> {
  return createResource(key, importer, options, anyModule, plainRegistry);
}

// lazyResource kayıtları ayrı tutulur: wideManifest yalnız geniş kaynakları listeler, hazır sinyali onları saymaz.
const plainRegistry = new Map<string, WideResource<unknown>>();

function createResource<M>(
  key: string,
  importer: () => Promise<M>,
  options: WideOptions,
  valid: (module: M) => boolean,
  store: Map<string, WideResource<unknown>> = registry,
): WideResource<M> {
  const countPending = store === registry;
  const existing = store.get(key);
  if (existing) return existing as WideResource<M>;
  const retryDelayMs = options.retryDelayMs ?? WIDE_RETRY_DELAY_MS;
  let state: WideState<M> = IDLE;
  let inflight: Promise<M> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: WideState<M>) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const once = async (): Promise<M> => checkedModule(key, await importer(), valid);
  const attempt = async (): Promise<M> => {
    try {
      return await once();
    } catch {
      await wait(retryDelayMs);
      return once();
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
      if (countPending) changePending(1);
      inflight = attempt().then(
        module => { inflight = null; set({ status: 'ready', module }); if (countPending) changePending(-1); return module; },
        (error: unknown) => { inflight = null; set({ status: failureStatus(error), error }); if (countPending) changePending(-1); throw error; },
      );
      return inflight;
    },
    retry() {
      if (state.status === 'error' || state.status === 'stale-build') set(IDLE);
      return resource.load();
    },
  };
  store.set(key, resource as WideResource<unknown>);
  return resource;
}

/** Kayıtlı geniş modüllerin manifesti (tanı, e2e ağ kanıtı): anahtar + durum. */
export function wideManifest(): { key: string; status: WideStatus }[] {
  return [...registry.values()].map(resource => ({ key: resource.key, status: resource.getState().status }));
}

const noopSubscribe = () => () => {};
const idleState = () => IDLE;
const swallow = () => {};

/**
 * Kaynağın durumunu izler; enabled iken boşta ise yüklemeyi başlatır. resource null olabilir (koşulsuz hook çağrısı).
 * Yükleme yerleşim efektinde başlar: profil genişlediği commit boyanmadan önce kaynak 'loading' olur ve hazır sinyali
 * (data-wide-loading) ilk boyanan karede vardır; arada "hazır" görünen bir kare kalmaz.
 */
export function useWideModule<M>(resource: WideResource<M> | null, enabled: boolean): WideState<M> {
  const state = useSyncExternalStore(
    resource ? resource.subscribe : noopSubscribe,
    resource ? resource.getState : idleState,
    resource ? resource.getState : idleState,
  ) as WideState<M>;
  const status = state.status;
  useLayoutEffect(() => {
    if (resource && enabled && status === 'idle') resource.load().catch(swallow);
  }, [resource, enabled, status]);
  return state;
}

/**
 * Kurtarılabilir bildirim: düz <button> (antd'siz), odak çizgisi admin.css [data-focus-line] ile. message verilirse hata
 * metni odur (ör. kabuğun tembel Sayfalar çekmecesi); verilmezse geniş görünüm metni. stale-build metni sabittir.
 */
export function WideNotice({ kind, onAction, message }: { kind: 'error' | 'stale-build'; onAction(): void; message?: string }) {
  const text = kind === 'stale-build' ? 'Yeni sürüm var' : (message ?? 'Geniş görünüm yüklenemedi; temel görünüm kullanılıyor.');
  const action = kind === 'stale-build' ? 'Yenile' : 'Yeniden dene';
  return createElement(
    'div',
    { className: 'aile-wide-notice', role: 'status', 'data-kind': kind },
    createElement('p', { className: 'aile-wide-notice__text' }, text),
    createElement('button', { type: 'button', className: 'aile-wide-notice__action', 'data-focus-line': '', onClick: onAction }, action),
  );
}

const WIDE_MARK = Symbol.for('aile.adaptive.wide');

type ProvidersModule = { default: ComponentType<{ children: ReactNode }> };
let antdProviders: WideResource<ProvidersModule> | null = null;

/**
 * antd sağlayıcı kaynağı (tek, anahtar 'wide-providers'). Yalnız ilk antd adası tanımlanınca kaydolur; o güne dek
 * wideManifest'te görünmez ve hiçbir profilde istenmez. Yeniden deneme beklemesi ilk antd adasınınkidir (ilk importer).
 */
function antdProvidersResource(options: WideOptions): WideResource<ProvidersModule> {
  antdProviders ??= createResource('wide-providers', () => import('./WideProviders'), options, hasDefaultComponent);
  return antdProviders;
}

const failed = <M>(state: WideState<M>): state is Extract<WideState<M>, { status: 'error' | 'stale-build' }> =>
  state.status === 'error' || state.status === 'stale-build';

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
  options: LazyWideOptions = {},
): WideComponent<P> {
  const { antd = false, ...resourceOptions } = options;
  const resource = createResource(key, importer, resourceOptions, hasDefaultComponent);
  const providers = antd ? antdProvidersResource(resourceOptions) : null;
  function Wide(props: WideProps<P>): ReactNode {
    const { wideFallback = null, ...rest } = props;
    const enabled = useProfile() !== 'phone';
    const state = useWideModule(resource, enabled);
    const providersState = useWideModule(providers, enabled);
    if (enabled && state.status === 'ready' && (!providers || providersState.status === 'ready')) {
      const view = createElement(state.module.default, rest as P);
      return providersState.status === 'ready' ? createElement(providersState.module.default, null, view) : view;
    }
    // Ada iki kaynaktan birini alamadıysa: o kaynağın kurtarma bildirimi (modülünki önce).
    const failure = !enabled ? null
      : failed(state) ? { status: state.status, retry: () => resource.retry() }
      : providers && failed(providersState) ? { status: providersState.status, retry: () => providers.retry() }
      : null;
    const notice = !failure ? null
      : failure.status === 'error' ? createElement(WideNotice, { kind: 'error', onAction: () => { failure.retry().catch(swallow); } })
      : createElement(WideNotice, { kind: 'stale-build', onAction: reloadPage });
    return createElement(Fragment, null, notice, wideFallback);
  }
  Wide.displayName = `Wide(${key})`;
  return Object.assign(Wide, {
    [WIDE_MARK]: true,
    resource,
    preload: () => Promise.all([resource.load(), providers?.load()]).then(() => undefined),
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
