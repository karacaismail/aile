import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',testMatch:/(finance-dashboard|budget-dashboard|timeline-dashboard|family-dashboard|family-navigation-dashboard)\.spec\.ts/,fullyParallel:true,workers:3,retries:process.env.CI?1:0,
  reporter:[['list'],['html',{outputFolder:'playwright-report/dashboard',open:'never'}]],
  use:{baseURL:'http://127.0.0.1:5174/aile/',trace:'retain-on-failure',locale:'tr-TR',timezoneId:'Europe/Istanbul'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:320,height:740}}},{name:'firefox',use:{...devices['Desktop Firefox'],viewport:{width:1440,height:900}}},{name:'webkit',use:{...devices['Desktop Safari'],viewport:{width:390,height:844},hasTouch:true}}],
  webServer:{command:'pnpm dev',url:'http://127.0.0.1:5174/aile/',reuseExistingServer:!process.env.CI,timeout:60000,env:{VITE_BUDGET_SHEET_ID:'synthetic-budget-sheet-2098'}},
});
