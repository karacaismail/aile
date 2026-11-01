import { useState } from 'react';
import { expect, it } from 'vitest';
import { render, screen, userEvent, waitFor, within } from '@/test-utils/render';
import { DEFAULT_FILTERS, type PurchaseFilters } from '@/data/selectors';
import { PurchaseFilterSections } from './PurchaseFilterSections';
import { FilterSheet } from '@/components/filter/FilterSheet';
import { CategoryFilterTree } from './CategoryFilterTree';
import type { Item } from '@shared/schema';

const items: Item[] = [
  { id: 'light', tip: 'satinalma', ad: 'Salon lambası', kategori: 'aydinlatma_led', oda: 'salon' },
  { id: 'wire', tip: 'satinalma', ad: 'Kablo', kategori: 'elektrik_kablolama', oda: 'salon' },
  { id: 'coffee', tip: 'satinalma', ad: 'Espresso makinesi', kategori: 'mutfak_kahve', oda: 'mutfak' },
  { id: 'bath', tip: 'satinalma', ad: 'Banyo fırçası', kategori: 'banyo_wc', oda: 'banyo' },
  { id: 'dog', tip: 'satinalma', ad: 'Köpek yatağı', kategori: 'kopek', oda: 'salon' },
  { id: 'unset', tip: 'satinalma', ad: 'Eksik kategori' },
];
function Harness() {
  const [filters, setFilters] = useState<PurchaseFilters>({ ...DEFAULT_FILTERS });
  return <><PurchaseFilterSections items={items} filters={filters} onChange={setFilters} /><output data-testid="selection">{filters.kategori.join(',')}</output></>;
}

it('selects a parent as leaf values, exposes its children and supports a mixed parent without touching other facets', async () => {
  render(<Harness />);
  const categories = screen.getByRole('group', { name: /^Kategori/ });
  const parent = within(categories).getByRole('checkbox', { name: 'Elektrik ve aydınlatma 2' });
  await userEvent.click(parent);
  expect(parent).toBeChecked();
  expect(screen.getByTestId('selection')).toHaveTextContent('aydinlatma_led,aydinlatma_akilli,elektrik_kablolama,elektrik_kontrol,elektrik');
  expect(screen.getByTestId('selection').textContent).not.toContain('group:');
  await userEvent.click(await within(categories).findByRole('checkbox', { name: 'Kablo ve tesisat 1' }));
  expect(parent).toBePartiallyChecked();
  expect(screen.getByTestId('selection').textContent).not.toContain('elektrik_kablolama');
  await userEvent.click(within(categories).getByRole('button', { name: 'Temizle: Kategori' }));
  expect(parent).not.toBeChecked();
  expect(screen.getByTestId('selection')).toBeEmptyDOMElement();
});

it('shows nested kitchen groups, keeps unknown categories reachable and narrows counts by room', async () => {
  render(<Harness />);
  const categories = screen.getByRole('group', { name: /^Kategori/ });
  await userEvent.click(within(categories).getByRole('checkbox', { name: 'Mutfak 1' }));
  await userEvent.click(await within(categories).findByRole('button', { name: 'Küçük ev aletleri alt kategorileri' }));
  expect(await within(categories).findByRole('checkbox', { name: 'Kahve ve espresso ekipmanı 1' })).toBeVisible();
  expect(within(categories).getByRole('checkbox', { name: 'Belirsiz 1' })).toBeVisible();
  await userEvent.click(within(categories).getByRole('button', { name: 'Temizle: Kategori' }));
  await userEvent.click(within(screen.getByRole('group', { name: /^Oda/ })).getByRole('checkbox', { name: 'Salon 3' }));
  expect(within(categories).getByRole('checkbox', { name: 'Mutfak 0' })).toBeDisabled();
  expect(within(categories).getByRole('checkbox', { name: 'Elektrik ve aydınlatma 2' })).toBeVisible();
});

const electrical: NonNullable<Item['kategori']>[] = ['aydinlatma_led', 'aydinlatma_akilli', 'elektrik_kablolama', 'elektrik_kontrol', 'elektrik'];
const populatedElectrical: Item[] = electrical.map((kategori, index) => ({
  id: `electrical-${index}`, tip: 'satinalma', ad: `Örnek ürün ${index}`, kategori, oda: 'salon', faz: '2', durum: 'karar',
}));

