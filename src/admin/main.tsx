import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installKeyboardMode } from '../dashboard/keyboard.ts';
import { App } from './App';
import './fonts.css';
import './admin.css';

installKeyboardMode();
// Parça hatası (yayından sonra silinen sayfa/geniş parça) kendiliğinden sayfa yenilemez: Vite'ın `vite:preloadError`
// olayı dinlenmez, hata yükleyiciye düşer. Rota sınırı ve lazyWide bir kez yeniden dener, sonra "Yeni sürüm var ·
// Yenile" gösterir; yenileme kullanıcının seçimidir (içe aktarılan nesil ve taslaklar korunur). Kural:
// adaptive/source-rules.test.ts; üretim kanıtı e2e/admin-production.spec.ts.
createRoot(document.getElementById('admin-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
