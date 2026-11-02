import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { del, get, set } from 'idb-keyval';
import type { BatchRequest } from '@shared/api';
import { recordToRow } from '@shared/convert';
import { ITEM_COLUMNS, SETTING_COLUMNS } from '@shared/schema';
import { applyBatch, createTableState, type State } from '../../../gas/src/core';
import {
  CHANGE_SET_CHANNEL,
  CHANGE_SET_KEY,
  ChangeConflictError,
  ChangeSet,
  createIdbStorage,
  createMemoryStorage,
  type BatchExportOptions,
  type ChangeOp,
  type ChangeSetChannel,
  type ChangeSetLock,
  type ChangeSetStorage,
  type OverlayRecord,
} from './changeSet';
import type { PurchaseNeedRecord } from './types';

// IndexedDB jsdom'da yok; idb-keyval sahte. Diğer testler bellek saklamasıyla çalışır, yalnız createIdbStorage sahteyi kullanır.
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));

const TENANT = '89bb71d8-2e82-56a2-b231-843cbc783ba2';
const ID_A = '07a8cb8b-8cd5-5475-a49f-f07dfa0759fc';
const ID_B = '1fac1ac6-0eb5-58e8-9320-a999e0f451bd';
const TERM_IDEA = 'dcbac430-2878-5891-8ebe-9df1ddabed84';
const TERM_RESEARCHING = '11111111-1111-5111-8111-111111111111';
const TERM_ORDERED = '22222222-2222-5222-8222-222222222222';

/** fixtures/generation-synthetic purchase_needs/household kalem-027 (sentetik). */
const LAMBADER_SOURCE = { ad: 'Örnek lambader', durum: 'fikir', faz: '2', id: 'kalem-027', kategori: 'mutfak_sofra', oda: 'oda_2', tip: 'satinalma' };

function purchaseNeed(overrides: Partial<PurchaseNeedRecord> = {}): PurchaseNeedRecord {
  return {
    id: ID_A,
    tenant_id: TENANT,
    kind: 'purchase_need',
    label: 'Örnek lambader',
    source_id: '6356e639-5022-5d5d-915f-1ea8f0a7e968',
    source_record_id: 'kalem-027',
    source_attributes: LAMBADER_SOURCE,
    provenance: { source_key: 'household', source_id: '6356e639-5022-5d5d-915f-1ea8f0a7e968', sheet_id: 101, sheet_title: 'app_kalemler', row: 27, column: null, a1: '27:27' },
    attributes: { ad: 'Örnek lambader', not: 'Sentetik kayıt' },
    category_term_id: null,
    phase_term_id: null,
    context_term_ids: [],
    state_snapshot: { decision: 'idea', fulfillment: null, inspection: null, payment: 'planned' },
    state_term_ids: { decision: TERM_IDEA, fulfillment: null, inspection: null, payment: 'c1620ba3-9193-5e03-a025-bf2feca3b420' },
    amounts: { planned: { amount: '700.00', currency: 'TRY' }, actual: null },
    dates: { planned_on: '2026-12-26' },
    room_id: null,
    ...overrides,
  };
}

/** kalem-023 (sentetik): karar ekseni "researching", kaynakta durum "arastirma". */
function kase(overrides: Partial<PurchaseNeedRecord> = {}): PurchaseNeedRecord {
  return purchaseNeed({
    id: ID_B,
    source_record_id: 'kalem-023',
    label: 'Örnek kase',
    source_attributes: { ad: 'Örnek kase', durum: 'arastirma', faz: '1', id: 'kalem-023', kategori: 'tekstil', oda: 'oda_4', tip: 'satinalma' },
    state_snapshot: { decision: 'researching', fulfillment: null, inspection: null, payment: 'planned' },
    state_term_ids: { decision: TERM_RESEARCHING, fulfillment: null, inspection: null, payment: null },
    ...overrides,
  });
}

function deterministic(prefix = 'A') {
  let n = 0;
  let tick = 0;
  return {
    newId: () => `01HZZZZZZZZZZZZZZZZZZZZ${prefix}${String(++n).padStart(2, '0')}`,
    now: () => new Date(Date.UTC(2026, 9, 28, 14, 5, ++tick)).toISOString(),
  };
}

async function loaded(storage: ChangeSetStorage = createMemoryStorage()) {
  const cs = await ChangeSet.load({ storage, ...deterministic() });
  return { cs, storage };
}

const decision = (from: string | null, to: string | null, recordId = ID_A) => ({
  recordId,
  kind: 'state_change' as const,
  before: { axis: 'decision' as const, code: from, term_id: null },
  after: { axis: 'decision' as const, code: to, term_id: null },
});
const note = (from: string | null, to: string | null, recordId = ID_A) => ({ recordId, kind: 'note' as const, before: { note: from }, after: { note: to } });

// --- Sekmeler arası: gerçek BroadcastChannel (Node), her test kendi adıyla ----------------------------------------
let channelSeq = 0;
const openChannels: BroadcastChannel[] = [];
function channelPair(): [ChangeSetChannel, ChangeSetChannel] {
  const name = `aile-test-changeset-${process.pid}-${++channelSeq}`;
  const a = new BroadcastChannel(name);
  const b = new BroadcastChannel(name);
  openChannels.push(a, b);
  return [a, b];
}

/** Sekmeler arası Web Locks yerine aynı süreçte paylaşılan dışlayıcı kilit. */
function sharedLock(): ChangeSetLock & { calls: number } {
  let tail: Promise<unknown> = Promise.resolve();
  const lock = (<T>(run: () => Promise<T>): Promise<T> => {
    lock.calls++;
    const result = tail.then(run, run);
    tail = result.catch(() => undefined);
    return result;
  }) as ChangeSetLock & { calls: number };
  lock.calls = 0;
  return lock;
}

/** Okuma ve yazma arasında gerçek IndexedDB gibi bekleyen ortak saklama. */
function slowSharedStorage(): ChangeSetStorage & { raw(): unknown } {
  let value: unknown;
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    get: async () => { await pause(); return value as ChangeOp[] | undefined; },
    set: async (_key, ops) => { await pause(); value = ops; },
    raw: () => value,
  };
}

beforeEach(() => {
  vi.mocked(get).mockReset();
  vi.mocked(set).mockReset();
  vi.mocked(del).mockReset();
});

afterEach(() => {
  for (const channel of openChannels.splice(0)) channel.close();
  vi.unstubAllGlobals();
});

