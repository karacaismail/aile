import { get, set, del } from 'idb-keyval';
import type { BudgetPlan, CashEntry, Item, Setting } from '@shared/schema';
import type { QueuedOp } from './queue';

export interface CachedData { items: Item[]; settings: Setting[]; cash?: CashEntry[]; plan?: BudgetPlan; fingerprint?: string; savedAt: string; schemaVersion: number }

const DATA_KEY = 'aile:data:v1';
const OUTBOX_KEY = 'aile:outbox:v1';

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export const loadCache = () => safe<CachedData | undefined>(() => get<CachedData>(DATA_KEY), undefined);
export const saveCache = (d: CachedData) => safe(() => set(DATA_KEY, d), undefined);
/** Veri kopyasını siler; kuyruk anahtarına dokunmaz. Silme gerçekten oldu mu diye `true/false` döner (IndexedDB reddi yutulmaz, fırlatılmaz). */
export const clearCache = () => safe(async () => { await del(DATA_KEY); return true; }, false);
export const loadOutbox = () => safe<QueuedOp[]>(async () => (await get<QueuedOp[]>(OUTBOX_KEY)) ?? [], []);
export const saveOutbox = (ops: QueuedOp[]) => safe(() => set(OUTBOX_KEY, ops), undefined);
