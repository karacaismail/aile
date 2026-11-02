import { useCallback, useEffect, useId, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { useDevice } from '../device';
import { Button, Chart, DataStatus, EmptyState, ErrorState, LoadingShell, Money, ResponsiveTable, Select, StatusText, Tag } from '../ui';
import type { DataStatusState, PageHeaderAction, PageHeaderSummary, ResponsiveColumn, Tone } from '../shell/contracts';
import { PageHeader } from '../shell/PageHeader';
import { liveBudget, useCollection, useGeneration, type BudgetObservation, type BudgetViewModel, type GenerationState, type LiveBudgetOptions, type LiveBudgetResult, type Money as MoneyValue } from '../data';
import './ButcePage.css';

// Bütçe ve nakit — tasarım: README.md "Sayfa iskeleti", ekranlar.md SayfaButce / SayfaButceDar, bundle.js Pages.Butce
// (sütunlar Kalem · Planlanan · Gerçekleşen · Kalan/Fark · Durum; mobilde Kalem title, Kategori meta, Fark lead, Durum
// status). Veri: budget_observations (data-platform README): gözlemler muhasebe kaydı ya da toplanabilir toplam DEĞİLDİR;
// ara toplam satırı çocuklarıyla toplanmaz ve yaprak/ara toplam sahipliği nesilde yoktur. Bu yüzden:
//   - Plan (basis planned) ve gerçek (recorded_aggregate) ayrı sütunlardır; fark aynı satırın iki değerinin farkıdır.
//   - Özet tutar değil sayımdır ("8 gözlem"); sayfa hiçbir gözlemi toplamaz.
//   - Grafik seçili kalemin aylık plan/gerçek çizgisidir (satır içi, toplama yok) ve yanında tablo vardır.
//   - Sahiplik (Tür sütunu) canlı Sheet eşlemesinden gelir: canlı `groups` → "Ara toplam", `categories` → "Kalem";
//     eşleme yoksa "Bilinmiyor". Ara toplam satırı çocuklarının üstünde, çocuklar bir içeride.
// Canlı GViz (live.liveBudget) ikinci DataStatus satırıdır (region "Canlı Sheet", başlığın dışında, gövdenin ilk satırı;
// başlıkta tek tazelik satırı nesildir): başarılıysa son okuma + nesil ile
// fark sayısı; hata ise yalnız "Hata: …" (tutar yok). Panelden yazma yok: "Kalem ekle" devre dışı ve nedeni yazılı.
// Ham antd/echarts importu yok (ui barrel); grafik option tipi Chart'ın prop tipinden türetilir. Para tipi veri
// platformunun nullable Money zarfıdır (null = bilgi yok; Money bileşeni adıyla yazar).

type ChartOption = ComponentProps<typeof Chart>['option'];

export type Ownership = 'leaf' | 'subtotal' | 'unknown';

export interface BudgetRow {
  /** Satır anahtarı (ResponsiveTable `key`): etiket. */
  key: string;
  label: string;
  period: string;
  planned: MoneyValue;
  actual: MoneyValue;
  /** planned − actual; biri yoksa ya da para birimi farklıysa null ("Hesaplanmadı"). */
  difference: MoneyValue;
  /** Aynı etiket/dönem/basis için birden çok gözlem: toplanmaz, değer bilinmiyor. */
  plannedAmbiguous: boolean;
  actualAmbiguous: boolean;
  /** basis 'unclassified' gözlem sayısı (ne plan ne gerçek sayılır). */
  unclassified: number;
  ownership: Ownership;
  /** Ara toplam satırının etiketi (canlı eşlemeden); yoksa null. */
  parent: string | null;
  status: { label: string; tone: Tone };
}

export interface ButcePageProps {
  location?: string;
  /** Varsayılan dönem ve canlı okuma zamanı için; test enjeksiyonu. */
  now?: () => Date;
  /** Canlı Sheet okuması; false ise satır çizilmez ve ağa çıkılmaz. */
  live?: boolean;
  liveBudgetImpl?: (options: LiveBudgetOptions) => Promise<LiveBudgetResult>;
}

const LOCATION = '/butce';
const SECTION = 'Para';
const TITLE = 'Bütçe ve nakit';
const PURPOSE = 'Ayın gelirini, planlanan giderlerini ve kalan nakdi kalem kalem izleyin.';
const CAPTION = 'Bütçe kalemleri';
const EMPTY_TITLE = 'Kaynakta bütçe gözlemi kaydı yok';
const EMPTY_MESSAGE = 'Nesilde budget_observations koleksiyonu boş; Plan ve Gerçekleşen sayfalarında aylık başlıklı satır bulunmadı.';
const ADD_DISABLED_REASON = "Bu dilimde kalem eklenmez; Sheets'e yazma yok.";
const HENUZ_YOK = 'Henüz yok';
const HESAPLANMADI = 'Hesaplanmadı';
const DEFAULT_CURRENCY = 'TRY';
/** Gerçekleşen planın bu oranına ulaştıysa "Sınıra yakın" (bundle.js Butce: "Sınıra yakın" etiketi). */
const NEAR_LIMIT_PERCENT = 90n;

const ayBicimi = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
const kisaAyBicimi = new Intl.DateTimeFormat('tr-TR', { month: 'short', year: 'numeric' });

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
function periodDate(period: string): Date | null {
  const match = PERIOD_RE.exec(period);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12)) : null;
}

