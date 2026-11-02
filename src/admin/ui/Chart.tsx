import {
  Component, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject,
} from 'react';
import type { EChartsOption } from 'echarts';
import type { EChartsType } from 'echarts/core';
import type * as ChartRuntimeModule from './Chart.runtime';
import { chartMotion, designTokens, tokens } from '../../design/tokens.ts';
import { useProfile, useReducedMotion } from '../adaptive';
import { reloadPage } from '../adaptive/reload';
import './Chart.css';

// Chart: ECharts sarmalayıcısı; ham 'echarts' çalışma zamanı yalnız ./Chart.runtime içinde (tek tembel modül, adlandırılmış
// importlar). Tasarım tesliminde ayrı bir Chart bileşeni yok; referans Raporlar sayfasının plan/gerçek çubukları
// (bundle.js Raporlar + bundle.css .pg-bars): role="img" + aria-label ("…; değerler aşağıdaki listede"), legend 16×12
// swatch, plan acik-mavi / gerçek eylem, değerler yanındaki tabloda. Buradaki kurallar:
//  - Grafik tek bilgi kaynağı değildir: `description` zorunludur (metin ya da tablo), img'nin DIŞINDA durur
//    (role=img çocuklarını erişilebilirlik ağacından gizler) ve aria-describedby ile bağlanır.
//  - Uyarlamalı teslim: telefon profili ECharts istemez. Açıklama (tablo/özet) görünür; "Grafiği göster" ayrıntı düğmesi
//    (APG disclosure: aria-expanded + aria-controls) kullanıcı isteyince çalışma zamanını o anda yükler. Geniş profilde
//    yuva görünür alana girince (IntersectionObserver; yoksa hemen) yüklenir. Sayfa açılışı echarts indirmez.
//  - Beklerken aynı yükseklikte role=status "Grafik hazırlanıyor" (aria-busy yok: görünür alana hiç girmeyen grafik
//    sayfayı meşgul bırakmaz). Yüklenemezse "Hata: …" + "Yeniden dene"; yeniden deneme de düşerse "Sayfayı yenile"
//    (tarayıcı başarısız dinamik importu önbellekleyebilir; yeni sürümde eski parça adı da yok olabilir). Odak kaybolmaz.
//  - Renk ve yazı yalnız designTokens'tan, ECharts temasıyla ('aile', registerTheme): palet, 14 px alt sınır (tooltip,
//    eksen, legend; sayfa option'ındaki 14 altı fontSize da 14'e yükseltilir), cizgi eksenler, yuzey tooltip. Hareket
//    chartMotion(reducedMotion): 240 ms tek eğri, reduced-motion'da animation false. Kapsayıcı ResizeObserver ile resize,
//    unmount'ta dispose.
//  - Plan ve gerçek ayrı serilerdir; sayfa serileri adlandırır ("Planlanan", "Gerçekleşen") ve renklerini
//    chartSeriesColors ile verir. Renk tek işaret değildir: legend + açıklama sözcükle söyler.

export interface ChartProps {
  /** ECharts option'ı; seriler/eksenler sayfanın. Tema, palet ve hareket burada eklenir (notMerge: tek kaynak). */
  option: EChartsOption;
  /** Tuval yüksekliği (CSS px). Verilmezse tokens.chartTrendHeight. Genişlik kapsayıcıdan. */
  height?: number;
  /** Zorunlu: grafiğin ne gösterdiği ve değerlerin nerede olduğu ("…; değerler yanındaki tabloda"). */
  ariaLabel: string;
  /** Zorunlu görünür alternatif: metin ya da tablo. Grafik tek bilgi kaynağı değildir; telefonda varsayılan sunumdur. */
  description: ReactNode;
  className?: string;
}

