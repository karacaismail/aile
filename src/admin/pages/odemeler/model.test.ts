// Ödemeler saf modeli: satır, kova/grup, sıralama, filtre, facet sayımları, ödeme kaynağı ve özet. Sentetik olaylar
// (gerçek veri değil); tarihler gün sayısıyla, bugün Europe/Istanbul takvim günü.
import type { ForecastEvent, Manifest } from '../../data';
import { RANGE_KEYS } from '../../shell/FilterPanel';
import {
  BOS_SECIM, degistir, etkinFiltreler, facetler, filtrele, grupOf, isoToDay, odemeKaynagi, odemeKaynagiMetni, ozet, sayimMetni,
  sirala, todayOf, toOdemeRow, toOdemeRows, trToDay, type OdemeRow, type Secimler,
} from './model';

const TENANT = '89bb71d8-2e82-56a2-b231-843cbc783ba2';
let sira = 0;
function olay(occurred_on: string | null, amount: string | null, ek: Partial<ForecastEvent> = {}): ForecastEvent {
  sira += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sira).padStart(12, '0')}`,
    tenant_id: TENANT,
    kind: 'forecast_event',
    label: `Sentetik olay ${sira}`,
    source_record_id: `s-${sira}`,
    event_type: 'payment',
    certainty: 'planned',
    occurred_on,
    measures: amount === null ? {} : { planned: { amount, currency: 'TRY' } },
    ...ek,
  } as ForecastEvent;
}

const BUGUN = isoToDay('2026-11-02')!;
const satir = (e: ForecastEvent) => toOdemeRow(e, BUGUN);

describe('tarih yardımcıları', () => {
  it('isoToDay/trToDay geçersiz günü reddeder; aynı gün aynı sayı', () => {
    expect(isoToDay('2026-02-30')).toBeNull();
    expect(trToDay('30.02.2026')).toBeNull();
    expect(trToDay('02.11.2026')).toBe(BUGUN);
    expect(isoToDay('bozuk')).toBeNull();
  });

  it('todayOf Europe/Istanbul gününü verir (UTC gece yarısından önce İstanbul ertesi gündedir)', () => {
    expect(todayOf(new Date('2026-11-01T22:30:00Z'))).toBe(BUGUN);
    expect(todayOf(new Date('2026-11-01T20:59:00Z'))).toBe(BUGUN - 1);
  });
});

describe('satır modeli', () => {
  it('tarihi geçen olay "Tarihi geçti · N gün" (uyarı tonu), asla "Gecikti"; gerçekleşen yoksa ödeme kaydı yok', () => {
    const row = satir(olay('2026-10-28', '1150.00'));
    expect(row.kova).toBe('gecmis');
    expect(row.status).toEqual({ label: 'Tarihi geçti · 5 gün', tone: 'uyari' });
    expect(row.actual).toBeNull();
  });

  it('kesinlik: planned "Planlandı", estimated "Tutar tahmini", bilinmeyen "Tahmin"; tarihsiz "Tarihi bilinmiyor"', () => {
    expect(satir(olay('2026-11-20', '1.00')).status.label).toBe('Planlandı');
    expect(satir(olay('2026-11-20', '1.00', { certainty: 'estimated' })).status).toEqual({ label: 'Tutar tahmini', tone: 'uyari' });
    expect(satir(olay('2026-11-20', '1.00', { certainty: 'tuhaf' })).status.label).toBe('Tahmin');
    const tarihsiz = satir(olay(null, '1.00'));
    expect(tarihsiz.kova).toBe('bilinmiyor');
    expect(tarihsiz.dateText).toBe('Tarihi bilinmiyor');
  });

  it('bilinmeyen tür ve eksik alanlar adıyla: tür "Bilinmiyor", kaynak "Bilinmiyor"; tutar measures yoksa amount alanından', () => {
    const row = satir(olay('2026-11-20', null, { event_type: undefined, amount: { amount: '42.00', currency: 'TRY' } }));
    expect(row.type).toBe('Bilinmiyor');
    expect(row.typeKey).toBe('bilinmiyor');
    expect(row.source).toBe('Bilinmiyor');
    expect(row.planned).toEqual({ amount: '42.00', currency: 'TRY' });
  });

  it('silinmiş olay listeye girmez', () => {
    const rows = toOdemeRows([olay('2026-11-20', '1.00'), olay('2026-11-21', '1.00', { deleted_at: '2026-10-01T00:00:00Z' })], BUGUN);
    expect(rows).toHaveLength(1);
  });
});

describe('gruplar ve sıralama', () => {
  const gecmisYakin = satir(olay('2026-11-01', '100.00'));
  const gecmisUzak = satir(olay('2026-10-01', '900.00'));
  const hafta = satir(olay('2026-11-08', '50.00'));
  const aralik = satir(olay('2026-12-08', '700.00'));
  const ocakKucuk = satir(olay('2027-01-15', '10.00'));
  const ocakTutarsiz = satir(olay('2027-01-02', null));
  const tarihsiz = satir(olay(null, '5000.00'));
  const hepsi: OdemeRow[] = [ocakKucuk, tarihsiz, aralik, gecmisUzak, hafta, ocakTutarsiz, gecmisYakin];

  it('tarihe göre: Tarihi geçenler (bugüne yakın önce) · Bu hafta · aylar artan · Tarihi bilinmiyor', () => {
    const sonuc = sirala(hepsi, 'tarih');
    expect(sonuc).toEqual([gecmisYakin, gecmisUzak, hafta, aralik, ocakTutarsiz, ocakKucuk, tarihsiz]);
    expect(sonuc.map(row => grupOf(row, 'tarih').label)).toEqual([
      'Tarihi geçenler', 'Tarihi geçenler', 'Bu hafta', 'Aralık 2026', 'Ocak 2027', 'Ocak 2027', 'Tarihi bilinmiyor',
    ]);
  });

  it('tutara göre: ay kırılımı kalkar, kovalar kalır; kova içinde büyükten küçüğe, tutarsız sonda', () => {
    const sonuc = sirala(hepsi, 'tutar');
    expect(sonuc).toEqual([gecmisUzak, gecmisYakin, hafta, aralik, ocakKucuk, ocakTutarsiz, tarihsiz]);
    expect([...new Set(sonuc.map(row => grupOf(row, 'tutar').label))]).toEqual(['Tarihi geçenler', 'Bu hafta', 'Sonra', 'Tarihi bilinmiyor']);
  });
});

describe('filtre', () => {
  const rows = [
    satir(olay('2026-10-28', '1150.00', { event_type: 'fee' })),
    satir(olay('2026-11-05', '18500.00', { event_type: 'payment' })),
    satir(olay('2026-12-10', '2646.67', { event_type: undefined })),
    satir(olay(null, null)),
  ];
  const secim = (ek: Partial<Secimler>): Secimler => ({ ...BOS_SECIM, ...ek });

  it('tarih aralığı tarihsiz satırı dışarıda bırakır; tutar aralığı plan tutarına bakar', () => {
    expect(filtrele(rows, '', secim({ tarih: [`${RANGE_KEYS.baslangic}01.11.2026`] })).map(r => r.dateText)).toEqual(['05.11.2026', '10.12.2026']);
    expect(filtrele(rows, '', secim({ tutar: [`${RANGE_KEYS.enAz}2.000`, `${RANGE_KEYS.enCok}20.000`] })).map(r => r.dateText)).toEqual(['05.11.2026', '10.12.2026']);
  });

  it('durum (zaman kovası) ve tür; "bilinmiyor" ayrı değer', () => {
    expect(filtrele(rows, '', secim({ durum: ['gecmis'] }))).toHaveLength(1);
    expect(filtrele(rows, '', secim({ durum: ['bilinmiyor'] }))[0]!.dateText).toBe('Tarihi bilinmiyor');
    expect(filtrele(rows, '', secim({ tur: ['bilinmiyor'] }))[0]!.dateText).toBe('10.12.2026');
  });

  it('arama ad, kimlik ve türde (tr-TR küçük harf)', () => {
    expect(filtrele(rows, 'ÜCRET', BOS_SECIM)).toHaveLength(1);
  });

  it('degistir: aralık girdisi aynı öneki değiştirir, boş değer kaldırır; seçenek iki durumlu', () => {
    expect(degistir([`${RANGE_KEYS.enAz}10`], `${RANGE_KEYS.enAz}20`)).toEqual([`${RANGE_KEYS.enAz}20`]);
    expect(degistir([`${RANGE_KEYS.enAz}10`], RANGE_KEYS.enAz)).toEqual([]);
    expect(degistir(['gecmis'], 'gecmis')).toEqual([]);
    expect(degistir([], 'gecmis')).toEqual(['gecmis']);
  });

  it('facet sayımları; tür seçeneklerinde "Bilinmiyor" sayımla sonda', () => {
    const [, , durum, tur] = facetler(rows, BOS_SECIM);
    expect(durum!.options.map(o => [o.label, o.count])).toEqual([['Tarihi geçti', 1], ['Bu hafta', 1], ['Sonra', 1], ['Tarihi bilinmiyor', 1]]);
    expect(tur!.options.map(o => [o.label, o.count])).toEqual([['Ödeme', 2], ['Ücret', 1], ['Bilinmiyor', 1]]);
  });

  it('etkin filtre etiketleri adıyla ve kaldırılabilir', () => {
    const kaldirilan: string[] = [];
    const etkin = etkinFiltreler(
      secim({ tarih: [`${RANGE_KEYS.bitis}31.12.2026`], tutar: [`${RANGE_KEYS.enAz}20.000`], durum: ['gecmis'], tur: ['fee'] }),
      key => (key === 'fee' ? 'Ücret' : key),
      (facet, value) => kaldirilan.push(`${facet}:${value}`),
      facet => kaldirilan.push(`${facet}:*`),
    );
    expect(etkin.map(f => f.label)).toEqual(['Tarih: 31.12.2026 ve öncesi', 'Tutar: en az ₺20.000,00', 'Durum: Tarihi geçti', 'Tür: Ücret']);
    etkin.forEach(f => f.onRemove());
    expect(kaldirilan).toEqual([`tarih:${RANGE_KEYS.bitis}`, `tutar:${RANGE_KEYS.enAz}`, 'durum:gecmis', 'tur:fee']);
  });
});

describe('ödeme kaynağı ve özet', () => {
  const manifest = (ek: Partial<Manifest>): Manifest => ({
    schemaVersion: 1, generation_id: 'a'.repeat(64), tenant_id: TENANT, storage_policy: 'private_only', files: [], counts: {}, sources: [], ...ek,
  });

  it('manifest yokken hüküm yok; payments yoksa "Kaynakta ödeme kaydı yok"; varsa sayısıyla okunmadığı söylenir', () => {
    expect(odemeKaynagiMetni(odemeKaynagi(null))).toBe('Ödeme kaynağı bilinmiyor');
    expect(odemeKaynagiMetni(odemeKaynagi(manifest({ counts: { forecast_events: 20 } })))).toBe('Kaynakta ödeme kaydı yok');
    expect(odemeKaynagiMetni(odemeKaynagi(manifest({ counts: { payments: 1200 } })))).toBe('Kaynakta 1.200 ödeme kaydı var; panel bunları okumuyor');
  });

  it('özet: plan ve gerçek ayrı; karışık para birimi adıyla; eksik tutar sayılır; gelecek olay yoksa "Yok"', () => {
    const rows = [
      satir(olay('2026-10-01', '100.00')),
      satir(olay('2026-10-02', null)),
      satir(olay('2026-10-03', '5.00', { measures: { planned: { amount: '5.00', currency: 'EUR' } } })),
    ];
    const [gecmis, siradaki, yapilan] = ozet(rows, { durum: 'yok' });
    expect(gecmis).toEqual({ label: 'Tarihi geçen (plan)', value: 'Birden çok para birimi', note: '3 tahmin · ödeme durumu bilinmiyor · 1 tutar bilinmiyor' });
    expect(siradaki).toEqual({ label: 'Sıradaki (plan)', value: 'Yok', note: 'Tarihi gelecek tahmin yok' });
    expect(yapilan).toEqual({ label: 'Yapılan (gerçek)', value: 'Bilinmiyor', note: 'Kaynakta ödeme kaydı yok' });
  });

  it('sayım metni tarihi geçenleri ayrıca söyler', () => {
    expect(sayimMetni([satir(olay('2026-10-01', '1.00')), satir(olay('2026-12-01', '1.00'))])).toBe('2 tahmini ödeme · 1 tarihi geçti');
    expect(sayimMetni([satir(olay('2026-12-01', '1.00'))])).toBe('1 tahmini ödeme');
  });
});
