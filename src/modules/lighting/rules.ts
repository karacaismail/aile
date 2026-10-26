// Aydınlatma saf kuralları: katman doğrulama, oda özeti, sahne seviyeleri, yol haritası gruplaması. React/sync yok.
import type { Item, Setting } from '@shared/schema';
import { ADIM, KATMAN_TUR, KOPEK_ERISIM, label } from '@shared/schema';
import { daysUntil } from '@/lib/dates';
import { DONE_DURUM } from '@/data/selectors';

export type KatmanTur = (typeof KATMAN_TUR)[number];
export type Adim = (typeof ADIM)[number];
export type KopekErisim = (typeof KOPEK_ERISIM)[number];

export interface RoomSetting { en_cm?: number; boy_cm?: number; yuk_cm?: number; kopek_erisim?: KopekErisim }

/** Doğrulamada kullanılan katman alanları; form değerleri de bu biçime indirgenir. */
export type LayerLike = Partial<Pick<Item,
  'id' | 'ad' | 'oda' | 'katman_tur' | 'katman_ad' | 'cct_min' | 'cct_max' | 'cri_min' | 'acikta' | 'montaj_yukseklik_cm' | 'uzunluk_m' | 'w_per_m' | 'surucu_w'
  | 'lux_min' | 'kontrol_cihaz' | 'tahmini_tl_min' | 'tahmini_tl_max' | 'adim' | 'bagli_idler'>>;

export const DRIVER_MARGIN = 1.25;
export const DOG_MIN_HEIGHT_CM = 90;
export const LONG_STRIP_M = 5;
export const TASK_CRI_MIN = 90;
export const DUE_SOON_DAYS = 7;
export const CORE_LAYERS = ['ana', 'gorev', 'gece'] as const;
export type CoreLayer = (typeof CORE_LAYERS)[number];
export const CCT_RANGE = { min: 2200, max: 6500, step: 100, marks: [2700, 4000, 6500] } as const;

export const MSG = {
  cct: "CCT min, max'tan büyük olamaz",
  gorevCri: `Görev katmanında CRI ≥ ${TASK_CRI_MIN} olmalı`,
  gorevCriMissing: `Görev katmanı için CRI belirtilmedi (≥ ${TASK_CRI_MIN} önerilir)`,
  dog: `Köpek erişebilen odada ${DOG_MIN_HEIGHT_CM} cm altında açıkta şerit/kablo olamaz`,
  driver: (needW: number, surucuW: number) => `Sürücü yetersiz: en az ${needW} W gerekir (%25 pay), sürücü ${surucuW} W`,
  longStrip: `${LONG_STRIP_M} m üzeri şerit: iki uçtan besleme gerekir`,
} as const;

export interface Issue { field: keyof LayerLike; message: string }
export interface Validation { errors: string[]; warnings: string[] }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Oda ayarı (`tip='oda'`, `deger` JSON) → güvenli nesne; bozuk/boş değerde {}. */
export function parseRoomSetting(setting?: Setting | null): RoomSetting {
  if (!setting?.deger) return {};
  try {
    const v = JSON.parse(setting.deger) as unknown;
    if (!v || typeof v !== 'object') return {};
    const r = v as Record<string, unknown>;
    const out: RoomSetting = {};
    for (const k of ['en_cm', 'boy_cm', 'yuk_cm'] as const) if (isNum(r[k])) out[k] = r[k] as number;
    if (typeof r.kopek_erisim === 'string' && (KOPEK_ERISIM as readonly string[]).includes(r.kopek_erisim)) out.kopek_erisim = r.kopek_erisim as KopekErisim;
    return out;
  } catch {
    return {};
  }
}

/** Köpek kuralı, erişim açıkça 'kapali' değilse uygulanır (ayar yoksa güvenli varsayım). */
export function dogRuleApplies(room?: RoomSetting | null): boolean {
  return room?.kopek_erisim !== 'kapali';
}

export interface DriverLoad { loadW: number; needW: number; surucuW: number | null; marginPct: number | null; ok: boolean | null }

