import { test } from '@playwright/test';
import { mockApi, ROUTES } from './helpers';

// Yalnız gözle kontrol için: SNAP=1 ile çalışır, .tmp-shots/<proje>-<rota>.png yazar (repoya girmez).
test.skip(!process.env.SNAP, 'SNAP=1 ile çalıştırın');

for (const route of ROUTES) {
  test(`snap ${route}`, async ({ page }, info) => {
    await mockApi(page);
    await page.goto(`/${route}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `.tmp-shots/${info.project.name}-${route.replace('#/', '')}.png`, fullPage: false });
  });
}
