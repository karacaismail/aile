// Hesaplar sayfasının saf mantığı: forecast_months tek bakiye kaynağıdır; tahmin bakiyeleri (aylar ya da tahminler
// arası) toplanmaz; dönem Europe/Istanbul ayına göre seçilir. React yok; veri elle kurulmuş küçük örneklerdir.
import { describe, expect, it } from 'vitest';
import type { Forecast, ForecastMonth } from '../../data/types';
import {
  BILINMIYOR, donemBakiyeleri, donemMetni, donemSecenekleri, kapanisOzeti, olcuAdi, projeksiyon, tahminAdlari, varsayilanDonem,
} from './model';

const TENANT = 't';
const para = (amount: string, currency = 'TRY') => ({ amount, currency });
function ay(id: string, period: string | undefined, measures: Record<string, { amount: string; currency: string } | null>, extra: Partial<ForecastMonth> = {}): ForecastMonth {
  return { id, tenant_id: TENANT, kind: 'forecast_month', forecast_id: 'f1', period, measures, ...extra } as ForecastMonth;
}
const tahmin = (id: string, label?: string): Forecast => ({ id, tenant_id: TENANT, kind: 'forecast', ...(label ? { label } : {}) }) as Forecast;

describe('donemMetni / olcuAdi', () => {
  it('"2027-03" → "03.2027"; biçim dışı ya da eksik dönem "Bilinmiyor"', () => {
    expect(donemMetni('2027-03')).toBe('03.2027');
    expect(donemMetni('2027-13')).toBe(BILINMIYOR);
    expect(donemMetni('2027-3')).toBe(BILINMIYOR);
    expect(donemMetni(undefined)).toBe(BILINMIYOR);
  });

  it('bilinen ölçüler Türkçe ad, bilinmeyen anahtar okunur hâle gelir', () => {
    expect(olcuAdi('opening_balance')).toBe('Açılış bakiyesi');
    expect(olcuAdi('planned_outflow')).toBe('Planlanan çıkış');
    expect(olcuAdi('planned_inflow')).toBe('Planlanan giriş');
    expect(olcuAdi('closing_balance')).toBe('Kapanış bakiyesi');
    expect(olcuAdi('kmh_limit')).toBe('Kmh limit');
    expect(olcuAdi('__')).toBe(BILINMIYOR);
  });
});

describe('projeksiyon', () => {
  const months = [
    ay('b', '2027-04', { closing_balance: para('300.00'), opening_balance: para('100.00') }),
    ay('a', '2027-03', { opening_balance: para('50.00'), closing_balance: para('100.00'), kmh_limit: para('5.00') }),
    ay('silinmis', '2027-05', { closing_balance: para('999.00') }, { deleted_at: '2027-01-01T00:00:00Z' }),
    ay('bozuk', 'Mart', { closing_balance: para('1.00') }),
  ];

  it('dönemler artan, silinmiş kayıt yok, biçim dışı dönem sonda "Bilinmiyor"; ölçüler açılış → kapanış → diğerleri', () => {
    const veri = projeksiyon(months, tahminAdlari([tahmin('f1')]));
    expect(veri.satirlar.map(satir => satir.donem)).toEqual(['03.2027', '04.2027', BILINMIYOR]);
    expect(veri.olcuAnahtarlari).toEqual(['opening_balance', 'closing_balance', 'kmh_limit']);
    expect(veri.donemler).toEqual(['2027-03', '2027-04']);
    expect(veri.tahminSayisi).toBe(1);
  });

  it('kapanış çizgisi: tahmin başına ayrı seri (yığılmaz), yalnız tek birim ve eksiksiz değerle', () => {
    const veri = projeksiyon(months.slice(0, 2), tahminAdlari([tahmin('f1')]));
    expect(veri.cizgi).toEqual({ donemler: ['03.2027', '04.2027'], currency: 'TRY', seriler: [{ ad: 'Nakit tahmini', degerler: [100, 300] }] });
    const karisik = projeksiyon([months[0]!, ay('c', '2027-03', { closing_balance: para('1.00', 'EUR') })], tahminAdlari([tahmin('f1')]));
    expect(karisik.cizgi).toBeNull();
    const eksik = projeksiyon([months[0]!, ay('d', '2027-03', { closing_balance: null })], tahminAdlari([tahmin('f1')]));
    expect(eksik.cizgi).toBeNull();
  });
});

