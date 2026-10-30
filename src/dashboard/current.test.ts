import { expect, it } from 'vitest';
import { sheetMonthKey } from './current';

it('reads real Sheet dates and compact Turkish month labels without executing date strings', () => {
  expect(sheetMonthKey('Date(2098,10,1)')).toBe('2098-11');
  expect(sheetMonthKey('2098-11-10')).toBe('2098-11');
  const serial = (Date.UTC(2098, 10, 1) - Date.UTC(1899, 11, 30)) / 86400000;
  expect(sheetMonthKey(serial)).toBe('2098-11');
  expect(sheetMonthKey("Kas'98")).toBe('2098-11');
  expect(sheetMonthKey("Oc’99")).toBe('2099-01');
  expect(sheetMonthKey('Kasım 2098')).toBe('2098-11');
  for (const value of ['#REF!', 'Date(2098,13,1)', '2098-02-31', null, true, Infinity]) expect(() => sheetMonthKey(value)).toThrow();
});

import { buildCurrentBudget, isCurrentBudget } from './current';
import { syntheticCurrentSheets } from './currentFixtures';

it('reconciles the cashflow schema by labels even when actual rows shift', () => {
  const raw = syntheticCurrentSheets();
  raw.actual.splice(3, 0, [null]);
  const budget = buildCurrentBudget(raw);
  expect(isCurrentBudget(raw.plan)).toBe(true);
  expect(budget.schema).toBe('cashflow');
  expect(budget.months.map(month => month.key)).toEqual(['2098-11', '2098-12', '2099-01']);
  expect(budget.months[0]).toMatchObject({ income: { plan: 10000, current: 10000 }, expense: { plan: 4000, current: 4000 }, saving: { plan: 2000, current: 2000 }, free: { plan: 4000, current: 4000 }, balance: { plan: 4000, current: 4000 } });
  expect(budget.categories.filter(row => row.kind === 'saving')).toHaveLength(1);
  expect(budget.irregular[0]).toMatchObject({ id: 'TEST-1', plan: 500, current: 500, manual: true, planMonth: 'Aralık 2098', month: 'Aralık 2098', status: 'Planlı', room: 'Çalışma odası' });
  expect(budget.irregular[1].current).toBeNull();
  expect(budget.irregular[2].current).toBe(0);
});

it('rejects source mismatches and missing required values rather than synthesizing zero', () => {
  const raw = syntheticCurrentSheets();
  raw.summary[0][4] = 3000;
  expect(() => buildCurrentBudget(raw)).toThrow(/tutarlı/);
  const missing = syntheticCurrentSheets(); missing.summary[0][2] = null;
  expect(() => buildCurrentBudget(missing)).toThrow(/eksik/);
  const badDate = syntheticCurrentSheets(); badDate.plan[0][1] = '#REF!';
  expect(() => buildCurrentBudget(badDate)).toThrow(/tarih/);
  const badId = syntheticCurrentSheets(); badId.irregular[1][14] = '';
  expect(() => buildCurrentBudget(badId)).toThrow(/kimliği/);
  const badSchema = syntheticCurrentSheets(); badSchema.irregular[0][5] = 'Bilinmeyen';
  expect(() => buildCurrentBudget(badSchema)).toThrow(/sütunları/);
});

it('rejects misaligned cash months and formula errors inside category or irregular cells', () => {
  const shifted = syntheticCurrentSheets(); shifted.cash[0][1] = '2098-12-01';
  expect(() => buildCurrentBudget(shifted)).toThrow(/tutarlı/);
  const broken = syntheticCurrentSheets(); broken.plan.find(row => row[0] === 'Fatura A')![1] = '#REF!';
  expect(() => buildCurrentBudget(broken)).toThrow(/hatalı/);
  const brokenItem = syntheticCurrentSheets(); brokenItem.irregular[2][5] = '#N/A';
  expect(() => buildCurrentBudget(brokenItem)).toThrow(/hatalı/);
});
it('rejects a one-cent bridge mismatch rather than presenting inconsistent native balances', () => {
  const raw = syntheticCurrentSheets();
  raw.summary[0][10] = Number(raw.summary[0][10]) + .01;
  expect(() => buildCurrentBudget(raw)).toThrow(/tutarlı/);
});
