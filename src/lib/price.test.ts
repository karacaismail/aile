import { describe, it, expect } from 'vitest';
import { formatTl, formatTlRange, kompakt } from './price';

describe('formatTl', () => {
  it('tam sayı binlik ayraçlı, kuruşlu iki basamak', () => {
    expect(formatTl(5000)).toBe('₺5.000');
    expect(formatTl(1250.5)).toBe('₺1.250,50');
    expect(formatTl(0)).toBe('₺0');
    expect(formatTl(null)).toBe('—');
    expect(formatTl(undefined, { dash: '?' })).toBe('?');
  });
  it('aralık', () => {
    expect(formatTlRange(6000, 7000)).toBe('₺6.000–7.000');
    expect(formatTlRange(5000, 5000)).toBe('₺5.000');
    expect(formatTlRange(undefined, 900)).toBe('₺900');
    expect(formatTlRange(null, null)).toBe('—');
  });
  it('kompakt', () => {
    expect(kompakt(527555)).toBe('527,6 bin');
    expect(kompakt(1_250_000)).toBe('1,25 M');
    expect(kompakt(800)).toBe('800');
  });
});