it('narrows parent to lighting to LED explicitly, then still adds a sibling checkbox without resetting other facets', async () => {
  const initial: PurchaseFilters = { ...DEFAULT_FILTERS, q: 'Örnek', faz: '2', oda: ['salon'], durum: ['karar'], mevcutDahil: true };
  function RefinementHarness() {
    const [filters, setFilters] = useState(initial);
    return <><PurchaseFilterSections items={populatedElectrical} filters={filters} onChange={setFilters} /><output data-testid="filters">{JSON.stringify(filters)}</output></>;
  }
  render(<RefinementHarness />);
  const categories = screen.getByRole('group', { name: /^Kategori/ });
  const read = () => JSON.parse(screen.getByTestId('filters').textContent!);
  expect(within(categories).queryByRole('button', { name: /^Yalnız bunu göster/ })).not.toBeInTheDocument();
  await userEvent.click(within(categories).getByRole('checkbox', { name: 'Elektrik ve aydınlatma 5' }));
  await userEvent.click(await within(categories).findByRole('button', { name: 'Yalnız bunu göster: Aydınlatma' }));
  expect(within(categories).getByRole('checkbox', { name: 'Aydınlatma 2' })).toHaveFocus();
  expect(read()).toEqual({ ...initial, kategori: electrical.slice(0, 2) });
  expect(within(categories).queryByRole('button', { name: 'Yalnız bunu göster: Aydınlatma' })).not.toBeInTheDocument();
  const ledOnly = await within(categories).findByRole('button', { name: 'Yalnız bunu göster: LED / armatür' });
  for (let step = 0; step < 30 && document.activeElement !== ledOnly; step++) await userEvent.tab();
  expect(ledOnly).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(read()).toEqual({ ...initial, kategori: ['aydinlatma_led'] });
  expect(within(categories).getByRole('checkbox', { name: 'LED / armatür 1' })).toHaveFocus();
  expect(within(categories).queryByRole('button', { name: /^Yalnız bunu göster/ })).not.toBeInTheDocument();
  await userEvent.click(within(categories).getByRole('checkbox', { name: 'Kablo ve tesisat 1' }));
  expect(read()).toEqual({ ...initial, kategori: ['aydinlatma_led', 'elektrik_kablolama'] });
  expect(within(categories).getByRole('checkbox', { name: 'Elektrik ve aydınlatma 5' })).toBePartiallyChecked();
});

it('does not offer narrowing for an empty branch, an unselected branch, or the exact current selection', async () => {
  render(<CategoryFilterTree counts={new Map([['aydinlatma_led', 1], ['elektrik_kablolama', 1]])} value={electrical} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Yalnız bunu göster: Aydınlatma' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Yalnız bunu göster: LED / armatür' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Yalnız bunu göster: Akıllı aydınlatma' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Yalnız bunu göster: Elektrik ve aydınlatma' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Yalnız bunu göster: Kahve ve espresso ekipmanı' })).not.toBeInTheDocument();
});

it('keeps the active drawer focus through filter updates and reads the latest focus key on a new mount', async () => {
  const sheet = (opened: boolean, initialFocusKey: string, count: number) => <FilterSheet opened={opened} side="left" initialFocusKey={initialFocusKey}
    onClose={() => {}} onClear={() => {}} resultCount={count} activeCount={1}>
    <button data-filter-key="first">İlk kategori</button>
    <button data-filter-key="second">İkinci kategori</button>
    <button data-filter-key="third">Üçüncü kategori</button>
  </FilterSheet>;
  const { rerender } = render(sheet(true, 'first', 5));
  await waitFor(() => expect(screen.getByRole('button', { name: 'İlk kategori' })).toHaveFocus());
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'İkinci kategori' })).toHaveFocus();
  rerender(sheet(true, 'third', 2));
  expect(screen.getByRole('dialog').querySelectorAll('[data-autofocus]')).toHaveLength(1);
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Üçüncü kategori' })).toHaveFocus();
  rerender(sheet(false, 'third', 2));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  rerender(sheet(true, 'third', 2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Üçüncü kategori' })).toHaveFocus());
  expect(screen.getByRole('dialog').querySelectorAll('[data-autofocus]')).toHaveLength(1);
});
