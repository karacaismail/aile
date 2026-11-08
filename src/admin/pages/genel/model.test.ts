import { MIRRORS_PLAN_NOTE, MIXED_CURRENCY_TEXT, TOTAL_UNAVAILABLE_TEXT, createViewCatalog, type BudgetObservation, type ForecastEvent, type ForecastMonth, type PurchaseNeedRecord } from '../../data';
import {
  AYLIK_TOPLAM_NOTU,
  ayGerceklesenMetni,
  ayKayitMetni,
  ayPlanMetni,
  aylikSatirlar,
  butceSatirlari,
  donemAdi,
  gecikenKayitlar,
  gecikenOlcusu,
  gerceklesenMetni,
  gunAdi,
  gunEkle,
  isoGun,
  istanbulGunu,
  kalanNakit,
  odenecekOlcusu,
  planAynasiNotu,
  planMetni,
  tarihMetni,
  toplamMetni,
  yaklasanOdemeler,
} from './model';

// Genel durum görünüm modeli (saf): gerçekleşen anlamı data/actuals.ts'ten, dönem/gün Europe/Istanbul, toplamlar
// kesin ondalık. Sayfa testleri (GenelPage.test.tsx) aynı kuralları sentetik nesil üzerinde çizilmiş hâliyle sınar;
// burada sınır durumları (kanıtlı satır, karışık birim, pencere sınırları, geçersiz tarih) tek tek sabitlenir.

const BUGUN = new Date('2026-12-05T07:00:00Z'); // İstanbul 05.12.2026 10:00

let sayac = 0;
function gozlem(alanlar: Partial<BudgetObservation> & Pick<BudgetObservation, 'label' | 'period' | 'basis'>, deger: string | null = '100.00', birim: string | null = 'TRY'): BudgetObservation {
  sayac += 1;
  return {
    id: `id-${sayac}`,
    tenant_id: 't',
    kind: 'budget_observation',
    payment_evidence: false,
    deleted_at: null,
    value: { decimal: deger, currency: birim },
    ...alanlar,
  } as BudgetObservation;
}

describe('genel/model › gün ve dönem (Europe/Istanbul)', () => {
  it('istanbulGunu cihaz saat diliminden bağımsız: 30.11 21:30 UTC → 01.12 İstanbul', () => {
    expect(istanbulGunu(new Date('2026-11-30T21:30:00Z'))).toBe('2026-12-01');
    expect(istanbulGunu(new Date('2026-11-30T20:59:00Z'))).toBe('2026-11-30');
    expect(() => istanbulGunu(new Date('geçersiz'))).toThrow(RangeError);
  });

  it('isoGun takvimde olmayan günü reddeder; gunEkle ay/yıl sınırını geçer', () => {
    expect(isoGun('2026-02-30')).toBeUndefined();
    expect(isoGun('2026-12-08T00:00:00Z')).toBe('2026-12-08');
    expect(isoGun(42)).toBeUndefined();
    expect(gunEkle('2026-12-29', 7)).toBe('2027-01-05');
  });

  it('tarih ve ay adları tasarım biçiminde (28.10.2026, Aralık 2026, Ara 2026)', () => {
    expect(tarihMetni('2026-12-08')).toBe('08.12.2026');
    expect(gunAdi('2026-12-08')).toBe('Salı');
    expect(donemAdi('2026-12')).toBe('Aralık 2026');
    expect(donemAdi('2026-12', 'kisa')).toBe('Ara 2026');
    expect(donemAdi('bozuk')).toBe('bozuk');
  });
});

