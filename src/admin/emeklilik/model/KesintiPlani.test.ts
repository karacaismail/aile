import { describe, expect, it } from 'vitest';
import type { TutarBilgisi } from '../contract';
import { KesintiPlani } from './KesintiPlani';
import { Tutar } from './Tutar';
import { kisa } from './testDestek';

const bilinen = (tl: string): TutarBilgisi => ({ tur: 'bilinen', tl, kaynak: 'test' });
const plan = (borc: TutarBilgisi, aylik: TutarBilgisi = bilinen('25000.00'), ek: Partial<Parameters<typeof KesintiPlani.olustur>[0]> = {}) =>
  KesintiPlani.olustur({ oran: 0.1, tavan: 0.25, borc, aylik, gecikmeAylikOran: null, gecikmeAySayisi: 0, ...ek });
/** İlk n ayda kesilen toplam: n × aylık − eline geçen net (aylık kesintiden büyükken net hiç sıfıra kırpılmaz). */
const kesilen = (p: KesintiPlani, n: number, aylik: TutarBilgisi = bilinen('25000.00')) =>
  kisa(Tutar.bilgiden(aylik).carpTam(n).cikar(p.netToplam(n, Tutar.bilgiden(aylik))).bilgi());

describe('KesintiPlani (ödenmeyen Bağ-Kur borcu)', () => {
  it('her ay oran × aylık keser ve borç bitince durur', () => {
    const p = plan(bilinen('250000.00'))!;
    expect(kisa(p.aylikKesinti().bilgi())).toBe('2500.00');
    expect(p.sureAy()).toEqual({ alt: 100, ust: 100 });
    expect(kesilen(p, 0)).toBe('0.00');
    expect(kesilen(p, 10)).toBe('25000.00');
    expect(kesilen(p, 100)).toBe('250000.00');
    expect(kesilen(p, 150)).toBe('250000.00');
    expect(p.ozet()).toMatchObject({ oran: 0.1, sureAy: 100 });
  });

  it('son ayda yalnız kalan borcu keser', () => {
    const p = plan(bilinen('251000.00'))!;
    expect(p.sureAy()).toEqual({ alt: 101, ust: 101 });
    expect(kesilen(p, 100)).toBe('250000.00');
    expect(kesilen(p, 101)).toBe('251000.00');
    expect(kesilen(p, 500)).toBe('251000.00');
  });

  it('borç aralıksa süre ve toplam alt/üst ayrı hesaplanır', () => {
    const p = plan({ tur: 'aralik', altTl: '250000.00', ustTl: '400000.00', kaynak: 'test' })!;
    expect(p.sureAy()).toEqual({ alt: 100, ust: 160 });
    expect(kesilen(p, 120)).toEqual(['250000.00', '300000.00']);
    const o = p.ozet();
    expect(o.sureAy).toBe(160);
    expect(o.neden).toContain('100');
    expect(o.neden).toContain('160');
  });

  it('borç bilinmiyorsa süre ve toplam bilinmiyor; neden taşınır', () => {
    const p = plan({ tur: 'bilinmiyor', neden: 'Düzeltilmiş borç yok' })!;
    expect(p).not.toBeNull();
    expect(p.sureAy()).toBeNull();
    expect(p.netToplam(5, Tutar.bilgiden(bilinen('25000.00'))).bilgi()).toMatchObject({ tur: 'bilinmiyor' });
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
    expect(kesilen(p, 12, bilinen('0.00'))).toBe('0.00');
    expect(p.gelirKirilimlari()).toEqual([1]);
  });

  it('gelir kırılımları: 1, borcun bittiği ay ve sonrası, senaryo senaryo; net toplam parçalarda doğrusaldır', () => {
    expect(plan(bilinen('251000.00'))!.gelirKirilimlari()).toEqual([1, 101, 102]);
    expect(plan({ tur: 'aralik', altTl: '250000.00', ustTl: '400000.00', kaynak: 'test' })!.gelirKirilimlari()).toEqual([1, 100, 101, 160, 161]);
    expect(plan({ tur: 'bilinmiyor', neden: 'Düzeltilmiş borç yok' })!.gelirKirilimlari()).toEqual([1]);
    // Doğrusallık: kırılımlar arasında aylık net sabit (99 → 100 → 101 → 102 ayları).
    const p = plan(bilinen('251000.00'))!;
    const aylik = Tutar.bilgiden(bilinen('25000.00'));
    const ay = (n: number) => kisa(p.netToplam(n, aylik).cikar(p.netToplam(n - 1, aylik)).bilgi());
    expect([ay(1), ay(100), ay(101), ay(102), ay(300)]).toEqual(['22500.00', '22500.00', '24000.00', '25000.00', '25000.00']);
  });
});
