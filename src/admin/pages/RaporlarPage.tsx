import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { lazyWide, useProfile } from '../adaptive';
import {
  MIRRORS_PLAN_NOTE,
  createViewCatalog,
  currentPeriod,
  readViewDefinitions,
  useCollection,
  useGeneration,
  useQuery,
  type BudgetObservation,
  type GenerationState,
  type Issue,
  type PivotMeasure,
  type QueryAst,
  type ViewDefinition,
} from '../data';
import type { DataStatusProps, DataStatusState, PageHeaderSummary, ResponsiveColumn, Tone } from '../shell/contracts';
import { PageHeader } from '../shell/PageHeader';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { LoadingShell } from '../ui/LoadingShell';
import { Money } from '../ui/Money';
import { ResponsiveTable } from '../ui/ResponsiveTable';
import { Select } from '../ui/Select';
import { StatusText } from '../ui/StatusText';
import {
  KAYIT_YOK,
  TUM,
  chartAmount,
  choiceLabel,
  dayStamp,
  defaultPeriodChoice,
  issueRows,
  kalemRows,
  measureValue,
  monthCsv,
  monthRows,
  ownedMeasures,
  periodLabel,
  periodOptions,
  periodsFor,
  plannedDisplay,
  plannedOver,
  rangeText,
  recordCounts,
  recordedDisplay,
  recordedOver,
  recordedText,
  plannedText,
  roomRows,
  slug,
  toCsv,
  type CsvRows,
  type IssueRow,
  type KalemRow,
  type MonthRow,
  type OwnedMeasures,
  type RoomRow,
  type TotalDisplay,
} from './raporlar/model';
import './RaporlarPage.css';

// Raporlar sayfası. Tasarım: SayfaRaporlarDar (telefon, önce) ve SayfaRaporlar (geniş) + bundle.js Aile.Pages.Raporlar:
// başlıkta "Raporu dışa aktar"; "Rapor" ve "Dönem" seçimi (telefonda alttan açılan sayfa); masaüstünde solda 240 px rapor
// menüsü; plan acik-mavi / gerçek eylem çubukları ve altında tablo; "Raporlarda görünüm modu yok".
// Uyarlamalı teslim: telefon temel deneyimi bu dosyadır (yerel HTML + ui bileşenleri, tablo akordeona iner, grafiğin
// karşılığı tablodur). Geniş-özel yetenekler — ECharts grafiği (tablet + masaüstü) ve rapor menüsü (masaüstü) —
// raporlar/*.wide.tsx içindedir ve yalnız lazyWide ile, geniş profilde gelir; telefon onları ve echarts'ı indirmez.
// Veri anlamı (W0 actuals): Gerçekleşen içinde bulunulan aydan sonra "Henüz yok"; oran/"harcandı" yalnız spendLabel;
// toplamlar katalogdaki sahipliği belirlenmiş ölçülerle (pivotMeasures) ve kesin ondalıkla; plan ve gerçek tek sayıda
// birleşmez (fark/oran üretilmez). forecast_* toplanmaz. payments nesilde yok. Alımların toplanabilir ölçüsü yok: oda
// raporu yalnız sayar. Dışa aktarma görünen satırlar, istemci tarafı CSV; Sheets'e yazma yok.

const RaporGrafikWide = lazyWide('raporlar-grafik', () => import('./raporlar/RaporGrafik.wide'));
const RaporMenuWide = lazyWide('raporlar-menu', () => import('./raporlar/RaporMenu.wide'));

export { periodLabel, toCsv };

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
const FORECAST_NOTU = 'Tahminler (forecast) bu raporlara toplanmaz; yalnız bütçe gözlemleri sayılır.';
const GORUNUM_NOTU = 'Raporlarda görünüm modu yok: her rapor kendi biçimiyle gelir.';
const GRAFIK_NOTU = 'Planlanan ve Gerçekleşen ayrı serilerdir; eksik değer çizilmez. Değerler aşağıdaki tabloda.';
const ODA_NOTU = 'Tutar toplanmaz: alımların sahipliği belirlenmiş toplanabilir ölçüsü yok; kayıtlar yalnız sayılır. Odası olmayan alımlar "Bilinmiyor" satırındadır.';
const DISA_AKTAR = 'Raporu dışa aktar';
const OBS_KIND = 'budget_observation';
const SAHIPSIZ = 'bütçe gözlemlerinin sahipliği belirlenmiş toplanabilir ölçüsü yok.';
/** İndirme başlamadan blob bağlantısı geri alınmaz (WebKit iptal eder). */
export const REVOKE_DELAY_MS = 1000;

