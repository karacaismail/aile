import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { DANGER_GROUP_LABEL } from './Menu';
import { DEFAULT_LABEL, DEFAULT_TITLE, OverflowActions, OVERFLOW_MENU_MIN_WIDTH, type OverflowActionItem } from './OverflowActions';

// Tasarım: components/OverflowActions/README.md + index.d.ts OverflowActionsProps + bundle.js OverflowActions.
// "Diğer": birincil eylem dışındaki eylemler; telefonda alttan sayfa, geniş ekranda açılır menü (Menu menü düğmesi kalıbı).
// Ana eylem (primary) her zaman dışarıda kalır; tehlikeli eylem ayrı grupta; collapse="auto" dar alanda menüye taşır.
//
// Telefonda liste BottomSheet içinde açılır. BottomSheet ayrı görevde (a05) yazılır; burada yalnız sözleşmesi taklit edilir.
vi.mock('./BottomSheet', () => ({
  BottomSheet: (p: { title: string; children?: ReactNode; onClose?: () => void; open?: boolean; inline?: boolean }) =>
    p.open === false ? null : (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={p.title}
        data-testid="alt-sayfa"
        data-inline={String(p.inline)}
        onKeyDown={event => { if (event.key === 'Escape') p.onClose?.(); }}
      >
        <button type="button" onClick={p.onClose}>Kapat</button>
        {p.children}
      </div>
    ),
}));

const onDevice = (device: Device) => ({ children }: { children: ReactNode }) =>
  <DeviceContext.Provider value={device}>{children}</DeviceContext.Provider>;

function makeItems() {
  const duzenle = vi.fn();
  const disaAktar = vi.fn();
  const sil = vi.fn();
  const items: readonly OverflowActionItem[] = [
    { label: 'Düzenle', icon: 'edit', onClick: duzenle },
    { label: 'Sil', onClick: sil, danger: true },
    { label: 'Dışa aktar', icon: 'download', onClick: disaAktar },
  ];
  return { items, duzenle, disaAktar, sil };
}