describe('ChangeSet.add', () => {
  it('op çekirdeği: ulid opId, recordId, kind, before/after, at, actor local, sürüm (seq) 1', async () => {
    const cs = await ChangeSet.load({ storage: createMemoryStorage() });
    const op = await cs.add({
      recordId: ID_A,
      kind: 'state_change',
      before: { axis: 'decision', code: 'idea', term_id: TERM_IDEA },
      after: { axis: 'decision', code: 'researching', term_id: TERM_RESEARCHING },
    });
    expect(op.opId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(op.recordId).toBe(ID_A);
    expect(op.kind).toBe('state_change');
    expect(op.actor).toBe('local');
    expect(op.seq).toBe(1);
    expect(Number.isNaN(Date.parse(op.at))).toBe(false);
    expect(cs.pending).toBe(1);
    expect(cs.revision).toBe(1);
    expect(cs.ops).toEqual([op]);
  });

  it('saklamaya yazar; yeniden yüklendiğinde aynı op listesi gelir', async () => {
    const storage = createMemoryStorage();
    const first = await ChangeSet.load({ storage, ...deterministic() });
    await first.add(note('Sentetik kayıt', 'Ölçü alındı'));
    const second = await ChangeSet.load({ storage });
    expect(second.ops).toEqual(first.ops);
    expect(second.pending).toBe(1);
    expect(second.revision).toBe(1);
  });

  it('saklama reddedilirse bellekte kalır ve persistence unavailable olur; hata fırlatmaz', async () => {
    const broken: ChangeSetStorage = {
      get: async () => { throw new Error('IndexedDB kapalı'); },
      set: async () => { throw new Error('IndexedDB kapalı'); },
    };
    const cs = await ChangeSet.load({ storage: broken });
    expect(cs.persistence).toBe('unavailable');
    const op = await cs.add(note(null, 'x'));
    expect(cs.ops).toEqual([op]);
    expect(cs.pending).toBe(1);
    expect(cs.persistence).toBe('unavailable');
  });

  it('okunamayan saklamanın üstüne yazmaz (başka sekmenin opları ezilmez); okuma düzelince yazar', async () => {
    let failGet = true;
    let stored: ChangeOp[] | undefined;
    const flaky: ChangeSetStorage = {
      get: async () => { if (failGet) throw new Error('geçici'); return stored; },
      set: vi.fn(async (_key: string, ops: ChangeOp[]) => { stored = ops; }),
    };
    const cs = await ChangeSet.load({ storage: flaky, ...deterministic() });
    await cs.add(note('Sentetik kayıt', 'a'));
    expect(flaky.set).not.toHaveBeenCalled();
    expect(cs.persistence).toBe('unavailable');
    failGet = false;
    await cs.add(note('Sentetik kayıt', 'b', ID_B));
    expect(flaky.set).toHaveBeenCalledTimes(1);
    expect(stored?.map((op) => op.seq)).toEqual([1, 2]);
    expect(cs.persistence).toBe('ok');
  });

  it('yalnız sözleşme alanları saklanır: girdideki fazladan alanlar (ör. anahtar) op ve saklamaya girmez', async () => {
    const { cs, storage } = await loaded();
    const input = { ...note('Sentetik kayıt', 'Ölçü alındı'), key: 'GIZLI-ANAHTAR', token: 'GIZLI-JETON' } as Parameters<ChangeSet['add']>[0];
    const op = await cs.add(input);
    expect(Object.keys(op).sort()).toEqual(['actor', 'after', 'at', 'before', 'kind', 'opId', 'recordId', 'seq']);
    expect(JSON.stringify(await storage.get(CHANGE_SET_KEY))).not.toContain('GIZLI');
  });

  it('geçersiz girdi "Hata: " ile reddedilir; eksenler farklıysa eklenmez', async () => {
    const { cs } = await loaded();
    await expect(cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'decision', code: 'idea', term_id: null }, after: { axis: 'fulfillment', code: 'ordered', term_id: null } })).rejects.toThrow(/^Hata: /);
    await expect(cs.add({ recordId: '', kind: 'note', before: { note: null }, after: { note: 'x' } })).rejects.toThrow(/^Hata: /);
    await expect(cs.add({ recordId: ID_A, kind: 'bilinmeyen', before: {}, after: {} } as unknown as Parameters<ChangeSet['add']>[0])).rejects.toThrow(/^Hata: /);
    expect(cs.ops).toEqual([]);
  });
});

describe('ChangeSet.add — idempotent', () => {
  it('aynı opId ile aynı değişiklik ikinci kez eklenmez; ilk op döner', async () => {
    const { cs, storage } = await loaded();
    const first = await cs.add({ ...note('Sentetik kayıt', 'Ölçü alındı'), opId: '01HZZZZZZZZZZZZZZZZZZZZZZZ' });
    const again = await cs.add({ ...note('Sentetik kayıt', 'Ölçü alındı'), opId: '01HZZZZZZZZZZZZZZZZZZZZZZZ' });
    expect(again).toEqual(first);
    expect(first.opId).toBe('01HZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(cs.ops).toHaveLength(1);
    expect(cs.revision).toBe(1);
    expect(await storage.get(CHANGE_SET_KEY)).toHaveLength(1);
  });

  it('aynı opId farklı içerikle reddedilir', async () => {
    const { cs } = await loaded();
    await cs.add({ ...note('Sentetik kayıt', 'a'), opId: 'OP-SABIT' });
    await expect(cs.add({ ...note('Sentetik kayıt', 'b'), opId: 'OP-SABIT' })).rejects.toThrow(/^Hata: /);
    expect(cs.ops).toHaveLength(1);
  });

  it('çift gönderim (aynı önkoşul ve aynı hedef) ikinci op üretmez', async () => {
    const { cs } = await loaded();
    const first = await cs.add(decision('idea', 'researching'));
    const second = await cs.add(decision('idea', 'researching'));
    expect(second).toEqual(first);
    expect(cs.ops).toHaveLength(1);
  });
});

describe('ChangeSet.add — çakışma (aynı kayıt, farklı önkoşul)', () => {
  it('durum değişikliği önceki yerel değişiklikle uyuşmayan önkoşulla reddedilir: ChangeConflictError', async () => {
    const { cs } = await loaded();
    const first = await cs.add(decision('idea', 'researching'));
    const attempt = cs.add(decision('idea', 'decided'));
    await expect(attempt).rejects.toBeInstanceOf(ChangeConflictError);
    await expect(attempt).rejects.toThrow(/^Hata: /);
    const error = (await attempt.catch((e: unknown) => e)) as ChangeConflictError;
    expect(error.conflict).toEqual({ opId: null, recordId: ID_A, field: 'decision', expected: 'idea', actual: 'researching', against: 'change', conflictsWith: first.opId });
    expect(cs.ops).toHaveLength(1);
    // Güncel önkoşulla devam edilebilir.
    await cs.add(decision('researching', 'decided'));
    expect(cs.ops).toHaveLength(2);
  });

  it('başka eksen veya başka kayıt çakışma sayılmaz', async () => {
    const { cs } = await loaded();
    await cs.add(decision('idea', 'researching'));
    await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'fulfillment', code: null, term_id: null }, after: { axis: 'fulfillment', code: 'ordered', term_id: TERM_ORDERED } });
    await cs.add(decision('idea', 'decided', ID_B));
    expect(cs.ops).toHaveLength(3);
  });

  it('kayıt bağlamıyla: kaynak bayat yerel opu geçtiyse güncel kaynak değerine dayanan değişiklik kabul edilir; kaynağa uymayan önkoşul reddedilir', async () => {
    const { cs } = await loaded();
    const stale = await cs.add(decision('idea', 'researching'));
    const refreshed = purchaseNeed({
      source_attributes: { ...LAMBADER_SOURCE, durum: 'karar' },
      state_snapshot: { decision: 'decided', fulfillment: null, inspection: null, payment: 'planned' },
    });
    // Bağlamsız yalnız yerel zincir denetlenir: bayat opa karşı reddedilir.
    await expect(cs.add(decision('decided', 'cancelled'))).rejects.toBeInstanceOf(ChangeConflictError);
    // Nesil kaydıyla: bayat op çakışmadadır, taban kaynaktır; kullanıcının gördüğü değerle devam edilir.
    const next = await cs.add(decision('decided', 'cancelled'), refreshed);
    expect(cs.apply([refreshed])[0].state_snapshot.decision).toBe('cancelled');
    expect(cs.conflicts([refreshed]).map((c) => c.opId)).toEqual([stale.opId]);
    expect(cs.toBatch([refreshed]).ops.map((o) => [o.opId, o.patch, o.precondition?.fields])).toEqual([[next.opId, { durum: 'iptal' }, { durum: 'karar' }]]);
    // Çift gönderim bağlamla da idempotenttir.
    expect(await cs.add(decision('decided', 'cancelled'), refreshed)).toEqual(next);
    // Kaynağa uymayan önkoşul (kullanıcı eski değeri görüyordu) eklenmez.
    const error = await cs.add(decision('idea', 'decided', ID_B), kase()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChangeConflictError);
    expect((error as ChangeConflictError).conflict).toEqual({ opId: null, recordId: ID_B, field: 'decision', expected: 'idea', actual: 'researching', against: 'source', conflictsWith: null });
    expect(cs.ops).toHaveLength(2);
  });

  it('not önerisi reddedilmez, kaydedilir; uyuşmazlık conflicts ile raporlanır ve görünüme yansımaz', async () => {
    const { cs } = await loaded();
    const a = await cs.add(note('Sentetik kayıt', 'a'));
    const b = await cs.add(note('Sentetik kayıt', 'b'));
    expect(cs.ops).toHaveLength(2);
    expect(cs.conflicts([purchaseNeed()])).toEqual([
      { opId: b.opId, recordId: ID_A, field: 'note', expected: 'Sentetik kayıt', actual: 'a', against: 'change', conflictsWith: a.opId },
    ]);
    expect(cs.apply([purchaseNeed()])[0].attributes?.not).toBe('a');
  });
});

