import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { importsOf, stripComments } from '../adaptive/sourceRules';
import { installViewport } from '../adaptive/testing';
import { DeviceContext, DeviceProvider } from '../device';
import type { Device } from '../shell/contracts';
import { SEARCH_THRESHOLD, Select, UNKNOWN_LABEL, UNKNOWN_VALUE, type SelectOption } from './Select';

// Select sözleşmesi (tasarım components/Select/README.md, görev a03): tek değer, native select yok, antd yok.
// Telefon: alttan açılan yerel diyalogda APG listbox (dolaşan tabindex). Geniş: tetikte odak kalan APG select-only
// combobox + yerel popover listbox (aria-activedescendant). Escape kapatır ve odak tetiğe döner; seçim profil
// değişiminde korunur; uzun listede yazarak arama (typeahead), telefonda 8'den fazla seçenekte süzme alanı.

const onDevice = (device: Device) => ({ children }: { children: ReactNode }) =>
  createElement(DeviceContext.Provider, { value: device }, children);

const odalar: readonly SelectOption[] = [
  { value: 'mutfak', label: 'Mutfak' },
  { value: 'salon', label: 'Salon' },
  { value: 'yatak', label: 'Yatak odası', disabled: true, note: 'Önce teslim gerekir' },
];
const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
// 12 seçenek: 8 eşiğinin üstü → telefonda süzme alanı; geniş profilde yazarak arama.
const aylar: readonly SelectOption[] = AY_ADLARI.map((ad, i) => ({ value: `2098-${String(i + 1).padStart(2, '0')}`, label: `${ad} 2098` }));

const combobox = (name = 'Oda') => screen.getByRole('combobox', { name });
const option = (name: string, scope: HTMLElement = screen.getByRole('listbox')) => within(scope).getByRole('option', { name });

// --- Kaynak düzeyi: telefon yolunda antd yok ------------------------------------------------------------------------

const UI_DIR = __dirname;
const SELECT_TSX = resolve(UI_DIR, 'Select.tsx');
const SELECT_CSS = resolve(UI_DIR, 'Select.css');
const repoRel = (file: string) => relative(resolve(UI_DIR, '../../..'), file);

function resolveLocal(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`${repoRel(from)}: çözülemeyen yerel import ${specifier}`);
}

/** Select.tsx'ten başlayan statik (tür-yalnız olmayan) import kapanışı: yerel dosyalar ve paket belirteçleri. */
function staticClosure(entry: string) {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    if (!/\.[cm]?[jt]sx?$/.test(file)) return;
    for (const ref of importsOf(readFileSync(file, 'utf8'))) {
      if (ref.kind !== 'static' || ref.typeOnly) continue;
      const local = resolveLocal(file, ref.specifier);
      if (local) visit(local);
      else packages.set(ref.specifier, repoRel(file));
    }
  };
  visit(entry);
  return { files: [...files].map(repoRel), packages };
}

