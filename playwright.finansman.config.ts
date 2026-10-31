import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: /(?:finansman|timeline)-dashboard\.spec\.ts$/, workers: 3,
  metadata: { financeProduction: true },
  outputDir: 'test-results/finansman-production', reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5181/aile/', locale: 'tr-TR', timezoneId: 'Europe/Istanbul', trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 740 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 320, height: 740 }, hasTouch: true } },
  ],
  // Build first. This process never restarts the user's development server.
  webServer: { command: 'pnpm preview --host 127.0.0.1 --port 5181 --strictPort', url: 'http://127.0.0.1:5181/aile/', reuseExistingServer: false },
});