const STATUS_STATE: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };
const SPEND_TONE: Record<MonthRow['spend']['kind'], Tone> = { not_yet: 'notr', in_source: 'bilgi', spent: 'notr' };
const systemNow = () => new Date();

function downloadCsv(filename: string, rows: CsvRows): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** "Pivot kullanılamaz: X" → "Toplam kullanılamaz: X" (aylık rapor ve özet için aynı gerekçe). */
const totalReason = (reason: string | null) => `Toplam kullanılamaz: ${reason ? reason.replace(/^[^:]+:\s*/, '') : SAHIPSIZ}`;

// --- Sayfa ------------------------------------------------------------------------------------------------
export interface RaporlarPageProps {
  location?: string;
  /** İçinde bulunulan dönem (İstanbul) ve dosya adı için saat; test enjeksiyonu. */
  now?: () => Date;
}

interface Snapshot<R> { rows: readonly R[]; loading: boolean; error: string | null }
interface BudgetData { observations: Snapshot<BudgetObservation>; definitions: Snapshot<ViewDefinition> }
const NOT_READ: BudgetData = {
  observations: { rows: [], loading: true, error: null },
  definitions: { rows: [], loading: true, error: null },
};

/**
 * Bütçe koleksiyonlarını yalnız nesil (manifest) okunduktan sonra ister ve sayfaya bildirir; kendisi bir şey çizmez.
 * Manifest okunamazken istenen koleksiyonun hatası yükleyicide kalır ve "Yeniden dene" kaynak düzelince bile raporu
 * getirmezdi. Sayfa başlığı, seçimler ve gövde sayfada kalır: nesil gelince yeniden kurulmaz (odak kaybolmaz).
 */
function BudgetCollections({ onRead }: { onRead(data: BudgetData): void }) {
  const observations = useCollection('budget_observations');
  const definitions = useCollection('view_definitions');
  useEffect(() => onRead({ observations, definitions }), [observations, definitions, onRead]);
  return null;
}

