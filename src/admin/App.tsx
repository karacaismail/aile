import { Router, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { aileCssVars } from '../design/tokens.ts';
import { AdaptiveRoot } from './adaptive/AdaptiveRoot';
import { wideResource } from './adaptive/loader';
import { GenerationProvider } from './data';
import { WorkspaceShell } from './shell/WorkspaceShell';
import { AdminRoutes } from './routes';

// Geçiş kesimi (PHONE_WITHOUT_ANTD=true, plan D8): antd sağlayıcıları (ConfigProvider + App + tr_TR + aile teması)
// telefonun statik kapanışında değil. Kaynak yalnız geniş profilde (tablet/masaüstü) yüklenir; telefon hiç istemez.
const wideProviders = wideResource('wide-providers', () => import('./adaptive/WideProviders'));

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
    // Nesil kaynağı varsayılanı defaultGenerationSource(); klasör içe aktarma Veri sayfasından. Nesil sağlayıcısı ve
    // yönlendirici sağlayıcı geçidinin üstündedir: sağlayıcı geniş profilde ilk kez bağlanınca yalnız çalışma alanı bir
    // kez yeniden kurulur; seçilen nesil kaynağı, deposu ve konum korunur. İkisi de DOM çizmez (yalnız bağlam).
    <GenerationProvider>
      <Router hook={useHashLocation}>
        {/* Tek token kökü: --aile-* değişkenleri burada; antd popup katmanları admin.css :root yedeklerini kullanır.
            AdaptiveRoot profil/katman bağlamını verir, köke ve <html>'e data-profile / data-input-* yazar. */}
        <AdaptiveRoot className="aile-admin" style={aileCssVars} providers={wideProviders}>
          <Workspace />
        </AdaptiveRoot>
      </Router>
    </GenerationProvider>
  );
}
