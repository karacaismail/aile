import type { Page } from '@playwright/test';
import { syntheticSheets, gviz } from '../src/dashboard/fixtures';
import { syntheticBridgeResponse } from '../src/dashboard/bridgeFixtures';
import { syntheticFinance, financeWireResponseTable } from '../src/finance/fixtures';

export async function visualizationSource(page: Page, large = false) {
  const source = syntheticFinance(), raw = syntheticSheets();
  if (large) raw.summary.forEach(row => { row[10] = 1234567.89; row[11] = 1234567.89; });
  await page.context().route('**/gviz/tq?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('sheet') === '_Finans web') {
      const wire = financeWireResponseTable(url.href, source);
      return route.fulfill({ contentType: 'application/json', body: gviz(wire.rows, wire.labels) });
    }
    const bridge = syntheticBridgeResponse(url.href);
    if (bridge) return route.fulfill({ contentType: 'application/json', body: bridge });
    const map = { Pano: 'summary', Plan: 'plan', Gerçekleşen: 'actual', 'Düzensiz giderler': 'irregular' } as const;
    const key = map[url.searchParams.get('sheet') as keyof typeof map];
    if (!key) return route.fulfill({ status: 404 });
    const rows = key === 'plan' || key === 'actual' ? raw[key].map(row => row.slice(0, 4)) : raw[key];
    return route.fulfill({ contentType: 'application/json', body: gviz(rows, key === 'plan' || key === 'actual' ? ['Kalem', ...raw.summary.map(row => String(row[0]))] : undefined) });
  });
  return source;
}
