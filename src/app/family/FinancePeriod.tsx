import { createContext, useContext, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';

type PeriodState = [string, Dispatch<SetStateAction<string>>];
const FinancePeriod = createContext<PeriodState | null>(null);

/** Navigation context only; each view still validates the period against its own ledger. */
export function FinancePeriodProvider({ children }: { children: ReactNode }) {
  const state = useState('');
  return <FinancePeriod value={state}>{children}</FinancePeriod>;
}

export function useFinancePeriod(initial = ''): PeriodState {
  const shared = useContext(FinancePeriod);
  const local = useState(initial);
  return shared ?? local;
}

const monthName = (value: string) => new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`));
/**
 * Text for a shared period this page cannot show, naming the period actually shown. The Timeline
 * sentinel `all` is named, never formatted as a date; an unknown value yields no claim.
 */
export function periodFallback(requested: string, shownLabel: string) {
  if (requested === 'all') return `Tüm dönem bu sayfada aylık özet olarak gösterilmez; ${shownLabel} gösteriliyor.`;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(requested)) return null;
  return `${monthName(requested)} bu hesapta yok; ${shownLabel} gösteriliyor.`;
}
