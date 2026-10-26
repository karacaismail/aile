import { test } from '@playwright/test';
import { mockApi, ROUTES } from './helpers';
import lighting from './fixtures/lighting.json' with { type: 'json' };
import renovation from './fixtures/renovation.json' with { type: 'json' };
import layout from './fixtures/layout.json' with { type: 'json' };

// Yalnız gözle kontrol için: SNAP=1 ile çalışır, .tmp-shots/<proje>-<rota>.png yazar (repoya girmez).
test.skip(!process.env.SNAP, 'SNAP=1 ile çalıştırın');

type Snap = { route: string; name: string; data?: unknown };
const SNAPS: Snap[] = [
  ...ROUTES.map((route) => ({ route, name: route.replace('#/', '') })),
  { route: '#/aydinlatma/salon', name: 'aydinlatma-oda', data: lighting },
  { route: '#/aydinlatma', name: 'aydinlatma-odalar', data: lighting },
  { route: '#/tadilat/isler', name: 'tadilat-isler', data: renovation },
  { route: '#/tadilat/ustalar', name: 'tadilat-ustalar', data: renovation },
  { route: '#/tadilat/kontrol', name: 'tadilat-kontrol', data: renovation },
  { route: '#/yerlesim/salon', name: 'yerlesim-oda', data: layout },
];

for (const s of SNAPS) {
  test(`snap ${s.name}`, async ({ page }, info) => {
    await mockApi(page, s.data as Parameters<typeof mockApi>[1]);
    await page.goto(`/${s.route}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `.tmp-shots/${info.project.name}-${s.name}.png`, fullPage: false });
  });
}