/** "2026-11" → "Kasım 2026"; biçimsiz dönem olduğu gibi döner. */
export function periodLabel(period: string): string {
  const date = periodDate(period);
  return date ? ayBicimi.format(date) : period;
}
function shortPeriodLabel(period: string): string {
  const date = periodDate(period);
  return date ? kisaAyBicimi.format(date) : period;
}

const monthOf = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/** İçinde bulunulan ay varsa o; yoksa bugünden önceki son dönem; hiçbiri yoksa ilk dönem; dönem yoksa null. */
export function defaultPeriod(periods: readonly string[], now: Date): string | null {
  if (!periods.length) return null;
  const sorted = [...periods].sort();
  const current = monthOf(now);
  if (sorted.includes(current)) return current;
  const past = sorted.filter(period => period < current);
  return past.length ? past[past.length - 1] : sorted[0];
}

// --- Ondalık metin aritmetiği (yuvarlama yok; kuruş tam sayısı) --------------------------------------------
const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;
function toCents(amount: string): bigint | null {
  const match = DECIMAL_RE.exec(amount.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const cents = BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2));
  return sign ? -cents : cents;
}
function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const rest = abs % 100n;
  return `${negative ? '-' : ''}${whole}.${String(rest).padStart(2, '0')}`;
}
const toMoney = (observation: BudgetObservation): MoneyValue =>
  observation.value.decimal === null || observation.value.decimal === undefined
    ? null
    : { amount: observation.value.decimal, currency: observation.value.currency ?? DEFAULT_CURRENCY };

function difference(planned: MoneyValue, actual: MoneyValue): MoneyValue {
  if (!planned || !actual || planned.currency !== actual.currency) return null;
  const plan = toCents(planned.amount);
  const real = toCents(actual.amount);
  if (plan === null || real === null) return null;
  return { amount: fromCents(plan - real), currency: planned.currency };
}

function statusOf(planned: MoneyValue, actual: MoneyValue, ambiguous: boolean): BudgetRow['status'] {
  if (ambiguous) return { label: 'Bilinmiyor', tone: 'uyari' };
  if (!actual) return { label: 'Bekliyor', tone: 'notr' };
  if (!planned) return { label: 'Plan yok', tone: 'uyari' };
  const plan = toCents(planned.amount);
  const real = toCents(actual.amount);
  if (plan === null || real === null || planned.currency !== actual.currency) return { label: 'Bilinmiyor', tone: 'uyari' };
  if (real > plan) return { label: 'Aşıldı', tone: 'hata' };
  if (real === plan) return { label: 'Tamamlandı', tone: 'olumlu' };
  if (plan > 0n && real * 100n >= plan * NEAR_LIMIT_PERCENT) return { label: 'Sınıra yakın', tone: 'uyari' };
  return { label: 'Planda', tone: 'notr' };
}

// --- Sahiplik eşlemesi (canlı Sheet) ----------------------------------------------------------------------
interface OwnershipMap { subtotals: Set<string>; parents: Map<string, string> }
const fold = (text: string) => text.trim().toLocaleLowerCase('tr-TR');
const collator = new Intl.Collator('tr-TR', { numeric: true, sensitivity: 'base' });
function ownershipMap(live: BudgetViewModel | null): OwnershipMap | null {
  if (!live) return null;
  const subtotals = new Set(live.groups.map(group => fold(group.label)));
  const parents = new Map(live.categories.map(category => [fold(category.label), category.group] as const));
  return { subtotals, parents };
}

