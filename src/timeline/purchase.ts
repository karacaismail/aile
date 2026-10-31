import type { FinanceEvent } from '../finance/data';

export type PurchaseDetails = { amount: number; method: string; instalments?: number };
export const isPurchase = (event: FinanceEvent) => event.type === 'Alışveriş' || event.type.startsWith('Alışveriş · ');
const zero = (value: number) => Math.abs(value) < .000001;

/**
 * The native engine records one purchase per event and adds its full price to
 * committed principal. Compare adjacent *unfiltered* verified ledger states,
 * excluding accrued charges and all-account future instalments. Source payment
 * labels must agree with that movement; ambiguity is shown as missing, not zero.
 * This presents the existing plan; it does not recompute financing or fetch data.
 */
export function purchaseDetails(event: FinanceEvent, previous?: FinanceEvent): PurchaseDetails | null {
  if (!isPurchase(event) || !previous || previous.date > event.date) return null;
  const deniz = event.denizPrincipal - previous.denizPrincipal;
  const isbank = event.isPrincipal - previous.isPrincipal;
  const [method, bank] = event.source.split(' · ');
  if (((method === 'Nakit' && bank === 'Nakit') || event.source === 'priority-preserving cash purchase candidate') && event.cashChange <= 0 && zero(deniz) && zero(isbank)) {
    return { amount: Math.abs(event.cashChange), method: 'Nakit' };
  }
  if (method !== 'Kredi kartı' || !zero(event.cashChange)) return null;
  const amount = bank === 'Denizbank' && zero(isbank) ? deniz : bank === 'İşbank' && zero(deniz) ? isbank : 0;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const terms = event.source.match(/(?:^|\. )Taksit: ([1-9]\d*)$/);
  const instalments = terms ? Number(terms[1]) : undefined;
  return { amount: Math.round(amount * 100) / 100, method: `${bank} kredi kartı`, ...(Number.isSafeInteger(instalments) ? { instalments } : {}) };
}
