import { describe, it, expect, vi } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { FilterChip } from './FilterChip';
import { FacetChips } from './FacetChips';
import { SortControl } from './SortControl';
import { FilterSheet } from './FilterSheet';
import { FilterSection } from './FilterSection';

describe('FilterChip', () => {
  it('etiket + sayım; rol onay kutusu; seçili durum data-checked', async () => {
    const onChange = vi.fn();
    render(<FilterChip label="Fiyatsız" count={12} checked={false} onChange={onChange} data-testid="quick-chip-fiyatsiz" />);
    const box = screen.getByRole('checkbox', { name: /Fiyatsız/ });
    expect(box).toHaveAccessibleName('Fiyatsız 12');
    expect(box).not.toBeChecked();
    await userEvent.click(screen.getByText('Fiyatsız'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
  it('sayım yoksa yalnız etiket; devre dışı çip tıklanmaz', async () => {
    const onChange = vi.fn();
    render(<FilterChip label="Salon" checked={false} onChange={onChange} disabled />);
    expect(screen.getByRole('checkbox', { name: 'Salon' })).toBeDisabled();
    await userEvent.click(screen.getByText('Salon'));
    expect(onChange).not.toHaveBeenCalled();
  });
  it('seçiliyken onay (ya da kaldır) ikonu görünür', () => {
    render(<FilterChip label="Mutfak" count={3} checked onChange={vi.fn()} icon="x" />);
    expect(screen.getByRole('checkbox', { name: 'Mutfak 3' })).toBeChecked();
    expect(screen.getByTestId('chip-icon-x')).toBeInTheDocument();
  });
});

describe('FacetChips', () => {
  const options = new Map([['salon', 4], ['mutfak', 2], ['', 1]]);
  it('seçenekler şema etiketiyle; boş değer "Belirsiz"; seçili ama sayımsız değer "· 0" ile kalır', () => {
    render(<FacetChips field="oda" options={options} value={['cocuk']} onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Salon 4' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Belirsiz 1' })).toBeInTheDocument();
    const stranded = screen.getByRole('checkbox', { name: 'Çocuk odası 0' });
    expect(stranded).toBeChecked();
  });
  it('tıklama değeri ekler / kaldırır', async () => {
    const onChange = vi.fn();
    render(<FacetChips field="oda" options={options} value={['salon']} onChange={onChange} />);
    await userEvent.click(screen.getByText('Mutfak'));
    expect(onChange).toHaveBeenLastCalledWith(['salon', 'mutfak']);
    await userEvent.click(screen.getByText('Salon'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('FilterSection', () => {
  it('başlık, seçili sayısı ve Temizle (yalnız seçim varken)', async () => {
    const onClear = vi.fn();
    const { rerender } = render(<FilterSection title="Oda" selectedCount={2} onClear={onClear}><span>içerik</span></FilterSection>);
    expect(screen.getByRole('group', { name: 'Oda' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Temizle/ }));
    expect(onClear).toHaveBeenCalled();
    rerender(<FilterSection title="Oda" selectedCount={0} onClear={onClear}><span>içerik</span></FilterSection>);
    expect(screen.queryByRole('button', { name: /Temizle/ })).toBeNull();
  });
});

describe('SortControl (dar ekran)', () => {
  const options = [
    { value: 'oncelik', label: 'Öncelik' }, { value: 'ad', label: 'Ad (A → Z)' }, { value: 'fiyat', label: 'Fiyat (yüksekten düşüğe)' },
  ];
  it('düğme geçerli sıralamayı adlandırır; sayfa açılır; seçim onChange + kapanış', async () => {
    const onChange = vi.fn();
    render(<SortControl value="oncelik" options={options} onChange={onChange} />);
    const btn = screen.getByTestId('sort-button');
    expect(btn).toHaveAccessibleName('Sırala: Öncelik');
    expect(screen.queryByTestId('sort-indicator')).toBeNull();
    await userEvent.click(btn);
    const sheet = await screen.findByTestId('sort-sheet');
    expect(within(sheet).getAllByRole('radio')).toHaveLength(3);
    await userEvent.click(within(sheet).getByRole('radio', { name: /Ad \(A → Z\)/ }));
    expect(onChange).toHaveBeenCalledWith('ad');
  });
  it('varsayılan dışı sıralamada nokta göstergesi', () => {
    render(<SortControl value="ad" options={options} onChange={vi.fn()} />);
    expect(screen.getByTestId('sort-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('sort-button')).toHaveAccessibleName('Sırala: Ad (A → Z)');
  });
});

describe('FilterSheet', () => {
  it('altta canlı sayım düğmesi; Temizle sayımı; 0 sonuçta "Kalem yok"; göster kapatır', async () => {
    const onClose = vi.fn(); const onClear = vi.fn();
    const { rerender } = render(
      <FilterSheet opened onClose={onClose} resultCount={34} activeCount={2} onClear={onClear}><div>bölümler</div></FilterSheet>,
    );
    expect(screen.getByTestId('filter-drawer')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Filtrele' })).toBeInTheDocument();
    expect(screen.getByTestId('filter-apply')).toHaveTextContent('34 kalemi göster');
    expect(screen.getByTestId('filter-clear')).toHaveTextContent('Temizle (2)');
    await userEvent.click(screen.getByTestId('filter-clear'));
    expect(onClear).toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('filter-apply'));
    expect(onClose).toHaveBeenCalled();
    rerender(<FilterSheet opened onClose={onClose} resultCount={0} activeCount={0} onClear={onClear}><div>bölümler</div></FilterSheet>);
    expect(screen.getByTestId('filter-apply')).toHaveTextContent('Kapat · 0 kalem');
    expect(screen.getByTestId('filter-clear')).toBeDisabled();
  });
});
