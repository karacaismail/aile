import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, expect, it } from 'vitest';
import VehiclePage from './VehiclePage';
import { buildCurrentBudget } from '../dashboard/current';
import { syntheticCurrentSheets } from '../dashboard/currentFixtures';

afterEach(cleanup);

it('does not present debt or reserve financed positive cash as capacity for a vehicle payment', () => {
  const budget = buildCurrentBudget(syntheticCurrentSheets());
  budget.months[0].selfFundedCashFlow = { plan: -200, current: -200 };
  render(<MantineProvider><VehiclePage budget={budget} /></MantineProvider>);
  fireEvent.click(screen.getByRole('tab', { name: 'Bütçe etkisi' }));
  const table = screen.getByRole('table', { name: 'Aylık bütçe etkisi' });
  const first = within(table).getAllByRole('row')[1];
  expect(within(first).getAllByRole('cell')[1]).toHaveTextContent('-200 ₺');
  expect(within(first).getAllByRole('cell')[3]).toHaveTextContent('-200 ₺');
});

it('keeps unavailable capacity unknown instead of falling back to old monthly cash', () => {
  const budget = buildCurrentBudget(syntheticCurrentSheets());
  render(<MantineProvider><VehiclePage budget={budget} /></MantineProvider>);
  fireEvent.click(screen.getByRole('tab', { name: 'Bütçe etkisi' }));
  const table = screen.getByRole('table', { name: 'Aylık bütçe etkisi' });
  const first = within(table).getAllByRole('row')[1];
  expect(within(first).getAllByRole('cell')[1]).toHaveTextContent('Tutar yok');
  expect(within(first).getAllByRole('cell')[3]).toHaveTextContent('Tutar yok');
});

it('separates monthly burden, purchase funding and approval conditions in the simulation summary', () => {
  render(<MantineProvider><VehiclePage budget={null} /></MantineProvider>);
  const summary = screen.getByTestId('finance-result');
  expect(within(summary).getByRole('group', { name: 'Ödeme yükü' })).toHaveTextContent('En yüksek taksit');
  expect(within(summary).getByRole('group', { name: 'Finansmanın dağılımı' })).toHaveTextContent('Taşıt kredisi');
  expect(within(summary).getByRole('group', { name: 'Alım günü nakdi' })).toHaveTextContent('Yedekte kalan');
  expect(within(summary).getByRole('heading', { level: 2 })).toHaveTextContent('Koşullu uygun');
});

it('names the photo angles in one word', () => {
  render(<MantineProvider><VehiclePage budget={null} /></MantineProvider>);
  const angles = screen.getByRole('group', { name: 'Fotoğraf açısı' });
  expect(within(angles).getAllByRole('button').map(button => button.textContent)).toEqual(['Ön', 'Arka', 'İç']);
  expect(screen.getByRole('img', { name: 'Toyota Corolla · Ön' })).toBeInTheDocument();
  expect(screen.getByText('2017', { selector: '.vehicle-identity span' })).toBeInTheDocument();
});

// Ekran sonucu söyler; süreç, kanıt ve sorumluluk notu taşımaz.
const PROCESS_NOTES = [/onay(ı)? değil/i, /kişisel onay/i, /her dakika/i, /seçili model yılı/i, /farklı olabilir/i, /doğrulanmadı|doğrulanmış değil/i, /kontrol edildi/i, /teyit gerek/i, /iki dosya/i, /gösterilir;|hesaplanır\./i, /e-tabloya yazılmaz/i];
function pageTexts(container: HTMLElement) {
  return [...container.querySelectorAll('p, small, figcaption, caption, h2, h3, button, [role="tab"], th')].map(node => node.textContent?.trim() ?? '').filter(Boolean);
}

it('keeps every vehicle text short and free of process notes on every tab', () => {
  const budget = buildCurrentBudget(syntheticCurrentSheets());
  const { container } = render(<MantineProvider><VehiclePage budget={budget} /></MantineProvider>);
  const seen = new Set<string>();
  for (const name of ['Ödeme planı', 'Kurallar', 'Teklifler', 'Bütçe etkisi', 'Araç listesi']) {
    fireEvent.click(screen.getByRole('tab', { name }));
    for (const text of pageTexts(container)) seen.add(text);
  }
  const texts = [...seen];
  expect(texts.filter(text => PROCESS_NOTES.some(note => note.test(text)))).toEqual([]);
  expect(texts.filter(text => text.length > 80)).toEqual([]);
  const helpers = [...container.querySelectorAll('.mantine-InputWrapper-description')].map(node => node.textContent ?? '');
  expect(helpers.length).toBeGreaterThan(5);
  expect(helpers.filter(text => text.length > 40)).toEqual([]);
});

it('does not state unknown lender income rules as fact', () => {
  render(<MantineProvider><VehiclePage budget={null} /></MantineProvider>);
  fireEvent.click(screen.getByRole('tab', { name: 'Kurallar' }));
  expect(screen.getByText('Eşin geliri finansör kabul ederse sayılır.')).toBeInTheDocument();
  expect(screen.queryByText(/Eşin geliri eklenmez/)).not.toBeInTheDocument();
});

it('starts the credit scenario from the Sheet Parametreler values, not from coded defaults', () => {
  const budget = { ...buildCurrentBudget(syntheticCurrentSheets()), vehicleLoan: { downPayment: 350000, loanAmount: 120000, months: 24, annualRate: 0.615, taxRate: 0.3, firstInstalment: '2027-02-15', instalment: 7531.81, cashDownPayment: 230000, autoMonthlyRate: 0.029 } };
  render(<MantineProvider><VehiclePage budget={budget} /></MantineProvider>);
  expect(screen.getByLabelText('İhtiyaç vadesi (ay)')).toHaveValue('24');
  expect(screen.getByLabelText('İhtiyaç faizi (aylık %)')).toHaveValue('4.075');
  expect(screen.getByLabelText('Taşıt faizi (aylık %)')).toHaveValue('2.9');
  expect((screen.getByLabelText('Peşinat') as HTMLInputElement).value.replace(/\D/g, '')).toBe('230000');
  expect(screen.getByText('Bütçedeki araç kredisi: 120.000 ₺, 24 ay, aylık 7.531,81 ₺.')).toBeInTheDocument();
  expect(screen.getByText('İlk taksit 15 Şubat 2027. Değerler Parametreler sayfasından gelir.')).toBeInTheDocument();
});
