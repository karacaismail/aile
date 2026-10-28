import { describe, it, expect } from 'vitest';
import { createTableState, applyBatch, readState, validateEnums, parsePlan, actualFormula, planCopyFormula, type TableState } from './core.ts';
import { ITEM_COLUMNS, ITEM_HEADERS, SETTING_COLUMNS, SETTING_HEADERS, CASH_COLUMNS, CASH_HEADERS } from '../../shared/schema.ts';

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

describe('createTableState', () => {
  it('onay kutusu FALSE değerleriyle dolu boş satırlar kayıt sayılmaz', () => {
    const headers = ['id', 'tip', 'ad', 'mevcut', 'karar_bekliyor', 'version'];
    const st = createTableState(ITEM_COLUMNS, headers, [
      ['', '', '', false, false, ''],
      ['', 'satinalma', 'Elle eklenen', false, false, ''],
      ['', '', '', '', '', ''],
    ], 2, NOW);
    expect(st.rows).toHaveLength(1);
    expect(st.rows[0]).toMatchObject({ tip: 'satinalma', ad: 'Elle eklenen', version: 0 });
    expect(st.sheetRows).toEqual([3]);
    expect(st.dirty.has(0)).toBe(true);
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

describe('nakit (harcama günlüğü)', () => {
  it('yeni kayıt tarih+tutar+kalem ister; sekme yoksa tablo reddedilir', () => {
    const st = { ...fresh(), nakit: createTableState(CASH_COLUMNS, [...CASH_HEADERS], []) };
    const bad = applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'upsert', table: 'nakit', id: 'N1', opId: 'O1', patch: { tutar: 100 } }] }, NOW);
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/tarih, kalem/);
    const ok = applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'upsert', table: 'nakit', id: 'N1', opId: 'O2', patch: { tarih: '2099-01-05', tutar: 120.5, kalem: 'Mutfak' } }] }, NOW);
    expect(ok.ok).toBe(true);
    expect(readState(st, undefined, NOW)).toMatchObject({ cash: [expect.objectContaining({ id: 'N1', tutar: 120.5, kalem: 'Mutfak' })] });
    const none = applyBatch(fresh(), { action: 'batch', actor: 'a', ops: [{ op: 'upsert', table: 'nakit', id: 'N1', opId: 'O3', patch: { tarih: '2099-01-05', tutar: 1, kalem: 'x' } }] }, NOW);
    expect(none.ok).toBe(false);
    expect(readState(fresh(), undefined, NOW)).not.toHaveProperty('cash');
  });

  it('parmak izi günlük ve plan değişince değişir', () => {
    const st = { ...fresh(), nakit: createTableState(CASH_COLUMNS, [...CASH_HEADERS], []) };
    const fp1 = readState(st, undefined, NOW).fingerprint;
    applyBatch(st, { action: 'batch', actor: 'a', ops: [{ op: 'upsert', table: 'nakit', id: 'N1', opId: 'O1', patch: { tarih: '2099-01-05', tutar: 1, kalem: 'x' } }] }, NOW);
    const fp2 = readState(st, undefined, NOW).fingerprint;
    expect(fp2).not.toBe(fp1);
    const withPlan = { ...st, plan: { groups: [{ name: 'G', rows: [{ label: 'x', plan: Array(12).fill(1) }] }] } };
    expect(readState(withPlan, undefined, NOW).fingerprint).not.toBe(fp2);
  });
});

describe('parsePlan', () => {
  const months = ['OCA', 'ŞUB', 'MAR', 'NİS', 'MAY', 'HAZ', 'TEM', 'AĞU', 'EYL', 'EKİ', 'KAS', 'ARA'];
  const vals = (n: number) => Array(12).fill(n);
  const grid = [
    ['', '', ...months],
    [],
    ['', 'BORÇLAR', ...months],
    ['', 'Kredi A', ...vals(1000)],
    ['', 'Vergi', '₺500', ...vals(500).slice(1)],
    ['', 'TOPLAMLAR', ...vals(1500)],
    [],
    ['', 'DİĞERLERİ', ...months],
    ['', 'Mutfak ', ...vals(200)],
    ['', 'TOPLAMLAR', ...vals(200)],
    [],
    ['', 'TOPLAMLAR', ...vals(1700)],
    ['', '', ...months],
    ['', 'Başka tablo', ...vals(9)],
  ];
  it('grupları, satırları ve sheet satır numaralarını çıkarır; toplamları ve ikinci tabloyu atlar', () => {
    const { plan, layout } = parsePlan(grid, 2099);
    expect(plan.year).toBe(2099);
    expect(plan.groups.map((g) => g.name)).toEqual(['BORÇLAR', 'DİĞERLERİ']);
    expect(plan.groups[0].rows).toEqual([{ label: 'Kredi A', plan: vals(1000) }, { label: 'Vergi', plan: vals(500) }]);
    expect(plan.groups[1].rows[0].label).toBe('Mutfak');
    expect(layout).toEqual([
      { label: 'Kredi A', group: 'BORÇLAR', sheetRow: 4 },
      { label: 'Vergi', group: 'BORÇLAR', sheetRow: 5 },
      { label: 'Mutfak', group: 'DİĞERLERİ', sheetRow: 9 },
    ]);
  });
});

describe('actualFormula', () => {
  it('başlık konumundan sütun harfi üretir; kayıtsız ay plana düşer', () => {
    const f = actualFormula({ cashSheet: 'app_nakit', cashHeaders: [...CASH_HEADERS], planSheet: 'Giderler Planlanan', panoYearCell: "'Pano'!$C$2", sheetRow: 24, month: 3 });
    expect(f).toContain("'app_nakit'!$D$2:$D,TRIM($B24)");
    expect(f).toContain("'app_nakit'!$B$2:$B,'Pano'!$C$2&\"-03*\"");
    expect(f).toContain("SUMIFS('app_nakit'!$C$2:$C,");
    expect(f).toContain("'app_nakit'!$I$2:$I,\"\"");
    expect(f).toContain("p,'Giderler Planlanan'!E24");
    expect(f).toMatch(/IF\(n=0,p,IF\(DATE\('Pano'!\$C\$2,3\+1,1\)<=TODAY\(\),a,MAX\(a,p\)\)\)\)$/);
    expect(planCopyFormula('Giderler Planlanan', 24, 12)).toBe("='Giderler Planlanan'!N24");
  });
});
