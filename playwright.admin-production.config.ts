import { defineConfig, devices } from '@playwright/test';

// Yönetim girişinin üretim çıktısı kapısı: ana uygulamanın soğuk açılışı ve sw.js ön belleği yönetim
// parçalarını (admin/antd/pro/icons/echarts) içermez; admin.html kendi parçalarını yükler; /__aile dev-only.
// Önce `pnpm build`. Ayrı 5178 önizlemesi kullanıcının 5174/5175/5176 sunucularını yeniden başlatmaz.
// Yalnız Chrome/Safari ailesi (kullanıcı kararı 2026-10-31).
export default defineConfig({
  testDir: './e2e', testMatch: /admin-production\.spec\.ts$/, workers: 1, fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // e2e/admin-production.spec.ts bu bayrak olmadan kendini atlar (playwright.admin.config.ts de admin-*.spec.ts eşler).
  metadata: { adminProduction: true },
  outputDir: 'test-results/admin-production', reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5178/aile/', serviceWorkers: 'allow', trace: 'retain-on-failure', locale: 'tr-TR', timezoneId: 'Europe/Istanbul' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'pnpm preview --host 127.0.0.1 --port 5178 --strictPort', url: 'http://127.0.0.1:5178/aile/', reuseExistingServer: false },
});
