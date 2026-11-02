import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EChartsOption } from 'echarts';
import { designTokens } from '../../design/tokens.ts';
import { installViewport, type ViewportSpec } from '../adaptive/testing';
import { importsOf, stripComments } from '../adaptive/sourceRules';
import { Chart } from './Chart';

// Chart: ECharts sarmalayıcısı. Tasarımda ayrı bir Chart bileşeni yok; referans Raporlar sayfasındaki plan/gerçek
// çubukları (bundle.js Raporlar: role="img" + aria-label "…; değerler aşağıdaki listede", legend 16×12 swatch,
// plan acik-mavi / gerçek eylem, tablo yanında). Kurallar README: 14 px alt sınır, tek 240 ms hareket, reduced-motion'da
// anlık, renk tek işaret değil, grafik tek bilgi kaynağı değil.
// Uyarlamalı teslim (W0): telefon profili ECharts istemez; açıklama (tablo/özet) görünür ve kullanıcı "Grafiği göster"
// derse çalışma zamanı o anda yüklenir. Geniş profilde grafik görünür alana girince (IntersectionObserver) yüklenir.
// ECharts tek tembel modülden (Chart.runtime.ts, adlandırılmış importlar) gelir. Seçiciler role/label ile; echarts mock'lanır.

const mocks = vi.hoisted(() => {
  const setOption = vi.fn();
  const resize = vi.fn();
  const dispose = vi.fn();
  const init = vi.fn(() => ({ setOption, resize, dispose }));
  const use = vi.fn();
  const registerTheme = vi.fn();
  const reloadPage = vi.fn();
  return { setOption, resize, dispose, init, use, registerTheme, reloadPage };
});
vi.mock('echarts/core', () => ({ init: mocks.init, use: mocks.use, registerTheme: mocks.registerTheme }));
vi.mock('echarts/charts', () => ({ BarChart: { id: 'BarChart' }, LineChart: { id: 'LineChart' } }));
vi.mock('echarts/components', () => ({ GridComponent: { id: 'GridComponent' }, TooltipComponent: { id: 'TooltipComponent' }, LegendComponent: { id: 'LegendComponent' } }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: { id: 'CanvasRenderer' } }));
vi.mock('../adaptive/reload', () => ({ reloadPage: mocks.reloadPage }));

const here = dirname(new URL(import.meta.url).pathname);
const read = (name: string) => readFileSync(resolve(here, name), 'utf8');

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

// Profil matchMedia ile (adaptive/testing): bağlam nesnesine bağlı kalmaz, vi.resetModules sonrası taze modülde de geçer.
const PHONE: ViewportSpec = { width: 320, height: 568, coarse: true };
const DESKTOP: ViewportSpec = { width: 1440, height: 900, fine: true, hover: true };

const originalMatchMedia = window.matchMedia;
const originalResizeObserver = window.ResizeObserver;
const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;
beforeEach(() => { installViewport(DESKTOP); });
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  window.ResizeObserver = originalResizeObserver;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalInnerWidth });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: originalInnerHeight });
  delete (window as { IntersectionObserver?: unknown }).IntersectionObserver;
  vi.clearAllMocks();
});

/** Çalışma zamanı deposu ve React.lazy modül başına bir kez çözülür; yükleme evresini görmek isteyen test taze modül alır. */
async function freshChart(): Promise<typeof Chart> {
  vi.resetModules();
  const module = await import('./Chart');
  return module.Chart;
}

/** Bir mikro görev turu + React güncellemesi: "yüklenmedi" iddiası boş bir anı değil, bekleyen sözleri de kapsar. */
async function flush() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

