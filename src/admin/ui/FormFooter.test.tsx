import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { ReactNode } from 'react';
import { FormFooter, type FormFooterProps } from './FormFooter';

// Button ayrı görevde gerçek bileşen olur; burada tasarım ButtonProps biçimini (variant, block, disabled, onClick,
// children) koruyan düz bir düğme ile değiştirilir. Testler FormFooter'ın yerleşimini ve davranışını ölçer.
vi.mock('./Button', () => ({
  Button: ({ children, onClick, disabled, variant, block, 'aria-describedby': describedBy }: { children?: ReactNode; onClick?: () => void; disabled?: boolean; variant?: string; block?: boolean; 'aria-describedby'?: string }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-variant={variant} data-block={block ? 'true' : undefined} aria-describedby={describedBy}>{children}</button>
  ),
}));

describe('FormFooter', () => {
  it('announces the status in a live region with the given tone', () => {
    render(<FormFooter status="Kaydedilmemiş değişiklik var" statusTone="uyari" primaryLabel="Kaydet" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Kaydedilmemiş değişiklik var');
    expect(status).toHaveAttribute('data-tone', 'uyari');
  });

  it('keeps the live region in the DOM even without a status so later messages are announced', () => {
    render(<FormFooter primaryLabel="Kaydet" />);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    expect(status).not.toHaveAttribute('data-tone');
  });

  it('wide: status left, then secondary and primary in that order; both fire their handlers', async () => {
    const user = userEvent.setup();
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const { container } = render(
      <FormFooter status="Kaydedilmemiş değişiklik yok" primaryLabel="Kaydet" secondaryLabel="Vazgeç" onPrimary={onPrimary} onSecondary={onSecondary} />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual(['Vazgeç', 'Kaydet']);
    expect(buttons[0]).toHaveAttribute('data-variant', 'secondary');
    expect(buttons[1]).toHaveAttribute('data-variant', 'primary');
    expect(buttons[0]).not.toHaveAttribute('data-block');
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toHaveAttribute('data-narrow');
    expect(root).not.toHaveAttribute('data-sticky');
    // Durum metni eylemlerden önce gelir (solda okunur, odak sırası aynı).
    expect(root.firstElementChild).toBe(screen.getByRole('status'));

    await user.click(screen.getByRole('button', { name: 'Kaydet' }));
    await user.click(screen.getByRole('button', { name: 'Vazgeç' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('disabled primary: the reason is visible in the status and the click does nothing', async () => {
    const user = userEvent.setup();
    const onPrimary = vi.fn();
    render(<FormFooter status="Hata: 2 alan düzeltilmeli" statusTone="hata" primaryLabel="Kaydet" primaryDisabled secondaryLabel="Vazgeç" onPrimary={onPrimary} />);
    const primary = screen.getByRole('button', { name: 'Kaydet' });
    expect(primary).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Vazgeç' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Hata: 2 alan düzeltilmeli');
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'hata');
    await user.click(primary);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it('disabled primary is described by the status live region; an enabled one is not', () => {
    const { rerender } = render(<FormFooter status="Hata: 2 alan düzeltilmeli" statusTone="hata" primaryLabel="Kaydet" primaryDisabled />);
    const status = screen.getByRole('status');
    expect(status.id).not.toBe('');
    expect(screen.getByRole('button', { name: 'Kaydet' })).toHaveAttribute('aria-describedby', status.id);
    expect(screen.getByRole('button', { name: 'Kaydet' })).toHaveAccessibleDescription('Hata: 2 alan düzeltilmeli');

    rerender(<FormFooter status="Kaydedilmemiş değişiklik yok" primaryLabel="Kaydet" />);
    expect(screen.getByRole('button', { name: 'Kaydet' })).not.toHaveAttribute('aria-describedby');
  });

  it('hata tone always reads "Hata: …" so colour is never the only signal', () => {
    render(<FormFooter status="1 alan düzeltilmeli" statusTone="hata" primaryLabel="Kaydet" primaryDisabled />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Hata: 1 alan düzeltilmeli$/);
    // Zaten "Hata:" ile başlayan metin ikinci kez öneklenmez.
  });

  it('does not double the "Hata:" prefix', () => {
    render(<FormFooter status="Hata: 1 alan düzeltilmeli" statusTone="hata" primaryLabel="Kaydet" primaryDisabled />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Hata: 1 alan düzeltilmeli$/);
  });

  it('narrow: primary comes first and full width, footer is sticky by default', () => {
    const { container } = render(<FormFooter narrow status="Kaydedilmemiş değişiklik var" statusTone="uyari" primaryLabel="Kaydet" secondaryLabel="Vazgeç" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-narrow', 'true');
    expect(root).toHaveAttribute('data-sticky', 'true');
    const buttons = within(root).getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual(['Kaydet', 'Vazgeç']);
    for (const button of buttons) expect(button).toHaveAttribute('data-block', 'true');
  });

  it('narrow with sticky={false} stays in flow (e.g. inside a bottom sheet footer)', () => {
    const { container } = render(<FormFooter narrow sticky={false} primaryLabel="Sonuçları göster" secondaryLabel="Filtreleri temizle" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-narrow', 'true');
    expect(root).not.toHaveAttribute('data-sticky');
  });

  it('sticky on a wide form keeps the wide order', () => {
    const { container } = render(<FormFooter sticky primaryLabel="Kaydet" secondaryLabel="Vazgeç" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-sticky', 'true');
    expect(root).not.toHaveAttribute('data-narrow');
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Vazgeç', 'Kaydet']);
  });

  it('renders no button for a missing label', () => {
    render(<FormFooter status="Henüz yok" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('Henüz yok');
  });

  it('refuses a disabled primary without a visible reason at compile time', () => {
    // @ts-expect-error — primaryDisabled yalnız status ile birlikte geçerlidir (neden görünür olmalı).
    const props: FormFooterProps = { primaryLabel: 'Kaydet', primaryDisabled: true };
    expect(props.primaryDisabled).toBe(true);
    const ok: FormFooterProps = { primaryLabel: 'Kaydet', primaryDisabled: true, status: 'Hata: 2 alan düzeltilmeli', statusTone: 'hata' };
    expect(ok.status).toContain('Hata:');
  });

  it('source: Button from ./Button, styles from tokens only, no outline/box-shadow, sticky honours the safe area', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const tsx = readFileSync(resolve(__dirname, 'FormFooter.tsx'), 'utf8');
    expect(tsx).toMatch(/from\s+'\.\/Button'/);
    expect(tsx).not.toMatch(/from\s+['"](antd|@ant-design\/|@phosphor-icons\/|echarts|@mantine\/)/);
    expect(tsx).not.toContain('data-stub');
    const css = readFileSync(resolve(__dirname, 'FormFooter.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\boutline\s*:/);
    expect(css).not.toMatch(/box-shadow\s*:/);
    expect(css).toContain('position: sticky');
    expect(css).toContain('safe-area-inset-bottom');
    // Sanal klavye payı: yapışkan altlık görünür alanın altına (klavyenin üstüne) yapışır; klavye açıkken güvenli alan payı
    // klavyenin altında kaldığından düşer.
    expect(css).toMatch(/\.aile-ff--yapiskan \{[^}]*bottom: var\(--aile-ff-klavye, 0px\);/);
    expect(css).toMatch(/\.aile-ff--yapiskan\[data-klavye\] \{[^}]*padding-bottom: var\(--aile-bosluk-4\);/);
    // Her var() --aile- ile başlar; başka token kaynağı yok.
    for (const match of css.matchAll(/var\((--[a-z0-9-]+)/g)) expect(match[1]).toMatch(/^--aile-/);
    // Sabit piksel yalnız: 1 px ayırıcı çizgi, 14/20 küçük metin (alt sınır) ve safe-area için 0px yedeği. Başka px yok.
    const px = [...css.matchAll(/(\d+)px/g)].map(match => match[1]);
    expect(new Set(px)).toEqual(new Set(['0', '1', '14', '20']));
  });

  it('sticky: sanal klavye görünür alanı daraltınca altlık klavyenin üstünde kalır; klavye kapanınca pay kalkar', () => {
    const viewport = installVisualViewport(568);
    try {
      const { container } = render(<FormFooter narrow status="Kaydedilmemiş değişiklik var" primaryLabel="Kaydet" secondaryLabel="Vazgeç" />);
      const root = container.firstElementChild as HTMLElement;
      expect(root).not.toHaveAttribute('data-klavye');
      expect(root.style.getPropertyValue('--aile-ff-klavye')).toBe('');
      act(() => viewport.set({ height: 308 }));
      expect(root).toHaveAttribute('data-klavye', 'true');
      expect(root.style.getPropertyValue('--aile-ff-klavye')).toBe('260px');
      // Klavye açıkken sayfa kaydırılınca (offsetTop) görünür alt kenar aşağı iner, pay küçülür.
      act(() => viewport.set({ offsetTop: 60 }));
      expect(root.style.getPropertyValue('--aile-ff-klavye')).toBe('200px');
      act(() => viewport.set({ height: 568, offsetTop: 0 }));
      expect(root).not.toHaveAttribute('data-klavye');
      expect(root.style.getPropertyValue('--aile-ff-klavye')).toBe('');
    } finally {
      viewport.restore();
    }
  });

  it('yapışkan değilse ya da kullanıcı yakınlaştırdıysa klavye payı uygulanmaz', () => {
    const viewport = installVisualViewport(568);
    try {
      const { container, unmount } = render(<FormFooter narrow sticky={false} primaryLabel="Sonuçları göster" />);
      act(() => viewport.set({ height: 308 }));
      expect(container.firstElementChild).not.toHaveAttribute('data-klavye');
      unmount();
      act(() => viewport.set({ height: 568 }));
      const zoomed = render(<FormFooter narrow primaryLabel="Kaydet" />);
      act(() => viewport.set({ height: 284, scale: 2 }));
      expect(zoomed.container.firstElementChild).not.toHaveAttribute('data-klavye');
    } finally {
      viewport.restore();
    }
  });

  it('kaydırma kabı içindeyse pay kabın alt kenarına göre hesaplanır', () => {
    const viewport = installVisualViewport(568);
    try {
      const { container } = render(
        <div style={{ overflowY: 'auto' }} data-testid="kab">
          <FormFooter narrow primaryLabel="Kaydet" />
        </div>,
      );
      const kab = screen.getByTestId('kab');
      // Kap görünüm alanının 100 px üstünde biter (ör. alttan sayfa üstündeki form): klavye 260 px → kabın 160 px'i örtülür.
      kab.getBoundingClientRect = () => ({ top: 0, bottom: 468, left: 0, right: 320, width: 320, height: 468, x: 0, y: 0, toJSON: () => ({}) });
      act(() => viewport.set({ height: 308 }));
      const root = container.querySelector('.aile-ff') as HTMLElement;
      expect(root.style.getPropertyValue('--aile-ff-klavye')).toBe('160px');
    } finally {
      viewport.restore();
    }
  });
});

// Yapışkan altlık belgenin altına yapıştığında odağa kaydırılan alan onun altında kalmamalı (WCAG 2.4.11): altlığın
// ölçülen yüksekliği kökte --aile-ff-yukseklik olur, FormFooter.css bunu belge kaydırma payına (scroll-padding-bottom)
// odak çizgisi payıyla birlikte verir. Kaydırma kabı içindeki altlık belge payı istemez.
describe('FormFooter · yapışkan altlık kaydırma payı', () => {
  const VAR = '--aile-ff-yukseklik';
  const original = window.ResizeObserver;
  const heights = new Map<string, number>();
  let resizers: Array<() => void> = [];
  const rootVar = () => document.documentElement.style.getPropertyValue(VAR);
  beforeEach(() => {
    heights.clear();
    resizers = [];
    class FakeResizeObserver {
      private readonly run: () => void;
      constructor(callback: ResizeObserverCallback) { this.run = () => act(() => callback([], this as unknown as ResizeObserver)); resizers.push(this.run); }
      observe() {}
      unobserve() {}
      disconnect() { resizers = resizers.filter(run => run !== this.run); }
    }
    window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
      const height = this.classList.contains('aile-ff') ? heights.get(this.querySelector('button')?.textContent ?? '') ?? 0 : 0;
      return { width: 320, height, top: 0, left: 0, right: 320, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => {
    window.ResizeObserver = original;
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty(VAR);
  });

  it('a sticky footer reserves its measured height on the root, follows resizes, drops it when not sticky or unmounted', () => {
    heights.set('Kaydet', 176);
    const view = render(<FormFooter narrow status="Kaydedilmemiş değişiklik var" primaryLabel="Kaydet" secondaryLabel="Vazgeç" />);
    expect(rootVar()).toBe('176px');
    // Durum metni iki satıra sarılınca altlık büyür: pay ölçüyle güncellenir (yukarı yuvarlanır).
    heights.set('Kaydet', 199.5);
    for (const run of resizers) run();
    expect(rootVar()).toBe('200px');
    view.rerender(<FormFooter narrow sticky={false} status="Kaydedilmemiş değişiklik var" primaryLabel="Kaydet" secondaryLabel="Vazgeç" />);
    expect(rootVar()).toBe('');
    view.rerender(<FormFooter narrow status="Kaydedilmemiş değişiklik var" primaryLabel="Kaydet" secondaryLabel="Vazgeç" />);
    expect(rootVar()).toBe('200px');
    view.unmount();
    expect(rootVar()).toBe('');
  });

  it('a non-sticky (wide) footer reserves nothing', () => {
    heights.set('Kaydet', 72);
    render(<FormFooter status="Kaydedilmemiş değişiklik yok" primaryLabel="Kaydet" />);
    expect(rootVar()).toBe('');
  });

  it('two sticky footers: the taller one is reserved; when it goes, the other remains', () => {
    heights.set('Kaydet', 176);
    heights.set('Gönder', 120);
    const tall = render(<FormFooter narrow primaryLabel="Kaydet" />);
    render(<FormFooter narrow primaryLabel="Gönder" />);
    expect(rootVar()).toBe('176px');
    tall.unmount();
    expect(rootVar()).toBe('120px');
  });

  it('a sticky footer inside a scroll container sticks to the container and reserves nothing on the document', () => {
    heights.set('Kaydet', 176);
    render(<div style={{ overflowY: 'auto' }}><FormFooter narrow primaryLabel="Kaydet" /></div>);
    expect(rootVar()).toBe('');
  });

  it('source: the root scroll padding is the reserved height plus the focus line gap, only while a sticky footer exists', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(__dirname, 'FormFooter.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/:root:has\(\.aile-ff--yapiskan\) \{\s*scroll-padding-bottom: calc\(var\(--aile-ff-yukseklik, 0px\) \+ var\(--aile-odak-aralik\) \+ var\(--aile-odak-kalinlik\)\);\s*\}/);
  });
});

/** Sanal klavye taklidi (window.visualViewport + documentElement.clientHeight). Emülasyondur, gerçek cihaz değildir. */
function installVisualViewport(layoutHeight: number) {
  const target = new EventTarget();
  const state = { height: layoutHeight, offsetTop: 0, scale: 1 };
  for (const key of ['height', 'offsetTop', 'scale'] as const) {
    Object.defineProperty(target, key, { configurable: true, get: () => state[key] });
  }
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: target });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: layoutHeight });
  return {
    set(next: Partial<typeof state>) {
      Object.assign(state, next);
      target.dispatchEvent(new Event('resize'));
    },
    restore() {
      Reflect.deleteProperty(window, 'visualViewport');
      Reflect.deleteProperty(document.documentElement, 'clientHeight');
    },
  };
}