export function RaporlarPage({ location = '/raporlar', now = systemNow }: RaporlarPageProps) {
  const profile = useProfile();
  const desktop = profile === 'desktop';
  const phone = profile === 'phone';
  const generation = useGeneration();
  // Son iyi nesil varken (taze, eski ya da yenileniyor) içerik ekranda kalır; yenileme iskelete döndürmez.
  const hasGeneration = generation.manifest !== null;
  const [budget, setBudget] = useState<BudgetData>(NOT_READ);
  const { observations, definitions } = hasGeneration ? budget : NOT_READ;
  const [reportKey, setReportKey] = useState<ReportKey>('aylik');
  const report = REPORTS.find((item) => item.key === reportKey) ?? REPORTS[0]!;

  const today = now();
  const current = currentPeriod(today);

  // Dönem: Son 6 ay · Son 12 ay · verideki yıllar · Tüm dönemler; varsayılan son 6 ay (veri varsa).
  const rows = useMemo(() => observations.rows.filter((row) => !row.deleted_at), [observations.rows]);
  const dataPeriods = useMemo(() => [...new Set(rows.map((row) => row.period))], [rows]);
  const [choice, setChoice] = useState<string | undefined>(undefined);
  const activeChoice = choice ?? defaultPeriodChoice(dataPeriods, current);
  const periods = useMemo(() => periodsFor(activeChoice, dataPeriods, current), [activeChoice, dataPeriods, current]);
  const options = useMemo(() => periodOptions(dataPeriods), [dataPeriods]);
  const selected = useMemo(() => {
    const set = new Set(periods);
    return rows.filter((row) => set.has(row.period));
  }, [rows, periods]);

  // Sahiplik: yalnız katalogdaki toplanabilir ölçüler (views.pivotMeasures); plan ve gerçek ayrı ölçüdür.
  const catalog = useMemo(
    () => createViewCatalog(readViewDefinitions({ schemaVersion: 1, collection: 'view_definitions', records: definitions.rows.filter((row) => !row.deleted_at) })),
    [definitions.rows],
  );
  const measures = useMemo(() => catalog.pivotMeasures(OBS_KIND), [catalog]);
  const owned = useMemo(() => ownedMeasures(measures), [measures]);
  const pivotReason = catalog.unsupportedReason(OBS_KIND, 'pivot');

  // Dışa aktarma: etkin rapor görünen satırlarını kaydeder ve kaldırılınca (ya da satırları değişince) kaydı siler;
  // veri gelmeden düğme devre dışıdır (nedeni yanında yazar). React önce eski etkilerin temizliğini, sonra yenileri
  // çalıştırır: rapor değişiminde eski kayıt silinir, yeni rapor kendi satırlarını kaydeder.
  const csvRef = useRef<CsvRows | null>(null);
  const [csvReady, setCsvReady] = useState(false);
  const registerCsv = useCallback((next: CsvRows | null) => {
    csvRef.current = next;
    setCsvReady(next !== null);
  }, []);
  const exportCsv = () => {
    if (!csvRef.current) return;
    downloadCsv(`aile-rapor-${slug(report.label)}-${dayStamp(now())}.csv`, csvRef.current);
  };

  const retry = () => void generation.refresh();
  const status: DataStatusProps = {
    state: STATUS_STATE[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: retry,
  };

  // Nesil yokken: hata (stale da son iyi nesil olmadan gösterecek veri bırakmaz) ya da ilk okuma sürüyor.
  const generationFailed = !hasGeneration && (generation.state === 'error' || generation.state === 'stale');
  const budgetReport = report.key === 'aylik' || report.key === 'kalem';
  const budgetLoading = observations.loading || definitions.loading;
  const obsReady = !budgetLoading && observations.error === null && selected.length > 0;

  // Özet: plan ve gerçek ayrı ölçü (yalnız sahipliği belirlenmişse); üçüncü girdi kayıt sayıları, yine ayrı ayrı.
  const summary = useMemo<readonly PageHeaderSummary[] | undefined>(() => {
    if (!obsReady || !budgetReport) return undefined;
    const note = choiceLabel(activeChoice);
    const items: PageHeaderSummary[] = [];
    if (owned.planned) items.push({ label: PLANLANAN, value: plannedText(plannedOver(selected, periods)), note });
    if (owned.recorded) items.push({ label: GERCEKLESEN, value: recordedText(recordedOver(selected, periods, today)), note });
    const { plan, recorded } = recordCounts(selected, today);
    items.push({ label: 'Kayıt', value: `${plan} plan · ${recorded} gerçekleşen`, note });
    return items;
    // today yalnız içinde bulunulan dönem (current) üzerinden etkiler; her render'da yeni Date bağımlılık sayılmaz.
  }, [obsReady, budgetReport, activeChoice, owned, selected, periods, current]);

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
    body = <ErrorState message={generation.message ?? undefined} onRetry={retry} />;
  } else if (!hasGeneration) {
    body = <LoadingShell rows={6} narrow={phone} />;
  } else if (budgetReport) {
    if (budgetLoading) body = <LoadingShell rows={6} narrow={phone} />;
    else if (observations.error) body = <ErrorState message={observations.error} onRetry={retry} />;
    else if (rows.length === 0) body = <EmptyState title="Kaynakta bütçe gözlemi kaydı yok" message="Nesilde budget_observations koleksiyonu boş; Plan ve Gerçekleşen sayfalarından hücre okunmadı." />;
    else if (periods.length === 0) body = <EmptyState filters={[choiceLabel(activeChoice)]} onClear={() => setChoice(TUM)} />;
    else if (report.key === 'aylik') {
      body = <AylikReport rows={selected} periods={periods} today={today} current={current} owned={owned} reason={owned.planned && owned.recorded ? null : totalReason(pivotReason)} definitionsError={definitions.error} onCsv={registerCsv} />;
    } else {
      body = <KalemReport rows={selected} periods={periods} today={today} current={current} measures={measures} reason={pivotReason} definitionsError={definitions.error} onCsv={registerCsv} />;
    }
  } else if (report.key === 'borc') {
    body = <EmptyState title="Kaynakta ödeme kaydı yok" message="Nesilde payments koleksiyonu yok; borç ödeme planı bu kaynaktan üretilemez. Ödemeler sayfası da aynı durumu söyler." />;
  } else if (report.key === 'oda') {
    body = <OdaReport phone={phone} onCsv={registerCsv} onRetry={retry} />;
  } else {
    body = <GuvenReport phone={phone} onCsv={registerCsv} onRetry={retry} />;
  }

  const raporSelect = (
    <Select label="Rapor" value={report.key} onChange={(next) => setReportKey(next as ReportKey)} options={REPORTS.map((item) => ({ value: item.key, label: item.label }))} />
  );

  return (
    <>
      {hasGeneration ? <BudgetCollections onRead={setBudget} /> : null}
      <PageHeader location={location} section="Rapor" title="Raporlar" purpose="Hazır raporları açın; her rakamın hangi kayıtlardan geldiğini görün." primary={primary} status={status} summary={summary} />
      <div className="aile-raporlar" data-nav={desktop ? 'menu' : 'secim'}>
        {desktop ? (
          <nav aria-label="Raporlar" className="aile-raporlar__nav">
            <RaporMenuWide items={REPORTS.map((item) => ({ key: item.key, label: item.label }))} selectedKey={report.key} onSelect={(key) => setReportKey(key as ReportKey)} wideFallback={raporSelect} />
          </nav>
        ) : null}
        <div className="aile-raporlar__govde">
          <div className="aile-raporlar__secim">
            {desktop ? null : raporSelect}
            {budgetReport ? <Select label="Dönem" value={activeChoice} onChange={setChoice} options={options} disabled={dataPeriods.length === 0} /> : null}
          </div>
          <p className="aile-raporlar__not aile-kucuk aile-ikincil">{GORUNUM_NOTU}</p>
          {body}
        </div>
      </div>
    </>
  );
}

