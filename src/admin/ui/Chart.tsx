import { Component, lazy, Suspense, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { EChartsOption } from 'echarts';
import type { EChartsType } from 'echarts/core';
import { chartMotion, designTokens, tokens } from '../../design/tokens.ts';
import './Chart.css';

// Chart: ECharts sarmalayıcısı; ham 'echarts' importu yalnız bu dosyada (ui/ sınırı). Tasarım tesliminde ayrı bir
// Chart bileşeni yok; referans Raporlar sayfasının plan/gerçek çubukları (bundle.js Raporlar + bundle.css .pg-bars):
// role="img" + aria-label ("…; değerler aşağıdaki listede"), legend 16×12 swatch, plan acik-mavi / gerçek eylem,
// değerler yanındaki tabloda. Buradaki kurallar:
//  - Grafik tek bilgi kaynağı değildir: `description` zorunludur (metin ya da tablo), img'nin DIŞINDA durur
//    (role=img çocuklarını erişilebilirlik ağacından gizler) ve aria-describedby ile bağlanır.
//  - ECharts çekirdeği + Bar/Line + Grid/Tooltip/Legend + Canvas tembel yüklenir (React.lazy); sayfa açılışı
//    echarts indirmez. Beklerken aynı yükseklikte role=status "Grafik hazırlanıyor"; yüklenemezse "Hata: …" ve
//    açıklama kalır (ErrorBoundary).
//  - Renk ve yazı yalnız designTokens'tan, ECharts temasıyla ('aile', registerTheme): palet, 14 px alt sınır
//    (tooltip, eksen, legend), cizgi eksenler, yuzey tooltip. Hareket chartMotion(reducedMotion): 240 ms tek eğri,
//    reduced-motion'da animation false. Kapsayıcı ResizeObserver ile resize, unmount'ta dispose.
//  - Plan ve gerçek ayrı serilerdir; sayfa serileri adlandırır ("Planlanan", "Gerçekleşen") ve renklerini
//    chartSeriesColors ile verir. Renk tek işaret değildir: legend + açıklama sözcükle söyler.

export interface ChartProps {
  /** ECharts option'ı; seriler/eksenler sayfanın. Tema, palet ve hareket burada eklenir (notMerge: tek kaynak). */
  option: EChartsOption;
  /** Tuval yüksekliği (CSS px). Verilmezse tokens.chartTrendHeight. Genişlik kapsayıcıdan. */
  height?: number;
  /** Zorunlu: grafiğin ne gösterdiği ve değerlerin nerede olduğu ("…; değerler yanındaki tabloda"). */
  ariaLabel: string;
  /** Zorunlu görünür alternatif: metin ya da tablo. Grafik tek bilgi kaynağı değildir. */
  description: ReactNode;
  className?: string;
}

// tokens.json › type: kucuk 14 (alt sınır), govde 16. designTokens yazı ölçeğini dışa vermez; değerler README'den.
const YAZI_KUCUK = 14;
const VARSAYILAN_YUKSEKLIK = parseInt(tokens.chartTrendHeight, 10);
const TEMA_ADI = 'aile';
const BEKLEME_METNI = 'Grafik hazırlanıyor';
const HATA_METNI = 'Hata: Grafik yüklenemedi; değerler açıklamada. Sayfayı yenileyin.';

/** Seri paleti sırası; plan/gerçek sayfaları chartSeriesColors kullanır. */
export const CHART_COLORS: readonly string[] = [
  designTokens.eylem, designTokens.acikMavi, designTokens.olumlu, designTokens.uyari, designTokens.hata, designTokens.metinIkincil,
];
/** Tasarım (Raporlar): plan acik-mavi, gerçek eylem; durumlar olumlu/uyari/hata. */
export const chartSeriesColors = {
  plan: designTokens.acikMavi,
  gercek: designTokens.eylem,
  olumlu: designTokens.olumlu,
  uyari: designTokens.uyari,
  hata: designTokens.hata,
  notr: designTokens.metinIkincil,
} as const;

const yaziKucuk = { fontFamily: designTokens.fontSans, fontSize: YAZI_KUCUK, color: designTokens.metin };
const eksenYazi = { ...yaziKucuk, color: designTokens.metinIkincil };

/** ECharts teması: option biçiminde varsayılanlar; yalnız designTokens değerleri. */
export const aileChartTheme = {
  color: [...CHART_COLORS],
  backgroundColor: 'transparent',
  textStyle: yaziKucuk,
  grid: { containLabel: true, left: designTokens.bosluk3, right: designTokens.bosluk4, top: designTokens.bosluk6, bottom: designTokens.bosluk4 },
  categoryAxis: {
    axisLine: { lineStyle: { color: designTokens.cizgi } },
    axisTick: { show: false },
    axisLabel: { ...eksenYazi, hideOverlap: true },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { ...eksenYazi, hideOverlap: true },
    splitLine: { lineStyle: { color: designTokens.cizgi } },
  },
  // Referans legend (bundle.css .pg-sw / .pg-legend): 16×12 swatch (bosluk4 × bosluk3), 24 px aralık, metin 14.
  legend: { icon: 'roundRect', itemWidth: designTokens.bosluk4, itemHeight: designTokens.bosluk3, itemGap: designTokens.bosluk6, textStyle: yaziKucuk },
  tooltip: {
    trigger: 'axis',
    confine: true,
    backgroundColor: designTokens.yuzey,
    borderColor: designTokens.cizgi,
    borderWidth: 1,
    padding: [designTokens.bosluk2, designTokens.bosluk3],
    textStyle: yaziKucuk,
    // Yükseltilmiş yüzey: gölge ve kontrol köşesi tokenlardan.
    extraCssText: `box-shadow:${designTokens.golgeYukseltilmis};border-radius:${designTokens.koseKontrol}px;font-variant-numeric:tabular-nums;`,
  },
  line: { lineStyle: { width: 2 }, symbolSize: 6 },
};

type EChartsCore = Pick<typeof import('echarts/core'), 'init'>;

/** Çekirdek + yalnız gerekli chart/komponent/renderer; tema bir kez kaydedilir. */
async function loadECharts(): Promise<EChartsCore> {
  const [core, charts, components, renderers] = await Promise.all([
    import('echarts/core'), import('echarts/charts'), import('echarts/components'), import('echarts/renderers'),
  ]);
  core.use([charts.BarChart, charts.LineChart, components.GridComponent, components.TooltipComponent, components.LegendComponent, renderers.CanvasRenderer]);
  core.registerTheme(TEMA_ADI, aileChartTheme);
  return core;
}

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(reducedMotionQuery).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(reducedMotionQuery);
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

interface CanvasProps { option: EChartsOption; reduced: boolean; ariaLabel: string; describedBy: string; style: CSSProperties }

function ChartCanvas({ echarts, option, reduced, ariaLabel, describedBy, style }: CanvasProps & { echarts: EChartsCore }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = echarts.init(host, TEMA_ADI, { renderer: 'canvas' });
    chartRef.current = chart;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => chart.resize());
    observer?.observe(host);
    return () => {
      observer?.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [echarts]);

  useEffect(() => {
    // notMerge: option tek kaynaktır; kaldırılan seri tuvalde kalmaz.
    chartRef.current?.setOption({ ...option, ...chartMotion(reduced) }, { notMerge: true });
  }, [option, reduced]);

  return (
    <div className="aile-chart-gorsel" role="img" aria-label={ariaLabel} aria-describedby={describedBy} style={style}>
      <div ref={hostRef} className="aile-chart-tuval" />
    </div>
  );
}