describe('ChangeSet.apply', () => {
  it('state_change kaydın state_snapshot ve state_term_ids eksenini üstüne yazar; kaynak satıra dokunmaz', async () => {
    const { cs } = await loaded();
    await cs.add({
      recordId: ID_A,
      kind: 'state_change',
      before: { axis: 'decision', code: 'idea', term_id: TERM_IDEA },
      after: { axis: 'decision', code: 'researching', term_id: TERM_RESEARCHING },
    });
    const source = [purchaseNeed(), kase()];
    const view = cs.apply(source);
    expect(view[0].state_snapshot).toEqual({ decision: 'researching', fulfillment: null, inspection: null, payment: 'planned' });
    expect(view[0].state_term_ids.decision).toBe(TERM_RESEARCHING);
    expect(view[0].state_term_ids.payment).toBe(source[0].state_term_ids.payment);
    expect(view[0].amounts).toBe(source[0].amounts);
    expect(view[1]).toBe(source[1]);
    expect(source[0].state_snapshot.decision).toBe('idea');
  });

  it('note attributes.not alanını üstüne yazar; diğer attributes korunur', async () => {
    const { cs } = await loaded();
    await cs.add(note('Sentetik kayıt', 'Ölçü alındı'));
    const [row] = cs.apply([purchaseNeed()]);
    expect(row.attributes).toEqual({ ad: 'Örnek lambader', not: 'Ölçü alındı' });
  });

  it('aynı kayıtta ardışık oplar sırayla uygulanır (son op kazanır)', async () => {
    const { cs } = await loaded();
    await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'decision', code: 'idea', term_id: TERM_IDEA }, after: { axis: 'decision', code: 'researching', term_id: TERM_RESEARCHING } });
    await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'decision', code: 'researching', term_id: TERM_RESEARCHING }, after: { axis: 'decision', code: 'decided', term_id: null } });
    const [row] = cs.apply([purchaseNeed()]);
    expect(row.state_snapshot.decision).toBe('decided');
    expect(row.state_term_ids.decision).toBeNull();
    expect(cs.pending).toBe(2);
    expect(cs.pendingFor(ID_A)).toHaveLength(2);
    expect(cs.pendingFor(ID_B)).toHaveLength(0);
  });

  it('state_snapshot olmayan kayıtta state_change ekseni eklenir, attributes yoksa not için oluşturulur', async () => {
    const { cs } = await loaded();
    await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'fulfillment', code: null, term_id: null }, after: { axis: 'fulfillment', code: 'ordered', term_id: TERM_ORDERED } });
    await cs.add(note(null, 'Sipariş verildi'));
    const bare: OverlayRecord = { id: ID_A, tenant_id: TENANT };
    const [row] = cs.apply([bare]);
    expect(row.state_snapshot?.fulfillment).toBe('ordered');
    expect(row.state_term_ids?.fulfillment).toBe(TERM_ORDERED);
    expect(row.attributes?.not).toBe('Sipariş verildi');
  });

  it('kaynak (nesil) değişmişse bayat op uygulanmaz ve kaynak değeri ezilmez; conflicts kaynağa karşı raporlar', async () => {
    const { cs } = await loaded();
    const op = await cs.add(decision('idea', 'researching'));
    const refreshed = purchaseNeed({ state_snapshot: { decision: 'decided', fulfillment: null, inspection: null, payment: 'planned' } });
    const [row] = cs.apply([refreshed]);
    expect(row).toBe(refreshed);
    expect(cs.conflicts([refreshed])).toEqual([
      { opId: op.opId, recordId: ID_A, field: 'decision', expected: 'idea', actual: 'decided', against: 'source', conflictsWith: null },
    ]);
  });

  it('kaynak zaten op sonucundaysa op etkisizdir ve çakışma sayılmaz', async () => {
    const { cs } = await loaded();
    await cs.add(decision('idea', 'researching'));
    const already = purchaseNeed({ state_snapshot: { decision: 'researching', fulfillment: null, inspection: null, payment: 'planned' } });
    expect(cs.apply([already])[0]).toBe(already);
    expect(cs.conflicts([already])).toEqual([]);
  });

  it('çakışan opa dayanan sonraki op da uygulanmaz (zincir kırılır)', async () => {
    const { cs } = await loaded();
    const first = await cs.add(decision('idea', 'researching'));
    const second = await cs.add(decision('researching', 'decided'));
    const refreshed = purchaseNeed({ state_snapshot: { decision: 'cancelled', fulfillment: null, inspection: null, payment: null } });
    expect(cs.apply([refreshed])[0].state_snapshot.decision).toBe('cancelled');
    expect(cs.conflicts([refreshed]).map((c) => [c.opId, c.actual, c.against])).toEqual([
      [first.opId, 'cancelled', 'source'],
      [second.opId, 'cancelled', 'source'],
    ]);
  });
});

