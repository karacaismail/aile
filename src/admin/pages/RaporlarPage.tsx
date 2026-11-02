import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { designTokens } from '../../design/tokens.ts';
import {
  createViewCatalog,
  readViewDefinitions,
  useCollection,
  useGeneration,
  useRows,
  type BudgetObservation,
  type GenerationState,
  type Issue,
  type Money as MoneyValue,
  type PivotMeasure,
} from '../data';
import { useDevice } from '../device';
import type { DataStatusProps, DataStatusState, PageHeaderSummary, RecordRow, ResponsiveColumn, Tone } from '../shell/contracts';
import { PageHeader } from '../shell/PageHeader';
import { Button, Chart, EmptyState, ErrorState, LoadingShell, Menu, Money, ResponsiveTable, Select, StatusText } from '../ui';
import { formatMoney } from '../ui/Money';
import './RaporlarPage.css';

// Raporlar sayfası. Tasarım: README.md "Sayfa iskeleti" + bundle.js Aile.Pages.Raporlar (masaüstünde solda rapor
// menüsü 240 px, dar ekranda "Rapor" seçimi; Dönem seçimi; başlıkta "Raporu dışa aktar"; plan acik-mavi / gerçek eylem
// çubukları ve yanında tablo; "Raporlarda görünüm modu yok: her rapor kendi biçimiyle gelir."). Sorgu çubuğu ve filtre
// paneli yok: her rapor kendi seçicilerini taşır.
// Veri: budget_observations (Plan / Gerçekleşen sayfalarının hücreleri; basis planned | recorded_aggregate; period
// YYYY-MM). Oda ya da kategori alanı bu koleksiyonda yok; satır boyutu kaynaktaki gider kalemidir (label). Para
// ondalık metin → kuruş tam sayısı olarak toplanır; para birimi başına ayrı; birden çok birim "Birden çok para birimi".
// Plan ve gerçek asla tek sayıda birleşmez: ayrı sütun, ayrı özet ölçüsü, ayrı pivot ölçüsü (views.pivotMeasures).
// forecast_* tahmindir, hiçbir rapora toplanmaz (not görünür). payments koleksiyonu nesilde yok: "Kaynakta ödeme
// kaydı yok". Dışa aktarma yalnız görünen satırlar, istemci tarafı Blob; Sheets'e yazma yok.

export interface ReportDef { key: ReportKey; label: string; exportable: boolean }
export type ReportKey = 'aylik' | 'kalem' | 'borc' | 'oda' | 'guven';
export const REPORTS: readonly ReportDef[] = [
  { key: 'aylik', label: 'Aylık plan ve gerçek', exportable: true },
  { key: 'kalem', label: 'Kaleme göre harcama', exportable: true },
  { key: 'borc', label: 'Borç ödeme planı', exportable: false },
  { key: 'oda', label: 'Oda bazında alımlar', exportable: true },
  { key: 'guven', label: 'Veri güveni özeti', exportable: true },
];

const PLANLANAN = 'Planlanan';
const GERCEKLESEN = 'Gerçekleşen';
const FIYAT_YOK = 'Fiyat yok';
const HENUZ_YOK = 'Henüz yok';
const BILINMIYOR = 'Bilinmiyor';
const KARISIK = 'Birden çok para birimi';
const TUM_DONEMLER = 'Tüm dönemler';
const ALL = 'all';
const FORECAST_NOTU = 'Tahminler (forecast) bu raporlara toplanmaz; yalnız bütçe gözlemleri sayılır.';
const GORUNUM_NOTU = 'Raporlarda görünüm modu yok: her rapor kendi biçimiyle gelir.';
const DISA_AKTAR = 'Raporu dışa aktar';
const OBS_KIND = 'budget_observation';

type ChartOption = ComponentProps<typeof Chart>['option'];
type CsvRows = readonly (readonly string[])[];

// --- Saf yardımcılar ---------------------------------------------------------------------------------
const AY_FORMAT = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
const PERIOD_RE = /^(\d{4})-(\d{2})$/;

