// Tablo sıralaması: Table (geniş profil) ve ResponsiveTable (telefon akordeonu) aynı sırayı buradan alır. Ayrı modül:
// ResponsiveTable testleri ./Table'ı taklit eder; sıralama kuralı taklit edilmeden ortak kalır. React yok, saf işlevler.

export type SortDirection = 'ascending' | 'descending';

/** Etkin sıralama; aria-sort değerleriyle aynı adlar. */
export interface TableSort {
  key: string;
  direction: SortDirection;
}

/** Sıralama değeri; null, undefined, boş metin ve NaN eksik sayılır ("Fiyat yok") ve her yönde sona gider. */
export type SortValue = string | number | null | undefined;

export interface SortableColumn<R> {
  key: string;
  /** Başlık sıralama düğmesi taşır; yalnız bu sütunlar sırayı değiştirir. */
  sortable?: boolean;
  /** Sıralama değeri; verilmezse satırın `key` alanındaki düz metin ya da sayı. */
  sortValue?(row: R): SortValue;
}

// Türkçe harmanlama (C < Ç, U < Ü), büyük/küçük harf ayrımı yok, metindeki sayılar sayısal ("Ayna 9" < "Ayna 10").
const collator = new Intl.Collator('tr-TR', { numeric: true, sensitivity: 'base' });

const isMissing = (value: SortValue): value is null | undefined =>
  value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value)) || (typeof value === 'string' && value.trim() === '');

function sortValueOf<R>(column: SortableColumn<R>, row: R): SortValue {
  if (column.sortValue) return column.sortValue(row);
  const value = (row as Record<string, unknown>)[column.key];
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

/** Sıralamanın uygulandığı sütun: anahtarı eşleşen ve sıralanabilir olan; yoksa undefined (veri sırası). */
export function sortColumnOf<R, C extends SortableColumn<R>>(columns: readonly C[], sort: TableSort | null | undefined): C | undefined {
  return sort ? columns.find(column => column.key === sort.key && column.sortable === true) : undefined;
}

/**
 * Sıralı satır sıraları (özgün dizinler). Kararlı: eşit değerler veri sırasını korur; eksik değerler her yönde sonda.
 * Sıralanabilir sütun yoksa veri sırası döner.
 */
export function sortedIndices<R>(rows: readonly R[], columns: readonly SortableColumn<R>[], sort: TableSort | null | undefined): number[] {
  const order = rows.map((_row, index) => index);
  const column = sortColumnOf(columns, sort);
  if (!column || !sort) return order;
  const sign = sort.direction === 'descending' ? -1 : 1;
  const values = rows.map(row => sortValueOf(column, row));
  return order.sort((a, b) => {
    const left = values[a];
    const right = values[b];
    const leftMissing = isMissing(left);
    const rightMissing = isMissing(right);
    if (leftMissing || rightMissing) return leftMissing === rightMissing ? a - b : leftMissing ? 1 : -1;
    const compared = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right));
    return compared === 0 ? a - b : sign * compared;
  });
}

/** Başlığa basınca sonraki sıralama: aynı sütun artan → azalan → artan; başka sütun artan başlar. */
export function nextSort(current: TableSort | null | undefined, key: string): TableSort {
  return current?.key === key && current.direction === 'ascending' ? { key, direction: 'descending' } : { key, direction: 'ascending' };
}
