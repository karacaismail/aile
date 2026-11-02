import { Component, createRef, lazy, Suspense, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { Redirect, Route, Switch } from 'wouter';
import { WIDE_RETRY_DELAY_MS, WideNotice, isChunkLoadError } from './adaptive';
import { reloadPage } from './adaptive/reload';
import { useDevice } from './device';
import { PageHeader } from './shell/PageHeader';
import { adminLeads, adminNav, defaultAdminPath, type AdminPageKey } from './shell/navigation';
import { ErrorState } from './ui/ErrorState';
import { LoadingShell } from './ui/LoadingShell';
import { preloadIcons } from './ui/icons';

// Rota → sayfa: navigation.ts yolları (/genel … /veri, /emeklilik, /ayarlar) tek kaynaktır; etiket ve amaç oradan gelir.
// - Her sayfa React.lazy ile kendi parçasında yüklenir, yalnız rotası çizildiğinde. Başka sayfa ya da geniş (*.wide)
//   parça için spekülatif ön yükleme yok; geniş parçaları sayfalar lazyWide ile yalnız geniş profilde ister.
// - Yüklenirken aynı PageHeader (bölüm + h1 + amaç; başlık korunur) ve altında LoadingShell çizilir.
// - Parça indirilemezse bir kez kendiliğinden yeniden denenir (W0 lazyWide ile aynı bekleme). Yine olmazsa ya da sayfa
//   hata atarsa her rotanın Suspense'ini saran sınır aynı başlığı (PageHeader) korur; kabuk ve diğer rotalar çalışır.
//   W0 lazyWide ile aynı ayrım: çevrim içiyken parça hatası (isChunkLoadError) sürüm kaymasıdır, WideNotice
//   "Yeni sürüm var · Yenile" sayfayı yeniden yükler (yeni index.html → yeni parça adları). Çevrim dışı parça hatası ya
//   da başka hata ErrorState "Yeniden dene" ile lazy sayfayı yeniden kurar: hata yakalanınca o rotanın lazy kaydı atılır
//   (React.lazy reddi önbelleğe alır), deneme ve sonraki ziyaret parçayı yeniden indirir; deneme odağı main'e taşır.
// - Desenler `nest` kullanmaz: iç içe Router tabanı sayfa içi mutlak gezinmeyi (GenelPage → navigate('/raporlar'))
//   "/genel/raporlar"a çevirirdi. İç içe yollar düzenli ifadeyle üst sayfaya bağlanır (regexparam joker deseniyle aynı
//   anlam: büyük/küçük harf duyarsız, sonda "/" serbest). Alımlar ayrıntısı "/alimlar/:id?" ile aynı Route öğesindedir
//   (liste ↔ ayrıntı geçişinde sayfa yeniden kurulmaz); AlimlarPage seçili kaydı hash'ten (parseAlimlarHash) okur.
// - Bilinmeyen konum varsayılan sayfaya (Genel durum) geçmişe kayıt eklemeden (replace) gider.
// ui modülleri tek tek içe aktarılır (barrel değil): telefon teslimi yalnız burada çizilen bileşenleri çeker; ui/icons
// yalnız çekirdek dışı simgeleri sayfa parçasıyla birlikte istemek için (preloadIcons).

export type AdminRouteKey = AdminPageKey | 'ayarlar';
export interface RoutePageProps { location: string }
/** Sayfa parçasını indirip çizilecek bileşeni verir; yalnız rota ilk çizildiğinde çağrılır. */
export type PageLoader = () => Promise<ComponentType<RoutePageProps>>;
export interface AdminRoutesOptions {
  /** İlk başarısız indirmeden sonraki tek otomatik yeniden denemenin beklemesi (ms). Varsayılan PAGE_RETRY_DELAY_MS. */
  retryDelayMs?: number;
}

/** Sayfa parçası için otomatik yeniden deneme beklemesi; geniş parçalarla (lazyWide) aynı. */
export const PAGE_RETRY_DELAY_MS = WIDE_RETRY_DELAY_MS;

/**
 * Sayfa parçası + çekirdek dışı simgeler (ui/icons.extra): Genel durum dışındaki sayfalar onları ilk çizimde kullanır;
 * ikisi paralel iner, sayfa simgeleri hazır çizilir. Simge parçası yüklenemezse sayfa yine açılır (simge aynı ölçüde boş
 * kutu, sonraki çizimde yeniden istenir). Genel durum (telefon ilk rotası) yalnız çekirdek simgeleri çizer: istemez.
 */
const withIcons = <M,>(page: Promise<M>): Promise<M> => Promise.all([page, preloadIcons().catch(() => null)]).then(([module]) => module);

const PAGE_LOADERS: Readonly<Record<AdminRouteKey, PageLoader>> = {
  genel: () => import('./pages/GenelPage').then(m => ({ location }: RoutePageProps) => <m.GenelPage location={location} />),
  butce: () => withIcons(import('./pages/ButcePage')).then(m => ({ location }: RoutePageProps) => <m.ButcePage location={location} />),
  odemeler: () => withIcons(import('./pages/OdemelerPage')).then(m => ({ location }: RoutePageProps) => <m.OdemelerPage location={location} />),
  hesaplar: () => withIcons(import('./pages/HesaplarPage')).then(m => ({ location }: RoutePageProps) => <m.HesaplarPage location={location} />),
  emeklilik: () => withIcons(import('./pages/EmeklilikPage')).then(m => () => <m.EmeklilikPage />),
  alimlar: () => withIcons(import('./pages/AlimlarPage')).then(m => ({ location }: RoutePageProps) => <m.AlimlarPage location={location} />),
  ev: () => withIcons(import('./pages/EvPage')).then(m => () => <m.EvPage />),
  projeler: () => withIcons(import('./pages/ProjelerPage')).then(m => () => <m.ProjelerPage />),
  taraflar: () => withIcons(import('./pages/TaraflarPage')).then(m => () => <m.TaraflarPage />),
  raporlar: () => withIcons(import('./pages/RaporlarPage')).then(m => ({ location }: RoutePageProps) => <m.RaporlarPage location={location} />),
  sozlukler: () => withIcons(import('./pages/SozluklerPage')).then(m => ({ location }: RoutePageProps) => <m.SozluklerPage location={location} />),
  veri: () => withIcons(import('./pages/VeriPage')).then(m => () => <m.VeriPage />),
  ayarlar: () => withIcons(import('./pages/AyarlarPage')).then(m => () => <m.AyarlarPage />),
};

interface AdminRoute { key: AdminRouteKey; path: string; pattern: string | RegExp }

const ALIMLAR = '/alimlar';

/** "/raporlar", "/raporlar/", "/raporlar/aylik/…" (büyük/küçük harf duyarsız); "/raporlarx" değil. */
function nestedPattern(path: string): RegExp {
  if (!/^\/[a-z]+$/.test(path)) throw new Error(`Rota yolu beklenmeyen biçimde: ${path}`);
  return new RegExp(`^${path}(?:/.*)?$`, 'i');
}

/** navigation.ts sırasıyla 12 sayfa + Ayarlar; dış bağlantı (E-tabloyu aç) rota değildir. */
const ROUTES: readonly AdminRoute[] = adminNav
  .filter(item => !item.external)
  .map(item => ({
    key: item.key as AdminRouteKey,
    path: item.path,
    pattern: item.path === ALIMLAR ? `${ALIMLAR}/:id?` : nestedPattern(item.path),
  }));

const wait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

async function loadWithRetry(load: PageLoader, retryDelayMs: number): Promise<ComponentType<RoutePageProps>> {
  try {
    return await load();
  } catch {
    await wait(retryDelayMs);
    return load();
  }
}

/** Lazy parça gelene kadar: sayfanın kendi başlığı (aynı PageHeader) + aynı yerleşimde iskelet. */
function RouteFallback({ path }: { path: string }) {
  const device = useDevice();
  return (
    <>
      <PageHeader location={path} purpose={adminLeads[path]} />
      <LoadingShell narrow={device === 'phone'} />
    </>
  );
}

/** Sınırın gösterdiği kurtarma: 'stale-build' → Yenile (sayfa yeniden yüklenir), 'offline' ve 'error' → Yeniden dene. */
type FailureKind = 'stale-build' | 'offline' | 'error';

/** W0 loader failureStatus ile aynı karar; çevrim dışı parça hatası yenilemeyle düzelmez (sayfa hiç açılmaz). */
function failureKind(error: unknown): FailureKind {
  if (!isChunkLoadError(error)) return 'error';
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return offline ? 'offline' : 'stale-build';
}

const ERROR_COPY: Readonly<Record<Exclude<FailureKind, 'stale-build'>, { title: string; message: string }>> = {
  offline: { title: 'Sayfa yüklenemedi', message: 'Sayfanın dosyası indirilemedi: bağlantı yok. Bağlantı gelince yeniden deneyin.' },
  error: { title: 'Sayfa açılamadı', message: 'Sayfa açılırken beklenmeyen bir hata oluştu. Yeniden deneyin; sorun sürerse sayfayı yenileyin.' },
};

interface BoundaryProps { path: string; onError(): void; onRetry(): void; children: ReactNode }
type BoundaryState = { failed: false } | { failed: true; kind: FailureKind };

/** Rota düzeyinde kurtarılabilir hata sınırı: başlık kalır; sürüm kaymasında "Yenile", diğerlerinde "Yeniden dene". */
class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };
  private readonly anchor = createRef<HTMLDivElement>();

  static getDerivedStateFromError(error: unknown): BoundaryState {
    // Tür yakalandığı an sabitlenir: bağlantı sonradan değişse de görünüm kendiliğinden başka kurtarmaya atlamaz.
    return { failed: true, kind: failureKind(error) };
  }

  componentDidCatch() {
    this.props.onError();
  }

  private readonly retry = () => {
    // Hata görünümü kaybolacak; odak (WebKit'te tıklama düğmeye odak vermez) içerik alanına geçer.
    const main = this.anchor.current?.closest('main');
    if (main instanceof HTMLElement) main.focus({ preventScroll: true });
    this.props.onRetry();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const { kind } = this.state;
    return (
      <>
        <PageHeader location={this.props.path} purpose={adminLeads[this.props.path]} />
        <div ref={this.anchor} className="aile-route-hata" data-route-failure={kind}>
          {kind === 'stale-build'
            ? <WideNotice kind="stale-build" onAction={reloadPage} />
            : <ErrorState title={ERROR_COPY[kind].title} message={ERROR_COPY[kind].message} onRetry={this.retry} />}
        </div>
      </>
    );
  }
}