/** Şerit yükü ve %25 paylı sürücü gereksinimi; uzunluk ya da W/m yoksa null. */
export function driverLoad(layer: LayerLike): DriverLoad | null {
  if (!isNum(layer.uzunluk_m) || !isNum(layer.w_per_m)) return null;
  const loadW = round2(layer.uzunluk_m * layer.w_per_m);
  const needW = round2(loadW * DRIVER_MARGIN);
  if (!isNum(layer.surucu_w)) return { loadW, needW, surucuW: null, marginPct: null, ok: null };
  const marginPct = loadW > 0 ? Math.round((layer.surucu_w / loadW - 1) * 100) : null;
  return { loadW, needW, surucuW: layer.surucu_w, marginPct, ok: layer.surucu_w >= needW };
}

export function layerIssues(layer: LayerLike, room?: RoomSetting | null): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (isNum(layer.cct_min) && isNum(layer.cct_max) && layer.cct_min > layer.cct_max) errors.push({ field: 'cct_max', message: MSG.cct });
  if (layer.katman_tur === 'gorev') {
    if (!isNum(layer.cri_min)) warnings.push({ field: 'cri_min', message: MSG.gorevCriMissing });
    else if (layer.cri_min < TASK_CRI_MIN) errors.push({ field: 'cri_min', message: MSG.gorevCri });
  }
  if (dogRuleApplies(room) && layer.acikta && isNum(layer.montaj_yukseklik_cm) && layer.montaj_yukseklik_cm < DOG_MIN_HEIGHT_CM) {
    errors.push({ field: 'montaj_yukseklik_cm', message: MSG.dog });
  }
  const d = driverLoad(layer);
  if (d && d.ok === false && d.surucuW != null) errors.push({ field: 'surucu_w', message: MSG.driver(d.needW, d.surucuW) });
  if (isNum(layer.uzunluk_m) && layer.uzunluk_m > LONG_STRIP_M) warnings.push({ field: 'uzunluk_m', message: MSG.longStrip });
  return { errors, warnings };
}

export function validateLayer(layer: LayerLike, room?: RoomSetting | null): Validation {
  const i = layerIssues(layer, room);
  return { errors: i.errors.map((x) => x.message), warnings: i.warnings.map((x) => x.message) };
}

/** Form alanı → ilk hata mesajı. */
export function fieldErrors(layer: LayerLike, room?: RoomSetting | null): Partial<Record<keyof LayerLike, string>> {
  const out: Partial<Record<keyof LayerLike, string>> = {};
  for (const e of layerIssues(layer, room).errors) if (!out[e.field]) out[e.field] = e.message;
  return out;
}

/** "Dolu" spec: katman_tur + lux_min + cct_min + kontrol_cihaz. */
export function isComplete(l: LayerLike): boolean {
  return !!l.katman_tur && isNum(l.lux_min) && isNum(l.cct_min) && !!l.kontrol_cihaz;
}

