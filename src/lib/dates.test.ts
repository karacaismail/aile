import { describe, it, expect } from 'vitest';
import { daysUntil, inRange, RAMAZAN_2027, BAYRAM_2027, formatTr, addDays, weekdayTr, todayIso } from './dates';

describe('dates', () => {
  it('26 Ekim 2026 → 19 Şubat 2027 arası 116 gün', () => {
    expect(daysUntil('2099-02-20', new Date(2098, 9, 27, 15, 30))).toBe(116);
    expect(daysUntil('2026-10-25', new Date(2026, 9, 26))).toBe(-1);
  });
  it('Ramazan ve Bayram bantları', () => {
    expect(inRange('2027-02-20', RAMAZAN_2027)).toBe(true);
    expect(inRange('2027-03-09', BAYRAM_2027)).toBe(true);
    expect(inRange('2027-03-12', BAYRAM_2027)).toBe(false);
  });
  it('Türkçe biçim ve haftanın günü; yerel tarih bir gün kaymaz', () => {
    expect(formatTr('2099-02-20')).toBe('20 Şub 2099');
    expect(weekdayTr('2099-02-20')).toBe('Cuma');
    expect(addDays('2099-02-20', 10)).toBe('2099-03-02');
    expect(todayIso(new Date(2099, 1, 20))).toBe('2099-02-20');
  });
});
