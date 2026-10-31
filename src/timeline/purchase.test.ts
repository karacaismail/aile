import { describe, expect, it } from 'vitest';
import { buildFinance, type FinanceEvent } from '../finance/data';
import { syntheticFinance } from '../finance/fixtures';
import { purchaseDetails } from './purchase';

const previous = buildFinance(syntheticFinance()).events[1];
const event = (changes: Partial<FinanceEvent> = {}): FinanceEvent => ({ ...previous, date: '2098-02-04', id: 'synthetic-purchase', title: 'Örnek mobilya', type: 'Alışveriş · Taşınma öncesi', cashChange: 0, denizPrincipal: previous.denizPrincipal + 8640.25, cardDebt: previous.cardDebt + 8640.25, source: 'Kredi kartı · Denizbank · Planlanan alım. Taksit: 6', ...changes });
describe('purchase facts from the validated adjacent ledger states', () => {
  it('shows the single purchase principal, not cash impact, total debt, charges or future instalments', () => {
    expect(purchaseDetails(event({ denizCost: 45.88, futureInstalments: 9000 }), previous)).toEqual({ amount: 8640.25, method: 'Denizbank kredi kartı', instalments: 6 });
  });
  it('identifies the other bank and cash purchases without confusing payment with card repayment', () => {
    expect(purchaseDetails(event({ denizPrincipal: previous.denizPrincipal, isPrincipal: previous.isPrincipal + 250.1, source: 'Kredi kartı · İşbank · Plan. Taksit: 1' }), previous)).toEqual({ amount: 250.1, method: 'İşbank kredi kartı', instalments: 1 });
    expect(purchaseDetails(event({ denizPrincipal: previous.denizPrincipal, cashChange: -320.4, source: 'Nakit · Nakit · Plan.' }), previous)).toEqual({ amount: 320.4, method: 'Nakit' });
  });
  it('supports explicitly cash zero-priced items without turning a credit purchase into free merchandise', () => {
    expect(purchaseDetails(event({ denizPrincipal: previous.denizPrincipal, source: 'Nakit · Nakit · Plan.' }), previous)?.amount).toBe(0);
    expect(purchaseDetails(event({ denizPrincipal: previous.denizPrincipal }), previous)).toBeNull();
  });
  it.each([
    { source: 'Bilinmeyen ödeme yöntemi' },
    { source: 'Kredi kartı · İşbank · Plan. Taksit: 6' },
    { isPrincipal: previous.isPrincipal + 80 },
    { cashChange: -10 },
    { denizPrincipal: previous.denizPrincipal - 30 },
    { type: 'Kart ödemesi' },
  ])('does not invent facts for an ambiguous or non-purchase event: %j', changes => {
    expect(purchaseDetails(event(changes), previous)).toBeNull();
  });
  it('requires the immediately preceding full-ledger event, with no previous event fallback', () => {
    expect(purchaseDetails(event(), undefined)).toBeNull();
    expect(purchaseDetails(event(), { ...previous, date: '2098-03-01' })).toBeNull();
  });
  it('does not invent an instalment count if its explicit source field is absent', () => {
    expect(purchaseDetails(event({ source: 'Kredi kartı · Denizbank · Plan.' }), previous)).toEqual({ amount: 8640.25, method: 'Denizbank kredi kartı' });
  });
});

it('uses the native cash candidate source for scheduled priority purchases', () => {
  expect(purchaseDetails(event({ denizPrincipal: previous.denizPrincipal, cashChange: -620.5, source: 'priority-preserving cash purchase candidate' }), previous)).toEqual({ amount: 620.5, method: 'Nakit' });
});
