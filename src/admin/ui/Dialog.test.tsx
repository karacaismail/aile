import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { tokens } from '../../design/tokens.ts';
import { installViewport } from '../adaptive/testing';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { DIALOG_WIDTH, Dialog } from './Dialog';

// Tasarım: components/Dialog/README.md (ortalı, en çok 560 px, kose-panel, golge-yukseltilmis, h2 başlık, alert) +
// BottomSheet/README.md (telefonda alttan açılır, tutamaç, görünür "Kapat", %85, safe-area) + bundle.js useModal.
// Sözleşme (a04): iki sunum da yerel HTML + ARIA APG "Dialog (Modal)" / "Alert Dialog"; antd yok. Telefonda alt sayfa,
// genişte ortalı panel. Odak tuzağı, ilk odak başlıkta (tehlikeli eylem asla), Escape, açan öğeye dönüş, arka plan
// inert, kaydırma kilidi, sanal klavye (visualViewport), Pointer Events ile örtü dokunuşu ve iptali, iki yönlü hareket.

const title = 'Alımı sil';
const body = 'Bu alım kaynaktan silinmez; yalnız yerel değişiklik kümesine yazılır.';

function inDevice(ui: ReactNode, device: Device) {
  return <DeviceContext.Provider value={device}>{ui}</DeviceContext.Provider>;
}

interface HarnessProps {
  device?: Device;
  alert?: boolean;
  footer?: ReactNode;
  onClose?: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  children?: ReactNode;
}

/** Sayfa gibi: açan düğme + arka plan öğeleri; diyalog koşullu çizilir (HesaplarPage/SozluklerPage kalıbı). */
function Harness({ device = 'desktop', alert, footer, onClose, initialFocus, children }: HarnessProps) {
  const [open, setOpen] = useState(false);
  return inDevice(
    <>
      <main>
        <button type="button" onClick={() => setOpen(true)}>Diyaloğu aç</button>
        <a href="#arka">Arka plan bağlantısı</a>
      </main>
      {open ? (
        <Dialog title={title} alert={alert} footer={footer} initialFocus={initialFocus} onClose={() => { onClose?.(); setOpen(false); }}>
          {children ?? body}
        </Dialog>
      ) : null}
    </>,
    device,
  );
}

const confirmFooter = <><button type="button">Vazgeç</button><button type="button">Sil</button></>;
const rootOf = (element: Element) => element.closest('.aile-dialog') as HTMLElement;
const scrim = () => document.querySelector('.aile-dialog-ortu') as HTMLElement;

let originalMatchMedia: typeof window.matchMedia;
beforeEach(() => { originalMatchMedia = window.matchMedia; });
afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  // Kapanış kopyaları (hareket testleri) React'e ait değildir; sonraki teste taşınmasın.
  document.querySelectorAll('.aile-dialog').forEach(node => node.remove());
});

