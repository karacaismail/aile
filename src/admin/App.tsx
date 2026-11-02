import { Router, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { aileCssVars } from '../design/tokens.ts';
import { AdaptiveRoot } from './adaptive/AdaptiveRoot';
// Geçiş: PHONE_WITHOUT_ANTD=false iken antd sağlayıcıları her profilde statik bağlı (davranış değişmez). Bayrak
// çevrilince bu import wideResource('wide-providers', () => import('./adaptive/WideProviders')) olur.
import { WideProviders } from './adaptive/WideProviders';
import { GenerationProvider } from './data';
import { WorkspaceShell } from './shell/WorkspaceShell';
import { AdminRoutes } from './routes';

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
    // Tek token kökü: --aile-* değişkenleri burada; antd popup katmanları admin.css :root yedeklerini kullanır.
    // AdaptiveRoot profil/katman bağlamını verir, köke ve <html>'e data-profile / data-input-* yazar.
    <AdaptiveRoot className="aile-admin" style={aileCssVars} providers={WideProviders}>
      {/* Nesil kaynağı varsayılanı HttpGenerationSource (/__aile/generation); klasör içe aktarma Veri sayfasından. */}
      <GenerationProvider>
        <Router hook={useHashLocation}>
          <Workspace />
        </Router>
      </GenerationProvider>
    </AdaptiveRoot>
  );
}
