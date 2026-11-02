import { describe, expect, it } from 'vitest';
import { Para } from './Para';

describe('Para (kuruş tamsayısı)', () => {
  it('TL metnini kuruşa çevirir ve iki ondalıkla geri yazar', () => {
    expect(Para.tlden('178362.00').kurus).toBe(17836200);
    expect(Para.tlden('0.5').tlMetni()).toBe('0.50');
    expect(Para.tlden('1000').tlMetni()).toBe('1000.00');
    expect(Para.tlden('-12.34').tlMetni()).toBe('-12.34');
    expect(Para.tlden('-0.05').tlMetni()).toBe('-0.05');
  });

  it('geçersiz TL metnini reddeder', () => {
    for (const metin of ['', '12,50', '1.234.00', 'abc', '1e5', '.5', '12.345', ' 12.00', '+5.00', 'NaN']) {
      expect(() => Para.tlden(metin), metin).toThrow(RangeError);
    }
  });

  it('kayan nokta hatası olmadan toplar ve çıkarır', () => {
    expect(Para.tlden('0.10').topla(Para.tlden('0.20')).tlMetni()).toBe('0.30');
    expect(Para.tlden('100.00').cikar(Para.tlden('100.01')).tlMetni()).toBe('-0.01');
    expect(Para.sifir().sifirMi()).toBe(true);
  });

  it('günlük bedeli gün sayısıyla tam çarpar', () => {
    const bedel = Para.tlden('495.45');
    expect(bedel.carpTam(123).tlMetni()).toBe('60940.35');
    expect(bedel.carpTam(500).tlMetni()).toBe('247725.00');
    expect(bedel.carpTam(360).tlMetni()).toBe('178362.00');
    expect(() => bedel.carpTam(1.5)).toThrow(RangeError);
  });

  it('oranla çarpımı ondalık kesirle yapar ve yarımı sıfırdan uzağa yuvarlar', () => {
    expect(Para.tlden('1101.00').carp(0.45).tlMetni()).toBe('495.45');
    expect(Para.tlden('0.01').carp(0.5).tlMetni()).toBe('0.01');
    expect(Para.tlden('-0.01').carp(0.5).tlMetni()).toBe('-0.01');
    expect(Para.tlden('0.03').carp(0.5).tlMetni()).toBe('0.02');
    expect(Para.tlden('0.01').carp(0.49).tlMetni()).toBe('0.00');
    expect(Para.tlden('25000.00').carp(0.1).tlMetni()).toBe('2500.00');
    expect(Para.tlden('80000.00').carp(1.25).tlMetni()).toBe('100000.00');
    expect(Para.tlden('100.00').carp(1e-7).tlMetni()).toBe('0.00');
    expect(Para.tlden('300000.00').carp(0.01, 12).tlMetni()).toBe('36000.00');
    expect(() => Para.tlden('1.00').carp(Number.NaN)).toThrow(RangeError);
    expect(() => Para.tlden('1.00').carp(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('kestirim değerini bir kez kuruşa yuvarlar', () => {
    expect(Para.yaklasikTl(38662.68765133172).tlMetni()).toBe('38662.69');
    expect(Para.yaklasikTl(1.005).tlMetni()).toBe('1.01');
    expect(Para.yaklasikTl(-1.005).tlMetni()).toBe('-1.01');
    expect(Para.yaklasikTl(18349.999999999996).tlMetni()).toBe('18350.00');
    expect(() => Para.yaklasikTl(Number.NaN)).toThrow(RangeError);
  });

  it('karşılaştırır ve kaç birimin tutarı karşıladığını sayar', () => {
    const a = Para.tlden('10.00');
    const b = Para.tlden('20.00');
    expect(a.karsilastir(b)).toBe(-1);
    expect(b.karsilastir(a)).toBe(1);
    expect(a.karsilastir(Para.tlden('10'))).toBe(0);
    expect(Para.enBuyuk(a, b)).toBe(b);
    expect(Para.enKucuk(a, b)).toBe(a);
    expect(Para.tlden('178362.00').kacBirim(Para.tlden('25000.00'))).toBe(8);
    expect(Para.tlden('250000.00').kacBirim(Para.tlden('2500.00'))).toBe(100);
    expect(Para.tlden('0.00').kacBirim(Para.tlden('2500.00'))).toBe(0);
    expect(Para.tlden('1.00').kacBirim(Para.tlden('0.00'))).toBeNull();
  });

  it('güvenli tamsayı dışına çıkmaz', () => {
    expect(() => Para.kurustan(2 ** 53)).toThrow(RangeError);
    expect(() => Para.kurustan(1.5)).toThrow(RangeError);
    expect(() => Para.kurustan(Number.MAX_SAFE_INTEGER).topla(Para.kurustan(1))).toThrow(RangeError);
  });

  it('Türkçe para biçiminde gösterir', () => {
    expect(Para.tlden('8500.00').goster()).toBe('₺8.500,00');
    expect(Para.tlden('178362.00').goster()).toBe('₺178.362,00');
    expect(Para.tlden('1000000.00').goster()).toBe('₺1.000.000,00');
    expect(Para.tlden('0').goster()).toBe('₺0,00');
    expect(Para.tlden('-1234.56').goster()).toBe('−₺1.234,56');
  });
});
