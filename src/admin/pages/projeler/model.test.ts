import { todayUtc, topla, toplamMetni } from './model';

// Projeler saf modeli: para toplamı kesin ondalık (actuals.sumMoney; Number×100 ve Math.round yok), "bugün" ve
// "Gecikti" Europe/Istanbul takvim günüyle (Genel ve Ödemeler ile aynı; cihazın saat dilimi değil).

const TRY = (amount: string) => ({ amount, currency: 'TRY' });

describe('projeler/model › topla (kesin ondalık)', () => {
  it('üç ondalıklı tutar ikili kayan noktaya düşmez: 1.005 → ₺1,01 (Number(1.005)×100 = 100,4999…)', () => {
    expect(topla([TRY('1.005')]).parts).toEqual(['₺1,01']);
    expect(topla([TRY('1.005'), TRY('0.005')]).parts).toEqual(['₺1,01']);
  });

  it('2^53 üstü kuruş toplamı kesin: 90.071.992.547.409,93 + 0,01 (kayan noktayla ,95 olurdu)', () => {
    expect(topla([TRY('90071992547409.93'), TRY('0.01')]).parts).toEqual(['₺90.071.992.547.409,94']);
  });

  it('0,10 + 0,20 = 0,30; para birimleri ayrı toplanır; eksik ve bozuk değer "eksik" sayılır', () => {
    const toplam = topla([TRY('0.10'), TRY('0.20'), { amount: '5.00', currency: 'EUR' }, null, TRY('on bin')]);
    expect(toplam.parts).toEqual(['₺0,30', '€5,00']);
    expect(toplam.eksik).toBe(2);
    expect(toplamMetni(topla([null]), 'Fiyat yok')).toBe('Fiyat yok');
  });

  it('eksi tutar ve geçersiz para kodu adıyla yazılır; birim kodu büyük harfe normalize edilip tek toplamda birleşir', () => {
    expect(topla([TRY('-10.50'), TRY('0.50')]).parts).toEqual(['-₺10,00']);
    expect(topla([{ amount: '3.00', currency: 'puan' }]).parts).toEqual(['3,00 PUAN']);
    expect(topla([{ amount: '1.00', currency: 'try' }, TRY('2.00')]).parts).toEqual(['₺3,00']);
  });
});

describe('projeler/model › todayUtc (Europe/Istanbul)', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('cihaz saat dilimi farklıyken bugün İstanbul takvim günüdür (01.12 05:00 UTC → İstanbul 01.12, Los Angeles 30.11)', () => {
    process.env.TZ = 'America/Los_Angeles';
    const an = new Date('2026-12-01T05:00:00Z');
    expect(an.getDate()).toBe(30); // önkoşul: cihaz günü farklı
    expect(todayUtc(an).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('İstanbul gece yarısı sınırı: 30.11 21:30 UTC → 01.12; 20:59 UTC → 30.11 (cihaz UTC iken)', () => {
    process.env.TZ = 'UTC';
    expect(todayUtc(new Date('2026-11-30T21:30:00Z')).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(todayUtc(new Date('2026-11-30T20:59:00Z')).toISOString()).toBe('2026-11-30T00:00:00.000Z');
  });

  it('geçersiz an RangeError (gün uydurulmaz)', () => {
    expect(() => todayUtc(new Date('geçersiz'))).toThrow(RangeError);
  });
});