describe('varsayilanDonem (Europe/Istanbul)', () => {
  const donemler = ['2026-11', '2027-03', '2027-04'];
  it('içinde bulunulan ay varsa o', () => {
    expect(varsayilanDonem(donemler, new Date('2027-03-15T09:00:00Z'))).toBe('2027-03');
  });
  it('İstanbul ay sınırı: 28.02 21:30Z İstanbul\'da 1 Mart', () => {
    expect(varsayilanDonem(donemler, new Date('2027-02-28T21:30:00Z'))).toBe('2027-03');
  });
  it('içinde bulunulan ay yoksa ondan önceki en son dönem; hepsi gelecekteyse ilk dönem; boşsa null', () => {
    expect(varsayilanDonem(donemler, new Date('2027-01-10T09:00:00Z'))).toBe('2026-11');
    expect(varsayilanDonem(donemler, new Date('2026-01-10T09:00:00Z'))).toBe('2026-11');
    expect(varsayilanDonem(donemler, new Date('2030-01-10T09:00:00Z'))).toBe('2027-04');
    expect(varsayilanDonem([], new Date('2027-03-15T09:00:00Z'))).toBeNull();
  });
});

describe('donemSecenekleri', () => {
  it('dönem başına bir seçenek, etiket "03.2027", içinde bulunulan ayda "Bu ay" notu', () => {
    expect(donemSecenekleri(['2027-03', '2027-04'], new Date('2027-03-15T09:00:00Z'))).toEqual([
      { value: '2027-03', label: '03.2027', note: 'Bu ay' },
      { value: '2027-04', label: '04.2027' },
    ]);
  });
});

describe('tahmin bakiyeleri toplanmaz', () => {
  const months = [
    ay('a1', '2027-03', { opening_balance: para('100.00'), closing_balance: para('150.00') }),
    ay('b1', '2027-03', { opening_balance: para('1000.00'), closing_balance: para('1500.00') }, { forecast_id: 'f2' }),
    ay('a2', '2027-04', { opening_balance: para('150.00'), closing_balance: para('175.00') }),
  ];
  const adlar = tahminAdlari([tahmin('f1', 'Temel'), tahmin('f2', 'Kötümser')]);

  it('dönemin bakiyeleri tahmin başına ayrı listedir; ölçü eksikse değer undefined (sayfa "Bilinmiyor" yazar)', () => {
    const veri = projeksiyon(months, adlar);
    const bakiyeler = donemBakiyeleri(veri, '2027-03');
    expect(bakiyeler.map(grup => grup.tahmin)).toEqual(['Temel', 'Kötümser']);
    expect(bakiyeler[0]!.olculer).toEqual([
      { key: 'opening_balance', ad: 'Açılış bakiyesi', deger: para('100.00') },
      { key: 'closing_balance', ad: 'Kapanış bakiyesi', deger: para('150.00') },
    ]);
    expect(donemBakiyeleri(veri, '2027-04')).toHaveLength(1);
    expect(donemBakiyeleri(veri, '2027-09')).toEqual([]);
  });

  it('özet: tek tahminde dönemin kapanışı; birden çok tahminde sayısı (toplam yok); dönem yoksa yok', () => {
    const tek = projeksiyon(months.filter(month => month.forecast_id === 'f1'), adlar);
    expect(kapanisOzeti(tek, '2027-03')).toEqual({ kind: 'tek', deger: para('150.00') });
    const cok = projeksiyon(months, adlar);
    expect(kapanisOzeti(cok, '2027-03')).toEqual({ kind: 'cok', sayi: 2 });
    expect(kapanisOzeti(cok, null)).toEqual({ kind: 'yok' });
  });

  it('tahmin adı: label, yoksa tek tahminde "Nakit tahmini", birden çokta "Tahmin N"', () => {
    expect(tahminAdlari([tahmin('f1')]).get('f1')).toBe('Nakit tahmini');
    const iki = tahminAdlari([tahmin('f1'), tahmin('f2', '  ')]);
    expect([iki.get('f1'), iki.get('f2')]).toEqual(['Tahmin 1', 'Tahmin 2']);
  });
});
