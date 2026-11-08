import type { Page } from '@playwright/test';
import { syntheticBridgeResponse } from '../src/dashboard/bridgeFixtures';
import { gviz, syntheticSheets } from '../src/dashboard/fixtures';
import { financeWireResponseTable } from '../src/finance/fixtures';
import { mockApi } from './helpers';

/** Every family route on synthetic data: Apps Script API, budget sheets and the finance wire. */
export const familyRoutes = [
  '/pano', '/timeline', '/finansman', '/butce', '/ev', '/satinalma', '/aydinlatma', '/yerlesim',
  '/tadilat', '/tadilat/isler', '/tadilat/ustalar', '/tadilat/kontrol', '/arac', '/ayarlar',
] as const;

export async function mockFamilyRoutes(page: Page) {
  await mockApi(page);
  const raw = syntheticSheets();
  const map = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', 'Düzensiz giderler': 'irregular' } as const;
  await page.route('**/gviz/tq?*', route => {
    const sheet = new URL(route.request().url()).searchParams.get('sheet')!;
    if (sheet === '_Finans web') {
      const wire = financeWireResponseTable(route.request().url());
      return route.fulfill({ contentType: 'application/json', body: gviz(wire.rows, wire.labels) });
    }
    const bridge = syntheticBridgeResponse(route.request().url());
    if (bridge) return route.fulfill({ contentType: 'application/json', body: bridge });
    const key = map[sheet as keyof typeof map];
    if (!key) return route.fulfill({ status: 404, body: 'Unknown sheet' });
    const grid = key === 'plan' || key === 'actual';
    return route.fulfill({ contentType: 'application/json', body: gviz(grid ? raw[key].map(row => row.slice(0, 4)) : raw[key], grid ? ['Kalem', ...raw.summary.map(row => String(row[0]))] : undefined) });
  });
}
