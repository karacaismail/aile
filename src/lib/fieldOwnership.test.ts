import { describe, expect, it } from 'vitest';
import { fieldOwnership } from './fieldOwnership';

// Post-implementation coverage of the pure helper; the behaviour's RED was executed in purchase.test.tsx first.
describe('fieldOwnership', () => {
  const initial = { not: 'İlk', durum: 'karar', linkler: [] as string[], fiyat: null as number | null };
  it('owns only fields the user changed; a newer server value on an untouched field is not the user\'s', () => {
    expect(fieldOwnership(initial, { ...initial, not: 'Benim' }, { ...initial, durum: 'siparis' })).toEqual({ changed: ['not'], conflicts: [] });
  });
  it('reports a conflict only when the server moved the same field to a different value', () => {
    expect(fieldOwnership(initial, { ...initial, not: 'Benim' }, { ...initial, not: 'Sunucu' })).toEqual({ changed: ['not'], conflicts: ['not'] });
    expect(fieldOwnership(initial, { ...initial, not: 'Aynı' }, { ...initial, not: 'Aynı' })).toEqual({ changed: ['not'], conflicts: [] });
  });
  it('keeps unknown distinct from zero and compares arrays by value', () => {
    expect(fieldOwnership(initial, { ...initial, fiyat: 0 }, initial).changed).toEqual(['fiyat']);
    expect(fieldOwnership(initial, { ...initial, linkler: [] }, initial).changed).toEqual([]);
    expect(fieldOwnership(initial, { ...initial, linkler: ['a'] }, { ...initial, linkler: ['b'] }).conflicts).toEqual(['linkler']);
  });
});
