import { Router, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { aileCssVars } from '../design/tokens.ts';
import { AdaptiveRoot } from './adaptive/AdaptiveRoot';
import { GenerationProvider } from './data';
import { WorkspaceShell } from './shell/WorkspaceShell';
import { AdminRoutes } from './routes';

// antd sağlayıcısı (ConfigProvider + tr_TR + aile teması) uygulama ağacını hiçbir profilde sarmaz: profile göre eklenen
// bir sarmalayıcı ilk geniş geçişte bütün çalışma alanını yeniden kuruyordu (main, odak, açık katmanlar, taslaklar).
// Hiçbir ürün bileşeni antd kullanmaz; antd gerektiren geniş ada olursa lazyWide(…, { antd: true }) yalnız onu sarar.

function Workspace() {
  const [location] = useLocation();
  return (
    <WorkspaceShell location={location}>
      <AdminRoutes />
    </WorkspaceShell>
  );
}

export function App() {
  return (
    // Nesil kaynağı varsayılanı defaultGenerationSource(); klasör içe aktarma Veri sayfasından. Ağaç biçimi profile bağlı
    // değildir: telefon ↔ tablet ↔ masaüstü geçişinde yalnız bağlam değerleri değişir, hiçbir düğüm yeniden kurulmaz.
    <GenerationProvider>
      <Router hook={useHashLocation}>
        {/* Tek token kökü: --aile-* değişkenleri burada; portallanan katmanlar admin.css :root yedeklerini kullanır.
            AdaptiveRoot profil/katman bağlamını verir, köke ve <html>'e data-profile / data-input-* yazar; geniş modül
            yüklenirken köke data-wide-loading yazar (hazır sinyali). */}
        <AdaptiveRoot className="aile-admin" style={aileCssVars}>
          <Workspace />
        </AdaptiveRoot>
      </Router>
    </GenerationProvider>
  );
}
