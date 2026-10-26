import { describe, it, expect } from 'vitest';
import { createTableState, applyBatch, readState, validateEnums, type TableState } from './core.ts';
import { ITEM_COLUMNS, ITEM_HEADERS, SETTING_COLUMNS, SETTING_HEADERS } from '../../shared/schema.ts';

const NOW = '2026-10-26T12:00:00.000Z';
const LATER = '2026-10-26T12:05:00.000Z';

function fresh(): { kalemler: TableState; ayarlar: TableState } {
  return {
    kalemler: createTableState(ITEM_COLUMNS, [...ITEM_HEADERS], []),
    ayarlar: createTableState(SETTING_COLUMNS, [...SETTING_HEADERS], []),
  };
}

describe('validateEnums', () => {
  it('geçersiz enum değerini alan ve izinli listeyle bildirir', () => {
    const err = validateEnums(ITEM_COLUMNS, { tip: 'satinalma', durum: 'yanlis' });
    expect(err).toEqual({ field: 'durum', allowed: expect.arrayContaining(['fikir', 'karar']) });
    expect(validateEnums(ITEM_COLUMNS, { tip: 'satinalma', durum: 'karar', kim: ['E', 'K'] })).toBeNull();
    expect(validateEnums(ITEM_COLUMNS, { kim: ['E', 'Z'] })).toEqual({ field: 'kim', allowed: expect.any(Array) });
  });
});

