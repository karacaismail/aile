import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { useRef, useState, type ReactNode } from 'react';
import { installViewport } from '../adaptive/testing';
import { BottomSheet, type BottomSheetProps } from './BottomSheet';

// Tasarım: components/BottomSheet/README.md — tutamaç, başlık, görünür "Kapat"; Escape kapatır; odak içeri girer,
// kapanınca açan düğmeye döner; en çok %85, iç kaydırma, safe-area-inset-bottom. Referans davranış bundle.js
// BottomSheet/useModal (örtü tıklaması da kapatır). Seçiciler role/label; antd iç sınıfı yok, yalnız kendi sınıflarımız.
// Telefon sunumu antd'siz (W0 sözleşmesi): yerel HTML + APG dialog kalıbı; sürükleyerek kapatma Pointer Events ile ve
// her zaman sürüklemesiz alternatif (Kapat, Escape). Hareket 240 ms proje eğrisi; durum (ARIA, inert, odak) anında.

const title = 'Oda seç';
const body = 'Mutfak, Salon, Yatak odası';

type HarnessProps = Partial<Omit<BottomSheetProps, 'title' | 'open' | 'onClose' | 'returnFocusTo'>> & {
  /** true: ikinci düğme ("Hedef") returnFocusTo olur. */
  returnToTarget?: boolean;
  children?: ReactNode;
  onClosed?: () => void;
};

function Harness({ returnToTarget, children, onClosed, ...rest }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const target = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Odayı seç</button>
      <button type="button" ref={target}>Hedef</button>
      <BottomSheet
        title={title}
        open={open}
        onClose={() => { onClosed?.(); setOpen(false); }}
        returnFocusTo={returnToTarget ? target : undefined}
        {...rest}
      >
        {children ?? <p>{body}</p>}
      </BottomSheet>
    </>
  );
}

const sheetRoot = () => document.querySelector<HTMLElement>('.aile-sheet');
const wrapper = () => document.querySelector<HTMLElement>('.aile-sheet-sarmal') as HTMLElement;
const header = () => document.querySelector<HTMLElement>('.aile-sheet-ust') as HTMLElement;

/** jsdom CSS işlemez (vitest css: false); hareketli bir kapanışı sınamak için süre boylamasına (longhand) verilir. */
function withMotionStyle() {
  const style = document.createElement('style');
  style.textContent = '.aile-sheet-sarmal { transition-property: transform; transition-duration: 240ms; transition-delay: 0s; }';
  document.head.appendChild(style);
  return () => style.remove();
}

/** jsdom'da Pointer Capture yok: çağrılar kaydedilir, durum öğe başına tutulur. */
function stubPointerCapture() {
  const captured = new Map<Element, Set<number>>();
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const saved = { set: proto.setPointerCapture, has: proto.hasPointerCapture, release: proto.releasePointerCapture };
  const set = vi.fn(function (this: Element, id: number) {
    if (!captured.has(this)) captured.set(this, new Set());
    captured.get(this)!.add(id);
  });
  const has = vi.fn(function (this: Element, id: number) { return captured.get(this)?.has(id) ?? false; });
  const release = vi.fn(function (this: Element, id: number) { captured.get(this)?.delete(id); });
  proto.setPointerCapture = set;
  proto.hasPointerCapture = has;
  proto.releasePointerCapture = release;
  return {
    set, has, release,
    restore() { proto.setPointerCapture = saved.set; proto.hasPointerCapture = saved.has; proto.releasePointerCapture = saved.release; },
  };
}

const touch = (pointerId: number, clientY: number, extra: Partial<PointerEventInit> = {}) =>
  ({ pointerId, clientX: 160, clientY, isPrimary: true, pointerType: 'touch', button: 0, buttons: 1, ...extra });

/** Statik import kapanışı (import type ve dinamik import hariç): göreli modüller izlenir, paket adları toplanır. */
function staticClosure(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const resolveRelative = (from: string, spec: string) => {
    const base = resolve(dirname(from), spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
      if (existsSync(candidate) && !candidate.endsWith('/')) {
        try { readFileSync(candidate, 'utf8'); return candidate; } catch { /* dizin */ }
      }
    }
    throw new Error(`${from}: ${spec} çözülemedi`);
  };
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    if (/\.css$/.test(file)) return;
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const statements = code.match(/^\s*(?:import|export)\s[^;]*?from\s+['"][^'"]+['"]|^\s*import\s+['"][^'"]+['"]/gm) ?? [];
    for (const statement of statements) {
      if (/^\s*(?:import|export)\s+type\s/.test(statement)) continue;
      const spec = /['"]([^'"]+)['"]\s*$/.exec(statement)![1];
      if (spec.startsWith('.')) visit(resolveRelative(file, spec));
      else packages.add(spec);
    }
  };
  visit(resolve(__dirname, entry));
  return { files: [...files].map(file => file.slice(resolve(__dirname, '../../..').length + 1)), packages: [...packages] };
}

