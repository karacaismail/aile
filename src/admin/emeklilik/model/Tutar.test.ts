import { describe, expect, it } from 'vitest';
import type { TutarBilgisi } from '../contract';
import { Para } from './Para';
import { Tutar, TutarIslemleri } from './Tutar';

const bilinen = (tl: string, kaynak = 'A'): TutarBilgisi => ({ tur: 'bilinen', tl, kaynak });
const aralik = (altTl: string, ustTl: string, kaynak = 'B'): TutarBilgisi => ({ tur: 'aralik', altTl, ustTl, kaynak });
const bilinmiyor = (neden: string): TutarBilgisi => ({ tur: 'bilinmiyor', neden });

describe('TutarIslemleri (TutarBilgisi)', () => {
  it('bilinen tutarları toplar ve kaynakları birleştirir', () => {
    expect(TutarIslemleri.topla(bilinen('100.00', 'Askerlik'), bilinen('50.50', 'İhya'))).toEqual({
      tur: 'bilinen', tl: '150.50', kaynak: 'Askerlik; İhya',
    });
    expect(TutarIslemleri.topla(bilinen('1.00', 'X'), bilinen('2.00', 'X'))).toEqual({ tur: 'bilinen', tl: '3.00', kaynak: 'X' });
  });

  it('aralığın alt ve üst ucunu ayrı toplar', () => {
    expect(TutarIslemleri.topla(bilinen('100.00'), aralik('300.00', '450.00'))).toEqual({
      tur: 'aralik', altTl: '400.00', ustTl: '550.00', kaynak: 'A; B',
    });
    expect(TutarIslemleri.topla(aralik('1.00', '2.00', 'B'), aralik('10.00', '20.00', 'C'))).toEqual({
      tur: 'aralik', altTl: '11.00', ustTl: '22.00', kaynak: 'B; C',
    });
  });

  it('bilinmiyor herhangi bir işlemde yayılır ve nedenini taşır', () => {
    expect(TutarIslemleri.topla(bilinen('1.00'), bilinmiyor('Borç bilinmiyor'))).toEqual(bilinmiyor('Borç bilinmiyor'));
    expect(TutarIslemleri.cikar(bilinmiyor('X yok'), aralik('1.00', '2.00'))).toEqual(bilinmiyor('X yok'));
    expect(TutarIslemleri.topla(bilinmiyor('X yok'), bilinmiyor('Y yok'))).toEqual(bilinmiyor('X yok; Y yok'));
    expect(TutarIslemleri.toplam([bilinen('1.00'), bilinmiyor('Z yok'), bilinen('2.00')])).toEqual(bilinmiyor('Z yok'));
  });

  it('çıkarmada sonucu alt ≤ üst olacak biçimde yazar', () => {
    expect(TutarIslemleri.cikar(bilinen('100.00'), aralik('300.00', '450.00'))).toEqual({
      tur: 'aralik', altTl: '-350.00', ustTl: '-200.00', kaynak: 'A; B',
    });
  });

  it('boş toplam sıfırdır ve geçersiz metni reddeder', () => {
    expect(TutarIslemleri.toplam([])).toEqual({ tur: 'bilinen', tl: '0.00', kaynak: 'Ödeme yok' });
    expect(() => TutarIslemleri.topla(bilinen('1,00'), bilinen('1.00'))).toThrow(RangeError);
    expect(() => Tutar.bilgiden({ tur: 'aralik', altTl: '5.00', ustTl: '1.00', kaynak: 'ters' })).toThrow(RangeError);
  });

  it('Türkçe gösterir', () => {
    expect(TutarIslemleri.goster(bilinen('8500.00'))).toBe('₺8.500,00');
    expect(TutarIslemleri.goster(aralik('300000.00', '450000.00'))).toBe('₺300.000,00 – ₺450.000,00');
    expect(TutarIslemleri.goster(bilinmiyor('X'))).toBe('Bilinmiyor');
  });
});

describe('Tutar (senaryo eşli değer)', () => {
  it('aynı aralıktan gelen iki tutarın farkını senaryo senaryo alır', () => {
    const borc = Tutar.bilgiden(aralik('300000.00', '450000.00'));
    const odemeli = borc.topla(Tutar.bilinen(Para.tlden('178362.00'), 'Askerlik'));
    expect(odemeli.cikar(borc).bilgi()).toEqual({ tur: 'bilinen', tl: '178362.00', kaynak: 'B; Askerlik' });
  });

  it('senaryo başına işlem uygular ve çarpar', () => {
    const borc = Tutar.bilgiden(aralik('250000.00', '400000.00'));
    expect(borc.esle(Tutar.bilinen(Para.tlden('300000.00'), 'Üst sınır'), Para.enKucuk).bilgi()).toEqual({
      tur: 'aralik', altTl: '250000.00', ustTl: '300000.00', kaynak: 'B; Üst sınır',
    });
    expect(Tutar.bilinen(Para.tlden('25000.00'), 'Aylık').carp(0.1).bilgi()).toEqual({ tur: 'bilinen', tl: '2500.00', kaynak: 'Aylık' });
    expect(borc.carpTam(2).senaryolar()?.map((p) => p.tlMetni())).toEqual(['500000.00', '800000.00']);
    expect(Tutar.bilinmiyor('Yok').senaryolar()).toBeNull();
    expect(Tutar.bilinmiyor('Yok').bilinmiyorMu()).toBe(true);
  });
});
