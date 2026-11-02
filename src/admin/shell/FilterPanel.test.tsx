import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FilterFacet } from './contracts';
import { FilterPanel, facetSelectedCount } from './FilterPanel';

// Tasarım › components/FilterPanel/README.md + README "Filtre boyutları": başlık h3 "Filtreler" + "Temizle"; her boyut
// ayrı Disclosure (meta = seçili sayısı); seçeneklerde sayım; "Bilinmiyor" sonda; kategori ağacında üst seçim alt dalları
// kapsar, kısmi seçimde üst kutu çizgi (indeterminate); tarih = tür Select + iki alan gg.aa.yyyy (numeric); tutar = en az /
// en çok (decimal); bare çekmece içinde başlıksız. Seçiciler role/label ile; antd iç sınıfına bağlı seçici yok.
const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

const kategori: FilterFacet = {
  id: 'kategori', label: 'Kategori', kind: 'tree', selected: [],
  options: [
    { value: 'bilinmiyor', label: 'Bilinmiyor', count: 4 },
    { value: 'mobilya', label: 'Mobilya', count: 14 },
    { value: 'bebek-mobilyasi', label: 'Bebek mobilyası', count: 5, parent: 'mobilya' },
    { value: 'oturma', label: 'Oturma', count: 6, parent: 'mobilya' },
    { value: 'tekstil', label: 'Tekstil', count: 7 },
  ],
};
const oda: FilterFacet = {
  id: 'oda', label: 'Oda', kind: 'checkbox', selected: ['salon'],
  options: [
    { value: 'bilinmiyor', label: 'Bilinmiyor', count: 2 },
    { value: 'bebek-odasi', label: 'Bebek odası', count: 9 },
    { value: 'salon', label: 'Salon', count: 7 },
  ],
};
const asama: FilterFacet = {
  id: 'asama', label: 'Proje aşaması', kind: 'checkbox', selected: ['once', 'yerlesme'],
  options: [{ value: 'once', label: 'Önce', count: 12 }, { value: 'yerlesme', label: 'Yerleşme', count: 10 }, { value: 'sonra', label: 'Sonra', count: 6 }],
};
const tarih: FilterFacet = {
  id: 'tarih', label: 'Tarih', kind: 'date', selected: ['teslim'],
  options: [{ value: 'teslim', label: 'Planlanan teslim' }, { value: 'siparis', label: 'Sipariş tarihi' }, { value: 'odeme', label: 'Ödeme tarihi' }],
};
const tutar: FilterFacet = { id: 'tutar', label: 'Tutar aralığı', kind: 'amount', selected: [], options: [] };

const facets = [kategori, oda, asama, tarih, tutar];
const disclosure = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const regionOf = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-controls')!)!;