interface Side { money: MoneyValue; count: number }
const addSide = (side: Side, observation: BudgetObservation): Side => ({ money: side.count === 0 ? toMoney(observation) : null, count: side.count + 1 });

/** Dönemin gözlemlerini etiket satırlarına çevirir; plan ve gerçek ayrı, yinelenen toplanmaz, ağaç sırası sahiplikten. */
export function budgetRowsFor(observations: readonly BudgetObservation[], period: string, live: BudgetViewModel | null): BudgetRow[] {
  const map = ownershipMap(live);
  const byLabel = new Map<string, { planned: Side; actual: Side; unclassified: number }>();
  for (const observation of observations) {
    if (observation.period !== period || observation.deleted_at) continue;
    const label = observation.label.trim();
    if (!label) continue;
    const entry = byLabel.get(label) ?? { planned: { money: null, count: 0 }, actual: { money: null, count: 0 }, unclassified: 0 };
    if (observation.basis === 'planned') entry.planned = addSide(entry.planned, observation);
    else if (observation.basis === 'recorded_aggregate') entry.actual = addSide(entry.actual, observation);
    else entry.unclassified += 1;
    byLabel.set(label, entry);
  }

  const rows: BudgetRow[] = [];
  for (const [label, entry] of byLabel) {
    const plannedAmbiguous = entry.planned.count > 1;
    const actualAmbiguous = entry.actual.count > 1;
    const planned = plannedAmbiguous ? null : entry.planned.money;
    const actual = actualAmbiguous ? null : entry.actual.money;
    const key = fold(label);
    let ownership: Ownership = 'unknown';
    let parent: string | null = null;
    if (map) {
      if (map.subtotals.has(key)) ownership = 'subtotal';
      else if (map.parents.has(key)) {
        ownership = 'leaf';
        const group = map.parents.get(key)!.trim();
        parent = group || null;
      }
    }
    rows.push({
      key: label, label, period, planned, actual,
      difference: plannedAmbiguous || actualAmbiguous ? null : difference(planned, actual),
      plannedAmbiguous, actualAmbiguous, unclassified: entry.unclassified, ownership, parent,
      status: statusOf(planned, actual, plannedAmbiguous || actualAmbiguous),
    });
  }

  // Kararlı sıra: etiket (tr-TR, sayı duyarlı); kaynak sırası hücre kimliğine göre olduğu için anlamsızdır.
  rows.sort((a, b) => collator.compare(a.label, b.label));
  if (!map) return rows;
  // Ağaç sırası: ara toplam satırı, hemen ardından çocukları (kaynak sırası korunur); ebeveynsiz satırlar yerinde kalır.
  const byFold = new Map(rows.map(row => [fold(row.label), row] as const));
  const placed = new Set<string>();
  const ordered: BudgetRow[] = [];
  for (const row of rows) {
    if (placed.has(row.key)) continue;
    if (row.parent && byFold.has(fold(row.parent)) && !placed.has(byFold.get(fold(row.parent))!.key)) continue; // ebeveyn gelince
    ordered.push(row);
    placed.add(row.key);
    if (row.ownership === 'subtotal') {
      for (const child of rows) {
        if (!placed.has(child.key) && child.parent && fold(child.parent) === fold(row.label)) { ordered.push(child); placed.add(child.key); }
      }
    }
  }
  for (const row of rows) if (!placed.has(row.key)) { ordered.push(row); placed.add(row.key); }
  return ordered;
}

const sameMoney = (a: MoneyValue | undefined, b: MoneyValue | undefined): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ca = toCents(a.amount);
  const cb = toCents(b.amount);
  return a.currency === b.currency && ca !== null && cb !== null && ca === cb;
};

