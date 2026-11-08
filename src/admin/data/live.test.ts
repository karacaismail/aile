import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { del, get, set } from 'idb-keyval';
// data-platform üretici kuralı (Node ESM): canlı tutarın nesildeki tutarla aynı metne çevrildiği bununla sınanır.
import { decimal as platformDecimal } from '../../../data-platform/core.mjs';
import { sumMoney } from './actuals';
import { gviz } from '../../dashboard/fixtures';
import { syntheticCurrentSheets } from '../../dashboard/currentFixtures';
import { syntheticBridgeInflows, syntheticBridgeMetadata } from '../../dashboard/bridgeFixtures';
import type { Budget } from '../../dashboard/data';
import { BudgetIntegrityError } from '../../dashboard/integrity';
import type { Item } from '@shared/schema';
import type { PartitionEnvelope, PurchaseNeedRecord } from './types';

vi.hoisted(() => vi.stubEnv('VITE_BUDGET_SHEET_ID', 'synthetic-budget-sheet-2098'));
// IndexedDB jsdom'da yok; idb-keyval sahte. Diğer testler bellek önbelleği ya da önbelleksiz (cache: null) çalışır.
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));
import { fetchBudget, sheetId } from '../../dashboard/data';
import {
  ConfigError,
  LIVE_BUDGET_CACHE_KEY,
  clearLiveBudgetCache,
  liveAmount,
  LIVE_FAILURE_TITLE,
  createIdbLiveBudgetCache,
  createMemoryLiveBudgetCache,
  describeLiveError,
  diffLiveRecords,
  lastGoodBudget,
  lastReadAtOf,
  liveAppRecords,
  liveBudget,
  parseTurkishDecimal,
  parseTurkishMoney,
  retryDelay,
  toBudgetViewModel,
  type LiveBudgetCache,
  type LiveBudgetOptions,
} from './live';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.mocked(get).mockReset();
  vi.mocked(set).mockReset();
  vi.mocked(del).mockReset();
});

/** Canlı tutar: yuvarlanmamış ondalık metin, en az iki ondalık (data-platform decimal() + kuruş dolgusu). */
const DECIMAL = /^-?[0-9]+\.[0-9]{2,}$/;
const API = 'https://script.google.com/macros/s/synthetic/exec';
/** Gerçek zamanlayıcılarla hızlı politika: ağa çıkılmaz, bekleme milisaniye düzeyinde. */
const FAST = { timeoutMs: 40, retry: { baseDelayMs: 1, maxDelayMs: 2 }, cache: null } satisfies LiveBudgetOptions;

/** Aynı sentetik GViz kaynağı; fetchBudget.test.ts'teki mock ile birebir (gerçek ağ yok). */
function mockBudgetSource(mutate?: (source: ReturnType<typeof syntheticCurrentSheets>) => void) {
  const source = syntheticCurrentSheets();
  mutate?.(source);
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

const pair = (value: number) => ({ plan: value, current: value });
/** fetchBudgetImpl için asgari geçerli Budget (sentetik). */
function budgetFixture(): Budget {
  return {
    months: [{ label: 'Kasım 2098', key: '2098-11', source: 'Plandan', income: pair(10000), expense: pair(4000), saving: pair(2000), free: pair(4000), balance: pair(4000) }],
    categories: [],
    groups: [],
    irregular: [],
  };
}

function deferred<T>() {
  let resolveFn!: (value: T) => void;
  let rejectFn!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolveFn = ok; rejectFn = fail; });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

/** Sinyali dinlemeyen, hiç bitmeyen okuma; aldığı sinyalleri kaydeder. */
function hangingImpl() {
  const signals: AbortSignal[] = [];
  const impl = vi.fn((signal: AbortSignal) => { signals.push(signal); return new Promise<Budget>(() => {}); });
  return { impl, signals };
}

