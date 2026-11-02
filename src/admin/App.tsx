import { useEffect, useState } from 'react';
import { Router, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { aileCssVars } from '../design/tokens.ts';
import { AntApp, ConfigProvider, trTR } from './ui/antd';
import { themeFor } from './theme/antdTheme';
import { DeviceProvider } from './device';
import { GenerationProvider } from './data';
import { WorkspaceShell } from './shell/WorkspaceShell';
import { AdminRoutes } from './routes';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(reducedMotionQuery).matches);
  useEffect(() => {
    const media = window.matchMedia(reducedMotionQuery);
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

function Workspace() {
  const [location] = useLocation();
  return (
    <WorkspaceShell location={location}>
      <AdminRoutes />
    </WorkspaceShell>
  );
}

export function App() {
  const reduced = useReducedMotion();
  return (
    // Tek token kökü: --aile-* değişkenleri burada; antd popup katmanları admin.css :root yedeklerini kullanır.
    <div className="aile-admin" style={aileCssVars}>
      <ConfigProvider theme={themeFor(reduced)} locale={trTR}>
        <AntApp>
          <DeviceProvider>
            {/* Nesil kaynağı varsayılanı HttpGenerationSource (/__aile/generation); klasör içe aktarma Veri sayfasından. */}
            <GenerationProvider>
              <Router hook={useHashLocation}>
                <Workspace />
              </Router>
            </GenerationProvider>
          </DeviceProvider>
        </AntApp>
      </ConfigProvider>
    </div>
  );
}
