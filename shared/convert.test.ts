import { describe, it, expect } from 'vitest';
import { cellToValue, valueToCell, rowToRecord, recordToRow, headerIndex, missingHeaders, fingerprintOf } from './convert.ts';
import { ITEM_COLUMNS, ITEM_HEADERS, REQUIRED_ITEM_HEADERS } from './schema.ts';

describe('cellToValue / valueToCell', () => {
  it('sayı: boş → undefined, "12" → 12, 12 → 12, "1.250,5" → 1250.5', () => {
    expect(cellToValue('sayi', '')).toBeUndefined();
    expect(cellToValue('sayi', '12')).toBe(12);
    expect(cellToValue('sayi', 12)).toBe(12);
    expect(cellToValue('sayi', '1.250,5')).toBe(1250.5);
  });
  it('bool: TRUE/true/1 → true; FALSE/boş → false/undefined', () => {
    expect(cellToValue('bool', true)).toBe(true);
    expect(cellToValue('bool', 'TRUE')).toBe(true);
    expect(cellToValue('bool', 'FALSE')).toBe(false);
    expect(cellToValue('bool', '')).toBeUndefined();
    expect(valueToCell('bool', true)).toBe(true);
    expect(valueToCell('bool', undefined)).toBe('');
  });
  it('liste: satır sonu ile ayrılır, boşlar atılır', () => {
    expect(cellToValue('liste', 'a\nb\n\nc')).toEqual(['a', 'b', 'c']);
    expect(valueToCell('liste', ['a', 'b'])).toBe('a\nb');
    expect(cellToValue('liste', '')).toBeUndefined();
  });
  it('tarih: Date nesnesi sheet saat diliminde yyyy-MM-dd olur; metin olduğu gibi kalır', () => {
    const d = new Date(2099, 1, 20, 0, 0, 0); // 20 Şubat 2099 yerel saat
    expect(cellToValue('tarih', d)).toBe('2099-02-20');
    expect(cellToValue('tarih', '2099-02-20')).toBe('2099-02-20');
    expect(valueToCell('tarih', '2099-02-20')).toBe('2099-02-20');
  });
  it('tarihsaat: ISO metni olduğu gibi; Date → ISO', () => {
    expect(cellToValue('tarihsaat', '2026-10-26T09:41:00.000Z')).toBe('2026-10-26T09:41:00.000Z');
    expect(cellToValue('tarihsaat', new Date('2026-10-26T09:41:00.000Z'))).toBe('2026-10-26T09:41:00.000Z');
  });
});

describe('rowToRecord / recordToRow', () => {
  const headers = ['id', 'tip', 'ad', 'adet', 'linkler', 'mevcut', 'version'];
  it('başlık adına göre eşler (indeks değil) ve tip dönüşümü yapar', () => {
    const rec = rowToRecord(ITEM_COLUMNS, headers, ['01H', 'satinalma', 'Koli', '3', 'https://a\nhttps://b', 'TRUE', '2']);
    expect(rec).toEqual({ id: '01H', tip: 'satinalma', ad: 'Koli', adet: 3, linkler: ['https://a', 'https://b'], mevcut: true, version: 2 });
  });
  it('round-trip: kayıt → satır → kayıt aynıdır', () => {
    const rec = { id: 'x', tip: 'satinalma', ad: 'Örnek – ğüşçöÖĞİı', adet: 1, linkler: ['u'], mevcut: false, version: 1 };
    const row = recordToRow(ITEM_COLUMNS, headers, rec);
    expect(row).toHaveLength(headers.length);
    expect(rowToRecord(ITEM_COLUMNS, headers, row)).toEqual({ id: 'x', tip: 'satinalma', ad: 'Örnek – ğüşçöÖĞİı', adet: 1, linkler: ['u'], mevcut: false, version: 1 });
  });
  it('başlık taşınmışsa yine doğru sütuna yazar', () => {
    const shuffled = ['ad', 'version', 'id', 'tip'];
    const row = recordToRow(ITEM_COLUMNS, shuffled, { id: '1', tip: 'tadilat', ad: 'Boya', version: 5 });
    expect(row).toEqual(['Boya', 5, '1', 'tadilat']);
  });
});

describe('headerIndex / missingHeaders', () => {
  it('eksik zorunlu başlıkları bildirir', () => {
    expect(missingHeaders(['id', 'ad'], REQUIRED_ITEM_HEADERS)).toEqual(['tip', 'updated_at', 'version']);
    expect(missingHeaders(ITEM_HEADERS, REQUIRED_ITEM_HEADERS)).toEqual([]);
    expect(headerIndex(['a', 'b']).get('b')).toBe(1);
  });
});

describe('fingerprintOf', () => {
  it('aynı veri aynı parmak izi; değişen updated_at farklı', () => {
    const a = [{ id: '1', updated_at: '2026-01-01T00:00:00Z', version: 1 }, { id: '2', updated_at: '2026-01-02T00:00:00Z', version: 3 }];
    const b = [{ id: '1', updated_at: '2026-01-01T00:00:00Z', version: 1 }, { id: '2', updated_at: '2026-01-03T00:00:00Z', version: 4 }];
    expect(fingerprintOf(a, [])).toBe(fingerprintOf([...a], []));
    expect(fingerprintOf(a, [])).not.toBe(fingerprintOf(b, []));
  });
});
