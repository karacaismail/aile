// Biçimleyici ve ayrıştırıcı: görünüm hesap yapmaz; ViewModel bütün metinleri bu iki sınıfla üretir.
// Para tr-TR "₺8.500,00" (iki ondalık), ay "Aralık 2027" (saat diliminden bağımsız), oran "%10", gün "5.900 gün".
// Ayrıştırma Türkçe yazım: binlik nokta, ondalık virgül; belirsiz girdi ("8.5") tahmin edilmez, hata verir.
import { describe, expect, it } from 'vitest';
import { TurkceBicimleyici } from './bicim';
import { TurkceSayiAyristirici } from './ayristirma';

const b = new TurkceBicimleyici();
const a = new TurkceSayiAyristirici();

describe('TurkceBicimleyici', () => {
  it('formats TL decimal text as ₺8.500,00 without floating rounding, signed on demand', () => {
    expect(b.para('208089.00')).toBe('₺208.089,00');
    expect(b.para('0.5')).toBe('₺0,50');
    expect(b.para('1234567.89')).toBe('₺1.234.567,89');
    expect(b.isaretliPara('240114.98')).toBe('+₺240.114,98');
    expect(b.isaretliPara('-1250.00')).toBe('-₺1.250,00');
    expect(b.isaretliPara('0.00')).toBe('₺0,00');
    expect(b.isaretliPara('-0.00')).toBe('₺0,00');
  });

  it('names a broken TL text instead of printing it', () => {
    expect(b.para('abc')).toBe('Bilinmiyor');
    expect(b.para('1,5')).toBe('Bilinmiyor');
  });

  it('formats months in Turkish independent of the time zone; invalid month is named', () => {
    expect(b.ay('2027-12')).toBe('Aralık 2027');
    expect(b.ay('2028-01')).toBe('Ocak 2028');
    expect(b.ay('2031-08')).toBe('Ağustos 2031');
    expect(b.ay('2027-13')).toBe('Bilinmiyor');
    expect(b.tarih('2026-11-02')).toBe('2 Kasım 2026');
  });

  it('formats day counts, rates and integers in Turkish', () => {
    expect(b.gun(5900)).toBe('5.900 gün');
    expect(b.gun(360)).toBe('360 gün');
    expect(b.sayi(12345)).toBe('12.345');
    expect(b.oran(0.1)).toBe('%10');
    expect(b.oran(0.105)).toBe('%10,5');
    expect(b.oran(0.25)).toBe('%25');
  });

  it('formats TutarBilgisi: known amount, range and unknown with its reason', () => {
    expect(b.tutar({ tur: 'bilinen', tl: '208089.00', kaynak: 'x' })).toBe('₺208.089,00');
    expect(b.tutar({ tur: 'aralik', altTl: '300000.00', ustTl: '450000.00', kaynak: 'x' })).toBe('₺300.000,00 – ₺450.000,00');
    expect(b.tutar({ tur: 'bilinmiyor', neden: 'Düzeltilmiş borç girilmedi' })).toBe('Bilinmiyor · Düzeltilmiş borç girilmedi');
    expect(b.isaretliTutar({ tur: 'bilinen', tl: '-5.00', kaynak: 'x' })).toBe('-₺5,00');
    expect(b.isaretliTutar({ tur: 'aralik', altTl: '-10.00', ustTl: '20.00', kaynak: 'x' })).toBe('-₺10,00 – +₺20,00');
  });

  it('derives a tone from the sign of a TutarBilgisi; unknown and zero are neutral', () => {
    expect(b.ton({ tur: 'bilinen', tl: '5.00', kaynak: 'x' })).toBe('olumlu');
    expect(b.ton({ tur: 'bilinen', tl: '-5.00', kaynak: 'x' })).toBe('hata');
    expect(b.ton({ tur: 'bilinen', tl: '0.00', kaynak: 'x' })).toBe('notr');
    expect(b.ton({ tur: 'aralik', altTl: '1.00', ustTl: '2.00', kaynak: 'x' })).toBe('olumlu');
    expect(b.ton({ tur: 'aralik', altTl: '-1.00', ustTl: '2.00', kaynak: 'x' })).toBe('notr');
    expect(b.ton({ tur: 'bilinmiyor', neden: 'x' })).toBe('notr');
  });

  it('describes earliness in months', () => {
    expect(b.erken(14)).toBe('14 ay erken');
    expect(b.erken(0)).toBe('Aynı ay');
    expect(b.erken(-3)).toBe('3 ay geç');
    expect(b.erken(null)).toBe('Bilinmiyor');
  });

  it('turns TL text into an editable Turkish draft and back', () => {
    expect(b.paraGirdisi('208089.00')).toBe('208.089,00');
    expect(b.paraGirdisi('0.50')).toBe('0,50');
    expect(b.oranGirdisi(0.1)).toBe('10');
    expect(b.oranGirdisi(0.105)).toBe('10,5');
    expect(b.sayiGirdisi(5900)).toBe('5900');
  });
});

