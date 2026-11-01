import { Component, lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EChartsOption } from 'echarts';
import type { FinanceMonth } from './data';
import { financeMoney } from './format';
import { tokens } from '../dashboard/tokens';
import { loadCharts, revalidateChartResources } from '../dashboard/chartLoader';
import './finance-trends.css';

// Reuse the existing optional Charts chunk: opening the daily ledger never imports ECharts.
const Plot = lazy(() => loadCharts().then(module => ({ default: module.Chart })));
const fields = [
  { key: 'cash', label: 'Harcanabilir nakit', color: tokens.green },
  { key: 'cardDebt', label: 'Toplam kart borcu', color: tokens.blue },
  { key: 'kmhPrincipal', label: 'KMH anaparası', color: tokens.amber },
] as const;
type TrendKey = typeof fields[number]['key'];
const monthDate = (month: string) => Date.parse(`${month}-01T00:00:00Z`);
const monthLabel = (month: string) => new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(monthDate(month));
const shortMonth = (time: number) => new Intl.DateTimeFormat('tr-TR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(time);
const nextMonth = (month: string) => { const date = new Date(monthDate(month)); date.setUTCMonth(date.getUTCMonth() + 1); return date.getTime(); };

/** Presentation only: native values, one common scale, and a break wherever the source skips a month. */
export function financeTrendOption(months: FinanceMonth[], selected: string, key: TrendKey, color: string): EChartsOption {
  const max = Math.max(1, ...months.flatMap(month => fields.map(field => month[field.key])));
  const single = months.length === 1;
  const values = months.flatMap((month, index) => [
    ...(index && monthDate(month.month) > nextMonth(months[index - 1].month) ? [{ value: [nextMonth(months[index - 1].month), null] }] : []),
    { value: single ? month[key] : [monthDate(month.month), month[key]], symbol: month.month === selected ? 'diamond' : 'circle', symbolSize: month.month === selected ? 12 : 5 },
  ]);
  return {
    useUTC: true,
    textStyle: { fontFamily: tokens.font, fontSize: 14, color: tokens.ink },
    grid: { left: 8, right: 16, top: 16, bottom: 16, containLabel: true },
    xAxis: single
      ? { type: 'category', data: [shortMonth(monthDate(months[0].month))], axisLabel: { fontSize: 14, color: tokens.muted } }
      : { type: 'time', min: monthDate(months[0].month), max: monthDate(months.at(-1)!.month), minInterval: 28 * 86400000, splitNumber: 3, axisLabel: { fontSize: 14, color: tokens.muted, hideOverlap: true, showMinLabel: true, showMaxLabel: true, formatter: shortMonth }, axisTick: { show: false }, axisLine: { lineStyle: { color: tokens.line } } },
    yAxis: { type: 'value', min: 0, max, splitNumber: 2, axisLabel: { fontSize: 14, color: tokens.muted, hideOverlap: true, formatter: (value: number) => new Intl.NumberFormat('tr-TR', { notation: 'compact', compactDisplay: 'long', maximumFractionDigits: 1 }).format(value) }, splitLine: { lineStyle: { color: tokens.line, type: 'dashed' } } },
    series: [{ name: fields.find(field => field.key === key)!.label, type: 'line', data: values, connectNulls: false, smooth: false, showSymbol: true, showAllSymbol: true, clip: false, lineStyle: { color, width: 3 }, itemStyle: { color, borderColor: tokens.paper, borderWidth: 1 } }],
    aria: { enabled: true },
  };
}

class PlotBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? <p role="status">Grafik yüklenemedi. Kaynak tutarları ve aylık tablo kullanılabilir.</p> : this.props.children; }
}

