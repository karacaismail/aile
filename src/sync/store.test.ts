import { describe, it, expect, beforeEach } from 'vitest';
import { applyLocalOp, applyRead, applyServerResult, getState, rebase, resetStore, selectActiveItems, selectByTip, setState } from './store';

beforeEach(() => resetStore());

describe('store', () => {
  it('applyLocalOp: insert ve patch optimistic', () => {
    applyLocalOp({ op: 'upsert', table: 'kalemler', id: 'A', opId: '1', patch: { tip: 'satinalma', ad: 'Koli', adet: 2 } }, 't');
    applyLocalOp({ op: 'upsert', table: 'kalemler', id: 'A', opId: '2', patch: { adet: 3, not: '' } }, 't');
    expect(getState().items[0]).toMatchObject({ id: 'A', ad: 'Koli', adet: 3 });
    expect(getState().items[0]).not.toHaveProperty('not');
  });
  it('rebase: sunucu verisi üstüne bekleyen patch yeniden uygulanır', () => {
    const list = rebase([{ id: 'A', ad: 'Koli', adet: 1, version: 4 }], 'kalemler', [
      { op: { op: 'upsert', table: 'kalemler', id: 'A', opId: 'x', patch: { adet: 9 } }, ts: 't', attempts: 0 },
      { op: { op: 'upsert', table: 'kalemler', id: 'B', opId: 'y', patch: { tip: 'satinalma', ad: 'Yeni' } }, ts: 't', attempts: 0 },
    ]);
    expect(list.find((r) => r.id === 'A')).toMatchObject({ adet: 9, version: 4 });
    expect(list.find((r) => r.id === 'B')).toMatchObject({ ad: 'Yeni' });
  });
  it('applyRead kuyruktaki değişiklikleri korur; applyServerResult satırı sunucu satırıyla değiştirir ve çakışmayı kaydeder', () => {
    setState({ outbox: [{ op: { op: 'upsert', table: 'kalemler', id: 'A', opId: 'x', patch: { adet: 9 } }, ts: 't', attempts: 0 }] });
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [{ id: 'A', tip: 'satinalma', ad: 'Koli', adet: 1, version: 4 }], settings: [] });
    expect(getState().items[0].adet).toBe(9);
    applyServerResult({ op: 'upsert', table: 'kalemler', id: 'A', opId: 'x', patch: { adet: 9 } }, {
      ok: true, id: 'A', row: { id: 'A', tip: 'satinalma', ad: 'Koli', adet: 3, version: 5 },
      conflict: { keys: ['adet'], serverValues: { adet: 3 }, serverVersion: 4, updatedBy: 'gul' },
    });
    expect(getState().items[0].adet).toBe(3);
    expect(getState().conflicts[0]).toMatchObject({ id: 'A', keys: ['adet'], myValues: { adet: 9 }, serverValues: { adet: 3 }, updatedBy: 'gul' });
  });
  it('seçiciler silinmişleri dışlar', () => {
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [
      { id: 'A', tip: 'satinalma', ad: 'x' }, { id: 'B', tip: 'satinalma', ad: 'y', deleted_at: 't' }, { id: 'C', tip: 'tadilat', ad: 'z' },
    ], settings: [] });
    expect(selectActiveItems(getState()).map((i) => i.id)).toEqual(['A', 'C']);
    expect(selectByTip('satinalma')(getState()).map((i) => i.id)).toEqual(['A']);
  });
});
