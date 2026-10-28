import { describe, it, expect } from 'vitest';
import type { BudgetPlan, CashEntry } from '@shared/schema';
import { monthSummary, kalemOptions, recentKalems, quickKalems, shiftMonth, monthLabel, OTHER_GROUP } from './rules';

const months = (n: number) => Array(12).fill(n) as number[];
const PLAN: BudgetPlan = {
  year: 2099,
  groups: [
    { name: 'BORÇLAR', rows: [{ label: 'Kredi A', plan: months(1000) }, { label: 'Kapanan', plan: months(0) }] },
    { name: 'DİĞERLERİ', rows: [{ label: 'Market ', plan: months(300) }, { label: 'Okul', plan: [0, 0, 500, ...months(500).slice(3)] }] },
  ],
};
const e = (id: string, tarih: string, tutar: number, kalem: string, extra: Partial<CashEntry> = {}): CashEntry => ({ id, tarih, tutar, kalem, created_at: `${tarih}T10:00:00Z`, ...extra });

describe('ay yardımcıları', () => {
  it('ay kaydırma yıl sınırını geçer; etiket Türkçe', () => {
    expect(shiftMonth('2099-12', 1)).toBe('2100-01');
    expect(shiftMonth('2099-01', -1)).toBe('2098-12');
    expect(monthLabel('2099-02')).toBe('Şubat 2099');
  });
});

describe('monthSummary', () => {
  const cash = [
    e('1', '2099-01-03', 120, 'Market'),
    e('2', '2099-01-09', 80.5, ' Market'),
    e('3', '2099-01-10', 999, 'Market', { deleted_at: 'x' }),
    e('4', '2099-02-01', 50, 'Market'),
    e('5', '2099-01-12', 40, 'Hediye'),
  ];
  it('plan × günlük: sıfır planlı kayıtsız satır gizlenir, planda olmayan ayrı grupta, silinen sayılmaz', () => {
    const s = monthSummary(PLAN, cash, '2099-01');
    expect(s.hasPlan).toBe(true);
    expect(s.groups.map((g) => g.name)).toEqual(['BORÇLAR', 'DİĞERLERİ', OTHER_GROUP]);
    expect(s.groups[0].rows).toEqual([{ label: 'Kredi A', plan: 1000, actual: 0, count: 0 }]);
    expect(s.groups[1].rows).toEqual([{ label: 'Market', plan: 300, actual: 200.5, count: 2 }]);
    expect(s.groups[2].rows).toEqual([{ label: 'Hediye', plan: 0, actual: 40, count: 1 }]);
    expect(s.plan).toBe(1300);
    expect(s.actual).toBe(240.5);
    expect(s.entries.map((x) => x.id)).toEqual(['5', '2', '1']);
  });
  it('plan yılı dışındaki ayda plan sıfır, kayıtlar yine görünür', () => {
    const s = monthSummary(PLAN, [e('9', '2098-10-01', 10, 'Market')], '2098-10');
    expect(s.hasPlan).toBe(false);
    expect(s.plan).toBe(0);
    expect(s.groups).toEqual([{ name: 'DİĞERLERİ', plan: 0, actual: 10, rows: [{ label: 'Market', plan: 0, actual: 10, count: 1 }] }]);
  });
  it('plan yoksa yalnız kayıtlar', () => {
    const s = monthSummary(undefined, [e('9', '2099-01-01', 10, 'Market')], '2099-01');
    expect(s.groups[0].name).toBe(OTHER_GROUP);
  });
});

describe('kalem seçenekleri', () => {
  it('plan sırasıyla, tekrarsız; günlükte geçen yabancı kalem sona', () => {
    expect(kalemOptions(PLAN, [e('1', '2099-01-01', 1, 'Hediye'), e('2', '2099-01-01', 1, 'Market')]).map((o) => o.label))
      .toEqual(['Kredi A', 'Kapanan', 'Market', 'Okul', 'Hediye']);
  });
  it('son kullanılanlar önce; kalan yer planın büyük satırlarıyla dolar; seçili her zaman görünür', () => {
    const cash = [e('1', '2099-01-01', 1, 'Okul'), e('2', '2099-01-05', 1, 'Market')];
    expect(recentKalems(cash)).toEqual(['Market', 'Okul']);
    expect(quickKalems(PLAN, cash, undefined, 1, 3)).toEqual(['Market', 'Okul', 'Kredi A']);
    expect(quickKalems(PLAN, [], 'Kapanan', 1, 2)).toEqual(['Kapanan', 'Kredi A']);
  });
});
