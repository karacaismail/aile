import { useState } from 'react';
import { expect, it } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { DEFAULT_FILTERS, type PurchaseFilters } from '@/data/selectors';
import { PurchaseFilterSections } from './PurchaseFilterSections';
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
