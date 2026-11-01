import { Fragment, useEffect, useId, useRef, type ReactNode } from 'react';
import { init, use } from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { useReducedMotion } from '@mantine/hooks';
import { tokens, chartMotion } from './tokens';
import { money, type Budget } from './data';
import './charts.css';
use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, SVGRenderer]);

export function Chart({ option, label }: { option: EChartsOption; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current, undefined, { renderer: 'svg' });
    chart.setOption({ ...option, aria: { ...option.aria, label: { ...option.aria?.label, description: label } }, ...chartMotion(reduced ?? false) });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [option, label, reduced]);
  return <div className="budget-chart" ref={ref} role="img" aria-label={label} />;
}
function ChartSection({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  const id = useId();
  return <section className={`chart-section${wide ? ' chart-wide' : ''}`} aria-labelledby={id}><h2 id={id}>{title}</h2>{children}</section>;
}
// Keep the localized text intact; only thousands separators may become a line break.
function ChartAmount({ value }: { value: number | null }) {
  const groups = money(value).split(/(?<=\.)/);
  return <>{groups.map((group, index) => <Fragment key={index}>{group}{index < groups.length - 1 && <wbr />}</Fragment>)}</>;
}
function SelectedValues({ month, values }: { month: string; values: [string, number | null][] }) {
  return <div className="chart-selected" role="group" aria-label={`${month} değerleri`}><p className="chart-selected-month">{month}</p><dl>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><ChartAmount value={value} /></dd></div>)}</dl></div>;
}
export default function Charts({ data, selected }: { data: Budget; selected: number }) {
  const month = data.months[selected];
  const names = data.months.map(m => `${m.label.slice(0, 3)} ${m.key.slice(2, 4)}`);
  const base: EChartsOption = {
    textStyle: { fontFamily: tokens.font, fontSize: 16, color: tokens.ink },
    color: [tokens.blue, tokens.green, tokens.red],
    grid: { left: 12, right: 16, top: 24, bottom: 36, containLabel: true },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, textStyle: { fontFamily: tokens.font, fontSize: 16 }, valueFormatter: v => money(typeof v === 'number' ? v : null) },
    xAxis: { type: 'category', data: names, axisLabel: { fontSize: 14, color: tokens.muted, hideOverlap: true, showMinLabel: true, showMaxLabel: true, formatter: (value, index) => index === selected ? `{selected|${value}}` : value, rich: { selected: { fontSize: 14, fontWeight: tokens.headingWeight, color: tokens.ink } } }, axisTick: { show: false }, axisLine: { lineStyle: { color: tokens.line } } },
    yAxis: { type: 'value', axisLabel: { fontSize: 14, color: tokens.muted, hideOverlap: true, showMinLabel: true, showMaxLabel: true, formatter: (value: number) => new Intl.NumberFormat('tr-TR', { notation: 'compact', compactDisplay: 'long', maximumFractionDigits: 1 }).format(value) }, splitLine: { lineStyle: { color: tokens.line, type: 'dashed' } } },
    aria: { enabled: true },
  };
  const planLine = { name: 'Plan', type: 'line' as const, symbol: 'none', showAllSymbol: true, clip: false, lineStyle: { type: 'dashed' as const, width: 2 }, itemStyle: { color: tokens.muted } };
  const currentLine = { name: 'Güncel', type: 'line' as const, symbol: 'circle', symbolSize: 6, showAllSymbol: true, clip: false, lineStyle: { width: 3 }, itemStyle: { color: tokens.blue } };
  const groups = data.groups.filter(g => g.kind === 'expense');
  const cumulative = (field: 'plan' | 'current') => { let total = 0; return data.months.map(m => total += m.saving[field]); };
  const savingPlan = cumulative('plan'), savingCurrent = cumulative('current');
  const marked = (values: number[]) => values.map((value, index) => ({ value, ...(index === selected ? { symbol: 'diamond', symbolSize: 12, itemStyle: { borderColor: tokens.ink, borderWidth: 2 } } : {}) }));
  return <div className="chart-grid">
    <p className="chart-context chart-wide">{month.label} · Kaynak: {month.source}. Güncel tutarlar planı izliyor olabilir; gerçekleşmiş ödeme değildir. Zaman grafiklerinde elmas işareti ve sütunların koyu konturu seçili ayı gösterir.</p>
    <ChartSection title="Nakit nasıl ilerliyor?" wide>
      <p className="muted">Ay sonu harcanabilir nakit. Kart ve KMH borcu ile fon eksiğini Finansman’da ayrı izleyin; nakdin sıfır olması borcun veya açığın olmadığı anlamına gelmez.</p>
      <SelectedValues month={month.label} values={[['Plan', month.balance.plan], ['Güncel', month.balance.current]]} />
      <div className="chart-legend"><span className="legend-dashed">Plan</span><span className="legend-solid">Güncel</span></div>
      <Chart label="Ay sonu nakit bakiyesi: plan ve güncel. Bütün sayısal değerler Aylık tablo bölümünde." option={{ ...base, series: [{ ...planLine, data: marked(data.months.map(m => m.balance.plan)) }, { ...currentLine, data: marked(data.months.map(m => m.balance.current)) }] }} />
    </ChartSection>
    <ChartSection title="Gelir ve ödemeler">
      <p className="muted">Güncel tutarlar. Birikim, ödemelere dahil değil.</p>
      <SelectedValues month={month.label} values={[['Gelir', month.income.current], ['Ödemeler', month.expense.current]]} />
      <div className="chart-legend"><span className="legend-solid">Gelir</span><span className="legend-red">Ödemeler</span></div>
      <Chart label="Aylık güncel gelir ve ödemeler" option={{ ...base, series: [{ name: 'Gelir', type: 'bar', data: marked(data.months.map(m => m.income.current)), itemStyle: { color: tokens.blue } }, { name: 'Ödemeler', type: 'bar', data: marked(data.months.map(m => m.expense.current)), itemStyle: { color: tokens.red } }] }} />
    </ChartSection>
    <ChartSection title="Birikimin seyri">
      <p className="muted">{data.schema === 'cashflow' ? 'Birikim alımlarına ayrılan kümülatif TL. Güncel piyasa değeri veya kasadaki nakit değildir.' : 'Dönem başından itibaren net ayrılan toplam.'} Aşağıdaki tutarlar seçili ayın sonuna kadardır.</p>
      <SelectedValues month={month.label} values={[['Plan', savingPlan[selected]], ['Güncel', savingCurrent[selected]]]} />
      <div className="chart-legend"><span className="legend-dashed">Plan</span><span className="legend-solid">Güncel</span></div>
      <Chart label={data.schema === 'cashflow' ? 'Birikim alımlarına ayrılan kümülatif TL: plan ve güncel' : 'Kümülatif net birikim: plan ve güncel'} option={{ ...base, series: [{ ...planLine, data: marked(savingPlan) }, { ...currentLine, data: marked(savingCurrent) }] }} />
    </ChartSection>
    <ChartSection title={`${month.label} ${data.schema === 'cashflow' ? 'harcama kalemleri' : 'ödemeleri'}`} wide>
      <p className="muted">{data.schema === 'cashflow' ? 'Harcamanın ait olduğu aya göre kategoriler. Kart ödeme takvimi aylık nakit özetinde ve Timeline’dadır.' : 'Kategori bazında plan ve güncel tutar karşılaştırması.'}</p>
      <div className="chart-legend"><span className="legend-outline">Plan · kontur</span><span className="legend-solid">Güncel · dolgu</span></div>
      <Chart label="Seçili ay kategorileri: konturlu plan ve dolu güncel sütunlar. Kaynak tutarları hemen altındaki tabloda." option={{ ...base, xAxis: { ...base.yAxis as object }, yAxis: { type: 'category', inverse: true, data: groups.map(g => g.label), axisLabel: { fontSize: 14, color: tokens.ink, width: 100, overflow: 'break' }, axisTick: { show: false }, axisLine: { show: false } }, series: [{ name: 'Plan', type: 'bar', data: groups.map(g => g.plan[selected]), itemStyle: { color: tokens.paper, borderColor: tokens.muted, borderWidth: 2 } }, { name: 'Güncel', type: 'bar', data: groups.map(g => g.current[selected]), itemStyle: { color: tokens.blue } }] }} />
      <p className="muted">Her kategorinin Plan ve Güncel kaynak tutarları.</p>
      <div className="chart-category-list">{groups.map(group => <div className="chart-category-pair" role="group" aria-label={`${group.label} tutarları`} key={group.id}><h3>{group.label}</h3><dl><div><dt>Plan</dt><dd>{money(group.plan[selected])}</dd></div><div><dt>Güncel</dt><dd>{money(group.current[selected])}</dd></div></dl></div>)}</div>
      <div className="chart-data table-scroll" role="region" aria-label="Kategori tutarları; yatay kaydırılabilir" tabIndex={0} onKeyDown={event => {
        if (event.target === event.currentTarget && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); event.currentTarget.scrollLeft += event.currentTarget.clientWidth / 2 * (event.key === 'ArrowRight' ? 1 : -1); }
      }}><table aria-label={`${month.label} kategori tutarları`}><thead><tr><th scope="col">Kategori</th><th scope="col">Plan</th><th scope="col">Güncel</th></tr></thead><tbody>{groups.map(group => <tr key={group.id}><th scope="row">{group.label}</th><td>{money(group.plan[selected])}</td><td>{money(group.current[selected])}</td></tr>)}</tbody></table></div>
    </ChartSection>
  </div>;
}
