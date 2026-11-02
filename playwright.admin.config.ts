import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Yönetim giriş noktası (admin.html) için ayrı kapı; sözleşme src/admin/playwright-admin-config.test.ts içinde.
// Paralel worktree kuralları (aynı makinede ~50 koşu):
//  - Port: AILE_PORT (varsayılan 5174). Her koşu kendi Vite sunucusunu 127.0.0.1:<AILE_PORT> üzerinde --strictPort ile
//    başlatır; reuseExistingServer her zaman false (başka worktree'nin sunucusunu kullanmak çapraz kirlenmedir; port
//    doluysa koşu açık hatayla durur). Üretim kapısı (playwright.admin-production.config.ts) AILE_PORT+1 kullanır;
//    bu yüzden yuvalar çift adımla verilir: 5300, 5302, 5304 …
//  - Veri: webServer yalnız sentetik nesli (fixtures/generation-synthetic) ve sentetik Sheet kimliğini görür.
//  - Çıktı: test-results/admin-<port> ve playwright-report/admin-<port>; aynı worktree'de iki port aynı anda koşabilir.
//  - Seçim: testMatch yalnız DOSYA ADINA bakar (Playwright onu tam yola uygular). Desen bilinçli olarak `admin-`
//    ile başlar (src/browser-matrix.test.ts kaynak kapısı); hemen ardından gelen geriye bakış, `admin-` öncesinde yol
//    ayırıcısı ya da dize başı ister. Böylece 'aw-admin-x/e2e/startup-production.spec.ts' veya
//    'superadmin-x.spec.ts' seçilmez.
// Projeler (yalnız Chrome/Safari ailesi, kullanıcı kararı 2026-10-31; emülasyon gerçek cihaz değildir):
//  - Görev koşusu: `--project chromium --project webkit` (320×568 dokunmatik Chromium + 390×844 dokunmatik WebKit).
//    chromium-desktop (1440×900) masaüstü kapılarına aittir ve tüm testleri koşar.
//  - Matris projeleri yalnız @matrix etiketli testleri koşar (başlıkta '@matrix' ya da `{ tag: '@matrix' }`) ve
//    entegrasyonda çalıştırılır: chromium-360, chromium-375, chromium-short (320×480), chromium-landscape (568×320,
//    telefon profili), webkit-tablet (820×1180), webkit-desktop (1440×900).

const DEFAULT_PORT = 5174;
const root = dirname(fileURLToPath(import.meta.url));

/** AILE_PORT'u doğrular; tanımsız/boşsa varsayılan. Geçersiz değer sessizce varsayılana düşmez. */
export function aileBasePort(raw: string | undefined = process.env.AILE_PORT, fallback = DEFAULT_PORT): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const port = Number(raw.trim());
  if (!/^\d+$/.test(raw.trim()) || port < 1024 || port > 65534) {
    throw new Error(`AILE_PORT geçersiz: "${raw}" (1024–65534 arası tam sayı olmalı; üretim kapısı AILE_PORT+1 kullanır)`);
  }
  return port;
}

/** webServer ortamı: yalnız sentetik veri (gerçek nesil ve .env.local değerleri bu koşuya girmez). */
export const syntheticServerEnv = {
  VITE_BUDGET_SHEET_ID: 'synthetic-budget-sheet-2098',
  AILE_GENERATION_DIR: join(root, 'fixtures', 'generation-synthetic'),
  // Emeklilik planı: yalnız sentetik profil (kişisel profil Git dışındadır).
  AILE_EMEKLILIK_PROFILE: join(root, 'fixtures', 'emeklilik', 'profil-sentetik.json'),
};

const port = aileBasePort();
const origin = `http://127.0.0.1:${port}`;
const touch = { hasTouch: true };
const chrome = devices['Desktop Chrome'];
const safari = devices['Desktop Safari'];
const MATRIX = /@matrix/;

export default defineConfig({
  testDir: './e2e',
  testMatch: /admin-(?<=(?:^|[\\/])admin-)[^\\/]*\.spec\.ts$/,
  fullyParallel: true,
  workers: 3,
  retries: process.env.CI ? 1 : 0,
  outputDir: `test-results/admin-${port}`,
  reporter: [['list'], ['html', { outputFolder: `playwright-report/admin-${port}`, open: 'never' }]],
  use: { baseURL: `${origin}/aile/`, trace: 'retain-on-failure', locale: 'tr-TR', timezoneId: 'Europe/Istanbul' },
  projects: [
    { name: 'chromium', use: { ...chrome, viewport: { width: 320, height: 568 }, ...touch } },
    { name: 'webkit', use: { ...safari, viewport: { width: 390, height: 844 }, ...touch } },
    { name: 'chromium-desktop', use: { ...chrome, viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-360', grep: MATRIX, use: { ...chrome, viewport: { width: 360, height: 640 }, ...touch } },
    { name: 'chromium-375', grep: MATRIX, use: { ...chrome, viewport: { width: 375, height: 667 }, ...touch } },
    { name: 'chromium-short', grep: MATRIX, use: { ...chrome, viewport: { width: 320, height: 480 }, ...touch } },
    { name: 'chromium-landscape', grep: MATRIX, use: { ...chrome, viewport: { width: 568, height: 320 }, ...touch } },
    { name: 'webkit-tablet', grep: MATRIX, use: { ...safari, viewport: { width: 820, height: 1180 }, ...touch } },
    { name: 'webkit-desktop', grep: MATRIX, use: { ...safari, viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    name: `admin-dev:${port}`,
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: root,
    url: `${origin}/aile/`,
    reuseExistingServer: false,
    timeout: 60_000,
    // Vite'nin "Local: http://127.0.0.1:<port>/aile/" satırı rapora düşer: hangi koşunun hangi sunucuyu kullandığının kanıtı.
    stdout: 'pipe',
    env: syntheticServerEnv,
  },
});