const css = () => readFileSync(resolve(__dirname, 'BottomSheet.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

afterEach(() => {
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
});

describe('BottomSheet', () => {
  it('open=false iken hiçbir şey çizmez', () => {
    render(<BottomSheet title={title} open={false}><p>Gizli</p></BottomSheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Gizli')).toBeNull();
  });

  it('başlığıyla adlandırılan modal diyalog: h2, gövde, altlık ve görünür Kapat', () => {
    render(
      <BottomSheet title={title} footer={<button type="button">Uygula</button>}>
        <p>{body}</p>
      </BottomSheet>,
    );
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uygula' })).toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Kapat' });
    expect(close).toBeVisible();
    expect(close).toHaveTextContent('Kapat');
    expect(close).toHaveAttribute('type', 'button');
    // Yalnız bizim düğmeler: başka (kütüphane) kapatıcı çizilmez.
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('tutamaç süsleyicidir: aria-hidden, metinsiz, diyaloğun içinde', () => {
    render(<BottomSheet title={title}><p>{body}</p></BottomSheet>);
    const dialog = screen.getByRole('dialog', { name: title });
    const grip = dialog.querySelector('.aile-sheet-tutamac');
    expect(grip).not.toBeNull();
    expect(grip).toHaveAttribute('aria-hidden', 'true');
    expect(grip).toHaveTextContent('');
  });

  it('Kapat düğmesi onClose çağırır', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape onClose çağırır', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('klavye: Kapat Enter ve Space ile çalışır; ok tuşları yutulmaz (gövde kaydırması ve içerik bileşenleri için)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
    const dialog = screen.getByRole('dialog', { name: title });
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'Home', 'End']) {
      expect(fireEvent.keyDown(dialog, { key }), key).toBe(true);
    }
    expect(onClose).not.toHaveBeenCalled();
    const close = screen.getByRole('button', { name: 'Kapat' });
    close.focus();
    await user.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('örtüye tıklama onClose çağırır (referans scrim)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
    const mask = document.querySelector('.aile-sheet-ortu');
    expect(mask).not.toBeNull();
    expect(mask).toHaveAttribute('aria-hidden', 'true');
    await user.click(mask as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('açılışta odak sayfaya girer; Tab önce Kapat, sonra altlık düğmesine ulaşır', async () => {
    const user = userEvent.setup();
    render(<Harness footer={<button type="button">Uygula</button>} />);
    const opener = screen.getByRole('button', { name: 'Odayı seç' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Kapat' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Uygula' })).toHaveFocus();
  });

  it('kapanınca odak açan düğmeye döner', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Odayı seç' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('returnFocusTo verilirse odak oraya döner', async () => {
    const user = userEvent.setup();
    render(<Harness returnToTarget />);
    await user.click(screen.getByRole('button', { name: 'Odayı seç' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hedef' })).toHaveFocus();
  });

  // Kararsızlığın kökü: odak iki sahipliydi. antd/rc-drawer kendi autoFocus'unu (passive effect) ve yeniden denemeli odak
  // kilidini (useLockFocus) rc-motion'un rAF adımlarıyla geç bağlanan panel ref'ine göre çalıştırıyor, bileşen de kendi
  // rAF girişini ve passive dönüşünü yapıyordu; son sözü kimin söylediği jsdom'un 16 ms'lik kare saatine ve yüke bağlıydı.
  // Yerel katmanda tek sahip var: giriş açılış commit'inin layout aşamasında (React'in odak geri yüklemesinden sonra),
  // dönüş kapanış commit'inin layout aşamasında. Kare, zamanlayıcı ya da bekleme yok; aynı turda doğrulanır.
  it('odak girişi ve dönüşü aynı commit içinde olur: kare (rAF) ve bekleme yok', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    try {
      render(<Harness returnToTarget />);
      const opener = screen.getByRole('button', { name: 'Odayı seç' });
      opener.focus();
      fireEvent.click(opener);
      const dialog = screen.getByRole('dialog', { name: title });
      expect(dialog).toHaveFocus();
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: 'Hedef' })).toHaveFocus();
      expect(raf).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
    }
  });

  it('içerik açılışta kendi öğesini odaklarsa panel odağı çalmaz', () => {
    function Autofocus() {
      return <input aria-label="Ara" ref={element => element?.focus()} />;
    }
    render(<BottomSheet title={title}><Autofocus /></BottomSheet>);
    expect(screen.getByRole('textbox', { name: 'Ara' })).toHaveFocus();
  });

  it('alttan açılır: yükseklik içeriğe göre (auto), full ise tam ekran (100%)', () => {
    const { unmount } = render(<BottomSheet title={title}><p>{body}</p></BottomSheet>);
    const root = () => screen.getByRole('dialog').closest('.aile-sheet') as HTMLElement;
    expect(root()).not.toBeNull();
    expect(root()).not.toHaveClass('aile-sheet--full');
    expect(wrapper().style.height).toBe('auto');
    expect(wrapper().style.width).toBe('');
    unmount();

    render(<BottomSheet title={title} full><p>{body}</p></BottomSheet>);
    expect(root()).toHaveClass('aile-sheet--full');
    expect(wrapper().style.height).toBe('100%');
  });

  it('portal hedefi yönetim kökü (.aile-admin): token, tipografi ve odak çizgisi kuralları katmana ulaşır', () => {
    const app = document.createElement('div');
    app.className = 'aile-admin';
    document.body.appendChild(app);
    try {
      render(<BottomSheet title={title}><p>{body}</p></BottomSheet>);
      expect(sheetRoot()?.parentElement).toBe(app);
    } finally {
      app.remove();
    }
  });

  // r-sheet: iç içe katman. Diyalog kökü (Dialog, body'ye portallanır ve .aile-admin taşır) açıkken uygulama kökü inert
  // olur; içindeki seçim alt sayfası uygulama köküne açılsaydı inert bir ağacın içinde kalır, dokunma ve odak almazdı.
  it('portal hedefi açan öğenin (returnFocusTo) en yakın yönetim kökü: iç içe diyalog kökünde açılır', () => {
    const app = document.createElement('div');
    app.className = 'aile-admin';
    const dialogRoot = document.createElement('div');
    dialogRoot.className = 'aile-admin aile-dialog';
    const trigger = document.createElement('button');
    trigger.textContent = 'Sözlük';
    dialogRoot.appendChild(trigger);
    document.body.append(app, dialogRoot);
    app.setAttribute('inert', '');
    try {
      render(<BottomSheet title={title} returnFocusTo={{ current: trigger }}><p>{body}</p></BottomSheet>);
      expect(sheetRoot()?.parentElement).toBe(dialogRoot);
      expect(screen.getByRole('dialog', { name: title }).closest('[inert]')).toBeNull();
    } finally {
      app.remove();
      dialogRoot.remove();
    }
  });

  it('açan öğe verilmezse son canlı (inert ya da aria-hidden olmayan) yönetim köküne açılır', () => {
    const app = document.createElement('div');
    app.className = 'aile-admin';
    const dialogRoot = document.createElement('div');
    dialogRoot.className = 'aile-admin aile-dialog';
    const ghost = document.createElement('div');
    ghost.className = 'aile-admin aile-dialog';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.setAttribute('inert', '');
    document.body.append(app, dialogRoot, ghost);
    app.setAttribute('inert', '');
    try {
      render(<BottomSheet title={title}><p>{body}</p></BottomSheet>);
      expect(sheetRoot()?.parentElement).toBe(dialogRoot);
    } finally {
      app.remove();
      dialogRoot.remove();
      ghost.remove();
    }
  });

  it('id ve titleId verilirse diyalog yüzeyine ve h2 başlığa yazılır (aria-controls / aria-labelledby bağı)', () => {
    render(<BottomSheet title={title} id="secim-sayfa" titleId="secim-baslik"><p>{body}</p></BottomSheet>);
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveAttribute('id', 'secim-sayfa');
    expect(screen.getByRole('heading', { level: 2, name: title })).toHaveAttribute('id', 'secim-baslik');
    expect(dialog).toHaveAttribute('aria-labelledby', 'secim-baslik');
  });

  it('odak kapsamı: yönetim kökü dışına (body) portallansa da kök data-aile-katman taşır; inline da', () => {
    // b04 odak sözleşmesi (admin.css): odak çizgisi, halka sıfırlaması ve reduced-motion .aile-admin ya da yerel katman
    // köküne ([data-aile-katman]) bağlıdır. Kök role="dialog" değildir (yüzey öyledir), bu yüzden işareti kendisi taşır.
    const { unmount } = render(<BottomSheet title={title}><p>{body}</p></BottomSheet>);
    expect(sheetRoot()?.parentElement).toBe(document.body);
    expect(sheetRoot()).toHaveAttribute('data-aile-katman');
    expect(screen.getByRole('button', { name: 'Kapat' })).toHaveAttribute('data-focus-line');
    unmount();
    render(<BottomSheet title={title} inline><p>{body}</p></BottomSheet>);
    expect(sheetRoot()).toHaveAttribute('data-aile-katman');
  });

  it('uygulamayla birlikte kapalı bağlansa da (kök ilk render\'da henüz belgede değil) yönetim köküne açılır', () => {
    function App() {
      const [open, setOpen] = useState(false);
      return (
        <div className="aile-admin" data-testid="kok">
          <button type="button" onClick={() => setOpen(true)}>Aç</button>
          <BottomSheet title={title} open={open} onClose={() => setOpen(false)}><p>{body}</p></BottomSheet>
        </div>
      );
    }
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Aç' }));
    expect(sheetRoot()?.parentElement).toBe(screen.getByTestId('kok'));
    expect(screen.getByRole('dialog', { name: title })).toHaveFocus();
  });

  it('açık bağlanırsa da (ilk commit) hedef gelince odak girer ve arka plan inert olur', () => {
    render(
      <>
        <button type="button">Dışarıda</button>
        <BottomSheet title={title}><p>{body}</p></BottomSheet>
      </>,
    );
    expect(screen.getByRole('dialog', { name: title })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Dışarıda' }).closest('[inert]')).not.toBeNull();
    expect(sheetRoot()).toHaveAttribute('data-durum', 'acik');
  });

  it('odak boşluğa (body) düşerse panele geri alınır; başka bir öğeye geçiş serbesttir', async () => {
    render(<BottomSheet title={title}><p>{body}</p></BottomSheet>);
    const dialog = screen.getByRole('dialog', { name: title });
    act(() => dialog.blur());
    await waitFor(() => expect(dialog).toHaveFocus());
    const later = document.createElement('button');
    later.textContent = 'Sonradan açılan liste';
    document.body.appendChild(later);
    try {
      act(() => later.focus());
      await Promise.resolve();
      expect(later).toHaveFocus();
    } finally {
      later.remove();
    }
  });

  it('inline verilirse portal yerine yerinde, kipsiz (aria-modal yok, arka plan inert değil) çizer', () => {
    const { container } = render(
      <>
        <button type="button">Dışarıda</button>
        <BottomSheet title={title} inline><p>{body}</p></BottomSheet>
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: title });
    expect(container.contains(dialog)).toBe(true);
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(screen.getByRole('button', { name: 'Dışarıda' }).closest('[inert]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('inline katmanda Escape yalnız odak içerideyken kapatır', () => {
    const onClose = vi.fn();
    render(
      <>
        <button type="button">Dışarıda</button>
        <BottomSheet title={title} inline onClose={onClose}><p>{body}</p></BottomSheet>
      </>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Dışarıda' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Kapat' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('kip (modal) sözleşmesi', () => {
    it('açıkken arka plan inert ve sayfa kaymaz; kapanınca ikisi de aynı commit içinde geri verilir', () => {
      render(<Harness />);
      const opener = screen.getByRole('button', { name: 'Odayı seç' });
      fireEvent.click(opener);
      expect(opener.closest('[inert]')).not.toBeNull();
      expect(sheetRoot()!.closest('[inert]')).toBeNull();
      expect(document.body.style.overflow).toBe('hidden');
      fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
      expect(opener.closest('[inert]')).toBeNull();
      expect(document.querySelectorAll('[inert]')).toHaveLength(0);
      expect(document.body.style.overflow).toBe('');
    });

    it('başkasının koyduğu inert dokunulmaz kalır', () => {
      render(
        <>
          <div data-testid="onceden" inert>Önceden inert</div>
          <Harness />
        </>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Odayı seç' }));
      fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
      expect(screen.getByTestId('onceden')).toHaveAttribute('inert');
    });

    it('onClose çağrılmadan önce arka plan serbest: çağıran odağı dışarı taşıyabilir ve dönüş onu ezmez', () => {
      let inertDuringClose: boolean | null = null;
      function Moved() {
        const [open, setOpen] = useState(false);
        const main = useRef<HTMLElement>(null);
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>Odayı seç</button>
            <main ref={main} tabIndex={-1}>İçerik</main>
            <BottomSheet
              title={title}
              open={open}
              onClose={() => {
                inertDuringClose = !!main.current?.closest('[inert]');
                main.current?.focus();
                setOpen(false);
              }}
            >
              <p>{body}</p>
            </BottomSheet>
          </>
        );
      }
      render(<Moved />);
      fireEvent.click(screen.getByRole('button', { name: 'Odayı seç' }));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(inertDuringClose).toBe(false);
      expect(screen.getByRole('main')).toHaveFocus();
    });

    it('çağıran kapatmazsa (onClose açık bırakır) arka plan yeniden inert olur', async () => {
      render(
        <>
          <button type="button">Dışarıda</button>
          <BottomSheet title={title} onClose={() => {}}><p>{body}</p></BottomSheet>
        </>,
      );
      const outside = screen.getByRole('button', { name: 'Dışarıda' });
      expect(outside.closest('[inert]')).not.toBeNull();
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => expect(outside.closest('[inert]')).not.toBeNull());
      expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    });

    it('Tab tuzağı: son öğede Tab ilk öğeye, ilk öğede ve panelde Shift+Tab son öğeye sarar; aradakiler tarayıcıda', () => {
      render(
        <BottomSheet title={title} footer={<button type="button">Uygula</button>}>
          <a href="#/a">Bağlantı</a>
        </BottomSheet>,
      );
      const dialog = screen.getByRole('dialog');
      const close = screen.getByRole('button', { name: 'Kapat' });
      const link = screen.getByRole('link', { name: 'Bağlantı' });
      const last = screen.getByRole('button', { name: 'Uygula' });
      last.focus();
      expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
      expect(close).toHaveFocus();
      expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false);
      expect(last).toHaveFocus();
      dialog.focus();
      expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
      expect(last).toHaveFocus();
      link.focus();
      expect(fireEvent.keyDown(link, { key: 'Tab' })).toBe(true);
    });

    // r-sheet: menü (APG menu, öğeler tabindex -1) ya da dolaşan odaklı liste öğesi odaktayken sıradaki durak tarayıcıya
    // bırakılırsa (katmanda ondan sonra durak yoksa) odak tarayıcı arayüzüne ya da belgeye kaçar.
    it('Tab tuzağı: odak durak olmayan bir iç öğedeyse (tabindex -1) Tab sonraki durağa ya da ilk durağa, Shift+Tab önceki ya da son durağa gider', () => {
      render(
        <BottomSheet title={title} footer={<button type="button">Uygula</button>}>
          <ul role="menu" aria-label="Eylemler">
            <li role="menuitem" tabIndex={-1}>Borç ekle</li>
            <li role="menuitem" tabIndex={-1}>Hesap ekle</li>
          </ul>
        </BottomSheet>,
      );
      const close = screen.getByRole('button', { name: 'Kapat' });
      const apply = screen.getByRole('button', { name: 'Uygula' });
      const [first, second] = screen.getAllByRole('menuitem');
      second.focus();
      expect(fireEvent.keyDown(second, { key: 'Tab' })).toBe(false);
      expect(apply).toHaveFocus();
      first.focus();
      expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
      expect(close).toHaveFocus();
    });

    it('Tab tuzağı: durak olmayan iç öğeden sonra durak yoksa Tab ilk durağa sarar; önce durak yoksa Shift+Tab son durağa', () => {
      render(
        <BottomSheet title={title}>
          <ul role="menu" aria-label="Eylemler">
            <li role="menuitem" tabIndex={-1}>Borç ekle</li>
          </ul>
        </BottomSheet>,
      );
      const close = screen.getByRole('button', { name: 'Kapat' });
      const item = screen.getByRole('menuitem');
      item.focus();
      expect(fireEvent.keyDown(item, { key: 'Tab' })).toBe(false);
      expect(close).toHaveFocus();
      item.focus();
      expect(fireEvent.keyDown(item, { key: 'Tab', shiftKey: true })).toBe(false);
      expect(close).toHaveFocus();
    });

    it('iç içe katmanlarda Escape yalnız en üsttekini kapatır; dış katman içtekinin açıkken inert olur', () => {
      const outerClose = vi.fn();
      function Nested() {
        const [inner, setInner] = useState(false);
        return (
          <BottomSheet title="Dış" onClose={outerClose}>
            <button type="button" onClick={() => setInner(true)}>İçi aç</button>
            <BottomSheet title="İç" open={inner} onClose={() => setInner(false)}><p>İç içerik</p></BottomSheet>
          </BottomSheet>
        );
      }
      render(<Nested />);
      const outer = screen.getByRole('dialog', { name: 'Dış' });
      const openInner = screen.getByRole('button', { name: 'İçi aç' });
      openInner.focus();
      fireEvent.click(openInner);
      const innerDialog = screen.getByRole('dialog', { name: 'İç' });
      expect(innerDialog).toHaveFocus();
      expect(outer.closest('[inert]')).not.toBeNull();
      fireEvent.keyDown(innerDialog, { key: 'Escape' });
      expect(outerClose).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog', { name: 'İç' })).toBeNull();
      expect(outer.closest('[inert]')).toBeNull();
      expect(openInner).toHaveFocus();
      fireEvent.keyDown(openInner, { key: 'Escape' });
      expect(outerClose).toHaveBeenCalledTimes(1);
    });

    it('açıkken sökülürse arka planı bırakır ve odağı açan öğeye döndürür', () => {
      function Removed() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>Odayı seç</button>
            {open && (
              <BottomSheet title={title} onClose={() => setOpen(false)}><p>{body}</p></BottomSheet>
            )}
          </>
        );
      }
      render(<Removed />);
      const opener = screen.getByRole('button', { name: 'Odayı seç' });
      opener.focus();
      fireEvent.click(opener);
      expect(screen.getByRole('dialog')).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(opener).toHaveFocus();
      expect(document.querySelectorAll('[inert]')).toHaveLength(0);
      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('hareket ve durum', () => {
    it('hareket kapalıyken (süre 0: reduced-motion ya da CSS yok) kapanış aynı commit içinde söker', () => {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Odayı seç' }));
      expect(sheetRoot()).toHaveAttribute('data-durum', 'acik');
      fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
      expect(sheetRoot()).toBeNull();
    });

    it('kapanış hareketi sürerken durum anında kapalı: kök aria-hidden + inert, arka plan serbest, odak dönmüş; transitionend söker', () => {
      const removeStyle = withMotionStyle();
      try {
        render(<Harness />);
        const opener = screen.getByRole('button', { name: 'Odayı seç' });
        opener.focus();
        fireEvent.click(opener);
        fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
        const root = sheetRoot();
        expect(root).not.toBeNull();
        expect(root).toHaveAttribute('data-durum', 'kapali');
        expect(root).toHaveAttribute('aria-hidden', 'true');
        expect(root).toHaveAttribute('inert');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(opener).toHaveFocus();
        expect(opener.closest('[inert]')).toBeNull();
        // Çocuktan kabaran geçiş sonu sökmez; yalnız sarmalın kendi geçişi.
        act(() => { screen.getByText(body).dispatchEvent(new Event('transitionend', { bubbles: true })); });
        expect(sheetRoot()).not.toBeNull();
        act(() => { wrapper().dispatchEvent(new Event('transitionend', { bubbles: true })); });
        expect(sheetRoot()).toBeNull();
      } finally {
        removeStyle();
      }
    });

    it('kapanış hareketi sırasında yeniden açılırsa aynı düğüm bulunduğu yerden geri döner (yeniden kurulmaz)', () => {
      const removeStyle = withMotionStyle();
      try {
        render(<Harness />);
        const opener = screen.getByRole('button', { name: 'Odayı seç' });
        opener.focus();
        fireEvent.click(opener);
        const first = sheetRoot();
        fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
        expect(sheetRoot()).toBe(first);
        fireEvent.click(opener);
        expect(sheetRoot()).toBe(first);
        expect(first).toHaveAttribute('data-durum', 'acik');
        expect(first).not.toHaveAttribute('aria-hidden');
        expect(first).not.toHaveAttribute('inert');
        expect(screen.getByRole('dialog', { name: title })).toHaveFocus();
      } finally {
        removeStyle();
      }
    });
  });

  describe('sürükleyerek kapatma (Pointer Events)', () => {
    let capture: ReturnType<typeof stubPointerCapture>;
    beforeEach(() => { capture = stubPointerCapture(); });
    afterEach(() => capture.restore());

    it('tutamaç alanından aşağı sürükleme eşiği geçince kapatır; işaretçi yakalanır ve bırakılır', () => {
      const onClose = vi.fn();
      render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
      fireEvent.pointerDown(header(), touch(7, 100));
      expect(capture.set).toHaveBeenCalledWith(7);
      fireEvent.pointerMove(header(), touch(7, 130));
      expect(wrapper()).toHaveAttribute('data-surukleniyor');
      expect(wrapper().style.getPropertyValue('--surukleme')).toBe('30px');
      fireEvent.pointerMove(header(), touch(7, 260));
      expect(wrapper().style.getPropertyValue('--surukleme')).toBe('160px');
      fireEvent.pointerUp(header(), touch(7, 260));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(capture.release).toHaveBeenCalledWith(7);
      expect(wrapper()).not.toHaveAttribute('data-surukleniyor');
    });

    it('yukarı sürükleme sayfayı yukarı taşımaz (ofset 0 altına inmez)', () => {
      render(<BottomSheet title={title} onClose={() => {}}><p>{body}</p></BottomSheet>);
      fireEvent.pointerDown(header(), touch(2, 300));
      fireEvent.pointerMove(header(), touch(2, 240));
      expect(wrapper().style.getPropertyValue('--surukleme')).toBe('');
    });

    it('eşik altında bırakılırsa kapatmaz ve yerine döner', () => {
      const onClose = vi.fn();
      render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
      fireEvent.pointerDown(header(), touch(3, 100));
      fireEvent.pointerMove(header(), touch(3, 120));
      expect(wrapper().style.getPropertyValue('--surukleme')).toBe('20px');
      fireEvent.pointerUp(header(), touch(3, 120));
      expect(onClose).not.toHaveBeenCalled();
      expect(wrapper().style.getPropertyValue('--surukleme')).toBe('');
      expect(wrapper()).not.toHaveAttribute('data-surukleniyor');
    });

    it('pointercancel sürüklemeyi iptal eder: kapatmaz, ofset sıfırlanır, sonraki hareket yok sayılır', () => {
      const onClose = vi.fn();
      render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
      fireEvent.pointerDown(header(), touch(4, 100));
      fireEvent.pointerMove(header(), touch(4, 400));
      fireEvent.pointerCancel(header(), touch(4, 400));
      expect(onClose).not.toHaveBeenCalled();
      expect(wrapper().style.getPropertyValue('--surukleme')).toBe('');
      expect(wrapper()).not.toHaveAttribute('data-surukleniyor');
      fireEvent.pointerMove(header(), touch(4, 500));
      fireEvent.pointerUp(header(), touch(4, 500));
      expect(onClose).not.toHaveBeenCalled();
      expect(wrapper().style.getPropertyValue('--surukleme')).toBe('');
    });

    it('yakalama kaybı (lostpointercapture) da iptal sayılır', () => {
      const onClose = vi.fn();
      render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
      fireEvent.pointerDown(header(), touch(5, 100));
      fireEvent.pointerMove(header(), touch(5, 400));
      fireEvent(header(), new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 5 }));
      fireEvent.pointerUp(header(), touch(5, 400));
      expect(onClose).not.toHaveBeenCalled();
      expect(wrapper().style.getPropertyValue('--surukleme')).toBe('');
    });

    it('gövdeden (iç kaydırma alanı) başlayan dikey hareket sürükleme değildir', () => {
      const onClose = vi.fn();
      render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
      const text = screen.getByText(body);
      fireEvent.pointerDown(text, touch(6, 100));
      fireEvent.pointerMove(text, touch(6, 400));
      fireEvent.pointerUp(text, touch(6, 400));
      expect(capture.set).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(wrapper().style.getPropertyValue('--surukleme')).toBe('');
    });

    it('Kapat düğmesinde başlayan işaretçi sürükleme başlatmaz; fare sağ tuşu ve birincil olmayan işaretçi de', () => {
      const onClose = vi.fn();
      render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
      const close = screen.getByRole('button', { name: 'Kapat' });
      fireEvent.pointerDown(close, touch(8, 100));
      fireEvent.pointerDown(header(), touch(9, 100, { pointerType: 'mouse', button: 2, buttons: 2 }));
      fireEvent.pointerDown(header(), touch(10, 100, { isPrimary: false }));
      expect(capture.set).not.toHaveBeenCalled();
      fireEvent.pointerMove(header(), touch(9, 400, { pointerType: 'mouse', button: 2, buttons: 2 }));
      fireEvent.pointerUp(header(), touch(9, 400, { pointerType: 'mouse', button: 2, buttons: 0 }));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('fare ile sol tuş sürüklemesi de çalışır (giriş türünden bağımsız)', () => {
      const onClose = vi.fn();
      render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
      fireEvent.pointerDown(header(), touch(1, 100, { pointerType: 'mouse' }));
      fireEvent.pointerMove(header(), touch(1, 300, { pointerType: 'mouse' }));
      fireEvent.pointerUp(header(), touch(1, 300, { pointerType: 'mouse', buttons: 0 }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('sanal klavye (visualViewport)', () => {
    const savedMatchMedia = window.matchMedia;
    afterEach(() => {
      delete (window as { visualViewport?: unknown }).visualViewport;
      window.matchMedia = savedMatchMedia;
    });

    it('görünür alan küçülünce (klavye) katman görünür alana sığar; kapanınca dinleyiciler kalkar', () => {
      installViewport({ width: 320, height: 568, coarse: true });
      const target = new EventTarget();
      const vv = Object.assign(target, { width: 320, height: 568, offsetTop: 0, offsetLeft: 0, scale: 1 });
      const remove = vi.spyOn(vv, 'removeEventListener');
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
      const { rerender } = render(<BottomSheet title={title}><input aria-label="Not" /></BottomSheet>);
      expect(sheetRoot()!.style.getPropertyValue('--katman-alt')).toBe('0px');
      vv.height = 268;
      act(() => { vv.dispatchEvent(new Event('resize')); });
      expect(sheetRoot()!.style.getPropertyValue('--katman-alt')).toBe('300px');
      vv.offsetTop = 40;
      act(() => { vv.dispatchEvent(new Event('scroll')); });
      expect(sheetRoot()!.style.getPropertyValue('--katman-ust')).toBe('40px');
      expect(sheetRoot()!.style.getPropertyValue('--katman-alt')).toBe('260px');
      rerender(<BottomSheet title={title} open={false}><input aria-label="Not" /></BottomSheet>);
      expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
      expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    });

    // r-sheet: yatay telefonda (568×320) klavye görünür alanı ~176 px'e indirir. Katman bu alanı tümüyle kullanır ve sık
    // yoğunluğa geçer (data-klavye; CSS); odaklı alan gövdenin görünür bölümüne kaydırılır.
    it('klavye açıkken kök data-klavye="acik" taşır ve odaklı alan gövdenin görünür alanına kaydırılır; kapanınca kalkar', () => {
      installViewport({ width: 568, height: 320, coarse: true });
      const vv = Object.assign(new EventTarget(), { width: 568, height: 320, offsetTop: 0, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
      render(<BottomSheet title={title}><input aria-label="Ara" /></BottomSheet>);
      expect(sheetRoot()).not.toHaveAttribute('data-klavye');
      const field = screen.getByRole('textbox', { name: 'Ara' });
      field.focus();
      const govde = document.querySelector('.aile-sheet-govde') as HTMLElement;
      let scrollTop = 0;
      Object.defineProperty(govde, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
      const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 568, width: 568, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
      vi.spyOn(govde, 'getBoundingClientRect').mockImplementation(() => rect(61, 50));
      vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() => rect(140 - scrollTop, 48));
      vv.height = 176;
      act(() => { vv.dispatchEvent(new Event('resize')); });
      expect(sheetRoot()).toHaveAttribute('data-klavye', 'acik');
      expect(scrollTop).toBe(140 + 48 - (61 + 50));
      vv.height = 320;
      act(() => { vv.dispatchEvent(new Event('resize')); });
      expect(sheetRoot()).not.toHaveAttribute('data-klavye');
    });

    it('alanın sonradan çalışan kendi kaydırması gövdede görünür bölümden çıkarırsa katman sonraki karede yeniden getirir', () => {
      installViewport({ width: 568, height: 320, coarse: true });
      const vv = Object.assign(new EventTarget(), { width: 568, height: 320, offsetTop: 0, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
      const frames: FrameRequestCallback[] = [];
      const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
      try {
        render(<BottomSheet title={title}><input aria-label="Ara" /></BottomSheet>);
        const field = screen.getByRole('textbox', { name: 'Ara' });
        field.focus();
        const govde = document.querySelector('.aile-sheet-govde') as HTMLElement;
        let scrollTop = 0;
        Object.defineProperty(govde, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
        const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 568, width: 568, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
        vi.spyOn(govde, 'getBoundingClientRect').mockImplementation(() => rect(61, 50));
        vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() => rect(140 - scrollTop, 48));
        vv.addEventListener('resize', () => { scrollTop = 0; });
        vv.height = 176;
        act(() => { vv.dispatchEvent(new Event('resize')); });
        expect(scrollTop).toBe(0);
        act(() => { for (const callback of frames.splice(0)) callback(performance.now()); });
        expect(scrollTop).toBe(140 + 48 - (61 + 50));
      } finally {
        raf.mockRestore();
      }
    });

    it('iki parmak yakınlaştırmada (scale ≠ 1) katman görünüm alanına göre kalır', () => {
      installViewport({ width: 320, height: 568 });
      const vv = Object.assign(new EventTarget(), { width: 160, height: 284, offsetTop: 100, offsetLeft: 0, scale: 2 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
      render(<BottomSheet title={title}><p>{body}</p></BottomSheet>);
      expect(sheetRoot()!.style.getPropertyValue('--katman-alt')).toBe('0px');
      expect(sheetRoot()!.style.getPropertyValue('--katman-ust')).toBe('0px');
    });
  });

  describe('kaynak sözleşmesi', () => {
    it('telefon yolu antd\'siz: statik import kapanışında antd, @ant-design, ui/antd, echarts ve .wide yok', () => {
      const { files, packages } = staticClosure('BottomSheet.tsx');
      expect(packages.filter(name => /^(antd|@ant-design\/|echarts|zrender)/.test(name))).toEqual([]);
      expect(files.filter(file => /ui\/antd\.ts$|\.wide\.|\/wide\//.test(file))).toEqual([]);
      // Phosphor simge başına alt yoldan gelir (ui/icons, dist/csr/<Ad>); ikon grubu yalnız @ant-design/icons'tur.
      expect(packages.filter(name => !/^(react|react-dom|react\/jsx-runtime|@phosphor-icons\/react(\/dist\/csr\/[A-Za-z]+)?)$/.test(name))).toEqual([]);
    });

    it('CSS: en çok %85, alt güvenli alan, yalnız --aile tokenları, odak halkası yok', () => {
      const code = css();
      expect(code).toMatch(/max-height:\s*85d?vh/);
      expect(code).toContain('env(safe-area-inset-bottom');
      expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(code).not.toMatch(/rgba?\(/);
      expect(code).not.toMatch(/outline\s*:(?!\s*none)/);
      expect(code).not.toMatch(/box-shadow\s*:(?!\s*(none|var\(--aile-golge-yukseltilmis\)))/);
    });

    it('CSS hareketi: yalnız 240 ms proje eğrisi (token), açık özellik listesi, reduced-motion\'da geçiş yok', () => {
      const code = css();
      const transitions = [...code.matchAll(/transition\s*:\s*([^;]+);/g)].map(match => match[1].trim());
      expect(transitions.length).toBeGreaterThan(0);
      for (const value of transitions) {
        if (value === 'none') continue;
        for (const part of value.split(/,(?![^(]*\))/)) {
          expect(part.trim(), value).toMatch(/^[a-z-]+ var\(--aile-sure\) var\(--aile-egri\)$/);
          expect(part.trim()).not.toMatch(/^all\b/);
        }
      }
      const reduced = /@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/.exec(code);
      expect(reduced).not.toBeNull();
      expect(reduced![1]).toContain('.aile-sheet-sarmal');
      expect(reduced![1]).toContain('.aile-sheet-ortu');
      expect(reduced![1]).toContain('.aile-sheet-kapat');
      expect(reduced![1]).toMatch(/transition:\s*none/);
      // Sürükleme sırasında geçiş yok (parmağı izler); bırakınca geçiş geri gelir.
      expect(code).toMatch(/\.aile-sheet-sarmal\[data-surukleniyor\][^{]*{[^}]*transition:\s*none/);
    });

    it('CSS dokunma ve kaydırma: başlık touch-action none (sürükleme), gövde iç kaydırma zinciri kopuk; hedef 44, coarse 48', () => {
      const code = css();
      expect(code).toMatch(/\.aile-sheet-ust\s*{[^}]*touch-action:\s*none/);
      expect(code).toMatch(/\.aile-sheet-govde\s*{[^}]*overflow:\s*auto[^}]*}/);
      expect(code).toMatch(/\.aile-sheet-govde\s*{[^}]*overscroll-behavior:\s*contain/);
      // Hedef tek merkezi uyarlamalı tokendan: --aile-dokunma-hedefi 44, data-input-coarse katmanında 48 (admin.css, b04).
      expect(code).toMatch(/\.aile-sheet-kapat\s*{[^}]*min-height:\s*var\(--aile-dokunma-hedefi, var\(--aile-hedef-asgari\)\)/);
      expect(code).toMatch(/\.aile-sheet-kapat\s*{[^}]*min-width:\s*var\(--aile-dokunma-hedefi, var\(--aile-hedef-asgari\)\)/);
      expect(code).not.toMatch(/data-input-coarse/);
    });

    it('CSS odak: yerel kopya yok; tek alt çizgiyi merkezi admin.css çizer ([data-aile-katman] / .aile-admin kapsamı)', () => {
      const code = css();
      expect(code).not.toMatch(/:focus(-visible|-within)?::after/);
      expect(code).not.toMatch(/(^|[;{\s])content\s*:/);
      expect(code).not.toMatch(/data-keyboard/);
      expect(code).not.toMatch(/--aile-odak\b/);
    });

    it('CSS sanal klavye (data-klavye): sarmal görünür alanın tamamını alır, tutamaç gizlenir, boşluklar bosluk-2 (sık yoğunluk)', () => {
      const code = css();
      expect(code).toMatch(/\.aile-sheet\[data-klavye\] \.aile-sheet-sarmal\s*{[^}]*max-height:\s*100%/);
      expect(code).toMatch(/\.aile-sheet\[data-klavye\] \.aile-sheet-tutamac\s*{[^}]*display:\s*none/);
      expect(code).toMatch(/\.aile-sheet\[data-klavye\] \.aile-sheet-ust\s*{[^}]*padding-top:\s*var\(--aile-bosluk-2\)/);
      expect(code).toMatch(/\.aile-sheet\[data-klavye\] \.aile-sheet-govde\s*{[^}]*gap:\s*var\(--aile-bosluk-2\)/);
      expect(code).toMatch(/\.aile-sheet\[data-klavye\] \.aile-sheet-govde\s*{[^}]*padding:\s*var\(--aile-bosluk-2\) var\(--aile-bosluk-4\)/);
      expect(code).toMatch(/\.aile-sheet\[data-klavye\] \.aile-sheet-altlik\s*{[^}]*padding:\s*var\(--aile-bosluk-2\) var\(--aile-bosluk-4\)/);
    });

    it('CSS metin: hiçbir yazı boyutu 14 CSS px altına inmez', () => {
      const sizes = [...css().matchAll(/font-size:\s*([^;]+);/g)].map(match => match[1].trim());
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) {
        const px = /^(\d+(?:\.\d+)?)px$/.exec(size);
        expect(px, size).not.toBeNull();
        expect(Number(px![1])).toBeGreaterThanOrEqual(14);
      }
    });
  });
});
