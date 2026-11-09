import type { Page } from '@playwright/test';
import { syntheticSheets, gviz } from '../src/dashboard/fixtures';
import { syntheticBridgeResponse, syntheticBridgeMetadata, syntheticBridgeInflows } from '../src/dashboard/bridgeFixtures';
import { syntheticFinance, financeWireResponseTable } from '../src/finance/fixtures';
import { feedName } from './webFeed';

export async function visualizationSource(page: Page, large = false, longPeriod = false) {
  const source = syntheticFinance(), raw = syntheticSheets();
  if (longPeriod) {
    const original = structuredClone(raw);
    raw.summary = Array.from({ length: 14 }, (_, index) => {
      const row = [...original.summary[Math.min(index, 2)]];
      row[0] = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(2098, 10 + index, 1));
      row[10] = row[11] = (index + 1) * 4000 - (index ? 500 : 0);
      return row;
    });
    for (const key of ['plan', 'actual'] as const) raw[key] = original[key].map(row => [row[0], ...Array.from({ length: 14 }, (_, index) => row[Math.min(index + 1, 3)])]);
    source.daily.rows = []; source.monthly.rows = [];
    for (let index = 0; index < 26; index++) {
      const month = new Date(Date.UTC(2098, 10 + index, 1)).toISOString().slice(0, 7), cash = 500 + index * 100, debt = 155 + index * 50;
      source.daily.rows.push([`${month}-28`, 'Sentetik ay sonu', 'Kontrol', index ? 100 : 500, cash, cash, 0, 0, debt, 0, 0, 0, 0, debt, 0, 'Koşullu hesap', 'Sentetik uzun dönem', `synthetic-26-${index}`]);
      source.monthly.rows.push([month, cash, 0, 0, debt, 0, 600, cash + 600 - debt, 0]);
    }
    source.metadata.rows[3] = ['26']; source.metadata.rows[4] = ['26'];
  }
  if (large) raw.summary.forEach(row => { row[10] = 1234567.89; row[11] = 1234567.89; });
  await page.context().route('**/gviz/tq?*', async route => {
    const url = new URL(route.request().url());
    if (feedName(url) === '_Finans web') {
      const wire = financeWireResponseTable(url.href, source);
      return route.fulfill({ contentType: 'application/json', body: gviz(wire.rows, wire.labels) });
    }
    if (longPeriod && feedName(url) === '_Finans aylık') {
      const rows = raw.summary.map((_, index) => [new Date(Date.UTC(2098, 10 + index, 1)).toISOString().slice(0, 7), ...(syntheticBridgeInflows().rows[index]?.slice(1) ?? [0, 0])]);
      const metadata = syntheticBridgeMetadata(); metadata[6] = [String(rows.length)];
      return route.fulfill({ contentType: 'application/json', body: url.searchParams.get('range') === 'A10:C36' ? gviz(rows, syntheticBridgeInflows().labels) : gviz(metadata) });
    }
    const bridge = syntheticBridgeResponse(url.href);
    if (bridge) return route.fulfill({ contentType: 'application/json', body: bridge });
    const map = { Pano: 'summary', Plan: 'plan', Gerçekleşen: 'actual', 'Düzensiz giderler': 'irregular' } as const;
    const key = map[feedName(url) as keyof typeof map];
    if (!key) return route.fulfill({ status: 404 });
    const rows = key === 'plan' || key === 'actual' ? raw[key].map(row => row.slice(0, raw.summary.length + 1)) : raw[key];
    return route.fulfill({ contentType: 'application/json', body: gviz(rows, key === 'plan' || key === 'actual' ? ['Kalem', ...raw.summary.map(row => String(row[0]))] : undefined) });
  });
  return source;
}
