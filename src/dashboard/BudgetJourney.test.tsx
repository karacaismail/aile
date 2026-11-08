import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';
import { useBudget } from './useBudget';
import { buildBudget } from './data';
import { syntheticSheets } from './fixtures';
import { FinancePeriodProvider, useFinancePeriod } from '../app/family/FinancePeriod';

vi.mock('wouter/use-hash-location', () => ({ useHashLocation: () => ['/pano', vi.fn()] }));
vi.mock('./useBudget', () => ({ useBudget: vi.fn() }));
vi.mock('./Charts', () => ({ default: () => <p>Grafik</p> }));
vi.mock('./Select', () => ({ Select: (props: { label: string; value: string; onChange: (value: string) => void; data: { value: string; label: string }[] }) => <select aria-label={props.label} value={props.value} onChange={event => props.onChange(event.target.value)}>{props.data.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select> }));

function Period() { const [period] = useFinancePeriod(); return <output aria-label="Paylaşılan dönem">{period}</output>; }
const mount = () => render(<MantineProvider><FinancePeriodProvider><Dashboard /><Period /></FinancePeriodProvider></MantineProvider>);
beforeEach(() => {
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; } as unknown as typeof IntersectionObserver;
  vi.mocked(useBudget).mockReturnValue({ data: buildBudget(syntheticSheets()), error: null, loading: false, updatedAt: null, refresh: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('names the month on the result and says plainly when there is no previous month to compare', () => {
  mount();
  const summary = screen.getByRole('region', { name: 'Seçili ay özeti' });
  const hero = within(summary).getByRole('heading', { name: 'Aylık net nakit' }).closest('article')!;
  expect(hero).toHaveTextContent('Kasım 2098');
  expect(hero).toHaveTextContent('İlk ay · önceki ayla karşılaştırma yok');
  expect(summary).not.toHaveTextContent(/göre\s*—/);
  // Said once on the result, not repeated on every component.
  expect(summary.textContent!.split('İlk ay').length - 1).toBe(1);
  fireEvent.change(screen.getByRole('combobox', { name: 'Gösterilen ay' }), { target: { value: '2098-12' } });
  expect(hero).toHaveTextContent('Aralık 2098');
  expect(hero).toHaveTextContent('Kasım 2098 ayına göre -500 ₺');
  // Income is equal in both months: the comparison names the month and says it did not change.
  const income = within(summary).getByRole('heading', { name: 'Gelir' }).closest('article')!;
  expect(income).toHaveTextContent('Kasım 2098 ayına göre değişmedi');
});

it('groups the month components and month-end balances under titled groups after the result', () => {
  mount();
  const summary = screen.getByRole('region', { name: 'Seçili ay özeti' });
  const components = within(summary).getByRole('group', { name: 'Kasım 2098 · gelir, ödemeler ve birikim' });
  for (const label of ['Gelir', 'Ödemeler', 'Birikime ayrılan']) expect(within(components).getByRole('heading', { name: label })).toBeInTheDocument();
  const balances = within(summary).getByRole('group', { name: 'Nakit bakiyesi' });
  expect(balances).toHaveTextContent('Seçili ay sonunda nakit');
  const hero = within(summary).getByRole('heading', { name: 'Aylık net nakit' });
  expect(hero.compareDocumentPosition(components) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('carries the selected month into the payment calendar link without inventing a record match', () => {
  mount();
  fireEvent.change(screen.getByRole('combobox', { name: 'Gösterilen ay' }), { target: { value: '2098-12' } });
  const next = screen.getByRole('navigation', { name: 'Bütçeden sonraki adım' });
  const link = within(next).getByRole('link', { name: /Aralık 2098 ödeme adımları/ });
  expect(link).toHaveAttribute('href', '#/timeline');
  fireEvent.click(link);
  expect(screen.getByRole('status', { name: 'Paylaşılan dönem' })).toHaveTextContent('2098-12');
  expect(within(next).getByRole('link', { name: /Alım planını incele/ })).toHaveAttribute('href', '#/ev');
});

it('opens on the shared month and writes a chosen month back, so global navigation keeps it', () => {
  function Preset({ value }: { value: string }) { const [, set] = useFinancePeriod(); useEffect(() => set(value), [set, value]); return null; }
  const first = render(<MantineProvider><FinancePeriodProvider><Preset value="2098-12" /><Dashboard /><Period /></FinancePeriodProvider></MantineProvider>);
  expect(screen.getByRole('combobox', { name: 'Gösterilen ay' })).toHaveValue('2098-12');
  fireEvent.change(screen.getByRole('combobox', { name: 'Gösterilen ay' }), { target: { value: '2099-01' } });
  expect(screen.getByRole('status', { name: 'Paylaşılan dönem' })).toHaveTextContent('2099-01');
  first.unmount();
});

it('names a shared period the budget cannot show and does not overwrite it unless the user chooses a month', () => {
  function Preset({ value }: { value: string }) { const [, set] = useFinancePeriod(); useEffect(() => set(value), [set, value]); return null; }
  for (const [value, text] of [['all', 'Tüm dönem bu sayfada aylık özet olarak gösterilmez; Kasım 2098 gösteriliyor.'], ['2099-05', 'Mayıs 2099 bu hesapta yok; Kasım 2098 gösteriliyor.']]) {
    const view = render(<MantineProvider><FinancePeriodProvider><Preset value={value} /><Dashboard /><Period /></FinancePeriodProvider></MantineProvider>);
    expect(screen.getByRole('combobox', { name: 'Gösterilen ay' })).toHaveValue('2098-11');
    expect(screen.getByRole('note', { name: 'Seçilen dönem' })).toHaveTextContent(text);
    expect(screen.getByRole('status', { name: 'Paylaşılan dönem' })).toHaveTextContent(value);
    view.unmount();
  }
});

it('explains an invalid calculation without suggesting a sharing change', () => {
  vi.mocked(useBudget).mockReturnValue({ data: null, error: 'Plan veya Güncel kaynağı değişti.', errorKind: 'stale', loading: false, updatedAt: null, refresh: vi.fn() });
  mount();
  expect(screen.getByRole('alert')).toHaveTextContent('E-tablodaki finans hesabı yeniden hesaplanmalı');
  expect(screen.getByRole('alert')).not.toHaveTextContent('erişimini kontrol');
  expect(screen.getByRole('alert')).toHaveTextContent('Yenile yalnız sonucu okur');
});
