import { act, render, screen, within } from '@testing-library/react';
import type { EChartsOption } from 'echarts';
import { designTokens } from '../../design/tokens.ts';
import { Chart } from './Chart';

// Chart: ECharts sarmalayıcısı. Tasarımda ayrı bir Chart bileşeni yok; referans Raporlar sayfasındaki plan/gerçek
// çubukları (bundle.js Raporlar: role="img" + aria-label "…; değerler aşağıdaki listede", legend 16×12 swatch,
// plan acik-mavi / gerçek eylem, tablo yanında). Kurallar README: 14 px alt sınır, tek 240 ms hareket, reduced-motion'da
// anlık, renk tek işaret değil, grafik tek bilgi kaynağı değil. Seçiciler role/label ile; echarts mock'lanır.

const mocks = vi.hoisted(() => {
  const setOption = vi.fn();
  const resize = vi.fn();
  const dispose = vi.fn();
  const init = vi.fn(() => ({ setOption, resize, dispose }));
  const use = vi.fn();
  const registerTheme = vi.fn();
  return { setOption, resize, dispose, init, use, registerTheme };
});
vi.mock('echarts/core', () => ({ init: mocks.init, use: mocks.use, registerTheme: mocks.registerTheme }));
vi.mock('echarts/charts', () => ({ BarChart: { id: 'BarChart' }, LineChart: { id: 'LineChart' } }));
vi.mock('echarts/components', () => ({ GridComponent: { id: 'GridComponent' }, TooltipComponent: { id: 'TooltipComponent' }, LegendComponent: { id: 'LegendComponent' } }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: { id: 'CanvasRenderer' } }));

const ETIKET = 'Aylara göre planlanan ve gerçekleşen gider; değerler yanındaki tabloda';
const option: EChartsOption = {
  xAxis: { type: 'category', data: ['Eyl', 'Eki', 'Kas'] },
  yAxis: { type: 'value' },
  series: [
    { name: 'Planlanan', type: 'bar', data: [72400, 70900, 68920] },
    { name: 'Gerçekleşen', type: 'bar', data: [70180, 69320, 45227.37] },
  ],
};

function Aciklama() {
  return (
    <table>
      <caption>Aylık plan ve gerçek</caption>
      <thead><tr><th scope="col">Ay</th><th scope="col">Planlanan</th><th scope="col">Gerçekleşen</th></tr></thead>
      <tbody><tr><th scope="row">Kas 2026</th><td>₺68.920,00</td><td>₺45.227,37</td></tr></tbody>
    </table>
  );
}

/** Son setOption çağrısının birinci argümanı. */
function sonOption(): Record<string, unknown> {
  const call = mocks.setOption.mock.calls.at(-1);
  if (!call) throw new Error('setOption çağrılmadı');
  return call[0] as Record<string, unknown>;
}

/** Nesnedeki her fontSize değerini toplar (iç içe). */
function fontSizes(node: unknown, out: number[] = []): number[] {
  if (Array.isArray(node)) { node.forEach(item => fontSizes(item, out)); return out; }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'fontSize' && typeof value === 'number') out.push(value);
      else fontSizes(value, out);
    }
  }
  return out;
}

const reducedQuery = '(prefers-reduced-motion: reduce)';
function mockMatchMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({
    matches: media === reducedQuery ? reduced : false,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;
const originalResizeObserver = window.ResizeObserver;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  window.ResizeObserver = originalResizeObserver;
  vi.clearAllMocks();
});

/** React.lazy modül başına bir kez çözülür; yükleme evresini görmek isteyen test taze modül alır. */
async function freshChart(): Promise<typeof Chart> {
  vi.resetModules();
  const module = await import('./Chart');
  return module.Chart;
}