type RoutePage = LazyExoticComponent<ComponentType<RoutePageProps>>;

interface RouteViewProps { path: string; page(): RoutePage; forget(): void }

function RouteView({ path, page, forget }: RouteViewProps) {
  // Her deneme sınırı yeniden kurar; forget() sonrası page() yeni bir lazy kaydı verir.
  const [attempt, setAttempt] = useState(0);
  const Page = page();
  return (
    <RouteErrorBoundary key={attempt} path={path} onError={forget} onRetry={() => setAttempt(value => value + 1)}>
      <Suspense fallback={<RouteFallback path={path} />}>
        <Page location={path} />
      </Suspense>
    </RouteErrorBoundary>
  );
}

/**
 * Rota tablosu: her nav yolu için bir rota (iç içe yollar dahil), sayfa başına bir React.lazy; bilinmeyen konum
 * varsayılan sayfaya (replace). Yükleyiciler yalnız rota çizildiğinde çağrılır.
 */
export function createAdminRoutes(loaders: Readonly<Record<AdminRouteKey, PageLoader>>, options: AdminRoutesOptions = {}): ComponentType {
  const retryDelayMs = options.retryDelayMs ?? PAGE_RETRY_DELAY_MS;
  const pages = new Map<AdminRouteKey, RoutePage>();
  const pageFor = (key: AdminRouteKey): RoutePage => {
    let page = pages.get(key);
    if (!page) {
      page = lazy(async () => ({ default: await loadWithRetry(loaders[key], retryDelayMs) }));
      pages.set(key, page);
    }
    return page;
  };

  function AdminRoutes() {
    return (
      <Switch>
        {ROUTES.map(({ key, path, pattern }) => (
          <Route key={path} path={pattern}>
            <RouteView path={path} page={() => pageFor(key)} forget={() => { pages.delete(key); }} />
          </Route>
        ))}
        <Route>
          <Redirect to={defaultAdminPath} replace />
        </Route>
      </Switch>
    );
  }
  return AdminRoutes;
}

/** Uygulamanın rota tablosu (App.tsx). */
export const AdminRoutes = createAdminRoutes(PAGE_LOADERS);
