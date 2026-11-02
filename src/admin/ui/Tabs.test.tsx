import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installViewport } from '../adaptive/testing';
import { Tabs } from './Tabs';

// Kaynak: aile-tasarim/tasarim-sistemi/components/Tabs/README.md + index.d.ts TabsProps + bundle.js Tabs
// (+ envanter.md: telefonda 5+ sekme → Select; Select telefonda alttan sayfa). WAI-ARIA APG: Tabs (otomatik
// etkinleştirme, roving tabindex, oklar + Home/End), Radio Group, Select-Only Combobox + dialog açılır katmanı.
// Seçiciler rol/ad ile; yalnız aria-hidden süsleyiciler (taşma ipucu, örtü) sınıf/öznitelikle bulunur.

const BOLUMLER = [
  { key: 'kimlik', label: 'Kimlik' },
  { key: 'tutarlar', label: 'Tutarlar' },
  { key: 'kaynak', label: 'Kaynak' },
];
const MODLAR = [
  { key: 'listing', label: 'Liste' },
  { key: 'table', label: 'Tablo' },
  { key: 'timeline', label: 'Zaman çizelgesi' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'gantt_chart', label: 'Gantt', disabled: true },
  { key: 'pivot', label: 'Pivot' },
];
const GEREKCE = 'Gantt kullanılamaz: alımların başlangıç ve bitiş tarihi yok.';

beforeEach(() => {
  installViewport({ width: 1280, height: 800, fine: true, hover: true });
});

const tab = (name: string | RegExp) => screen.getByRole('tab', { name });
const radio = (name: string) => screen.getByRole('radio', { name });

