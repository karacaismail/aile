import { describe, expect, it } from 'vitest';
import { Ay, TakvimGunu } from './Ay';

describe('Ay (YYYY-MM planlama ayı)', () => {
  it('ay ekler, çıkarır ve farkı ay olarak verir', () => {
    expect(Ay.metinden('2032-07').ekle(10).metin()).toBe('2033-05');
    expect(Ay.metinden('2027-01').ekle(-2).metin()).toBe('2026-11');
    expect(Ay.metinden('2038-05').fark(Ay.metinden('2033-05'))).toBe(60);
    expect(Ay.metinden('2033-05').fark(Ay.metinden('2038-05'))).toBe(-60);
  });

  it('ay sonunu artık yıla göre verir', () => {
    expect(Ay.metinden('2028-02').aySonu().metin()).toBe('2028-02-29');
    expect(Ay.metinden('2027-02').aySonu().metin()).toBe('2027-02-28');
    expect(Ay.metinden('2026-04').aySonu().metin()).toBe('2026-04-30');
    expect(Ay.metinden('2033-05').aySonu().metin()).toBe('2033-05-31');
  });

  it('karşılaştırır ve en geç ayı seçer', () => {
    const a = Ay.metinden('2029-03');
    const b = Ay.metinden('2033-05');
    expect(a.karsilastir(b)).toBe(-1);
    expect(b.sonrasiMi(a)).toBe(true);
    expect(a.oncesiMi(b)).toBe(true);
    expect(a.esit(Ay.metinden('2029-03'))).toBe(true);
    expect(Ay.enGec(a, b)).toBe(b);
  });

  it('geçersiz ay metnini reddeder', () => {
    for (const metin of ['2027-13', '2027-00', '2027-1', '0000-01', '27-01', '2027/01', '']) {
      expect(() => Ay.metinden(metin), metin).toThrow(RangeError);
    }
  });

  it('tarihten ayı ve Europe/Istanbul takvim ayını bulur', () => {
    expect(Ay.tarihten('2029-03-10').metin()).toBe('2029-03');
    expect(Ay.istanbulda(new Date('2026-10-31T21:30:00Z')).metin()).toBe('2026-11');
    expect(Ay.istanbulda(new Date('2026-10-31T20:30:00Z')).metin()).toBe('2026-10');
  });

  it('Türkçe ay adını verir', () => {
    expect(Ay.metinden('2033-05').adi()).toBe('Mayıs 2033');
    expect(Ay.metinden('2029-05').adi()).toBe('Mayıs 2029');
  });
});

describe('TakvimGunu', () => {
  it('yıl ekler; olmayan 29 Şubat bir sonraki güne taşar', () => {
    expect(TakvimGunu.metinden('1986-03-10').yilEkle(18).metin()).toBe('2004-03-10');
    expect(TakvimGunu.metinden('2000-02-29').yilEkle(1).metin()).toBe('2001-03-01');
    expect(TakvimGunu.metinden('2000-02-29').yilEkle(4).metin()).toBe('2004-02-29');
  });

  it('verilen günde tamamlanan yaşı hesaplar', () => {
    const dogum = TakvimGunu.metinden('1986-03-10');
    expect(dogum.yasi(TakvimGunu.metinden('2033-05-31'))).toBe(47);
    expect(dogum.yasi(TakvimGunu.metinden('2029-03-09'))).toBe(42);
    expect(dogum.yasi(TakvimGunu.metinden('2029-03-10'))).toBe(43);
  });

  it('geçersiz günü reddeder ve Türkçe yazar', () => {
    for (const metin of ['2027-02-30', '2026-13-01', '2026-1-01', '']) {
      expect(() => TakvimGunu.metinden(metin), metin).toThrow(RangeError);
    }
    expect(TakvimGunu.metinden('2026-11-02').adi()).toBe('2 Kasım 2026');
    expect(TakvimGunu.metinden('2026-11-02').ay().metin()).toBe('2026-11');
    expect(TakvimGunu.metinden('2026-11-02').karsilastir(TakvimGunu.metinden('2026-11-03'))).toBe(-1);
  });
});
