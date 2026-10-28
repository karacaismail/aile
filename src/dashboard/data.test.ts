import { describe, expect, it } from 'vitest';
import { parseGviz, buildBudget, money, percentChange } from './data';
import { gviz, syntheticSheets } from './fixtures';

describe('new budget Sheet contract', () => {
  it('reads numbers, explicit zero and missing prices without conflating them', () => {
    const raw = syntheticSheets();
    const data = buildBudget(raw);
    expect(data.months).toHaveLength(3);
    expect(data.months[0].income.current).toBe(10000);
    expect(data.months[0].source).toBe('Plandan');
    expect(data.irregular[1].current).toBeNull();
    expect(data.irregular[2].current).toBe(0);
    expect(data.categories.find(c => c.label === 'Fatura A')?.current).toEqual([4000,4000,4000]);
  });
  it('rejects inconsistent multi-tab snapshots instead of showing mixed totals', () => {
    const raw = syntheticSheets(); raw.actual[4][1] = 12345;
    expect(() => buildBudget(raw)).toThrow(/tutarlı/);
  });
  it('rejects missing required totals and shifted sections', () => {
    const raw = syntheticSheets(); raw.summary[0][2] = null as never;
    expect(() => buildBudget(raw)).toThrow();
    const changed = syntheticSheets(); changed.plan[4][0] = 'Başka satır';
    expect(() => buildBudget(changed)).toThrow(/şema/);
  });
  it('parses the documented wrapper without executing scripts', () => {
    expect(parseGviz(gviz([['Örnek', -250, null, 0]]))).toEqual([['Örnek', -250, null, 0]]);
    expect(() => parseGviz('alert(1)')).toThrow();
    expect(() => parseGviz(gviz([[1]]).replace('"ok"', '"error"'))).toThrow();
  });
  it('always renders minus signs and handles a zero comparison baseline', () => {
    expect(money(-1250)).toContain('-1.250');
    expect(money(null)).toBe('Tutar yok');
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(80, 100)).toBe(-20);
  });
});
it('rejects a missing category heading instead of swallowing previous sections', () => {
  const raw=syntheticSheets();raw.plan[27-12][0]='';
  expect(()=>buildBudget(raw)).toThrow(/şema/);
});
it('rejects a newer irregular feed mixed with older monthly totals',()=>{
 const raw=syntheticSheets();raw.irregular[0][3]=900;
 expect(()=>buildBudget(raw)).toThrow(/tutarlı/);
});
