import { describe, expect, it } from 'vitest';
import plannedPartition from '../../../fixtures/generation-synthetic/d062d4882617b40bffe4d2b0b603125a949c8795992611af1be08f6ef6b7ed10/data/budget_observations/budget/201/00000.json';
import recordedPartition from '../../../fixtures/generation-synthetic/d062d4882617b40bffe4d2b0b603125a949c8795992611af1be08f6ef6b7ed10/data/budget_observations/budget/202/00000.json';
import {
  BUDGET_DEFAULT_CURRENCY,
  BUDGET_TIME_ZONE,
  MIRRORS_PLAN_NOTE,
  MIXED_CURRENCY_TEXT,
  RECORDED_IN_SOURCE_TEXT,
  RECORDED_NOT_YET_TEXT,
  currentPeriod,
  isFuturePeriod,
  mirrorsPlan,
  observationMoney,
  plannedTotal,
  recordedFor,
  recordedTotal,
  spendLabel,
  sumMoney,
  type RecordedValue,
} from './actuals';
import type { BudgetObservation } from './types';

// Sentetik kayıtlar: gerçek nesil değerleri burada yok. "Bugün" Europe/Istanbul ayıyla okunur; UTC anları bilerek seçildi.
const TODAY = new Date('2026-11-02T09:00:00Z'); // İstanbul: 2 Kasım 2026, 12:00
const TENANT = '00000000-0000-4000-8000-000000000000';

let seq = 0;
function obs(partial: Partial<BudgetObservation> & Pick<BudgetObservation, 'period' | 'basis'>): BudgetObservation {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    tenant_id: TENANT,
    kind: 'budget_observation',
    label: 'Örnek gider satırı 1',
    value: { decimal: '8500.00', currency: 'TRY' },
    payment_evidence: false,
    ...partial,
  };
}
const planned = (period: string, label: string, decimal: string | null, currency: string | null = 'TRY') =>
  obs({ period, basis: 'planned', label, value: { decimal, currency } });
const recorded = (period: string, label: string, decimal: string | null, extra: Partial<BudgetObservation> = {}) =>
  obs({ period, basis: 'recorded_aggregate', label, value: { decimal, currency: 'TRY' }, ...extra });
const try_ = (amount: string) => ({ amount, currency: 'TRY' });

const syntheticPlanned = plannedPartition.records as BudgetObservation[];
const syntheticRecorded = recordedPartition.records as BudgetObservation[];

