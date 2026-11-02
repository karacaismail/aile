import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { designTokens } from '../../design/tokens.ts';
import type { ResponsiveColumn } from '../shell/contracts';
import { Icon } from './icons';
import { nextSort, sortColumnOf, sortedIndices, type SortValue, type TableSort } from './Table.sort';
import './Table.css';

// Tasarım: tasarim-sistemi/components/Table/README.md. Çok sütunlu karşılaştırma; yerel <table> (antd yok, bütün
// profillerde aynı uygulama). Tablo yalnız kendi kabında yatay kayar: taşarken kap sekme sırasına girer (tabindex=0,
// caption adlı grup) ve klavyeyle kaydırılır; sayfa yatay taşmaz. İlk sütun alanın en çok yarısını tutuyorsa yapışkandır
// (yatay kaydırmada satırın adı görünür kalır; dar alanda kaydırılacak yer bırakmak için yapışmaz). Her sütun minWidth
// alır; `grow` verilen (açıklama) sütun kalan alanı alır, diğerleri en küçük genişliğinde kalır. Başlık 14/600, kelime
// ortasından bölünmez; maxHeight verilince gövde kapta kayar ve başlık o alanda yapışkandır. Tutar sütunları sağa ve
// .aile-tutar ile. Satır tıklanır; Enter/Space açar, oklar/Home/End satırlar arasında odağı taşır. Tıklanabilir satırlar tek
// sekme durağıdır (dolaşan tabindex: son odaklanan satır, yoksa seçili, o da yoksa ilk satır; seçim değişince durak seçili
// satıra geçer): Tab tablodan tek adımda çıkar. Açılabildikleri tek, görsel gizli ipucuyla duyurulur (aria-describedby;
// satırın adı hücrelerden gelir, değişmez). Seçili satır secili yüzey + 600; odak çizgisi satırın altında (admin.css
// tr:focus-visible::after; burada yapışkan hücrenin üstüne alınır).
// Sıralanabilir başlık: <th aria-sort> içinde başlık adıyla düğme. Telefon/tablet uyarlaması ResponsiveTable'ın işidir.

/** Tablo sütunu: contracts ResponsiveColumn'un tablo payı (m/only alanları ResponsiveTable'a aittir) + isteğe bağlı sıralama ve büyüme. */
export type TableColumn<R> = Pick<ResponsiveColumn<R>, 'key' | 'title' | 'align' | 'minWidth' | 'render'> & {
  /** Başlık sıralama düğmesi taşır (aria-sort). */
  sortable?: boolean;
  /** Sıralama değeri; verilmezse satırın `key` alanındaki düz metin ya da sayı. Eksik değer (null) sona gider. */
  sortValue?(row: R): SortValue;
  /** Açıklama sütunu: kalan alanı alır; verildiğinde diğer sütunlar en küçük genişliğinde kalır. */
  grow?: boolean;
};

export type { SortDirection, SortValue, TableSort } from './Table.sort';

export interface TableProps<R extends object> {
  columns: readonly TableColumn<R>[];
  rows: readonly R[];
  /** Satır anahtarı; verilmezse `key`, yoksa `id`, o da yoksa sıra numarası. */
  rowKey?(row: R): string;
  /** Seçili satırın anahtarı (aria-selected + secili yüzey). Seçim odaktan ayrıdır. */
  selectedKey?: string;
  /** Satıra tıklama ya da Enter/Space; verilmezse satırlar sekme sırasına girmez. */
  onRowClick?(row: R): void;
  /** Tıklanabilir satırın ekran okuyucu ipucu (aria-describedby); varsayılan "Enter ya da Boşluk ile açılır." */
  rowHint?: string;
  /** Görsel gizli <caption>; tabloyu ve taşan kaydırma kabını adlandırır. */
  caption?: string;
  /** Verilirse kap bu yükseklikte (CSS px) kendi içinde kayar ve başlık o alanda yapışkan kalır. */
  maxHeight?: number;
  /** Denetimli sıralama; null sıralamasız (veri sırası). Verilmezse Table kendi durumunu tutar. */
  sort?: TableSort | null;
  /** Denetimsiz kullanımda ilk sıralama. */
  defaultSort?: TableSort;
  /** Başlık düğmesiyle istenen sonraki sıralama. */
  onSortChange?(sort: TableSort): void;
  className?: string;
}

