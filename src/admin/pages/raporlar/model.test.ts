import { MIRRORS_PLAN_NOTE, TOTAL_UNAVAILABLE_TEXT, type BudgetObservation, type PivotMeasure } from '../../data';
import {
  BILINMIYOR, PLAN_YOK, SON_12, SON_6, TUM,
  defaultPeriodChoice, lastMonths, measureValue, monthCsv, monthPlannedText, monthRecordedText, monthRows, periodOptions, periodsFor,
  rangeText, recordCounts, roomRows, summaryPlannedText, summaryRecordedText,
} from './model';

// Raporlar saf modeli: dönem seçimi, ay satırları ve sayımlar. Gerçekleşen yalnız actuals.ts anlamıyla (gelecek dönem
// "Henüz yok", kanıtsız oran yok); plan ve gerçek ayrı değer. Bütçe gözlemleri toplanmaz: nesilde satır düzeyinde yaprak
// sahipliği haritası yok (views.sumUnavailableReason), toplam yerine "Toplam kullanılamaz". Saat sabit: 2 Kasım 2026
// İstanbul.
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

describe('raporlar/model › ay satırları (actuals anlamı; toplam yok)', () => {
  it('gelecek dönemin Gerçekleşen değeri "Henüz yok"; plan satırları toplanmaz: "Toplam kullanılamaz"', () => {
    const rows = monthRows([
      obs('2026-12', 'planned', '1000.10'), obs('2026-12', 'planned', '0.20', { label: 'Kalem B' }),
      obs('2026-12', 'recorded_aggregate', '999.00'),
    ], ['2026-12'], TODAY);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.future).toBe(true);
    expect(monthRecordedText(row!)).toBe('Henüz yok');
    expect(row!.spend.text).toBe('Henüz yok');
    expect(monthPlannedText(row!)).toBe(TOTAL_UNAVAILABLE_TEXT);
    expect(row!.planCount).toBe(2);
    expect(row!.recordedCount).toBe(0);
  });

  it('içinde bulunulan ay: kanıtsız yazılı değer "Kaynakta yazılı", oran yok; plan ve gerçek ayrı ve toplamsız', () => {
    const [row] = monthRows([obs(CURRENT, 'planned', '8500'), obs(CURRENT, 'recorded_aggregate', '4250.00')], [CURRENT], TODAY);
    expect(row!.current).toBe(true);
    expect(row!.spend).toEqual({ kind: 'in_source', percent: null, text: 'Kaynakta yazılı' });
    expect(monthPlannedText(row!)).toBe(TOTAL_UNAVAILABLE_TEXT);
    expect(monthRecordedText(row!)).toBe(TOTAL_UNAVAILABLE_TEXT);
  });

  it('ödeme kanıtı varsa "Harcandı"; oran üretilmez (oran plan ve gerçek toplamı ister, toplam yok)', () => {
    const [row] = monthRows([
      obs('2026-10', 'planned', '200.00'), obs('2026-10', 'recorded_aggregate', '50.00', { payment_evidence: true }),
    ], ['2026-10'], TODAY);
    expect(row!.spend).toEqual({ kind: 'spent', percent: null, text: 'Harcandı' });
  });

  it('geçmiş ayda Gerçekleşen kaydı yoksa "Henüz yok"; plan kaydı yoksa "Plan yok"; "Kaynakta yazılı" uydurulmaz', () => {
    const [row] = monthRows([obs('2026-09', 'planned', '100.00')], ['2026-09'], TODAY);
    expect(monthRecordedText(row!)).toBe('Henüz yok');
    expect(row!.spend.text).toBe('Henüz yok');
    expect(row!.recordedCount).toBe(0);
    const [none] = monthRows([obs('2026-10', 'recorded_aggregate', '7.00')], ['2026-10'], TODAY);
    expect(monthPlannedText(none!)).toBe(PLAN_YOK);
  });

  it('gelir, ara toplam ("… toplamı"), genel toplam ("Toplam …") ve adet satırları harcama toplamına girmez: tutar üretilmez', () => {
    const satirlar = (basis: string) => [
      obs('2026-10', basis, '100.00', { label: 'Örnek gider' }),
      obs('2026-10', basis, '50000.00', { label: 'Maaş' }),
      obs('2026-10', basis, '50000.00', { label: 'Toplam gelir' }),
      obs('2026-10', basis, '3000.00', { label: 'Faturalar toplamı' }),
      obs('2026-10', basis, '3100.00', { label: 'Toplam ödemeler' }),
      obs('2026-10', basis, '3', { label: 'Doğalgaz · adet', value: { decimal: '3', currency: null } }),
    ];
    const [row] = monthRows([...satirlar('planned'), ...satirlar('recorded_aggregate')], ['2026-10'], TODAY);
    expect(monthPlannedText(row!)).toBe(TOTAL_UNAVAILABLE_TEXT);
    expect(monthRecordedText(row!)).toBe(TOTAL_UNAVAILABLE_TEXT);
    expect(row!.planCount).toBe(6);
    expect(row!.recordedCount).toBe(6);
    expect(JSON.stringify(row)).not.toMatch(/amount|₺/);
    const csv = monthCsv([row!]);
    expect(csv[0]).toEqual(['Ay', 'Planlanan', 'Gerçekleşen', 'Durum', 'Plan kaydı', 'Gerçekleşen kaydı']);
    expect(csv[1]).toEqual(['Ekim 2026', TOTAL_UNAVAILABLE_TEXT, TOTAL_UNAVAILABLE_TEXT, 'Kaynakta yazılı', '6', '6']);
  });

  it('silinmiş ve sınıflanmamış gözlemler hiçbir sayıya katılmaz', () => {
    const [row] = monthRows([
      obs('2026-10', 'planned', '10.00'), obs('2026-10', 'planned', '90.00', { deleted_at: '2026-10-20T00:00:00Z' }),
      obs('2026-10', 'unclassified', '500.00'),
    ], ['2026-10'], TODAY);
    expect(row!.planCount).toBe(1);
    expect(row!.recordedCount).toBe(0);
  });

  it('Gerçekleşen sekmesi planı aynalıyorsa satır işaretlenir (MIRRORS_PLAN_NOTE)', () => {
    const [row] = monthRows([obs('2026-10', 'planned', '8500'), obs('2026-10', 'recorded_aggregate', '8500.00')], ['2026-10'], TODAY);
    expect(row!.mirrors).toBe(true);
    expect(MIRRORS_PLAN_NOTE).toMatch(/ödeme kanıtı yok/);
  });
});