describe('applyBatch', () => {
  it('insert: yeni satır eklenir, meta alanları sunucu doldurur', () => {
    const st = fresh();
    const res = applyBatch(st, { action: 'batch', actor: 'test-cihaz', ops: [
      { op: 'upsert', table: 'kalemler', id: 'ID1', opId: 'OP1', patch: { tip: 'satinalma', ad: 'Koli', adet: 2 } },
    ] }, NOW);
    expect(res.ok).toBe(true);
    expect(res.doneCount).toBe(1);
    const row = res.results[0].row!;
    expect(row).toMatchObject({ id: 'ID1', tip: 'satinalma', ad: 'Koli', adet: 2, version: 1, updated_by: 'test-cihaz', created_at: NOW, updated_at: NOW, son_op_id: 'OP1' });
    expect(row.son_degisen_alanlar).toEqual(['tip', 'ad', 'adet']);
    expect(st.kalemler.rows).toHaveLength(1);
    expect(st.kalemler.dirty.has(0)).toBe(true);
  });

  it('aynı opId ikinci kez gelirse uygulanmaz (idempotent) ve duplicate=true döner', () => {
    const st = fresh();
    const op = { op: 'upsert' as const, table: 'kalemler' as const, id: 'ID1', opId: 'OP1', patch: { tip: 'satinalma', ad: 'Koli', adet: 2 } };
    applyBatch(st, { action: 'batch', actor: 'a', ops: [op] }, NOW);
    const res2 = applyBatch(st, { action: 'batch', actor: 'a', ops: [{ ...op, patch: { adet: 99 } }] }, LATER);
    expect(res2.results[0].duplicate).toBe(true);
    expect(res2.results[0].row?.adet).toBe(2);
    expect(res2.results[0].row?.version).toBe(1);
  });

  it('patch: yalnız gönderilen alanlar değişir, version artar', () => {
    const st = fresh();
    applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'upsert', table: 'kalemler', id: 'ID1', opId: 'OP1', patch: { tip: 'satinalma', ad: 'Koli', adet: 2, not: 'ilk' } }] }, NOW);
    const res = applyBatch(st, { action: 'batch', actor: 'b', ops: [{ op: 'upsert', table: 'kalemler', id: 'ID1', opId: 'OP2', baseVersion: 1, patch: { adet: 5 } }] }, LATER);
    expect(res.results[0].row).toMatchObject({ adet: 5, not: 'ilk', version: 2, updated_by: 'b', updated_at: LATER, created_at: NOW, son_degisen_alanlar: ['adet'] });
  });

  it('çakışma: eski baseVersion ve son yazımla kesişen alan → o alan uygulanmaz, conflict döner', () => {
    const st = fresh();
    applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'upsert', table: 'kalemler', id: 'ID1', opId: 'OP1', patch: { tip: 'satinalma', ad: 'Koli', adet: 2 } }] }, NOW);
    // Başka bir cihaz Sheets'ten adet'i 3 yaptı (version 2)
    applyBatch(st, { action: 'batch', actor: 'gul', ops: [{ op: 'upsert', table: 'kalemler', id: 'ID1', opId: 'OP2', baseVersion: 1, patch: { adet: 3 } }] }, LATER);
    // Telefon hâlâ version 1 sanıyor, adet=7 ve not='x' gönderiyor
    const res = applyBatch(st, { action: 'batch', actor: 'tel', ops: [{ op: 'upsert', table: 'kalemler', id: 'ID1', opId: 'OP3', baseVersion: 1, patch: { adet: 7, not: 'x' } }] }, LATER);
    const r = res.results[0];
    expect(r.ok).toBe(true);
    expect(r.conflict).toEqual({ keys: ['adet'], serverValues: { adet: 3 }, serverVersion: 2, updatedBy: 'gul', updatedAt: LATER });
    expect(r.row).toMatchObject({ adet: 3, not: 'x', version: 3 });
  });

  it('baseVersion güncelse kesişen alan bile sorunsuz uygulanır', () => {
    const st = fresh();
    applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'upsert', table: 'kalemler', id: 'ID1', opId: 'OP1', patch: { tip: 'satinalma', ad: 'Koli', adet: 2 } }] }, NOW);
    const res = applyBatch(st, { action: 'batch', actor: 'b', ops: [{ op: 'upsert', table: 'kalemler', id: 'ID1', opId: 'OP2', baseVersion: 1, patch: { adet: 9 } }] }, LATER);
    expect(res.results[0].conflict).toBeUndefined();
    expect(res.results[0].row?.adet).toBe(9);
  });

  it('delete/restore: deleted_at set edilir / temizlenir; bilinmeyen id → not_found ve batch durur', () => {
    const st = fresh();
    applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'upsert', table: 'kalemler', id: 'ID1', opId: 'OP1', patch: { tip: 'satinalma', ad: 'Koli' } }] }, NOW);
    const del = applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'delete', table: 'kalemler', id: 'ID1', opId: 'OP2' }] }, LATER);
    expect(del.results[0].row?.deleted_at).toBe(LATER);
    const rest = applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'restore', table: 'kalemler', id: 'ID1', opId: 'OP3' }] }, LATER);
    expect(rest.results[0].row?.deleted_at).toBeUndefined();
    const nf = applyBatch(st, { action: 'batch', actor: 'a', ops: [
      { op: 'delete', table: 'kalemler', id: 'YOK', opId: 'OP4' },
      { op: 'upsert', table: 'kalemler', id: 'ID2', opId: 'OP5', patch: { tip: 'satinalma', ad: 'Sonraki' } },
    ] }, LATER);
    expect(nf.ok).toBe(false);
    expect(nf.doneCount).toBe(0);
    expect(nf.results[0].error).toBe('not_found');
    expect(st.kalemler.rows).toHaveLength(1);
  });

  it('geçersiz enum → invalid_enum, satır yazılmaz', () => {
    const st = fresh();
    const res = applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'upsert', table: 'kalemler', id: 'ID1', opId: 'OP1', patch: { tip: 'satinalma', ad: 'Koli', faz: '9' } }] }, NOW);
    expect(res.results[0].error).toBe('invalid_enum');
    expect(st.kalemler.rows).toHaveLength(0);
  });

  it('insert için tip ve ad zorunlu → bad_request', () => {
    const st = fresh();
    const res = applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'upsert', table: 'kalemler', id: 'ID1', opId: 'OP1', patch: { adet: 1 } }] }, NOW);
    expect(res.results[0].error).toBe('bad_request');
  });

  it('ayarlar tablosuna da yazılır', () => {
    const st = fresh();
    const res = applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'upsert', table: 'ayarlar', id: 'S1', opId: 'OP1', patch: { tip: 'tarih', anahtar: 'tasinma', deger: '2099-02-20' } }] }, NOW);
    expect(res.results[0].row).toMatchObject({ tip: 'tarih', anahtar: 'tasinma', deger: '2099-02-20', version: 1 });
  });
});

describe('readState', () => {
  it('parmak izi değişmediyse notModified', () => {
    const st = fresh();
    applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'upsert', table: 'kalemler', id: 'ID1', opId: 'OP1', patch: { tip: 'satinalma', ad: 'Koli' } }] }, NOW);
    const full = readState(st, undefined, NOW);
    expect(full.notModified).toBeFalsy();
    if (!full.notModified) expect(full.items).toHaveLength(1);
    const nm = readState(st, full.fingerprint, NOW);
    expect(nm.notModified).toBe(true);
  });
});