describe('genel/model › bütçe satırları', () => {
  it('kanıtsız Gerçekleşen "Kaynakta yazılı": oran ve kalan yok; unclassified ve silinmiş katılmaz', () => {
    const satirlar = butceSatirlari([
      gozlem({ label: 'Kira', period: '2026-12', basis: 'planned' }, '1000.00'),
      gozlem({ label: 'Kira', period: '2026-12', basis: 'recorded_aggregate' }, '400.00'),
      gozlem({ label: 'Kira', period: '2026-12', basis: 'unclassified' }, '50.00'),
      gozlem({ label: 'Kira', period: '2026-12', basis: 'recorded_aggregate', deleted_at: '2026-12-01T00:00:00Z' }, '70.00'),
      gozlem({ label: 'Kira', period: '2026-12', basis: 'bilinmeyen' }, '9.00'),
    ], '2026-12', BUGUN);
    expect(satirlar).toHaveLength(1);
    const [kira] = satirlar;
    expect(kira!.planned.money).toEqual({ amount: '1000.00', currency: 'TRY' });
    expect(kira!.recorded).toMatchObject({ kind: 'recorded', money: { amount: '400.00', currency: 'TRY' }, evidence: false });
    expect(kira!.spend).toEqual({ kind: 'in_source', percent: null, text: 'Kaynakta yazılı' });
    expect(kira!.remaining).toBeNull();
  });

  it('kanıtlı Gerçekleşen: oran spendLabel\'dan, kalan kesin ondalık', () => {
    const [satir] = butceSatirlari([
      gozlem({ label: 'Market', period: '2026-12', basis: 'planned' }, '0.30'),
      gozlem({ label: 'Market', period: '2026-12', basis: 'recorded_aggregate', payment_evidence: true }, '0.10'),
      gozlem({ label: 'Market', period: '2026-12', basis: 'recorded_aggregate', payment_evidence: true }, '0.20'),
    ], '2026-12', BUGUN);
    expect(satir!.recorded).toMatchObject({ kind: 'recorded', money: { amount: '0.30' }, evidence: true });
    expect(satir!.spend).toEqual({ kind: 'spent', percent: 100, text: '%100 harcandı' });
    expect(satir!.remaining?.money).toEqual({ amount: '0.00', currency: 'TRY' });
  });

  it('gelecek dönem "Henüz yok"; Gerçekleşen kaydı olmayan kalem de "Henüz yok"', () => {
    const gelecek = butceSatirlari([
      gozlem({ label: 'Kira', period: '2027-01', basis: 'planned' }, '1000.00'),
      gozlem({ label: 'Kira', period: '2027-01', basis: 'recorded_aggregate' }, '1000.00'),
    ], '2027-01', BUGUN);
    expect(gelecek[0]!.recorded).toEqual({ kind: 'not_yet' });
    expect(gelecek[0]!.spend.text).toBe('Henüz yok');
    expect(gerceklesenMetni(gelecek[0]!.recorded)).toBe('Henüz yok');
    const kayitsiz = butceSatirlari([gozlem({ label: 'Okul', period: '2026-12', basis: 'planned' }, '10.00')], '2026-12', BUGUN);
    expect(kayitsiz[0]!.recorded).toBeNull();
    expect(kayitsiz[0]!.spend.text).toBe('Henüz yok');
  });

  it('karışık para birimi toplanmaz, adıyla; plan yoksa "Plan yok"; okunamayan değer "Bilinmiyor"', () => {
    const [satir] = butceSatirlari([
      gozlem({ label: 'Tatil', period: '2026-12', basis: 'recorded_aggregate' }, '10.00', 'TRY'),
      gozlem({ label: 'Tatil', period: '2026-12', basis: 'recorded_aggregate' }, '10.00', 'EUR'),
    ], '2026-12', BUGUN);
    expect(planMetni(satir!.planned)).toBe('Plan yok');
    expect(gerceklesenMetni(satir!.recorded)).toBe(MIXED_CURRENCY_TEXT);
    const [bozuk] = butceSatirlari([gozlem({ label: 'X', period: '2026-12', basis: 'recorded_aggregate' }, null)], '2026-12', BUGUN);
    expect(gerceklesenMetni(bozuk!.recorded)).toBe('Bilinmiyor');
  });

  it('plan aynası notu yalnız Gerçekleşen planın kanıtsız kopyasıyken', () => {
    const ayna = [
      gozlem({ label: 'Kira', period: '2026-12', basis: 'planned' }, '8500'),
      gozlem({ label: 'Kira', period: '2026-12', basis: 'recorded_aggregate' }, '8500.00'),
    ];
    expect(planAynasiNotu(ayna, '2026-12')).toBe(MIRRORS_PLAN_NOTE);
    expect(planAynasiNotu([...ayna, gozlem({ label: 'Kira', period: '2026-11', basis: 'recorded_aggregate' }, '1.00')], '2026-12')).toBe(MIRRORS_PLAN_NOTE);
    expect(planAynasiNotu([ayna[0]!, gozlem({ label: 'Kira', period: '2026-12', basis: 'recorded_aggregate' }, '8400.00')], '2026-12')).toBeNull();
  });
});