/** Seçili dönemde nesil satırları ile canlı satırlar (categories + groups) arasında tutarı farklı ya da tek tarafta olan etiket sayısı. */
export function compareWithLive(rows: readonly BudgetRow[], live: BudgetViewModel | null, period: string): number {
  if (!live) return 0;
  const liveByLabel = new Map<string, { planned: MoneyValue; actual: MoneyValue }>();
  for (const line of [...live.groups, ...live.categories]) {
    liveByLabel.set(fold(line.label), { planned: line.planned[period] ?? null, actual: line.actual[period] ?? null });
  }
  let differing = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    const key = fold(row.label);
    seen.add(key);
    const other = liveByLabel.get(key);
    if (!other) { differing += 1; continue; }
    if (!sameMoney(row.planned, other.planned) || !sameMoney(row.actual, other.actual)) differing += 1;
  }
  for (const key of liveByLabel.keys()) if (!seen.has(key)) differing += 1;
  return differing;
}

// --- Durum eşlemeleri ---------------------------------------------------------------------------------------
const GENERATION_STATUS: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };
const OWNERSHIP_LABEL: Record<Ownership, { label: string; tone: Tone }> = {
  leaf: { label: 'Kalem', tone: 'notr' },
  subtotal: { label: 'Ara toplam', tone: 'bilgi' },
  unknown: { label: 'Bilinmiyor', tone: 'notr' },
};

type LiveState =
  | { status: 'checking' }
  | { status: 'ok'; budget: BudgetViewModel }
  | { status: 'error'; message: string };

function useLiveBudget(enabled: boolean, impl: ButcePageProps['liveBudgetImpl'], now: (() => Date) | undefined) {
  const [state, setState] = useState<LiveState>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(count => count + 1), []);
  const read = impl ?? liveBudget;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ status: 'checking' });
    read({ signal: controller.signal, now }).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) setState({ status: 'ok', budget: result.budget });
      else if (result.kind !== 'aborted') setState({ status: 'error', message: result.message });
    });
    return () => controller.abort();
  }, [enabled, read, now, attempt]);
  return { state, retry };
}

