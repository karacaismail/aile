import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { Redirect, Route, Switch } from 'wouter';
import { useDevice } from './device';
import { PageHeader } from './shell/PageHeader';
import { adminLeads, adminPages, defaultAdminPath, settingsLink, type AdminPageKey } from './shell/navigation';
import { LoadingShell } from './ui';

// Rota → sayfa: navigation.ts yolları (/genel … /veri, /ayarlar). Her sayfa React.lazy ile ayrı parçada yüklenir;
// yüklenirken aynı PageHeader (bölüm + h1 + amaç; başlık korunur) ve altında LoadingShell çizilir.
// Desenler `nest` kullanmaz: iç içe Router tabanı sayfa içi mutlak gezinmeyi (GenelPage → navigate('/raporlar'))
// "/genel/raporlar"a çevirirdi. Bunun yerine "<yol>/*?" iç içe yolları üst sayfaya bağlar. Alımlar ayrıntısı
// "/alimlar/:id?" ile aynı Route öğesindedir (liste ↔ ayrıntı geçişinde sayfa yeniden kurulmaz); AlimlarPage seçili
// kaydı ve sorgu durumunu kendi hash sözleşmesinden (parseAlimlarHash) okur, rota yalnız kendi yolunu verir.

interface RoutePageProps { location: string }
type RoutePage = LazyExoticComponent<ComponentType<RoutePageProps>>;

const page = (load: () => Promise<ComponentType<RoutePageProps>>): RoutePage => lazy(async () => ({ default: await load() }));

const PAGES: Readonly<Record<AdminPageKey | 'ayarlar', RoutePage>> = {
  genel: page(() => import('./pages/GenelPage').then(m => ({ location }: RoutePageProps) => <m.GenelPage location={location} />)),
  butce: page(() => import('./pages/ButcePage').then(m => ({ location }: RoutePageProps) => <m.ButcePage location={location} />)),
  odemeler: page(() => import('./pages/OdemelerPage').then(m => ({ location }: RoutePageProps) => <m.OdemelerPage location={location} />)),
  hesaplar: page(() => import('./pages/HesaplarPage').then(m => ({ location }: RoutePageProps) => <m.HesaplarPage location={location} />)),
  alimlar: page(() => import('./pages/AlimlarPage').then(m => ({ location }: RoutePageProps) => <m.AlimlarPage location={location} />)),
  ev: page(() => import('./pages/EvPage').then(m => () => <m.EvPage />)),
  projeler: page(() => import('./pages/ProjelerPage').then(m => () => <m.ProjelerPage />)),
  taraflar: page(() => import('./pages/TaraflarPage').then(m => () => <m.TaraflarPage />)),
  raporlar: page(() => import('./pages/RaporlarPage').then(m => ({ location }: RoutePageProps) => <m.RaporlarPage location={location} />)),
  sozlukler: page(() => import('./pages/SozluklerPage').then(m => ({ location }: RoutePageProps) => <m.SozluklerPage location={location} />)),
  veri: page(() => import('./pages/VeriPage').then(m => () => <m.VeriPage />)),
  ayarlar: page(() => import('./pages/AyarlarPage').then(m => () => <m.AyarlarPage />)),
};

interface AdminRoute { path: string; pattern: string; Page: RoutePage }

const ALIMLAR = '/alimlar';
const ROUTES: readonly AdminRoute[] = [...adminPages.map(item => item.key as AdminPageKey), 'ayarlar' as const].map(key => {
  const path = key === 'ayarlar' ? settingsLink.path : `/${key}`;
  return { path, pattern: path === ALIMLAR ? `${ALIMLAR}/:id?` : `${path}/*?`, Page: PAGES[key] };
});

/** Lazy parça gelene kadar: sayfanın kendi başlığı (aynı PageHeader) + aynı yerleşimde iskelet. */
function RouteFallback({ path }: { path: string }) {
  const device = useDevice();
  return (
    <>
      <PageHeader location={path} lead={adminLeads[path]} />
      <LoadingShell narrow={device === 'phone'} />
    </>
  );
}

/** Her nav yolu için bir rota (iç içe yollar dahil); bilinmeyen konum varsayılan sayfaya (replace) gider. */
export function AdminRoutes() {
  return (
    <Switch>
      {ROUTES.map(({ path, pattern, Page }) => (
        <Route key={path} path={pattern}>
          <Suspense fallback={<RouteFallback path={path} />}>
            <Page location={path} />
          </Suspense>
        </Route>
      ))}
      <Route>
        <Redirect to={defaultAdminPath} replace />
      </Route>
    </Switch>
  );
}
