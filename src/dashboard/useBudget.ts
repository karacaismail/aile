import { useSyncExternalStore } from 'react';
import { budgetStore } from './budgetStore';

const noop = () => {};
const inactive = () => noop;

export function useBudget(enabled = true) {
  const state = useSyncExternalStore(enabled ? budgetStore.subscribe : inactive, budgetStore.getSnapshot);
  return { ...state, refresh: enabled ? budgetStore.refresh : noop };
}
