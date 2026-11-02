import { describe, expect, it } from 'vitest';
import type { TutarBilgisi } from '../contract';
import { KesintiPlani } from './KesintiPlani';
import { kisa } from './testDestek';

const bilinen = (tl: string): TutarBilgisi => ({ tur: 'bilinen', tl, kaynak: 'test' });
const plan = (borc: TutarBilgisi, aylik: TutarBilgisi = bilinen('25000.00'), ek: Partial<Parameters<typeof KesintiPlani.olustur>[0]> = {}) =>
  KesintiPlani.olustur({ oran: 0.1, tavan: 0.25, borc, aylik, gecikmeAylikOran: null, gecikmeAySayisi: 0, ...ek });

describe('KesintiPlani (ödenmeyen Bağ-Kur borcu)', () => {
  it('her ay oran × aylık keser ve borç bitince durur', () => {
    const p = plan(bilinen('250000.00'))!;
    expect(kisa(p.aylikKesinti().bilgi())).toBe('2500.00');
    expect(p.sureAy()).toEqual({ alt: 100, ust: 100 });
    expect(kisa(p.toplam(0).bilgi())).toBe('0.00');
    expect(kisa(p.toplam(10).bilgi())).toBe('25000.00');
    expect(kisa(p.toplam(100).bilgi())).toBe('250000.00');
    expect(kisa(p.toplam(150).bilgi())).toBe('250000.00');
    expect(p.ozet()).toMatchObject({ oran: 0.1, sureAy: 100 });
  });

  it('son ayda yalnız kalan borcu keser', () => {
    const p = plan(bilinen('251000.00'))!;
    expect(p.sureAy()).toEqual({ alt: 101, ust: 101 });
    expect(kisa(p.toplam(100).bilgi())).toBe('250000.00');
    expect(kisa(p.toplam(101).bilgi())).toBe('251000.00');
    expect(kisa(p.toplam(500).bilgi())).toBe('251000.00');
  });

  it('borç aralıksa süre ve toplam alt/üst ayrı hesaplanır', () => {
    const p = plan({ tur: 'aralik', altTl: '250000.00', ustTl: '400000.00', kaynak: 'test' })!;
    expect(p.sureAy()).toEqual({ alt: 100, ust: 160 });
    expect(kisa(p.toplam(120).bilgi())).toEqual(['250000.00', '300000.00']);
    const o = p.ozet();
    expect(o.sureAy).toBe(160);
    expect(o.neden).toContain('100');
    expect(o.neden).toContain('160');
  });

  it('borç bilinmiyorsa süre ve toplam bilinmiyor; neden taşınır', () => {
    const p = plan({ tur: 'bilinmiyor', neden: 'Düzeltilmiş borç yok' })!;
    expect(p).not.toBeNull();
    expect(p.sureAy()).toBeNull();
    expect(p.toplam(5).bilgi()).toMatchObject({ tur: 'bilinmiyor' });
    expect(p.ozet().sureAy).toBeNull();
    expect(p.ozet().neden).toContain('Düzeltilmiş borç yok');
  });

  it('aylık bilinmiyorsa süre bilinmiyor', () => {
    const p = plan(bilinen('250000.00'), { tur: 'bilinmiyor', neden: 'Elle aylık girilmedi' })!;
    expect(p.sureAy()).toBeNull();
    expect(p.ozet().neden).toContain('Elle aylık girilmedi');
  });

  it('gecikme oranı borca emekliliğe kadar basit faizle eklenir', () => {
    const p = plan(bilinen('300000.00'), bilinen('25000.00'), { gecikmeAylikOran: 0.01, gecikmeAySayisi: 12 })!;
    expect(kisa(p.borc().bilgi())).toBe('336000.00');
    expect(p.sureAy()).toEqual({ alt: 135, ust: 135 });
  });

  it('kesinti yoksa plan yoktur; oran kanuni tavanı aşamaz', () => {
    expect(plan(bilinen('250000.00'), bilinen('25000.00'), { oran: 0 })).toBeNull();
    expect(plan(bilinen('0.00'))).toBeNull();
    expect(() => plan(bilinen('1.00'), bilinen('25000.00'), { oran: 0.3 })).toThrow(RangeError);
    expect(() => plan(bilinen('1.00'), bilinen('25000.00'), { oran: -0.1 })).toThrow(RangeError);
    expect(() => plan(bilinen('1.00'), bilinen('25000.00'), { gecikmeAylikOran: -0.01 })).toThrow(RangeError);
  });

  it('aylık sıfırsa borç hiç bitmez; süre bilinmiyor', () => {
    const p = plan(bilinen('1000.00'), bilinen('0.00'))!;
    expect(p.sureAy()).toBeNull();
    expect(kisa(p.toplam(12).bilgi())).toBe('0.00');
  });
});
