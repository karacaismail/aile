// Modül seçicileri: tip bazlı listeler ve oda ayarı. Seçiciler modül düzeyinde sabit (useAppStore önbelleği için).
import { useMemo } from 'react';
import type { Item, Oda, Setting } from '@shared/schema';
import { ODA } from '@shared/schema';
import { useAppStore, selectByTip, selectSetting, type AppState } from '@/sync/store';
import { parseRoomSetting, type RoomSetting } from './rules';

export const ROOMS: readonly Oda[] = ODA.filter((o) => o !== 'genel');
export const isRoom = (v: string): v is Oda => (ROOMS as readonly string[]).includes(v);

export const selectLayers = selectByTip('aydinlatma');
export const selectScenes = selectByTip('sahne');
export const selectPurchases = selectByTip('satinalma');
export const selectHydration = (s: AppState): { hydrated: boolean; status: AppState['status'] } => ({ hydrated: s.hydrated, status: s.status });
export const selectRoomSettings = (s: AppState): Setting[] => s.settings.filter((x) => !x.deleted_at && x.tip === 'oda');

export function useRoomSetting(oda: string): RoomSetting {
  const sel = useMemo(() => selectSetting('oda', oda), [oda]);
  const setting = useAppStore(sel);
  return useMemo(() => parseRoomSetting(setting), [setting]);
}

export function byId(items: readonly Item[]): Map<string, Item> {
  return new Map(items.map((i) => [i.id, i]));
}