describe('raporlar/model › çok dönemli sayımlar', () => {
  const rows = [
    obs('2026-10', 'planned', '100.00'), obs('2026-11', 'planned', '200.00'), obs('2026-12', 'planned', '300.00'),
    obs('2026-10', 'recorded_aggregate', '10.00'), obs('2026-11', 'recorded_aggregate', '20.00'), obs('2026-12', 'recorded_aggregate', '30.00'),
  ];

  it('recordCounts plan ve gelecek olmayan Gerçekleşen kayıtlarını ayrı sayar', () => {
    expect(recordCounts(rows, TODAY)).toEqual({ plan: 3, recorded: 2 });
  });

  it('özet metinleri: plan kaydı varsa "Toplam kullanılamaz"; yalnız gelecek dönemse Gerçekleşen "Henüz yok"', () => {
    expect(summaryPlannedText(rows)).toBe(TOTAL_UNAVAILABLE_TEXT);
    expect(summaryPlannedText([])).toBe(PLAN_YOK);
    expect(summaryRecordedText(rows, ['2026-10', '2026-11', '2026-12'], TODAY)).toBe(TOTAL_UNAVAILABLE_TEXT);
    expect(summaryRecordedText(rows.filter((o) => o.period === '2026-12'), ['2026-12'], TODAY)).toBe('Henüz yok');
    expect(summaryRecordedText([obs('2026-10', 'planned', '1.00')], ['2026-10'], TODAY)).toBe('Henüz yok');
  });
});

describe('raporlar/model › ölçüler', () => {
  it('sayım ölçüsü plan ve gerçekleşen kaydını ayrı yazar; toplam ölçüsü sahiplik haritası olmadan tutar üretmez', () => {
    const cell = [obs('2026-10', 'planned', '10.00'), obs('2026-10', 'recorded_aggregate', '9.00')];
    expect(measureValue(MEASURES[0]!, cell, ['2026-10'], TODAY)).toMatchObject({ text: '1 plan · 1 gerçekleşen', amount: null });
    const sum = measureValue(MEASURES[1]!, cell, ['2026-10'], TODAY);
    expect(sum).toMatchObject({ text: TOTAL_UNAVAILABLE_TEXT, csv: TOTAL_UNAVAILABLE_TEXT, amount: null });
    expect(measureValue(MEASURES[0]!, [], ['2026-10'], TODAY).text).toBe('Kayıt yok');
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
