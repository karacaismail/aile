import { describe, it, expect } from 'vitest';
import { seedId, csvToItems, planToItems, applyOverrides, validateAll } from './seed.ts';

const CSV = `sıra,,Eşya,When?,,,,,,
101,TRUE,"Boş koli, balonlu ambalaj",,"₺1.000,00",,,,,
105,FALSE,Soğutucu cihaz,2,"₺2.000,00",Model X,,,,
,FALSE,Fikir kalemi,,?,,,,,
`;

describe('seedId', () => {
  it('deterministik ve 26 karakter', () => {
    expect(seedId('SEED', '101|Koli')).toBe(seedId('SEED', '101|Koli'));
    expect(seedId('SEED', '101|Koli')).not.toBe(seedId('SEED', '102|Koli'));
    expect(seedId('PLAN', 'L1')).toMatch(/^01PLAN[0-9A-Z]{20}$/);
  });
});

describe('csvToItems + overrides', () => {
  it('CSV satırları kaleme döner, override uygulanır, idempotent id', () => {
    const items = csvToItems(CSV, { overrides: [{ match: 'soğutucu', patch: { not: 'ikinci cihaz', faz: '2' } }] });
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ kod: '101', faz: '1', tahmini_tl_min: 1000 });
    expect(items[1]).toMatchObject({ kod: '105', faz: '2', not: 'ikinci cihaz' });
    expect(items[2]).toMatchObject({ faz: '2', karar_bekliyor: true, durum: 'fikir' });
    expect(csvToItems(CSV)[0].id).toBe(items[0].id);
  });
  it('applyOverrides Türkçe küçük harf duyarsız', () => {
    expect(applyOverrides({ id: 'x', tip: 'satinalma', ad: 'KARYOLA SOMYASI' }, [{ match: 'somya', patch: { karar_bekliyor: true } }]).karar_bekliyor).toBe(true);
  });
});

describe('planToItems / validateAll', () => {
  it('bagli_kodlar id\'ye çözülür; enum doğrulanır', () => {
    const csv = csvToItems(CSV);
    const plan = planToItems([{ kod: 'L1', tip: 'satinalma', ad: 'Köprü', bagli_kodlar: ['101', 'L2'] }, { kod: 'L2', tip: 'aydinlatma', ad: 'Katman', oda: 'salon', katman_tur: 'ana' }], csv);
    expect(plan[0].bagli_idler).toEqual([csv[0].id, plan[1].id]);
    expect(validateAll(plan as never)).toEqual([]);
    expect(validateAll([{ id: 'a', tip: 'satinalma', ad: 'x', durum: 'yanlis' }])).toHaveLength(1);
    expect(validateAll([{ id: 'a', tip: 'satinalma', ad: 'x', bilinmeyen: 1 }])[0]).toContain('bilinmeyen alan');
  });
});
