import { defineConfig, devices } from '@playwright/test';
// Yönetim giriş noktası (admin.html) için ayrı kapı. testMatch tam yola uygulanır: [^\\/]* deseni dosya adında tutar,
// yoksa 'admin-panel-plan' gibi bir klasör bütün e2e/*.spec.ts dosyalarını seçer (src/admin/playwright-admin-config.test.ts).
// Chrome/Safari ailesi (kullanıcı kararı 2026-10-31): dar Chromium, masaüstü Chromium, dokunmatik WebKit.
export default defineConfig({
  testDir:'./e2e',testMatch:/admin-[^\\/]*\.spec\.ts$/,fullyParallel:true,workers:3,retries:process.env.CI?1:0,
  reporter:[['list'],['html',{outputFolder:'playwright-report/admin',open:'never'}]],
  use:{baseURL:'http://127.0.0.1:5174/aile/',trace:'retain-on-failure',locale:'tr-TR',timezoneId:'Europe/Istanbul'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:320,height:740}}},{name:'chromium-desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}},{name:'webkit',use:{...devices['Desktop Safari'],viewport:{width:390,height:844},hasTouch:true}}],
  webServer:{command:'pnpm dev',url:'http://127.0.0.1:5174/aile/',reuseExistingServer:!process.env.CI,timeout:60000,env:{VITE_BUDGET_SHEET_ID:'synthetic-budget-sheet-2098'}},
});