const LazyCanvas = lazy(async () => {
  const echarts = await loadECharts();
  return { default: (props: CanvasProps) => <ChartCanvas {...props} echarts={echarts} /> };
});

class ChartBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function Chart({ option, height = VARSAYILAN_YUKSEKLIK, ariaLabel, description, className }: ChartProps) {
  const reduced = useReducedMotion();
  const descriptionId = useId();
  const yukseklik = Number.isFinite(height) && height > 0 ? height : VARSAYILAN_YUKSEKLIK;
  const style = { '--aile-chart-yukseklik': `${yukseklik}px` } as CSSProperties;
  const classes = ['aile-chart', className].filter(Boolean).join(' ');
  const Aciklama = typeof description === 'string' ? 'p' : 'div';

  return (
    <div className={classes}>
      <ChartBoundary fallback={<p role="alert" className="aile-chart-hata" style={style}>{HATA_METNI}</p>}>
        <Suspense fallback={<p role="status" className="aile-chart-bekleme aile-kucuk" style={style}>{BEKLEME_METNI}</p>}>
          <LazyCanvas option={option} reduced={reduced} ariaLabel={ariaLabel} describedBy={descriptionId} style={style} />
        </Suspense>
      </ChartBoundary>
      <Aciklama id={descriptionId} className="aile-chart-aciklama">{description}</Aciklama>
    </div>
  );
}
