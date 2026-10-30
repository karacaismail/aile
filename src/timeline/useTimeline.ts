import { useSyncExternalStore } from 'react';
import { timelineStore, type createTimelineStore } from './timelineStore';

export function useTimeline(store: ReturnType<typeof createTimelineStore> = timelineStore) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...state, refresh: store.refresh };
}
