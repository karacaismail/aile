import { defineConfig, devices } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aileBasePort, syntheticServerEnv } from './playwright.admin.config';

// Yönetim girişinin üretim çıktısı kapısı: ana uygulamanın soğuk açılışı ve sw.js ön belleği yönetim
// parçalarını (admin/antd/pro/icons/echarts) içermez; admin.html kendi parçalarını yükler; /__aile dev-only.
// Önce `pnpm build`. Port: AILE_PORT+1 (dev kapısı AILE_PORT'u kullanır; yuvalar çift adımla verilir). AILE_PORT
// yoksa ayrı 5178 önizlemesi; kullanıcının 5174/5175/5176 sunucularına dokunulmaz, reuseExistingServer her zaman false.
// AILE_GENERATION_DIR bilerek sentetik nesle ayarlıdır: önizleme bu klasörü de servis etmemeli (404 beklentisi güçlenir).
// Yalnız Chrome/Safari ailesi (kullanıcı kararı 2026-10-31). Sözleşme: src/admin/playwright-admin-config.test.ts.
const PREVIEW_FALLBACK_PORT = 5178;
const port = process.env.AILE_PORT?.trim() ? aileBasePort() + 1 : PREVIEW_FALLBACK_PORT;
const origin = `http://127.0.0.1:${port}`;
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e', testMatch: /(?:^|[\\/])admin-production\.spec\.ts$/, workers: 1, fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // e2e/admin-production.spec.ts bu bayrak olmadan kendini atlar (playwright.admin.config.ts de admin-*.spec.ts eşler).
  metadata: { adminProduction: true },
  outputDir: `test-results/admin-production-${port}`, reporter: [['list']],
  use: { baseURL: `${origin}/aile/`, serviceWorkers: 'allow', trace: 'retain-on-failure', locale: 'tr-TR', timezoneId: 'Europe/Istanbul' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
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
