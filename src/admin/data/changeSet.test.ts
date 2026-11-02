import { beforeEach, describe, expect, it, vi } from 'vitest';
import { del, get, set } from 'idb-keyval';
import {
  CHANGE_SET_KEY,
  ChangeSet,
  createIdbStorage,
  createMemoryStorage,
  type ChangeOp,
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

/** fixtures/generation-synthetic purchase_needs çekirdeği (sentetik). */
function purchaseNeed(overrides: Partial<PurchaseNeedRecord> = {}): PurchaseNeedRecord {
  return {
    id: ID_A,
    tenant_id: TENANT,
    kind: 'purchase_need',
    label: 'Örnek lambader',
    source_id: '6356e639-5022-5d5d-915f-1ea8f0a7e968',
    source_record_id: 'kalem-027',
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

function deterministic() {
  let n = 0;
  let tick = 0;
  return {
    newId: () => `01HZZZZZZZZZZZZZZZZZZZZ${String(++n).padStart(3, '0')}`,
    now: () => new Date(Date.UTC(2026, 9, 28, 14, 5, ++tick)).toISOString(),
  };
}

async function loaded(storage: ChangeSetStorage = createMemoryStorage()) {
  const cs = await ChangeSet.load({ storage, ...deterministic() });
  return { cs, storage };
}

beforeEach(() => {
  vi.mocked(get).mockReset();
  vi.mocked(set).mockReset();
  vi.mocked(del).mockReset();
});

describe('ChangeSet.add', () => {
  it('op çekirdeği: ulid opId, recordId, kind, before/after, at, actor local', async () => {
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
    expect(Number.isNaN(Date.parse(op.at))).toBe(false);
    expect(cs.pending).toBe(1);
    expect(cs.ops).toEqual([op]);
  });

  it('saklamaya yazar; yeniden yüklendiğinde aynı op listesi gelir', async () => {
    const storage = createMemoryStorage();
    const first = await ChangeSet.load({ storage, ...deterministic() });
    await first.add({ recordId: ID_A, kind: 'note', before: { note: 'Sentetik kayıt' }, after: { note: 'Ölçü alındı' } });
    const second = await ChangeSet.load({ storage });
    expect(second.ops).toEqual(first.ops);
    expect(second.pending).toBe(1);
  });

  it('saklama reddedilirse bellekte kalır ve persistence unavailable olur; hata fırlatmaz', async () => {
    const broken: ChangeSetStorage = {
      get: async () => { throw new Error('IndexedDB kapalı'); },
      set: async () => { throw new Error('IndexedDB kapalı'); },
    };
    const cs = await ChangeSet.load({ storage: broken });
    expect(cs.persistence).toBe('unavailable');
    const op = await cs.add({ recordId: ID_A, kind: 'note', before: { note: null }, after: { note: 'x' } });
    expect(cs.ops).toEqual([op]);
    expect(cs.pending).toBe(1);
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
    const source = [purchaseNeed(), purchaseNeed({ id: ID_B, source_record_id: 'kalem-023', label: 'Örnek kase' })];
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
    await cs.add({ recordId: ID_A, kind: 'note', before: { note: 'Sentetik kayıt' }, after: { note: 'Ölçü alındı' } });
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
    await cs.add({ recordId: ID_A, kind: 'note', before: { note: null }, after: { note: 'Sipariş verildi' } });
    const bare: OverlayRecord = { id: ID_A, tenant_id: TENANT };
    const [row] = cs.apply([bare]);
    expect(row.state_snapshot?.fulfillment).toBe('ordered');
    expect(row.state_term_ids?.fulfillment).toBe(TERM_ORDERED);
    expect(row.attributes?.not).toBe('Sipariş verildi');
  });
});

describe('ChangeSet.undo', () => {
  it('telafi op ekler: before/after ters, undoes = opId; görünüm kaynağa döner, pending düşer', async () => {
    const { cs, storage } = await loaded();
    const op = await cs.add({ recordId: ID_A, kind: 'note', before: { note: 'Sentetik kayıt' }, after: { note: 'Ölçü alındı' } });
    const result = await cs.undo(op.opId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('beklenmedik');
    expect(result.op).toMatchObject({ kind: 'note', recordId: ID_A, before: { note: 'Ölçü alındı' }, after: { note: 'Sentetik kayıt' }, undoes: op.opId, actor: 'local' });
    expect(result.op.opId).not.toBe(op.opId);
    expect(cs.ops).toHaveLength(2);
    expect(cs.pending).toBe(0);
    expect(cs.apply([purchaseNeed()])[0]).toEqual(purchaseNeed());
    expect(await storage.get(CHANGE_SET_KEY)).toHaveLength(2);
  });

  it('çakışma: aynı kayıtta sonraki op varsa reddeder: "Sonraki değişiklik var"', async () => {
    const { cs } = await loaded();
    const first = await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'decision', code: 'idea', term_id: TERM_IDEA }, after: { axis: 'decision', code: 'researching', term_id: TERM_RESEARCHING } });
    await cs.add({ recordId: ID_A, kind: 'note', before: { note: null }, after: { note: 'x' } });
    const result = await cs.undo(first.opId);
    expect(result).toEqual({ ok: false, reason: 'Sonraki değişiklik var' });
    expect(cs.ops).toHaveLength(2);
    expect(cs.pending).toBe(2);
  });

  it('başka kayıttaki sonraki op geri almayı engellemez', async () => {
    const { cs } = await loaded();
    const first = await cs.add({ recordId: ID_A, kind: 'note', before: { note: null }, after: { note: 'a' } });
    await cs.add({ recordId: ID_B, kind: 'note', before: { note: null }, after: { note: 'b' } });
    const result = await cs.undo(first.opId);
    expect(result.ok).toBe(true);
    expect(cs.pending).toBe(1);
    expect(cs.pendingFor(ID_A)).toHaveLength(0);
  });

  it('zaten geri alınmış, telafi veya bilinmeyen opId reddedilir', async () => {
    const { cs } = await loaded();
    const op = await cs.add({ recordId: ID_A, kind: 'note', before: { note: null }, after: { note: 'a' } });
    const undone = await cs.undo(op.opId);
    if (!undone.ok) throw new Error('beklenmedik');
    expect(await cs.undo(op.opId)).toEqual({ ok: false, reason: 'Zaten geri alındı' });
    expect(await cs.undo(undone.op.opId)).toEqual({ ok: false, reason: 'Geri alma işlemi geri alınamaz' });
    expect(await cs.undo('yok')).toEqual({ ok: false, reason: 'Değişiklik bulunamadı' });
    expect(cs.ops).toHaveLength(2);
  });

  it('geri alındıktan sonra aynı kayda yeni op eklenebilir ve o da geri alınabilir', async () => {
    const { cs } = await loaded();
    const a = await cs.add({ recordId: ID_A, kind: 'note', before: { note: null }, after: { note: 'a' } });
    await cs.undo(a.opId);
    const b = await cs.add({ recordId: ID_A, kind: 'note', before: { note: null }, after: { note: 'b' } });
    expect(cs.apply([purchaseNeed({ attributes: {} })])[0].attributes).toEqual({ not: 'b' });
    expect((await cs.undo(b.opId)).ok).toBe(true);
    expect(cs.pending).toBe(0);
  });
});

describe('ChangeSet.toBatch (Apps Script batch biçimi, yalnız dönüştürme)', () => {
  it('etkin opları source_record_id ile kalemler tablosuna UpsertOp yapar; geri alınanlar dışarıda kalır', async () => {
    const { cs } = await loaded();
    const state = await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'decision', code: 'idea', term_id: TERM_IDEA }, after: { axis: 'decision', code: 'researching', term_id: TERM_RESEARCHING } });
    const note = await cs.add({ recordId: ID_B, kind: 'note', before: { note: null }, after: { note: 'Ölçü alındı' } });
    const undone = await cs.add({ recordId: ID_B, kind: 'note', before: { note: 'Ölçü alındı' }, after: { note: 'silinecek' } });
    await cs.undo(undone.opId);
    const records = [purchaseNeed(), purchaseNeed({ id: ID_B, source_record_id: 'kalem-023' })];
    const batch = cs.toBatch(records);
    expect(batch.ops).toEqual([
      { op: 'upsert', table: 'kalemler', id: 'kalem-027', opId: state.opId, patch: { durum: 'arastirma' } },
      { op: 'upsert', table: 'kalemler', id: 'kalem-023', opId: note.opId, patch: { not: 'Ölçü alındı' } },
    ]);
    expect(batch.skipped).toEqual([]);
  });

  it('eski durum eşlemesi: fulfillment → durum, decision pending → karar_bekliyor, inspection → tamam, boş not → boş hücre', async () => {
    const { cs } = await loaded();
    const a = await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'fulfillment', code: null, term_id: null }, after: { axis: 'fulfillment', code: 'ordered', term_id: TERM_ORDERED } });
    const b = await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'decision', code: 'idea', term_id: TERM_IDEA }, after: { axis: 'decision', code: 'pending', term_id: null } });
    const c = await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'inspection', code: null, term_id: null }, after: { axis: 'inspection', code: 'completed', term_id: null } });
    const d = await cs.add({ recordId: ID_A, kind: 'note', before: { note: 'x' }, after: { note: null } });
    const batch = cs.toBatch([purchaseNeed()]);
    expect(batch.ops.map((o) => [o.opId, o.patch])).toEqual([
      [a.opId, { durum: 'siparis' }],
      [b.opId, { karar_bekliyor: true }],
      [c.opId, { tamam: true }],
      [d.opId, { not: '' }],
    ]);
  });

  it('kaynağa yazılamayan oplar nedeniyle atlanır; batch oluşturulur ama gönderilmez', async () => {
    const { cs } = await loaded();
    const noSource = await cs.add({ recordId: ID_B, kind: 'note', before: { note: null }, after: { note: 'x' } });
    const payment = await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'payment', code: 'planned', term_id: null }, after: { axis: 'payment', code: 'paid', term_id: null } });
    const unknownRecord = await cs.add({ recordId: '33333333-3333-5333-8333-333333333333', kind: 'note', before: { note: null }, after: { note: 'y' } });
    const emptyDecision = await cs.add({ recordId: ID_A, kind: 'state_change', before: { axis: 'decision', code: 'idea', term_id: TERM_IDEA }, after: { axis: 'decision', code: null, term_id: null } });
    const batch = cs.toBatch([purchaseNeed(), purchaseNeed({ id: ID_B, source_record_id: undefined })]);
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