/** Sütun başına iki yanlık hücre dolgusu (Table.css: bosluk-4); ResponsiveTable'ın sığma ölçüsüyle aynı. */
const COLUMN_PADDING = designTokens.bosluk4 * 2;
/** Taşan kabın adı caption yoksa. */
const KAP_ADI = 'Tablo';
const EMPTY_TEXT = 'Henüz yok';
const ROW_HINT = 'Enter ya da Boşluk ile açılır.';
const ROW_NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

// Hücre içindeki kontrol (düğme, bağlantı, alan) satırı açmaz; satırın kendisi açar.
const CONTROL = 'a, button, input, select, textarea, summary, [role=button], [role=link], [role=menuitem], [contenteditable]';
function fromControl(event: { target: EventTarget | null; currentTarget: HTMLElement }): boolean {
  const { target, currentTarget } = event;
  return target instanceof Element && target !== currentTarget && target.closest(CONTROL) !== null;
}

function defaultRowKey(row: object, index: number): string {
  const { key, id } = row as { key?: unknown; id?: unknown };
  if (key !== undefined && key !== null) return String(key);
  if (id !== undefined && id !== null) return String(id);
  return String(index);
}

// render verilmeyen sütun: düz metin ya da sayı; nesneleri sayfa render ile adlandırır ("Fiyat yok", "Bilinmiyor").
function defaultCell(row: object, key: string): ReactNode {
  const value = (row as Record<string, unknown>)[key];
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

interface Area {
  /** Kabın genişliği (CSS px); ölçüm yokken 0. */
  width: number;
  /** İçerik kabın genişliğini aşıyor (yatay kaydırma var). */
  overflow: boolean;
}

/** Kaydırma kabının genişliği ve taşması; ilk ölçüm layout effect'te, sonrası kap ve tablo için ResizeObserver. */
function useScrollArea(ref: { current: HTMLDivElement | null }): Area {
  const [area, setArea] = useState<Area>({ width: 0, overflow: false });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      const overflow = width > 0 && element.scrollWidth > element.clientWidth + 1;
      setArea(prev => (prev.width === width && prev.overflow === overflow ? prev : { width, overflow }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // Satırlar değişince kap aynı kalıp tablo genişleyebilir: tablo da izlenir.
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [ref]);
  return area;
}

/** Satırlar arasında odak: oklar bir adım (sarmalamaz), Home/End uçlar. */
function moveRowFocus(event: KeyboardEvent<HTMLTableRowElement>) {
  const rows = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLTableRowElement>(':scope > tr[tabindex]') ?? []);
  const current = rows.indexOf(event.currentTarget);
  if (current < 0) return;
  const last = rows.length - 1;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'ArrowDown' ? Math.min(current + 1, last) : Math.max(current - 1, 0);
  event.preventDefault();
  rows[next]?.focus();
}

export function Table<R extends object>({
  columns, rows, rowKey, selectedKey, onRowClick, rowHint = ROW_HINT, caption, maxHeight, sort, defaultSort, onSortChange, className,
}: TableProps<R>) {
  const hintId = useId();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const area = useScrollArea(scrollerRef);
  const [ownSort, setOwnSort] = useState<TableSort | null>(defaultSort ?? null);
  const requested = sort !== undefined ? sort : ownSort;
  const sortColumn = sortColumnOf(columns, requested);
  const activeSort = sortColumn && requested ? requested : null;
  const order = useMemo(() => sortedIndices(rows, columns, activeSort), [rows, columns, activeSort]);
  const keyOf = (index: number) => (rowKey ? rowKey(rows[index]!) : defaultRowKey(rows[index]!, index));

  // Dolaşan tabindex: son odaklanan satır durak kalır; seçim değişince (açılan kayıt) durak seçili satıra döner
  // (render sırasında durum ayarlama kalıbı; effect'te boş kare yok).
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [seenSelected, setSeenSelected] = useState(selectedKey);
  if (seenSelected !== selectedKey) {
    setSeenSelected(selectedKey);
    setFocusedKey(null);
  }
  const keys = onRowClick ? order.map(keyOf) : [];
  const stopKey = focusedKey !== null && keys.includes(focusedKey) ? focusedKey
    : selectedKey !== undefined && keys.includes(selectedKey) ? selectedKey
    : keys[0];

  const changeSort = (key: string) => {
    const next = nextSort(activeSort, key);
    if (sort === undefined) setOwnSort(next);
    onSortChange?.(next);
  };

  const first = columns[0];
  const stickyFirst = first !== undefined && area.width > 0 && (first.minWidth + COLUMN_PADDING) * 2 <= area.width;
  const hasGrow = columns.some(column => column.grow);

  const headerStyle = (column: TableColumn<R>): CSSProperties => ({
    minWidth: column.minWidth,
    // Büyüyen sütun varken diğerleri en küçük genişliğine sabitlenir; kalan alan büyüyene kalır.
    width: hasGrow && !column.grow ? column.minWidth : undefined,
    textAlign: column.align ?? 'left',
  });

  const renderHeader = (column: TableColumn<R>) => {
    const sorted = sortColumn === column && activeSort ? activeSort.direction : undefined;
    const className = column.sortable ? 'aile-table-baslik aile-table-baslik--sirali aile-kucuk' : 'aile-table-baslik aile-kucuk';
    return (
      <th key={column.key} scope="col" className={className} style={headerStyle(column)} aria-sort={sorted}>
        {column.sortable ? (
          <button type="button" className="aile-table-sirala" data-focus-line onClick={() => changeSort(column.key)}>
            <span className="aile-table-sirala-ad">{column.title}</span>
            <Icon name={sorted ? 'chevronDown' : 'sort'} className="aile-table-sirala-ok" />
          </button>
        ) : (
          column.title
        )}
      </th>
    );
  };

  const renderRow = (index: number) => {
    const row = rows[index]!;
    const key = keyOf(index);
    const selected = selectedKey !== undefined && key === selectedKey;
    const onClick = onRowClick
      ? (event: MouseEvent<HTMLTableRowElement>) => {
          if (!fromControl(event)) onRowClick(row);
        }
      : undefined;
    const onKeyDown = onRowClick
      ? (event: KeyboardEvent<HTMLTableRowElement>) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onRowClick(row);
          } else if (ROW_NAV_KEYS.has(event.key)) {
            moveRowFocus(event);
          }
        }
      : undefined;
    // Satırın kendisi odak alınca (klavye, ok tuşu, işaretçi) durak olur; hücredeki kontrolün odağı sayılmaz.
    const onFocus = onRowClick
      ? (event: FocusEvent<HTMLTableRowElement>) => {
          if (event.target === event.currentTarget) setFocusedKey(key);
        }
      : undefined;
    return (
      <tr
        key={key}
        className="aile-table-satir"
        aria-selected={selected || undefined}
        aria-describedby={onRowClick ? hintId : undefined}
        tabIndex={onRowClick ? (key === stopKey ? 0 : -1) : undefined}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
      >
        {columns.map(column => (
          <td key={column.key} className={column.align === 'right' ? 'aile-table-hucre aile-tutar' : 'aile-table-hucre'}>
            {column.render ? column.render(row) : defaultCell(row, column.key)}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div className={className ? `aile-table-alan ${className}` : 'aile-table-alan'}>
      <div
        ref={scrollerRef}
        className="aile-table-kaydirici"
        data-overflow={area.overflow ? 'true' : undefined}
        data-sticky-first={stickyFirst ? 'true' : undefined}
        data-dikey-kaydirma={maxHeight !== undefined ? 'true' : undefined}
        // Taşarken kap klavyeyle kaydırılabilsin: sekme sırasına girer ve adlandırılır (landmark değil, grup).
        tabIndex={area.overflow ? 0 : undefined}
        role={area.overflow ? 'group' : undefined}
        aria-label={area.overflow ? caption || KAP_ADI : undefined}
        style={maxHeight !== undefined ? { maxHeight } : undefined}
      >
        <table className="aile-table">
          {caption ? <caption>{caption}</caption> : null}
          <thead>
            <tr>{columns.map(renderHeader)}</tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              order.map(renderRow)
            ) : (
              <tr>
                <td className="aile-table-hucre aile-table-bos aile-ikincil" colSpan={Math.max(columns.length, 1)}>{EMPTY_TEXT}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {onRowClick ? <p id={hintId} className="aile-table-ipucu">{rowHint}</p> : null}
    </div>
  );
}