describe('ChangeSet.undo', () => {
  it('telafi op ekler: before/after ters, undoes = opId; geçmiş silinmez; görünüm kaynağa döner, pending düşer', async () => {
    const { cs, storage } = await loaded();
    const op = await cs.add(note('Sentetik kayıt', 'Ölçü alındı'));
    const result = await cs.undo(op.opId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('beklenmedik');
    expect(result.op).toMatchObject({ kind: 'note', recordId: ID_A, before: { note: 'Ölçü alındı' }, after: { note: 'Sentetik kayıt' }, undoes: op.opId, actor: 'local', seq: 2 });
    expect(result.op.opId).not.toBe(op.opId);
    expect(cs.ops).toEqual([op, result.op]);
    expect(cs.pending).toBe(0);
    expect(cs.revision).toBe(2);
    expect(cs.apply([purchaseNeed()])[0]).toEqual(purchaseNeed());
    expect(await storage.get(CHANGE_SET_KEY)).toEqual([op, result.op]);
  });

  it('bayat Geri al: aynı kayıtta sonraki op varsa reddeder: "Sonraki değişiklik var"', async () => {
    const { cs } = await loaded();
    const first = await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'decision', code: 'idea', term_id: TERM_IDEA }, after: { axis: 'decision', code: 'researching', term_id: TERM_RESEARCHING } });
    await cs.add(note('Sentetik kayıt', 'x'));
    const result = await cs.undo(first.opId);
    expect(result).toEqual({ ok: false, reason: 'Sonraki değişiklik var' });
    expect(cs.ops).toHaveLength(2);
    expect(cs.pending).toBe(2);
  });

  it('başka kayıttaki sonraki op geri almayı engellemez', async () => {
    const { cs } = await loaded();
    const first = await cs.add(note('Sentetik kayıt', 'a'));
    await cs.add(note('Sentetik kayıt', 'b', ID_B));
    const result = await cs.undo(first.opId);
    expect(result.ok).toBe(true);
    expect(cs.pending).toBe(1);
    expect(cs.pendingFor(ID_A)).toHaveLength(0);
  });

  it('zaten geri alınmış, telafi veya bilinmeyen opId reddedilir', async () => {
    const { cs } = await loaded();
    const op = await cs.add(note(null, 'a'));
    const undone = await cs.undo(op.opId);
    if (!undone.ok) throw new Error('beklenmedik');
    expect(await cs.undo(op.opId)).toEqual({ ok: false, reason: 'Zaten geri alındı' });
    expect(await cs.undo(undone.op.opId)).toEqual({ ok: false, reason: 'Geri alma işlemi geri alınamaz' });
    expect(await cs.undo('yok')).toEqual({ ok: false, reason: 'Değişiklik bulunamadı' });
    expect(cs.ops).toHaveLength(2);
  });

  it('geri alındıktan sonra aynı kayda yeni op eklenebilir ve o da geri alınabilir', async () => {
    const { cs } = await loaded();
    const a = await cs.add(note(null, 'a'));
    await cs.undo(a.opId);
    const b = await cs.add(note(null, 'b'));
    expect(cs.apply([purchaseNeed({ attributes: {} })])[0].attributes).toEqual({ not: 'b' });
    expect((await cs.undo(b.opId)).ok).toBe(true);
    expect(cs.pending).toBe(0);
  });

  it('başka sekmenin sonraki değişikliği (henüz yayın gelmeden) bayat Geri al ile ezilmez', async () => {
    const storage = createMemoryStorage();
    const tab1 = await ChangeSet.load({ storage, ...deterministic('A'), channel: null });
    const op1 = await tab1.add(decision('idea', 'researching'));
    const tab2 = await ChangeSet.load({ storage, ...deterministic('B'), channel: null });
    await tab2.add(decision('researching', 'decided'));

    expect(await tab1.undo(op1.opId)).toEqual({ ok: false, reason: 'Sonraki değişiklik var' });
    expect(tab1.apply([purchaseNeed()])[0].state_snapshot.decision).toBe('decided');
    expect(await storage.get(CHANGE_SET_KEY)).toHaveLength(2);
  });
});

describe('ChangeSet sürüm ve saklama biçimi', () => {
  it('her op artan seq alır (telafi dahil); revision son sürümdür', async () => {
    const { cs } = await loaded();
    const a = await cs.add(note('Sentetik kayıt', 'a'));
    const b = await cs.add(note('Sentetik kayıt', 'b', ID_B));
    const undone = await cs.undo(b.opId);
    if (!undone.ok) throw new Error('beklenmedik');
    expect([a.seq, b.seq, undone.op.seq]).toEqual([1, 2, 3]);
    expect(cs.revision).toBe(3);
  });

  it('eski biçim (seq yok) sırayla sürümlenir; sonraki yazımda seq kalıcı olur', async () => {
    const legacy = [
      { opId: 'L1', recordId: ID_A, kind: 'note', before: { note: 'Sentetik kayıt' }, after: { note: 'a' }, at: '2026-10-28T14:05:01.000Z', actor: 'local' },
      { opId: 'L2', recordId: ID_B, kind: 'note', before: { note: 'Sentetik kayıt' }, after: { note: 'b' }, at: '2026-10-28T14:05:02.000Z', actor: 'local' },
    ] as unknown as ChangeOp[];
    const storage = createMemoryStorage();
    await storage.set(CHANGE_SET_KEY, legacy);
    const cs = await ChangeSet.load({ storage, ...deterministic() });
    expect(cs.ops.map((op) => [op.opId, op.seq])).toEqual([['L1', 1], ['L2', 2]]);
    const next = await cs.add(note('Sentetik kayıt', 'c', '33333333-3333-5333-8333-333333333333'));
    expect(next.seq).toBe(3);
    expect((await storage.get(CHANGE_SET_KEY))?.map((op) => op.seq)).toEqual([1, 2, 3]);
  });

  it('bozuk oplar atılır, yinelenen opId bir kez sayılır, sıra seq ile kurulur', async () => {
    const good1 = { opId: 'G1', recordId: ID_A, seq: 1, kind: 'note', before: { note: null }, after: { note: 'a' }, at: '2026-10-28T14:05:01.000Z', actor: 'local' };
    const good2 = { opId: 'G2', recordId: ID_B, seq: 2, kind: 'note', before: { note: null }, after: { note: 'b' }, at: '2026-10-28T14:05:02.000Z', actor: 'local' };
    const stored = [
      good2,
      { opId: 'X1', recordId: ID_A, seq: 3, kind: 'state_change', before: { axis: 'decision', code: 'idea', term_id: null } },
      { opId: 'X2', recordId: ID_A, seq: 4, kind: 'state_change', before: { axis: 'decision', code: 'idea', term_id: null }, after: { axis: 'payment', code: 'paid', term_id: null }, at: 'x', actor: 'local' },
      { opId: 'X3', recordId: ID_A, seq: 5, kind: 'note', before: { note: 5 }, after: { note: 'x' }, at: 'x', actor: 'local' },
      good1,
      { ...good1, after: { note: 'ikinci kopya' } },
    ] as unknown as ChangeOp[];
    const storage = createMemoryStorage();
    await storage.set(CHANGE_SET_KEY, stored);
    const cs = await ChangeSet.load({ storage });
    expect(cs.ops.map((op) => op.opId)).toEqual(['G1', 'G2']);
    expect(cs.ops[0]).toMatchObject({ after: { note: 'a' } });
  });
});

