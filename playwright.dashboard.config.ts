import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',testMatch:/(visualization-dashboard|financial-journey-dashboard|finance-dashboard|finansman-dashboard|budget-dashboard|timeline-dashboard|timeline-separation-dashboard|family-dashboard|family-navigation-dashboard|clearspace-dashboard)\.spec\.ts/,fullyParallel:true,workers:3,retries:process.env.CI?1:0,
  reporter:[['list'],['html',{outputFolder:'playwright-report/dashboard',open:'never'}]],
  use:{baseURL:'http://127.0.0.1:5179/aile/',trace:'retain-on-failure',locale:'tr-TR',timezoneId:'Europe/Istanbul',serviceWorkers:'block'},
  // Chrome/Safari family only (user decision 2026-10-31): narrow Chromium, desktop Chromium, touch WebKit.
  projects:[{name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:320,height:740}}},{name:'chromium-desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}},{name:'webkit',use:{...devices['Desktop Safari'],viewport:{width:390,height:844},hasTouch:true}}],
  // Serve the production bundle: the dev server sends 220 uncached modules (16 MB) to every fresh test context and
  // one page load then outlasts the 5 s expect timeout under CI load. Own folder and port: never touches dist or 5174.
  webServer:{command:'pnpm exec vite build --outDir dist-dashboard-e2e --emptyOutDir && pnpm exec vite preview --outDir dist-dashboard-e2e --host 127.0.0.1 --port 5179 --strictPort',url:'http://127.0.0.1:5179/aile/',reuseExistingServer:false,timeout:60000,env:{VITE_BUDGET_SHEET_ID:'synthetic-budget-sheet-2098'}},
});