// --- Ortak parçalar ------------------------------------------------------------------------------------
function ReportHead({ id, title, meta }: { id: string; title: string; meta: string }) {
  return (
    <div className="aile-raporlar__baslik">
      <h2 id={id}>{title}</h2>
      {meta ? <span className="aile-kucuk aile-ikincil">{meta}</span> : null}
    </div>
  );
}

/** Tutar ya da eksik bilginin adı (Money); kısmen okunamayan değer ayrıca yazılır. */
function Total({ value }: { value: TotalDisplay }) {
  return (
    <>
      <Money value={value.money} label={value.missing} />
      {value.note ? <span className="aile-raporlar__eksik aile-kucuk aile-ikincil">{value.note}</span> : null}
    </>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="aile-raporlar__not aile-kucuk aile-ikincil">{children}</p>;
}

// --- Rapor: Aylık plan ve gerçek -------------------------------------------------------------------
interface BudgetReportProps {
  rows: readonly BudgetObservation[];
  periods: readonly string[];
  today: Date;
  current: string;
  definitionsError: string | null;
  onCsv(rows: CsvRows | null): void;
}

function kayitText(row: MonthRow): string {
  const base = row.future ? `${row.planCount} plan kaydı` : `${row.planCount} plan · ${row.recordedCount} gerçekleşen`;
  return row.current ? `${base} · sürüyor` : base;
}

function AylikReport({ rows, periods, today, current, owned, reason, definitionsError, onCsv }: BudgetReportProps & { owned: OwnedMeasures; reason: string | null }) {
  // today yalnız içinde bulunulan dönem (current) üzerinden etkiler.
  const months = useMemo(() => monthRows(rows, periods, today), [rows, periods, current]);
  const mirrored = months.some((row) => row.mirrors);

  useEffect(() => {
    onCsv(monthCsv(months, owned));
    return () => onCsv(null);
  }, [months, owned, onCsv]);

  // Asgari genişlikler içerik türüne göre (ay adı, ₺1.168.800,00, "Kaynakta yazılı", sözcük arasında saran kayıt metni);
  // toplamı tablet içerik genişliğine sığar: tablet tabloyu görür, telefon akordeonu.
  const columns: ResponsiveColumn<MonthRow>[] = [{ key: 'ay', title: 'Ay', minWidth: 128, m: 'title', render: (row) => row.label }];
  if (owned.planned) columns.push({ key: 'plan', title: PLANLANAN, align: 'right', minWidth: 144, render: (row) => <Total value={plannedDisplay(row.planned)} /> });
  if (owned.recorded) {
    columns.push(
      { key: 'gercek', title: GERCEKLESEN, align: 'right', minWidth: 144, m: 'lead', render: (row) => <Total value={recordedDisplay(row.recorded)} /> },
      { key: 'durum', title: 'Durum', minWidth: 136, m: 'status', render: (row) => <StatusText label={row.spend.text} tone={SPEND_TONE[row.spend.kind]} /> },
    );
  }
  columns.push({ key: 'kayit', title: 'Kayıt', minWidth: 168, m: 'meta', render: kayitText });
  if (mirrored) columns.push({ key: 'not', title: 'Not', minWidth: 240, render: (row) => (row.mirrors ? MIRRORS_PLAN_NOTE : '') });

  const series = [
    ...(owned.planned ? [{ name: PLANLANAN, tone: 'plan' as const, values: months.map((row) => chartAmount(row.planned)) }] : []),
    ...(owned.recorded ? [{ name: GERCEKLESEN, tone: 'gercek' as const, values: months.map((row) => chartAmount(row.recorded)) }] : []),
  ];

  return (
    <section className="aile-raporlar__rapor" aria-labelledby="aile-rapor-aylik">
      <ReportHead id="aile-rapor-aylik" title="Aylık plan ve gerçek" meta={rangeText(periods, current)} />
      {reason ? <Note>{reason}</Note> : null}
      {definitionsError ? <Note>{definitionsError}</Note> : null}
      {series.length > 0 ? (
        <RaporGrafikWide
          wideFallback={null}
          categories={months.map((row) => row.label)}
          series={series}
          ariaLabel="Aylara göre planlanan ve gerçekleşen gider; değerler aşağıdaki tabloda"
          description={GRAFIK_NOTU}
        />
      ) : null}
      {/* Dönem değişince sonuç yenidir: akordeon yeniden kurulur, yeni sonucun ilk satırı açık gelir. */}
      <ResponsiveTable key={periods.join('|')} caption="Aylık plan ve gerçek" mobileCaption={`${months.length} ay`} columns={columns} rows={months} />
      {mirrored ? <Note>{MIRRORS_PLAN_NOTE}</Note> : null}
      <Note>{FORECAST_NOTU}</Note>
    </section>
  );
}

// --- Rapor: Kaleme göre harcama (pivot kalem × dönem) -----------------------------------------------
function KalemReport({ rows, periods, today, current, measures, reason, definitionsError, onCsv }: BudgetReportProps & { measures: readonly PivotMeasure[]; reason: string | null }) {
  const [measureId, setMeasureId] = useState<string | undefined>(undefined);
  const measure = measures.find((item) => item.id === measureId) ?? measures.find((item) => item.id === 'sum_planned') ?? measures[0];
  const kalemler = useMemo(() => kalemRows(rows, periods), [rows, periods]);

  const cell = useCallback(
    (row: KalemRow, period: string | null) => (measure ? measureValue(measure, period ? row.cells.get(period) : row.all, period ? [period] : periods, today) : null),
    // today yalnız içinde bulunulan dönem (current) üzerinden etkiler.
    [measure, periods, current],
  );

  useEffect(() => {
    if (!measure) return undefined;
    onCsv([
      ['Kalem', ...periods.map(periodLabel), 'Toplam'],
      ...kalemler.map((row) => [row.label, ...periods.map((period) => cell(row, period)!.csv), cell(row, null)!.csv]),
    ]);
    return () => onCsv(null);
  }, [kalemler, periods, measure, cell, onCsv]);

  if (!measure) {
    return (
      <section className="aile-raporlar__rapor" aria-labelledby="aile-rapor-kalem">
        <ReportHead id="aile-rapor-kalem" title="Kaleme göre harcama" meta={rangeText(periods, current)} />
        <p className="aile-raporlar__not">{reason ?? `Pivot kullanılamaz: ${SAHIPSIZ}`}</p>
        {definitionsError ? <p className="aile-raporlar__not">{definitionsError}</p> : null}
      </section>
    );
  }

  const render = (period: string | null) => (row: KalemRow) => {
    const value = cell(row, period)!;
    return value.display ? <Total value={value.display} /> : <span className={value.text === KAYIT_YOK ? 'aile-ikincil' : undefined}>{value.text}</span>;
  };
  const columns: ResponsiveColumn<KalemRow>[] = [
    { key: 'kalem', title: 'Kalem', minWidth: 200, m: 'title', render: (row) => row.label },
    ...periods.map((period): ResponsiveColumn<KalemRow> => ({ key: period, title: periodLabel(period), align: 'right', minWidth: 160, m: 'body', render: render(period) })),
    { key: 'toplam', title: 'Toplam', align: 'right', minWidth: 176, m: 'lead', render: render(null) },
  ];

  const items = kalemler.filter((row) => !row.isTotal);
  const series = measure.aggregate === 'count'
    ? [
        { name: 'Plan kaydı', tone: 'plan' as const, values: items.map((row) => recordCounts(row.all, today).plan) },
        { name: 'Gerçekleşen kaydı', tone: 'gercek' as const, values: items.map((row) => recordCounts(row.all, today).recorded) },
      ]
    : [{ name: measure.label, tone: measure.basis === 'planned' ? ('plan' as const) : ('gercek' as const), values: items.map((row) => cell(row, null)!.amount) }];

  return (
    <section className="aile-raporlar__rapor" aria-labelledby="aile-rapor-kalem">
      <ReportHead id="aile-rapor-kalem" title="Kaleme göre harcama" meta={`${rangeText(periods, current)} · ${items.length} kalem`} />
      <div className="aile-raporlar__secim">
        <Select label="Ölçü" value={measure.id} onChange={setMeasureId} options={measures.map((item) => ({ value: item.id, label: item.label }))} help="Plan ve gerçekleşen ayrı ölçüdür; tek sayıda birleşmez." />
      </div>
      <RaporGrafikWide
        wideFallback={null}
        categories={items.map((row) => row.label)}
        series={series}
        ariaLabel={`Kaleme göre ${measure.label.toLocaleLowerCase('tr-TR')}; değerler aşağıdaki tabloda`}
        description="Her kalem tek çubuktur; değerler aşağıdaki tabloda."
      />
      <ResponsiveTable key={periods.join('|')} caption="Kaleme göre harcama" mobileCaption={`${items.length} kalem`} columns={columns} rows={kalemler} />
      <Note>Satır boyutu kaynaktaki gider kalemidir; bütçe gözlemlerinde oda bilgisi yok. {FORECAST_NOTU}</Note>
    </section>
  );
}

// --- Rapor: Oda bazında alımlar (yalnız sayım) -------------------------------------------------------
interface SubReportProps { phone: boolean; onCsv(rows: CsvRows | null): void; onRetry(): void }

/** Filtresiz sorgu: türün bütün kayıtları. */
const TUM_ALIMLAR: QueryAst = { facets: {} };

function OdaReport({ phone, onCsv, onRetry }: SubReportProps) {
  // useQuery yükleme/hata durumunu oda ve terim koleksiyonlarıyla birlikte verir: oda adları gelmeden sayılan alımlar
  // "Bilinmiyor" odada toplanırdı (ve akordeonun açık satırı yanlış kalırdı).
  const query = useQuery('purchase_need', TUM_ALIMLAR);
  const needs = useCollection('purchase_needs');
  const loading = query.loading || needs.loading;
  const error = query.error ?? needs.error;
  // Silinmiş alım sayılmaz (RecordRow silinme bilgisini taşımaz; kaynak kayıttan okunur).
  const rows = useMemo<RoomRow[]>(() => {
    const deleted = new Set(needs.rows.filter((row) => row.deleted_at).map((row) => row.id));
    return roomRows(query.rows.filter((row) => !deleted.has(row.id)));
  }, [query.rows, needs.rows]);
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  useEffect(() => {
    if (loading || error || rows.length === 0) return undefined;
    onCsv([['Oda', 'Alım', 'Plan tutarı yazılı', 'Gerçekleşen tutarı yazılı'], ...rows.map((row) => [row.room, String(row.count), String(row.withPlanned), String(row.withActual)])]);
    return () => onCsv(null);
  }, [rows, loading, error, onCsv]);

  if (loading) return <LoadingShell rows={6} narrow={phone} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (rows.length === 0) return <EmptyState title="Kaynakta alım kaydı yok" message="Nesilde purchase_needs koleksiyonu boş." />;

  const columns: ResponsiveColumn<RoomRow>[] = [
    { key: 'oda', title: 'Oda', minWidth: 176, m: 'title', render: (row) => row.room },
    { key: 'alim', title: 'Alım', align: 'right', minWidth: 112, m: 'lead', render: (row) => `${row.count} alım` },
    { key: 'plan', title: 'Plan tutarı yazılı', align: 'right', minWidth: 176, render: (row) => `${row.withPlanned} alım` },
    { key: 'gercek', title: 'Gerçekleşen tutarı yazılı', align: 'right', minWidth: 208, render: (row) => `${row.withActual} alım` },
  ];

  return (
    <section className="aile-raporlar__rapor" aria-labelledby="aile-rapor-oda">
      <ReportHead id="aile-rapor-oda" title="Oda bazında alımlar" meta={`${rows.length} oda · ${total} alım`} />
      <Note>{ODA_NOTU}</Note>
      <RaporGrafikWide
        wideFallback={null}
        categories={rows.map((row) => row.room)}
        series={[{ name: 'Alım', tone: 'sayim', values: rows.map((row) => row.count) }]}
        ariaLabel="Odalara göre alım sayısı; değerler aşağıdaki tabloda"
        description="Her oda tek çubuktur; değerler aşağıdaki tabloda."
      />
      <ResponsiveTable caption="Oda bazında alımlar" mobileCaption={`${rows.length} oda`} columns={columns} rows={rows} />
    </section>
  );
}

// --- Rapor: Veri güveni özeti ---------------------------------------------------------------------------
function GuvenReport({ phone, onCsv, onRetry }: SubReportProps) {
  const issues = useCollection('issues');
  const rows = useMemo<IssueRow[]>(() => issueRows(issues.rows as readonly Issue[]), [issues.rows]);

  useEffect(() => {
    if (issues.loading || issues.error || rows.length === 0) return undefined;
    onCsv([['Kod', 'Önem', 'Kayıt'], ...rows.map((row) => [row.code, row.severity, String(row.count)])]);
    return () => onCsv(null);
  }, [rows, issues.loading, issues.error, onCsv]);

  if (issues.loading) return <LoadingShell rows={4} narrow={phone} />;
  if (issues.error) return <ErrorState message={issues.error} onRetry={onRetry} />;
  if (rows.length === 0) return <EmptyState title="Kaynakta sorun kaydı yok" message="Nesilde issues koleksiyonu boş; inceleme bekleyen kayıt yok." />;

  const columns: ResponsiveColumn<IssueRow>[] = [
    { key: 'kod', title: 'Kod', minWidth: 224, m: 'title', render: (row) => row.code },
    { key: 'onem', title: 'Önem', minWidth: 128, m: 'status', render: (row) => row.severity },
    { key: 'kayit', title: 'Kayıt', align: 'right', minWidth: 112, m: 'lead', render: (row) => `${row.count} kayıt` },
  ];
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <section className="aile-raporlar__rapor" aria-labelledby="aile-rapor-guven">
      <ReportHead id="aile-rapor-guven" title="Veri güveni özeti" meta={`${total} sorun kaydı · ${rows.length} kod`} />
      <ResponsiveTable caption="Veri güveni özeti" mobileCaption={`${rows.length} kod`} columns={columns} rows={rows} mobileMode="list" />
      <Note>Kaynak: nesildeki issues koleksiyonu (normalize sırasında işaretlenen inceleme kayıtları).</Note>
    </section>
  );
}