const flushMicrotasks = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

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
    expect(first.planned.income).toEqual({ amount: liveAmount(expected.months[0].income.plan), currency: 'TRY' });
    expect(first.actual.income).toEqual({ amount: liveAmount(expected.months[0].income.current), currency: 'TRY' });
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
      expect(category.planned[period]).toEqual(plan === null ? null : { amount: liveAmount(plan), currency: 'TRY' });
      expect(category.actual[period]).toEqual(current === null ? null : { amount: liveAmount(current), currency: 'TRY' });
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

  it('bütünlük hatası "Biçim değişti" sınıfıdır; BudgetIntegrityError metnini "Hata: " öneki ile taşır, yeniden denenmez', async () => {
    const fetcher = vi.fn(async () => new Response('<html>not gviz</html>'));
    vi.stubGlobal('fetch', fetcher);
    const result = await liveBudget({ cache: null });
    expect(result).toEqual({
      ok: false,
      kind: 'integrity',
      title: 'Biçim değişti',
      message: 'Hata: Biçim değişti. Google Sheets yanıtı okunamadı. Paylaşım erişimini kontrol edin.',
      retryable: false,
      attempts: 1,
      lastGood: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('ağ hatası network olarak sınıflanır; iptal aborted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await liveBudget({ ...FAST })).toMatchObject({ ok: false, kind: 'network', message: expect.stringMatching(/^Hata: /) });
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init: RequestInit) => { if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError'); return new Response(''); }));
    expect(await liveBudget({ signal: controller.signal })).toMatchObject({ ok: false, kind: 'aborted' });
  });
});

describe('liveBudget › hata sınıfları', () => {
  it('üç sınıf ayrı: "Sheets\'e ulaşılamadı" ≠ "Veri yok" ≠ "Biçim değişti"; başlıklar benzersiz', () => {
    expect(LIVE_FAILURE_TITLE).toEqual({
      network: "Sheets'e ulaşılamadı",
      empty: 'Veri yok',
      integrity: 'Biçim değişti',
      config: 'Bağlantı tanımlanmamış',
      aborted: 'Okuma iptal edildi',
    });
    expect(new Set(Object.values(LIVE_FAILURE_TITLE)).size).toBe(5);
  });

  it('ağ hatası: "Sheets\'e ulaşılamadı", Türkçe ayrıntı (tarayıcının İngilizce metni yok), deneme sayısı yazılı', async () => {
    const impl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const result = await liveBudget({ ...FAST, fetchBudgetImpl: impl });
    expect(result).toMatchObject({ ok: false, kind: 'network', title: "Sheets'e ulaşılamadı", retryable: true, attempts: 3, lastGood: null });
    if (result.ok) throw new Error('beklenmeyen başarı');
    expect(result.message).toBe("Hata: Sheets'e ulaşılamadı. Bağlantı kurulamadı. 3 kez denendi.");
    expect(impl).toHaveBeenCalledTimes(3);
  });

  it('veri yok: Sheets yanıt verdi ama bütçe ayı yok (gerçek fetchBudget, boş ay başlıkları); yeniden denenmez', async () => {
    const fetcher = mockBudgetSource(source => {
      source.plan[0] = ['Kalem', null, null, null];
      source.actual[0] = ['Kalem', null, null, null];
    });
    const result = await liveBudget({ ...FAST });
    expect(result).toMatchObject({ ok: false, kind: 'empty', title: 'Veri yok', message: 'Hata: Veri yok. Bütçe ayları eksik.', retryable: false, attempts: 1 });
    // Tek deneme: kaynak metadata + 6 paralel okuma (yeniden deneme olsaydı iki katı olurdu).
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(7);
  });

  it('veri yok: ay içermeyen Budget de "Veri yok"tur; boş görünüm başarı sayılmaz', async () => {
    const impl = vi.fn(async (): Promise<Budget> => ({ months: [], categories: [], groups: [], irregular: [] }));
    expect(await liveBudget({ ...FAST, fetchBudgetImpl: impl })).toMatchObject({ ok: false, kind: 'empty', message: "Hata: Veri yok. Sheets'te okunacak bütçe ayı yok." });
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('HTTP durumu: 503/429 geçici (yeniden denenir), 404 veri yok, 403 erişim (ulaşılamadı, yeniden denenmez)', async () => {
    const respond = (status: number) => { const fetcher = vi.fn(async () => new Response('', { status })); vi.stubGlobal('fetch', fetcher); return fetcher; };
    let fetcher = respond(503);
    expect(await liveBudget({ ...FAST })).toMatchObject({ ok: false, kind: 'network', retryable: true, attempts: 3, message: "Hata: Sheets'e ulaşılamadı. Google Sheets bağlantısı başarısız (503). 3 kez denendi." });
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher = respond(429);
    expect(await liveBudget({ ...FAST })).toMatchObject({ kind: 'network', retryable: true, attempts: 3 });
    fetcher = respond(404);
    expect(await liveBudget({ ...FAST })).toMatchObject({ ok: false, kind: 'empty', retryable: false, attempts: 1, message: "Hata: Veri yok. Sheets'te bu tablo bulunamadı (404)." });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher = respond(403);
    expect(await liveBudget({ ...FAST })).toMatchObject({ ok: false, kind: 'network', retryable: false, attempts: 1, message: "Hata: Sheets'e ulaşılamadı. Erişim reddedildi (403). Paylaşım ayarını kontrol edin." });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('yapılandırma eksik: config, ağa tekrar çıkılmaz', async () => {
    const impl = vi.fn(async (): Promise<Budget> => { throw new Error('Google Sheets bağlantısı henüz tanımlanmamış.'); });
    expect(await liveBudget({ ...FAST, fetchBudgetImpl: impl })).toMatchObject({ ok: false, kind: 'config', title: 'Bağlantı tanımlanmamış', retryable: false, message: 'Hata: Bağlantı tanımlanmamış. Google Sheets bağlantısı henüz tanımlanmamış.' });
    expect(impl).toHaveBeenCalledTimes(1);
    const typed = vi.fn(async (): Promise<Budget> => { throw new ConfigError('Sheet kimliği yok.'); });
    expect(await liveBudget({ ...FAST, fetchBudgetImpl: typed })).toMatchObject({ kind: 'config' });
  });

  it('BudgetIntegrityError doğrudan da "Biçim değişti"; bilinmeyen hata ulaşılamadı sınıfında ama yeniden denenmez', async () => {
    const integrity = vi.fn(async (): Promise<Budget> => { throw new BudgetIntegrityError('E-tablo şeması değişmiş; bütçe satırı doğrulanamadı.'); });
    expect(await liveBudget({ ...FAST, fetchBudgetImpl: integrity })).toMatchObject({ kind: 'integrity', message: 'Hata: Biçim değişti. E-tablo şeması değişmiş; bütçe satırı doğrulanamadı.' });
    expect(integrity).toHaveBeenCalledTimes(1);
    const odd = vi.fn(async (): Promise<Budget> => { throw new RangeError('Beklenmeyen değer.'); });
    expect(await liveBudget({ ...FAST, fetchBudgetImpl: odd })).toMatchObject({ kind: 'network', retryable: false, attempts: 1, message: "Hata: Sheets'e ulaşılamadı. Beklenmeyen değer." });
  });
});

describe('liveBudget › zaman aşımı ve sınırlı yeniden deneme', () => {
  it('yanıt gelmeyen okuma timeoutMs sonunda kesilir: sinyal iptal, sınıf ulaşılamadı, sınırlı sayıda denenir', async () => {
    const { impl, signals } = hangingImpl();
    const started = Date.now();
    const result = await liveBudget({ ...FAST, fetchBudgetImpl: impl });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result).toMatchObject({ ok: false, kind: 'network', retryable: true, attempts: 3 });
    if (result.ok) throw new Error('beklenmeyen başarı');
    expect(result.message).toBe("Hata: Sheets'e ulaşılamadı. 40 ms içinde yanıt gelmedi. 3 kez denendi.");
    expect(impl).toHaveBeenCalledTimes(3);
    // Sinyali dinlemeyen okuma da bırakılır; her denemenin sinyali iptal edilmiştir.
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it('varsayılan zaman aşımı 10 sn; saniye Türkçe yazılır', async () => {
    vi.useFakeTimers();
    const { impl } = hangingImpl();
    const pending = liveBudget({ fetchBudgetImpl: impl, retry: { attempts: 1 }, cache: null });
    await vi.advanceTimersByTimeAsync(9_999);
    await flushMicrotasks();
    expect(impl).toHaveBeenCalledTimes(1);
    let settled = false;
    void pending.then(() => { settled = true; });
    await flushMicrotasks();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ kind: 'network', attempts: 1, message: "Hata: Sheets'e ulaşılamadı. 10 sn içinde yanıt gelmedi." });
  });

  it('geçici hata sonrası başarı: üçüncü denemede ok, deneme sayısı sonuçta', async () => {
    const impl = vi.fn<(signal: AbortSignal) => Promise<Budget>>()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockRejectedValueOnce(new Error('Google Sheets bağlantısı başarısız (502).'))
      .mockResolvedValueOnce(budgetFixture());
    const result = await liveBudget({ ...FAST, fetchBudgetImpl: impl, now: () => new Date('2026-11-02T09:00:00.000Z') });
    expect(result).toMatchObject({ ok: true, attempts: 3, budget: { readAt: '2026-11-02T09:00:00.000Z', periods: ['2098-11'] } });
    expect(impl).toHaveBeenCalledTimes(3);
  });

  it('varsayılan politika: 3 deneme, bekleme 400 ms ve 800 ms (eşit jitter üst sınırı)', async () => {
    vi.useFakeTimers();
    const impl = vi.fn(async (): Promise<Budget> => { throw new TypeError('Failed to fetch'); });
    const pending = liveBudget({ fetchBudgetImpl: impl, random: () => 1, cache: null });
    const advance = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); await flushMicrotasks(); };
    await advance(0);
    expect(impl).toHaveBeenCalledTimes(1);
    await advance(399);
    expect(impl).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(impl).toHaveBeenCalledTimes(2);
    await advance(799);
    expect(impl).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(impl).toHaveBeenCalledTimes(3);
    expect(await pending).toMatchObject({ kind: 'network', attempts: 3 });
    expect(impl).toHaveBeenCalledTimes(3);
  });

  it('retryDelay: üstel artar, üst sınırı aşmaz, eşit jitter [yarı, tam] aralığında', () => {
    const policy = { baseDelayMs: 400, maxDelayMs: 3000 };
    expect([1, 2, 3, 4, 5].map(n => retryDelay(n, policy, () => 1))).toEqual([400, 800, 1600, 3000, 3000]);
    expect(retryDelay(1, policy, () => 0)).toBe(200);
    expect(retryDelay(2, policy, () => 0.5)).toBe(600);
    expect(retryDelay(1, { baseDelayMs: 0, maxDelayMs: 0 }, () => 1)).toBe(0);
  });

  it('attempts: 1 yeniden denemeyi kapatır; geçersiz değerler güvenli sınıra çekilir', async () => {
    const impl = vi.fn(async (): Promise<Budget> => { throw new TypeError('Failed to fetch'); });
    expect(await liveBudget({ ...FAST, fetchBudgetImpl: impl, retry: { attempts: 1 } })).toMatchObject({ attempts: 1, message: "Hata: Sheets'e ulaşılamadı. Bağlantı kurulamadı." });
    expect(impl).toHaveBeenCalledTimes(1);
    const many = vi.fn(async (): Promise<Budget> => { throw new TypeError('Failed to fetch'); });
    await liveBudget({ ...FAST, fetchBudgetImpl: many, retry: { attempts: 99, baseDelayMs: 0 } });
    expect(many).toHaveBeenCalledTimes(5);
    const none = vi.fn(async (): Promise<Budget> => { throw new TypeError('Failed to fetch'); });
    await liveBudget({ ...FAST, fetchBudgetImpl: none, retry: { attempts: 0 } });
    expect(none).toHaveBeenCalledTimes(1);
  });
});

describe('liveBudget › AbortController', () => {
  it('önceden iptal edilmiş sinyal: okuma hiç başlamaz', async () => {
    const impl = vi.fn(async () => budgetFixture());
    const controller = new AbortController();
    controller.abort();
    expect(await liveBudget({ ...FAST, fetchBudgetImpl: impl, signal: controller.signal })).toEqual({ ok: false, kind: 'aborted', title: 'Okuma iptal edildi', message: 'Hata: Okuma iptal edildi.', retryable: false });
    expect(impl).not.toHaveBeenCalled();
  });

  it('okuma sürerken iptal: okumanın sinyali iptal edilir, yeniden denenmez', async () => {
    const { impl, signals } = hangingImpl();
    const controller = new AbortController();
    const pending = liveBudget({ ...FAST, timeoutMs: 60_000, fetchBudgetImpl: impl, signal: controller.signal });
    await vi.waitFor(() => expect(impl).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, kind: 'aborted' });
    await vi.waitFor(() => expect(signals[0].aborted).toBe(true));
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('geri çekilme beklemesinde iptal: bekleme kesilir, yeni deneme yapılmaz', async () => {
    const impl = vi.fn(async (): Promise<Budget> => { throw new TypeError('Failed to fetch'); });
    const controller = new AbortController();
    const pending = liveBudget({ ...FAST, retry: { baseDelayMs: 60_000, maxDelayMs: 60_000 }, fetchBudgetImpl: impl, signal: controller.signal });
    await vi.waitFor(() => expect(impl).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, kind: 'aborted' });
    await new Promise(done => setTimeout(done, 20));
    expect(impl).toHaveBeenCalledTimes(1);
  });
});

describe('liveBudget › eşzamanlı isteklerin tekilleştirilmesi', () => {
  it('aynı anda iki çağrı tek okuma yapar ve aynı sonucu alır; bittikten sonra yeni çağrı yeniden okur', async () => {
    const gate = deferred<Budget>();
    const impl = vi.fn((_signal: AbortSignal) => gate.promise);
    const a = liveBudget({ ...FAST, timeoutMs: 60_000, fetchBudgetImpl: impl });
    const b = liveBudget({ ...FAST, timeoutMs: 60_000, fetchBudgetImpl: impl });
    await flushMicrotasks();
    expect(impl).toHaveBeenCalledTimes(1);
    gate.resolve(budgetFixture());
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toMatchObject({ ok: true });
    expect(rb).toEqual(ra);
    impl.mockResolvedValueOnce(budgetFixture());
    expect(await liveBudget({ ...FAST, fetchBudgetImpl: impl })).toMatchObject({ ok: true });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('farklı okuyucular paylaşılmaz', async () => {
    const one = vi.fn(async () => budgetFixture());
    const two = vi.fn(async () => budgetFixture());
    await Promise.all([liveBudget({ ...FAST, fetchBudgetImpl: one }), liveBudget({ ...FAST, fetchBudgetImpl: two })]);
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
  });

  it('bir çağıran iptal ederse yalnız o "iptal" alır; ortak okuma diğeri için sürer', async () => {
    const gate = deferred<Budget>();
    const signals: AbortSignal[] = [];
    const impl = vi.fn((signal: AbortSignal) => { signals.push(signal); return gate.promise; });
    const first = new AbortController();
    const a = liveBudget({ ...FAST, timeoutMs: 60_000, fetchBudgetImpl: impl, signal: first.signal });
    const b = liveBudget({ ...FAST, timeoutMs: 60_000, fetchBudgetImpl: impl, signal: new AbortController().signal });
    await flushMicrotasks();
    first.abort();
    expect(await a).toMatchObject({ ok: false, kind: 'aborted' });
    await flushMicrotasks();
    expect(signals[0].aborted).toBe(false);
    gate.resolve(budgetFixture());
    expect(await b).toMatchObject({ ok: true });
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('tüm çağıranlar iptal ederse ortak okuma da iptal edilir; sonraki çağrı yeni okuma başlatır', async () => {
    const { impl, signals } = hangingImpl();
    const a = new AbortController(), b = new AbortController();
    const ra = liveBudget({ ...FAST, timeoutMs: 60_000, fetchBudgetImpl: impl, signal: a.signal });
    const rb = liveBudget({ ...FAST, timeoutMs: 60_000, fetchBudgetImpl: impl, signal: b.signal });
    await flushMicrotasks();
    a.abort();
    b.abort();
    await Promise.all([ra, rb]);
    await flushMicrotasks();
    expect(signals[0].aborted).toBe(true);
    impl.mockResolvedValueOnce(budgetFixture());
    expect(await liveBudget({ ...FAST, fetchBudgetImpl: impl })).toMatchObject({ ok: true });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('aynı görevde iptal edip yeniden katılan çağıran (React StrictMode) ortak okumayı düşürmez', async () => {
    const gate = deferred<Budget>();
    const signals: AbortSignal[] = [];
    const impl = vi.fn((signal: AbortSignal) => { signals.push(signal); return gate.promise; });
    const first = new AbortController();
    const a = liveBudget({ ...FAST, timeoutMs: 60_000, fetchBudgetImpl: impl, signal: first.signal });
    await flushMicrotasks();
    first.abort();
    const b = liveBudget({ ...FAST, timeoutMs: 60_000, fetchBudgetImpl: impl });
    await flushMicrotasks();
    expect(signals[0].aborted).toBe(false);
    gate.resolve(budgetFixture());
    expect(await a).toMatchObject({ kind: 'aborted' });
    expect(await b).toMatchObject({ ok: true });
    expect(impl).toHaveBeenCalledTimes(1);
  });
});

describe('liveBudget › son iyi okuma önbelleği ve "Son okuma"', () => {
  it('başarılı okuma önbelleğe yazılır; sonraki hata son iyi okumayı (zamanıyla) taşır ama başarı saymaz', async () => {
    const cache = createMemoryLiveBudgetCache();
    const good = vi.fn(async () => budgetFixture());
    const ok = await liveBudget({ ...FAST, cache, fetchBudgetImpl: good, now: () => new Date('2026-11-02T09:00:00.000Z') });
    if (!ok.ok) throw new Error(ok.message);
    await vi.waitFor(async () => expect(await cache.get(LIVE_BUDGET_CACHE_KEY)).toEqual({ v: 1, sheet: sheetId, budget: ok.budget }));
    expect(lastReadAtOf(ok)).toBe('2026-11-02T09:00:00.000Z');

    const bad = vi.fn(async (): Promise<Budget> => { throw new TypeError('Failed to fetch'); });
    const failed = await liveBudget({ ...FAST, cache, fetchBudgetImpl: bad, now: () => new Date('2026-11-02T10:00:00.000Z') });
    expect(failed).toMatchObject({ ok: false, kind: 'network', lastGood: ok.budget });
    expect(lastReadAtOf(failed)).toBe('2026-11-02T09:00:00.000Z');
    expect(await lastGoodBudget({ cache })).toEqual(ok.budget);
  });

  it('başka Sheet\'in, eski sürümün ya da bozuk kaydın önbelleği kullanılmaz', async () => {
    const view = toBudgetViewModel(budgetFixture(), '2026-11-02T09:00:00.000Z');
    for (const entry of [
      { v: 1, sheet: 'baska-bir-sheet-kimligi-0000', budget: view },
      { v: 0, sheet: sheetId, budget: view },
      { v: 1, sheet: sheetId, budget: { ...view, periods: 'bozuk' } },
      { v: 1, sheet: sheetId, budget: { ...view, readAt: 'dün' } },
      { v: 1, sheet: sheetId, budget: { ...view, periods: ['2098-13'] } },
      'metin',
      null,
    ]) {
      const cache = createMemoryLiveBudgetCache();
      await cache.set(LIVE_BUDGET_CACHE_KEY, entry);
      expect(await lastGoodBudget({ cache })).toBeNull();
    }
    expect(await lastGoodBudget({ cache: null })).toBeNull();
    expect(lastReadAtOf({ ok: false, kind: 'network', message: 'Hata: x' })).toBeNull();
  });

  it('önbellek hatası okumayı bozmaz: yazma reddi başarıyı, okuma reddi hatayı değiştirmez', async () => {
    const broken: LiveBudgetCache = { get: vi.fn(async () => { throw new DOMException('kilit', 'InvalidStateError'); }), set: vi.fn(async () => { throw new DOMException('kota', 'QuotaExceededError'); }) };
    expect(await liveBudget({ ...FAST, cache: broken, fetchBudgetImpl: vi.fn(async () => budgetFixture()) })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(broken.set).toHaveBeenCalledTimes(1));
    expect(await liveBudget({ ...FAST, cache: broken, fetchBudgetImpl: vi.fn(async (): Promise<Budget> => { throw new TypeError('x'); }) })).toMatchObject({ ok: false, kind: 'network', lastGood: null });
  });

  it('yanıt vermeyen IndexedDB son iyi okumayı en fazla 1,5 sn bekletir', async () => {
    vi.useFakeTimers();
    const hanging: LiveBudgetCache = { get: () => new Promise(() => {}), set: async () => {} };
    const pending = lastGoodBudget({ cache: hanging });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await pending).toBeNull();
  });

  it('IndexedDB bağdaştırıcısı idb-keyval get/set kullanır; jsdom\'da (indexedDB yok) varsayılan önbellek kapalıdır', async () => {
    vi.mocked(get).mockResolvedValue(undefined);
    vi.mocked(set).mockResolvedValue(undefined);
    const idb = createIdbLiveBudgetCache();
    await idb.set(LIVE_BUDGET_CACHE_KEY, { v: 1 });
    expect(set).toHaveBeenCalledWith(LIVE_BUDGET_CACHE_KEY, { v: 1 });
    await idb.get(LIVE_BUDGET_CACHE_KEY);
    expect(get).toHaveBeenCalledWith(LIVE_BUDGET_CACHE_KEY);

    vi.mocked(get).mockClear();
    vi.mocked(set).mockClear();
    expect(typeof indexedDB).toBe('undefined');
    expect(await liveBudget({ ...FAST, cache: undefined, fetchBudgetImpl: vi.fn(async () => budgetFixture()) })).toMatchObject({ ok: true });
    expect(await lastGoodBudget()).toBeNull();
    expect(set).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();

    vi.stubGlobal('indexedDB', {});
    const ok = await liveBudget({ ...FAST, cache: undefined, fetchBudgetImpl: vi.fn(async () => budgetFixture()) });
    if (!ok.ok) throw new Error(ok.message);
    await vi.waitFor(() => expect(set).toHaveBeenCalledWith(LIVE_BUDGET_CACHE_KEY, { v: 1, sheet: sheetId, budget: ok.budget }));
  });
});

// r4-privacy: canlı tutar yuvarlanmaz (data-platform decimal() kuralı); yuvarlama yalnız görüntülemede (formatMoney).
describe('toBudgetViewModel › tutarlar yuvarlanmaz (data-platform decimal() kuralı)', () => {
  const irregular = (plan: number | null): Budget['irregular'][number] => ({ id: `t-${String(plan)}`, label: 'x', type: '', planMonth: '', month: '', plan, current: null, status: '', room: '', note: '', manual: false });
  const amountOf = (value: number) => toBudgetViewModel({ months: [], categories: [], groups: [], irregular: [irregular(value)] }, 'now').irregular[0]!.planned.amount!.amount;

  it.each([
    [8333.333333333334, '8333.333333333334'],
    [1234.5600000000002, '1234.5600000000002'],
    [1.005, '1.005'],
    [0.1 + 0.2, '0.30000000000000004'],
    [8500, '8500.00'],
    [-12.5, '-12.50'],
    [-0, '0.00'],
    [1e21, '1000000000000000000000.00'],
    [1e-7, '0.0000001'],
    [-1.5e-7, '-0.00000015'],
  ])('%s → "%s" (kayan nokta yuvarlaması yok, en az iki ondalık)', (value, expected) => {
    expect(amountOf(value)).toBe(expected);
    expect(liveAmount(value)).toBe(expected);
  });

  it('nesildeki tutarla (data-platform decimal) farkı tam sıfırdır: "Nesil ile N fark" yalnız gerçek farkta artar', () => {
    for (const value of [8333.333333333334, 1234.5600000000002, 1.005, 0.1 + 0.2, 8500, -12.5, 1e21, 1e-7, 99999999.99, 4166.666666666667]) {
      const live = { amount: amountOf(value), currency: 'TRY' };
      const generation = { amount: platformDecimal(value) as string, currency: 'TRY' };
      const difference = sumMoney([live, { amount: generation.amount.startsWith('-') ? generation.amount.slice(1) : `-${generation.amount}`, currency: 'TRY' }]);
      expect(Number(difference.money!.amount), String(value)).toBe(0);
      expect(Number(live.amount), String(value)).toBe(value);
    }
  });

  it('sonlu olmayan değer tutar sayılmaz (null, "Bilinmiyor")', () => {
    expect(liveAmount(Number.NaN)).toBeNull();
    expect(liveAmount(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

// r4-privacy: üretim derlemesinde canlı bütçenin son iyi okuması açık istek olmadan cihaza yazılmaz (yalnız sekme belleği).
describe('liveBudget › üretimde son iyi okuma yalnız bellekte (fail-closed)', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await clearLiveBudgetCache();
  });

  it("PROD + IndexedDB: başarılı okuma IndexedDB'ye yazılmaz; son iyi okuma yalnız bu sekmede taşınır", async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_AILE_PARTITION_CACHE', '');
    vi.stubGlobal('indexedDB', {});
    const ok = await liveBudget({ ...FAST, cache: undefined, fetchBudgetImpl: vi.fn(async () => budgetFixture()) });
    if (!ok.ok) throw new Error(ok.message);
    const failed = await liveBudget({ ...FAST, cache: undefined, fetchBudgetImpl: vi.fn(async (): Promise<Budget> => { throw new TypeError('Failed to fetch'); }) });
    expect(failed).toMatchObject({ ok: false, kind: 'network', lastGood: ok.budget });
    expect(await lastGoodBudget()).toEqual(ok.budget);
    expect(set).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("PROD + VITE_AILE_PARTITION_CACHE=idb: kalıcı saklama açıkça istenmişse IndexedDB'ye yazılır", async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_AILE_PARTITION_CACHE', 'idb');
    vi.stubGlobal('indexedDB', {});
    vi.mocked(set).mockResolvedValue(undefined);
    const ok = await liveBudget({ ...FAST, cache: undefined, fetchBudgetImpl: vi.fn(async () => budgetFixture()) });
    if (!ok.ok) throw new Error(ok.message);
    await vi.waitFor(() => expect(set).toHaveBeenCalledWith(LIVE_BUDGET_CACHE_KEY, { v: 1, sheet: sheetId, budget: ok.budget }));
  });

  it('clearLiveBudgetCache: bellekteki ve IndexedDB\'deki son iyi okumayı siler', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_AILE_PARTITION_CACHE', '');
    vi.stubGlobal('indexedDB', {});
    vi.mocked(del).mockResolvedValue(undefined);
    const ok = await liveBudget({ ...FAST, cache: undefined, fetchBudgetImpl: vi.fn(async () => budgetFixture()) });
    if (!ok.ok) throw new Error(ok.message);
    expect(await lastGoodBudget()).toEqual(ok.budget);
    await clearLiveBudgetCache();
    expect(await lastGoodBudget()).toBeNull();
    expect(del).toHaveBeenCalledWith(LIVE_BUDGET_CACHE_KEY);
  });
});

describe('Türkçe sayı ve para biçimleri', () => {
  it.each([
    ['8.500,00', '8500.00'],
    ['1.234.567,89', '1234567.89'],
    ['8500', '8500'],
    ['8500,5', '8500.5'],
    ['0,75', '0.75'],
    ['1.000', '1000'],
    ['-8.500,00', '-8500.00'],
    ['−1.250', '-1250'],
    ['(1.250,50)', '-1250.50'],
    ['+12', '12'],
    ['8 500,00', '8500.00'],
    ['8 500,00', '8500.00'],
    ['8 500,00', '8500.00'],
    ['  007,10 ', '7.10'],
    ['-0,00', '0.00'],
  ])('parseTurkishDecimal(%j) → %j', (input, expected) => {
    expect(parseTurkishDecimal(input)).toBe(expected);
  });

  it.each(['', '   ', '-', '—', 'Fiyat yok', '1.5', '1,234.56', '1.234,5.6', '12,', ',5', '1..000', '1.00,0', '8.500,00 ₺', '1e3', 'NaN', '(-5)', '1 500.000', '--5', '12a', '1.2345'])(
    'parseTurkishDecimal(%j) → null (belirsiz ya da Türkçe değil)',
    input => {
      expect(parseTurkishDecimal(input)).toBeNull();
    },
  );

  it.each([
    ['₺8.500,00', { amount: '8500.00', currency: 'TRY' }],
    ['8.500,00 ₺', { amount: '8500.00', currency: 'TRY' }],
    ['8.500 TL', { amount: '8500.00', currency: 'TRY' }],
    ['tl 8.500', { amount: '8500.00', currency: 'TRY' }],
    ['-₺1.250,5', { amount: '-1250.50', currency: 'TRY' }],
    ['₺-1.250,5', { amount: '-1250.50', currency: 'TRY' }],
    ['(₺1.250,00)', { amount: '-1250.00', currency: 'TRY' }],
    ['1.250,125 TRY', { amount: '1250.125', currency: 'TRY' }],
    ['$12,50', { amount: '12.50', currency: 'USD' }],
    ['12,50 €', { amount: '12.50', currency: 'EUR' }],
    ['EUR 1.000', { amount: '1000.00', currency: 'EUR' }],
    ['8.500', { amount: '8500.00', currency: 'TRY' }],
  ])('parseTurkishMoney(%j) → %j', (input, expected) => {
    expect(parseTurkishMoney(input)).toEqual(expected);
  });

  it('para birimi yazılmamışsa verilen varsayılan; tanınmayan ya da iki para birimi null', () => {
    expect(parseTurkishMoney('8.500', 'USD')).toEqual({ amount: '8500.00', currency: 'USD' });
    for (const input of ['₺8.500 TL', '₺', 'Fiyat yok', '', '8.500 ¥', '₺1.5', '-₺-5', '₺ 1,234.56']) expect(parseTurkishMoney(input)).toBeNull();
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
  const base: PurchaseNeedRecord = {
    id: 'r1', tenant_id: 't', kind: 'purchase_need', label: 'x', source_record_id: 'k1',
    source_attributes: { id: 'k1', tip: 'satinalma', ad: 'x', tahmini_tl_min: '700', not: '' },
    category_term_id: null, phase_term_id: null, context_term_ids: [], state_snapshot: { decision: null, fulfillment: null, inspection: null, payment: null }, state_term_ids: { decision: null, fulfillment: null, inspection: null, payment: null },
    amounts: {}, dates: {}, room_id: null, deleted_at: null,
  };

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
    expect(diffLiveRecords([{ id: 'k1', tip: 'satinalma', ad: 'x', tahmini_tl_min: 700 }], [base]).entries).toEqual([]);
    const deleted = diffLiveRecords([{ id: 'k1', tip: 'satinalma', ad: 'x', tahmini_tl_min: 700, deleted_at: '2026-10-28T00:00:00.000Z' }], [base]);
    expect(deleted.entries[0].changes).toEqual([{ field: 'deleted_at', generation: null, live: '2026-10-28T00:00:00.000Z' }]);
  });

  it('para alanlarında Türkçe biçim ("36.600,00", "₺700") aynı tutardır; gerçek tutar farkı görünür kalır', () => {
    const need: PurchaseNeedRecord = { ...base, amounts: { actual: { amount: '36600.00', currency: 'TRY' } } };
    const asText = (value: string) => value as unknown as number;
    expect(diffLiveRecords([{ id: 'k1', tip: 'satinalma', ad: 'x', tahmini_tl_min: asText('₺700'), gercek_tl: asText('36.600,00') }], [need]).entries).toEqual([]);
    const moved = diffLiveRecords([{ id: 'k1', tip: 'satinalma', ad: 'x', tahmini_tl_min: 700, gercek_tl: asText('36.600,50') }], [need]);
    expect(moved.entries[0].changes).toEqual([{ field: 'gercek_tl', generation: '36600.00', live: '36.600,50' }]);
    // Para dışı alan Türkçe sayı olarak yorumlanmaz.
    const text = diffLiveRecords([{ id: 'k1', tip: 'satinalma', ad: 'x', tahmini_tl_min: 700, not: '1.000' }], [{ ...base, source_attributes: { ...base.source_attributes, not: '1000' } }]);
    expect(text.entries[0].changes).toEqual([{ field: 'not', generation: '1000', live: '1.000' }]);
  });
});