describe('FilterPanel', () => {
  it('başlık h3 "Filtreler" ve "Temizle" (onClear); bölge aria-label Filtreler', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<FilterPanel facets={facets} onToggle={vi.fn()} onClear={onClear} />);
    expect(screen.getByRole('region', { name: 'Filtreler' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Filtreler' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Temizle' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('bare: başlık ve Temizle yok, boyutlar duruyor', () => {
    render(<FilterPanel facets={facets} onToggle={vi.fn()} onClear={vi.fn()} bare />);
    expect(screen.queryByRole('heading', { level: 3, name: 'Filtreler' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Temizle' })).toBeNull();
    expect(disclosure('Kategori')).toBeInTheDocument();
    expect(disclosure('Tutar aralığı')).toBeInTheDocument();
  });

  // r-a11y (f10 yapı sözleşmesi, /alimlar masaüstü): bare panel her zaman adını veren bir ev sahibinin içindedir
  // (FilterArea bölgesi "Filtreler", FilterDrawer / alt sayfa diyaloğu "Filtreler"). Kendisi de "Filtreler" adlı bölge
  // olursa aynı adlı iki region landmark oluşur ("region [Filtreler, Filtreler, ...]"); bare kök landmark değildir.
  it('bare: kök adlı landmark değildir (ev sahibi adlandırır); başlıklı panel "Filtreler" bölgesi kalır', () => {
    const { container, unmount } = render(<FilterPanel facets={facets} onToggle={vi.fn()} onClear={vi.fn()} bare />);
    // Boyut panelleri (Disclosure) kendi adlarıyla bölgedir; panel kökü "Filtreler" bölgesi değildir.
    expect(screen.queryByRole('region', { name: 'Filtreler' })).toBeNull();
    const root = container.querySelector('.aile-filtre')!;
    expect(root).not.toBeNull();
    expect(root.tagName).not.toBe('SECTION');
    expect(root).not.toHaveAttribute('aria-label');
    expect(root).not.toHaveAttribute('role');
    unmount();

    // Ev sahibinin içinde tek "Filtreler" bölgesi (FilterArea kalıbı): iç içe ikinci adaş bölge yok.
    render(
      <section aria-label="Filtreler">
        <FilterPanel facets={facets} onToggle={vi.fn()} onClear={vi.fn()} bare />
      </section>,
    );
    expect(screen.getAllByRole('region', { name: 'Filtreler' })).toHaveLength(1);
  });

  it('her boyut bir Disclosure: openKeys açık başlar, diğerleri kapalı; meta seçili sayısı', () => {
    render(<FilterPanel facets={facets} onToggle={vi.fn()} onClear={vi.fn()} openKeys={['oda']} />);
    expect(disclosure('Oda')).toHaveAttribute('aria-expanded', 'true');
    expect(disclosure('Kategori')).toHaveAttribute('aria-expanded', 'false');
    expect(regionOf(disclosure('Kategori'))).toHaveAttribute('hidden');
    expect(within(disclosure('Proje aşaması')).getByText('2 seçili')).toBeInTheDocument();
    expect(within(disclosure('Oda')).getByText('1 seçili')).toBeInTheDocument();
    expect(within(disclosure('Kategori')).queryByText(/seçili/)).toBeNull();
  });

  it('checkbox seçenekleri etiket + sayım; seçili işaretli; tıklama onToggle(facetId, value)', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<FilterPanel facets={[oda]} onToggle={onToggle} onClear={vi.fn()} openKeys={['oda']} />);
    const region = regionOf(disclosure('Oda'));
    const salon = within(region).getByRole('checkbox', { name: /^Salon/ });
    expect(salon).toBeChecked();
    expect(within(region).getByRole('checkbox', { name: /^Bebek odası/ })).not.toBeChecked();
    expect(within(region).getByText('7')).toBeInTheDocument();
    await user.click(within(region).getByRole('checkbox', { name: /^Bebek odası/ }));
    expect(onToggle).toHaveBeenCalledWith('oda', 'bebek-odasi');
    await user.click(salon);
    expect(onToggle).toHaveBeenCalledWith('oda', 'salon');
  });

  it('"Bilinmiyor" her boyutta sonda; ağaçta alt dallar üstün hemen ardından', () => {
    render(<FilterPanel facets={[kategori, oda]} onToggle={vi.fn()} onClear={vi.fn()} openKeys={['kategori', 'oda']} />);
    const odaNames = within(regionOf(disclosure('Oda'))).getAllByRole('checkbox').map(el => el.getAttribute('aria-label') ?? '');
    expect(odaNames.map(n => n.replace(/\s*\d+$/, ''))).toEqual(['Bebek odası', 'Salon', 'Bilinmiyor']);
    const katNames = within(regionOf(disclosure('Kategori'))).getAllByRole('checkbox').map(el => el.getAttribute('aria-label') ?? '');
    expect(katNames.map(n => n.replace(/\s*\d+$/, ''))).toEqual(['Mobilya', 'Bebek mobilyası', 'Oturma', 'Tekstil', 'Bilinmiyor']);
  });

  it('ağaç: kısmi alt seçimde üst indeterminate; üst seçiliyse alt dallar kapsanır (işaretli); üst tıklaması üst değeri gönderir', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const kismi = { ...kategori, selected: ['oturma'] };
    const { rerender } = render(<FilterPanel facets={[kismi]} onToggle={onToggle} onClear={vi.fn()} openKeys={['kategori']} />);
    let region = regionOf(disclosure('Kategori'));
    const mobilya = () => within(region).getByRole('checkbox', { name: /^Mobilya/ });
    expect(mobilya()).toBePartiallyChecked();
    expect(within(region).getByRole('checkbox', { name: /^Oturma/ })).toBeChecked();
    expect(within(region).getByRole('checkbox', { name: /^Bebek mobilyası/ })).not.toBeChecked();
    expect(screen.getByText('Üst kategori seçilince tüm alt dalları kapsar.')).toBeInTheDocument();

    await user.click(mobilya());
    expect(onToggle).toHaveBeenCalledWith('kategori', 'mobilya');

    rerender(<FilterPanel facets={[{ ...kategori, selected: ['mobilya'] }]} onToggle={onToggle} onClear={vi.fn()} openKeys={['kategori']} />);
    region = regionOf(disclosure('Kategori'));
    expect(mobilya()).toBeChecked();
    expect(mobilya()).not.toBePartiallyChecked();
    expect(within(region).getByRole('checkbox', { name: /^Oturma/ })).toBeChecked();
    expect(within(region).getByRole('checkbox', { name: /^Bebek mobilyası/ })).toBeChecked();
    expect(within(disclosure('Kategori')).getByText('1 seçili')).toBeInTheDocument();
  });

  it('tarih: "Tarih türü" Select + Başlangıç/Bitiş alanları (gg.aa.yyyy, numeric); değer blur ile onToggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<FilterPanel facets={[tarih]} onToggle={onToggle} onClear={vi.fn()} openKeys={['tarih']} />);
    expect(screen.getByRole('combobox', { name: 'Tarih türü' })).toBeInTheDocument();
    expect(screen.getByText('Planlanan teslim')).toBeInTheDocument();
    const baslangic = screen.getByRole('textbox', { name: 'Başlangıç' });
    const bitis = screen.getByRole('textbox', { name: 'Bitiş' });
    for (const input of [baslangic, bitis]) {
      expect(input).toHaveAttribute('placeholder', 'gg.aa.yyyy');
      expect(input).toHaveAttribute('inputmode', 'numeric');
    }
    await user.type(baslangic, '28.10.2026');
    expect(onToggle).not.toHaveBeenCalled();
    await user.tab();
    expect(onToggle).toHaveBeenCalledWith('tarih', 'baslangic=28.10.2026');
  });

  it('tutar: En az / En çok alanları decimal, ₺ eki; değer blur ile onToggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<FilterPanel facets={[{ ...tutar, selected: ['enaz=1000'] }]} onToggle={onToggle} onClear={vi.fn()} openKeys={['tutar']} />);
    const enAz = screen.getByRole('textbox', { name: 'En az' });
    const enCok = screen.getByRole('textbox', { name: 'En çok' });
    expect(enAz).toHaveValue('1000');
    for (const input of [enAz, enCok]) expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getAllByText('₺')).toHaveLength(2);
    expect(within(disclosure('Tutar aralığı')).getByText('1 seçili')).toBeInTheDocument();
    await user.type(enCok, '8500');
    await user.tab();
    expect(onToggle).toHaveBeenCalledWith('tutar', 'encok=8500');
  });

  it('seçenek yerel checkbox: görünür kutu odak alır (gizli antd input yok), satır etiket + data-focus-line, sayım tr-TR', () => {
    const buyuk: FilterFacet = { ...oda, options: [...oda.options, { value: 'mutfak', label: 'Mutfak', count: 1250 }] };
    const { container } = render(<FilterPanel bare facets={[buyuk]} onToggle={vi.fn()} onClear={vi.fn()} openKeys={['oda']} />);
    const salon = screen.getByRole('checkbox', { name: 'Salon' });
    expect(salon.tagName).toBe('INPUT');
    expect(salon).toHaveAttribute('type', 'checkbox');
    expect(salon).toHaveAccessibleDescription('7');
    // Odak çizgisini admin.css [data-focus-line]:has(:focus-visible)::after satırın altına çizer; satır tıklanabilir etikettir.
    const satir = salon.closest('label');
    expect(satir).not.toBeNull();
    expect(satir).toHaveAttribute('data-focus-line');
    expect(satir).toHaveTextContent('Salon');
    // antd Checkbox'ın opacity 0 input'u ve sınıfları yok: telefon yolu antd istemez.
    expect(container.querySelector('[class*="ant-"]')).toBeNull();
    expect(screen.getByText('1.250')).toBeInTheDocument();
  });

  it('ağaç kısmi seçimi yerel indeterminate ile bildirir; aria-checked yerel checkbox üzerinde yazılmaz', () => {
    render(<FilterPanel facets={[{ ...kategori, selected: ['oturma'] }]} onToggle={vi.fn()} onClear={vi.fn()} openKeys={['kategori']} />);
    const mobilya = screen.getByRole('checkbox', { name: 'Mobilya' }) as HTMLInputElement;
    expect(mobilya.indeterminate).toBe(true);
    expect(mobilya).not.toHaveAttribute('aria-checked');
  });

  it('yazılmış ama blur olmamış aralık değeri bileşen sökülünce (profil/mod değişimi) kaybolmaz: onToggle ile bildirilir', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { unmount } = render(<FilterPanel facets={[tutar]} onToggle={onToggle} onClear={vi.fn()} openKeys={['tutar']} />);
    await user.type(screen.getByRole('textbox', { name: 'En çok' }), '8500');
    expect(onToggle).not.toHaveBeenCalled();
    unmount();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('tutar', 'encok=8500');
  });

  it('değişmemiş aralık alanı sökülünce hiçbir şey bildirmez', () => {
    const onToggle = vi.fn();
    const { unmount } = render(<FilterPanel facets={[{ ...tutar, selected: ['enaz=1000'] }]} onToggle={onToggle} onClear={vi.fn()} openKeys={['tutar']} />);
    unmount();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('facetSelectedCount: tarih türü ve boş aralık girdisi seçim sayılmaz', () => {
    expect(facetSelectedCount(tarih)).toBe(0);
    expect(facetSelectedCount({ ...tarih, selected: ['teslim', 'baslangic=01.10.2026', 'bitis='] })).toBe(1);
    expect(facetSelectedCount(asama)).toBe(2);
    expect(facetSelectedCount({ ...tutar, selected: ['enaz=1000', 'encok=2000'] })).toBe(2);
  });

  it('CSS: kutu görünür (gizlenmez), kaba girişte satır 48 px, masaüstünde başlıklı panel 272 px, hover yalnız hover katmanında', () => {
    const css = read('FilterPanel.css');
    expect(css).toMatch(/\.aile-filtre-kutu\s*\{[^}]*appearance:\s*none/);
    expect(css).not.toMatch(/\.aile-filtre-kutu[^{]*\{[^}]*opacity:\s*0/);
    // Satır hedefi merkezi uyarlamalı token (b04): 44 px, kaba girişte 48 px; kaba kural yerelde yeniden türetilmez.
    expect(css).toMatch(/\.aile-filtre-secenek\s*\{[^}]*min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).not.toMatch(/data-input-coarse|calc\(var\(--aile-hedef-asgari\)/);
    expect(css).toMatch(/\[data-profile='desktop'\][^{]*\.aile-filtre:not\(\.aile-filtre--bare\)[^{]*\{[^}]*var\(--aile-filtre-genislik\)/);
    expect(css).toMatch(/\[data-input-hover\][^{]*\.aile-filtre-secenek:hover/);
    expect(css).not.toMatch(/^\.aile-filtre-secenek:hover/m);
  });

  it('kaynak: ham antd importu yok (ui üzerinden), CSS yalnız token; outline/box-shadow/sabit renk yok', () => {
    const tsx = read('FilterPanel.tsx');
    expect(tsx).not.toMatch(/from\s+['"](antd|@ant-design\/[^'"]+|@phosphor-icons\/[^'"]+|echarts)['"]/);
    expect(tsx, 'telefon yolunda ui/antd importu').not.toMatch(/from\s+['"]\.\.\/ui\/antd['"]/);
    expect(tsx).toContain("import './FilterPanel.css'");
    const css = read('FilterPanel.css');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/^\s*(outline|box-shadow)\s*:/m);
    expect(css).toMatch(/var\(--aile-dokunma-hedefi\)/);
    const fixedPx = (css.match(/\b\d+px\b/g) ?? []).filter(value => value !== '1px');
    expect(fixedPx).toEqual([]);
  });
});