/** "2026-11" → "Kasım 2026"; dönem biçimi tanınmıyorsa olduğu gibi döner. */
export function periodLabel(period: string): string {
  const match = PERIOD_RE.exec(period);
  if (!match) return period;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return period;
  const text = AY_FORMAT.format(new Date(Date.UTC(year, month - 1, 1, 12)));
  return text.charAt(0).toLocaleUpperCase('tr-TR') + text.slice(1);
}

/** Satırları ';' ile ayırır (tr-TR Excel), gerekirse tırnaklar, CRLF ve UTF-8 BOM ile başlar. */
export function toCsv(rows: CsvRows): string {
  const cell = (value: string) => (/[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return `﻿${rows.map((row) => row.map(cell).join(';')).join('\r\n')}`;
}

/** Dosya adı parçası: "Aylık plan ve gerçek" → "aylik-plan-ve-gercek". */
function slug(text: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', İ: 'i' };
  return text
    .replace(/[çğıöşüİ]/g, (ch) => map[ch] ?? ch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function todayStamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function downloadCsv(filename: string, rows: CsvRows): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// --- Para toplama (kuruş, para birimi başına) ---------------------------------------------------------
type Sum = Map<string, number>;
type MoneyCell = MoneyValue | 'mixed';

const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;
function toKurus(decimal: string | null | undefined): number | null {
  if (decimal == null || !DECIMAL.test(decimal.trim())) return null;
  return Math.round(Number(decimal) * 100);
}
function addMoney(sum: Sum, amount: string | null | undefined, currency: string | null | undefined): boolean {
  const kurus = toKurus(amount);
  if (kurus === null) return false;
  const code = (currency ?? 'TRY').trim().toUpperCase();
  sum.set(code, (sum.get(code) ?? 0) + kurus);
  return true;
}
function moneyOf(sum: Sum): MoneyCell {
  if (sum.size === 0) return null;
  if (sum.size > 1) return 'mixed';
  const [currency, kurus] = [...sum.entries()][0]!;
  return { amount: (kurus / 100).toFixed(2), currency };
}
function numberOf(sum: Sum): number | null {
  if (sum.size !== 1) return null;
  return [...sum.values()][0]! / 100;
}
function moneyText(cell: MoneyCell, missing: string): string {
  if (cell === 'mixed') return KARISIK;
  if (cell === null) return missing;
  return `${cell.amount} ${cell.currency}`;
}
function MoneyCellView({ cell, missing }: { cell: MoneyCell; missing: string }) {
  if (cell === 'mixed') return <span>{KARISIK}</span>;
  return <Money value={cell} label={missing} />;
}

interface PlanActual { plan: Sum; actual: Sum; planCount: number; actualCount: number }
const newPlanActual = (): PlanActual => ({ plan: new Map(), actual: new Map(), planCount: 0, actualCount: 0 });
function addObservation(acc: PlanActual, row: BudgetObservation): void {
  if (row.basis === 'planned') {
    acc.planCount += 1;
    addMoney(acc.plan, row.value.decimal, row.value.currency);
  } else if (row.basis === 'recorded_aggregate') {
    acc.actualCount += 1;
    addMoney(acc.actual, row.value.decimal, row.value.currency);
  }
  // 'unclassified' ve bilinmeyen basis: sahibi yok, hiçbir sayıya katılmaz (views.ts OWNED_SUMS).
}

/** Fark yalnız iki değer de tek ve aynı para birimindeyse; aksi hâlde eksik olanın adı. Renk tek işaret değil. */
function farkOf(acc: PlanActual): { label: string; tone: Tone } {
  const plan = moneyOf(acc.plan);
  const actual = moneyOf(acc.actual);
  if (plan === 'mixed' || actual === 'mixed') return { label: KARISIK, tone: 'notr' };
  if (plan === null) return { label: 'Plan yok', tone: 'notr' };
  if (actual === null) return { label: HENUZ_YOK, tone: 'notr' };
  if (plan.currency !== actual.currency) return { label: KARISIK, tone: 'notr' };
  const diff = [...acc.actual.values()][0]! - [...acc.plan.values()][0]!;
  if (diff === 0) return { label: 'Planda', tone: 'notr' };
  const text = formatMoney({ amount: (Math.abs(diff) / 100).toFixed(2), currency: plan.currency });
  return diff > 0 ? { label: `Plan üstü ${text}`, tone: 'hata' } : { label: `Plan altı ${text}`, tone: 'olumlu' };
}

const trCompare = new Intl.Collator('tr-TR').compare;

// --- Veri durumu ----------------------------------------------------------------------------------------
const STATUS_STATE: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };

// --- Sayfa ------------------------------------------------------------------------------------------------
export interface RaporlarPageProps { location?: string }

export function RaporlarPage({ location = '/raporlar' }: RaporlarPageProps) {
  const device = useDevice();
  const wide = device === 'desktop';
  const generation = useGeneration();
  const observations = useCollection('budget_observations');
  const [reportKey, setReportKey] = useState<ReportKey>('aylik');
  const report = REPORTS.find((item) => item.key === reportKey) ?? REPORTS[0]!;

  // Dönem: verideki yıllar + "Tüm dönemler"; varsayılan verideki son yıl. Seçim veriden sonra gelir (year undefined → son yıl).
  const rows = useMemo(() => observations.rows.filter((row) => !row.deleted_at), [observations.rows]);
  const years = useMemo(() => [...new Set(rows.map((row) => row.period.slice(0, 4)))].sort(), [rows]);
  const [year, setYear] = useState<string | undefined>(undefined);
  const activeYear = year ?? years[years.length - 1] ?? ALL;
  const periodOptions = useMemo(() => [{ value: ALL, label: TUM_DONEMLER }, ...years.map((value) => ({ value, label: value }))], [years]);
  const filtered = useMemo(() => (activeYear === ALL ? rows : rows.filter((row) => row.period.startsWith(activeYear))), [rows, activeYear]);
  const periodText = activeYear === ALL ? TUM_DONEMLER : activeYear;

  // Dışa aktarma: etkin rapor görünen satırlarını kaydeder; veri gelmeden düğme devre dışıdır (nedeni yanında yazar).
  const csvRef = useRef<CsvRows | null>(null);
  const [csvReady, setCsvReady] = useState(false);
  const registerCsv = useCallback((next: CsvRows | null) => {
    csvRef.current = next;
    setCsvReady(next !== null);
  }, []);
  useEffect(() => registerCsv(null), [reportKey, registerCsv]);
  const exportCsv = () => {
    if (!csvRef.current) return;
    downloadCsv(`aile-rapor-${slug(report.label)}-${todayStamp()}.csv`, csvRef.current);
  };

  const status: DataStatusProps = {
    state: STATUS_STATE[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: () => void generation.refresh(),
  };

  const generationFailed = generation.state === 'error' && generation.manifest === null;
  const generationPending = generation.state === 'idle' || generation.state === 'checking';
  const obsReady = !generationFailed && !generationPending && !observations.loading && observations.error === null && filtered.length > 0;

  // Özet: plan ve gerçek ayrı ölçü; üçüncü ölçü gözlem sayısı. Yalnız bütçe gözlemi raporlarında ve veri varken.
  const summary = useMemo<readonly PageHeaderSummary[] | undefined>(() => {
    if (!obsReady || (reportKey !== 'aylik' && reportKey !== 'kalem')) return undefined;
    const acc = newPlanActual();
    for (const row of filtered) addObservation(acc, row);
    return [
      { label: PLANLANAN, value: moneyText2(moneyOf(acc.plan), FIYAT_YOK), note: periodText },
      { label: GERCEKLESEN, value: moneyText2(moneyOf(acc.actual), HENUZ_YOK), note: periodText },
      { label: 'Gözlem', value: `${filtered.length} kayıt`, note: `${acc.planCount} plan · ${acc.actualCount} gerçekleşen` },
    ];
  }, [obsReady, reportKey, filtered, periodText]);

  const exportNoteId = 'aile-raporlar-disa-aktar-not';
  const primary = report.exportable ? (
    <>
      <Button variant="secondary" icon="download" onClick={exportCsv} disabled={!csvReady} aria-describedby={csvReady ? undefined : exportNoteId}>
        {DISA_AKTAR}
      </Button>
      {csvReady ? null : <span id={exportNoteId} className="aile-kucuk aile-ikincil">Rapor yüklenince dışa aktarılabilir</span>}
    </>
  ) : undefined;

  let body: ReactNode;
  if (generationFailed) {
    body = <ErrorState message={generation.message ?? undefined} onRetry={() => void generation.refresh()} />;
  } else if (generationPending) {
    body = <LoadingShell rows={6} narrow={device === 'phone'} />;
  } else {
    switch (report.key) {
      case 'aylik':
      case 'kalem': {
        if (observations.loading) body = <LoadingShell rows={6} narrow={device === 'phone'} />;
        else if (observations.error) body = <ErrorState message={observations.error} onRetry={() => void generation.refresh()} />;
        else if (rows.length === 0) body = <EmptyState title="Kaynakta bütçe gözlemi kaydı yok" message="Nesilde budget_observations koleksiyonu boş; Plan ve Gerçekleşen sayfalarından hücre okunmadı." />;
        else if (filtered.length === 0) body = <EmptyState filters={[periodText]} onClear={() => setYear(ALL)} />;
        else if (report.key === 'aylik') body = <AylikReport rows={filtered} periodText={periodText} onCsv={registerCsv} />;
        else body = <KalemReport rows={filtered} periodText={periodText} onCsv={registerCsv} />;
        break;
      }
      case 'borc':
        body = <EmptyState title="Kaynakta ödeme kaydı yok" message="Nesilde payments koleksiyonu yok; borç ödeme planı bu kaynaktan üretilemez. Ödemeler sayfası da aynı durumu söyler." />;
        break;
      case 'oda':
        body = <OdaReport onCsv={registerCsv} onRetry={() => void generation.refresh()} />;
        break;
      case 'guven':
        body = <GuvenReport onCsv={registerCsv} onRetry={() => void generation.refresh()} />;
        break;
    }
  }

  const selectors = (
    <div className="aile-raporlar__secim">
      {wide ? null : (
        <Select label="Rapor" value={report.key} onChange={(next) => setReportKey(next as ReportKey)} options={REPORTS.map((item) => ({ value: item.key, label: item.label }))} />
      )}
      {report.key === 'aylik' || report.key === 'kalem' ? (
        <Select label="Dönem" value={activeYear} onChange={setYear} options={periodOptions} disabled={years.length === 0} />
      ) : null}
      <p className="aile-raporlar__not aile-kucuk aile-ikincil">{GORUNUM_NOTU}</p>
    </div>
  );

  return (
    <>
      <PageHeader location={location} section="Rapor" title="Raporlar" purpose="Hazır raporları açın; her rakamın hangi kayıtlardan geldiğini görün." primary={primary} status={status} summary={summary} />
      <div className={`aile-raporlar${wide ? ' aile-raporlar--genis' : ''}`}>
        {wide ? (
          <nav aria-label="Raporlar" className="aile-raporlar__nav">
            <Menu items={REPORTS.map((item) => ({ key: item.key, label: item.label }))} selectedKey={report.key} onSelect={(key) => setReportKey(key as ReportKey)} />
          </nav>
        ) : null}
        <div className="aile-raporlar__govde">
          {selectors}
          {body}
        </div>
      </div>
    </>
  );
}

/** Özet değeri: ₺8.500,00 ya da eksik bilginin adı. */
function moneyText2(cell: MoneyCell, missing: string): string {
  if (cell === 'mixed') return KARISIK;
  return formatMoney(cell, missing);
}

// --- Rapor: Aylık plan ve gerçek -------------------------------------------------------------------
interface ObsReportProps { rows: readonly BudgetObservation[]; periodText: string; onCsv(rows: CsvRows | null): void }
interface AyRow { key: string; ay: string; acc: PlanActual }

function AylikReport({ rows, periodText, onCsv }: ObsReportProps) {
  const ayRows = useMemo<AyRow[]>(() => {
    const byPeriod = new Map<string, PlanActual>();
    for (const row of rows) {
      let acc = byPeriod.get(row.period);
      if (!acc) byPeriod.set(row.period, (acc = newPlanActual()));
      addObservation(acc, row);
    }
    return [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, acc]) => ({ key: period, ay: periodLabel(period), acc }));
  }, [rows]);

  useEffect(() => {
    onCsv([
      ['Ay', PLANLANAN, GERCEKLESEN, 'Fark', 'Plan kaydı', 'Gerçekleşen kaydı'],
      ...ayRows.map((row) => [row.ay, moneyText(moneyOf(row.acc.plan), FIYAT_YOK), moneyText(moneyOf(row.acc.actual), HENUZ_YOK), farkOf(row.acc).label, String(row.acc.planCount), String(row.acc.actualCount)]),
    ]);
  }, [ayRows, onCsv]);

  const columns: ResponsiveColumn<AyRow>[] = [
    { key: 'ay', title: 'Ay', minWidth: 144, m: 'title' },
    { key: 'plan', title: PLANLANAN, align: 'right', minWidth: 144, render: (row) => <MoneyCellView cell={moneyOf(row.acc.plan)} missing={FIYAT_YOK} /> },
    { key: 'gercek', title: GERCEKLESEN, align: 'right', minWidth: 144, m: 'lead', render: (row) => <MoneyCellView cell={moneyOf(row.acc.actual)} missing={HENUZ_YOK} /> },
    { key: 'fark', title: 'Fark', align: 'right', minWidth: 184, m: 'status', render: (row) => { const fark = farkOf(row.acc); return <StatusText label={fark.label} tone={fark.tone} className="aile-raporlar__fark" />; } },
    { key: 'kayit', title: 'Kayıt', minWidth: 184, m: 'meta', render: (row) => `${row.acc.planCount} plan · ${row.acc.actualCount} gerçekleşen` },
  ];

  const option: ChartOption = {
    xAxis: { type: 'category', data: ayRows.map((row) => row.ay) },
    yAxis: { type: 'value' },
    legend: { data: [PLANLANAN, GERCEKLESEN] },
    series: [
      { name: PLANLANAN, type: 'bar', color: designTokens.acikMavi, data: ayRows.map((row) => numberOf(row.acc.plan)) },
      { name: GERCEKLESEN, type: 'bar', color: designTokens.eylem, data: ayRows.map((row) => numberOf(row.acc.actual)) },
    ],
  };

  return (
    <section className="aile-raporlar__rapor" aria-labelledby="aile-rapor-aylik">
      <ReportHead id="aile-rapor-aylik" title="Aylık plan ve gerçek" meta={`${periodText} · ${ayRows.length} ay`} />
      <Chart
        option={option}
        ariaLabel="Aylara göre planlanan ve gerçekleşen gider; değerler aşağıdaki tabloda"
        description={<ResponsiveTable caption="Aylık plan ve gerçek" mobileCaption={`${ayRows.length} ay`} columns={columns} rows={ayRows} />}
      />
      <p className="aile-raporlar__not aile-kucuk aile-ikincil">{FORECAST_NOTU}</p>
    </section>
  );
}

// --- Rapor: Kaleme göre harcama (pivot kalem × dönem) -----------------------------------------------
interface KalemRow { key: string; kalem: string; cells: Map<string, PlanActual>; total: PlanActual; isTotal?: boolean }

function measureText(measure: PivotMeasure, acc: PlanActual | undefined): string {
  if (!acc) return 'Kayıt yok';
  if (measure.aggregate === 'count') return `${acc.planCount} plan · ${acc.actualCount} gerçekleşen`;
  return measure.basis === 'planned' ? moneyText(moneyOf(acc.plan), FIYAT_YOK) : moneyText(moneyOf(acc.actual), HENUZ_YOK);
}
function MeasureCell({ measure, acc }: { measure: PivotMeasure; acc: PlanActual | undefined }) {
  if (!acc) return <span className="aile-ikincil">Kayıt yok</span>;
  if (measure.aggregate === 'count') return <>{`${acc.planCount} plan · ${acc.actualCount} gerçekleşen`}</>;
  return measure.basis === 'planned'
    ? <MoneyCellView cell={moneyOf(acc.plan)} missing={FIYAT_YOK} />
    : <MoneyCellView cell={moneyOf(acc.actual)} missing={HENUZ_YOK} />;
}

function KalemReport({ rows, periodText, onCsv }: ObsReportProps) {
  const definitions = useCollection('view_definitions');
  const catalog = useMemo(() => {
    const records = definitions.rows.filter((row) => !row.deleted_at);
    return createViewCatalog(readViewDefinitions({ schemaVersion: 1, collection: 'view_definitions', records }));
  }, [definitions.rows]);
  const measures = useMemo(() => catalog.pivotMeasures(OBS_KIND), [catalog]);
  const [measureId, setMeasureId] = useState<string | undefined>(undefined);
  const measure = measures.find((item) => item.id === measureId) ?? measures.find((item) => item.id === 'sum_planned') ?? measures[0];

  const periods = useMemo(() => [...new Set(rows.map((row) => row.period))].sort(), [rows]);
  const kalemRows = useMemo<KalemRow[]>(() => {
    const byKalem = new Map<string, KalemRow>();
    const total: KalemRow = { key: '__toplam', kalem: 'Genel toplam', cells: new Map(), total: newPlanActual(), isTotal: true };
    for (const row of rows) {
      const kalem = row.label?.trim() || BILINMIYOR;
      let item = byKalem.get(kalem);
      if (!item) byKalem.set(kalem, (item = { key: kalem, kalem, cells: new Map(), total: newPlanActual() }));
      for (const target of [item, total]) {
        let cell = target.cells.get(row.period);
        if (!cell) target.cells.set(row.period, (cell = newPlanActual()));
        addObservation(cell, row);
        addObservation(target.total, row);
      }
    }
    return [...[...byKalem.values()].sort((a, b) => trCompare(a.kalem, b.kalem)), total];
  }, [rows]);

  useEffect(() => {
    if (!measure) { onCsv(null); return; }
    onCsv([
      ['Kalem', ...periods.map(periodLabel), 'Toplam'],
      ...kalemRows.map((row) => [row.kalem, ...periods.map((period) => measureText(measure, row.cells.get(period))), measureText(measure, row.total)]),
    ]);
  }, [kalemRows, periods, measure, onCsv]);

  if (definitions.loading) return <LoadingShell rows={6} />;
  if (!measure) {
    const reason = catalog.unsupportedReason(OBS_KIND, 'pivot') ?? 'Pivot kullanılamaz: bütçe gözlemlerinin sahipliği belirlenmiş toplanabilir ölçüsü yok.';
    return (
      <section className="aile-raporlar__rapor" aria-labelledby="aile-rapor-kalem">
        <ReportHead id="aile-rapor-kalem" title="Kaleme göre harcama" meta={periodText} />
        <p className="aile-raporlar__not">{reason}</p>
        {definitions.error ? <p className="aile-raporlar__not">{definitions.error}</p> : null}
      </section>
    );
  }

  const columns: ResponsiveColumn<KalemRow>[] = [
    { key: 'kalem', title: 'Kalem', minWidth: 200, m: 'title' },
    ...periods.map((period): ResponsiveColumn<KalemRow> => ({
      key: period, title: periodLabel(period), align: 'right', minWidth: 144, m: 'body',
      render: (row) => <MeasureCell measure={measure} acc={row.cells.get(period)} />,
    })),
    { key: 'toplam', title: 'Toplam', align: 'right', minWidth: 160, m: 'lead', render: (row) => <MeasureCell measure={measure} acc={row.total} /> },
  ];

  const kalemler = kalemRows.filter((row) => !row.isTotal);
  const series: NonNullable<ChartOption['series']> = measure.aggregate === 'count'
    ? [
        { name: 'Plan kaydı', type: 'bar', color: designTokens.acikMavi, data: kalemler.map((row) => row.total.planCount) },
        { name: 'Gerçekleşen kaydı', type: 'bar', color: designTokens.eylem, data: kalemler.map((row) => row.total.actualCount) },
      ]
    : [{
        name: measure.label, type: 'bar',
        color: measure.basis === 'planned' ? designTokens.acikMavi : designTokens.eylem,
        data: kalemler.map((row) => numberOf(measure.basis === 'planned' ? row.total.plan : row.total.actual)),
      }];
  const option: ChartOption = { xAxis: { type: 'category', data: kalemler.map((row) => row.kalem) }, yAxis: { type: 'value' }, legend: {}, series };

  return (
    <section className="aile-raporlar__rapor" aria-labelledby="aile-rapor-kalem">
      <ReportHead id="aile-rapor-kalem" title="Kaleme göre harcama" meta={`${periodText} · ${kalemler.length} kalem · ${periods.length} ay`} />
      <div className="aile-raporlar__secim">
        <Select label="Ölçü" value={measure.id} onChange={setMeasureId} options={measures.map((item) => ({ value: item.id, label: item.label }))} help="Plan ve gerçekleşen ayrı ölçüdür; tek sayıda birleşmez." />
      </div>
      <Chart
        option={option}
        ariaLabel={`Kaleme göre ${measure.label.toLocaleLowerCase('tr-TR')}; değerler aşağıdaki tabloda`}
        description={<ResponsiveTable caption="Kaleme göre harcama" mobileCaption={`${kalemler.length} kalem`} columns={columns} rows={kalemRows} />}
      />
      <p className="aile-raporlar__not aile-kucuk aile-ikincil">Satır boyutu kaynaktaki gider kalemidir; bütçe gözlemlerinde oda bilgisi yok. {FORECAST_NOTU}</p>
    </section>
  );
}

// --- Rapor: Oda bazında alımlar ----------------------------------------------------------------------
interface RoomRow { key: string; oda: string; plan: Sum; actual: Sum; count: number }
interface SubReportProps { onCsv(rows: CsvRows | null): void; onRetry(): void }

function OdaReport({ onCsv, onRetry }: SubReportProps) {
  const device = useDevice();
  const needs = useCollection('purchase_needs');
  const rows: RecordRow[] = useRows('purchase_need');
  const roomRows = useMemo<RoomRow[]>(() => {
    const byRoom = new Map<string, RoomRow>();
    for (const row of rows) {
      const oda = row.room?.trim() || BILINMIYOR;
      let item = byRoom.get(oda);
      if (!item) byRoom.set(oda, (item = { key: oda, oda, plan: new Map(), actual: new Map(), count: 0 }));
      item.count += 1;
      if (row.planned) addMoney(item.plan, row.planned.amount, row.planned.currency);
      if (row.actual) addMoney(item.actual, row.actual.amount, row.actual.currency);
    }
    return [...byRoom.values()].sort((a, b) => (a.oda === BILINMIYOR ? 1 : b.oda === BILINMIYOR ? -1 : trCompare(a.oda, b.oda)));
  }, [rows]);

  useEffect(() => {
    if (needs.loading || needs.error) { onCsv(null); return; }
    onCsv([['Oda', PLANLANAN, GERCEKLESEN, 'Alım'], ...roomRows.map((row) => [row.oda, moneyText(moneyOf(row.plan), FIYAT_YOK), moneyText(moneyOf(row.actual), HENUZ_YOK), String(row.count)])]);
  }, [roomRows, needs.loading, needs.error, onCsv]);

  if (needs.loading) return <LoadingShell rows={6} narrow={device === 'phone'} />;
  if (needs.error) return <ErrorState message={needs.error} onRetry={onRetry} />;
  if (roomRows.length === 0) return <EmptyState title="Kaynakta alım kaydı yok" message="Nesilde purchase_needs koleksiyonu boş." />;

  const columns: ResponsiveColumn<RoomRow>[] = [
    { key: 'oda', title: 'Oda', minWidth: 176, m: 'title' },
    { key: 'plan', title: PLANLANAN, align: 'right', minWidth: 144, render: (row) => <MoneyCellView cell={moneyOf(row.plan)} missing={FIYAT_YOK} /> },
    { key: 'gercek', title: GERCEKLESEN, align: 'right', minWidth: 144, m: 'lead', render: (row) => <MoneyCellView cell={moneyOf(row.actual)} missing={HENUZ_YOK} /> },
    { key: 'alim', title: 'Alım', align: 'right', minWidth: 112, m: 'meta', render: (row) => `${row.count} alım` },
  ];
  const option: ChartOption = {
    xAxis: { type: 'category', data: roomRows.map((row) => row.oda) },
    yAxis: { type: 'value' },
    legend: { data: [PLANLANAN, GERCEKLESEN] },
    series: [
      { name: PLANLANAN, type: 'bar', color: designTokens.acikMavi, data: roomRows.map((row) => numberOf(row.plan)) },
      { name: GERCEKLESEN, type: 'bar', color: designTokens.eylem, data: roomRows.map((row) => numberOf(row.actual)) },
    ],
  };

  return (
    <section className="aile-raporlar__rapor" aria-labelledby="aile-rapor-oda">
      <ReportHead id="aile-rapor-oda" title="Oda bazında alımlar" meta={`${roomRows.length} oda · ${rows.length} alım`} />
      <Chart
        option={option}
        ariaLabel="Odalara göre planlanan ve gerçekleşen alım tutarı; değerler aşağıdaki tabloda"
        description={<ResponsiveTable caption="Oda bazında alımlar" mobileCaption={`${roomRows.length} oda`} columns={columns} rows={roomRows} />}
      />
      <p className="aile-raporlar__not aile-kucuk aile-ikincil">Yalnız alım (purchase_need) kayıtları; odası olmayan alımlar "Bilinmiyor" satırındadır.</p>
    </section>
  );
}

// --- Rapor: Veri güveni özeti ---------------------------------------------------------------------------
interface IssueRow { key: string; kod: string; onem: string; count: number }
const SEVERITY_LABEL: Record<string, string> = { review: 'İnceleme' };

function GuvenReport({ onCsv, onRetry }: SubReportProps) {
  const device = useDevice();
  const issues = useCollection('issues');
  const issueRows = useMemo<IssueRow[]>(() => {
    const byKey = new Map<string, IssueRow>();
    for (const issue of issues.rows as readonly Issue[]) {
      if (issue.deleted_at) continue;
      const kod = issue.code || BILINMIYOR;
      const onem = SEVERITY_LABEL[issue.severity] ?? issue.severity ?? BILINMIYOR;
      const key = `${kod}|${onem}`;
      let item = byKey.get(key);
      if (!item) byKey.set(key, (item = { key, kod, onem, count: 0 }));
      item.count += 1;
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count || trCompare(a.kod, b.kod));
  }, [issues.rows]);

  useEffect(() => {
    if (issues.loading || issues.error) { onCsv(null); return; }
    onCsv([['Kod', 'Önem', 'Kayıt'], ...issueRows.map((row) => [row.kod, row.onem, String(row.count)])]);
  }, [issueRows, issues.loading, issues.error, onCsv]);

  if (issues.loading) return <LoadingShell rows={4} narrow={device === 'phone'} />;
  if (issues.error) return <ErrorState message={issues.error} onRetry={onRetry} />;
  if (issueRows.length === 0) return <EmptyState title="Kaynakta sorun kaydı yok" message="Nesilde issues koleksiyonu boş; inceleme bekleyen kayıt yok." />;

  const columns: ResponsiveColumn<IssueRow>[] = [
    { key: 'kod', title: 'Kod', minWidth: 224, m: 'title' },
    { key: 'onem', title: 'Önem', minWidth: 128, m: 'status' },
    { key: 'kayit', title: 'Kayıt', align: 'right', minWidth: 112, m: 'lead', render: (row) => `${row.count} kayıt` },
  ];
  const total = issueRows.reduce((sum, row) => sum + row.count, 0);

  return (
    <section className="aile-raporlar__rapor" aria-labelledby="aile-rapor-guven">
      <ReportHead id="aile-rapor-guven" title="Veri güveni özeti" meta={`${total} sorun kaydı · ${issueRows.length} kod`} />
      <ResponsiveTable caption="Veri güveni özeti" mobileCaption={`${issueRows.length} kod`} columns={columns} rows={issueRows} mobileMode="list" />
      <p className="aile-raporlar__not aile-kucuk aile-ikincil">Kaynak: nesildeki issues koleksiyonu (normalize sırasında işaretlenen inceleme kayıtları).</p>
    </section>
  );
}

// --- Ortak başlık -------------------------------------------------------------------------------------
function ReportHead({ id, title, meta }: { id: string; title: string; meta: string }) {
  return (
    <div className="aile-raporlar__baslik">
      <h2 id={id}>{title}</h2>
      <span className="aile-kucuk aile-ikincil">{meta}</span>
    </div>
  );
}
