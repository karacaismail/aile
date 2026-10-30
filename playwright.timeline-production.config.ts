import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: /(?:timeline|startup)-production\.spec\.ts$/, workers: 1,
  outputDir: 'test-results/timeline-production',
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5177/aile/', serviceWorkers: 'allow', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testMatch: 'startup-production.spec.ts', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: 'startup-production.spec.ts', use: { ...devices['Desktop Safari'] } },
  ],
  // Build first. This isolated preview does not restart the user's 5176 preview.
  webServer: { command: 'pnpm preview --host 127.0.0.1 --port 5177 --strictPort', url: 'http://127.0.0.1:5177/aile/', reuseExistingServer: false },
});