describe('currentPeriod', () => {
  it('Europe/Istanbul ayını YYYY-MM olarak verir', () => {
    expect(BUDGET_TIME_ZONE).toBe('Europe/Istanbul');
    expect(currentPeriod(TODAY)).toBe('2026-11');
  });

  it('31 Ekim 23:30 UTC İstanbul’da 1 Kasım’dır', () => {
    expect(currentPeriod(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
  });

  it('ay sınırı İstanbul gece yarısıdır (UTC 21:00), UTC gece yarısı değil', () => {
    expect(currentPeriod(new Date('2026-10-31T20:59:59.999Z'))).toBe('2026-10');
    expect(currentPeriod(new Date('2026-10-31T21:00:00.000Z'))).toBe('2026-11');
    expect(currentPeriod(new Date('2026-12-31T21:00:00.000Z'))).toBe('2027-01');
  });

  it('geçersiz tarihte dönem uydurmaz, hata verir', () => {
    expect(() => currentPeriod(new Date(Number.NaN))).toThrow(RangeError);
  });

  it('isFuturePeriod yalnız içinde bulunulan aydan sonrası için true', () => {
    expect(isFuturePeriod('2026-12', TODAY)).toBe(true);
    expect(isFuturePeriod('2026-11', TODAY)).toBe(false);
    expect(isFuturePeriod('2026-10', TODAY)).toBe(false);
    expect(isFuturePeriod('2026-11', new Date('2026-10-31T20:00:00Z'))).toBe(true);
    expect(isFuturePeriod('2026-11', new Date('2026-10-31T23:30:00Z'))).toBe(false);
  });
});

describe('observationMoney', () => {
  it('ondalık metni olduğu gibi taşır; para birimi yoksa bütçe kaynağının birimi (TRY)', () => {
    expect(observationMoney(planned('2026-11', 'a', '8500.00'))).toEqual(try_('8500.00'));
    expect(BUDGET_DEFAULT_CURRENCY).toBe('TRY');
    expect(observationMoney(planned('2026-11', 'a', '120', null))).toEqual(try_('120'));
    expect(observationMoney(planned('2026-11', 'a', '15', 'USD'))).toEqual({ amount: '15', currency: 'USD' });
  });

  it('değer yoksa ya da ondalık bozuksa null (sıfır değil)', () => {
    expect(observationMoney(planned('2026-11', 'a', null))).toBeNull();
    expect(observationMoney(planned('2026-11', 'a', '8.500,00'))).toBeNull();
    expect(observationMoney(planned('2026-11', 'a', ''))).toBeNull();
  });
});

describe('recordedFor', () => {
  it('gelecek ayın Gerçekleşen kaydı "Henüz yok"tur', () => {
    expect(recordedFor(recorded('2026-12', 'a', '8500.00'), TODAY)).toEqual({ kind: 'not_yet' });
    expect(recordedFor(recorded('2027-12', 'a', '8500.00'), TODAY)).toEqual({ kind: 'not_yet' });
    expect(RECORDED_NOT_YET_TEXT).toBe('Henüz yok');
  });

  it('bu ayın kaydı kaynakta yazılı tutardır; kanıt yoksa evidence false', () => {
    expect(recordedFor(recorded('2026-11', 'a', '8500.00'), TODAY)).toEqual({ kind: 'recorded', money: try_('8500.00'), evidence: false });
  });

  it('geçmiş ay, ödeme kanıtı varsa evidence true', () => {
    expect(recordedFor(recorded('2026-10', 'a', '6500.00', { payment_evidence: true }), TODAY)).toEqual({
      kind: 'recorded',
      money: try_('6500.00'),
      evidence: true,
    });
  });

  it('kanıt yalnız payment_evidence === true iken sayılır', () => {
    const odd = recorded('2026-10', 'a', '1.00', { payment_evidence: 'true' as unknown as boolean });
    expect(recordedFor(odd, TODAY)).toMatchObject({ kind: 'recorded', evidence: false });
  });

  it('saat dilimi sınırı: 31 Ekim 23:30 UTC’de Kasım kaydı yazılıdır, 20:00 UTC’de henüz yoktur', () => {
    const november = recorded('2026-11', 'a', '100.00');
    expect(recordedFor(november, new Date('2026-10-31T23:30:00Z'))).toMatchObject({ kind: 'recorded' });
    expect(recordedFor(november, new Date('2026-10-31T20:00:00Z'))).toEqual({ kind: 'not_yet' });
  });

  it('değeri okunamayan yazılı kayıtta money null (UI "Bilinmiyor")', () => {
    expect(recordedFor(recorded('2026-10', 'a', null), TODAY)).toEqual({ kind: 'recorded', money: null, evidence: false });
  });

  it('plan, unclassified, bilinmeyen basis, silinmiş ya da dönemi bozuk kayıt Gerçekleşen değildir', () => {
    expect(recordedFor(planned('2026-10', 'a', '1.00'), TODAY)).toBeNull();
    expect(recordedFor(obs({ period: '2026-10', basis: 'unclassified' }), TODAY)).toBeNull();
    expect(recordedFor(obs({ period: '2026-10', basis: 'forecast' }), TODAY)).toBeNull();
    expect(recordedFor(recorded('2026-10', 'a', '1.00', { deleted_at: '2026-10-20T00:00:00Z' }), TODAY)).toBeNull();
    expect(recordedFor(recorded('2026-13', 'a', '1.00'), TODAY)).toBeNull();
  });

  it('sentetik nesil: Aralık 2026 ve sonrası "Henüz yok", Kasım 2026 ve öncesi kanıtsız yazılı', () => {
    const results = syntheticRecorded.map(record => ({ period: record.period, value: recordedFor(record, TODAY) }));
    const future = results.filter(r => r.period > '2026-11');
    const past = results.filter(r => r.period <= '2026-11');
    expect(future.length).toBeGreaterThan(0);
    expect(past.length).toBeGreaterThan(0);
    expect(future.every(r => r.value?.kind === 'not_yet')).toBe(true);
    expect(past.every(r => r.value?.kind === 'recorded' && r.value.evidence === false && r.value.money !== null)).toBe(true);
    expect(syntheticPlanned.every(record => recordedFor(record, TODAY) === null)).toBe(true);
  });
});

describe('spendLabel', () => {
  const plan = try_('10000.00');
  const withEvidence = (amount: string): RecordedValue => ({ kind: 'recorded', money: try_(amount), evidence: true });
  const withoutEvidence = (amount: string): RecordedValue => ({ kind: 'recorded', money: try_(amount), evidence: false });

  it('ödeme kanıtı varsa oran ve "harcandı" metni üretir', () => {
    expect(spendLabel(plan, withEvidence('6500.00'))).toEqual({ kind: 'spent', percent: 65, text: '%65 harcandı' });
    expect(spendLabel(plan, withEvidence('11200.00'))).toEqual({ kind: 'spent', percent: 112, text: '%112 harcandı' });
  });

  it('kanıt yoksa plana eşit olsa bile oran yok: "Kaynakta yazılı"', () => {
    expect(RECORDED_IN_SOURCE_TEXT).toBe('Kaynakta yazılı');
    expect(spendLabel(plan, withoutEvidence('10000.00'))).toEqual({ kind: 'in_source', percent: null, text: 'Kaynakta yazılı' });
    expect(spendLabel(plan, withoutEvidence('6500.00')).text).not.toMatch(/harcandı|%/);
  });

  it('gelecek ay ya da Gerçekleşen kaydı yoksa "Henüz yok"', () => {
    expect(spendLabel(plan, { kind: 'not_yet' })).toEqual({ kind: 'not_yet', percent: null, text: 'Henüz yok' });
    expect(spendLabel(plan, null)).toEqual({ kind: 'not_yet', percent: null, text: 'Henüz yok' });
  });

  it('oran ondalık metinden kesin hesaplanır ve yarım yukarı yuvarlanır; binlik ayırıcı tr-TR', () => {
    expect(spendLabel(plan, withEvidence('6650.00')).percent).toBe(67);
    expect(spendLabel(plan, withEvidence('6649.99')).percent).toBe(66);
    expect(spendLabel(try_('3'), withEvidence('2')).percent).toBe(67);
    expect(spendLabel(try_('100'), withEvidence('2500'))).toEqual({ kind: 'spent', percent: 2500, text: '%2.500 harcandı' });
  });

  it('kanıt var ama oran hesaplanamıyorsa (plan yok, sıfır, birim farklı, tutar yok) oran üretilmez', () => {
    expect(spendLabel(null, withEvidence('100.00'))).toEqual({ kind: 'spent', percent: null, text: 'Harcandı' });
    expect(spendLabel(try_('0.00'), withEvidence('100.00')).percent).toBeNull();
    expect(spendLabel({ amount: '100.00', currency: 'USD' }, withEvidence('100.00')).percent).toBeNull();
    expect(spendLabel(plan, { kind: 'recorded', money: null, evidence: true }).percent).toBeNull();
  });
});

describe('mirrorsPlan', () => {
  const period = '2026-11';
  const base = [
    planned(period, 'Kira', '25000.00'),
    planned(period, 'Market', '8500.00'),
    planned(period, 'Ulaşım', '3000'),
  ];

  it('her Gerçekleşen etiketi aynı etiketin plan değerine eşit ve kanıt yoksa true', () => {
    const observations = [
      ...base,
      recorded(period, 'Kira', '25000.00'),
      recorded(period, 'Market', '8500'),
      recorded(period, 'Ulaşım', '3000.00'),
    ];
    expect(mirrorsPlan(observations)).toBe(true);
    expect(MIRRORS_PLAN_NOTE).toBe('Gerçekleşen sekmesi bu ay plan değerlerini taşıyor; ödeme kanıtı yok.');
  });

  it('planda olup Gerçekleşen’de olmayan etiket aynayı bozmaz', () => {
    expect(mirrorsPlan([...base, recorded(period, 'Kira', '25000.00')])).toBe(true);
  });

  it('bir değer farklıysa false', () => {
    expect(mirrorsPlan([...base, recorded(period, 'Kira', '25000.00'), recorded(period, 'Market', '8499.99')])).toBe(false);
  });

  it('herhangi birinde ödeme kanıtı varsa false', () => {
    expect(mirrorsPlan([...base, recorded(period, 'Kira', '25000.00', { payment_evidence: true })])).toBe(false);
  });

  it('planı olmayan Gerçekleşen etiketi ya da değeri okunamayan kayıt false', () => {
    expect(mirrorsPlan([...base, recorded(period, 'Kira', '25000.00'), recorded(period, 'Tatil', '1000.00')])).toBe(false);
    expect(mirrorsPlan([...base, recorded(period, 'Kira', null)])).toBe(false);
  });

  it('para birimi farklıysa tutar aynı olsa da ayna değildir', () => {
    const usd = obs({ period, basis: 'recorded_aggregate', label: 'Kira', value: { decimal: '25000.00', currency: 'USD' } });
    expect(mirrorsPlan([...base, usd])).toBe(false);
  });

  it('Gerçekleşen kaydı yoksa ayna yoktur', () => {
    expect(mirrorsPlan(base)).toBe(false);
    expect(mirrorsPlan([])).toBe(false);
  });

  it('unclassified, bilinmeyen basis ve silinmiş kayıtlar karşılaştırmaya girmez', () => {
    const observations = [
      ...base,
      recorded(period, 'Kira', '25000.00'),
      obs({ period, basis: 'unclassified', label: 'Market', value: { decimal: '1.00', currency: 'TRY' } }),
      obs({ period, basis: 'forecast', label: 'Kira', value: { decimal: '2.00', currency: 'TRY' } }),
      recorded(period, 'Market', '1.00', { deleted_at: '2026-11-01T00:00:00Z' }),
    ];
    expect(mirrorsPlan(observations)).toBe(true);
  });

  it('aynı etiketli birden çok satır birebir eşlenir (çoklu küme)', () => {
    const plans = [planned(period, 'Diğer', '100.00'), planned(period, 'Diğer', '200.00')];
    expect(mirrorsPlan([...plans, recorded(period, 'Diğer', '200.00'), recorded(period, 'Diğer', '100.00')])).toBe(true);
    expect(mirrorsPlan([...plans, recorded(period, 'Diğer', '100.00'), recorded(period, 'Diğer', '100.00')])).toBe(false);
  });

  it('dönemler karışık verilirse her etiket yalnız kendi dönemindeki planla karşılaştırılır', () => {
    const observations = [planned('2026-10', 'Kira', '24000.00'), planned('2026-11', 'Kira', '25000.00'), recorded('2026-11', 'Kira', '24000.00')];
    expect(mirrorsPlan(observations)).toBe(false);
  });

  it('sentetik nesil: Kasım 2026 aynası yok; planın kanıtsız kopyası ayna sayılır', () => {
    const november = [...syntheticPlanned, ...syntheticRecorded].filter(record => record.period === '2026-11');
    expect(mirrorsPlan(november)).toBe(false);
    const plansOnly = syntheticPlanned.filter(record => record.period === '2026-11');
    const copied = plansOnly.map(record => ({ ...record, id: `${record.id}-copy`, basis: 'recorded_aggregate' }));
    expect(mirrorsPlan([...plansOnly, ...copied])).toBe(true);
  });
});

describe('sumMoney', () => {
  it('ondalık metni kesin toplar (kayan nokta yok), en az iki ondalık', () => {
    expect(sumMoney([try_('8500.00'), try_('1500.5')])).toEqual({ money: try_('10000.50'), counted: 2, missing: 0, currencies: ['TRY'] });
    expect(sumMoney([try_('0.1'), try_('0.2')]).money).toEqual(try_('0.30'));
    expect(sumMoney([try_('0.105'), try_('0.105')]).money).toEqual(try_('0.210'));
    expect(sumMoney([try_('100.00'), try_('-250.25')]).money).toEqual(try_('-150.25'));
    expect(sumMoney([try_('9007199254740993.01'), try_('1.00')]).money).toEqual(try_('9007199254740994.01'));
  });

  it('para birimi farklıysa toplamaz', () => {
    const total = sumMoney([try_('100.00'), { amount: '5.00', currency: 'USD' }]);
    expect(total.money).toBeNull();
    expect(total.currencies).toEqual(['TRY', 'USD']);
    expect(MIXED_CURRENCY_TEXT).toBe('Birden çok para birimi');
  });

  it('eksik ya da bozuk değer toplama girmez, sayısı söylenir; hiç değer yoksa toplam yok', () => {
    expect(sumMoney([try_('100.00'), null, { amount: 'abc', currency: 'TRY' }])).toEqual({ money: try_('100.00'), counted: 1, missing: 2, currencies: ['TRY'] });
    expect(sumMoney([])).toEqual({ money: null, counted: 0, missing: 0, currencies: [] });
    expect(sumMoney([null])).toEqual({ money: null, counted: 0, missing: 1, currencies: [] });
  });
});

describe('plannedTotal / recordedTotal', () => {
  const period = '2026-11';
  const observations = [
    planned(period, 'Kira', '25000.00'),
    planned(period, 'Market', '8500.00'),
    planned('2026-10', 'Kira', '1.00'),
    recorded(period, 'Kira', '25000.00'),
    recorded(period, 'Market', '8000.50'),
    recorded('2026-10', 'Kira', '7.00'),
    obs({ period, basis: 'unclassified', label: 'Kira', value: { decimal: '999.00', currency: 'TRY' } }),
    obs({ period, basis: 'something_new', label: 'Kira', value: { decimal: '555.00', currency: 'TRY' } }),
    recorded(period, 'Silinen', '444.00', { deleted_at: '2026-11-01T00:00:00Z' }),
  ];

  it('plan toplamı yalnız planned basis ve seçili dönem', () => {
    expect(plannedTotal(observations, period)).toEqual({ money: try_('33500.00'), counted: 2, missing: 0, currencies: ['TRY'] });
  });

  it('Gerçekleşen toplamı yalnız recorded_aggregate; unclassified ve bilinmeyen basis katılmaz; kanıt yoksa evidence false', () => {
    const total = recordedTotal(observations, period, TODAY);
    expect(total).toEqual({
      kind: 'recorded',
      money: try_('33000.50'),
      evidence: false,
      total: { money: try_('33000.50'), counted: 2, missing: 0, currencies: ['TRY'] },
    });
    expect(spendLabel(plannedTotal(observations, period).money, total).text).toBe('Kaynakta yazılı');
  });

  it('kanıt yalnız tüm Gerçekleşen kayıtlarında varsa true', () => {
    const all = [recorded(period, 'A', '10.00', { payment_evidence: true }), recorded(period, 'B', '20.00', { payment_evidence: true })];
    expect(recordedTotal(all, period, TODAY)).toMatchObject({ kind: 'recorded', evidence: true, money: try_('30.00') });
    const partial = [...all, recorded(period, 'C', '5.00')];
    expect(recordedTotal(partial, period, TODAY)).toMatchObject({ kind: 'recorded', evidence: false, money: try_('35.00') });
  });

  it('gelecek dönemde toplam yok: "Henüz yok"', () => {
    expect(recordedTotal([recorded('2026-12', 'Kira', '25000.00')], '2026-12', TODAY)).toEqual({ kind: 'not_yet' });
  });

  it('dönemde Gerçekleşen kaydı yoksa money null, evidence false', () => {
    expect(recordedTotal([planned(period, 'Kira', '1.00')], period, TODAY)).toEqual({
      kind: 'recorded',
      money: null,
      evidence: false,
      total: { money: null, counted: 0, missing: 0, currencies: [] },
    });
  });

  it('para birimi karışıksa Gerçekleşen toplamı yok', () => {
    const mixed = [recorded(period, 'A', '10.00'), obs({ period, basis: 'recorded_aggregate', label: 'B', value: { decimal: '5.00', currency: 'USD' } })];
    const total = recordedTotal(mixed, period, TODAY);
    expect(total).toMatchObject({ kind: 'recorded', money: null });
    expect(total.kind === 'recorded' && total.total.currencies).toEqual(['TRY', 'USD']);
  });
});

describe('veri barrel’ı', () => {
  it('actuals yardımcıları ../data üzerinden dışa verilir', async () => {
    const data = await import('./index');
    expect(data.recordedFor).toBe(recordedFor);
    expect(data.spendLabel).toBe(spendLabel);
    expect(data.mirrorsPlan).toBe(mirrorsPlan);
    expect(data.currentPeriod).toBe(currentPeriod);
    expect(data.MIRRORS_PLAN_NOTE).toBe(MIRRORS_PLAN_NOTE);
  });
});