describe('genel/model › aylık satırlar', () => {
  it('bugüne kadarki son N ay; ay listesi yalnız plan/Gerçekleşen gözlemlerinden (unclassified ayı yok)', () => {
    const aylar = aylikSatirlar([
      gozlem({ label: 'A', period: '2026-10', basis: 'planned' }),
      gozlem({ label: 'A', period: '2026-11', basis: 'planned' }),
      gozlem({ label: 'A', period: '2026-12', basis: 'recorded_aggregate' }, '5.00'),
      gozlem({ label: 'A', period: '2027-01', basis: 'planned' }),
      gozlem({ label: 'A', period: '2026-09', basis: 'unclassified' }),
    ], BUGUN, 2);
    expect(aylar.map(ay => ay.donem)).toEqual(['2026-11', '2026-12']);
    expect(ayPlanMetni(aylar[1]!)).toBe('Plan yok');
    // Tek satır da toplam değildir: hangi satırın yaprak gider kalemi olduğu bilinmiyor.
    expect(ayGerceklesenMetni(aylar[1]!)).toBe(TOTAL_UNAVAILABLE_TEXT);
    expect(aylar[1]).toMatchObject({ planKaydi: 0, gerceklesenKaydi: 1 });
  });

  it('geçmiş ay yoksa en erken N gelecek ay; Gerçekleşen "Henüz yok", oran yok', () => {
    const aylar = aylikSatirlar([
      gozlem({ label: 'A', period: '2027-02', basis: 'planned' }, '20.00'),
      gozlem({ label: 'A', period: '2027-02', basis: 'recorded_aggregate' }, '20.00'),
      gozlem({ label: 'A', period: '2027-01', basis: 'planned' }, '10.00'),
    ], BUGUN, 6);
    expect(aylar.map(ay => ay.donem)).toEqual(['2027-01', '2027-02']);
    expect(aylar.every(ay => ay.gelecek && ay.gerceklesenKaydi === 0 && ay.spend.kind === 'not_yet')).toBe(true);
    expect(aylar.map(ayGerceklesenMetni)).toEqual(['Henüz yok', 'Henüz yok']);
    expect(ayKayitMetni(aylar[1]!)).toBe('1 plan kaydı');
  });

  it('gelir, ara toplam, genel toplam ve adet satırları harcama toplamına girmez: satır sahipliği haritası yok → tutar üretilmez', () => {
    const satirlar = (basis: string) => [
      gozlem({ label: 'Örnek gider', period: '2026-12', basis }, '100.00'),
      gozlem({ label: 'Maaş', period: '2026-12', basis }, '50000.00'),
      gozlem({ label: 'Toplam gelir', period: '2026-12', basis }, '50000.00'),
      gozlem({ label: 'Faturalar toplamı', period: '2026-12', basis }, '3000.00'),
      gozlem({ label: 'Toplam ödemeler', period: '2026-12', basis }, '3100.00'),
      gozlem({ label: 'Doğalgaz · adet', period: '2026-12', basis }, '3', null),
    ];
    const [ay] = aylikSatirlar([...satirlar('planned'), ...satirlar('recorded_aggregate')], BUGUN, 1);
    expect(ay!.donem).toBe('2026-12');
    expect(ayPlanMetni(ay!)).toBe(TOTAL_UNAVAILABLE_TEXT);
    expect(ayGerceklesenMetni(ay!)).toBe(TOTAL_UNAVAILABLE_TEXT);
    // Satırlar yalnız sayılır; hiçbir tutar (₺) türetilmez, plan ve gerçek tek sayıda birleşmez.
    expect(ayKayitMetni(ay!)).toBe('6 plan · 6 gerçekleşen');
    expect(JSON.stringify(ay)).not.toMatch(/amount|₺/);
    expect(ay!.spend).toEqual({ kind: 'in_source', percent: null, text: 'Kaynakta yazılı' });
  });

  it('kanıtlı Gerçekleşen "Harcandı" der; oran üretilmez (oran plan ve gerçek toplamı ister)', () => {
    const [ay] = aylikSatirlar([
      gozlem({ label: 'A', period: '2026-12', basis: 'planned' }, '200.00'),
      gozlem({ label: 'A', period: '2026-12', basis: 'recorded_aggregate', payment_evidence: true }, '50.00'),
    ], BUGUN, 1);
    expect(ay!.spend).toEqual({ kind: 'spent', percent: null, text: 'Harcandı' });
  });

  it('silinmiş ve sınıflanmamış gözlem sayılmaz; gerekçe metni ortak katalog metnidir', () => {
    const [ay] = aylikSatirlar([
      gozlem({ label: 'A', period: '2026-12', basis: 'planned' }),
      gozlem({ label: 'A', period: '2026-12', basis: 'planned', deleted_at: '2026-12-01T00:00:00Z' }),
      gozlem({ label: 'A', period: '2026-12', basis: 'unclassified' }),
    ], BUGUN, 1);
    expect(ay).toMatchObject({ planKaydi: 1, gerceklesenKaydi: 0 });
    expect(ayGerceklesenMetni(ay!)).toBe('Henüz yok');
    expect(AYLIK_TOPLAM_NOTU).toBe(createViewCatalog([]).sumUnavailableReason('budget_observation'));
  });
});

