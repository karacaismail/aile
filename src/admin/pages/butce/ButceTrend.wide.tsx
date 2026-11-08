import { useMemo } from 'react';
import { designTokens } from '../../../design/tokens.ts';
import { RECORDED_NOT_YET_TEXT } from '../../data';
import { Chart, chartSeriesColors, type ChartProps } from '../../ui/Chart';
import { ActualValue, PlannedValue } from './cells';
import { BILINMIYOR, periodLabel, shortPeriodLabel, trendPoints, type ButceTrendProps, type TrendPoint } from './model';
import './ButceTrend.wide.css';

// Geniş-özel (tablet/masaüstü): seçili bütçe kaleminin aylık plan ve Gerçekleşen çizgisi + yanında tablo. ButcePage bunu
// yalnız lazyWide('butce-egilim', () => import('./butce/ButceTrend.wide')) ile yükler; telefon profili bu modülü ve
// ECharts'ı hiç indirmez. Toplama yok: her nokta o ayın tek gözlemidir. Gerçekleşen anlamı actuals.ts'ten (model
// trendPoints): içinde bulunulan aydan sonraki aylar "Henüz yok" ve grafikte boş; kanıtsız değer tabloda "Kaynakta
// yazılı" notuyla. Grafik tek bilgi kaynağı değildir: değerler aria-describedby ile bağlı tabloda.

type ChartOption = ChartProps['option'];

/** Grafik için sayı (yalnız çizim; metin ve tablo Money ile kesin biçimde yazılır). Bilinmeyen/gelecek → boşluk. */
const plannedNumber = (point: TrendPoint) => (point.planned && !point.plannedUnknown ? Number(point.planned.amount) : null);
const actualNumber = (point: TrendPoint) =>
  !point.actualUnknown && point.recorded?.kind === 'recorded' && point.recorded.money ? Number(point.recorded.money.amount) : null;

// Eksen ve ipucu tr-TR: "25.000", "₺10.700,00" (tabloyla aynı biçim). Boş nokta ipucunda tablodaki adıyla yazılır.
const sayiBicimi = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const paraBicimi = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 });
const plannedGap = (point: TrendPoint | undefined) => (point?.plannedUnknown ? BILINMIYOR : 'Fiyat yok');
const actualGap = (point: TrendPoint | undefined) =>
  point && (point.actualUnknown || (point.recorded?.kind === 'recorded' && !point.recorded.money)) ? BILINMIYOR : RECORDED_NOT_YET_TEXT;
/** ECharts ipucu değeri: sayı → ₺ biçimi; boş → noktanın eksik bilgi adı. */
const valueText = (points: readonly TrendPoint[], gap: (point: TrendPoint | undefined) => string) =>
  (value: unknown, dataIndex: number) => (typeof value === 'number' && Number.isFinite(value) ? paraBicimi.format(value) : gap(points[dataIndex]));

export default function ButceTrend({ observations, periods, label, today }: ButceTrendProps) {
  const points = useMemo(() => trendPoints(observations, periods, label, today), [observations, periods, label, today]);
  const option = useMemo<ChartOption>(() => ({
    xAxis: { type: 'category', data: points.map(point => shortPeriodLabel(point.period)) },
    yAxis: { type: 'value', axisLabel: { formatter: (value: number) => sayiBicimi.format(value) } },
    // ECharts 6 legend'ı varsayılan olarak alta koyar ve x ekseni etiketleriyle çakışır: üstte, ızgara onun altında.
    legend: { show: true, top: 0, left: 'center' },
    grid: { top: designTokens.bosluk8 + designTokens.bosluk2 },
    tooltip: { trigger: 'axis' },
    series: [
      {
        name: 'Planlanan', type: 'line', data: points.map(plannedNumber), connectNulls: false, color: chartSeriesColors.plan,
        tooltip: { valueFormatter: valueText(points, plannedGap) },
      },
      {
        name: 'Gerçekleşen', type: 'line', data: points.map(actualNumber), connectNulls: false, color: chartSeriesColors.gercek,
        tooltip: { valueFormatter: valueText(points, actualGap) },
      },
    ],
  }), [points]);

  return (
    <section className="aile-butce-grafik" aria-label="Aylık eğilim">
      <h2 className="aile-butce-baslik">{label} · aylık eğilim</h2>
      <Chart
        option={option}
        ariaLabel={`"${label}" kaleminin aylara göre planlanan ve gerçekleşen tutarı; değerler yanındaki tabloda`}
        description={
          <table className="aile-butce-egilim">
            <caption>{label} · aylık plan ve gerçek</caption>
            <thead>
              <tr><th scope="col">Ay</th><th scope="col" className="aile-butce-sag">Planlanan</th><th scope="col" className="aile-butce-sag">Gerçekleşen</th></tr>
            </thead>
            <tbody>
              {points.map(point => (
                <tr key={point.period}>
                  <th scope="row">{periodLabel(point.period)}</th>
                  <td className="aile-butce-sag"><PlannedValue planned={point.planned} unknown={point.plannedUnknown} /></td>
                  <td className="aile-butce-sag"><ActualValue recorded={point.recorded} unknown={point.actualUnknown} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      />
    </section>
  );
}
