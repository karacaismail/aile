import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs';

// Kaynak: aile-tasarim/tasarim-sistemi/components/Tabs/README.md + index.d.ts TabsProps + bundle.js Tabs
// (+ envanter.md: telefonda 5+ sekme → Select). Seçiciler role/label ile; antd iç sınıfına bağlı seçici yok.

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

// matchMedia mock'u (min-width: Npx) sorgularını verilen genişliğe göre çözer; useDevice buna göre phone/tablet/desktop seçer.
function viewport(width: number) {
  window.matchMedia = vi.fn().mockImplementation((media: string) => {
    const match = media.match(/min-width:\s*(\d+)px/);
    return {
      matches: match ? width >= Number(match[1]) : false,
      media,
      onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
}

beforeEach(() => viewport(1280));

describe('Tabs (sekme)', () => {
  it('renders a labelled tablist with one tab per item and marks the active one', () => {
    render(<Tabs label="Bölümler" items={BOLUMLER} activeKey="tutarlar" />);
    expect(screen.getByRole('group', { name: 'Bölümler' })).toContainElement(screen.getByRole('tablist'));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent)).toEqual(['Kimlik', 'Tutarlar', 'Kaynak']);
    expect(screen.getByRole('tab', { name: 'Tutarlar' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Kimlik' })).toHaveAttribute('aria-selected', 'false');
  });

  it('selects the first enabled item when no activeKey is given', () => {
    render(<Tabs label="Bölümler" items={[{ key: 'a', label: 'Kapalı', disabled: true }, ...BOLUMLER]} />);
    expect(screen.getByRole('tab', { name: 'Kimlik' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Kapalı' })).toHaveAttribute('aria-selected', 'false');
  });

  it('reports the clicked key once and moves the selection itself', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Bölümler" items={BOLUMLER} activeKey="kimlik" onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: 'Kaynak' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('kaynak');
    expect(screen.getByRole('tab', { name: 'Kaynak' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Kimlik' })).toHaveAttribute('aria-selected', 'false');
    await user.click(screen.getByRole('tab', { name: 'Kaynak' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('follows a later activeKey from the parent', () => {
    const { rerender } = render(<Tabs label="Bölümler" items={BOLUMLER} activeKey="kimlik" />);
    rerender(<Tabs label="Bölümler" items={BOLUMLER} activeKey="kaynak" />);
    expect(screen.getByRole('tab', { name: 'Kaynak' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Kimlik' })).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps a disabled tab visible, unselectable and explained by the note', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Görünüm modu" items={MODLAR} activeKey="listing" note={GEREKCE} onChange={onChange} />);
    const gantt = screen.getByRole('tab', { name: 'Gantt' });
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

  it('moves focus with the arrow keys and activates with Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Bölümler" items={BOLUMLER} activeKey="kimlik" onChange={onChange} />);
    act(() => screen.getByRole('tab', { name: 'Kimlik' }).focus());
    await user.keyboard('{ArrowRight}');
    // rc-tabs odaklanan sekmeye "Tab 2 of 3" canlı bölgesi ekler; ad eşleşmesi bu yüzden sonek ile.
    expect(screen.getByRole('tab', { name: /Tutarlar$/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('tutarlar');
    expect(screen.getByRole('tab', { name: /Tutarlar$/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('uses a Phosphor icon for the overflow menu, never @ant-design/icons', () => {
    render(<Tabs label="Bölümler" items={BOLUMLER} />);
    expect(document.querySelector('.anticon')).toBeNull();
    const more = document.querySelector('svg[data-icon="more"]');
    expect(more).not.toBeNull();
    expect(more).toHaveAttribute('aria-label', 'Diğer sekmeler');
  });

  it('merges a caller className', () => {
    render(<Tabs label="Bölümler" items={BOLUMLER} className="sayfa-sekmeleri" />);
    expect(screen.getByRole('group', { name: 'Bölümler' })).toHaveClass('aile-tabs');
    expect(screen.getByRole('group', { name: 'Bölümler' })).toHaveClass('sayfa-sekmeleri');
  });
});

describe('Tabs variant="segment"', () => {
  it('renders a radiogroup named by the label with one radio per item, selected = checked', () => {
    render(<Tabs variant="segment" label="Görünüm modu" items={MODLAR} activeKey="table" note={GEREKCE} />);
    const group = screen.getByRole('radiogroup', { name: 'Görünüm modu' });
    expect(screen.queryByRole('tablist')).toBeNull();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(6);
    expect(screen.getByRole('radio', { name: 'Tablo' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Liste' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Gantt' })).toBeDisabled();
    expect(group).toHaveAccessibleDescription(GEREKCE);
    expect(screen.getByText(GEREKCE).tagName).toBe('P');
  });

  it('reports the chosen key and never the disabled one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs variant="segment" label="Görünüm modu" items={MODLAR} activeKey="listing" note={GEREKCE} onChange={onChange} />);
    // Kullanıcı görünen etikete basar (radyo girdisi antd'de görsel olarak gizli ve pointer-events: none).
    await user.click(screen.getByText('Kanban'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('kanban');
    expect(screen.getByRole('radio', { name: 'Kanban' })).toBeChecked();
    await user.click(screen.getByText('Gantt'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: 'Kanban' })).toBeChecked();
  });

  it('is a single tab stop: the group wrapper itself is not focusable', () => {
    render(<Tabs variant="segment" label="Görünüm modu" items={MODLAR} activeKey="listing" />);
    expect(screen.getByRole('radiogroup', { name: 'Görünüm modu' })).toHaveAttribute('tabindex', '-1');
  });
});

describe('Tabs on a phone', () => {
  it('falls back to a combobox for 5 or more items, with the note as description', async () => {
    viewport(375);
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs variant="segment" label="Görünüm modu" items={MODLAR} activeKey="listing" note={GEREKCE} onChange={onChange} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    const combobox = screen.getByRole('combobox', { name: 'Görünüm modu' });
    expect(combobox).toHaveAccessibleDescription(GEREKCE);
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

  it('keeps the strip for fewer than 5 items', () => {
    viewport(375);
    render(<Tabs label="Bölümler" items={BOLUMLER} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('keeps the strip on a tablet even with 5 or more items', () => {
    viewport(768);
    render(<Tabs variant="segment" label="Görünüm modu" items={MODLAR} activeKey="listing" />);
    expect(screen.getByRole('radiogroup', { name: 'Görünüm modu' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('Tabs.css ve kaynak (tasarım kuralları, statik)', () => {
  const read = (name: string) => readFileSync(resolve(__dirname, name), 'utf8');

  it('imports its stylesheet and takes antd and icons only through ./antd and ./icons', () => {
    const source = read('Tabs.tsx');
    expect(source).toContain("import './Tabs.css'");
    expect(source).not.toMatch(/from ['"]antd['"]/);
    expect(source).not.toMatch(/@ant-design\//);
    expect(source).not.toMatch(/@phosphor-icons\//);
    expect(source).toMatch(/from ['"]\.\/antd['"]/);
    expect(source).toMatch(/from ['"]\.\/icons['"]/);
  });

  it('uses only --aile-* tokens: no raw colors, no outline, no shadow, no loose px', () => {
    const css = read('Tabs.css');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/outline\s*:/);
    expect(css.replace(/box-shadow\s*:\s*none/g, '')).not.toMatch(/box-shadow\s*:/);
    expect(css).toContain('var(--aile-');
    // 1 px kenar/aralık; 14/20 küçük metin (tasarım tip ölçeği, .aile-kucuk ile aynı). Diğer ölçüler token.
    const px = Array.from(css.matchAll(/(\d+(?:\.\d+)?)px/g), match => match[1]);
    expect(new Set(px)).toEqual(new Set(['1', '14', '20']));
  });

  it('styles selection as secili + 600, disabled as ikincil, 44 px targets and hides the ink bar and nav rule', () => {
    const css = read('Tabs.css');
    expect(css).toContain('var(--aile-secili)');
    expect(css).toContain('font-weight: 600');
    expect(css).toContain('var(--aile-metin-ikincil)');
    expect(css).toContain('var(--aile-bilgi-yuzey)');
    expect(css).toContain('var(--aile-hedef-asgari)');
    expect(css).toContain('var(--aile-sure) var(--aile-egri)');
    expect(css).toMatch(/ink-bar[^{]*\{[^}]*display:\s*none/);
    expect(css).toMatch(/ant-tabs-nav::before[^{]*\{[^}]*display:\s*none/);
    expect(css).toMatch(/content-holder[^{]*\{[^}]*display:\s*none/);
  });
});