describe('ChangeSet.toBatch (Apps Script batch biçimi, yalnız dönüştürme)', () => {
  it('etkin opları source_record_id ile kalemler tablosuna önkoşullu UpsertOp yapar; geri alınanlar dışarıda kalır', async () => {
    const { cs } = await loaded();
    const state = await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'decision', code: 'idea', term_id: TERM_IDEA }, after: { axis: 'decision', code: 'researching', term_id: TERM_RESEARCHING } });
    const kept = await cs.add(note('Sentetik kayıt', 'Ölçü alındı', ID_B));
    const undone = await cs.add(note('Ölçü alındı', 'silinecek', ID_B));
    await cs.undo(undone.opId);
    const batch = cs.toBatch([purchaseNeed(), kase()]);
    expect(batch.ops).toEqual([
      { op: 'upsert', table: 'kalemler', id: 'kalem-027', opId: state.opId, precondition: { version: 0, fields: { durum: 'fikir' } }, patch: { durum: 'arastirma' } },
      { op: 'upsert', table: 'kalemler', id: 'kalem-023', opId: kept.opId, precondition: { version: 0, fields: { not: null } }, patch: { not: 'Ölçü alındı' } },
    ]);
    expect(batch.skipped).toEqual([]);
    expect(batch.covers).toEqual({ [state.opId]: [state.opId], [kept.opId]: [kept.opId] });
  });

  it('önkoşul sürümü kaynaktaki version sütunundan okunur (sayı veya metin)', async () => {
    const { cs } = await loaded();
    await cs.add(decision('idea', 'researching'));
    await cs.add(decision('researching', 'decided', ID_B));
    const batch = cs.toBatch([
      purchaseNeed({ source_attributes: { ...LAMBADER_SOURCE, version: 4 } }),
      kase({ source_attributes: { ...kase().source_attributes, version: '7' } }),
    ]);
    expect(batch.ops.map((op) => op.precondition?.version)).toEqual([4, 7]);
  });

  it('aynı kaydın ardışık opları tek upsert olur: son opId, birleşik yama, ilk önkoşul (yeniden gönderim yinelenen sayılır)', async () => {
    const { cs } = await loaded();
    const a = await cs.add(decision('idea', 'researching'));
    const b = await cs.add(note('Sentetik kayıt', 'Ölçü alındı'));
    const c = await cs.add(decision('researching', 'decided'));
    const batch = cs.toBatch([purchaseNeed({ source_attributes: { ...LAMBADER_SOURCE, not: 'Sentetik kayıt', version: 3 } })]);
    expect(batch.ops).toEqual([
      { op: 'upsert', table: 'kalemler', id: 'kalem-027', opId: c.opId, precondition: { version: 3, fields: { durum: 'fikir', not: 'Sentetik kayıt' } }, patch: { durum: 'karar', not: 'Ölçü alındı' } },
    ]);
    expect(batch.covers).toEqual({ [c.opId]: [a.opId, b.opId, c.opId] });
  });

  it('eski durum eşlemesi: fulfillment → durum, inspection → tamam, boş not → boş hücre', async () => {
    const { cs } = await loaded();
    const a = await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'fulfillment', code: null, term_id: null }, after: { axis: 'fulfillment', code: 'ordered', term_id: TERM_ORDERED } });
    const b = await cs.add({ recordId: ID_B, kind: 'state_change', before: { axis: 'inspection', code: null, term_id: null }, after: { axis: 'inspection', code: 'completed', term_id: null } });
    const c = await cs.add(note('Sentetik kayıt', null, ID_B));
    const batch = cs.toBatch([purchaseNeed(), kase({ source_attributes: { ...kase().source_attributes, tamam: 'FALSE', not: 'Sentetik kayıt' } })]);
    expect(batch.ops.map((o) => [o.opId, o.patch, o.precondition?.fields])).toEqual([
      [a.opId, { durum: 'siparis' }, { durum: 'fikir' }],
      [c.opId, { tamam: true, not: '' }, { tamam: false, not: 'Sentetik kayıt' }],
    ]);
    expect(batch.covers[c.opId]).toEqual([b.opId, c.opId]);
  });

  it('"Karar bekliyor": kaynakta karar durumu varsa durum hücresi boşaltılır (geri dönüşte pending okunsun)', async () => {
    const { cs } = await loaded();
    const op = await cs.add(decision('researching', 'pending', ID_B));
    const batch = cs.toBatch([kase()]);
    expect(batch.ops).toEqual([
      { op: 'upsert', table: 'kalemler', id: 'kalem-023', opId: op.opId, precondition: { version: 0, fields: { karar_bekliyor: null, durum: 'arastirma' } }, patch: { karar_bekliyor: true, durum: '' } },
    ]);
  });

  it('"Karar bekliyor"dan çıkış karar_bekliyor bayrağını kapatır', async () => {
    const { cs } = await loaded();
    const op = await cs.add(decision('pending', 'decided'));
    const pending = purchaseNeed({
      source_attributes: { ...LAMBADER_SOURCE, durum: undefined, karar_bekliyor: true },
      state_snapshot: { decision: 'pending', fulfillment: null, inspection: null, payment: null },
    });
    expect(cs.toBatch([pending]).ops).toEqual([
      { op: 'upsert', table: 'kalemler', id: 'kalem-027', opId: op.opId, precondition: { version: 0, fields: { durum: null, karar_bekliyor: true } }, patch: { durum: 'karar', karar_bekliyor: false } },
    ]);
  });

  it('kaynağa yazılamayan oplar nedeniyle atlanır; batch oluşturulur ama gönderilmez', async () => {
    const { cs } = await loaded();
    const noSource = await cs.add(note('Sentetik kayıt', 'x', ID_B));
    const payment = await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'payment', code: 'planned', term_id: null }, after: { axis: 'payment', code: 'paid', term_id: null } });
    const unknownRecord = await cs.add(note(null, 'y', '33333333-3333-5333-8333-333333333333'));
    const emptyDecision = await cs.add(decision('idea', null));
    const batch = cs.toBatch([purchaseNeed(), kase({ source_record_id: undefined })]);
    expect(batch.ops).toEqual([]);
    expect(batch.skipped).toEqual([
      { opId: noSource.opId, recordId: ID_B, reason: 'Kaynak kimliği yok' },
      { opId: payment.opId, recordId: ID_A, reason: 'Kaynak sütunu yok: payment' },
      { opId: unknownRecord.opId, recordId: '33333333-3333-5333-8333-333333333333', reason: 'Kayıt bulunamadı' },
      { opId: emptyDecision.opId, recordId: ID_A, reason: 'Boş durum kaynağa yazılamaz' },
    ]);
  });

  it('bilinmeyen durum kodu atlanır', async () => {
    const { cs } = await loaded();
    const op = await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'decision', code: 'idea', term_id: TERM_IDEA }, after: { axis: 'decision', code: 'bilinmeyen_kod', term_id: null } });
    const batch = cs.toBatch([purchaseNeed()]);
    expect(batch.ops).toEqual([]);
    expect(batch.skipped).toEqual([{ opId: op.opId, recordId: ID_A, reason: 'Bilinmeyen durum kodu: bilinmeyen_kod' }]);
  });

  it('çakışan, kaynakta zaten uygulanmış, kaynak değeri/sürümü/tablosu bilinmeyen oplar nedeniyle atlanır', async () => {
    const { cs } = await loaded();
    const ids = ['44444444-4444-5444-8444-444444444441', '44444444-4444-5444-8444-444444444442', '44444444-4444-5444-8444-444444444443', '44444444-4444-5444-8444-444444444444', '44444444-4444-5444-8444-444444444445'];
    const conflict = await cs.add(decision('idea', 'researching', ids[0]));
    const already = await cs.add(decision('idea', 'researching', ids[1]));
    const noValues = await cs.add(decision('idea', 'researching', ids[2]));
    const badVersion = await cs.add(decision('idea', 'researching', ids[3]));
    const otherSheet = await cs.add(decision('idea', 'researching', ids[4]));
    const records = [
      purchaseNeed({ id: ids[0], state_snapshot: { decision: 'decided', fulfillment: null, inspection: null, payment: null } }),
      purchaseNeed({ id: ids[1], state_snapshot: { decision: 'researching', fulfillment: null, inspection: null, payment: null } }),
      purchaseNeed({ id: ids[2], source_attributes: undefined }),
      purchaseNeed({ id: ids[3], source_attributes: { ...LAMBADER_SOURCE, version: '2,5' } }),
      purchaseNeed({ id: ids[4], provenance: { ...purchaseNeed().provenance!, sheet_title: 'app_ayarlar' } }),
    ];
    const batch = cs.toBatch(records);
    expect(batch.ops).toEqual([]);
    expect(batch.skipped).toEqual([
      { opId: conflict.opId, recordId: ids[0], reason: 'Çakışma: kaynak değeri farklı' },
      { opId: already.opId, recordId: ids[1], reason: 'Kaynakta zaten uygulanmış' },
      { opId: noValues.opId, recordId: ids[2], reason: 'Kaynak değerleri yok' },
      { opId: badVersion.opId, recordId: ids[3], reason: 'Kaynak sürümü okunamadı' },
      { opId: otherSheet.opId, recordId: ids[4], reason: 'Kaynak tablosu yazılamaz: app_ayarlar' },
    ]);
  });

  it('karar değişikliği kaynaktaki karşılama durumunu (tek durum sütunu) sessizce silmez', async () => {
    const { cs } = await loaded();
    const ordered = purchaseNeed({
      source_attributes: { ...LAMBADER_SOURCE, durum: 'siparis' },
      state_snapshot: { decision: null, fulfillment: 'ordered', inspection: null, payment: null },
    });
    const decide = await cs.add(decision(null, 'decided'));
    expect(cs.toBatch([ordered]).skipped).toEqual([{ opId: decide.opId, recordId: ID_A, reason: 'Kaynakta tek durum sütunu var; karşılama durumu silinirdi' }]);
    await cs.undo(decide.opId);
    const cancel = await cs.add(decision(null, 'cancelled'));
    expect(cs.toBatch([ordered]).ops.map((o) => [o.opId, o.patch])).toEqual([[cancel.opId, { durum: 'iptal' }]]);
  });
});