describe('Tabs (sekme)', () => {
  it('renders a labelled tablist with one tab per item and marks the active one', () => {
    render(<Tabs label="Bölümler" items={BOLUMLER} activeKey="tutarlar" />);
    expect(screen.getByRole('group', { name: 'Bölümler' })).toContainElement(screen.getByRole('tablist', { name: 'Bölümler' }));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(item => item.textContent)).toEqual(['Kimlik', 'Tutarlar', 'Kaynak']);
    expect(tab('Tutarlar')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Kimlik')).toHaveAttribute('aria-selected', 'false');
  });

  it('selects the first enabled item when no activeKey is given', () => {
    render(<Tabs label="Bölümler" items={[{ key: 'a', label: 'Kapalı', disabled: true }, ...BOLUMLER]} />);
    expect(tab('Kimlik')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Kapalı')).toHaveAttribute('aria-selected', 'false');
  });

  it('reports the clicked key once and moves the selection itself', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Bölümler" items={BOLUMLER} activeKey="kimlik" onChange={onChange} />);
    await user.click(tab('Kaynak'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('kaynak');
    expect(tab('Kaynak')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Kimlik')).toHaveAttribute('aria-selected', 'false');
    await user.click(tab('Kaynak'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('follows a later activeKey from the parent', () => {
    const { rerender } = render(<Tabs label="Bölümler" items={BOLUMLER} activeKey="kimlik" />);
    rerender(<Tabs label="Bölümler" items={BOLUMLER} activeKey="kaynak" />);
    expect(tab('Kaynak')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Kimlik')).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps a disabled tab visible, unselectable and explained by the note', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Görünüm modu" items={MODLAR} activeKey="listing" note={GEREKCE} onChange={onChange} />);
    const gantt = tab('Gantt');
    expect(gantt).toHaveAttribute('aria-disabled', 'true');
    await user.click(gantt);
    expect(onChange).not.toHaveBeenCalled();
    expect(gantt).toHaveAttribute('aria-selected', 'false');
    const note = screen.getByText(GEREKCE);
    expect(note.tagName).toBe('P');
    expect(screen.getByRole('group', { name: 'Görünüm modu' })).toHaveAccessibleDescription(GEREKCE);
    expect(screen.getAllByRole('tab')).toHaveLength(6);
  });

  it('renders no note paragraph when none is given', () => {
    render(<Tabs label="Bölümler" items={BOLUMLER} />);
    expect(screen.getByRole('group', { name: 'Bölümler' })).not.toHaveAttribute('aria-describedby');
    expect(document.querySelector('p')).toBeNull();
  });

  it('merges a caller className', () => {
    render(<Tabs label="Bölümler" items={BOLUMLER} className="sayfa-sekmeleri" />);
    expect(screen.getByRole('group', { name: 'Bölümler' })).toHaveClass('aile-tabs');
    expect(screen.getByRole('group', { name: 'Bölümler' })).toHaveClass('sayfa-sekmeleri');
  });
});

describe('Tabs › APG klavye (roving tabindex, otomatik etkinleştirme)', () => {
  it('is a single tab stop: only the selected tab is in the tab order', () => {
    render(<Tabs label="Bölümler" items={BOLUMLER} activeKey="tutarlar" />);
    expect(tab('Tutarlar')).toHaveAttribute('tabindex', '0');
    expect(tab('Kimlik')).toHaveAttribute('tabindex', '-1');
    expect(tab('Kaynak')).toHaveAttribute('tabindex', '-1');
  });

  it('Tab enters on the selected tab, the next Tab leaves the list, Shift+Tab comes back to it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Önce</button>
        <Tabs label="Bölümler" items={BOLUMLER} activeKey="kaynak" />
        <button type="button">Sonra</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Önce' }));
    await user.tab();
    expect(tab('Kaynak')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sonra' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(tab('Kaynak')).toHaveFocus();
  });

  it('ArrowRight / ArrowLeft move focus and select at once, wrapping at both ends', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Bölümler" items={BOLUMLER} activeKey="kimlik" onChange={onChange} />);
    act(() => tab('Kimlik').focus());
    await user.keyboard('{ArrowRight}');
    expect(tab('Tutarlar')).toHaveFocus();
    expect(tab('Tutarlar')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Tutarlar')).toHaveAttribute('tabindex', '0');
    expect(tab('Kimlik')).toHaveAttribute('tabindex', '-1');
    expect(onChange).toHaveBeenLastCalledWith('tutarlar');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(tab('Kimlik')).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('kimlik');
    await user.keyboard('{ArrowLeft}');
    expect(tab('Kaynak')).toHaveFocus();
    expect(tab('Kaynak')).toHaveAttribute('aria-selected', 'true');
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('Home and End jump to the first and last enabled tab', async () => {
    const user = userEvent.setup();
    const items = [{ key: 'x', label: 'Kapalı baş', disabled: true }, ...BOLUMLER, { key: 'y', label: 'Kapalı son', disabled: true }];
    render(<Tabs label="Bölümler" items={items} activeKey="tutarlar" />);
    act(() => tab('Tutarlar').focus());
    await user.keyboard('{End}');
    expect(tab('Kaynak')).toHaveFocus();
    expect(tab('Kaynak')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(tab('Kimlik')).toHaveFocus();
    expect(tab('Kimlik')).toHaveAttribute('aria-selected', 'true');
  });

  it('arrows skip a disabled tab; Enter and Space keep the focused tab selected; Escape changes nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Görünüm modu" items={MODLAR} activeKey="kanban" onChange={onChange} />);
    act(() => tab('Kanban').focus());
    await user.keyboard('{ArrowRight}');
    expect(tab('Pivot')).toHaveFocus();
    expect(tab('Gantt')).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{ArrowLeft}');
    expect(tab('Kanban')).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    await user.keyboard('{Escape}');
    expect(tab('Kanban')).toHaveFocus();
    expect(tab('Kanban')).toHaveAttribute('aria-selected', 'true');
    expect(onChange.mock.calls.map(call => call[0])).toEqual(['pivot', 'kanban']);
  });

  it('labels the panel with the selected tab when content is given (aria-controls ↔ aria-labelledby)', async () => {
    const user = userEvent.setup();
    render(<Tabs label="Bölümler" items={BOLUMLER} activeKey="tutarlar"><p>Tutar içeriği</p></Tabs>);
    const panel = screen.getByRole('tabpanel', { name: 'Tutarlar' });
    expect(panel).toHaveTextContent('Tutar içeriği');
    expect(panel).toHaveAttribute('aria-labelledby', tab('Tutarlar').id);
    expect(tab('Tutarlar')).toHaveAttribute('aria-controls', panel.id);
    expect(tab('Kimlik')).not.toHaveAttribute('aria-controls');
    await user.click(tab('Kaynak'));
    expect(screen.getByRole('tabpanel', { name: 'Kaynak' })).toBe(panel);
    expect(tab('Kaynak')).toHaveAttribute('aria-controls', panel.id);
  });

  it('renders no tabpanel and no aria-controls when the page draws its own content', () => {
    render(<Tabs label="Bölümler" items={BOLUMLER} />);
    expect(screen.queryByRole('tabpanel')).toBeNull();
    for (const item of screen.getAllByRole('tab')) expect(item).not.toHaveAttribute('aria-controls');
  });
});

describe('Tabs › işaretçi (Pointer Events)', () => {
  it('a touch press that is cancelled (pointercancel, e.g. the strip scrolls) does not select; a full tap does', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Bölümler" items={BOLUMLER} activeKey="kimlik" onChange={onChange} />);
    fireEvent.pointerDown(tab('Kaynak'), { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(tab('Kaynak'), { pointerType: 'touch', isPrimary: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(tab('Kaynak')).toHaveAttribute('aria-selected', 'false');
    await user.pointer([{ keys: '[TouchA>]', target: tab('Kaynak') }, { keys: '[/TouchA]', target: tab('Kaynak') }]);
    expect(onChange).toHaveBeenCalledWith('kaynak');
    expect(tab('Kaynak')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Tabs › taşma (dar ekranda kaydırılabilir şerit)', () => {
  const olcu = (element: HTMLElement, sizes: { scrollWidth: number; clientWidth: number; scrollLeft?: number }) => {
    Object.defineProperty(element, 'scrollWidth', { configurable: true, value: sizes.scrollWidth });
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: sizes.clientWidth });
    element.scrollLeft = sizes.scrollLeft ?? 0;
    fireEvent.scroll(element);
  };
  const ipucu = (root: HTMLElement, yon: 'bas' | 'son') => root.querySelector<HTMLElement>(`.aile-tabs__ipucu[data-yon="${yon}"]`)!;

  it('shows a decorative Phosphor chevron hint on the side that has hidden tabs, never @ant-design/icons', () => {
    const { container } = render(<Tabs label="Bölümler" items={BOLUMLER} />);
    const list = screen.getByRole('tablist');
    expect(ipucu(container, 'bas')).toHaveAttribute('data-gorunur', 'false');
    expect(ipucu(container, 'son')).toHaveAttribute('data-gorunur', 'false');

    olcu(list, { scrollWidth: 600, clientWidth: 280 });
    expect(ipucu(container, 'bas')).toHaveAttribute('data-gorunur', 'false');
    expect(ipucu(container, 'son')).toHaveAttribute('data-gorunur', 'true');
    expect(ipucu(container, 'son')).toHaveAttribute('aria-hidden', 'true');
    // Şerit kenarı, ipucunun altında kalan kesik etiketi soldurur (CSS maskesi bu özniteliklere bağlı).
    expect(list).toHaveAttribute('data-tasma-son', 'true');
    expect(list).toHaveAttribute('data-tasma-bas', 'false');
    expect(ipucu(container, 'son').querySelector('svg[data-icon="chevronRight"]')).not.toBeNull();
    expect(container.querySelector('.anticon')).toBeNull();

    olcu(list, { scrollWidth: 600, clientWidth: 280, scrollLeft: 120 });
    expect(ipucu(container, 'bas')).toHaveAttribute('data-gorunur', 'true');
    expect(ipucu(container, 'son')).toHaveAttribute('data-gorunur', 'true');

    olcu(list, { scrollWidth: 600, clientWidth: 280, scrollLeft: 320 });
    expect(ipucu(container, 'bas')).toHaveAttribute('data-gorunur', 'true');
    expect(ipucu(container, 'son')).toHaveAttribute('data-gorunur', 'false');
    expect(list).toHaveAttribute('data-tasma-bas', 'true');
    expect(list).toHaveAttribute('data-tasma-son', 'false');
  });

  it('a press on the hint scrolls the strip toward the hidden tabs (pointer convenience; keyboard uses arrows)', async () => {
    const user = userEvent.setup();
    const { container } = render(<Tabs label="Bölümler" items={BOLUMLER} />);
    const list = screen.getByRole('tablist');
    olcu(list, { scrollWidth: 600, clientWidth: 280 });
    await user.click(ipucu(container, 'son'));
    expect(list.scrollLeft).toBeGreaterThan(0);
    expect(ipucu(container, 'bas')).toHaveAttribute('data-gorunur', 'true');
    const after = list.scrollLeft;
    await user.click(ipucu(container, 'bas'));
    expect(list.scrollLeft).toBeLessThan(after);
    expect(ipucu(container, 'son')).not.toHaveAttribute('tabindex');
  });
});

describe('Tabs variant="segment"', () => {
  it('renders a radiogroup named by the label with one radio per item, selected = checked', () => {
    render(<Tabs variant="segment" label="Görünüm modu" items={MODLAR} activeKey="table" note={GEREKCE} />);
    const group = screen.getByRole('radiogroup', { name: 'Görünüm modu' });
    expect(screen.queryByRole('tablist')).toBeNull();
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(6);
    expect(radio('Tablo')).toBeChecked();
    expect(radio('Liste')).not.toBeChecked();
    expect(radio('Gantt')).toBeDisabled();
    expect(group).toHaveAccessibleDescription(GEREKCE);
    expect(screen.getByText(GEREKCE).tagName).toBe('P');
  });

  it('reports the chosen key and never the disabled one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs variant="segment" label="Görünüm modu" items={MODLAR} activeKey="listing" note={GEREKCE} onChange={onChange} />);
    // Sayfa testleri görünen etikete basar (QueryBar/AlimlarPage/ProjelerPage); metin tek kez çizilir.
    await user.click(screen.getByText('Kanban'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('kanban');
    expect(radio('Kanban')).toBeChecked();
    await user.click(screen.getByText('Gantt'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(radio('Kanban')).toBeChecked();
  });

  it('is a single tab stop on the checked radio; the group wrapper itself is not focusable', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Önce</button>
        <Tabs variant="segment" label="Görünüm modu" items={MODLAR} activeKey="kanban" />
        <button type="button">Sonra</button>
      </>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Görünüm modu' });
    expect(group).not.toHaveAttribute('tabindex');
    await user.click(screen.getByRole('button', { name: 'Önce' }));
    await user.tab();
    expect(radio('Kanban')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sonra' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(radio('Kanban')).toHaveFocus();
  });

  it('arrow keys move focus and check (wrapping, skipping disabled); Space checks the focused radio', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs variant="segment" label="Görünüm modu" items={MODLAR} activeKey="kanban" onChange={onChange} />);
    act(() => radio('Kanban').focus());
    await user.keyboard('{ArrowRight}');
    expect(radio('Pivot')).toHaveFocus();
    expect(radio('Pivot')).toBeChecked();
    await user.keyboard('{ArrowDown}');
    expect(radio('Liste')).toHaveFocus();
    expect(radio('Liste')).toBeChecked();
    await user.keyboard('{ArrowUp}');
    expect(radio('Pivot')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(radio('Kanban')).toHaveFocus();
    await user.keyboard(' ');
    expect(radio('Kanban')).toBeChecked();
    expect(onChange.mock.calls.map(call => call[0])).toEqual(['pivot', 'listing', 'pivot', 'kanban']);
  });
});

describe('Tabs on a phone', () => {
  const telefon = () => installViewport({ width: 375, height: 667, coarse: true });

  it('falls back to a combobox for 5 or more items, with the note as description', async () => {
    telefon();
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs variant="segment" label="Görünüm modu" items={MODLAR} activeKey="listing" note={GEREKCE} onChange={onChange} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    const combobox = screen.getByRole('combobox', { name: 'Görünüm modu' });
    expect(combobox).toHaveAccessibleDescription(GEREKCE);
    expect(combobox).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Liste')).toBeInTheDocument();
    expect(screen.getByText(GEREKCE).tagName).toBe('P');

    await user.click(combobox);
    const gantt = await screen.findByRole('option', { name: /^Gantt/ });
    expect(gantt).toHaveAttribute('aria-disabled', 'true');
    expect(gantt).toHaveTextContent('Kullanılamaz');
    expect(screen.getByRole('option', { name: 'Tablo' })).not.toHaveTextContent('Kullanılamaz');
    await user.click(screen.getByRole('option', { name: 'Tablo' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('table');
  });

  it('opens the list in a bottom sheet (modal dialog named by the label) with focus on the selected option', async () => {
    telefon();
    const user = userEvent.setup();
    render(<Tabs label="Sözlük" items={MODLAR} activeKey="kanban" />);
    const combobox = screen.getByRole('combobox', { name: 'Sözlük' });
    await user.click(combobox);
    const sheet = screen.getByRole('dialog', { name: 'Sözlük' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    // Portallanan yerel katman ortak odak kancasını taşır (admin.css [data-aile-katman] kapsamı; .aile-admin dışına da düşse).
    expect(sheet.closest('[data-aile-katman]')).not.toBeNull();
    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    expect(combobox).toHaveAttribute('aria-haspopup', 'dialog');
    expect(combobox).toHaveAttribute('aria-controls', sheet.id);
    const listbox = within(sheet).getByRole('listbox', { name: 'Sözlük' });
    expect(within(listbox).getAllByRole('option')).toHaveLength(6);
    const kanban = within(listbox).getByRole('option', { name: 'Kanban' });
    expect(kanban).toHaveAttribute('aria-selected', 'true');
    expect(kanban).toHaveFocus();
    expect(kanban.querySelector('svg[data-icon="check"]')).not.toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Kapat' })).toBeInTheDocument();
  });

  it('keyboard: ArrowDown opens; arrows skip disabled; Enter picks, closes and returns focus to the combobox', async () => {
    telefon();
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Görünüm modu" items={MODLAR} activeKey="kanban" onChange={onChange} />);
    const combobox = screen.getByRole('combobox', { name: 'Görünüm modu' });
    act(() => combobox.focus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Kanban' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Pivot' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('option', { name: 'Zaman çizelgesi' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('option', { name: 'Liste' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('option', { name: 'Pivot' })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('pivot');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(combobox).toHaveAttribute('aria-expanded', 'false');
    expect(combobox).toHaveFocus();
    expect(combobox).toHaveTextContent('Pivot');
  });

  it('Space on the combobox opens; Space on an option picks it', async () => {
    telefon();
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Görünüm modu" items={MODLAR} activeKey="listing" onChange={onChange} />);
    const combobox = screen.getByRole('combobox', { name: 'Görünüm modu' });
    act(() => combobox.focus());
    await user.keyboard(' ');
    expect(screen.getByRole('option', { name: 'Liste' })).toHaveFocus();
    await user.keyboard('{ArrowDown} ');
    expect(onChange).toHaveBeenCalledWith('table');
    expect(combobox).toHaveFocus();
  });

  it('Escape, the Kapat button and the scrim close without a change and return focus to the combobox', async () => {
    telefon();
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Görünüm modu" items={MODLAR} activeKey="listing" onChange={onChange} />);
    const combobox = screen.getByRole('combobox', { name: 'Görünüm modu' });

    await user.click(combobox);
    await user.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(combobox).toHaveFocus();

    await user.click(combobox);
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(combobox).toHaveFocus();

    await user.click(combobox);
    await user.click(document.querySelector<HTMLElement>('.aile-tabs-katman__ortu')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(combobox).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    expect(combobox).toHaveTextContent('Liste');
  });

  it('keeps Tab and Shift+Tab inside the sheet (option ↔ Kapat)', async () => {
    telefon();
    const user = userEvent.setup();
    render(<Tabs label="Görünüm modu" items={MODLAR} activeKey="table" />);
    await user.click(screen.getByRole('combobox', { name: 'Görünüm modu' }));
    const tablo = screen.getByRole('option', { name: 'Tablo' });
    const kapat = screen.getByRole('button', { name: 'Kapat' });
    expect(tablo).toHaveFocus();
    await user.tab();
    expect(kapat).toHaveFocus();
    await user.tab();
    expect(tablo).toHaveFocus();
    await user.tab({ shift: true });
    expect(kapat).toHaveFocus();
  });

  it('a cancelled touch on an option (pointercancel while the list scrolls) does not pick it', async () => {
    telefon();
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Görünüm modu" items={MODLAR} activeKey="listing" onChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: 'Görünüm modu' }));
    const pivot = screen.getByRole('option', { name: 'Pivot' });
    fireEvent.pointerDown(pivot, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(pivot, { pointerType: 'touch', isPrimary: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /^Gantt/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the strip for fewer than 5 items', () => {
    telefon();
    render(<Tabs label="Bölümler" items={BOLUMLER} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('keeps the strip on a tablet even with 5 or more items', () => {
    installViewport({ width: 768, height: 1024, coarse: true });
    render(<Tabs variant="segment" label="Görünüm modu" items={MODLAR} activeKey="listing" />);
    expect(screen.getByRole('radiogroup', { name: 'Görünüm modu' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('keeps the phone presentation on a landscape phone (568×320 is still the phone profile)', () => {
    installViewport({ width: 568, height: 320, coarse: true });
    render(<Tabs label="Sözlük" items={MODLAR} activeKey="listing" />);
    expect(screen.getByRole('combobox', { name: 'Sözlük' })).toBeInTheDocument();
  });
});

describe('Tabs kaynak kuralları (statik)', () => {
  const read = (name: string) => readFileSync(resolve(__dirname, name), 'utf8');

  /** Tabs.tsx'ten başlayarak statik (tip olmayan) importları izler; dinamik import() telefon yoluna girmez. */
  function staticGraph(entry: string) {
    const files: string[] = [];
    const packages: { from: string; spec: string }[] = [];
    const STATIC = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
    const resolveLocal = (from: string, spec: string) => {
      const base = resolve(dirname(from), spec);
      return [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')].find(file => /\.(ts|tsx)$/.test(file) && existsSync(file));
    };
    const visit = (file: string) => {
      if (files.includes(file)) return;
      files.push(file);
      for (const match of read(relative(__dirname, file)).matchAll(STATIC)) {
        if (match[1]) continue;
        const spec = match[2]!;
        if (!spec.startsWith('.')) { packages.push({ from: relative(__dirname, file), spec }); continue; }
        if (/\.css$/.test(spec)) continue;
        const target = resolveLocal(file, spec);
        if (target) visit(target);
      }
    };
    visit(resolve(__dirname, entry));
    return { files: files.map(file => relative(resolve(__dirname, '..', '..', '..'), file)), packages };
  }

  it('imports its stylesheet; nothing it statically reaches imports antd, @ant-design/*, ./antd, echarts or a *.wide module', () => {
    expect(read('Tabs.tsx')).toContain("import './Tabs.css'");
    // Yürüyücünün kendisi: antd çeken bir sarmalayıcıda (Select) antd.ts'yi bulmalı; yoksa bu test boşuna geçer.
    expect(staticGraph('Select.tsx').files).toContain('src/admin/ui/antd.ts');
    const graph = staticGraph('Tabs.tsx');
    expect(graph.files).toEqual(expect.arrayContaining([
      'src/admin/ui/Tabs.tsx', 'src/admin/ui/Tabs.secim.tsx', 'src/admin/ui/Tabs.gezinme.ts', 'src/admin/ui/icons.tsx', 'src/admin/device.ts',
    ]));
    expect(graph.files).not.toContain('src/admin/ui/antd.ts');
    expect(graph.files.filter(file => /\.wide\.|\/wide\//.test(file))).toEqual([]);
    expect(graph.packages.filter(({ spec }) => /^(antd|@ant-design\/|echarts|zrender)(\/|$)/.test(spec))).toEqual([]);
    for (const file of graph.files.filter(name => /^src\/admin\/ui\/Tabs\./.test(name))) {
      const source = readFileSync(resolve(__dirname, '..', '..', '..', file), 'utf8');
      expect(source, file).not.toMatch(/from ['"](antd|@ant-design\/[^'"]*|\.\/antd)['"]/);
      expect(source, file).not.toMatch(/@phosphor-icons\//);
    }
  });

  it('uses only --aile-* tokens: no raw colours, no outline, no ring shadow, only typographic or hairline px', () => {
    const css = read('Tabs.css');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    expect(css).not.toMatch(/outline\s*:/);
    expect(css.replace(/box-shadow\s*:\s*(none|var\(--aile-golge-yukseltilmis\))/g, '')).not.toMatch(/box-shadow\s*:/);
    expect(css).toContain('var(--aile-');
    // 0/1 px (kılçizgi, güvenli alan yedeği) ve tasarım tip ölçeği (14/20, 16/24, 18/26). Diğer ölçüler token.
    const px = new Set(Array.from(css.matchAll(/(\d+(?:\.\d+)?)px/g), match => match[1]));
    for (const value of px) expect(['0', '1', '14', '16', '18', '20', '24', '26']).toContain(value);
    const fontSizes = Array.from(css.matchAll(/font-size\s*:\s*(\d+)px/g), match => Number(match[1]));
    expect(fontSizes.length).toBeGreaterThan(0);
    expect(fontSizes.every(size => size >= 14)).toBe(true);
  });

  it('styles selection as secili + 600 with a straight line whose corners are square; no curved accent edge', () => {
    const css = read('Tabs.css');
    expect(css).toContain('var(--aile-secili)');
    expect(css).toContain('font-weight: 600');
    expect(css).toContain('var(--aile-metin-ikincil)');
    expect(css).toContain('var(--aile-bilgi-yuzey)');
    // Sekme kutusunun alt köşeleri her durumda radiussuz; seçim çizgisi ::before ile alt kenarda (odak çizgisi
    // admin.css'te ::after, kontrolün 4 px altında: ikisi ayrı göstergeler).
    expect(css).toMatch(/\.aile-tabs__oge\[role='tab'\]\s*\{[^}]*border-radius:\s*var\(--aile-kose-kontrol\) var\(--aile-kose-kontrol\) 0 0;/);
    expect(css).toMatch(/\.aile-tabs__oge\[role='tab'\]::before\s*\{[^}]*bottom:\s*0;[^}]*height:\s*var\(--aile-odak-kalinlik\)/);
    expect(css).toMatch(/\.aile-tabs__oge\[role='tab'\]\[aria-selected='true'\]::before\s*\{[^}]*background(?:-color)?:\s*var\(--aile-metin\)/);
    expect(css).not.toMatch(/::after/);
    expect(css).not.toMatch(/border-(?:left|right|top|bottom|inline|block)[a-z-]*\s*:\s*(?!0|none)[^;]*var\(--aile-(?:eylem|odak|metin|secili)\)/);
    expect(css).not.toMatch(/inset\s+[^;]*var\(--aile-/);
  });

  it('gives every interactive part a 44 px target and 48 px on coarse input; motion is one duration and one curve', () => {
    const css = read('Tabs.css');
    // Hedef tek merkezi tokendan (admin.css › --aile-dokunma-hedefi: 44 px, [data-input-coarse] kökte 48 px; b04/W0):
    // bileşen kaba girişi kendisi yeniden türetmez, portallanan sayfa da <html>'deki değeri alır.
    const block = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{[^}]*\\}`))?.[0] ?? '';
    for (const selector of ['.aile-tabs__oge', '.aile-tabs__tetik', '.aile-tabs-sayfa__secenek', '.aile-tabs-sayfa__kapat', '.aile-tabs__ipucu']) {
      expect(block(selector), selector).toMatch(/min-height:\s*var\(--aile-dokunma-hedefi\)/);
    }
    for (const selector of ['.aile-tabs__oge', '.aile-tabs-sayfa__kapat']) {
      expect(block(selector), selector).toMatch(/min-width:\s*var\(--aile-dokunma-hedefi\)/);
    }
    expect(block('.aile-tabs__ipucu')).toMatch(/(?:^|\s)width:\s*var\(--aile-dokunma-hedefi\)/);
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/\[data-input-coarse\]/);
    expect(rules).not.toMatch(/calc\(var\(--aile-hedef-asgari\) \+/);
    const transitions = Array.from(css.matchAll(/transition\s*:\s*([^;]+);/g), match => match[1]!);
    expect(transitions.length).toBeGreaterThan(0);
    for (const value of transitions) {
      for (const part of value.split(',')) expect(part.trim(), value).toMatch(/^[a-z-]+ var\(--aile-sure\) var\(--aile-egri\)$/);
    }
    expect(css).not.toMatch(/transition\s*:\s*all\b/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*transition-duration:\s*0s/);
  });
});