// tokens.json › type: kucuk 14 (alt sınır), govde 16. designTokens yazı ölçeğini dışa vermez; değerler README'den.
const YAZI_KUCUK = 14;
const VARSAYILAN_YUKSEKLIK = parseInt(tokens.chartTrendHeight, 10);
const TEMA_ADI = 'aile';
const BEKLEME_METNI = 'Grafik hazırlanıyor';
const HATA_METNI = 'Hata: Grafik yüklenemedi; değerler aşağıda.';
const CIZIM_HATA_METNI = 'Hata: Grafik çizilemedi; değerler aşağıda.';
const GOSTER = 'Grafiği göster';
const GIZLE = 'Grafiği gizle';
const YENIDEN_DENE = 'Yeniden dene';
const SAYFAYI_YENILE = 'Sayfayı yenile';

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
/** Değer ekseni etiketi tr-TR: 25.000 ve 1.234.567,5 (ECharts varsayılanı en-US "25,000"). Sayfa option'ı geçersiz kılabilir. */
const eksenSayisi = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

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
    axisLabel: { ...eksenYazi, hideOverlap: true, formatter: (value: number) => eksenSayisi.format(value) },
    splitLine: { lineStyle: { color: designTokens.cizgi } },
  },
  // Referans legend (bundle.css .pg-sw / .pg-legend): 16×12 swatch (bosluk4 × bosluk3), 24 px aralık, metin 14. Üstte:
  // ECharts 6 varsayılanı alttır ve kategori ekseni etiketleriyle çakışır; grid.top altında ona yer bırakır.
  legend: { top: 0, icon: 'roundRect', itemWidth: designTokens.bosluk4, itemHeight: designTokens.bosluk3, itemGap: designTokens.bosluk6, textStyle: yaziKucuk },
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

// --- Yazı alt sınırı: sayfa option'ındaki 14 px altı fontSize 14'e yükseltilir (eksen, legend, tooltip, etiket). -------
const PIKSEL = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/;
function tabanBoyut(size: unknown): unknown {
  const px = typeof size === 'number' ? size : typeof size === 'string' && PIKSEL.test(size) ? Number.parseFloat(size) : Number.NaN;
  return Number.isFinite(px) && px < YAZI_KUCUK ? YAZI_KUCUK : size;
}
const duzNesne = (value: object) => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
/** Yalnız düz nesne/dizi kopyalanır; işlevler (formatter), tarih ve tipli diziler olduğu gibi kalır. */
function yaziTabani<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => yaziTabani(item)) as T;
  if (value && typeof value === 'object' && duzNesne(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = key === 'fontSize' ? tabanBoyut(item) : yaziTabani(item);
    return out as T;
  }
  return value;
}

// --- Tembel çalışma zamanı: tüm Chart örnekleri tek yüklemeyi ve tek durumu paylaşır. ---------------------------------
type ChartRuntime = Pick<typeof ChartRuntimeModule, 'init' | 'registerTheme'>;
type RuntimeState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'ready'; readonly runtime: ChartRuntime }
  | { readonly status: 'error'; readonly error: unknown; readonly failures: number };

const IDLE: RuntimeState = Object.freeze({ status: 'idle' });
const LOADING: RuntimeState = Object.freeze({ status: 'loading' });

const runtimeStore = (() => {
  let state: RuntimeState = IDLE;
  let failures = 0;
  const listeners = new Set<() => void>();
  const set = (next: RuntimeState) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const store = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getState: () => state,
    /** Boştaysa tek yükleme başlatır; uçuştaki ya da hazır duruma dokunmaz, hata durumunda kendiliğinden yeniden denemez. */
    load() {
      if (state.status !== 'idle') return;
      set(LOADING);
      import('./Chart.runtime')
        .then(runtime => {
          runtime.registerTheme(TEMA_ADI, aileChartTheme);
          return runtime;
        })
        .then(
          runtime => { failures = 0; set({ status: 'ready', runtime }); },
          (error: unknown) => { failures += 1; set({ status: 'error', error, failures }); },
        );
    },
    retry() {
      if (state.status !== 'error') return;
      set(IDLE);
      store.load();
    },
  };
  return store;
})();

function useChartRuntime(enabled: boolean): RuntimeState {
  const state = useSyncExternalStore(runtimeStore.subscribe, runtimeStore.getState, runtimeStore.getState);
  const status = state.status;
  useEffect(() => {
    if (enabled && status === 'idle') runtimeStore.load();
  }, [enabled, status]);
  return state;
}

