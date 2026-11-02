import { defineConfig, devices } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aileBasePort, syntheticServerEnv } from './playwright.admin.config';

// Yönetim girişinin üretim çıktısı kapısı (e2e/admin-production.spec.ts): soğuk bağlamda ağ yalıtımı (telefon antd/pro/
// icons/echarts/wide istemez; yatay telefon wide istemez; büyütmede wide bir kez; geniş profilde ECharts yalnız grafik
// görünür alana girince), ana uygulamanın sw.js ön belleği yönetim parçalarını içermez, /__aile dev-only.
// Önce `pnpm build` (dist/.vite/manifest.json + delivery-graph.json). Port: AILE_PORT+1 (dev kapısı AILE_PORT'u kullanır;
// yuvalar çift adımla verilir). AILE_PORT yoksa ayrı 5178 önizlemesi; kullanıcının 5174/5175/5176 sunucularına
// dokunulmaz, reuseExistingServer her zaman false.
// AILE_GENERATION_DIR bilerek sentetik nesle ayarlıdır: önizleme bu klasörü de servis etmemeli (404 beklentisi güçlenir);
// testler sentetik nesli context.route ile verir.
// Projeler dev kapısıyla aynı telefon öncelikli profillerdir (chromium 320×568, webkit 390×844, dokunmatik); yatay telefon
// ve 1440 senaryoları kendi görünüm alanlarını test içinde kurar ve @matrix etiketlidir. Yalnız Chrome/Safari ailesi
// (kullanıcı kararı 2026-10-31). Her test kendi soğuk bağlamını alır; testler bu yüzden paralel koşabilir.
// Sözleşme: src/admin/playwright-admin-config.test.ts.
const PREVIEW_FALLBACK_PORT = 5178;
const port = process.env.AILE_PORT?.trim() ? aileBasePort() + 1 : PREVIEW_FALLBACK_PORT;
const origin = `http://127.0.0.1:${port}`;
const root = dirname(fileURLToPath(import.meta.url));
const touch = { hasTouch: true };

export default defineConfig({
  testDir: './e2e', testMatch: /(?:^|[\\/])admin-production\.spec\.ts$/, workers: 2, fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  // Yüklü makinede (paralel worktree koşuları) üst sınır; sabit bekleme değildir.
  timeout: 60_000,
  // e2e/admin-production.spec.ts bu bayrak olmadan kendini atlar (playwright.admin.config.ts de admin-*.spec.ts eşler).
  metadata: { adminProduction: true },
  outputDir: `test-results/admin-production-${port}`, reporter: [['list']],
  use: { baseURL: `${origin}/aile/`, serviceWorkers: 'allow', trace: 'retain-on-failure', locale: 'tr-TR', timezoneId: 'Europe/Istanbul' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 }, ...touch } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 390, height: 844 }, ...touch } },
  ],
  webServer: {
    name: `admin-preview:${port}`,
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: root,
    url: `${origin}/aile/`,
    reuseExistingServer: false,
    stdout: 'pipe',
    env: syntheticServerEnv,
  },
});
