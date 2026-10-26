// Yerleşim modülü saf kuralları: oda ölçüsü ayarı, duvar uzunluğu/kalan, ihtiyaç haritası, satınalma önerisi, form → patch.
import type { Item, Oda } from '@shared/schema';
import { DUVAR, KOPEK_ERISIM, ODA, label } from '@shared/schema';

export type Wall = (typeof DUVAR)[number];
export type WallKey = Wall | 'orta';
export type KopekErisim = (typeof KOPEK_ERISIM)[number];

export const WALL_KEYS: readonly WallKey[] = [...DUVAR, 'orta'];
/** Yerleşim odaları: 'genel' hariç. */
export const ROOMS: readonly Oda[] = ODA.filter((o) => o !== 'genel');

export interface RoomDims {
  en_cm?: number;
  boy_cm?: number;
  yuk_cm?: number;
  kopek_erisim?: KopekErisim;
}

const NUM_KEYS = ['en_cm', 'boy_cm', 'yuk_cm'] as const;

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : undefined; }
  return undefined;
}

/** `tip='oda'` ayarının `deger` alanı (JSON). Boş/bozuk değerde boş nesne. */
export function parseRoomSetting(deger: string | undefined | null): RoomDims {
  if (!deger) return {};
  let raw: unknown;
  try { raw = JSON.parse(deger); } catch { return {}; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: RoomDims = {};
  for (const k of NUM_KEYS) { const n = toNum(r[k]); if (n !== undefined) out[k] = n; }
  if (typeof r.kopek_erisim === 'string' && (KOPEK_ERISIM as readonly string[]).includes(r.kopek_erisim)) out.kopek_erisim = r.kopek_erisim as KopekErisim;
  return out;
}

export function serializeRoomSetting(dims: RoomDims): string {
  const out: Record<string, unknown> = {};
  for (const k of NUM_KEYS) { const n = toNum(dims[k]); if (n !== undefined) out[k] = n; }
  if (dims.kopek_erisim) out.kopek_erisim = dims.kopek_erisim;
  return JSON.stringify(out);
}

export function wallOf(item: Pick<Item, 'duvar'>): WallKey {
  return item.duvar && (DUVAR as readonly string[]).includes(item.duvar) ? item.duvar : 'orta';
}

export function wallLabel(wall: WallKey): string {
  return wall === 'orta' ? 'Orta' : label('duvar', wall);
}

/** K/G duvarları odanın enini, D/B duvarları boyunu kullanır. Orta için uzunluk yok. */
export function wallLength(room: RoomDims, wall: WallKey): number | undefined {
  if (wall === 'K' || wall === 'G') return room.en_cm;
  if (wall === 'D' || wall === 'B') return room.boy_cm;
  return undefined;
}

/** Odanın yerleşim kalemleri (silinmemiş, tip='yerlesim', oda eşleşen). */
export function roomItems(items: readonly Item[], oda: string): Item[] {
  return items.filter((i) => !i.deleted_at && i.tip === 'yerlesim' && i.oda === oda);
}

export function wallItems(items: readonly Item[], wall: WallKey): Item[] {
  return items.filter((i) => wallOf(i) === wall);
}

function usedLength(items: readonly Item[], wall: WallKey): number {
  return wallItems(items, wall).reduce((sum, i) => sum + (toNum(i.en_cm) ?? 0), 0);
}

/** Duvar uzunluğu − kalemlerin en toplamı. Ölçü yoksa tanımsız; negatifse taşma. */
export function remaining(room: RoomDims, wall: WallKey, items: readonly Item[]): number | undefined {
  const len = wallLength(room, wall);
  if (len === undefined) return undefined;
  return len - usedLength(items, wall);
}

export interface WallSummary { wall: Wall; length: number | undefined; used: number; remaining: number | undefined }

export function wallSummary(room: RoomDims, items: readonly Item[]): WallSummary[] {
  return DUVAR.map((wall) => {
    const length = wallLength(room, wall);
    const used = usedLength(items, wall);
    return { wall, length, used, remaining: length === undefined ? undefined : length - used };
  });
}

export interface WallNeeds { priz: number; isik: string[]; kanal_m: number }
export type NeedsMap = Record<WallKey, WallNeeds>;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Duvar başına toplam priz, ışık notları ve kanal metresi. */
export function needsMap(items: readonly Item[]): NeedsMap {
  const map = Object.fromEntries(WALL_KEYS.map((w) => [w, { priz: 0, isik: [] as string[], kanal_m: 0 }])) as unknown as NeedsMap;
  for (const i of items) {
    const w = map[wallOf(i)];
    w.priz += Math.max(0, toNum(i.priz_ihtiyaci) ?? 0);
    const isik = (i.isik_ihtiyaci ?? '').trim();
    if (isik) w.isik.push(isik);
    w.kanal_m += Math.max(0, toNum(i.kanal_m) ?? 0);
  }
  for (const w of WALL_KEYS) map[w].kanal_m = round1(map[w].kanal_m);
  return map;
}

export function needsTotal(map: NeedsMap): WallNeeds {
  const t: WallNeeds = { priz: 0, isik: [], kanal_m: 0 };
  for (const w of WALL_KEYS) { t.priz += map[w].priz; t.isik.push(...map[w].isik); t.kanal_m += map[w].kanal_m; }
  t.kanal_m = round1(t.kanal_m);
  return t;
}

/** "220×90×85 cm"; eksik ölçüler atlanır; hiçbiri yoksa boş. */
export function formatDims(d: { en_cm?: number; boy_cm?: number; yuk_cm?: number }, sep = '×'): string {
  const parts = [d.en_cm, d.boy_cm, d.yuk_cm].filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return parts.length ? `${parts.join(sep)} cm` : '';
}

export const fmtM = (n: number) => String(round1(n)).replace('.', ',');

// ---- satınalma önerisi ----
export type SuggestionKind = 'priz' | 'kanal';
export interface SuggestionPatch { id?: string; patch: Record<string, unknown> }

export function suggestionKod(oda: string, kind: SuggestionKind): string { return `yerlesim:${kind}:${oda}`; }
export function suggestionName(oda: string, kind: SuggestionKind): string {
  return `${kind === 'priz' ? 'Panjurlu priz' : 'Kablo kanalı'} — ${label('oda', oda)}`;
}

const norm = (s: string | undefined) => (s ?? '').trim().toLocaleLowerCase('tr');

function findExisting(kind: SuggestionKind, oda: string, roomIds: Set<string>, purchases: readonly Item[], taken: Set<string>): Item | undefined {
  const kod = suggestionKod(oda, kind);
  const ad = norm(suggestionName(oda, kind));
  const pool = purchases.filter((p) => !p.deleted_at && p.tip === 'satinalma' && !taken.has(p.id));
  return pool.find((p) => p.kod === kod)
    ?? pool.find((p) => norm(p.ad) === ad)
    ?? pool.find((p) => (p.bagli_idler ?? []).some((id) => roomIds.has(id)) && (kind === 'kanal' ? p.birim === 'm' : p.birim !== 'm'));
}

function diffPatch(desired: Record<string, unknown>, prev: Item): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const p = prev as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(desired)) {
    const b = p[k];
    const eq = Array.isArray(v) ? JSON.stringify(v) === JSON.stringify(b ?? null) : (v ?? null) === (b ?? null);
    if (!eq) out[k] = v;
  }
  return out;
}

