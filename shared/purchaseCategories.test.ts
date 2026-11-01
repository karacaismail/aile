import { describe, expect, it } from 'vitest';
import { ITEM_COLUMNS, ITEM_HEADERS, KATEGORI, SETTING_COLUMNS, SETTING_HEADERS, type Item } from './schema';
import { applyBatch, createTableState, readState } from '../gas/src/core';
import { DEFAULT_FILTERS, activeFilterCount, filterPurchases, normalizeFilters, optionCounts } from '../src/data/selectors';

import { PURCHASE_CATEGORY_TREE, categoryCount, categorySelection, categoryValues, toggleCategorySelection } from './purchaseCategories';

const NOW = '2099-01-01T12:00:00.000Z';
const item = (id: string, kategori?: Item['kategori'], oda: Item['oda'] = 'mutfak'): Item => ({ id, ad: id, kategori, oda, tip: 'satinalma' });

describe('kalıcı satınalma kategorileri', () => {
  it('yeni alt kategoriler filtre yenilenince korunur, sanal ebeveynler kayıt değeri olmaz', () => {
    expect(normalizeFilters({ kategori: ['mutfak_kahve', 'calisma_elektronigi', 'group:mutfak', 'bilinmeyen', ''] }).kategori)
      .toEqual(['mutfak_kahve', 'calisma_elektronigi', '']);
  });
  it('yeni açık kategori GAS enum doğrulaması, gerçek satır yazımı ve okumadan geçer', () => {
    const st = { kalemler: createTableState(ITEM_COLUMNS, [...ITEM_HEADERS], []), ayarlar: createTableState(SETTING_COLUMNS, [...SETTING_HEADERS], []) };
    const res = applyBatch(st, { action: 'batch', actor: 'test', ops: [{ op: 'upsert', table: 'kalemler', id: 'SYNTH-DOCK', opId: 'test-1', patch: { tip: 'satinalma', ad: 'Masaüstü bağlantı istasyonu', kategori: 'calisma_elektronigi' } }] }, NOW);
    expect(res.ok).toBe(true);
    expect(readState(st, undefined, NOW)).toMatchObject({ items: [expect.objectContaining({ id: 'SYNTH-DOCK', kategori: 'calisma_elektronigi' })] });
    const invalid = applyBatch(st, { action: 'batch', actor: 'test', ops: [{ op: 'upsert', table: 'kalemler', id: 'SYNTH-DOCK', opId: 'test-2', patch: { kategori: 'group:mutfak' } }] }, NOW);
    expect(invalid.results[0].error).toBe('invalid_enum');
    expect(st.kalemler.rows[0].kategori).toBe('calisma_elektronigi');
  });
  it('yeni yapraklar sayımlarda görünür, adından farklı açık kategori korunur', () => {
    const rows = [item('Kahve istasyonu', 'calisma_elektronigi'), item('Kahve makinesi', 'mutfak_kahve'), item('WC fırçası', 'kopek'), item('Belirsiz')];
    expect([...optionCounts(rows, DEFAULT_FILTERS, 'kategori')]).toEqual([['kopek', 1], ['calisma_elektronigi', 1], ['mutfak_kahve', 1], ['', 1]]);
    expect(filterPurchases(rows, { ...DEFAULT_FILTERS, kategori: ['kopek'] }).map(x => x.id)).toEqual(['WC fırçası']);
    expect(KATEGORI).toContain('banyo_wc');
  });
});

