import { useEffect, useRef } from 'react';
import { init, use } from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { useReducedMotion } from '@mantine/hooks';
import { tokens, chartMotion } from './tokens';
import { money, type Budget } from './data';
use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, SVGRenderer]);

export function Chart({ option, label }: { option: EChartsOption; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current, undefined, { renderer: 'svg' });
    chart.setOption({ ...option, ...chartMotion(reduced ?? false) });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [option, reduced]);
  return <div className="budget-chart" ref={ref} role="img" aria-label={label} />;
}
export default function Charts({ data, selected }: { data: Budget; selected: number }) {
  const names = data.months.map(m => `${m.label.slice(0, 3)} ${m.key.slice(2, 4)}`);
  const base: EChartsOption = {
    textStyle: { fontFamily: tokens.font, fontSize: 16, color: tokens.ink },
    color: [tokens.blue, tokens.green, tokens.red],
    grid: { left: 12, right: 16, top: 24, bottom: 36, containLabel: true },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, textStyle: { fontFamily: tokens.font, fontSize: 16 }, valueFormatter: v => money(typeof v === 'number' ? v : null) },
    xAxis: { type: 'category', data: names, axisLabel: { fontSize: 14, color: tokens.muted, hideOverlap: true }, axisTick: { show: false }, axisLine: { lineStyle: { color: tokens.line } } },
    yAxis: { type: 'value', axisLabel: { fontSize: 14, color: tokens.muted, formatter: (n: number) => `${Math.round(n / 1000)} bin` }, splitLine: { lineStyle: { color: tokens.line, type: 'dashed' } } },
    aria: { enabled: true },
  };
  const planLine = { name: 'Plan', type: 'line' as const, symbol: 'none', lineStyle: { type: 'dashed' as const, width: 2 }, itemStyle: { color: tokens.muted } };
  const currentLine = { name: 'Güncel', type: 'line' as const, symbol: 'circle', symbolSize: 6, lineStyle: { width: 3 }, itemStyle: { color: tokens.blue } };
  const groups = data.groups.filter(g => g.kind === 'expense');
  const cumulative = (field: 'plan' | 'current') => { let total = 0; return data.months.map(m => total += m.saving[field]); };
  return <div className="chart-grid">
    <section className="chart-section chart-wide"><div className="section-heading"><div><p className="eyebrow">DÖNEMİN GÖRÜNÜMÜ</p><h2>Nakit nasıl ilerliyor?</h2></div><div className="chart-legend"><span className="legend-dashed">Plan</span><span className="legend-solid">Güncel</span></div></div><p className="muted">Ay sonu nakit bakiyesi. Negatif değer, finansman açığını gösterir.</p><Chart label="Ay sonu nakit bakiyesi: plan ve güncel. Sayısal değerler Aylık tablo bölümünde." option={{ ...base, series: [{ ...planLine, data: data.months.map(m => m.balance.plan) }, { ...currentLine, data: data.months.map(m => m.balance.current) }] }} /></section>
    <section className="chart-section"><h2>Gelir ve ödemeler</h2><p className="muted">Güncel tutarlar. Birikim, ödemelere dahil değil.</p><div className="chart-legend"><span className="legend-solid">Gelir</span><span className="legend-red">Ödemeler</span></div><Chart label="Aylık güncel gelir ve ödemeler" option={{ ...base, series: [{ name: 'Gelir', type: 'bar', data: data.months.map(m => m.income.current), itemStyle: { color: tokens.blue } }, { name: 'Ödemeler', type: 'bar', data: data.months.map(m => m.expense.current), itemStyle: { color: tokens.red } }] }} /></section>
    <section className="chart-section"><h2>Birikimin seyri</h2><p className="muted">Dönem başından itibaren net ayrılan toplam.</p><div className="chart-legend"><span className="legend-dashed">Plan</span><span className="legend-solid">Güncel</span></div><Chart label="Kümülatif net birikim: plan ve güncel" option={{ ...base, series: [{ ...planLine, data: cumulative('plan') }, { ...currentLine, data: cumulative('current') }] }} /></section>
    <section className="chart-section chart-wide"><h2>{data.months[selected].label} ödemeleri</h2><p className="muted">Kategori bazında plan ve güncel tutar karşılaştırması.</p><div className="chart-legend"><span className="legend-neutral">Plan</span><span className="legend-solid">Güncel</span></div><Chart label="Seçili ay kategori bazında ödemeler. Kalemler tablosunda ayrıntılı değerler." option={{ ...base, xAxis: { ...base.yAxis as object }, yAxis: { type: 'category', data: groups.map(g => g.label), axisLabel: { fontSize: 14, color: tokens.ink, width: 100, overflow: 'break' }, axisTick: { show: false }, axisLine: { show: false } }, series: [{ name: 'Plan', type: 'bar', data: groups.map(g => g.plan[selected]), itemStyle: { color: tokens.lightBlue } }, { name: 'Güncel', type: 'bar', data: groups.map(g => g.current[selected]), itemStyle: { color: tokens.blue } }] }} /></section>
  </div>;
}