/**
 * Odanın toplam priz ihtiyacı için 1 "Panjurlu priz — <Oda>" (adet=N) ve toplam kanal metresi için 1 "Kablo kanalı — <Oda>" (adet=metre, birim m)
 * satınalma satırı üretir. Var olan satır (kod → ad → bağlı kalem eşleşmesi) güncellenir, çoğaltılmaz; değişiklik yoksa patch üretilmez (idempotent).
 * İhtiyaç 0 ise o tür için satır üretilmez.
 */
export function suggestionPatches(oda: Oda | string, items: readonly Item[], existingPurchases: readonly Item[]): SuggestionPatch[] {
  const list = roomItems(items, oda);
  const roomIds = new Set(list.map((i) => i.id));
  const map = needsMap(list);
  const total = needsTotal(map);
  const out: SuggestionPatch[] = [];
  const taken = new Set<string>();

  const build = (kind: SuggestionKind, adet: number, birim: 'adet' | 'm', linked: string[], parts: string[]) => {
    if (adet <= 0) return;
    const kod = suggestionKod(oda, kind);
    const not = `Yerleşim ihtiyaç haritası · ${parts.join(' · ')}`;
    const desired: Record<string, unknown> = { kod, adet, birim, bagli_idler: linked.length ? linked : null, not };
    const prev = findExisting(kind, oda, roomIds, existingPurchases, taken);
    if (prev) {
      taken.add(prev.id);
      const patch = diffPatch(desired, prev);
      if (Object.keys(patch).length) out.push({ id: prev.id, patch });
      return;
    }
    out.push({ patch: { tip: 'satinalma', ad: suggestionName(oda, kind), oda, kategori: 'elektrik', faz: '1', durum: 'fikir', oncelik: 2, ...desired } });
  };

  const prizLinked = list.filter((i) => (toNum(i.priz_ihtiyaci) ?? 0) > 0).map((i) => i.id).sort();
  const prizParts = WALL_KEYS.filter((w) => map[w].priz > 0).map((w) => `${wallLabel(w)} ${map[w].priz}`);
  build('priz', total.priz, 'adet', prizLinked, prizParts);

  const kanalLinked = list.filter((i) => (toNum(i.kanal_m) ?? 0) > 0).map((i) => i.id).sort();
  const kanalParts = WALL_KEYS.filter((w) => map[w].kanal_m > 0).map((w) => `${wallLabel(w)} ${fmtM(map[w].kanal_m)} m`);
  build('kanal', total.kanal_m, 'm', kanalLinked, kanalParts);

  return out;
}

