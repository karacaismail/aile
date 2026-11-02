import { sumMoney } from '../data/actuals';
import type { Money as MoneyValue } from '../shell/contracts';
import { FIYAT_YOK, HENUZ_YOK, Money } from './Money';

// PivotStack (telefon yığını) ve wide/Pivot.wide.tsx (geniş tablo) için ortak, telefon-güvenli model ve parçalar.
// Sahiplik kuralı (view_definitions › pivot.aggregation.ownership_rule): yalnız açık yaprak satır sahipliği toplamayı
// açar; kaynaktaki alt toplam çocuklarıyla yeniden toplanmaz. Satır rolü:
//   - 'leaf' (varsayılan): çağıran satırı yaprak kayıtlardan bir kez hesaplamıştır → genel ve sütun toplamına girer.
//   - 'subtotal': kaynakta hazır alt toplam → kendi değeriyle gösterilir, toplama girmez (çift sayım olmaz).
//   - 'unowned': sahipliği belirsiz → gösterilir, toplama girmez; neden adıyla yazılır.
// Tutarlar sayı (TRY) gelir; toplam kayan noktada değil data/actuals sumMoney ile kesin ondalıkta yapılır. Sonlu
// olmayan sayı (NaN, ±Infinity) "Bilinmiyor" yazılır ve toplanmaz; ₺0,00 eksiğin yerine asla geçmez.
// Para biçimi ui/Money (₺8.500,00, tabular, eksik ikincil); burada yerel biçimleyici yok.

/** Bir hücre: [planlanan, gerçekleşen]; null = o değer yok. Tutarlar TRY, sayı olarak. */
export type PivotCell = [plan: number | null, actual: number | null];
export type PivotRowRole = 'leaf' | 'subtotal' | 'unowned';
export interface PivotRowMeta {
  /** Varsayılan 'leaf'. 'subtotal' ve 'unowned' gösterilir ama toplanmaz. */
  role?: PivotRowRole;
}
/** Bir satır: [satır adı, sütun sırasıyla hücreler, isteğe bağlı sahiplik]. */
export type PivotRow = [label: string, cells: PivotCell[], meta?: PivotRowMeta];

export const PLANLANAN = 'Planlanan';
export const GERCEKLESEN = 'Gerçekleşen';
export const KAYIT_YOK = 'Kayıt yok';
export const GENEL_TOPLAM = 'Genel toplam';
export const TOPLAM = 'Toplam';
export const ALT_TOPLAM = 'Alt toplam';
export const SAHIPSIZ = 'Sahipliği belirsiz · toplama girmedi';
const PARA = 'TRY';
const BOZUK = 'NaN';

/** Geniş tablonun kolon asgari genişlikleri (CSS px). Tek kaynak: Pivot.wide.css aynı değeri taşır (testle korunur). */
export const PIVOT_KOLON_ASGARI = 168;
export const PIVOT_ILK_KOLON_ASGARI = 160;
/** Tablonun sığması için gereken asgari genişlik: ilk kolon + değer kolonları + Toplam. */
export const pivotTableMinWidth = (columnCount: number) => PIVOT_ILK_KOLON_ASGARI + (columnCount + 1) * PIVOT_KOLON_ASGARI;

/** Bir ölçünün gösterilecek değeri: Money (bozuk → amount 'NaN' → "Bilinmiyor") ya da yok (null). */
export type Measure = MoneyValue | null;
export type MeasurePair = [plan: Measure, actual: Measure];

const toMoney = (value: number): MoneyValue => ({ amount: Number.isFinite(value) ? value.toFixed(2) : BOZUK, currency: PARA });

/** Bir ölçü sütununun kesin toplamı: hiç değer yoksa null ("Fiyat yok"/"Henüz yok"); yalnız bozuk varsa "Bilinmiyor". */
function sumMeasure(values: readonly (number | null)[]): Measure {
  const present = values.filter((value): value is number => value != null);
  if (present.length === 0) return null;
  const total = sumMoney(present.map(toMoney));
  return total.money ?? { amount: BOZUK, currency: PARA };
}