describe('OverflowActions › geniş profil (açılır menü)', () => {
  const wrapper = onDevice('desktop');

  it('text "Diğer" button: aria-haspopup=menu, closed by default, nothing drawn', () => {
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    const trigger = screen.getByRole('button', { name: DEFAULT_LABEL });
    expect(DEFAULT_LABEL).toBe('Diğer');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Diğer');
    expect(trigger.querySelector('[data-icon="more"]')).not.toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('label and title can be customised', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} label="Daha fazla" title="Alım eylemleri" />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Daha fazla' }));
    expect(screen.getByRole('menu', { name: 'Alım eylemleri' })).toBeInTheDocument();
  });

  it('opens a menu named "Diğer eylemler": ordered menuitems with icons, the danger action last in its own group', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: DEFAULT_TITLE });
    const menuItems = within(menu).getAllByRole('menuitem');
    expect(menuItems.map(item => item.textContent)).toEqual(['Düzenle', 'Dışa aktar', 'Sil']);
    expect(menuItems[0].querySelector('[data-icon="edit"]')).not.toBeNull();
    expect(menuItems[1].querySelector('[data-icon="download"]')).not.toBeNull();
    expect(menuItems[2].querySelector('[data-icon]')).toBeNull();
    const danger = within(menu).getByRole('group', { name: DANGER_GROUP_LABEL });
    expect(within(danger).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Sil']);
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
  });

  it('the panel is at least 240 px wide (design bundle.css .ai-pop) and aligned to the end', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Diğer' }));
    expect(OVERFLOW_MENU_MIN_WIDTH).toBe(240);
    const panel = screen.getByRole('menu').closest('.aile-overflow-menu');
    expect(panel).not.toBeNull();
    expect(panel).toHaveStyle({ minWidth: `${OVERFLOW_MENU_MIN_WIDTH}px` });
    expect(panel).toHaveAttribute('data-align', 'end');
  });

  it('selecting calls only that onClick once, closes the menu and returns focus to the button first', async () => {
    const user = userEvent.setup();
    const { items, duzenle, disaAktar, sil } = makeItems();
    let focusAtClick: Element | null = null;
    disaAktar.mockImplementation(() => { focusAtClick = document.activeElement; });
    render(<OverflowActions items={items} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    await user.click(trigger);
    await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus());
    await user.click(screen.getByRole('menuitem', { name: 'Dışa aktar' }));
    expect(disaAktar).toHaveBeenCalledTimes(1);
    expect(focusAtClick).toBe(trigger);
    expect(duzenle).not.toHaveBeenCalled();
    expect(sil).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('keyboard: opens on the first item, arrows wrap across groups, Enter selects', async () => {
    const user = userEvent.setup();
    const { items, sil, duzenle } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    screen.getByRole('button', { name: 'Diğer' }).focus();
    await user.keyboard('{Enter}');
    const item = (name: string) => screen.getByRole('menuitem', { name });
    await waitFor(() => expect(item('Düzenle')).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(item('Dışa aktar')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Sil')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Düzenle')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(item('Sil')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(sil).toHaveBeenCalledTimes(1);
    expect(duzenle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Diğer' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape closes without an action and returns focus to the button', async () => {
    const user = userEvent.setup();
    const { items, duzenle, disaAktar, sil } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    await user.click(trigger);
    await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(duzenle).not.toHaveBeenCalled();
    expect(disaAktar).not.toHaveBeenCalled();
    expect(sil).not.toHaveBeenCalled();
  });

  it('a disabled action is announced as disabled and cannot be chosen', async () => {
    const user = userEvent.setup();
    const yazdir = vi.fn();
    render(<OverflowActions items={[{ label: 'Yazdır', onClick: yazdir, disabled: true }, { label: 'Paylaş' }]} />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Diğer' }));
    const disabled = screen.getByRole('menuitem', { name: 'Yazdır' });
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    await user.click(disabled);
    expect(yazdir).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Paylaş' })).toHaveFocus());
  });

  it('open=true starts open; inline draws the panel inside the component', () => {
    const { items } = makeItems();
    const { container } = render(<OverflowActions items={items} open inline />, { wrapper });
    const menu = screen.getByRole('menu', { name: 'Diğer eylemler' });
    expect(container.contains(menu)).toBe(true);
    expect(screen.getByRole('button', { name: 'Diğer' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('tablet uses the menu as well, not the sheet', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper: onDevice('tablet') });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('without items there is no "Diğer" button; the primary stays', () => {
    render(<OverflowActions items={[]} primary={<button type="button">Alım ekle</button>} />, { wrapper });
    expect(screen.getByRole('button', { name: 'Alım ekle' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Diğer' })).toBeNull();
  });
});

describe('OverflowActions › telefon (alt sayfa listesi)', () => {
  const wrapper = onDevice('phone');

  it('"Diğer" has aria-haspopup=dialog; closed by default', () => {
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the sheet: title, menu of items with icons, danger group; selecting calls onClick, closes and returns focus', async () => {
    const user = userEvent.setup();
    const { items, duzenle, disaAktar, sil } = makeItems();
    render(<OverflowActions items={items} title="Alım eylemleri" />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    await user.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'Alım eylemleri' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = within(sheet).getByRole('menu', { name: 'Alım eylemleri' });
    const menuItems = within(menu).getAllByRole('menuitem');
    expect(menuItems.map(item => item.textContent)).toEqual(['Düzenle', 'Dışa aktar', 'Sil']);
    expect(menuItems[0].querySelector('[data-icon="edit"]')).not.toBeNull();
    expect(within(menu).getByRole('group', { name: DANGER_GROUP_LABEL })).toContainElement(menuItems[2]);
    await waitFor(() => expect(menuItems[0]).toHaveFocus());

    await user.click(menuItems[0]);
    expect(duzenle).toHaveBeenCalledTimes(1);
    expect(disaAktar).not.toHaveBeenCalled();
    expect(sil).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('default title "Diğer eylemler"; inline is passed to the sheet', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} inline />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Diğer' }));
    const sheet = screen.getByRole('dialog', { name: 'Diğer eylemler' });
    expect(sheet).toHaveAttribute('data-inline', 'true');
  });

  it('arrows move between menuitems (wrapping), Home/End go to the ends', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Diğer' }));
    const [duzenle, disaAktar, sil] = screen.getAllByRole('menuitem');
    await waitFor(() => expect(duzenle).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(disaAktar).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(sil).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(duzenle).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(sil).toHaveFocus();
    await user.keyboard('{Home}');
    expect(duzenle).toHaveFocus();
    await user.keyboard('{End}');
    expect(sil).toHaveFocus();
  });

  it('Escape (sheet onClose) closes without an action and returns focus', async () => {
    const user = userEvent.setup();
    const { items, duzenle, disaAktar, sil } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    await user.click(trigger);
    await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(duzenle).not.toHaveBeenCalled();
    expect(disaAktar).not.toHaveBeenCalled();
    expect(sil).not.toHaveBeenCalled();
  });

  it('the visible "Kapat" closes as well', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Diğer' }));
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Diğer' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('the primary action stays outside the menu, before "Diğer"', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} primary={<button type="button">Alım ekle</button>} />, { wrapper });
    const primary = screen.getByRole('button', { name: 'Alım ekle' });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    expect(primary.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(trigger);
    expect(within(screen.getByRole('menu')).queryByText('Alım ekle')).toBeNull();
  });
});

describe('OverflowActions › collapse="auto" (dar alanda Diğer menüsüne taşır)', () => {
  type Observed = { callback: ResizeObserverCallback; targets: Element[] };
  let observers: Observed[] = [];
  const OriginalObserver = window.ResizeObserver;
  beforeEach(() => {
    observers = [];
    window.ResizeObserver = class {
      private entry: Observed;
      constructor(callback: ResizeObserverCallback) { this.entry = { callback, targets: [] }; observers.push(this.entry); }
      observe(target: Element) { this.entry.targets.push(target); }
      unobserve() {}
      disconnect() { this.entry.targets = []; }
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => { window.ResizeObserver = OriginalObserver; });
  const notifyResize = () => act(() => {
    for (const observer of observers) if (observer.targets.length) observer.callback([], {} as ResizeObserver);
  });

  it('wide profile with room: secondary actions are buttons, the danger action is in its own group, the primary is last', async () => {
    const user = userEvent.setup();
    const { items, disaAktar } = makeItems();
    render(<OverflowActions items={items} collapse="auto" primary={<button type="button">Alım ekle</button>} />, { wrapper: onDevice('desktop') });
    expect(screen.queryByRole('button', { name: 'Diğer' })).toBeNull();
    const buttons = screen.getAllByRole('button').map(button => button.textContent);
    expect(buttons).toEqual(['Düzenle', 'Dışa aktar', 'Sil', 'Alım ekle']);
    const danger = screen.getByRole('group', { name: DANGER_GROUP_LABEL });
    expect(within(danger).getByRole('button', { name: 'Sil' })).toHaveAttribute('data-variant', 'danger');
    await user.click(screen.getByRole('button', { name: 'Dışa aktar' }));
    expect(disaAktar).toHaveBeenCalledTimes(1);
  });

  it('phone profile: always "Diğer" with the primary outside', () => {
    const { items } = makeItems();
    render(<OverflowActions items={items} collapse="auto" primary={<button type="button">Alım ekle</button>} />, { wrapper: onDevice('phone') });
    expect(screen.getByRole('button', { name: 'Alım ekle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diğer' })).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByRole('button', { name: 'Düzenle' })).toBeNull();
  });

  it('wide profile in a narrow container: overflowing buttons collapse into "Diğer"; they come back when the container grows', () => {
    let parentWidth = 300;
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('aile-overflow--satir') && this.dataset.collapsed === 'false' ? 520 : 0;
    });
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('aile-overflow--satir')) return Math.min(parentWidth, 520);
      if (this.dataset.testid === 'kap') return parentWidth;
      return 0;
    });
    try {
      const { items } = makeItems();
      render(
        <div data-testid="kap"><OverflowActions items={items} collapse="auto" primary={<button type="button">Alım ekle</button>} /></div>,
        { wrapper: onDevice('desktop') },
      );
      expect(screen.getByRole('button', { name: 'Diğer' })).toHaveAttribute('aria-haspopup', 'menu');
      expect(screen.getByRole('button', { name: 'Alım ekle' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Düzenle' })).toBeNull();
      parentWidth = 400;
      notifyResize();
      expect(screen.getByRole('button', { name: 'Diğer' })).toBeInTheDocument();
      parentWidth = 900;
      notifyResize();
      expect(screen.queryByRole('button', { name: 'Diğer' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Düzenle' })).toBeInTheDocument();
    } finally {
      scrollWidth.mockRestore();
      clientWidth.mockRestore();
    }
  });

  // Gerçek tarayıcıda (e2e admin-ui-a06-menu "collapse=auto") esneyen düğmeler etiketi sarıp sıkışıyordu: satır hiç
  // taşmadığı için ölçüm "Diğer"e geçmiyordu. Satırdaki öğeler doğal genişliğinde kalmalıdır.
  it('row items keep their natural width (flex: none) so an overflowing row is measurable', () => {
    const css = readFileSync(resolve(__dirname, 'OverflowActions.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .find(match => match[1].split(',').map(part => part.trim()).includes('.aile-overflow--satir > *'));
    expect(rule?.[2]).toMatch(/flex:\s*none/);
  });
});

describe('OverflowActions › kaynak sözleşmesi', () => {
  it('uses Menu and ui/icons surfaces, no antd, no raw icon package, no hard-coded colour or focus ring', () => {
    const source = readFileSync(resolve(__dirname, 'OverflowActions.tsx'), 'utf8');
    expect(source).not.toMatch(/from ['"]antd['"]/);
    expect(source).not.toContain('@ant-design/');
    expect(source).not.toContain('@phosphor-icons/');
    expect(source).not.toMatch(/from ['"]\.\/antd['"]/);
    expect(source).toContain("from './Menu'");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const css = readFileSync(resolve(__dirname, 'OverflowActions.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/outline\s*:/);
    expect(css).not.toMatch(/box-shadow\s*:/);
  });

  it('a pointer cancel on a sheet item does not trigger the action', async () => {
    const user = userEvent.setup();
    const { items, duzenle } = makeItems();
    render(<OverflowActions items={items} />, { wrapper: onDevice('phone') });
    await user.click(screen.getByRole('button', { name: 'Diğer' }));
    const item = screen.getByRole('menuitem', { name: 'Düzenle' });
    fireEvent.pointerDown(item, { pointerType: 'touch', button: 0 });
    expect(item).toHaveAttribute('data-pressed');
    fireEvent.pointerCancel(item, { pointerType: 'touch' });
    expect(item).not.toHaveAttribute('data-pressed');
    expect(duzenle).not.toHaveBeenCalled();
  });
});