// ---- kalem formu → patch ----
export interface LayoutFormValues {
  ad: string;
  duvar: WallKey;
  en_cm: number | null;
  boy_cm: number | null;
  yuk_cm: number | null;
  mevcut: boolean;
  priz_ihtiyaci: number | null;
  isik_ihtiyaci: string;
  kanal_m: number | null;
  bagli_idler: string[];
  not: string;
}

export function toFormValues(i?: Item): LayoutFormValues {
  return {
    ad: i?.ad ?? '', duvar: i ? wallOf(i) : 'orta', en_cm: i?.en_cm ?? null, boy_cm: i?.boy_cm ?? null, yuk_cm: i?.yuk_cm ?? null, mevcut: !!i?.mevcut,
    priz_ihtiyaci: i?.priz_ihtiyaci ?? null, isik_ihtiyaci: i?.isik_ihtiyaci ?? '', kanal_m: i?.kanal_m ?? null, bagli_idler: i?.bagli_idler ?? [], not: i?.not ?? '',
  };
}

/** Form → patch: boş alanlar null ile temizlenir; var olan kalemde yalnız değişen alanlar (tip hep kalır). */
export function toItemPatch(v: LayoutFormValues, oda: Oda | string, prev?: Item): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    tip: 'yerlesim', oda, ad: v.ad.trim(), duvar: v.duvar === 'orta' ? null : v.duvar,
    en_cm: v.en_cm, boy_cm: v.boy_cm, yuk_cm: v.yuk_cm, mevcut: v.mevcut,
    priz_ihtiyaci: v.priz_ihtiyaci, isik_ihtiyaci: v.isik_ihtiyaci.trim() || null, kanal_m: v.kanal_m,
    bagli_idler: v.bagli_idler.length ? v.bagli_idler : null, not: v.not.trim() || null,
  };
  if (prev) {
    const p = prev as unknown as Record<string, unknown>;
    for (const k of Object.keys(patch)) {
      if (k === 'tip') continue;
      const a = patch[k]; const b = p[k];
      const eq = Array.isArray(a) ? JSON.stringify(a) === JSON.stringify(b ?? null) : (a ?? null) === (b ?? null) || (a === false && b === undefined);
      if (eq) delete patch[k];
    }
  }
  return patch;
}
