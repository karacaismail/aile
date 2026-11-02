import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gviz } from '../../dashboard/fixtures';
import { syntheticCurrentSheets } from '../../dashboard/currentFixtures';
import { syntheticBridgeInflows, syntheticBridgeMetadata } from '../../dashboard/bridgeFixtures';
import type { Item } from '@shared/schema';
import type { PartitionEnvelope, PurchaseNeedRecord } from './types';

vi.hoisted(() => vi.stubEnv('VITE_BUDGET_SHEET_ID', 'synthetic-budget-sheet-2098'));
import { fetchBudget } from '../../dashboard/data';
import { ConfigError, describeLiveError, diffLiveRecords, liveAppRecords, liveBudget, toBudgetViewModel } from './live';

afterEach(() => vi.unstubAllGlobals());

const DECIMAL = /^-?[0-9]+\.[0-9]{2}$/;
const API = 'https://script.google.com/macros/s/synthetic/exec';

/** Aynı sentetik GViz kaynağı; fetchBudget.test.ts'teki mock ile birebir (gerçek ağ yok). */
function mockBudgetSource() {
  const source = syntheticCurrentSheets();
  const map = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', Kasa: 'cash', 'Arızi Giderler': 'irregular' } as const;
  const fetcher = vi.fn(async (input: URL) => {
    const sheet = input.searchParams.get('sheet')!;
    if (sheet === '_Finans aylık') {
      if (input.searchParams.get('range') === 'A10:C36') { const inflows = syntheticBridgeInflows(); return new Response(gviz(inflows.rows, inflows.labels)); }
      return new Response(gviz(syntheticBridgeMetadata()));
    }
    const key = map[sheet as keyof typeof map];
    if (!key) throw new Error('Unexpected source');
    return new Response(key === 'irregular' ? gviz(source.irregular.slice(1), source.irregular[0].map(String)) : gviz(source[key]));
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function syntheticNeeds(): PurchaseNeedRecord[] {
  // jsdom ortamında import.meta.url file: değildir; Vitest kökü proje dizinidir.
  const root = resolve(process.cwd(), 'fixtures/generation-synthetic');
  const [generation] = readdirSync(root).filter(name => /^[a-f0-9]{64}$/.test(name));
  const envelope = JSON.parse(readFileSync(resolve(root, generation, 'data/purchase_needs/household/00000.json'), 'utf8')) as PartitionEnvelope<PurchaseNeedRecord>;
  expect(envelope.collection).toBe('purchase_needs');
  return envelope.records;
}

describe('liveBudget', () => {
  it('fetchBudget sonucunu plan ve gerçek ayrı, period anahtarlı Bütçe görünümüne çevirir', async () => {
    const fetcher = mockBudgetSource();
    const expected = await fetchBudget(new AbortController().signal);
    const result = await liveBudget({ now: () => new Date('2026-10-28T11:05:00.000Z') });
    expect(fetcher).toHaveBeenCalled();
    if (!result.ok) throw new Error(result.message);
    const { budget } = result;
    expect(budget.readAt).toBe('2026-10-28T11:05:00.000Z');
    expect(budget.periods).toEqual(expected.months.map(m => m.key));
    expect(budget.periods.every(p => /^\d{4}-(0[1-9]|1[0-2])$/.test(p))).toBe(true);
    expect([...budget.periods].sort()).toEqual(budget.periods);
    const first = budget.months[0];
    expect(first.period).toBe(expected.months[0].key);
    expect(first.planned.income).toEqual({ amount: expected.months[0].income.plan.toFixed(2), currency: 'TRY' });
    expect(first.actual.income).toEqual({ amount: expected.months[0].income.current.toFixed(2), currency: 'TRY' });
    expect(first.planned.income).not.toBe(first.actual.income);
    for (const month of budget.months) for (const side of [month.planned, month.actual]) for (const money of Object.values(side)) expect(money?.amount).toMatch(DECIMAL);
    expect(Object.keys(first)).not.toContain('total');
    const category = budget.categories[0];
    const source = expected.categories[0];
    expect(category.id).toBe(source.id);
    expect(Object.keys(category.planned)).toEqual(budget.periods);
    expect(Object.keys(category.actual)).toEqual(budget.periods);
    budget.periods.forEach((period, i) => {
      const plan = source.plan[i], current = source.current[i];
      expect(category.planned[period]).toEqual(plan === null ? null : { amount: plan.toFixed(2), currency: 'TRY' });
      expect(category.actual[period]).toEqual(current === null ? null : { amount: current.toFixed(2), currency: 'TRY' });
    });
    expect(budget.groups.map(g => g.label)).toEqual(expected.groups.map(g => g.label));
  });

  it('düzensiz giderlerde ay etiketi period olur; bilinmeyen ay null, eksik tutar null (sıfır değil)', async () => {
    mockBudgetSource();
    const budget = toBudgetViewModel(await fetchBudget(new AbortController().signal), '2026-10-28T11:05:00.000Z');
    const planned = budget.irregular.find(r => r.id === 'TEST-1')!;
    expect(planned.planned).toEqual({ period: '2098-12', amount: { amount: '500.00', currency: 'TRY' } });
    expect(planned.actual).toEqual({ period: '2098-12', amount: { amount: '500.00', currency: 'TRY' } });
    const pending = budget.irregular.find(r => r.id === 'TEST-2')!;
    expect(pending.planned.amount).toBeNull();
    expect(pending.actual.amount).toBeNull();
    expect(toBudgetViewModel({ months: [], categories: [], groups: [], irregular: [{ id: 'x', label: 'x', type: '', planMonth: 'Bilinmeyen 2099', month: '', plan: 1, current: null, status: '', room: '', note: '', manual: false }] }, 'now').irregular[0]).toMatchObject({ planned: { period: null, amount: { amount: '1.00', currency: 'TRY' } }, actual: { period: null, amount: null } });
  });

  it('bütünlük hatası BudgetIntegrityError metniyle, "Hata: " öneki ile döner', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>not gviz</html>')));
    const result = await liveBudget();
    expect(result).toEqual({ ok: false, kind: 'integrity', message: 'Hata: Google Sheets yanıtı okunamadı. Paylaşım erişimini kontrol edin.' });
  });

  it('ağ hatası network olarak sınıflanır; iptal aborted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await liveBudget()).toMatchObject({ ok: false, kind: 'network', message: expect.stringMatching(/^Hata: /) });
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init: RequestInit) => { if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError'); return new Response(''); }));
    expect(await liveBudget({ signal: controller.signal })).toMatchObject({ ok: false, kind: 'aborted' });
  });
});

describe('liveAppRecords', () => {
  const readFull = { ok: true, fingerprint: 'fp-1', serverTime: '2026-10-28T11:00:00.000Z', schemaVersion: 3, items: [{ id: 'kalem-010', tip: 'satinalma', ad: 'Örnek tencere', version: 4 }], settings: [{ id: 's1', tip: 'oda', anahtar: 'oda_3', etiket: 'Salon' }] };
  const mockApi = (body: unknown) => vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })) as unknown as typeof fetch;

  it('anahtar yoksa ConfigError; ağa çıkılmaz', async () => {
    const fetchImpl = mockApi(readFull);
    await expect(liveAppRecords(API, undefined, { fetchImpl })).rejects.toBeInstanceOf(ConfigError);
    await expect(liveAppRecords(API, '  ', { fetchImpl })).rejects.toBeInstanceOf(ConfigError);
    await expect(liveAppRecords('', 'anahtar', { fetchImpl })).rejects.toBeInstanceOf(ConfigError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('read isteği anahtarla gider; items/settings/cash sürüm bilgisiyle döner; cash yoksa desteklenmiyor', async () => {
    const fetchImpl = mockApi(readFull);
    const result = await liveAppRecords(API, 'anahtar', { fetchImpl });
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe(API);
    expect(JSON.parse(init.body as string)).toEqual({ action: 'read', key: 'anahtar' });
    expect(result.version).toEqual({ fingerprint: 'fp-1', serverTime: '2026-10-28T11:00:00.000Z', schemaVersion: 3 });
    expect(result.items).toHaveLength(1);
    expect(result.settings).toHaveLength(1);
    expect(result.cash).toEqual([]);
    expect(result.cashSupported).toBe(false);
    const withCash = await liveAppRecords(API, 'anahtar', { fetchImpl: mockApi({ ...readFull, cash: [{ id: 'c1', tarih: '2026-10-01', tutar: 100, kalem: 'x' }] }) });
    expect(withCash.cashSupported).toBe(true);
    expect(withCash.cash).toHaveLength(1);
  });

  it('notModified yanıtı tam okuma beklenirken hata; API hatası "Hata: " metniyle açıklanır', async () => {
    await expect(liveAppRecords(API, 'anahtar', { fetchImpl: mockApi({ ok: true, notModified: true, fingerprint: 'fp', serverTime: 't', schemaVersion: 3 }) })).rejects.toThrow(/^Hata: /);
    const failure = await liveAppRecords(API, 'anahtar', { fetchImpl: mockApi({ ok: false, error: 'unauthorized', message: 'Anahtar geçersiz' }) }).catch(e => e);
    expect(describeLiveError(failure)).toBe('Hata: Anahtar geçersiz');
    expect(describeLiveError(new ConfigError('Uygulama anahtarı ayarlanmamış.'))).toBe('Hata: Uygulama anahtarı ayarlanmamış.');
    expect(describeLiveError('x')).toMatch(/^Hata: /);
  });
});

describe('diffLiveRecords', () => {
  it('source_record_id ile eşler; yalnız değişen alanlar listelenir; tek taraflı kayıtlar ayrı durumdadır', () => {
    const needs = syntheticNeeds();
    const target = needs.find(n => n.source_record_id === 'kalem-010')!;
    const same = needs.find(n => n.source_record_id === 'kalem-027')!;
    const items: Item[] = [
      { ...(target.source_attributes as unknown as Item), durum: 'siparis', gercek_tl: 36600, version: 7, updated_at: '2026-10-28T10:00:00.000Z', updated_by: 'cihaz-a' },
      { ...(same.source_attributes as unknown as Item), version: 1, updated_at: '2026-10-01T00:00:00.000Z' },
      { id: 'kalem-999', tip: 'satinalma', ad: 'Yeni kayıt', version: 1 },
    ];
    const diff = diffLiveRecords(items, needs);
    expect(diff.matched).toBe(2);
    expect(diff.unchanged).toBe(1);
    const changed = diff.entries.find(e => e.sourceRecordId === 'kalem-010')!;
    expect(changed).toMatchObject({ status: 'changed', recordId: target.id, label: target.label, liveVersion: 7, liveUpdatedAt: '2026-10-28T10:00:00.000Z' });
    expect(changed.changes).toContainEqual({ field: 'durum', generation: 'karar', live: 'siparis' });
    expect(changed.changes.map(c => c.field)).not.toContain('ad');
    expect(changed.changes.map(c => c.field)).not.toContain('version');
    expect(changed.changes.map(c => c.field)).not.toContain('updated_at');
    // gercek_tl nesilde amounts.actual olarak var (36600.00) → fark değil.
    expect(changed.changes.map(c => c.field)).not.toContain('gercek_tl');
    expect(diff.entries.find(e => e.sourceRecordId === 'kalem-027')).toBeUndefined();
    expect(diff.entries.find(e => e.sourceRecordId === 'kalem-999')).toMatchObject({ status: 'live_only', recordId: null, label: 'Yeni kayıt', changes: [] });
    const generationOnly = diff.entries.filter(e => e.status === 'generation_only');
    expect(generationOnly).toHaveLength(needs.length - 2);
    expect(generationOnly[0].recordId).not.toBeNull();
  });

  it('sayısal eşitlik ve boş değerler: "700" ile 700 fark değildir, undefined ile null fark değildir, silinme farkı görünür', () => {
    const base: PurchaseNeedRecord = {
      id: 'r1', tenant_id: 't', kind: 'purchase_need', label: 'x', source_record_id: 'k1',
      source_attributes: { id: 'k1', tip: 'satinalma', ad: 'x', tahmini_tl_min: '700', not: '' },
      category_term_id: null, phase_term_id: null, context_term_ids: [], state_snapshot: { decision: null, fulfillment: null, inspection: null, payment: null }, state_term_ids: { decision: null, fulfillment: null, inspection: null, payment: null },
      amounts: {}, dates: {}, room_id: null, deleted_at: null,
    };
    expect(diffLiveRecords([{ id: 'k1', tip: 'satinalma', ad: 'x', tahmini_tl_min: 700 }], [base]).entries).toEqual([]);
    const deleted = diffLiveRecords([{ id: 'k1', tip: 'satinalma', ad: 'x', tahmini_tl_min: 700, deleted_at: '2026-10-28T00:00:00.000Z' }], [base]);
    expect(deleted.entries[0].changes).toEqual([{ field: 'deleted_at', generation: null, live: '2026-10-28T00:00:00.000Z' }]);
  });
});
