import { MIRRORS_PLAN_NOTE, MIXED_CURRENCY_TEXT, type BudgetObservation, type PivotMeasure } from '../../data';
import {
  BILINMIYOR, PLAN_YOK, SON_12, SON_6, TUM,
  defaultPeriodChoice, lastMonths, monthRows, ownedMeasures, periodOptions, periodsFor, plannedOver, plannedText, rangeText,
  recordedOver, recordedText, roomRows,
} from './model';

// Raporlar saf modeli: dönem seçimi, ay satırları ve toplamlar. Gerçekleşen yalnız actuals.ts anlamıyla (gelecek dönem
// "Henüz yok", kanıtsız oran yok); para kesin (bigint, kayan nokta yok); plan ve gerçek ayrı değer; birden çok para
// birimi toplanmaz. Saat sabit: 2 Kasım 2026 İstanbul.
const TODAY = new Date('2026-11-02T10:00:00+03:00');
const CURRENT = '2026-11';

let seq = 0;
function obs(period: string, basis: string, decimal: string | null, extra: Partial<BudgetObservation> = {}): BudgetObservation {
  seq += 1;
  return {
    id: `o-${seq}`,
    tenant_id: 't',
    kind: 'budget_observation',
    label: extra.label ?? 'Kalem A',
    period,
    basis,
    value: { decimal, currency: 'TRY' },
    payment_evidence: false,
    ...extra,
  };
}

const MEASURES: PivotMeasure[] = [
  { id: 'count', label: 'Kayıt sayısı', aggregate: 'count' },
  { id: 'sum_planned', label: 'Plan toplamı', aggregate: 'sum', field: 'value.decimal', basis: 'planned', currencyField: 'value.currency' },
  { id: 'sum_recorded', label: 'Gerçekleşen toplamı', aggregate: 'sum', field: 'value.decimal', basis: 'recorded_aggregate', currencyField: 'value.currency' },
];