export default function FinanceTrends({ months, selected, tableId }: { months: FinanceMonth[]; selected: string; tableId: string }) {
  const id = useId();
  const [failed, setFailed] = useState(false);
  const [recoveryState, setRecoveryState] = useState<'idle' | 'pending' | 'error' | 'cancelled'>('idle');
  const recovering = recoveryState === 'pending';
  const recoveryRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setRecoveryState(current => current === 'pending' ? 'cancelled' : 'idle');
    return () => { recoveryRequest.current?.abort(); recoveryRequest.current = null; };
  }, [selected]);
  const recover = async () => {
    if (recovering || recoveryRequest.current) return;
    setRecoveryState('pending');
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 10000);
    recoveryRequest.current = controller;
    try {
      // WebKit can retain a failed module resource across reloads; revalidate only this import's additions.
      await revalidateChartResources(controller.signal);
      if (recoveryRequest.current !== controller) return;
      const url = new URL(window.location.href); url.searchParams.set('financeChartMonth', selected);
      window.history.replaceState(window.history.state, '', url.href);
      window.location.reload();
    } catch { if (recoveryRequest.current === controller) setRecoveryState('error'); }
    finally { controller.abort(); window.clearTimeout(timeout); if (recoveryRequest.current === controller) recoveryRequest.current = null; }
  };
  const month = months.find(value => value.month === selected)!;
  const options = useMemo(() => fields.map(field => financeTrendOption(months, selected, field.key, field.color)), [months, selected]);
  return <section className="finance-trends" aria-labelledby={id}>
    <header className="finance-trends-heading"><h2 id={id}>Nakit ve borcun seyri</h2><p>Ay sonları · Üç grafik aynı dönem ve ortak TL ölçeği kullanır. Elmas işareti seçili ayı gösterir. Çizgiler günlük bakiyeyi göstermez.</p></header>
    {failed && <div className="finance-chart-recovery"><p>Grafikleri yeniden yüklemek için sayfayı yenileyin. Seçili ay ve Aylık özet korunur.</p><button type="button" className="quiet-button" aria-disabled={recovering} onClick={recover}>{recovering ? 'Yenileniyor…' : 'Sayfayı yenile'}</button><p role="status">{recovering ? 'Grafikler yeniden yükleniyor.' : recoveryState === 'error' ? 'Bağlantı henüz kurulamadı. Tutarlar ve tablo kullanılabilir; yeniden deneyebilirsiniz.' : recoveryState === 'cancelled' ? 'Yenileme iptal edildi; seçili ay değişti. Tekrar deneyebilirsiniz.' : ''}</p></div>}
    <div className="finance-trend-panels">{fields.map((field, index) => <div className="finance-trend-panel" role="group" aria-label={field.label} key={field.key}>
      <div className="finance-trend-caption"><h3>{field.label}</h3><div className="finance-trend-value"><span>{monthLabel(selected)}</span><strong>{financeMoney(month[field.key])}</strong></div></div>
      <PlotBoundary onError={() => setFailed(true)}><Suspense fallback={<p role="status">Grafik hazırlanıyor; kaynak tutarı yukarıda.</p>}><Plot label={`${field.label}: ay sonu eğilimi. Seçili ${monthLabel(selected)}: ${financeMoney(month[field.key])}. Bütün tutarlar aşağıdaki aylık tabloda.`} option={options[index]} /></Suspense></PlotBoundary>
      {months.every(value => value[field.key] === 0) && <p className="finance-trend-zero">Dönemin tüm ay sonlarında 0 ₺.</p>}
    </div>)}</div>
    <div className="finance-trend-context"><p>{monthLabel(selected)} · KMH faiz + vergi: <strong>{financeMoney(month.kmhCost)}</strong> · Fon eksiği: <strong>{financeMoney(month.fundingGap)}</strong>.</p><p>Gelecek taksit kart borcuna dahildir; grafiklere tekrar eklenmez. Hesap, gerçekleşmiş ödeme değildir.</p><button type="button" className="quiet-button" onClick={() => { const table = document.getElementById(tableId); table?.scrollIntoView({ block: 'start' }); table?.focus({ preventScroll: true }); }}>Bütün aylık tutarlara git</button></div>
  </section>;
}
