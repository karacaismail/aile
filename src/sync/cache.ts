import { get, set, del } from 'idb-keyval';
import type { Item, Setting } from '@shared/schema';
import type { QueuedOp } from './queue';

export interface CachedData { items: Item[]; settings: Setting[]; fingerprint?: string; savedAt: string; schemaVersion: number }

const DATA_KEY = 'aile:data:v1';
const OUTBOX_KEY = 'aile:outbox:v1';

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export const loadCache = () => safe<CachedData | undefined>(() => get<CachedData>(DATA_KEY), undefined);
export const saveCache = (d: CachedData) => safe(() => set(DATA_KEY, d), undefined);
export const clearCache = () => safe(() => del(DATA_KEY), undefined);
export const loadOutbox = () => safe<QueuedOp[]>(async () => (await get<QueuedOp[]>(OUTBOX_KEY)) ?? [], []);
export const saveOutbox = (ops: QueuedOp[]) => safe(() => set(OUTBOX_KEY, ops), undefined);