describe('raporlar/model › dönem seçimi', () => {
  it('lastMonths içinde bulunulan aydan geriye sayar, yıl sınırını geçer', () => {
    expect(lastMonths('2026-11', 6)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(lastMonths('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('seçenekler: Son 6 ay, Son 12 ay, verideki yıllar, Tüm dönemler', () => {
    const periods = ['2027-03', '2026-01', '2026-12'];
    expect(periodOptions(periods)).toEqual([
      { value: SON_6, label: 'Son 6 ay' },
      { value: SON_12, label: 'Son 12 ay' },
      { value: '2026', label: '2026' },
      { value: '2027', label: '2027' },
      { value: TUM, label: 'Tüm dönemler' },
    ]);
  });

  it('varsayılan: son 6 ayda veri varsa Son 6 ay; yoksa verideki son yıl; veri yoksa Tüm dönemler', () => {
    expect(defaultPeriodChoice(['2026-01', '2026-11', '2027-12'], CURRENT)).toBe(SON_6);
    expect(defaultPeriodChoice(['2019-04', '2020-02'], CURRENT)).toBe('2020');
    expect(defaultPeriodChoice([], CURRENT)).toBe(TUM);
  });

  it('periodsFor yalnız verideki dönemleri, sıralı verir', () => {
    const data = ['2027-01', '2026-05', '2026-06', '2026-11', '2026-12'];
    expect(periodsFor(SON_6, data, CURRENT)).toEqual(['2026-06', '2026-11']);
    expect(periodsFor('2026', data, CURRENT)).toEqual(['2026-05', '2026-06', '2026-11', '2026-12']);
    expect(periodsFor(TUM, data, CURRENT)).toEqual(['2026-05', '2026-06', '2026-11', '2026-12', '2027-01']);
  });

  it('rangeText aralığı Türkçe ay adıyla yazar; içinde bulunulan ay "sürüyor"', () => {
    expect(rangeText(lastMonths(CURRENT, 6), CURRENT)).toBe('Haziran – Kasım 2026 · Kasım sürüyor');
    expect(rangeText(['2027-01', '2027-12'], CURRENT)).toBe('Ocak – Aralık 2027');
    expect(rangeText(['2025-12', '2026-01'], CURRENT)).toBe('Aralık 2025 – Ocak 2026');
    expect(rangeText(['2026-11'], CURRENT)).toBe('Kasım 2026 · Kasım sürüyor');
    expect(rangeText([], CURRENT)).toBe('');
  });
});

describe('raporlar/model › ay satırları (actuals anlamı)', () => {
  it('gelecek dönemin Gerçekleşen değeri "Henüz yok"; plan yazılı ve kesin toplanır', () => {
    const rows = monthRows([
      obs('2026-12', 'planned', '1000.10'), obs('2026-12', 'planned', '0.20', { label: 'Kalem B' }),
      obs('2026-12', 'recorded_aggregate', '999.00'),
    ], ['2026-12'], TODAY);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.future).toBe(true);
    expect(row!.recorded).toEqual({ kind: 'not_yet' });
    expect(recordedText(row!.recorded)).toBe('Henüz yok');
    expect(row!.spend.text).toBe('Henüz yok');
    expect(row!.planned.money).toEqual({ amount: '1000.30', currency: 'TRY' });
    expect(plannedText(row!.planned)).toBe('₺1.000,30');
  });

  it('içinde bulunulan ay: kanıtsız yazılı değer "Kaynakta yazılı", oran yok; plan ve gerçek ayrı', () => {
    const [row] = monthRows([obs(CURRENT, 'planned', '8500'), obs(CURRENT, 'recorded_aggregate', '4250.00')], [CURRENT], TODAY);
    expect(row!.current).toBe(true);
    expect(row!.spend).toEqual({ kind: 'in_source', percent: null, text: 'Kaynakta yazılı' });
    expect(plannedText(row!.planned)).toBe('₺8.500,00');
    expect(recordedText(row!.recorded)).toBe('₺4.250,00');
  });

  it('ödeme kanıtı varsa oran spendLabel ile gelir', () => {
    const [row] = monthRows([
      obs('2026-10', 'planned', '200.00'), obs('2026-10', 'recorded_aggregate', '50.00', { payment_evidence: true }),
    ], ['2026-10'], TODAY);
    expect(row!.spend).toEqual({ kind: 'spent', percent: 25, text: '%25 harcandı' });
  });

  it('geçmiş ayda Gerçekleşen kaydı yoksa "Henüz yok"; "Kaynakta yazılı" uydurulmaz', () => {
    const [row] = monthRows([obs('2026-09', 'planned', '100.00')], ['2026-09'], TODAY);
    expect(recordedText(row!.recorded)).toBe('Henüz yok');
    expect(row!.spend.text).toBe('Henüz yok');
    expect(row!.recordedCount).toBe(0);
  });

  it('kayan nokta yok: 0,10 + 0,20 = 0,30 ve büyük tutar kesin', () => {
    const [row] = monthRows([
      obs('2026-10', 'planned', '0.10'), obs('2026-10', 'planned', '0.20'),
      obs('2026-10', 'recorded_aggregate', '90071992547409.93'), obs('2026-10', 'recorded_aggregate', '0.01'),
    ], ['2026-10'], TODAY);
    expect(row!.planned.money).toEqual({ amount: '0.30', currency: 'TRY' });
    expect(row!.recorded).toMatchObject({ kind: 'recorded', money: { amount: '90071992547409.94', currency: 'TRY' } });
  });

  it('birden çok para birimi toplanmaz: "Birden çok para birimi"', () => {
    const [row] = monthRows([
      obs('2026-10', 'planned', '10.00'), obs('2026-10', 'planned', '5.00', { value: { decimal: '5.00', currency: 'EUR' } }),
      obs('2026-10', 'recorded_aggregate', '1.00', { value: { decimal: '1.00', currency: 'USD' } }), obs('2026-10', 'recorded_aggregate', '1.00'),
    ], ['2026-10'], TODAY);
    expect(plannedText(row!.planned)).toBe(MIXED_CURRENCY_TEXT);
    expect(recordedText(row!.recorded)).toBe(MIXED_CURRENCY_TEXT);
  });

  it('okunamayan değer sıfır sayılmaz: yalnız eksikse "Bilinmiyor", kısmen eksikse not', () => {
    const [all] = monthRows([obs('2026-10', 'planned', null)], ['2026-10'], TODAY);
    expect(plannedText(all!.planned)).toBe(BILINMIYOR);
    const [part] = monthRows([obs('2026-10', 'planned', null), obs('2026-10', 'planned', '7.00')], ['2026-10'], TODAY);
    expect(plannedText(part!.planned)).toBe('₺7,00 · 1 değer okunamadı');
    const [none] = monthRows([obs('2026-10', 'recorded_aggregate', '7.00')], ['2026-10'], TODAY);
    expect(plannedText(none!.planned)).toBe(PLAN_YOK);
  });

  it('silinmiş ve sınıflanmamış gözlemler hiçbir sayıya katılmaz', () => {
    const [row] = monthRows([
      obs('2026-10', 'planned', '10.00'), obs('2026-10', 'planned', '90.00', { deleted_at: '2026-10-20T00:00:00Z' }),
      obs('2026-10', 'unclassified', '500.00'),
    ], ['2026-10'], TODAY);
    expect(row!.planned.money).toEqual({ amount: '10.00', currency: 'TRY' });
    expect(row!.planCount).toBe(1);
    expect(row!.recordedCount).toBe(0);
  });

  it('Gerçekleşen sekmesi planı aynalıyorsa satır işaretlenir (MIRRORS_PLAN_NOTE)', () => {
    const [row] = monthRows([obs('2026-10', 'planned', '8500'), obs('2026-10', 'recorded_aggregate', '8500.00')], ['2026-10'], TODAY);
    expect(row!.mirrors).toBe(true);
    expect(MIRRORS_PLAN_NOTE).toMatch(/ödeme kanıtı yok/);
  });
});

describe('raporlar/model › çok dönemli toplamlar', () => {
  const rows = [
    obs('2026-10', 'planned', '100.00'), obs('2026-11', 'planned', '200.00'), obs('2026-12', 'planned', '300.00'),
    obs('2026-10', 'recorded_aggregate', '10.00'), obs('2026-11', 'recorded_aggregate', '20.00'), obs('2026-12', 'recorded_aggregate', '30.00'),
  ];

  it('plannedOver seçili dönemlerin planını kesin toplar', () => {
    expect(plannedOver(rows, ['2026-10', '2026-11', '2026-12']).money).toEqual({ amount: '600.00', currency: 'TRY' });
  });

  it('recordedOver gelecek dönemi saymaz; yalnız gelecek dönemse "Henüz yok"', () => {
    const past = recordedOver(rows, ['2026-10', '2026-11', '2026-12'], TODAY);
    expect(past).toMatchObject({ kind: 'recorded', money: { amount: '30.00', currency: 'TRY' }, evidence: false });
    expect(recordedOver(rows, ['2026-12'], TODAY)).toEqual({ kind: 'not_yet' });
    expect(recordedText(recordedOver(rows, ['2026-12'], TODAY))).toBe('Henüz yok');
  });
});

describe('raporlar/model › sahiplik', () => {
  it('ownedMeasures yalnız katalogdaki sahipliği belirlenmiş toplamları verir', () => {
    expect(ownedMeasures(MEASURES)).toMatchObject({ planned: { id: 'sum_planned' }, recorded: { id: 'sum_recorded' }, count: { id: 'count' } });
    expect(ownedMeasures([MEASURES[0]!])).toMatchObject({ planned: undefined, recorded: undefined, count: { id: 'count' } });
    expect(ownedMeasures([])).toMatchObject({ planned: undefined, recorded: undefined, count: undefined });
  });

  it('roomRows alımları odaya göre sayar; tutar toplamaz; odasız "Bilinmiyor" sonda', () => {
    const base = { code: 'x', status: { label: 'Açık', tone: 'notr' as const }, kind: 'purchase_need' };
    const rows = roomRows([
      { ...base, id: '1', label: 'a', room: 'Salon', planned: { amount: '10.00', currency: 'TRY' }, actual: null },
      { ...base, id: '2', label: 'b', planned: null, actual: null },
      { ...base, id: '3', label: 'c', room: 'Mutfak', planned: { amount: '5.00', currency: 'TRY' }, actual: { amount: '4.00', currency: 'TRY' } },
      { ...base, id: '4', label: 'd', room: 'Salon', planned: null, actual: null },
    ]);
    expect(rows).toEqual([
      { key: 'Mutfak', room: 'Mutfak', count: 1, withPlanned: 1, withActual: 1 },
      { key: 'Salon', room: 'Salon', count: 2, withPlanned: 1, withActual: 0 },
      { key: BILINMIYOR, room: BILINMIYOR, count: 1, withPlanned: 0, withActual: 0 },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/amount/);
  });
});