// --- Sayfa -------------------------------------------------------------------------------------------------
export function ButcePage({ location = LOCATION, now, live = true, liveBudgetImpl }: ButcePageProps) {
  const device = useDevice();
  const addReasonId = useId();
  const generation = useGeneration();
  const observations = useCollection('budget_observations');
  const { state: liveState, retry: retryLive } = useLiveBudget(live, liveBudgetImpl, now);
  const liveBudgetModel = liveState.status === 'ok' ? liveState.budget : null;

  const periods = useMemo(() => {
    const set = new Set<string>();
    for (const observation of observations.rows) if (!observation.deleted_at && observation.period) set.add(observation.period);
    return [...set].sort();
  }, [observations.rows]);

  const [chosenPeriod, setChosenPeriod] = useState<string | null>(null);
  const period = chosenPeriod && periods.includes(chosenPeriod) ? chosenPeriod : defaultPeriod(periods, (now ?? (() => new Date()))());

  const rows = useMemo(() => (period ? budgetRowsFor(observations.rows, period, liveBudgetModel) : []), [observations.rows, period, liveBudgetModel]);
  const [chosenLabel, setChosenLabel] = useState<string | null>(null);
  const selected = rows.find(row => row.label === chosenLabel) ?? rows[0] ?? null;

  const plannedCount = rows.filter(row => row.planned || row.plannedAmbiguous).length;
  const actualCount = rows.filter(row => row.actual || row.actualAmbiguous).length;
  const unclassifiedCount = rows.reduce((total, row) => total + row.unclassified, 0);
  const ambiguousCount = rows.filter(row => row.plannedAmbiguous || row.actualAmbiguous).length;

  const summary: PageHeaderSummary[] | undefined = period
    ? [
        { label: 'Dönem', value: periodLabel(period), note: `${periods.length} dönem` },
        { label: 'Planlanan', value: `${plannedCount} gözlem`, note: ambiguousCount ? `${ambiguousCount} yinelenen` : undefined },
        { label: 'Gerçekleşen', value: `${actualCount} gözlem`, note: unclassifiedCount ? `${unclassifiedCount} sınıflanmamış` : undefined },
      ]
    : undefined;

  const exportRows = useCallback(() => {
    if (typeof window === 'undefined' || !rows.length) return;
    const head = ['Kalem', 'Dönem', 'Planlanan', 'Gerçekleşen', 'Fark', 'Para birimi', 'Tür'];
    const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = rows.map(row => [row.label, row.period, row.planned?.amount ?? '', row.actual?.amount ?? '', row.difference?.amount ?? '', row.planned?.currency ?? row.actual?.currency ?? '', OWNERSHIP_LABEL[row.ownership].label].map(cell).join(';'));
    const blob = new Blob([`﻿${[head.map(cell).join(';'), ...lines].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `butce-${period ?? 'donem'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [rows, period]);
  const more: PageHeaderAction[] = [{ label: 'Dışa aktar', icon: 'download', onClick: exportRows }];

  const status = {
    state: GENERATION_STATUS[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: () => { void generation.refresh(); },
  };

  const columns = useMemo<ResponsiveColumn<BudgetRow>[]>(() => [
    {
      key: 'label', title: 'Kalem', minWidth: 200, m: 'title', only: 'desktop',
      render: row => (
        <span className={`aile-butce-kalem${row.parent ? ' aile-butce-kalem--alt' : ''}`} data-level={row.parent ? 2 : 1}>
          <span className="aile-butce-kalem-ad">{row.label}</span>
          {row.parent ? <span className="aile-kucuk aile-ikincil">{row.parent}</span> : null}
        </span>
      ),
    },
    { key: 'planned', title: 'Planlanan', align: 'right', minWidth: 128, render: row => (row.plannedAmbiguous ? <span className="aile-tutar aile-tutar--eksik">Bilinmiyor</span> : <Money value={row.planned} />) },
    { key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 136, render: row => (row.actualAmbiguous ? <span className="aile-tutar aile-tutar--eksik">Bilinmiyor</span> : <Money value={row.actual} label={HENUZ_YOK} />) },
    { key: 'difference', title: 'Fark', align: 'right', minWidth: 120, m: 'lead', render: row => <Money value={row.difference} label={HESAPLANMADI} /> },
    { key: 'status', title: 'Durum', minWidth: 136, m: 'status', render: row => <Tag tone={row.status.tone}>{row.status.label}</Tag> },
    { key: 'ownership', title: 'Tür', minWidth: 120, only: 'desktop', render: row => <StatusText label={OWNERSHIP_LABEL[row.ownership].label} tone={OWNERSHIP_LABEL[row.ownership].tone} /> },
    // Telefon (SayfaButceDar): başlıkta düz kalem adı (title) ve altında ara toplam · tür (meta); gövdede yinelenmez.
    { key: 'labelMobile', title: 'Kalem', minWidth: 0, m: 'title', only: 'mobile', render: row => row.label },
    {
      key: 'ownershipMobile', title: 'Tür', minWidth: 0, m: 'meta', only: 'mobile',
      render: row => (row.parent ? `${row.parent} · ${OWNERSHIP_LABEL[row.ownership].label}` : OWNERSHIP_LABEL[row.ownership].label),
    },
  ], []);

  const periodOptions = useMemo(() => periods.map(value => ({ value, label: periodLabel(value) })), [periods]);

  // Grafik: seçili kalemin aylık plan/gerçek çizgisi (toplama yok); tablo yanında.
  const trend = useMemo(() => {
    if (!selected) return null;
    const label = selected.label;
    const points = periods.map(month => {
      const row = budgetRowsFor(observations.rows, month, null).find(candidate => candidate.label === label);
      return { period: month, planned: row?.plannedAmbiguous ? null : row?.planned ?? null, actual: row?.actualAmbiguous ? null : row?.actual ?? null };
    });
    const numberOf = (money: MoneyValue) => (money ? Number(money.amount) : null);
    const option: ChartOption = {
      xAxis: { type: 'category', data: points.map(point => shortPeriodLabel(point.period)) },
      yAxis: { type: 'value' },
      legend: { show: true },
      tooltip: { trigger: 'axis' },
      series: [
        { name: 'Planlanan', type: 'line', data: points.map(point => numberOf(point.planned)), connectNulls: false },
        { name: 'Gerçekleşen', type: 'line', data: points.map(point => numberOf(point.actual)), connectNulls: false },
      ],
    };
    return { label, points, option };
  }, [selected, periods, observations.rows]);

  // --- Gövde ---------------------------------------------------------------------------------------------
  let body: ReactNode;
  if (observations.error) {
    body = <ErrorState title="Bütçe gözlemleri okunamadı" message={observations.error} onRetry={() => { void generation.refresh(); }} />;
  } else if (observations.loading) {
    body = <LoadingShell rows={8} narrow={device === 'phone'} label="Bütçe gözlemleri yükleniyor" />;
  } else if (!period || !rows.length && !periods.length) {
    body = <EmptyState title={EMPTY_TITLE} message={EMPTY_MESSAGE} />;
  } else {
    body = (
      <>
        <div className="aile-butce-arac">
          <Select label="Dönem" options={periodOptions} value={period} onChange={setChosenPeriod} icon="calendar" className="aile-butce-donem" />
          <p className="aile-butce-sayim"><strong>{rows.length} kalem</strong><span className="aile-ikincil"> · {periodLabel(period)}</span></p>
        </div>
        <ResponsiveTable<BudgetRow>
          caption={CAPTION}
          mobileCaption={`${rows.length} kalem`}
          columns={columns}
          rows={rows}
          selectedKey={selected?.key}
          onRowClick={row => setChosenLabel(row.label)}
          groupBy={liveBudgetModel ? row => row.parent ?? (row.ownership === 'subtotal' ? row.label : 'Diğer') : undefined}
        />
        <p className="aile-kucuk aile-ikincil aile-butce-not">
          Fark = Planlanan − Gerçekleşen; eksi ise kalem aşılmıştır. Gözlemler toplanmaz; ara toplam satırı çocuklarıyla toplanmaz
          {liveBudgetModel ? '. Tür canlı Sheet eşlemesinden gelir.' : '; satır türü canlı Sheet eşlemesi olmadan bilinmez.'}
        </p>
        {trend ? (
          <section className="aile-butce-grafik" aria-label="Aylık eğilim">
            <h2 className="aile-butce-baslik">{trend.label} · aylık eğilim</h2>
            <Chart
              option={trend.option}
              ariaLabel={`"${trend.label}" kaleminin aylara göre planlanan ve gerçekleşen tutarı; değerler yanındaki tabloda`}
              description={
                <table className="aile-butce-egilim">
                  <caption>{trend.label} · aylık plan ve gerçek</caption>
                  <thead>
                    <tr><th scope="col">Ay</th><th scope="col" className="aile-butce-sag">Planlanan</th><th scope="col" className="aile-butce-sag">Gerçekleşen</th></tr>
                  </thead>
                  <tbody>
                    {trend.points.map(point => (
                      <tr key={point.period}>
                        <th scope="row">{periodLabel(point.period)}</th>
                        <td className="aile-butce-sag"><Money value={point.planned} /></td>
                        <td className="aile-butce-sag"><Money value={point.actual} label={HENUZ_YOK} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            />
          </section>
        ) : null}
      </>
    );
  }

  // --- Canlı Sheet satırı ----------------------------------------------------------------------------------
  let liveRow: ReactNode = null;
  if (live) {
    const liveStatus: DataStatusState = liveState.status === 'checking' ? 'checking' : liveState.status === 'ok' ? 'fresh' : 'error';
    const differing = liveState.status === 'ok' && period ? compareWithLive(rows, liveState.budget, period) : null;
    liveRow = (
      <section className="aile-butce-canli" aria-label="Canlı Sheet">
        <span className="aile-kucuk aile-ikincil aile-butce-canli-etiket">Canlı Sheet</span>
        <DataStatus
          state={liveStatus}
          lastReadAt={liveState.status === 'ok' ? liveState.budget.readAt : undefined}
          message={liveState.status === 'error' ? liveState.message : undefined}
          onRefresh={retryLive}
        />
        {differing !== null ? (
          <span className="aile-kucuk aile-butce-canli-fark">{differing === 0 ? 'Nesil ile fark yok' : `Nesil ile ${differing} fark`}</span>
        ) : null}
      </section>
    );
  }

  return (
    <div className="aile-butce">
      <PageHeader
        location={location}
        section={SECTION}
        title={TITLE}
        purpose={PURPOSE}
        primary={
          <span className="aile-butce-birincil">
            <Button variant="primary" icon="plus" disabled aria-describedby={addReasonId}>Kalem ekle</Button>
            <span id={addReasonId} className="aile-kucuk aile-ikincil">{ADD_DISABLED_REASON}</span>
          </span>
        }
        more={more}
        status={status}
        summary={summary}
      />
      {/* Başlıkta tek tazelik satırı (nesil, PageHeader status); canlı Sheet satırı ikinci kaynak olduğu için başlığın
          dışında, gövdenin ilk satırıdır. */}
      <div className="aile-butce-govde">
        {liveRow}
        {body}
      </div>
    </div>
  );
}