describe('Select › kaynak (telefon profili antd ve geniş-özel kod istemez)', () => {
  it('statik import kapanışında antd, @ant-design/*, ui/antd, antd teması, echarts ve *.wide yok', () => {
    const { files, packages } = staticClosure(SELECT_TSX);
    const forbiddenPackages = [...packages].filter(([specifier]) => /^(antd|@ant-design|echarts|zrender)(\/|$)/.test(specifier))
      .map(([specifier, from]) => `${from} → ${specifier}`);
    const forbiddenFiles = files.filter(file => /src\/admin\/ui\/antd\.ts$|src\/admin\/theme\/antdTheme\.ts$|\.wide\.|\/wide\//.test(file));
    expect(forbiddenPackages).toEqual([]);
    expect(forbiddenFiles).toEqual([]);
    expect(files).toContain('src/admin/ui/Select.tsx');
  });

  it('native <select> ve antd Select yok; geniş dosya açılmaz (antd gerekmiyor, tek yerel uygulama)', () => {
    const tsx = stripComments(readFileSync(SELECT_TSX, 'utf8'));
    expect(tsx).not.toMatch(/<select\b/);
    expect(tsx).not.toMatch(/AntSelect|AntInput|from\s+['"]\.\/antd['"]/);
    expect(existsSync(resolve(UI_DIR, 'wide/Select.wide.tsx'))).toBe(false);
  });

  it('CSS yalnız --aile-* tokenları: sabit renk/boşluk yok, hareket tek süre + tek eğri, reduced-motion anlık', () => {
    const css = stripComments(readFileSync(SELECT_CSS, 'utf8'));
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
    const declarations = [...css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map(match => ({ prop: match[1]!, value: match[2]!.trim() }));
    const spacing = declarations.filter(d => /^(padding|margin|gap|row-gap|column-gap|border-radius|inset|top|right|bottom|left)(-|$)/.test(d.prop));
    expect(spacing.filter(d => /(^|[^\w.-])[1-9]\d*(\.\d+)?px/.test(d.value)).map(d => `${d.prop}: ${d.value}`)).toEqual([]);
    const transitions = declarations.filter(d => d.prop === 'transition');
    expect(transitions.length).toBeGreaterThan(0);
    for (const t of transitions) {
      for (const part of t.value.split(',')) {
        expect(part, t.value).toMatch(/var\(--aile-sure\)\s+var\(--aile-egri\)/);
        expect(part, t.value).not.toMatch(/\b(all|ease|ease-in|ease-out|ease-in-out|linear)\b/);
      }
    }
    expect(declarations.filter(d => d.prop === 'transition-duration' && d.value !== '0s')).toEqual([]);
    const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(css);
    expect(reduced, 'reduced-motion bloğu').not.toBeNull();
    expect(reduced![1]).toMatch(/transition-duration:\s*0s/);
    for (const name of ['aile-select-tetik', 'aile-select-ok', 'aile-select-secenek', 'aile-select-acilir', 'aile-select-sayfa-panel', 'aile-select-sayfa-ortu']) {
      expect(reduced![1], name).toContain(`.${name}`);
    }
  });

  it('CSS: çevreleyen halka yok, okunur metin ≥14 px, dokunma hedefi 44 px ve coarse girişte 48 px', () => {
    const css = stripComments(readFileSync(SELECT_CSS, 'utf8'));
    for (const match of css.matchAll(/outline\s*:\s*([^;]+);/g)) expect(match[1]!.trim()).toBe('none');
    for (const match of css.matchAll(/box-shadow\s*:\s*([^;]+);/g)) expect(['none', 'var(--aile-golge-yukseltilmis)']).toContain(match[1]!.trim());
    for (const match of css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) expect(Number(match[1])).toBeGreaterThanOrEqual(14);
    expect(css).not.toMatch(/font-size\s*:\s*[\d.]+(rem|em)\b/);
    // W0 (b04): merkezi --aile-dokunma-hedefi 44 px, data-input-coarse katmanında 48 px. Bileşen kendi coarse
    // hesabını türetmez (tek kaynak); etkileşimli her hedef bu tokenı kullanır.
    for (const name of ['aile-select-tetik', 'aile-select-secenek', 'aile-select-kapat', 'aile-select-ara-girdi']) {
      const rule = new RegExp(`\\.${name}\\s*\\{[^}]*min-height:\\s*var\\(--aile-dokunma-hedefi\\)`);
      expect(css, name).toMatch(rule);
    }
    expect(css).not.toMatch(/\[data-input-coarse\]/);
    expect(css).not.toMatch(/calc\(var\(--aile-hedef-asgari\)\s*\+/);
  });
});

// --- Geniş profil: select-only combobox + popover listbox -------------------------------------------------------

describe('Select › geniş (masaüstü/tablet)', () => {
  const wrapper = onDevice('desktop');

  it('etiketiyle adlandırılan combobox; native select yok; liste kapalıyken DOM\'da yok', () => {
    const { container } = render(<Select label="Oda" options={odalar} />, { wrapper });
    const trigger = combobox();
    expect(container.querySelector('select')).toBeNull();
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('tabindex', '0');
    expect(trigger).toHaveTextContent('Seçin');
    expect(trigger.querySelector('[data-icon="chevronDown"]')).not.toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('tıklama açar; seçili seçenek aria-selected + onay simgesi; seçim onChange verir, kapanır, odak tetikte kalır', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Oda" options={odalar} value="salon" onChange={onChange} />, { wrapper });
    const trigger = combobox();
    expect(trigger).toHaveTextContent('Salon');
    await user.click(trigger);
    const list = screen.getByRole('listbox', { name: 'Oda' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', list.id);
    expect(trigger).toHaveFocus();
    const salon = option('Salon', list);
    expect(salon).toHaveAttribute('aria-selected', 'true');
    expect(salon).toHaveClass('is-secili');
    expect(salon.querySelector('[data-icon="check"]')).not.toBeNull();
    expect(option('Mutfak', list)).toHaveAttribute('aria-selected', 'false');
    expect(option('Mutfak', list).querySelector('[data-icon="check"]')).toBeNull();
    expect(trigger).toHaveAttribute('aria-activedescendant', salon.id);

    await user.click(option('Mutfak', list));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('mutfak');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-activedescendant');
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('seçenek adı yalnız etiket; textContent etiketle aynı (not yoksa); devre dışı seçenek nedenini note ile söyler ve seçilemez', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Oda" options={odalar} onChange={onChange} />, { wrapper });
    await user.click(combobox());
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option').map(o => o.textContent)).toEqual(['Mutfak', 'Salon', 'Yatak odasıÖnce teslim gerekir']);
    const yatak = option('Yatak odası', list);
    expect(yatak).toHaveAttribute('aria-disabled', 'true');
    expect(yatak).toHaveAccessibleDescription('Önce teslim gerekir');
    await user.click(yatak);
    expect(onChange).not.toHaveBeenCalled();
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');
    // Klavyeyle de seçilemez.
    await user.keyboard('{End}{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('includeUnknown ile "Bilinmiyor" listenin sonunda bir seçenektir', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Oda" options={odalar} includeUnknown onChange={onChange} />, { wrapper });
    await user.click(combobox());
    const names = within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent);
    expect(names[names.length - 1]).toBe(UNKNOWN_LABEL);
    await user.click(option('Bilinmiyor'));
    expect(onChange).toHaveBeenCalledWith(UNKNOWN_VALUE);
  });

  it('klavye (APG select-only): Tab ile odak, ↓ açar, oklar/Home/End gezer, Enter seçer; odak hep tetikte', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<><button type="button">Önce</button><Select label="Oda" options={odalar} value="mutfak" onChange={onChange} /><button type="button">Sonra</button></>, { wrapper });
    await user.tab();
    await user.tab();
    const trigger = combobox();
    expect(trigger).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-activedescendant', option('Mutfak').id);
    await user.keyboard('{ArrowDown}');
    expect(trigger).toHaveAttribute('aria-activedescendant', option('Salon').id);
    expect(option('Salon')).toHaveClass('is-etkin');
    await user.keyboard('{End}');
    expect(trigger).toHaveAttribute('aria-activedescendant', option('Yatak odası').id);
    await user.keyboard('{Home}');
    expect(trigger).toHaveAttribute('aria-activedescendant', option('Mutfak').id);
    await user.keyboard('{ArrowUp}');
    expect(trigger).toHaveAttribute('aria-activedescendant', option('Mutfak').id);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('salon');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('Space ve Enter açar; Alt+↑ etkin seçeneği seçip kapatır', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Oda" options={odalar} onChange={onChange} />, { wrapper });
    await user.tab();
    await user.keyboard(' ');
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Enter}');
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowDown}{Alt>}{ArrowUp}{/Alt}');
    expect(onChange).toHaveBeenCalledWith('salon');
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape seçim yapmadan kapatır, odak tetikte kalır ve olay üst katmana (çekmece) taşmaz; kapalıyken taşar', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const parentKeys = vi.fn();
    render(<div onKeyDown={event => parentKeys(event.key)}><Select label="Oda" options={odalar} onChange={onChange} /></div>, { wrapper });
    await user.click(combobox());
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    expect(combobox()).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    expect(parentKeys).not.toHaveBeenCalledWith('Escape');
    await user.keyboard('{Escape}');
    expect(parentKeys).toHaveBeenCalledWith('Escape');
  });

  it('Tab ve Shift+Tab listeyi seçmeden kapatır ve odağı doğal sıraya bırakır', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<><button type="button">Önce</button><Select label="Oda" options={odalar} onChange={onChange} /><button type="button">Sonra</button></>, { wrapper });
    await user.click(combobox());
    await user.keyboard('{ArrowDown}');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sonra' })).toHaveFocus();
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    await user.click(combobox());
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Önce' })).toHaveFocus();
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('dışarıya basmak (pointerdown) listeyi kapatır ve odağı çalmaz', async () => {
    const user = userEvent.setup();
    render(<><Select label="Oda" options={odalar} /><button type="button">Dış</button></>, { wrapper });
    await user.click(combobox());
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Dış' }));
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Dış' })).toHaveFocus();
  });

  it('yazarak arama (typeahead): kapalıyken açar ve eşleşene gider; aynı harf döner; çok harf öneki birleştirir', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Dönem" options={aylar} onChange={onChange} />, { wrapper });
    await user.tab();
    const trigger = combobox('Dönem');
    // Tuşlar arası süre Date.now ile denetlenir (500 ms üstü yeni arama).
    const now = vi.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000);
      await user.keyboard('ş');
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(trigger).toHaveAttribute('aria-activedescendant', option('Şubat 2098').id);
      now.mockReturnValue(10_000);
      await user.keyboard('m');
      expect(trigger).toHaveAttribute('aria-activedescendant', option('Mart 2098').id);
      now.mockReturnValue(10_100);
      await user.keyboard('m');
      expect(trigger).toHaveAttribute('aria-activedescendant', option('Mayıs 2098').id);
      now.mockReturnValue(20_000);
      await user.keyboard('e');
      expect(trigger).toHaveAttribute('aria-activedescendant', option('Eylül 2098').id);
      now.mockReturnValue(20_100);
      await user.keyboard('k');
      expect(trigger).toHaveAttribute('aria-activedescendant', option('Ekim 2098').id);
      now.mockReturnValue(30_000);
      await user.keyboard('x');
      expect(trigger).toHaveAttribute('aria-activedescendant', option('Ekim 2098').id);
    } finally {
      now.mockRestore();
    }
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('2098-10');
  });

  it('yardım ve hata metnini alana bağlar; hata "Hata:" ile başlar ve aria-invalid verir', () => {
    const { rerender } = render(<Select label="Oda" options={odalar} help="Teslim adresi için" />, { wrapper });
    expect(combobox()).toHaveAccessibleDescription('Teslim adresi için');
    expect(combobox()).not.toHaveAttribute('aria-invalid');
    rerender(<Select label="Oda" options={odalar} help="Teslim adresi için" error="Oda seçilmedi" />);
    expect(combobox()).toHaveAccessibleDescription('Hata: Oda seçilmedi');
    expect(combobox()).toHaveAttribute('aria-invalid', 'true');
  });

  it('hideLabel etiketi görsel olarak gizler, erişilebilir adı korur; icon ön simge olarak çizilir', () => {
    render(<Select label="Sıralama" options={odalar} hideLabel icon="sort" />, { wrapper });
    const trigger = combobox('Sıralama');
    expect(screen.getByText('Sıralama')).toHaveClass('aile-select-etiket--gizli');
    expect(trigger.querySelector('[data-icon="sort"]')).not.toBeNull();
  });

  it('devre dışı alan: aria-disabled, sekme sırasında değil, tıklama ve klavye açmaz', async () => {
    const user = userEvent.setup();
    render(<><Select label="Oda" options={odalar} disabled /><button type="button">Sonra</button></>, { wrapper });
    const trigger = combobox();
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    expect(trigger).not.toHaveAttribute('tabindex');
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sonra' })).toHaveFocus();
  });

  it('açıkken devre dışı kalırsa liste kapanır', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Select label="Oda" options={odalar} />, { wrapper });
    await user.click(combobox());
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');
    rerender(<Select label="Oda" options={odalar} disabled />);
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('id verilirse tetiğe uygulanır; seçeneklerde olmayan değer yer tutucuyu gösterir; open ön izlemede açık başlar', () => {
    render(<Select id="oda-secimi" label="Oda" options={odalar} value="garaj" open />, { wrapper });
    const trigger = combobox();
    expect(trigger).toHaveAttribute('id', 'oda-secimi');
    expect(trigger).toHaveTextContent('Seçin');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('etikete tıklamak tetiğe odaklanır, listeyi açmaz', async () => {
    const user = userEvent.setup();
    render(<Select label="Oda" options={odalar} />, { wrapper });
    await user.click(screen.getByText('Oda'));
    expect(combobox()).toHaveFocus();
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
  });
});

// --- Telefon: alttan açılan yerel diyalog + APG listbox -----------------------------------------------------------

describe('Select › telefon', () => {
  const wrapper = onDevice('phone');

  it('listeyi alttan açılan modal diyalogda sunar; seçili seçenek odaklanır; seçim onChange verir, kapanır, odak tetiğe döner', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<Select label="Oda" options={odalar} value="salon" onChange={onChange} />, { wrapper });
    expect(container.querySelector('select')).toBeNull();
    const trigger = combobox();
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Oda' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', dialog.id);
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Oda' })).toBeInTheDocument();
    const list = within(dialog).getByRole('listbox', { name: 'Oda' });
    const salon = option('Salon', list);
    expect(salon).toHaveAttribute('aria-selected', 'true');
    expect(salon.querySelector('[data-icon="check"]')).not.toBeNull();
    await waitFor(() => expect(salon).toHaveFocus());
    expect(salon).toHaveAttribute('tabindex', '0');
    expect(option('Mutfak', list)).toHaveAttribute('tabindex', '-1');
    const yatak = option('Yatak odası', list);
    expect(yatak).toHaveAttribute('aria-disabled', 'true');
    expect(within(yatak).getByText('Önce teslim gerekir')).toBeInTheDocument();

    await user.click(yatak);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(option('Mutfak', list));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('mutfak');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('klavye: Enter açar, oklar/Home/End dolaşan odakla gezer, Space seçer; odak tetiğe döner', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Oda" options={odalar} onChange={onChange} />, { wrapper });
    await user.tab();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Oda' });
    await waitFor(() => expect(option('Mutfak', dialog)).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(option('Salon', dialog)).toHaveFocus();
    expect(option('Salon', dialog)).toHaveAttribute('tabindex', '0');
    expect(option('Mutfak', dialog)).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{End}');
    expect(option('Yatak odası', dialog)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard('{Home}');
    expect(option('Mutfak', dialog)).toHaveFocus();
    await user.keyboard('{ArrowDown} ');
    expect(onChange).toHaveBeenCalledWith('salon');
    expect(combobox()).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Escape seçmeden kapatır, odak tetiğe döner, olay üst katmana taşmaz', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const parentKeys = vi.fn();
    render(<div onKeyDown={event => parentKeys(event.key)}><Select label="Oda" options={odalar} onChange={onChange} /></div>, { wrapper });
    await user.click(combobox());
    const dialog = screen.getByRole('dialog', { name: 'Oda' });
    await waitFor(() => expect(option('Mutfak', dialog)).toHaveFocus());
    await user.keyboard('{ArrowDown}{Escape}');
    expect(onChange).not.toHaveBeenCalled();
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    expect(combobox()).toHaveFocus();
    expect(parentKeys).not.toHaveBeenCalledWith('Escape');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('"Kapat" düğmesi ve örtü seçim yapmadan kapatır; odak tetiğe döner', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<Select label="Oda" options={odalar} onChange={onChange} />, { wrapper });
    await user.click(combobox());
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Kapat' }));
    expect(combobox()).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(combobox());
    const scrim = container.querySelector('.aile-select-sayfa-ortu');
    expect(scrim).not.toBeNull();
    expect(scrim).toHaveAttribute('aria-hidden', 'true');
    await user.click(scrim as Element);
    expect(combobox()).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it(`${SEARCH_THRESHOLD}'den fazla seçenekte süzme alanı: listeyi süzer, ↓ ilk seçeneğe geçer, eşleşme yoksa söyler`, async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Dönem" options={aylar} onChange={onChange} />, { wrapper });
    await user.click(combobox('Dönem'));
    const dialog = screen.getByRole('dialog', { name: 'Dönem' });
    expect(within(dialog).getAllByRole('option')).toHaveLength(12);
    const search = within(dialog).getByRole('searchbox', { name: 'Seçeneklerde ara' });
    await user.type(search, 'ka');
    expect(within(dialog).getAllByRole('option').map(o => o.textContent)).toEqual(['Kasım 2098']);
    await user.keyboard('{ArrowDown}');
    expect(option('Kasım 2098', dialog)).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(search).toHaveFocus();
    await user.clear(search);
    await user.type(search, 'zzz');
    expect(within(dialog).queryByRole('listbox')).toBeNull();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Eşleşen seçenek yok');
    await user.clear(search);
    await user.click(option('Aralık 2098', dialog));
    expect(onChange).toHaveBeenCalledWith('2098-12');
  });

  it(`${SEARCH_THRESHOLD} ve daha az seçenekte süzme alanı yok`, async () => {
    const user = userEvent.setup();
    render(<Select label="Oda" options={odalar} />, { wrapper });
    await user.click(combobox());
    expect(within(screen.getByRole('dialog')).queryByRole('searchbox')).toBeNull();
  });

  it('yazarak arama listede de çalışır (donanım klavyesi)', async () => {
    const user = userEvent.setup();
    render(<Select label="Dönem" options={aylar} />, { wrapper });
    await user.tab();
    await user.keyboard('n');
    const dialog = screen.getByRole('dialog', { name: 'Dönem' });
    await waitFor(() => expect(option('Nisan 2098', dialog)).toHaveFocus());
    await user.keyboard('t');
    expect(option('Nisan 2098', dialog)).toHaveFocus();
  });

  it('Pointer Events: basılı durum dokunmayla gelir; pointercancel (kaydırma) seçmeden temizler; dokunup bırakma tek kez seçer', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Oda" options={odalar} onChange={onChange} />, { wrapper });
    await user.click(combobox());
    const dialog = screen.getByRole('dialog', { name: 'Oda' });
    const mutfak = option('Mutfak', dialog);
    fireEvent.pointerDown(mutfak, { pointerId: 7, pointerType: 'touch', isPrimary: true });
    expect(mutfak).toHaveClass('is-basili');
    fireEvent.pointerCancel(mutfak, { pointerId: 7, pointerType: 'touch', isPrimary: true });
    expect(mutfak).not.toHaveClass('is-basili');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const salon = option('Salon', dialog);
    fireEvent.pointerDown(salon, { pointerId: 8, pointerType: 'touch', isPrimary: true });
    fireEvent.pointerUp(salon, { pointerId: 8, pointerType: 'touch', isPrimary: true });
    expect(salon).not.toHaveClass('is-basili');
    fireEvent.click(salon);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('salon');
  });

  it('showModal/close: açılış modal, kapanış önce modal\'ı bırakır sonra odak tetiğe döner', async () => {
    const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void; close?: () => void };
    const original = { showModal: proto.showModal, close: proto.close };
    const calls: string[] = [];
    proto.showModal = vi.fn(function (this: HTMLDialogElement) { calls.push('showModal'); this.setAttribute('open', ''); });
    proto.close = vi.fn(function (this: HTMLDialogElement) { calls.push('close'); this.removeAttribute('open'); });
    try {
      const user = userEvent.setup();
      render(<Select label="Oda" options={odalar} />, { wrapper });
      await user.click(combobox());
      expect(calls).toEqual(['showModal']);
      await user.keyboard('{Escape}');
      expect(calls).toEqual(['showModal', 'close']);
      expect(combobox()).toHaveFocus();
    } finally {
      proto.showModal = original.showModal;
      proto.close = original.close;
    }
  });
});

// --- Hareket: iki yönlü, anında semantik güncelleme ------------------------------------------------------------

describe('Select › hareket yaşam döngüsü', () => {
  it('kapanışta ARIA ve odak hemen güncellenir; katman çıkış geçişi bitince (transitionend) kaldırılır', async () => {
    const real = window.getComputedStyle;
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
      const style = real(element, pseudo);
      if (!(element instanceof HTMLElement) || !element.matches('.aile-select-acilir, .aile-select-sayfa-panel')) return style;
      return new Proxy(style, {
        get(target, key) {
          if (key === 'transitionDuration') return '0.24s';
          if (key === 'transitionDelay') return '0s';
          const value = Reflect.get(target, key) as unknown;
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
    });
    try {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Select label="Oda" options={odalar} onChange={onChange} />, { wrapper: onDevice('desktop') });
      await user.click(combobox());
      const popup = document.querySelector('.aile-select-acilir') as HTMLElement;
      await waitFor(() => expect(popup).toHaveAttribute('data-state', 'acik'));
      await user.click(option('Salon'));
      expect(onChange).toHaveBeenCalledWith('salon');
      expect(combobox()).toHaveAttribute('aria-expanded', 'false');
      expect(combobox()).toHaveFocus();
      expect(popup).toHaveAttribute('data-state', 'cikis');
      expect(popup).toHaveAttribute('aria-hidden', 'true');
      expect(popup).toHaveAttribute('inert');
      expect(screen.queryByRole('listbox')).toBeNull();
      fireEvent.transitionEnd(popup, { propertyName: 'opacity' });
      expect(document.querySelector('.aile-select-acilir')).toBeNull();

      // Çıkış sırasında yeniden açmak aynı katmanı geri çevirir (mevcut konumdan).
      await user.click(combobox());
      const again = document.querySelector('.aile-select-acilir') as HTMLElement;
      await waitFor(() => expect(again).toHaveAttribute('data-state', 'acik'));
      await user.keyboard('{Escape}');
      expect(again).toHaveAttribute('data-state', 'cikis');
      await user.click(combobox());
      expect(document.querySelector('.aile-select-acilir')).toBe(again);
      await waitFor(() => expect(again).toHaveAttribute('data-state', 'acik'));
      expect(again).not.toHaveAttribute('inert');
    } finally {
      spy.mockRestore();
    }
  });
});

// --- Profil değişimi: seçim ve açık durum korunur -----------------------------------------------------------------

describe('Select › profil değişimi', () => {
  let original: typeof window.matchMedia;
  beforeEach(() => { original = window.matchMedia; });
  afterEach(() => { window.matchMedia = original; });

  it('telefonda yapılan seçim genişlemede korunur; açık liste yeni sunuma geçer ve odak doğru yere taşınır', async () => {
    const viewport = installViewport({ width: 320, height: 568, coarse: true });
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DeviceProvider><Select label="Oda" options={odalar} onChange={onChange} /></DeviceProvider>);
    const trigger = combobox();
    await user.click(trigger);
    await user.click(option('Salon', screen.getByRole('dialog', { name: 'Oda' })));
    expect(trigger).toHaveTextContent('Salon');

    act(() => viewport.set({ width: 1280, height: 800, coarse: false, fine: true, hover: true }));
    expect(combobox()).toBe(trigger);
    expect(trigger).toHaveTextContent('Salon');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    await user.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(option('Salon')).toHaveAttribute('aria-selected', 'true');

    // Açıkken telefona daralır: diyalog açılır, odak seçili seçenekte.
    act(() => viewport.set({ width: 375, height: 667, coarse: true, fine: false, hover: false }));
    const dialog = screen.getByRole('dialog', { name: 'Oda' });
    await waitFor(() => expect(option('Salon', dialog)).toHaveFocus());
    // Açıkken genişler: popover, odak tetikte.
    act(() => viewport.set({ width: 1280, height: 800, coarse: false, fine: true, hover: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('listbox', { name: 'Oda' })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
