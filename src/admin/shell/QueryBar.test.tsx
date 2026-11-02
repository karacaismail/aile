import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState, type ReactNode } from 'react';
import { DeviceContext } from '../device';
import type { ActiveFilter, Device, QueryBarProps, SavedView, SortOption, ViewMode } from './contracts';
import { QueryBar } from './QueryBar';

// Kaynak: aile-tasarim/tasarim-sistemi/README.md › Sayfa iskeleti (3. Sorgu çubuğu, 4. Filtreler), components/QueryBar/README.md,
// index.d.ts QueryBarProps, bundle.js › QueryBar (geniş: arama · kayıtlı görünüm · sıralama · dışa aktar · Tabs segment;
// dar: arama tam genişlik · "Filtreler (N)" + sıralama + dışa aktar · mod seçimi · etkin etiketler). Seçiciler role/label ile.

const onDevice = (device: Device) => ({ children }: { children: ReactNode }) =>
  createElement(DeviceContext.Provider, { value: device }, children);

const SIRALAR: readonly SortOption[] = [
  { key: 'degisiklik', label: 'Son değişiklik', direction: 'desc' },
  { key: 'plan', label: 'Planlanan tutar', direction: 'desc' },
  { key: 'ad', label: 'Ada göre', direction: 'asc' },
];
const GEREKCE = 'alımların başlangıç ve bitiş tarihi yok';
const TAM_GEREKCE = 'Gantt kullanılamaz: alımların başlangıç ve bitiş tarihi yok.';

function makeProps(over: Partial<QueryBarProps> & { filterCount?: number } = {}): QueryBarProps & { filterCount?: number } {
  return {
    mode: 'listing',
    onModeChange: vi.fn(),
    supported: ['listing', 'table', 'timeline', 'kanban', 'pivot'],
    unsupportedReason: { gantt_chart: GEREKCE },
    search: '',
    onSearchChange: vi.fn(),
    sort: SIRALAR[0],
    sortOptions: SIRALAR,
    onSort: vi.fn(),
    exportLabel: 'CSV indir',
    onExport: vi.fn(),
    activeFilters: [],
    onOpenFilters: vi.fn(),
    resultCount: 12,
    ...over,
  };
}

const filtreler = (): readonly ActiveFilter[] => [
  { id: 'asama:once', label: 'Aşama: Önce', onRemove: vi.fn() },
  { id: 'asama:yerlesme', label: 'Aşama: Yerleşme', onRemove: vi.fn() },
];