export function completion(layers: readonly LayerLike[]): { done: number; total: number; pct: number } {
  const total = layers.length;
  const done = layers.filter(isComplete).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function cctRange(layers: readonly LayerLike[]): { min: number; max: number } | null {
  let min = Infinity; let max = -Infinity;
  for (const l of layers) {
    const lo = isNum(l.cct_min) ? l.cct_min : isNum(l.cct_max) ? l.cct_max : null;
    const hi = isNum(l.cct_max) ? l.cct_max : isNum(l.cct_min) ? l.cct_min : null;
    if (lo == null || hi == null) continue;
    min = Math.min(min, lo); max = Math.max(max, hi);
  }
  return Number.isFinite(min) ? { min, max } : null;
}

export function roomBadges(layers: readonly LayerLike[]): { gece: boolean; gorevCri90: boolean; count: number; missing: CoreLayer[] } {
  return {
    gece: layers.some((l) => l.katman_tur === 'gece'),
    gorevCri90: layers.some((l) => l.katman_tur === 'gorev' && isNum(l.cri_min) && l.cri_min >= TASK_CRI_MIN),
    count: layers.length,
    missing: CORE_LAYERS.filter((t) => !layers.some((l) => l.katman_tur === t)),
  };
}

export function estimateRange(layers: readonly LayerLike[]): { min: number; max: number; priced: number; total: number } {
  let min = 0; let max = 0; let priced = 0;
  for (const l of layers) {
    const lo = l.tahmini_tl_min ?? l.tahmini_tl_max;
    const hi = l.tahmini_tl_max ?? l.tahmini_tl_min;
    if (lo == null || hi == null) continue;
    priced++; min += lo; max += hi;
  }
  return { min, max, priced, total: layers.length };
}

export function layerTitle(l: LayerLike): string {
  return l.katman_ad?.trim() || l.ad?.trim() || label('katman_tur', l.katman_tur) || 'Katman';
}

const TUR_ORDER = new Map<string, number>(KATMAN_TUR.map((t, i) => [t, i]));
export function sortLayers<T extends LayerLike>(layers: readonly T[]): T[] {
  const coll = new Intl.Collator('tr');
  return layers.slice().sort((a, b) => (TUR_ORDER.get(a.katman_tur ?? '') ?? 99) - (TUR_ORDER.get(b.katman_tur ?? '') ?? 99) || coll.compare(layerTitle(a), layerTitle(b)));
}

export function layersOfRoom(layers: readonly Item[], oda: string): Item[] {
  return sortLayers(layers.filter((l) => l.oda === oda));
}

// ---- sahne seviyeleri: "katmanId:pct:cct" ----
export interface SceneLevel { layerId: string; pct: number | null; cct: number | null }

export function parseLevel(s: string): SceneLevel | null {
  const [layerId = '', pct = '', cct = ''] = String(s ?? '').split(':');
  if (!layerId.trim()) return null;
  const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  return { layerId: layerId.trim(), pct: num(pct), cct: num(cct) };
}

export function formatLevel(l: SceneLevel): string {
  return `${l.layerId}:${l.pct ?? ''}:${l.cct ?? ''}`;
}

// ---- bağlı satınalma ve yol haritası ----
/** İki yönlü bağ: katmanın bagli_idler listesi ya da kalemin bagli_idler listesi; silinmiş kalemler hariç. */
export function linkedPurchases(layer: LayerLike, purchases: readonly Item[]): Item[] {
  const mine = new Set(layer.bagli_idler ?? []);
  return purchases.filter((p) => !p.deleted_at && p.tip === 'satinalma' && (mine.has(p.id) || (!!layer.id && (p.bagli_idler ?? []).includes(layer.id))));
}

export function isDueSoon(iso: string | undefined, now: Date = new Date(), days = DUE_SOON_DAYS): boolean {
  return !!iso && daysUntil(iso, now) <= days;
}

export interface StepGroup { adim: Adim; layers: Item[] }

export function groupByStep(layers: readonly Item[]): { steps: StepGroup[]; unassigned: Item[] } {
  const steps: StepGroup[] = ADIM.map((adim) => ({ adim, layers: [] }));
  const byAdim = new Map(steps.map((s) => [s.adim, s]));
  const unassigned: Item[] = [];
  for (const l of layers) {
    const g = l.adim ? byAdim.get(l.adim) : undefined;
    if (g) g.layers.push(l); else unassigned.push(l);
  }
  for (const s of steps) s.layers = sortLayers(s.layers);
  return { steps, unassigned };
}

/** Adım tamam = tüm katmanları dolu ve bağlı kalemleri alınmış (katmansız adım tamam sayılır). Aktif = ilk tamamlanmamış adım. */
export function roadmapActive(steps: readonly StepGroup[], purchases: readonly Item[]): number {
  const stepDone = (s: StepGroup) => s.layers.every((l) => isComplete(l) && linkedPurchases(l, purchases).every((p) => !!p.durum && DONE_DURUM.has(p.durum)));
  const idx = steps.findIndex((s) => !stepDone(s));
  return idx < 0 ? steps.length : idx;
}