describe('Chart — kaynak kuralları (telefon statik kapanışı)', () => {
  const antdSurface = (specifier: string) => /^(antd|@ant-design)(\/|$)/.test(specifier) || /(^|\/)antd(\.tsx?)?$/.test(specifier) || /(^|\/)antdTheme(\.tsx?)?$/.test(specifier);

  /** Göreli statik (tür-yalnız olmayan) importları dosyaya çözer; kapanıştaki her paket belirtecini döner. */
  function staticClosure(entry: string): { files: string[]; packages: string[] } {
    const files: string[] = [];
    const packages = new Set<string>();
    const queue = [resolve(here, entry)];
    while (queue.length) {
      const file = queue.shift()!;
      if (files.includes(file)) continue;
      files.push(file);
      for (const ref of importsOf(readFileSync(file, 'utf8'))) {
        if (ref.kind !== 'static' || ref.typeOnly) continue;
        if (!ref.specifier.startsWith('.')) { packages.add(ref.specifier); continue; }
        if (/\.css$/.test(ref.specifier)) continue;
        const base = resolve(dirname(file), ref.specifier);
        const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(path => /\.tsx?$/.test(path) && existsSync(path));
        if (!target) throw new Error(`${file}: ${ref.specifier} çözülemedi`);
        queue.push(target);
      }
    }
    return { files, packages: [...packages] };
  }

  it('Chart.tsx ve statik kapanışı antd, @ant-design, ./antd, antdTheme ya da echarts içe aktarmaz', () => {
    const { files, packages } = staticClosure('Chart.tsx');
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      const offenders = importsOf(readFileSync(file, 'utf8')).filter(ref => ref.kind === 'static' && !ref.typeOnly && antdSurface(ref.specifier));
      expect(offenders, file).toEqual([]);
    }
    expect(packages.filter(pkg => /^(antd|@ant-design|echarts|zrender)(\/|$)/.test(pkg))).toEqual([]);
  });

  it('ECharts yalnız tek tembel modülden gelir: Chart.tsx yalnız import("./Chart.runtime") yapar, barrel import() yok', () => {
    const refs = importsOf(read('Chart.tsx'));
    expect(refs.filter(ref => ref.kind === 'dynamic').map(ref => ref.specifier)).toEqual(['./Chart.runtime']);
    expect(refs.filter(ref => ref.kind === 'static' && !ref.typeOnly && /^echarts/.test(ref.specifier))).toEqual([]);
  });

  it('Chart.runtime.ts adlandırılmış importlarla yalnız Bar/Line, Grid/Tooltip/Legend ve Canvas kaydeder', () => {
    const source = stripComments(read('Chart.runtime.ts'));
    const refs = importsOf(source);
    expect(refs.every(ref => ref.kind === 'static')).toBe(true);
    expect(refs.map(ref => ref.specifier).sort()).toEqual(['echarts/charts', 'echarts/components', 'echarts/core', 'echarts/renderers']);
    expect(source).not.toMatch(/import\s*\*/);
    expect(source).toMatch(/import\s*\{\s*BarChart\s*,\s*LineChart\s*\}\s*from\s*'echarts\/charts'/);
    expect(source).toMatch(/import\s*\{\s*GridComponent\s*,\s*LegendComponent\s*,\s*TooltipComponent\s*\}\s*from\s*'echarts\/components'/);
    expect(source).toMatch(/import\s*\{\s*CanvasRenderer\s*\}\s*from\s*'echarts\/renderers'/);
    expect(source).toMatch(/\buse\(\s*\[/);
  });

  it('stil yalnız tokenlarla: sabit renk yok, çevreleyen odak halkası yok, metin ≥14 px, dokunma 44/48 px, reduced-motion', () => {
    const css = read('Chart.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/outline\s*:\s*(?!none)/);
    expect(css).not.toMatch(/:focus[^{]*\{[^}]*box-shadow/);
    const sizes = [...css.matchAll(/font-size\s*:\s*([\d.]+)px/g)].map(match => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    expect(css).not.toMatch(/font-size\s*:\s*[\d.]+(rem|em|%)/);
    // Dokunma hedefi: 44 px (hedef-asgari), kaba işaretçide 48 px (44 + bosluk-1).
    expect(css).toMatch(/\.aile-chart-dugme\s*\{[^}]*min-block-size\s*:\s*var\(--aile-hedef-asgari\)/);
    expect(css).toMatch(/\[data-input-coarse\][^{]*\.aile-chart-dugme[^{]*\{[^}]*min-block-size\s*:\s*calc\(var\(--aile-hedef-asgari\)\s*\+\s*var\(--aile-bosluk-1\)\)/);
    // Hareket tek süre/eğri; reduced-motion'da geçiş yok (durum anında).
    expect(css).toMatch(/transition[^;]*var\(--aile-sure\)\s+var\(--aile-egri\)/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^@]*\.aile-chart-dugme[^}]*transition-duration\s*:\s*0s/);
  });
});

describe('Chart — geniş profil: yükleme ve erişilebilirlik', () => {
  it('ECharts gelmeden bekleme durumunu ve açıklamayı gösterir; sonra role=img + aria-label çizer', async () => {
    const FreshChart = await freshChart();
    render(<FreshChart option={option} ariaLabel={ETIKET} description="Değerler yandaki tabloda." />);
    // Açıklama hemen vardır: grafik tek bilgi kaynağı değildir. Beklerken role=status, img henüz yok.
    expect(screen.getByText('Değerler yandaki tabloda.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Grafik hazırlanıyor');
    expect(screen.queryByRole('img')).toBeNull();
    // Genişte açma düğmesi yoktur.
    expect(screen.queryByRole('button', { name: 'Grafiği göster' })).toBeNull();
    const img = await screen.findByRole('img', { name: ETIKET });
    expect(img).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    // Açıklama img'nin dışında (role=img çocuklarını gizler) ve aria-describedby ile bağlı.
    const aciklama = screen.getByText('Değerler yandaki tabloda.');
    expect(img.contains(aciklama)).toBe(false);
    expect(aciklama).toHaveAttribute('id');
    expect(img).toHaveAttribute('aria-describedby', aciklama.getAttribute('id'));
  });

  it('bekleme durumu role=status taşır, 14 px sınıfı ve grafik yüksekliğini alır (yerleşim kaymaz); aria-busy yok', async () => {
    const FreshChart = await freshChart();
    render(<FreshChart option={option} height={240} ariaLabel={ETIKET} description="Değerler yandaki tabloda." />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Grafik hazırlanıyor');
    expect(status).toHaveClass('aile-kucuk');
    expect(status.style.getPropertyValue('--aile-chart-yukseklik')).toBe('240px');
    // openAdmin hazır sinyali aria-busy bekler; görünür alana hiç girmeyen grafik sayfayı "meşgul" bırakmamalı.
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
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

  it('IntersectionObserver varken görünür alana girmeden yüklemez; girince yükler ve gözlemi bırakır', async () => {
    const observers: { callback: IntersectionObserverCallback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    class FakeIntersectionObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = () => [];
      constructor(callback: IntersectionObserverCallback) { observers.push({ callback, observe: this.observe, disconnect: this.disconnect }); }
    }
    (window as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
    const FreshChart = await freshChart();
    render(<FreshChart option={option} ariaLabel={ETIKET} description="Açıklama" />);
    await flush();
    expect(mocks.use).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Grafik hazırlanıyor');
    expect(observers).toHaveLength(1);
    const [target] = observers[0]!.observe.mock.calls[0] as [Element];
    expect(target).toContainElement(screen.getByRole('status'));
    // Görünmeyen giriş yükleme başlatmaz.
    act(() => { observers[0]!.callback([{ isIntersecting: false, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });
    await flush();
    expect(mocks.use).not.toHaveBeenCalled();
    act(() => { observers[0]!.callback([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });
    expect(await screen.findByRole('img', { name: ETIKET })).toBeInTheDocument();
    expect(mocks.use).toHaveBeenCalledTimes(1);
    expect(observers[0]!.disconnect).toHaveBeenCalled();
  });
});

describe('Chart — telefon profili: ECharts yalnız kullanıcı isteyince', () => {
  beforeEach(() => { installViewport(PHONE); });

  it('açıklama görünür, "Grafiği göster" kapalı ayrıntı düğmesidir; ECharts indirilmez', async () => {
    const FreshChart = await freshChart();
    render(<FreshChart option={option} ariaLabel={ETIKET} description={<Aciklama />} />);
    await flush();
    expect(screen.getByRole('table', { name: 'Aylık plan ve gerçek' })).toBeVisible();
    const toggle = screen.getByRole('button', { name: 'Grafiği göster' });
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('data-focus-line');
    const region = document.getElementById(toggle.getAttribute('aria-controls')!);
    expect(region).not.toBeNull();
    expect(region).not.toBeVisible();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(mocks.use).not.toHaveBeenCalled();
    expect(mocks.registerTheme).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('dokununca yükler: bekleme durumu, sonra role=img; düğme "Grafiği gizle" ve aria-expanded=true; odak düğmede kalır', async () => {
    const user = userEvent.setup();
    const FreshChart = await freshChart();
    render(<FreshChart option={option} ariaLabel={ETIKET} description={<Aciklama />} />);
    const toggle = screen.getByRole('button', { name: 'Grafiği göster' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('Grafiği gizle');
    const img = await screen.findByRole('img', { name: ETIKET });
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(img);
    expect(mocks.use).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveFocus();
    // Açıklama yerinde kalır (grafik tek bilgi kaynağı değil) ve img ile bağlıdır.
    const table = screen.getByRole('table', { name: 'Aylık plan ve gerçek' });
    expect(document.getElementById(img.getAttribute('aria-describedby')!)).toContainElement(table);
    // Gizle: tuval kalkar, ECharts örneği bırakılır; yeniden göster yeniden indirmez.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('img')).toBeNull();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    await user.click(toggle);
    expect(await screen.findByRole('img', { name: ETIKET })).toBeInTheDocument();
    expect(mocks.use).toHaveBeenCalledTimes(1);
  });

  it('klavye: Tab/Shift+Tab ile ulaşılır, Enter ve Space açar/kapar, oklar ve Escape durumu değiştirmez', async () => {
    const user = userEvent.setup();
    const FreshChart = await freshChart();
    render(<><button type="button">Önce</button><FreshChart option={option} ariaLabel={ETIKET} description="Açıklama" /></>);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Önce' })).toHaveFocus();
    await user.tab();
    const toggle = screen.getByRole('button', { name: 'Grafiği göster' });
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await screen.findByRole('img', { name: ETIKET });
    for (const key of ['{ArrowDown}', '{ArrowUp}', '{ArrowLeft}', '{ArrowRight}', '{Escape}']) {
      await user.keyboard(key);
      expect(toggle, key).toHaveAttribute('aria-expanded', 'true');
      expect(toggle, key).toHaveFocus();
    }
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Önce' })).toHaveFocus();
  });

  it('Pointer Events: iptal edilen dokunuş (pointercancel) açmaz; tamamlanan dokunuş açar', async () => {
    const FreshChart = await freshChart();
    render(<FreshChart option={option} ariaLabel={ETIKET} description="Açıklama" />);
    const toggle = screen.getByRole('button', { name: 'Grafiği göster' });
    fireEvent.pointerDown(toggle, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(toggle, { pointerType: 'touch', isPrimary: true });
    await flush();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(mocks.use).not.toHaveBeenCalled();
    fireEvent.pointerDown(toggle, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerUp(toggle, { pointerType: 'touch', isPrimary: true });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('img', { name: ETIKET })).toBeInTheDocument();
  });

  it('profil genişleyince grafik kendiliğinden yüklenir (IntersectionObserver yoksa hemen)', async () => {
    const viewport = installViewport(PHONE);
    const FreshChart = await freshChart();
    render(<FreshChart option={option} ariaLabel={ETIKET} description="Açıklama" />);
    await flush();
    expect(mocks.use).not.toHaveBeenCalled();
    act(() => { viewport.set(DESKTOP); });
    expect(await screen.findByRole('img', { name: ETIKET })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Grafiği (göster|gizle)/ })).toBeNull();
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

  it('sayfa option’ında 14 px altı yazı (eksen, legend, tooltip) 14 px’e yükseltilir; büyükler ve formatter korunur', async () => {
    const formatter = (value: number) => `${value} ₺`;
    const kucuk: EChartsOption = {
      ...option,
      textStyle: { fontSize: 12 },
      legend: { textStyle: { fontSize: '11px' } },
      tooltip: { textStyle: { fontSize: 10 } },
      xAxis: { type: 'category', data: ['Eyl', 'Eki', 'Kas'], axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 18, formatter } },
    };
    render(<Chart option={kucuk} ariaLabel={ETIKET} description="Açıklama" />);
    await screen.findByRole('img', { name: ETIKET });
    const passed = sonOption() as { xAxis: { axisLabel: { fontSize: number } }; yAxis: { axisLabel: { fontSize: number; formatter: unknown } }; legend: { textStyle: { fontSize: unknown } }; tooltip: { textStyle: { fontSize: number } }; textStyle: { fontSize: number }; series: unknown };
    expect(passed.xAxis.axisLabel.fontSize).toBe(14);
    expect(passed.legend.textStyle.fontSize).toBe(14);
    expect(passed.tooltip.textStyle.fontSize).toBe(14);
    expect(passed.textStyle.fontSize).toBe(14);
    expect(passed.yAxis.axisLabel.fontSize).toBe(18);
    expect(passed.yAxis.axisLabel.formatter).toBe(formatter);
    expect(passed.series).toEqual(option.series);
  });

  it('prefers-reduced-motion açıkken animation false olur', async () => {
    installViewport({ ...DESKTOP, reducedMotion: true });
    render(<Chart option={option} ariaLabel={ETIKET} description="Açıklama" />);
    await screen.findByRole('img', { name: ETIKET });
    expect(sonOption().animation).toBe(false);
  });

  it('telefonda reduced-motion: kullanıcı açınca grafik animasyonsuz çizilir, düğme durumu anında değişir', async () => {
    installViewport({ ...PHONE, reducedMotion: true });
    render(<Chart option={option} ariaLabel={ETIKET} description="Açıklama" />);
    const toggle = screen.getByRole('button', { name: 'Grafiği göster' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
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

describe('Chart — yükleme hatası kurtarılabilir', () => {
  afterEach(() => {
    vi.doUnmock('echarts/renderers');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('modül alınamazsa "Hata:" + "Yeniden dene"; açıklama kalır; yeniden deneme de düşerse "Sayfayı yenile" odak alır ve yeniler', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    vi.resetModules();
    vi.doMock('echarts/renderers', () => { throw new Error('ağ yok'); });
    const { Chart: FreshChart } = await import('./Chart');
    render(<FreshChart option={option} ariaLabel={ETIKET} description="Değerler yandaki tabloda." />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/^Hata: /);
    expect(alert).toHaveTextContent('Grafik yüklenemedi');
    expect(screen.getByText('Değerler yandaki tabloda.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    const retry = screen.getByRole('button', { name: 'Yeniden dene' });
    expect(retry).toHaveAttribute('type', 'button');
    expect(retry).toHaveAttribute('data-focus-line');
    // Tarayıcı (ve modül çalıştırıcı) başarısız dinamik importu önbellekleyebilir; ikinci düşüş sayfa yenilemeye yönlendirir.
    await user.click(retry);
    const reload = await screen.findByRole('button', { name: 'Sayfayı yenile' });
    expect(screen.getByRole('alert')).toHaveTextContent(/^Hata: /);
    expect(reload).toHaveFocus();
    expect(mocks.reloadPage).not.toHaveBeenCalled();
    await user.click(reload);
    expect(mocks.reloadPage).toHaveBeenCalledTimes(1);
  });

  it('geniş: kurulum bir kez düşer, "Yeniden dene" grafiği getirir ve odağı grafiğin yuvasına taşır', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    mocks.registerTheme.mockImplementationOnce(() => { throw new Error('tema kaydedilemedi'); });
    const FreshChart = await freshChart();
    render(<FreshChart option={option} ariaLabel={ETIKET} description="Değerler yandaki tabloda." />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Grafik yüklenemedi');
    await user.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    const img = await screen.findByRole('img', { name: ETIKET });
    expect(screen.queryByRole('alert')).toBeNull();
    // Odak kaybolmaz: kalkan "Yeniden dene" düğmesinin yerine grafiğin yuvası odak alır.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toContainElement(img);
  });

  it('telefon: hata sonrası yeniden deneme başarılıysa odak "Grafiği gizle" düğmesine döner', async () => {
    installViewport(PHONE);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    mocks.registerTheme.mockImplementationOnce(() => { throw new Error('tema kaydedilemedi'); });
    const FreshChart = await freshChart();
    render(<FreshChart option={option} ariaLabel={ETIKET} description="Açıklama" />);
    await user.click(screen.getByRole('button', { name: 'Grafiği göster' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    await screen.findByRole('img', { name: ETIKET });
    expect(screen.getByRole('button', { name: 'Grafiği gizle' })).toHaveFocus();
  });
});

describe('Chart — dışa aktarılan yardımcılar', () => {
  it('chartSeriesColors plan/gerçek ayrımını tokenlarla verir', async () => {
    const { chartSeriesColors, CHART_COLORS } = await import('./Chart');
    expect(chartSeriesColors.plan).toBe(designTokens.acikMavi);
    expect(chartSeriesColors.gercek).toBe(designTokens.eylem);
    expect(CHART_COLORS[0]).toBe(designTokens.eylem);
  });
});