describe('QueryBar › geniş (masaüstü)', () => {
  const wrapper = onDevice('desktop');

  it('role="search" bölgesi; görünür "Ara" etiketli arama kutusu her tuşta onSearchChange verir', async () => {
    const user = userEvent.setup();
    const props = makeProps({ search: 'kary' });
    render(<QueryBar {...props} />, { wrapper });
    const bolge = screen.getByRole('search');
    const ara = within(bolge).getByRole('searchbox', { name: 'Ara' });
    expect(ara).toHaveValue('kary');
    expect(screen.getByText('Ara').tagName).toBe('LABEL');
    expect(screen.getByText('Ara')).not.toHaveClass('aile-gorsel-gizli');
    await user.type(ara, 'o');
    expect(props.onSearchChange).toHaveBeenCalledWith('karyo');
  });

  it('6 görünüm modu segment olarak; desteklenmeyen mod devre dışı ve gerekçesi altında, gruba açıklama olarak bağlı', async () => {
    const user = userEvent.setup();
    const props = makeProps({ mode: 'table' });
    render(<QueryBar {...props} />, { wrapper });
    const grup = screen.getByRole('radiogroup', { name: 'Görünüm modu' });
    const radyolar = within(grup).getAllByRole('radio');
    expect(radyolar.map(r => r.getAttribute('aria-label') ?? r.textContent)).toHaveLength(6);
    expect(screen.getByRole('radio', { name: 'Liste' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Zaman çizelgesi' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Pivot' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Tablo' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Gantt' })).toBeDisabled();
    expect(grup).toHaveAccessibleDescription(TAM_GEREKCE);
    expect(screen.getByText(TAM_GEREKCE)).toBeVisible();

    await user.click(screen.getByText('Kanban'));
    expect(props.onModeChange).toHaveBeenCalledTimes(1);
    expect(props.onModeChange).toHaveBeenCalledWith('kanban');
    await user.click(screen.getByText('Gantt'));
    expect(props.onModeChange).toHaveBeenCalledTimes(1);
  });

  it('gerekçesiz desteklenmeyen mod yine devre dışıdır ve "kullanılamaz" yazar; her mod destekleniyorsa not yok', () => {
    const { unmount } = render(<QueryBar {...makeProps({ supported: ['listing'], unsupportedReason: undefined })} />, { wrapper });
    expect(screen.getByRole('radio', { name: 'Pivot' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Liste' })).toBeEnabled();
    expect(screen.getByRole('radiogroup', { name: 'Görünüm modu' })).toHaveAccessibleDescription(/Pivot kullanılamaz\./);
    unmount();
    render(<QueryBar {...makeProps({ supported: ['listing', 'table', 'timeline', 'kanban', 'gantt_chart', 'pivot'], unsupportedReason: undefined })} />, { wrapper });
    expect(screen.getByRole('radiogroup', { name: 'Görünüm modu' })).not.toHaveAccessibleDescription();
    expect(screen.queryByText(/kullanılamaz/)).toBeNull();
  });

  it('kayıtlı görünüm ve sıralama combobox; seçim onSelect / onSort(SortOption) çağırır', async () => {
    const user = userEvent.setup();
    const kaydedilenler: readonly SavedView[] = [
      { id: 'tum', label: 'Tüm alımlar', onSelect: vi.fn(), active: true },
      { id: 'bebek', label: 'Bebek odası hazırlığı', onSelect: vi.fn() },
    ];
    const props = makeProps({ savedViews: kaydedilenler });
    render(<QueryBar {...props} />, { wrapper });

    // Kayıtlı görünüm geniş-özel modülden (lazyWide, ./QueryBar.wide) gelir; ayrıntı QueryBar.adaptive.test.tsx'te.
    const gorunum = await screen.findByRole('combobox', { name: 'Kayıtlı görünüm' });
    expect(screen.getByText('Tüm alımlar')).toBeInTheDocument();
    await user.click(gorunum);
    await user.click(await screen.findByRole('option', { name: 'Bebek odası hazırlığı' }));
    expect(kaydedilenler[1].onSelect).toHaveBeenCalledTimes(1);
    expect(kaydedilenler[0].onSelect).not.toHaveBeenCalled();

    const siralama = screen.getByRole('combobox', { name: 'Sıralama' });
    expect(screen.getByText('Son değişiklik')).toBeInTheDocument();
    await user.click(siralama);
    await user.click(await screen.findByRole('option', { name: 'Ada göre' }));
    expect(props.onSort).toHaveBeenCalledWith(SIRALAR[2]);
  });

  it('dışa aktar düğmesi exportLabel ile adlanır ve onExport çağırır; exportLabel yoksa yoktur', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    const { unmount } = render(<QueryBar {...props} />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'CSV indir' }));
    expect(props.onExport).toHaveBeenCalledTimes(1);
    unmount();
    render(<QueryBar {...makeProps({ exportLabel: undefined, onExport: undefined })} />, { wrapper });
    expect(screen.queryByRole('button', { name: /indir|Dışa aktar/ })).toBeNull();
  });

  it('kayıtlı görünüm yoksa o combobox çizilmez; sonuç sayısı tr-TR biçiminde durum metni olarak yazılır', () => {
    render(<QueryBar {...makeProps({ resultCount: 1250 })} />, { wrapper });
    expect(screen.queryByRole('combobox', { name: 'Kayıtlı görünüm' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('1.250 sonuç');
  });

  it('etkin filtreler kaldırılabilir etiket; kaldır düğmesi yalnız o filtrenin onRemove\'unu çağırır, "Tümünü temizle" hepsini', async () => {
    const user = userEvent.setup();
    const aktif = filtreler();
    render(<QueryBar {...makeProps({ activeFilters: aktif })} />, { wrapper });
    expect(screen.getByText('Etkin filtreler')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aşama: Önce filtresini kaldır' }));
    expect(aktif[0].onRemove).toHaveBeenCalledTimes(1);
    expect(aktif[1].onRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Tümünü temizle' }));
    expect(aktif[0].onRemove).toHaveBeenCalledTimes(2);
    expect(aktif[1].onRemove).toHaveBeenCalledTimes(1);
  });

  it('etkin filtre yokken etiket satırı ve "Tümünü temizle" yoktur; geniş düzende "Filtreler (N)" düğmesi yok', () => {
    render(<QueryBar {...makeProps()} />, { wrapper });
    expect(screen.queryByText('Etkin filtreler')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tümünü temizle' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Filtreler/ })).toBeNull();
  });
});

describe('QueryBar › dar (telefon ve tablet)', () => {
  it('telefon: "Filtreler (N)" onOpenFilters çağırır ve çekmece açacağını söyler; mod seçimi combobox; sıralama ve dışa aktar kalır', async () => {
    const user = userEvent.setup();
    const aktif = filtreler();
    const props = makeProps({ activeFilters: aktif });
    render(<QueryBar {...props} />, { wrapper: onDevice('phone') });

    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Ara' })).toBeInTheDocument();
    const filtre = screen.getByRole('button', { name: 'Filtreler (2)' });
    expect(filtre).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(filtre);
    expect(props.onOpenFilters).toHaveBeenCalledTimes(1);

    // Telefonda 6 mod Select'e düşer (Tabs sözleşmesi); gerekçe açıklama olarak bağlı kalır.
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Görünüm modu' })).toHaveAccessibleDescription(TAM_GEREKCE);

    expect(screen.getByRole('combobox', { name: 'Sıralama' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Kayıtlı görünüm' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'CSV indir' }));
    expect(props.onExport).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Aşama: Yerleşme filtresini kaldır' }));
    expect(aktif[1].onRemove).toHaveBeenCalledTimes(1);
  });

  it('telefon: tetik sayısı filterCount verilince onu yazar (arama gibi panel dışı etkinler sayılmaz)', () => {
    const aktif: readonly ActiveFilter[] = [{ id: 'ara', label: 'Arama: kase', onRemove: vi.fn() }, ...filtreler()];
    const { rerender } = render(<QueryBar {...makeProps({ activeFilters: aktif, filterCount: 2 })} />, { wrapper: onDevice('phone') });
    expect(screen.getByRole('button', { name: 'Filtreler (2)' })).toBeInTheDocument();
    rerender(<QueryBar {...makeProps({ activeFilters: aktif })} />);
    expect(screen.getByRole('button', { name: 'Filtreler (3)' })).toBeInTheDocument();
    rerender(<QueryBar {...makeProps({ activeFilters: aktif, filterCount: 1250 })} />);
    expect(screen.getByRole('button', { name: 'Filtreler (1.250)' })).toBeInTheDocument();
  });

  it('telefon: arama tam genişlik ve sıralama Select (görsel etiketsiz, erişilebilir adlı); "Tümünü temizle" hedef sınıfında', () => {
    render(<QueryBar {...makeProps({ activeFilters: filtreler() })} />, { wrapper: onDevice('phone') });
    const ara = screen.getByRole('searchbox', { name: 'Ara' });
    expect(ara.closest('.aile-sorgu-ara')).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Sıralama' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tümünü temizle' })).toHaveClass('aile-sorgu-temizle');
    expect(screen.getByRole('button', { name: 'Filtreler (2)' })).toHaveClass('aile-sorgu-filtre');
  });

  it('tablet: aynı dar düzen (filtre sağdan çekmece), mod seçimi segment kalır', () => {
    render(<QueryBar {...makeProps()} />, { wrapper: onDevice('tablet') });
    expect(screen.getByRole('button', { name: 'Filtreler (0)' })).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.getByRole('radiogroup', { name: 'Görünüm modu' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Gantt' })).toBeDisabled();
  });
});

describe('QueryBar › durum profil ve görünüm modu değişiminde korunur', () => {
  function Harness({ profile }: { profile: Device }) {
    const [mode, setMode] = useState<ViewMode>('listing');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<SortOption>(SIRALAR[0]);
    const [aktif, setAktif] = useState<readonly string[]>(['Aşama: Önce']);
    return (
      <DeviceContext.Provider value={profile}>
        <QueryBar
          {...makeProps({
            mode, onModeChange: setMode, search, onSearchChange: setSearch, sort, onSort: setSort,
            activeFilters: aktif.map(label => ({ id: label, label, onRemove: () => setAktif(list => list.filter(item => item !== label)) })),
          })}
        />
      </DeviceContext.Provider>
    );
  }

  it('telefon → masaüstü → tablet → telefon ve mod değişimi: arama, sıralama, mod ve etkin filtreler aynı kalır', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness profile="phone" />);
    await user.type(screen.getByRole('searchbox', { name: 'Ara' }), 'kase');
    await user.click(screen.getByRole('combobox', { name: 'Sıralama' }));
    await user.click(await screen.findByRole('option', { name: 'Ada göre' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getAllByText('Ada göre').length).toBeGreaterThan(0);

    rerender(<Harness profile="desktop" />);
    expect(screen.getByRole('searchbox', { name: 'Ara' })).toHaveValue('kase');
    expect(screen.getAllByText('Ada göre').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Aşama: Önce filtresini kaldır' })).toBeInTheDocument();
    await user.click(screen.getByText('Tablo'));
    expect(screen.getByRole('radio', { name: 'Tablo' })).toBeChecked();
    expect(screen.getByRole('searchbox', { name: 'Ara' })).toHaveValue('kase');
    expect(screen.getAllByText('Ada göre').length).toBeGreaterThan(0);

    rerender(<Harness profile="tablet" />);
    expect(screen.getByRole('radio', { name: 'Tablo' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Filtreler (1)' })).toBeInTheDocument();

    rerender(<Harness profile="phone" />);
    expect(screen.getByRole('searchbox', { name: 'Ara' })).toHaveValue('kase');
    expect(screen.getByRole('button', { name: 'Filtreler (1)' })).toBeInTheDocument();
    expect(screen.getAllByText('Ada göre').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tablo').length).toBeGreaterThan(0);
  });
});

describe('QueryBar.css ve kaynak (tasarım kuralları, statik)', () => {
  const read = (name: string) => readFileSync(resolve(__dirname, name), 'utf8');

  it('stil dosyasını içe alır; antd/phosphor/echarts yalnız ../ui üzerinden', () => {
    const source = read('QueryBar.tsx');
    expect(source).toContain("import './QueryBar.css'");
    expect(source).not.toMatch(/from ['"]antd/);
    expect(source).not.toMatch(/from ['"]@ant-design/);
    expect(source).not.toMatch(/from ['"]@phosphor-icons/);
    expect(source).not.toMatch(/from ['"]echarts/);
    expect(source).not.toMatch(/@mantine/);
  });

  it('CSS yalnız --aile tokenları kullanır: sabit renk yok, odak halkası/outline/box-shadow yok, 14 px altı metin yok', () => {
    const css = read('QueryBar.css');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/outline\s*:/);
    expect(css).not.toMatch(/box-shadow\s*:/);
    const sizes = [...css.matchAll(/font-size\s*:\s*(\d+)px/g)].map(m => Number(m[1]));
    expect(sizes.every(size => size >= 14)).toBe(true);
    expect(css).toMatch(/var\(--aile-/);
  });

  it('dokunma hedefi: Filtreler ve "Tümünü temizle" en az 44 px, kaba girişte 48 px (token hesabı, sabit px yok)', () => {
    const css = read('QueryBar.css');
    // Merkezi uyarlamalı hedef tokenı (b04, admin.css): 44 px, kaba girişte ([data-input-coarse]) 48 px; yerelde yeniden türetilmez.
    expect(css).toMatch(/\.aile-sorgu-temizle[^{]*\{[^}]*min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).toMatch(/\.aile-sorgu-filtre[^{]*\{[^}]*min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).toMatch(/\.aile-sorgu-disa\s*\{[^}]*min-width:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).not.toMatch(/data-input-coarse|calc\(var\(--aile-hedef-asgari\)/);
  });
});