describe('Dialog › kaynak', () => {
  // Telefon profili antd istemez: Dialog.tsx ve statik import kapanışında antd, @ant-design/* ya da ui/antd.ts yok;
  // geniş-özel (*.wide) modül de statik çekilmez. Tür importları (import type) çalışma zamanına girmez, sayılmaz.
  it('Dialog.tsx statik import kapanışı antd, @ant-design/*, ./antd ve *.wide içermez', () => {
    const start = resolve(__dirname, 'Dialog.tsx');
    const seen = new Set<string>();
    const bare = new Set<string>();
    const local: string[] = [];
    const resolveLocal = (from: string, spec: string) => {
      const base = resolve(dirname(from), spec);
      return ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map(ext => base + ext).find(path => existsSync(path) && !path.endsWith('/'));
    };
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const statements = source.matchAll(/^\s*(import|export)\s+(?!type\b)([^;]*?)['"]([^'"]+)['"]/gm);
      for (const [, , clause, spec] of statements) {
        if (/^\s*\{[^}]*\}\s*from\s*$/.test(clause) && /^\s*\{\s*(type\s+\w+\s*,?\s*)+\}/.test(clause)) continue;
        if (spec.endsWith('.css')) continue;
        if (!spec.startsWith('.')) { bare.add(spec); continue; }
        const target = resolveLocal(file, spec);
        if (!target || !/\.(ts|tsx)$/.test(target)) continue;
        local.push(relative(resolve(__dirname, '..'), target));
        walk(target);
      }
    };
    walk(start);
    expect([...bare].filter(spec => spec === 'antd' || spec.startsWith('antd/') || spec.startsWith('@ant-design/'))).toEqual([]);
    expect(local.filter(path => path === 'ui/antd.ts')).toEqual([]);
    expect(local.filter(path => /\.wide\.|\/wide\//.test(path))).toEqual([]);
  });

  it('Dialog.css: renk/boşluk/köşe/gölge/hareket yalnız --aile-* tokenı; tek eğri, iki yönlü hareket, reduced-motion', () => {
    const css = readFileSync(resolve(__dirname, 'Dialog.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Renk değişmezi yok (hex/rgb/hsl); renkler token.
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
    // Hareket: her transition süre ve eğriyi tokendan alır; yasak eğri/süre yok.
    const transitions = [...css.matchAll(/transition\s*:\s*([^;]+);/g)].map(m => m[1].trim()).filter(v => v !== 'none');
    expect(transitions.length).toBeGreaterThan(0);
    for (const value of transitions) {
      for (const part of value.split(',')) {
        expect(part).toContain('var(--aile-sure)');
        expect(part).toContain('var(--aile-egri)');
      }
      expect(value).not.toMatch(/\b(linear|ease-in|ease-out|ease-in-out|steps)\b|\ball\b|\b0m?s\b/);
    }
    // Giriş ve çıkış aynı kural: açılış ve kapanış durumu tek seçicide.
    expect(css).toMatch(/\[data-state='opening'\][^{]*\[data-state='closing'\]|\[data-state='closing'\][^{]*\[data-state='opening'\]/);
    // reduced-motion dalında geçiş kapalı.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition\s*:\s*none/);
    // Odak (W0 b04): halka yok; tek alt çizgiyi admin.css merkezi kuralı [data-focus-line] taşıyıcısında çizer
    // (klavye modu + :focus-visible, forced-colors istisnası dahil). ::after odak çizgisine ayrılmıştır: Dialog.css
    // kendi ::after'ını, outline'ını ya da halka gölgesini yazmaz.
    expect(css).not.toMatch(/::after|\boutline\s*:|box-shadow\s*:\s*0 0 0/);
    // Metin en az 14 px.
    for (const m of css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(14);
    // Dokunma hedefi (W0 b04): --aile-dokunma-hedefi 44 px, kaba giriş katmanında admin.css 48 px yapar; bileşen
    // kendi coarse hesabını yazmaz.
    expect(css).toMatch(/min-height\s*:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).toMatch(/min-width\s*:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).not.toContain('--aile-hedef-asgari');
    // Güvenli alan tokenları (--aile-safe-*; env() tek kaynağı admin.css) ve sanal klavye (visualViewport → CSS değişkeni).
    expect(css).toContain('var(--aile-safe-bottom)');
    expect(css).not.toMatch(/env\(safe-area/);
    expect(css).toContain('var(--aile-dialog-yukseklik');
    // Katman: sabit sayı yok; kök z-index'i satır içi --aile-dialog-katman'dan (tokens.layerDropdown) alır.
    expect(css).toMatch(/z-index\s*:\s*var\(--aile-dialog-katman\)/);
    for (const m of css.matchAll(/z-index\s*:\s*([^;]+);/g)) expect(['var(--aile-dialog-katman)', 'auto']).toContain(m[1].trim());
    // Kavisli vurgu kenarı yok: tek kenar renkli kenarlık yalnız düz ayırıcı (cizgi) olabilir.
    for (const m of css.matchAll(/border-(?:left|right|inline-start|inline-end)\s*:/g)) expect(m).toBeNull();
  });
});

describe('Dialog › sunum', () => {
  it('telefonda yerel alt sayfa: role dialog, aria-modal, aria-labelledby → h2, tutamaç ve görünür "Kapat"', () => {
    render(inDevice(<Dialog title={title}>{body}</Dialog>, 'phone'));
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const heading = screen.getByRole('heading', { level: 2, name: title });
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
    const root = rootOf(dialog);
    expect(root).toHaveClass('aile-dialog--sheet');
    // Portal: body'nin doğrudan çocuğu (açılış sırası = yığın sırası); kapsam .aile-admin kurallarını alır.
    expect(root.parentElement).toBe(document.body);
    expect(root).toHaveClass('aile-admin');
    expect(root.querySelector('.aile-dialog-tutamac')).toHaveAttribute('aria-hidden', 'true');
    // W0 odak kancaları: kök yerel katmandır; Kapat ve başlık tek alt çizginin taşıyıcısıdır (admin.css).
    expect(root).toHaveAttribute('data-aile-katman', 'dialog');
    expect(heading).toHaveAttribute('data-focus-line');
    const close = screen.getByRole('button', { name: 'Kapat' });
    expect(close).toHaveAttribute('data-focus-line');
    expect(close).toHaveTextContent('Kapat');
    expect(close).toHaveAttribute('type', 'button');
    expect(screen.getByText(body)).toBeInTheDocument();
    // antd yok.
    expect(document.querySelector('[class*="ant-"]')).toBeNull();
  });

  it('masaüstünde ortalı panel: en çok 560 px (README), simgeli Kapat aria-label ile', () => {
    render(inDevice(<Dialog title={title}>{body}</Dialog>, 'desktop'));
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const root = rootOf(dialog);
    expect(root).toHaveClass('aile-dialog--center');
    expect(DIALOG_WIDTH).toBe(560);
    expect(root.style.getPropertyValue('--aile-dialog-genislik')).toBe('560px');
    const close = screen.getByRole('button', { name: 'Kapat' });
    expect(close).toHaveAttribute('aria-label', 'Kapat');
    expect(close.textContent).toBe('');
    expect(root.querySelector('.aile-dialog-tutamac')).toBeNull();
    // footer verilmedi: yalnız Kapat.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  // Katman tabanı antd temasıyla tek kaynak (theme/antdTheme zIndexPopupBase = tokens.layerDropdown): diyaloğun
  // içinden açılan açılır liste (taban + 50) ve alt sayfa (taban, DOM'da sonra) diyaloğun üstünde kalır.
  it('kök katmanı tokens.layerDropdown: içeriden açılan açılır katmanların altında kalır', () => {
    render(inDevice(<Dialog title={title}>{body}</Dialog>, 'desktop'));
    const root = rootOf(screen.getByRole('dialog', { name: title }));
    expect(root.style.getPropertyValue('--aile-dialog-katman')).toBe(String(tokens.layerDropdown));
  });

  it('tablette de ortalı panel kalır', () => {
    render(inDevice(<Dialog title={title}>{body}</Dialog>, 'tablet'));
    expect(rootOf(screen.getByRole('dialog', { name: title }))).toHaveClass('aile-dialog--center');
  });

  it('alert: role alertdialog, aria-describedby gövdeye bağlı', () => {
    render(inDevice(<Dialog title={title} alert>{body}</Dialog>, 'desktop'));
    const dialog = screen.getByRole('alertdialog', { name: title });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('altlık düğme sırasıyla çizilir: Kapat, Vazgeç, Sil', () => {
    render(inDevice(<Dialog title={title} footer={confirmFooter}>{body}</Dialog>, 'desktop'));
    const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Kapat', 'Vazgeç', 'Sil']);
  });

  it('open=false iken hiçbir şey çizmez (telefon ve masaüstü)', () => {
    const { rerender } = render(inDevice(<Dialog title={title} open={false}>{body}</Dialog>, 'phone'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(title)).toBeNull();
    rerender(inDevice(<Dialog title={title} open={false}>{body}</Dialog>, 'desktop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('inline: yerinde çizilir (portal yok), kip dışı önizleme: aria-modal yok, arka plan inert değil', () => {
    const { container } = render(inDevice(<div><p>Önizleme alanı</p><Dialog title={title} inline>{body}</Dialog></div>, 'desktop'));
    const dialog = screen.getByRole('dialog', { name: title });
    expect(container.contains(dialog)).toBe(true);
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('açıkken profil değişince sunum değişir, odaklı Kapat düğmesi korunur (yeniden bağlanmaz)', async () => {
    const user = userEvent.setup();
    const { rerender } = render(inDevice(<Dialog title={title}>{body}</Dialog>, 'phone'));
    await user.tab();
    const close = screen.getByRole('button', { name: 'Kapat' });
    expect(close).toHaveFocus();
    rerender(inDevice(<Dialog title={title}>{body}</Dialog>, 'desktop'));
    expect(screen.getByRole('button', { name: 'Kapat' })).toBe(close);
    expect(close).toHaveFocus();
    expect(rootOf(close)).toHaveClass('aile-dialog--center');
  });
});

describe('Dialog › odak ve klavye (APG)', () => {
  it('ilk odak başlıkta (tabindex -1); onay diyaloğunda tehlikeli eylem odak almaz', async () => {
    const user = userEvent.setup();
    render(<Harness alert footer={confirmFooter} />);
    await user.click(screen.getByRole('button', { name: 'Diyaloğu aç' }));
    const heading = screen.getByRole('heading', { level: 2, name: title });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Sil' })).not.toHaveFocus();
  });

  it('initialFocus verilirse açılışta o öğe odak alır', async () => {
    function WithField() {
      const field = useRef<HTMLInputElement>(null);
      return <Harness initialFocus={field}><label>Terim adı <input ref={field} /></label></Harness>;
    }
    const user = userEvent.setup();
    render(<WithField />);
    await user.click(screen.getByRole('button', { name: 'Diyaloğu aç' }));
    expect(screen.getByRole('textbox', { name: 'Terim adı' })).toHaveFocus();
  });

  it('Tab ve Shift+Tab diyalog içinde döner (odak tuzağı); arka plana çıkmaz', async () => {
    const user = userEvent.setup();
    render(<Harness footer={confirmFooter} />);
    await user.click(screen.getByRole('button', { name: 'Diyaloğu aç' }));
    const close = screen.getByRole('button', { name: 'Kapat' });
    const cancel = screen.getByRole('button', { name: 'Vazgeç' });
    const destroy = screen.getByRole('button', { name: 'Sil' });
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(destroy).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(destroy).toHaveFocus();
    // Başlıktan geri: son öğeye.
    screen.getByRole('heading', { level: 2, name: title }).focus();
    await user.tab({ shift: true });
    expect(destroy).toHaveFocus();
  });

  it('Escape onClose çağırır ve odak açan düğmeye döner', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Diyaloğu aç' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  // Safari/WebKit fareyle ya da dokunarak basılan düğmeye odak vermez: açılışta document.activeElement body'dir.
  // Açan öğe o durumda son birincil basışın hedefidir; klavye kullanımı (keydown) bu kaydı geçersiz kılar.
  it('odaklanmadan basılan açan düğmeye de dönülür (Safari: tıklama düğmeye odak vermez)', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Diyaloğu aç' });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.pointerDown(opener, { pointerId: 4, isPrimary: true, button: 0, pointerType: 'mouse' });
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('Safari: başka bir öğe (ör. rota değişiminde odaklanan main) odaklıyken basılan düğme açan sayılır', () => {
    render(<Harness />);
    const main = screen.getByRole('main');
    main.tabIndex = -1;
    main.focus();
    const opener = screen.getByRole('button', { name: 'Diyaloğu aç' });
    fireEvent.pointerDown(opener, { pointerId: 6, isPrimary: true, button: 0, pointerType: 'touch' });
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(opener).toHaveFocus();
  });

  // WebKit fareyle basılan, fareyle odak almayan düğmede odağı en yakın odaklanabilir ataya verir (mousedown →
  // focusin main#admin-content, tabindex -1). Bu ata odağı basışı geçersiz kılmaz; açan yine basılan düğmedir.
  it('Safari: basışta odak basılan düğmenin atasına (main) geçse de açan basılan düğmedir', () => {
    render(<Harness />);
    const main = screen.getByRole('main');
    main.tabIndex = -1;
    (document.activeElement as HTMLElement | null)?.blur();
    const opener = screen.getByRole('button', { name: 'Diyaloğu aç' });
    fireEvent.pointerDown(opener, { pointerId: 12, isPrimary: true, button: 0, pointerType: 'mouse' });
    main.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(opener).toHaveFocus();
  });

  it('basıştan sonra odak başka öğeye geçerse basış hedefi açan sayılmaz', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Diyaloğu aç' });
    const link = screen.getByRole('link', { name: 'Arka plan bağlantısı' });
    fireEvent.pointerDown(opener, { pointerId: 9, isPrimary: true, button: 0, pointerType: 'mouse' });
    link.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(link).toHaveFocus();
  });

  it('klavye kullanımından sonra eski basış hedefi açan sayılmaz', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Diyaloğu aç' });
    fireEvent.pointerDown(opener, { pointerId: 5, isPrimary: true, button: 0, pointerType: 'mouse' });
    fireEvent.keyDown(document.body, { key: 'a' });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(opener).not.toHaveFocus();
  });

  it('Kapat düğmesi (Enter ve Space) kapatır; odak açan düğmeye döner', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Diyaloğu aç' });
    await user.click(opener);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.keyboard(' ');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(opener).toHaveFocus();
  });

  it('açık açılır listesi olan combobox içinde Escape diyaloğu kapatmaz (önce açılır liste kapanır)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Harness onClose={onClose}>
        <input role="combobox" aria-label="Sözlük" aria-expanded="true" aria-controls="liste" />
      </Harness>,
    );
    await user.click(screen.getByRole('button', { name: 'Diyaloğu aç' }));
    screen.getByRole('combobox', { name: 'Sözlük' }).focus();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  // Tarayıcıda React ayrık olay güncellemesini dinleyiciler arasında uygular: listeyi kapatan combobox aria-expanded'ı
  // diyaloğun belge dinleyicisinden önce "false" yapabilir (preventDefault çağırmadan). Sahiplik olayın başında
  // (yakalama aşaması) okunur; aynı Escape diyaloğu kapatmaz.
  it('combobox Escape ile listesini kapatıp aria-expanded=false yazsa da aynı Escape diyaloğu kapatmaz', async () => {
    function ClosingCombobox() {
      const [expanded, setExpanded] = useState(true);
      return (
        <input
          role="combobox"
          aria-label="Sözlük"
          aria-controls="liste"
          aria-expanded={expanded}
          ref={node => {
            if (!node || node.dataset.dinleyici) return;
            node.dataset.dinleyici = '1';
            node.addEventListener('keydown', event => {
              if (event.key !== 'Escape') return;
              node.setAttribute('aria-expanded', 'false');
              setExpanded(false);
            });
          }}
        />
      );
    }
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose}><ClosingCombobox /></Harness>);
    await user.click(screen.getByRole('button', { name: 'Diyaloğu aç' }));
    const combo = screen.getByRole('combobox', { name: 'Sözlük' });
    combo.focus();
    await user.keyboard('{Escape}');
    expect(combo).toHaveAttribute('aria-expanded', 'false');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    // Liste kapalıyken ikinci Escape diyaloğu kapatır.
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('denetimli open=false: odak açan öğeye, returnFocusTo verilirse oraya döner', async () => {
    function Controlled() {
      const [open, setOpen] = useState(false);
      const target = useRef<HTMLButtonElement>(null);
      return inDevice(
        <>
          <button type="button" onClick={() => setOpen(true)}>Aç</button>
          <button type="button" ref={target}>Hedef</button>
          <Dialog title={title} open={open} returnFocusTo={target} onClose={() => setOpen(false)}>{body}</Dialog>
        </>,
        'desktop',
      );
    }
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Aç' }));
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hedef' })).toHaveFocus();
  });

  it('iç içe diyalog: Escape yalnız üsttekini kapatır; odak dış diyalogdaki açan düğmeye döner', async () => {
    function Nested() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(false);
      return inDevice(
        <>
          <button type="button">Sayfa</button>
          {outer ? (
            <Dialog title="Dış" onClose={() => setOuter(false)}>
              <button type="button" onClick={() => setInner(true)}>İç diyaloğu aç</button>
              {inner ? <Dialog title="İç" onClose={() => setInner(false)}>İç gövde</Dialog> : null}
            </Dialog>
          ) : null}
        </>,
        'desktop',
      );
    }
    const user = userEvent.setup();
    render(<Nested />);
    const innerOpener = screen.getByRole('button', { name: 'İç diyaloğu aç' });
    await user.click(innerOpener);
    const outerRoot = rootOf(screen.getByRole('dialog', { name: 'Dış' }));
    expect(outerRoot).toHaveAttribute('inert');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'İç' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Dış' })).toBeInTheDocument();
    expect(outerRoot).not.toHaveAttribute('inert');
    expect(innerOpener).toHaveFocus();
    // Sayfa hâlâ dış diyaloğun arkasında inert.
    expect(screen.getByRole('button', { name: 'Sayfa' }).closest('[inert]')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
  });
});

describe('Dialog › arka plan, kaydırma, dokunma', () => {
  it('açıkken arka plan inert ve sayfa kaydırması kilitli; kapanınca ikisi de geri alınır', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'auto';
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Diyaloğu aç' });
    await user.click(opener);
    expect(opener.closest('[inert]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Arka plan bağlantısı' }).closest('[inert]')).not.toBeNull();
    expect(rootOf(screen.getByRole('dialog')).closest('[inert]')).toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });

  it('telefonda örtüye dokunma (pointerdown → click) kapatır; pointercancel iptal eder', () => {
    const onClose = vi.fn();
    render(inDevice(<Dialog title={title} onClose={onClose}>{body}</Dialog>, 'phone'));
    // İptal: kaydırma/hareket tarayıcıda pointercancel üretir; ardından gelen click kapatmaz.
    fireEvent.pointerDown(scrim(), { pointerId: 7, isPrimary: true, button: 0, pointerType: 'touch' });
    fireEvent.pointerCancel(scrim(), { pointerId: 7, isPrimary: true, pointerType: 'touch' });
    fireEvent.click(scrim());
    expect(onClose).not.toHaveBeenCalled();
    // Basılmadan gelen click (ör. sentetik) kapatmaz.
    fireEvent.click(scrim());
    expect(onClose).not.toHaveBeenCalled();
    // Gerçek dokunuş.
    fireEvent.pointerDown(scrim(), { pointerId: 8, isPrimary: true, button: 0, pointerType: 'touch' });
    fireEvent.pointerUp(scrim(), { pointerId: 8, isPrimary: true, button: 0, pointerType: 'touch' });
    fireEvent.click(scrim());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('telefonda ikincil düğme ve birincil olmayan dokunuş örtüyü kapatmaz', () => {
    const onClose = vi.fn();
    render(inDevice(<Dialog title={title} onClose={onClose}>{body}</Dialog>, 'phone'));
    fireEvent.pointerDown(scrim(), { pointerId: 2, isPrimary: true, button: 2, pointerType: 'mouse' });
    fireEvent.click(scrim());
    fireEvent.pointerDown(scrim(), { pointerId: 3, isPrimary: false, button: 0, pointerType: 'touch' });
    fireEvent.click(scrim());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('masaüstünde örtüye tıklama kapatmaz (README/referans: ortadaki diyalogda örtü kapatıcı değil)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(inDevice(<Dialog title={title} onClose={onClose}>{body}</Dialog>, 'desktop'));
    await user.click(scrim());
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sanal klavye: visualViewport küçülünce kök görünür alana oturur, odaklı alan görünüme kayar', () => {
    const viewport = Object.assign(new EventTarget(), { height: 568, width: 320, offsetTop: 0, offsetLeft: 0, scale: 1 });
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 568 });
    try {
      render(inDevice(<Dialog title={title}><label>Terim adı <input /></label></Dialog>, 'phone'));
      const root = rootOf(screen.getByRole('dialog'));
      expect(root).not.toHaveAttribute('data-klavye');
      const field = screen.getByRole('textbox', { name: 'Terim adı' });
      field.focus();
      const scrolled = vi.spyOn(field, 'scrollIntoView');
      act(() => {
        viewport.height = 300;
        viewport.dispatchEvent(new Event('resize'));
      });
      expect(root).toHaveAttribute('data-klavye', 'acik');
      expect(root.style.getPropertyValue('--aile-dialog-yukseklik')).toBe('300px');
      expect(root.style.getPropertyValue('--aile-dialog-ust')).toBe('0px');
      expect(scrolled).toHaveBeenCalled();
      // Yakınlaştırma (pinch zoom) klavye sayılmaz: yerleşim daralmaz.
      act(() => {
        viewport.scale = 2;
        viewport.dispatchEvent(new Event('resize'));
      });
      expect(root).not.toHaveAttribute('data-klavye');
      expect(root.style.getPropertyValue('--aile-dialog-yukseklik')).toBe('');
    } finally {
      if (original) Object.defineProperty(window, 'visualViewport', original);
      else delete (window as { visualViewport?: unknown }).visualViewport;
    }
  });
});

describe('Dialog › hareket', () => {
  // jsdom'da Web Animations yok; kapanış kopyası yalnız getAnimations varken oynar. Test süresince taklit edilir.
  const proto = Element.prototype as unknown as { getAnimations?: () => unknown[] };
  let originalGetAnimations: typeof proto.getAnimations;
  beforeEach(() => { originalGetAnimations = proto.getAnimations; });
  afterEach(() => {
    if (originalGetAnimations) proto.getAnimations = originalGetAnimations;
    else delete proto.getAnimations;
  });

  it('açılış durumu "open"; kapanışta anlamsal durum anında, sunum 240 ms çıkışta (aria-hidden, inert, kimliksiz hayalet)', async () => {
    let finish = () => {};
    const finished = new Promise<void>(done => { finish = done; });
    proto.getAnimations = () => [{ finished }];
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Diyaloğu aç' });
    await user.click(opener);
    expect(rootOf(screen.getByRole('dialog'))).toHaveAttribute('data-state', 'open');
    await user.keyboard('{Escape}');
    // Anlamsal: diyalog erişilebilirlik ağacından çıktı, odak döndü, arka plan serbest.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    expect(opener.closest('[inert]')).toBeNull();
    // Sunum: kapanan kopya hareketini bitirene dek kalır; etkileşimsiz ve gizli.
    const ghost = document.querySelector('.aile-dialog') as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(ghost).toHaveAttribute('data-state', 'closing');
    expect(ghost).toHaveAttribute('aria-hidden', 'true');
    expect(ghost).toHaveAttribute('inert');
    expect(ghost.querySelectorAll('[id]')).toHaveLength(0);
    await act(async () => {
      finish();
      await finished;
    });
    expect(document.querySelector('.aile-dialog')).toBeNull();
  });

  it('reduced-motion: kapanışta hayalet yok, katman anında kalkar', async () => {
    proto.getAnimations = () => [{ finished: new Promise(() => {}) }];
    installViewport({ width: 390, height: 844, reducedMotion: true });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Diyaloğu aç' }));
    expect(rootOf(screen.getByRole('dialog'))).toHaveAttribute('data-state', 'open');
    await user.keyboard('{Escape}');
    expect(document.querySelector('.aile-dialog')).toBeNull();
  });
});