describe('Chart — yükleme ve erişilebilirlik', () => {
  it('ECharts gelmeden bekleme durumunu ve açıklamayı gösterir; sonra role=img + aria-label çizer', async () => {
    const FreshChart = await freshChart();
    render(<FreshChart option={option} ariaLabel={ETIKET} description="Değerler yandaki tabloda." />);
    // Açıklama hemen vardır: grafik tek bilgi kaynağı değildir. Beklerken role=status, img henüz yok.
    expect(screen.getByText('Değerler yandaki tabloda.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Grafik hazırlanıyor');
    expect(screen.queryByRole('img')).toBeNull();
    const img = await screen.findByRole('img', { name: ETIKET });
    expect(img).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    // Açıklama img'nin dışında (role=img çocuklarını gizler) ve aria-describedby ile bağlı.
    const aciklama = screen.getByText('Değerler yandaki tabloda.');
    expect(img.contains(aciklama)).toBe(false);
    expect(aciklama).toHaveAttribute('id');
    expect(img).toHaveAttribute('aria-describedby', aciklama.getAttribute('id'));
  });

  it('bekleme durumu role=status taşır, 14 px sınıfı ve grafik yüksekliğini alır (yerleşim kaymaz)', async () => {
    const FreshChart = await freshChart();
    render(<FreshChart option={option} height={240} ariaLabel={ETIKET} description="Değerler yandaki tabloda." />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Grafik hazırlanıyor');
    expect(status).toHaveClass('aile-kucuk');
    expect(status.style.getPropertyValue('--aile-chart-yukseklik')).toBe('240px');
    await screen.findByRole('img', { name: ETIKET });
  });

  it('açıklama olarak tablo verilebilir; tablo erişilebilir kalır', async () => {
    render(<Chart option={option} ariaLabel={ETIKET} description={<Aciklama />} />);
    await screen.findByRole('img', { name: ETIKET });
    const table = screen.getByRole('table', { name: 'Aylık plan ve gerçek' });
    expect(within(table).getByRole('row', { name: /Kas 2026/ })).toHaveTextContent('₺68.920,00₺45.227,37');
  });

  it('yükseklik CSS değişkeniyle verilir; varsayılan pozitif, prop ile değişir', async () => {
    const { unmount } = render(<Chart option={option} ariaLabel={ETIKET} description="Açıklama" />);
    const img = await screen.findByRole('img', { name: ETIKET });
    expect(img.style.getPropertyValue('--aile-chart-yukseklik')).toMatch(/^\d+px$/);
    unmount();
    render(<Chart option={option} height={320} ariaLabel={ETIKET} description="Açıklama" />);
    const img2 = await screen.findByRole('img', { name: ETIKET });
    expect(img2.style.getPropertyValue('--aile-chart-yukseklik')).toBe('320px');
  });
});

describe('Chart — ECharts bağlama', () => {
  it('gerekli modülleri kaydeder, aile temasını tokenlarla tanımlar ve canvas ile init eder', async () => {
    const FreshChart = await freshChart();
    render(<FreshChart option={option} ariaLabel={ETIKET} description="Açıklama" />);
    const img = await screen.findByRole('img', { name: ETIKET });
    expect(mocks.use).toHaveBeenCalledWith(expect.arrayContaining([
      { id: 'BarChart' }, { id: 'LineChart' }, { id: 'GridComponent' }, { id: 'TooltipComponent' }, { id: 'LegendComponent' }, { id: 'CanvasRenderer' },
    ]));
    expect(mocks.registerTheme).toHaveBeenCalledWith('aile', expect.objectContaining({
      color: [designTokens.eylem, designTokens.acikMavi, designTokens.olumlu, designTokens.uyari, designTokens.hata, designTokens.metinIkincil],
      textStyle: expect.objectContaining({ fontFamily: designTokens.fontSans, color: designTokens.metin }),
      tooltip: expect.objectContaining({ textStyle: expect.objectContaining({ fontSize: 14 }), backgroundColor: designTokens.yuzey, borderColor: designTokens.cizgi }),
    }));
    // Tema metinleri 14 px altına inmez.
    const theme = mocks.registerTheme.mock.calls[0]![1];
    const sizes = fontSizes(theme);
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    // init: img içindeki tuval kabı, 'aile' teması, canvas.
    expect(mocks.init).toHaveBeenCalledTimes(1);
    const [dom, themeName, opts] = mocks.init.mock.calls[0] as unknown as [HTMLElement, string, { renderer: string }];
    expect(img.contains(dom)).toBe(true);
    expect(themeName).toBe('aile');
    expect(opts).toEqual({ renderer: 'canvas' });
  });

  it('option’u seri/eksenleriyle setOption’a geçirir; hareket 240 ms tek eğri ile açıktır', async () => {
    render(<Chart option={option} ariaLabel={ETIKET} description="Açıklama" />);
    await screen.findByRole('img', { name: ETIKET });
    expect(mocks.setOption).toHaveBeenCalled();
    const passed = sonOption();
    expect(passed.series).toEqual(option.series);
    expect(passed.xAxis).toEqual(option.xAxis);
    expect(passed.animation).toBe(true);
    expect(passed.animationDuration).toBe(designTokens.sure);
    expect(passed.animationDurationUpdate).toBe(designTokens.sure);
    expect(typeof passed.animationEasing).toBe('function');
    expect(passed.animationEasingUpdate).toBe(passed.animationEasing);
    // Tek kaynak: eski seriler kalmaz.
    expect(mocks.setOption.mock.calls.at(-1)![1]).toEqual(expect.objectContaining({ notMerge: true }));
  });

  it('prefers-reduced-motion açıkken animation false olur', async () => {
    mockMatchMedia(true);
    render(<Chart option={option} ariaLabel={ETIKET} description="Açıklama" />);
    await screen.findByRole('img', { name: ETIKET });
    expect(sonOption().animation).toBe(false);
  });

  it('option değişince yeniden setOption çağırır; init tekrarlanmaz', async () => {
    const { rerender } = render(<Chart option={option} ariaLabel={ETIKET} description="Açıklama" />);
    await screen.findByRole('img', { name: ETIKET });
    const before = mocks.setOption.mock.calls.length;
    const next: EChartsOption = { ...option, series: [{ name: 'Gerçekleşen', type: 'line', data: [1, 2, 3] }] };
    rerender(<Chart option={next} ariaLabel={ETIKET} description="Açıklama" />);
    expect(mocks.setOption.mock.calls.length).toBe(before + 1);
    expect(sonOption().series).toEqual(next.series);
    expect(mocks.init).toHaveBeenCalledTimes(1);
  });

  it('kapsayıcı yeniden boyutlanınca resize, unmount’ta disconnect ve dispose çağrılır', async () => {
    let callback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) { callback = cb; }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    const { unmount } = render(<Chart option={option} ariaLabel={ETIKET} description="Açıklama" />);
    const img = await screen.findByRole('img', { name: ETIKET });
    const [dom] = mocks.init.mock.calls[0] as unknown as [HTMLElement];
    expect(observe).toHaveBeenCalledWith(dom);
    expect(img.contains(dom)).toBe(true);
    act(() => { callback?.([], {} as ResizeObserver); });
    expect(mocks.resize).toHaveBeenCalledTimes(1);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('Chart — yükleme hatası', () => {
  it('ECharts yüklenemezse "Hata:" ile başlayan ileti verir, açıklama kalır', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
    vi.doMock('echarts/renderers', () => { throw new Error('ağ yok'); });
    const { Chart: FreshChart } = await import('./Chart');
    render(<FreshChart option={option} ariaLabel={ETIKET} description="Değerler yandaki tabloda." />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/^Hata: /);
    expect(alert).toHaveTextContent('Grafik yüklenemedi');
    expect(screen.getByText('Değerler yandaki tabloda.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    vi.doUnmock('echarts/renderers');
    vi.resetModules();
    vi.restoreAllMocks();
  });
});