describe('TurkceSayiAyristirici', () => {
  it('parses integers with optional thousands dots and rejects fractions or letters', () => {
    expect(a.tamSayi('5.900')).toEqual({ tamam: true, deger: 5900 });
    expect(a.tamSayi(' 360 ')).toEqual({ tamam: true, deger: 360 });
    expect(a.tamSayi('0')).toEqual({ tamam: true, deger: 0 });
    expect(a.tamSayi('5,5')).toEqual({ tamam: false, hata: 'Tam sayı girin; ör. 360.' });
    expect(a.tamSayi('-3')).toEqual({ tamam: false, hata: 'Tam sayı girin; ör. 360.' });
    expect(a.tamSayi('59.00')).toEqual({ tamam: false, hata: 'Tam sayı girin; ör. 360.' });
    expect(a.tamSayi('')).toEqual({ tamam: false, hata: 'Boş bırakılamaz.' });
  });

  it('parses Turkish money as exact TL text (comma decimal, dot thousands, optional ₺ / TL)', () => {
    expect(a.para('8.500,00')).toEqual({ tamam: true, deger: '8500.00' });
    expect(a.para('8500')).toEqual({ tamam: true, deger: '8500.00' });
    expect(a.para('₺8.500,5')).toEqual({ tamam: true, deger: '8500.50' });
    expect(a.para('1.234.567,89 TL')).toEqual({ tamam: true, deger: '1234567.89' });
    expect(a.para('0,00')).toEqual({ tamam: true, deger: '0.00' });
    expect(a.para('007,10')).toEqual({ tamam: true, deger: '7.10' });
    const hata = { tamam: false, hata: 'Tutarı 8.500,00 biçiminde girin.' };
    expect(a.para('8.5')).toEqual(hata);
    expect(a.para('8500.50')).toEqual(hata);
    expect(a.para('8,500')).toEqual(hata);
    expect(a.para('abc')).toEqual(hata);
    expect(a.para('-5,00')).toEqual({ tamam: false, hata: 'Tutar eksi olamaz.' });
    expect(a.para('  ')).toEqual({ tamam: false, hata: 'Boş bırakılamaz.' });
  });

  it('parses percentages into a ratio (10 → 0.1, %10,5 → 0.105)', () => {
    expect(a.oran('10')).toEqual({ tamam: true, deger: 0.1 });
    expect(a.oran('%10,5')).toEqual({ tamam: true, deger: 0.105 });
    expect(a.oran('25 %')).toEqual({ tamam: true, deger: 0.25 });
    expect(a.oran('0')).toEqual({ tamam: true, deger: 0 });
    expect(a.oran('10.5')).toEqual({ tamam: false, hata: 'Oranı 10 ya da 10,5 biçiminde girin.' });
    expect(a.oran('')).toEqual({ tamam: false, hata: 'Boş bırakılamaz.' });
  });
});