/** Yuva görünür alana girdi mi; IntersectionObserver yoksa hemen true. active=false iken gözlem yok. Bir kez true olur. */
function useInView(ref: RefObject<HTMLElement | null>, active: boolean): boolean {
  const supported = typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function';
  const [inView, setInView] = useState(!supported);
  useEffect(() => {
    if (!active || inView) return;
    const node = ref.current;
    if (!node || typeof window.IntersectionObserver !== 'function') { setInView(true); return; }
    const observer = new window.IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      setInView(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, inView, ref]);
  return inView;
}

interface CanvasProps { runtime: ChartRuntime; option: EChartsOption; reduced: boolean; ariaLabel: string; describedBy: string; style: CSSProperties }

function ChartCanvas({ runtime, option, reduced, ariaLabel, describedBy, style }: CanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = runtime.init(host, TEMA_ADI, { renderer: 'canvas' });
    chartRef.current = chart;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => chart.resize());
    observer?.observe(host);
    return () => {
      observer?.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [runtime]);

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

class ChartBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function Chart({ option, height = VARSAYILAN_YUKSEKLIK, ariaLabel, description, className }: ChartProps) {
  const telefon = useProfile() === 'phone';
  const reduced = useReducedMotion();
  const descriptionId = useId();
  const slotId = useId();
  const slotRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const focusAfterRetry = useRef(false);
  const [acik, setAcik] = useState(false);
  const inView = useInView(slotRef, !telefon);
  const goster = telefon ? acik : true;
  const state = useChartRuntime(telefon ? acik : inView);
  const guarded = useMemo(() => yaziTabani(option), [option]);

  const yukseklik = Number.isFinite(height) && height > 0 ? height : VARSAYILAN_YUKSEKLIK;
  const style = { '--aile-chart-yukseklik': `${yukseklik}px` } as CSSProperties;
  const classes = ['aile-chart', className].filter(Boolean).join(' ');
  const Aciklama = typeof description === 'string' ? 'p' : 'div';
  const status = state.status;

  // Odak dönüşü: "Yeniden dene" kalkınca odak gövdeye düşmez. Telefonda ayrıntı düğmesine, genişte grafik yuvasına
  // taşınır; yeniden deneme de düşerse (ve odak hâlâ oradaysa) yeni eyleme ("Sayfayı yenile") geçer.
  useEffect(() => {
    if (!focusAfterRetry.current) return;
    const target = telefon ? toggleRef.current : slotRef.current;
    if (status === 'loading' || status === 'ready') {
      target?.focus();
      if (status === 'ready') focusAfterRetry.current = false;
      return;
    }
    if (status === 'error') {
      focusAfterRetry.current = false;
      const active = document.activeElement;
      if (active === target || active === document.body || active === null) actionRef.current?.focus();
    }
  }, [status, telefon]);

  const yeniden = () => {
    if (state.status !== 'error') return;
    if (state.failures >= 2) { reloadPage(); return; }
    focusAfterRetry.current = true;
    runtimeStore.retry();
  };

  let icerik: ReactNode = null;
  if (goster) {
    if (state.status === 'ready') {
      icerik = (
        <ChartBoundary fallback={<p role="alert" className="aile-chart-hata-metin aile-chart-hata" style={style}>{CIZIM_HATA_METNI}</p>}>
          <ChartCanvas runtime={state.runtime} option={guarded} reduced={reduced} ariaLabel={ariaLabel} describedBy={descriptionId} style={style} />
        </ChartBoundary>
      );
    } else if (state.status === 'error') {
      icerik = (
        <div className="aile-chart-hata" style={style}>
          <p role="alert" className="aile-chart-hata-metin">{HATA_METNI}</p>
          <button ref={actionRef} type="button" className="aile-chart-dugme" data-focus-line="" onClick={yeniden}>
            {state.failures >= 2 ? SAYFAYI_YENILE : YENIDEN_DENE}
          </button>
        </div>
      );
    } else {
      icerik = <p role="status" className="aile-chart-bekleme aile-kucuk" style={style}>{BEKLEME_METNI}</p>;
    }
  }

  return (
    <div className={classes}>
      {telefon && (
        <button
          ref={toggleRef}
          type="button"
          className="aile-chart-dugme aile-chart-ac"
          aria-expanded={acik}
          aria-controls={slotId}
          data-focus-line=""
          onClick={() => setAcik(value => !value)}
        >
          {acik ? GIZLE : GOSTER}
        </button>
      )}
      <div id={slotId} ref={slotRef} className="aile-chart-yuva" hidden={!goster} tabIndex={-1} data-focus-line="">
        {icerik}
      </div>
      <Aciklama id={descriptionId} className="aile-chart-aciklama">{description}</Aciklama>
    </div>
  );
}
