import { useSyncExternalStore } from 'react';
import { financeStore } from './financeStore';

export function useFinance(store = financeStore) {
  return { ...useSyncExternalStore(store.subscribe, store.getSnapshot), refresh: store.refresh };
}
