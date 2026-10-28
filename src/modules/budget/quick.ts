// Hızlı harcama formunun açık/kapalı durumu: üst çubuk düğmesi, FAB ve kalem satırları her ekrandan açar.
import { useSyncExternalStore } from 'react';

export interface ExpenseTarget { id?: string; kalem?: string }

let current: ExpenseTarget | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function openExpense(target: ExpenseTarget = {}): void { current = { ...target }; emit(); }
export function closeExpense(): void { current = null; emit(); }
export function useExpenseTarget(): ExpenseTarget | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => current);
}