describe('ChangeSet.exportBatch (JSON dışa aktarma; canlı çağrı yok, gizli değer yok)', () => {
  it('Apps Script BatchRequest gövdesi: action batch, actor, ops; anahtar alanı yok; JSON aynı gövdedir', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { cs } = await loaded();
    const op = await cs.add(decision('idea', 'researching'));
    const out = cs.exportBatch([purchaseNeed()], { actor: 'yonetim-paneli-test' });
    expect(out.request).toEqual({
      action: 'batch',
      actor: 'yonetim-paneli-test',
      ops: [{ op: 'upsert', table: 'kalemler', id: 'kalem-027', opId: op.opId, precondition: { version: 0, fields: { durum: 'fikir' } }, patch: { durum: 'arastirma' } }],
    });
    expect(Object.keys(out.request)).toEqual(['action', 'actor', 'ops']);
    expect(JSON.parse(out.json)).toEqual(out.request);
    expect(out.skipped).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Aynı küme aynı JSON'u üretir (yeniden dışa aktarma idempotent).
    expect(cs.exportBatch([purchaseNeed()], { actor: 'yonetim-paneli-test' }).json).toBe(out.json);
  });

  it('actor verilmezse varsayılan; uzun actor 60 karakterle sınırlanır', async () => {
    const { cs } = await loaded();
    expect(cs.exportBatch([]).request.actor).toBe('yonetim-paneli');
    expect(cs.exportBatch([], { actor: 'x'.repeat(80) }).request.actor).toHaveLength(60);
  });

  it('gizli değer dışa aktarılmaz: anahtar seçeneği, saklamadaki fazladan alanlar, kaynak/nitelik sırları ve localStorage anahtarı', async () => {
    localStorage.setItem('aile:appKey', 'GIZLI-LS');
    try {
      const storage = createMemoryStorage();
      await storage.set(CHANGE_SET_KEY, [
        { opId: 'S1', recordId: ID_A, seq: 1, kind: 'note', before: { note: 'Sentetik kayıt' }, after: { note: 'Ölçü alındı' }, at: '2026-10-28T14:05:01.000Z', actor: 'local', key: 'GIZLI-OP', token: 'GIZLI-TOKEN' },
      ] as unknown as ChangeOp[]);
      const cs = await ChangeSet.load({ storage });
      expect(Object.keys(cs.ops[0])).not.toContain('key');
      const record = purchaseNeed({
        source_attributes: { ...LAMBADER_SOURCE, api_key: 'GIZLI-SA', link: 'https://example.invalid/?token=GIZLI-LINK' },
        attributes: { ad: 'Örnek lambader', not: 'Sentetik kayıt', parola: 'GIZLI-ATTR' },
      });
      const out = cs.exportBatch([record], { actor: 'panel', key: 'GIZLI-OPT' } as BatchExportOptions);
      expect(out.request.ops).toHaveLength(1);
      expect(out.json).not.toContain('GIZLI');
      expect(JSON.stringify(cs.toBatch([record]))).not.toContain('GIZLI');
      expect('key' in out.request).toBe(false);
      for (const op of out.request.ops) expect(Object.keys(op).sort()).toEqual(['id', 'op', 'opId', 'patch', 'precondition', 'table']);
    } finally {
      localStorage.removeItem('aile:appKey');
    }
  });
});

// --- Apps Script çekirdeği (gas/src/core.ts) ile sentetik uçtan uca: dışa aktarılan gövde gerçek batch mantığına verilir.
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '../../../fixtures/generation-synthetic');
const GENERATION = readdirSync(FIXTURE_ROOT).find((name) => statSync(join(FIXTURE_ROOT, name)).isDirectory())!;
const SYNTHETIC_NEEDS = (JSON.parse(readFileSync(join(FIXTURE_ROOT, GENERATION, 'data/purchase_needs/household/00000.json'), 'utf8')) as { records: PurchaseNeedRecord[] }).records;

/** Nesil kaydına kaynak sürümü ekler (gerçek app_kalemler satırında version sütunu vardır). */
function withVersion(record: PurchaseNeedRecord, version: number): PurchaseNeedRecord {
  return { ...record, source_attributes: { ...record.source_attributes, version } };
}

function sheetFrom(records: readonly PurchaseNeedRecord[]): State {
  const headers = ITEM_COLUMNS.map((column) => column.key);
  const cells = records.map((record) => recordToRow(ITEM_COLUMNS, headers, record.source_attributes ?? {}));
  return {
    kalemler: createTableState(ITEM_COLUMNS, headers, cells),
    ayarlar: createTableState(SETTING_COLUMNS, SETTING_COLUMNS.map((column) => column.key), []),
  };
}

/** normalize.mjs (state_snapshot.decision / fulfillment) kuralının test kâhini: durum + karar_bekliyor → eksenler. */
function deriveAxes(row: Record<string, unknown>): { decision: string | null; fulfillment: string | null } {
  const durum = typeof row.durum === 'string' ? row.durum : undefined;
  const decisionMap: Record<string, string> = { fikir: 'idea', arastirma: 'researching', karar: 'decided', iptal: 'cancelled' };
  const fulfillmentMap: Record<string, string> = { siparis: 'ordered', teslim: 'delivered', kuruldu: 'installed', iptal: 'cancelled' };
  return {
    decision: (durum && decisionMap[durum]) || (row.karar_bekliyor === true ? 'pending' : null),
    fulfillment: (durum && fulfillmentMap[durum]) || null,
  };
}