describe('genel/model › ölçüler ve ödemeler', () => {
  const olay = (alanlar: Partial<ForecastEvent>): ForecastEvent => ({ id: `o-${++sayac}`, tenant_id: 't', certainty: 'planned', ...alanlar }) as ForecastEvent;

  it('pencere bugün dahil, +7. gün hariç; nakit girişi ödeme değildir; tutar plan ölçüsü ya da çıkışın mutlak değeri', () => {
    const odemeler = yaklasanOdemeler([
      olay({ label: 'Bugün', occurred_on: '2026-12-05', cash_change: { amount: '-10.00', currency: 'TRY' } }),
      olay({ label: 'Son gün', occurred_on: '2026-12-11', measures: { planned: { amount: '20.00', currency: 'TRY' } } }),
      olay({ label: 'Pencere dışı', occurred_on: '2026-12-12', cash_change: { amount: '-30.00', currency: 'TRY' } }),
      olay({ label: 'Dün', occurred_on: '2026-12-04', cash_change: { amount: '-40.00', currency: 'TRY' } }),
      olay({ label: 'Giriş', occurred_on: '2026-12-06', cash_change: { amount: '50.00', currency: 'TRY' } }),
      olay({ label: 'Silinmiş', occurred_on: '2026-12-06', deleted_at: '2026-12-01', cash_change: { amount: '-60.00', currency: 'TRY' } }),
    ], '2026-12-05');
    expect(odemeler.map(o => o.label)).toEqual(['Bugün', 'Son gün']);
    expect(odemeler[0]!.amount).toEqual({ amount: '10.00', currency: 'TRY' });
    const olcu = odenecekOlcusu(odemeler, false);
    expect(olcu.value).toBe('₺30,00');
    expect(olcu.note).toBe('2 ödeme · tahmin');
  });

  it('tutarı olmayan ödeme adıyla sayılır; hiç tutar yoksa "Bilinmiyor"', () => {
    const odemeler = yaklasanOdemeler([olay({ label: 'Tutarsız', occurred_on: '2026-12-06' })], '2026-12-05');
    expect(odemeler[0]!.amount).toBeNull();
    expect(odenecekOlcusu(odemeler, false)).toMatchObject({ value: 'Bilinmiyor', note: '1 ödeme · 1 tutarsız · tahmin' });
    expect(odenecekOlcusu([], true)).toMatchObject({ value: 'Bilinmiyor', note: 'Kaynakta tahmin olayı kaydı yok' });
  });

  it('geciken: açık ve vadesi geçmiş kayıtların yalnız plan toplamı, kesin ondalık; fiyatsız sayısı adıyla', () => {
    const kayit = (alanlar: Partial<PurchaseNeedRecord>): PurchaseNeedRecord =>
      ({ id: `k-${++sayac}`, tenant_id: 't', state_snapshot: { decision: null, fulfillment: null, inspection: null, payment: null }, amounts: {}, dates: {}, ...alanlar }) as PurchaseNeedRecord;
    const gecikenler = gecikenKayitlar([
      kayit({ dates: { order_due_on: '2026-12-04' }, amounts: { planned: { amount: '90071992547409.93', currency: 'TRY' } } }),
      kayit({ dates: { planned_on: '2026-11-01' }, amounts: { planned: { amount: '0.07', currency: 'TRY' } } }),
      kayit({ dates: { planned_on: '2026-11-01' } }),
      kayit({ dates: { planned_on: '2026-12-05' }, amounts: { planned: { amount: '5.00', currency: 'TRY' } } }),
      kayit({ dates: { planned_on: '2026-11-01' }, state_snapshot: { decision: null, fulfillment: 'installed', inspection: null, payment: null } }),
    ], '2026-12-05');
    expect(gecikenler).toHaveLength(3);
    expect(gecikenOlcusu(gecikenler)).toEqual({ label: 'Geciken', value: '₺90.071.992.547.410,00', note: '3 kayıt · 1 fiyatsız · plan toplamı' });
  });

  it('geciken: kaynakta alım ve iş emri kaydı yoksa tutar uydurulmaz ("₺0,00 · Geciken yok" değil), adıyla söylenir', () => {
    expect(gecikenOlcusu([], true)).toEqual({ label: 'Geciken', value: 'Bilinmiyor', note: 'Kaynakta alım ve iş emri kaydı yok' });
    // Kayıt var ama vadesi geçen yok: sıfır toplam kayıtla desteklenir.
    expect(gecikenOlcusu([], false)).toEqual({ label: 'Geciken', value: '₺0,00', note: 'Geciken yok' });
  });

  it('kalan nakit: İstanbul dönemindeki forecast_months kapanışı "tahmin · son gün"; ay yoksa nedeni adıyla', () => {
    const aylar = [{ id: 'm', tenant_id: 't', period: '2026-11', measures: { closing_balance: { amount: '39500.00', currency: 'TRY' } } }] as ForecastMonth[];
    expect(kalanNakit(aylar, '2026-11')).toEqual({ label: 'Bu ay kalan nakit', value: '₺39.500,00', note: "tahmin · 30.11'e kadar" });
    expect(kalanNakit(aylar, '2026-12')).toMatchObject({ value: 'Bilinmiyor', note: 'Aralık 2026 için tahmin yok' });
    expect(kalanNakit([], '2026-12')).toMatchObject({ value: 'Bilinmiyor', note: 'Kaynakta tahmin ayı kaydı yok' });
  });

  it('toplam metni: tek birim ₺, karışık birim adıyla, değer yoksa verilen ad', () => {
    expect(toplamMetni({ money: { amount: '8500.00', currency: 'TRY' }, counted: 1, missing: 0, currencies: ['TRY'] })).toBe('₺8.500,00');
    expect(toplamMetni({ money: null, counted: 2, missing: 0, currencies: ['EUR', 'TRY'] })).toBe(MIXED_CURRENCY_TEXT);
    expect(toplamMetni({ money: null, counted: 0, missing: 1, currencies: [] }, 'Fiyat yok')).toBe('Fiyat yok');
  });
});
