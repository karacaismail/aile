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

/** The engine's generic card purchase type; it is not a household Alışveriş category. */
export const isCardCharge = (event: FinanceEvent) => event.type === 'Kart alışverişi';
export type CardCharge = { amount: number; card: string };

/**
 * A generic card purchase leaves cash unchanged and adds its price to exactly one
 * card's committed principal. The amount is that card's principal delta against the
 * immediately preceding *unfiltered* ledger step: never total debt, accrued cost or
 * future instalments. Any other movement pattern is ambiguous and stays unknown;
 * instalment count and payment terms are not stated by this event.
 */
export function cardCharge(event: FinanceEvent, previous?: FinanceEvent): CardCharge | null {
  if (!isCardCharge(event) || !previous || previous.date > event.date || !zero(event.cashChange) || !zero(event.kmhPrincipal - previous.kmhPrincipal)) return null;
  const moved = ([['Denizbank kredi kartı', event.denizPrincipal - previous.denizPrincipal], ['İşbank kredi kartı', event.isPrincipal - previous.isPrincipal]] as const).filter(([, delta]) => !zero(delta));
  if (moved.length !== 1 || !(moved[0][1] > 0) || !Number.isFinite(moved[0][1])) return null;
  return { amount: Math.round(moved[0][1] * 100) / 100, card: moved[0][0] };
}

/** Balance change against the preceding unfiltered ledger step; null when there is no predecessor. */
export function stepChange(event: FinanceEvent, previous: FinanceEvent | undefined, key: { [K in keyof FinanceEvent]: FinanceEvent[K] extends number ? K : never }[keyof FinanceEvent]) {
  if (!previous || previous.date > event.date) return null;
  return Math.round((event[key] - previous[key]) * 100) / 100;
}