describe('Apps Script batch çekirdeğiyle sentetik uçtan uca (canlı çağrı yok)', () => {
  const NOW = '2026-11-02T10:00:00.000Z';
  const byLabel = (label: string) => SYNTHETIC_NEEDS.find((record) => record.label === label)!;

  it('dışa aktarılan gövde kabul edilir; eksenler geri dönüşte aynı okunur; yeniden gönderim yinelenen sayılır', async () => {
    const lambader = withVersion(byLabel('Örnek lambader'), 4);
    const kaseKaydi = withVersion(byLabel('Örnek kase'), 9);
    const sheet = sheetFrom([lambader, kaseKaydi]);
    const { cs } = await loaded();
    await cs.add(decision('idea', 'researching', lambader.id));
    await cs.add(decision('researching', 'decided', lambader.id));
    await cs.add(decision('researching', 'pending', kaseKaydi.id));

    const out = cs.exportBatch([lambader, kaseKaydi], { actor: 'sentetik-test' });
    const first = applyBatch(sheet, JSON.parse(out.json) as BatchRequest, NOW);
    expect(first).toMatchObject({ ok: true, doneCount: 2 });
    const rows = new Map(sheet.kalemler.rows.map((row) => [row.id, row] as const));
    const lambaderRow = rows.get(lambader.source_record_id!)!;
    const kaseRow = rows.get(kaseKaydi.source_record_id!)!;
    expect(deriveAxes(lambaderRow)).toEqual({ decision: 'decided', fulfillment: null });
    expect(deriveAxes(kaseRow)).toEqual({ decision: 'pending', fulfillment: null });
    expect([lambaderRow.version, kaseRow.version]).toEqual([5, 10]);

    const replay = applyBatch(sheet, JSON.parse(out.json) as BatchRequest, NOW);
    expect(replay.ok).toBe(true);
    expect(replay.results.map((result) => result.duplicate)).toEqual([true, true]);
    expect([lambaderRow.version, kaseRow.version]).toEqual([5, 10]);
  });

  it.each([
    ['decision', 'idea'],
    ['decision', 'researching'],
    ['decision', 'decided'],
    ['decision', 'cancelled'],
    ['decision', 'pending'],
    ['fulfillment', 'ordered'],
    ['fulfillment', 'delivered'],
    ['fulfillment', 'installed'],
    ['fulfillment', 'cancelled'],
  ] as const)('%s → %s: Apps Script kabul eder, normalize kuralıyla aynı eksen değeri okunur', async (axis, code) => {
    const lambader = withVersion(byLabel('Örnek lambader'), 2);
    const sheet = sheetFrom([lambader]);
    const { cs } = await loaded();
    const from = lambader.state_snapshot[axis];
    await cs.add({ recordId: lambader.id, kind: 'state_change', before: { axis, code: from, term_id: null }, after: { axis, code, term_id: null } });
    const out = cs.exportBatch([lambader]);
    expect(out.skipped).toEqual([]);
    const result = applyBatch(sheet, out.request, NOW);
    expect(result).toMatchObject({ ok: true, doneCount: 1 });
    expect(deriveAxes(sheet.kalemler.rows[0])[axis]).toBe(code);
  });

  it('not ve kontrol (tamam) sütunları: önkoşul türleri Apps Script doğrulamasından geçer, değer yazılır', async () => {
    const lambader = withVersion(byLabel('Örnek lambader'), 1);
    const withNote = { ...lambader, source_attributes: { ...lambader.source_attributes, not: 'Sentetik kayıt', tamam: false } };
    const sheet = sheetFrom([withNote]);
    const { cs } = await loaded();
    await cs.add(note('Sentetik kayıt', 'Ölçü alındı', lambader.id));
    await cs.add({ recordId: lambader.id, kind: 'state_change', before: { axis: 'inspection', code: null, term_id: null }, after: { axis: 'inspection', code: 'completed', term_id: null } });
    const out = cs.exportBatch([withNote]);
    expect(out.request.ops[0]).toMatchObject({ precondition: { version: 1, fields: { not: 'Sentetik kayıt', tamam: false } } });
    expect(applyBatch(sheet, out.request, NOW)).toMatchObject({ ok: true, doneCount: 1 });
    expect(sheet.kalemler.rows[0]).toMatchObject({ not: 'Ölçü alındı', tamam: true, version: 2 });
  });

  it('nesilden sonra Sheets satırı değiştiyse yazma precondition_failed ile durur; kaynak ezilmez', async () => {
    const lambader = withVersion(byLabel('Örnek lambader'), 4);
    const sheet = sheetFrom([lambader]);
    // Başka cihaz nesilden sonra aynı satırı düzenler (sürüm 5 olur).
    applyBatch(sheet, { action: 'batch', actor: 'baska-cihaz', ops: [{ op: 'upsert', table: 'kalemler', id: 'kalem-027', opId: 'BASKA-1', patch: { durum: 'karar' } }] }, NOW);
    const { cs } = await loaded();
    await cs.add(decision('idea', 'researching', lambader.id));
    const result = applyBatch(sheet, cs.exportBatch([lambader]).request, NOW);
    expect(result).toMatchObject({ ok: false, doneCount: 0, error: 'precondition_failed' });
    expect(sheet.kalemler.rows[0]).toMatchObject({ durum: 'karar', version: 5 });
  });
});