describe('üst ve alt kategori seçimi', () => {
  it('bütün eski ve yeni kayıt kategorileri tek yaprakta keşfedilebilir; grup kimlikleri yazılamaz', () => {
    const leaves = PURCHASE_CATEGORY_TREE.flatMap(node => categoryValues(node.value));
    expect(new Set(leaves).size).toBe(leaves.length);
    expect([...leaves].sort()).toEqual([...KATEGORI].sort());
    expect(categoryValues('group:mutfak')).toEqual(expect.arrayContaining(['mutfak', 'mutfak_kahve', 'mutfak_kucuk_ev_aleti', 'mutfak_pisirme', 'mutfak_sofra']));
    expect(categoryValues('group:elektrik')).toEqual(expect.arrayContaining(['elektrik', 'aydinlatma_led', 'aydinlatma_akilli', 'elektrik_kablolama', 'elektrik_kontrol']));
    expect(categoryValues('group:duzenleme')).not.toContain('calisma_elektronigi');
    expect(categoryValues('bilinmeyen')).toEqual([]);
  });
  it('ebeveyn alt kodları seçer; çocuk çıkarınca kısmi olur, tekrar ebeveynle tamamlanır ve temizlenir', () => {
    const first = toggleCategorySelection(['kopek', ''], 'group:mutfak');
    expect(categorySelection(first, 'group:mutfak')).toBe('all');
    expect(first).not.toContain('group:mutfak');
    expect(first).toEqual(normalizeFilters({ kategori: first }).kategori);
    const partial = toggleCategorySelection(first, 'mutfak_kahve');
    expect(categorySelection(partial, 'group:mutfak')).toBe('mixed');
    expect(categorySelection(partial, 'group:kucuk_ev_aletleri')).toBe('mixed');
    expect(categorySelection(partial, 'mutfak_kahve')).toBe('none');
    const allAgain = toggleCategorySelection(partial, 'group:mutfak');
    expect(new Set(allAgain).size).toBe(allAgain.length);
    expect(categorySelection(allAgain, 'group:kucuk_ev_aletleri')).toBe('all');
    expect(toggleCategorySelection(allAgain, 'group:mutfak')).toEqual(['kopek', '']);
    expect(categorySelection([], 'bilinmeyen')).toBe('none');
    expect(toggleCategorySelection(['kopek'], 'bilinmeyen')).toEqual(['kopek']);
  });
  it('alt kategoriler OR, oda/durum/faz AND; ebeveyn sayısı kendi seçimini yok sayar ve çift saymaz', () => {
    const rows = [item('Espresso', 'mutfak_kahve'), item('Tabak', 'mutfak_sofra'), item('Eski mutfak', 'mutfak'), item('Dock', 'calisma_elektronigi', 'calisma'), item('Mutfak dışı', 'mutfak_kahve', 'calisma'), item('Belirsiz')];
    rows.forEach(i => { i.durum = 'karar'; i.faz = '1'; });
    rows.push({ ...item('Sonraki', 'mutfak_kahve'), faz: '2', durum: 'karar' });
    rows.push({ ...item('Sipariş', 'mutfak_sofra'), faz: '1', durum: 'siparis' });
    const f = { ...DEFAULT_FILTERS, faz: '1' as const, durum: ['karar'], oda: ['mutfak'], kategori: toggleCategorySelection([], 'group:mutfak') };
    expect(filterPurchases(rows, f).map(i => i.id)).toEqual(['Espresso', 'Tabak', 'Eski mutfak']);
    const partial = { ...f, kategori: toggleCategorySelection(f.kategori, 'mutfak_kahve') };
    expect(filterPurchases(rows, partial).map(i => i.id)).toEqual(['Tabak', 'Eski mutfak']);
    const counts = optionCounts(rows, partial, 'kategori');
    expect(categoryCount(counts, 'group:mutfak')).toBe(3);
    expect(categoryCount(counts, 'group:kucuk_ev_aletleri')).toBe(1);
    expect(categoryCount(counts, 'calisma_elektronigi')).toBe(0);
    expect(counts.get('')).toBe(1);
    expect(activeFilterCount(f)).toBe(f.kategori.length + 2);
    expect(activeFilterCount({ ...DEFAULT_FILTERS })).toBe(0);
    expect(filterPurchases(rows, { ...partial, kategori: [] }).map(i => i.id)).toEqual(['Espresso', 'Tabak', 'Eski mutfak', 'Belirsiz']);
    expect(categoryCount(new Map(), 'group:mutfak')).toBe(0);
  });
});
