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