describe('Sekmeler arası tutarlılık', () => {
  it('BroadcastChannel ile yayılır: diğer sekme opu birleştirir, abonesine haber verir, görünüm aynı olur', async () => {
    const [left, right] = channelPair();
    const storage = createMemoryStorage();
    const tab1 = await ChangeSet.load({ storage, ...deterministic('A'), channel: left });
    const tab2 = await ChangeSet.load({ storage, ...deterministic('B'), channel: right });
    const listener = vi.fn();
    tab2.subscribe(listener);
    const op = await tab1.add(decision('idea', 'researching'));
    await vi.waitFor(() => expect(tab2.ops).toEqual([op]));
    expect(listener).toHaveBeenCalled();
    expect(tab2.apply([purchaseNeed()])[0].state_snapshot.decision).toBe('researching');
    // Aynı yayının tekrarı idempotenttir.
    left.postMessage({ type: 'aile:admin:changeset/ops', ops: [op] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tab2.ops).toHaveLength(1);
  });

  it('yayındaki geçersiz veya fazla alanlı oplar ayıklanır', async () => {
    const [left, right] = channelPair();
    const tab = await ChangeSet.load({ storage: createMemoryStorage(), channel: right });
    left.postMessage({ type: 'aile:admin:changeset/ops', ops: [{ opId: 'Y1' }, { opId: 'Y2', recordId: ID_A, seq: 1, kind: 'note', before: { note: null }, after: { note: 'z' }, at: '2026-10-28T14:05:01.000Z', actor: 'local', key: 'GIZLI' }] });
    left.postMessage({ type: 'baska', ops: [] });
    await vi.waitFor(() => expect(tab.ops.map((op) => op.opId)).toEqual(['Y2']));
    expect(JSON.stringify(tab.ops)).not.toContain('GIZLI');
  });

  it('yayın yoksa sync() saklamadan okur; yazma öncesi okuma diğer sekmenin opunu ezmez', async () => {
    const storage = createMemoryStorage();
    const tab1 = await ChangeSet.load({ storage, ...deterministic('A'), channel: null });
    const tab2 = await ChangeSet.load({ storage, ...deterministic('B'), channel: null });
    const op1 = await tab1.add(note('Sentetik kayıt', 'a'));
    expect(tab2.ops).toEqual([]);
    expect(await tab2.sync()).toBe(true);
    expect(tab2.ops).toEqual([op1]);
    expect(await tab2.sync()).toBe(false);
    const op2 = await tab2.add(note('Sentetik kayıt', 'b', ID_B));
    expect(op2.seq).toBe(2);
    expect(await storage.get(CHANGE_SET_KEY)).toEqual([op1, op2]);
  });

  it('bayat sekmenin durum değişikliği önkoşul çakışmasıyla reddedilir (kilit altında okunur)', async () => {
    const storage = createMemoryStorage();
    const lock = sharedLock();
    const tab1 = await ChangeSet.load({ storage, ...deterministic('A'), channel: null, lock });
    const tab2 = await ChangeSet.load({ storage, ...deterministic('B'), channel: null, lock });
    const listener = vi.fn();
    tab2.subscribe(listener);
    const op1 = await tab1.add(decision('idea', 'researching'));
    const error = await tab2.add(decision('idea', 'decided')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChangeConflictError);
    // Reddedilse de okunan yeni op birleşir ve abone haberdar olur (arayüz güncel durumu gösterir).
    expect(tab2.ops).toEqual([op1]);
    expect(listener).toHaveBeenCalled();
    expect((error as ChangeConflictError).conflict).toMatchObject({ expected: 'idea', actual: 'researching', against: 'change', conflictsWith: op1.opId });
    expect(await storage.get(CHANGE_SET_KEY)).toEqual([op1]);
    expect(lock.calls).toBe(2);
  });

  it('eşzamanlı yazımlar kilitle sıralanır: kayıp güncelleme yok, sürümler tekil', async () => {
    const storage = slowSharedStorage();
    const lock = sharedLock();
    const tab1 = await ChangeSet.load({ storage, ...deterministic('A'), channel: null, lock });
    const tab2 = await ChangeSet.load({ storage, ...deterministic('B'), channel: null, lock });
    await Promise.all([tab1.add(note('Sentetik kayıt', 'a')), tab2.add(note('Sentetik kayıt', 'b', ID_B)), tab1.add(decision('idea', 'researching'))]);
    const persisted = storage.raw() as ChangeOp[];
    expect(persisted).toHaveLength(3);
    expect(persisted.map((op) => op.seq)).toEqual([1, 2, 3]);
  });

  it('kilitsiz eşzamanlı çakışma: iki sekme aynı sıraya yakınsar; sonraki op çakışma olarak raporlanır ve dışa aktarılmaz', async () => {
    const [left, right] = channelPair();
    const tab1 = await ChangeSet.load({ storage: createMemoryStorage(), ...deterministic('A'), channel: left, lock: null });
    const tab2 = await ChangeSet.load({ storage: createMemoryStorage(), ...deterministic('B'), channel: right, lock: null });
    const [a, b] = await Promise.all([tab1.add(decision('idea', 'researching')), tab2.add(decision('idea', 'decided'))]);
    expect([a.seq, b.seq]).toEqual([1, 1]);
    await vi.waitFor(() => {
      expect(tab1.ops).toHaveLength(2);
      expect(tab2.ops).toHaveLength(2);
    });
    expect(tab1.ops).toEqual(tab2.ops);
    for (const tab of [tab1, tab2]) {
      expect(tab.apply([purchaseNeed()])[0].state_snapshot.decision).toBe('researching');
      expect(tab.conflicts([purchaseNeed()])).toEqual([{ opId: b.opId, recordId: ID_A, field: 'decision', expected: 'idea', actual: 'researching', against: 'change', conflictsWith: a.opId }]);
      expect(tab.toBatch([purchaseNeed()]).skipped).toEqual([{ opId: b.opId, recordId: ID_A, reason: 'Çakışma: önceki değişiklikle uyuşmuyor' }]);
    }
  });

  it('close(): kanal kapanır, sonraki yayınlar alınmaz, abonelik bırakılır', async () => {
    const [left, right] = channelPair();
    const tab1 = await ChangeSet.load({ storage: createMemoryStorage(), ...deterministic('A'), channel: left });
    const tab2 = await ChangeSet.load({ storage: createMemoryStorage(), ...deterministic('B'), channel: right });
    const listener = vi.fn();
    const unsubscribe = tab2.subscribe(listener);
    unsubscribe();
    tab2.close();
    await tab1.add(note('Sentetik kayıt', 'a'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tab2.ops).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('varsayılan yükleme IndexedDB + BroadcastChannel + Web Locks kullanır; özel saklamada kanal açılmaz', async () => {
    const constructed: string[] = [];
    const posted: unknown[] = [];
    class FakeChannel {
      constructor(name: string) { constructed.push(name); }
      postMessage(message: unknown) { posted.push(message); }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const requested: string[] = [];
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: (name: string, run: () => Promise<unknown>) => { requested.push(name); return Promise.resolve().then(run); } },
    });
    try {
      vi.mocked(get).mockResolvedValue(undefined);
      vi.mocked(set).mockResolvedValue(undefined);
      const cs = await ChangeSet.load();
      const op = await cs.add(note('Sentetik kayıt', 'a'));
      expect(constructed).toEqual([CHANGE_SET_CHANNEL]);
      expect(requested).toEqual([CHANGE_SET_CHANNEL]);
      expect(set).toHaveBeenCalledWith(CHANGE_SET_KEY, [op]);
      expect(posted).toEqual([{ type: 'aile:admin:changeset/ops', ops: [op] }]);
      cs.close();

      await ChangeSet.load({ storage: createMemoryStorage() });
      expect(constructed).toHaveLength(1);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).locks;
    }
  });
});

describe('Web Locks dayanıklılığı', () => {
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).locks;
  });

  it('kilit isteği çalıştırmadan reddedilirse (ör. güvenlik kısıtı) kilitsiz devam eder; değişiklik kaybolmaz', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const request = vi.fn(() => Promise.reject(new Error('SecurityError')));
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    vi.mocked(get).mockResolvedValue(undefined);
    vi.mocked(set).mockResolvedValue(undefined);
    const cs = await ChangeSet.load();
    const op = await cs.add(note('Sentetik kayıt', 'a'));
    expect(request).toHaveBeenCalledTimes(1);
    expect(cs.ops).toEqual([op]);
    expect(set).toHaveBeenCalledWith(CHANGE_SET_KEY, [op]);
  });

  it('kilit altındaki işlem hata verirse hata iletilir ve işlem kilitsiz yeniden çalıştırılmaz', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: (_name: string, run: () => Promise<unknown>) => Promise.resolve().then(run) },
    });
    vi.mocked(get).mockResolvedValue(undefined);
    vi.mocked(set).mockResolvedValue(undefined);
    const cs = await ChangeSet.load();
    await cs.add(decision('idea', 'researching'));
    const reads = vi.mocked(get).mock.calls.length;
    await expect(cs.add(decision('idea', 'decided'))).rejects.toBeInstanceOf(ChangeConflictError);
    expect(vi.mocked(get).mock.calls.length - reads).toBe(1);
    expect(cs.ops).toHaveLength(1);
  });
});

describe('createIdbStorage', () => {
  it('idb-keyval get/set kullanır; anahtar CHANGE_SET_KEY', async () => {
    const ops: ChangeOp[] = [];
    vi.mocked(get).mockResolvedValue(ops);
    vi.mocked(set).mockResolvedValue(undefined);
    const storage = createIdbStorage();
    expect(await storage.get(CHANGE_SET_KEY)).toBe(ops);
    expect(get).toHaveBeenCalledWith(CHANGE_SET_KEY);
    await storage.set(CHANGE_SET_KEY, ops);
    expect(set).toHaveBeenCalledWith(CHANGE_SET_KEY, ops);
  });

  it('bozuk saklama içeriği (dizi değil) boş küme sayılır', async () => {
    vi.mocked(get).mockResolvedValue({ bozuk: true } as unknown as ChangeOp[]);
    const cs = await ChangeSet.load({ storage: createIdbStorage() });
    expect(cs.ops).toEqual([]);
    expect(cs.pending).toBe(0);
    expect(cs.persistence).toBe('ok');
  });
});