export function cellMeasures(cell: PivotCell | undefined): MeasurePair | null {
  if (!cell || (cell[0] == null && cell[1] == null)) return null;
  return [cell[0] == null ? null : toMoney(cell[0]), cell[1] == null ? null : toMoney(cell[1])];
}

const sumCells = (cells: readonly PivotCell[]): MeasurePair => [sumMeasure(cells.map(cell => cell[0])), sumMeasure(cells.map(cell => cell[1]))];
export const roleOf = (row: PivotRow): PivotRowRole => row[2]?.role ?? 'leaf';

export interface PivotSummary {
  /** Satırın kendi toplamı (rolünden bağımsız; alt toplam satırı kendi değerini gösterir). */
  rowTotals: MeasurePair[];
  /** Sütun toplamları: yalnız 'leaf' satırlar. */
  columnTotals: MeasurePair[];
  /** Genel toplam: yalnız 'leaf' satırlar. */
  grand: MeasurePair;
  /** Toplama girmeyenler: alt toplam ve sahipsiz satır sayısı, yaprak satırlarda okunamayan (sonlu olmayan) değer sayısı. */
  excluded: { subtotal: number; unowned: number; unreadable: number };
}

export function summarizePivot(columns: readonly string[], rows: readonly PivotRow[]): PivotSummary {
  const leaves = rows.filter(row => roleOf(row) === 'leaf');
  const leafCells = leaves.flatMap(([, cells]) => cells);
  return {
    rowTotals: rows.map(([, cells]) => sumCells(cells)),
    columnTotals: columns.map((_, j) => sumCells(leaves.map(([, cells]) => cells[j] ?? [null, null]))),
    grand: sumCells(leafCells),
    excluded: {
      subtotal: rows.filter(row => roleOf(row) === 'subtotal').length,
      unowned: rows.filter(row => roleOf(row) === 'unowned').length,
      unreadable: leafCells.flat().filter(value => value != null && !Number.isFinite(value)).length,
    },
  };
}

/** "Toplama girmeyen: 1 alt toplam satırı · 1 sahipliği belirsiz satır"; dışlanan yoksa null. */
export function excludedNote({ subtotal, unowned, unreadable }: PivotSummary['excluded']): string | null {
  const parts = [
    subtotal > 0 ? `${subtotal} alt toplam satırı` : null,
    unowned > 0 ? `${unowned} sahipliği belirsiz satır` : null,
    unreadable > 0 ? `${unreadable} okunamayan değer` : null,
  ].filter(Boolean);
  return parts.length ? `Toplama girmeyen: ${parts.join(' · ')}` : null;
}

/** Planlanan ve Gerçekleşen alt alta, ikisi de adıyla; renk ya da konum tek işaret değil, asla tek sayı değil. */
export function Pair({ value }: { value: MeasurePair }) {
  return (
    <span className="aile-pivot-pair">
      <span className="aile-pivot-pair-line">
        <span className="aile-pivot-k aile-kucuk">{PLANLANAN}</span> <Money value={value[0]} label={FIYAT_YOK} />
      </span>
      {' '}
      <span className="aile-pivot-pair-line">
        <span className="aile-pivot-k aile-kucuk">{GERCEKLESEN}</span> <Money value={value[1]} label={HENUZ_YOK} />
      </span>
    </span>
  );
}

/** Hücre: iki değer de yoksa "Kayıt yok", aksi hâlde çift. */
export function CellValue({ cell }: { cell: PivotCell | undefined }) {
  const measures = cellMeasures(cell);
  return measures ? <Pair value={measures} /> : <span className="aile-pivot-eksik">{KAYIT_YOK}</span>;
}

/** Satır rolü işareti (yaprakta yok). */
export function RoleMark({ row }: { row: PivotRow }) {
  const role = roleOf(row);
  if (role === 'leaf') return null;
  return <span className="aile-pivot-rol aile-kucuk" data-rol={role}>{role === 'subtotal' ? ALT_TOPLAM : SAHIPSIZ}</span>;
}
