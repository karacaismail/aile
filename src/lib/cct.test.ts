import { describe, it, expect } from 'vitest';
import { cctToRgb, cctGradient, cctLabel } from './cct';

describe('cct', () => {
  it('2700K sıcak (kırmızı > mavi), 6500K soğuk (mavi ≥ kırmızı), sınırlar clamp', () => {
    const warm = cctToRgb(2700); const cool = cctToRgb(6500);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(cool[2]).toBeGreaterThanOrEqual(cool[0] - 5);
    expect(cctToRgb(500)).toEqual(cctToRgb(1000));
    expect(cctToRgb(20000)).toEqual(cctToRgb(10000));
  });
  it('mavi kanal Kelvin ile monoton artar', () => {
    const ks = [2200, 2700, 3000, 4000, 5000, 6500];
    const blues = ks.map((k) => cctToRgb(k)[2]);
    for (let i = 1; i < blues.length; i++) expect(blues[i]).toBeGreaterThanOrEqual(blues[i - 1]);
  });
  it('gradyan ve etiket', () => {
    expect(cctGradient(2200, 6500)).toMatch(/^linear-gradient\(90deg, rgb\(/);
    expect(cctLabel(2200)).toBe('amber / mum');
    expect(cctLabel(4000)).toBe('nötr beyaz');
  });
});
