import { Fragment, isValidElement, useRef, useState, type ReactNode } from 'react';
import { designTokens } from '../../design/tokens.ts';
import { useContainerWidth, useDevice } from '../device';
import type { AccordionItem, ResponsiveColumn } from '../shell/contracts';
import { AccordionList, type AccordionHeadingLevel } from './AccordionList';
import { Table, type TableColumn } from './Table';
import { sortedIndices, type TableSort } from './Table.sort';
import './ResponsiveTable.css';

// Tasarım: tasarim-sistemi/components/ResponsiveTable/README.md. Tabloyu cihaza ve alana göre çizer:
// masaüstünde Table (ilk sütunu Table yapışkan yapar), tablette sığıyorsa Table, sığmıyorsa ve telefonda akordeon
// liste; ≤3 anlamlı sütunda düz liste (açılma yok, satır doğrudan ayrıntıya gider). Sığma ölçüsü: masaüstü
// sütunlarının minWidth toplamı + sütun başına iki yanlık hücre dolgusu (2 × bosluk-4; README'deki sütun dolgusu), alanın gerçek
// genişliğiyle (ResizeObserver) karşılaştırılır. Sütun rolleri m: title (kapalıyken başlık) | meta (başlık altı,
// " · " ile) | status (etiket) | lead (sağdaki ana tutar) | body (varsayılan; açılınca etiket–değer) | hide.
// groupBy telefonda grup başlıkları üretir; geciken grup ("Gecikenler" ya da tahmin olaylarının "Tarihi geçenler"i) her
// zaman üstte, diğerleri ilk görüldükleri sırada.
// Sıralama (sortable sütun, aria-sort) burada tutulur: tabloda seçilen sıra telefona geçişte korunur ve akordeon da
// aynı sırayla dizilir (Table.sort; eksik değer sonda). sort verilirse denetimlidir, ResponsiveTable durum tutmaz.

export type MobileMode = 'accordion' | 'list';

/** ResponsiveColumn + tablo payının isteğe bağlı alanları (sortable, sortValue, grow). */
export type ResponsiveTableColumn<R> = ResponsiveColumn<R> & Pick<TableColumn<R>, 'sortable' | 'sortValue' | 'grow'>;

export interface ResponsiveTableProps<R extends object> {
  columns: readonly ResponsiveTableColumn<R>[];
  rows: readonly R[];
  /** Tablonun adı (görsel gizli caption); telefonda mobileCaption yoksa bu kullanılır. */
  caption?: string;
  /** Seçili satırın anahtarı; satır anahtarı `key`, yoksa `id`, o da yoksa sıra numarası. */
  selectedKey?: string;
  onRowClick?(row: R): void;
  /** Yalnız tabloda: gövde bu yükseklikte kendi içinde kayar. */
  maxHeight?: number;
  /** Telefon biçimi; verilmezse ≤3 anlamlı (gizli olmayan) sütunda 'list', aksi hâlde 'accordion'. */
  mobileMode?: MobileMode;
  /** Telefonda kısa sayım ("4 kalem"); yoksa caption. */
  mobileCaption?: string;
  /** Telefonda grup başlığı; geciken grup üstte. */
  groupBy?(row: R): string;
  /** Zorlama: true her yerde telefon biçimi, false her yerde tablo. */
  narrow?: boolean;
  /** Akordeonda açık başlayan satır anahtarları; verilmezse ilk satır açık (AccordionList). */
  defaultOpenKeys?: readonly string[];
  /** Akordeon gövdesindeki ayrıntı düğmesinin etiketi ("Ayrıntıyı aç"). */
  openLabel?: string;
  /** Akordeon grup başlıklarının düzeyi (AccordionList; varsayılan h3). Sayfada h2 yoksa 2: başlık sırası atlamaz. */
  headingLevel?: AccordionHeadingLevel;
  /** Denetimli sıralama; null sıralamasız. Verilmezse ResponsiveTable kendi durumunu tutar (defaultSort ile başlar). */
  sort?: TableSort | null;
  defaultSort?: TableSort;
  /** Tablo başlığından istenen sonraki sıralama. */
  onSortChange?(sort: TableSort): void;
  className?: string;
}

/** Sütun başına iki yanlık hücre dolgusu (Table: cellPaddingInline = bosluk-4). */
const COLUMN_PADDING = designTokens.bosluk4 * 2;
/** Bu sayıda ve daha az anlamlı sütun telefonda düz listedir (README). */
const LIST_COLUMN_LIMIT = 3;
const META_SEPARATOR = ' · ';
/** Geciken grup adı: "Gecikenler" ya da ödeme gerçeği bilinmeyen olayların "Tarihi geçenler"i. */
const LATE_GROUP = /gecik|tarihi geç/;

/** Sığma ölçüsü: masaüstü sütunlarının minWidth toplamı + sütun başına dolgu. Dışa açık (test ve sayfa hesabı). */
export function requiredTableWidth<R extends object>(columns: readonly ResponsiveColumn<R>[]): number {
  return columns.reduce((total, column) => total + column.minWidth + COLUMN_PADDING, 0);
}

/** Satır anahtarı Table ile aynı kural: key → id → sıra. */
function rowKeyOf(row: object, index: number): string {
  const { key, id } = row as { key?: unknown; id?: unknown };
  if (key !== undefined && key !== null) return String(key);
  if (id !== undefined && id !== null) return String(id);
  return String(index);
}

// render verilmeyen sütun: düz metin, sayı ya da hazır öğe; nesneleri sayfa render ile adlandırır ("Fiyat yok").
function cellOf<R extends object>(column: ResponsiveColumn<R>, row: R): ReactNode {
  if (column.render) return column.render(row);
  const value = (row as Record<string, unknown>)[column.key];
  return typeof value === 'string' || typeof value === 'number' || isValidElement(value) ? value : null;
}

const isLateGroup = (name: string) => LATE_GROUP.test(name.toLocaleLowerCase('tr-TR'));

/** Geciken grup(lar) üste; diğer gruplar ilk görüldükleri sırada; grup içi sıra veri sırası (kararlı sıralama). */
function orderByGroup(items: AccordionItem[]): AccordionItem[] {
  const groups: string[] = [];
  for (const item of items) {
    const name = item.group ?? '';
    if (!groups.includes(name)) groups.push(name);
  }
  const late = groups.filter(isLateGroup);
  const order = [...late, ...groups.filter(name => !late.includes(name))];
  return [...items].sort((a, b) => order.indexOf(a.group ?? '') - order.indexOf(b.group ?? ''));
}

export function ResponsiveTable<R extends object>({
  columns, rows, caption, selectedKey, onRowClick, maxHeight, mobileMode, mobileCaption, groupBy, narrow, defaultOpenKeys, openLabel,
  headingLevel, sort, defaultSort, onSortChange, className,
}: ResponsiveTableProps<R>) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(ref);
  const device = useDevice();
  const [ownSort, setOwnSort] = useState<TableSort | null>(defaultSort ?? null);
  const activeSort = sort !== undefined ? sort : ownSort;
  const changeSort = (next: TableSort) => {
    if (sort === undefined) setOwnSort(next);
    onSortChange?.(next);
  };

  const tableColumns = columns.filter(column => column.only !== 'mobile');
  // Tablet: ölçüm gelmeden (0) tablo; ölçüm alanın gerekenden dar olduğunu söylerse akordeon.
  const mobile = narrow ?? (device === 'phone' ? true : device === 'tablet' ? width > 0 && width < requiredTableWidth(tableColumns) : false);
  const rootClass = className ? `aile-rtable ${className}` : 'aile-rtable';

  if (!mobile) {
    return (
      <div ref={ref} className={rootClass} data-layout="table">
        <Table<R>
          columns={tableColumns}
          rows={rows}
          caption={caption}
          selectedKey={selectedKey}
          onRowClick={onRowClick}
          maxHeight={maxHeight}
          sort={activeSort}
          onSortChange={changeSort}
        />
      </div>
    );
  }

  const visible = columns.filter(column => column.only !== 'desktop' && column.m !== 'hide');
  const mode: MobileMode = mobileMode ?? (visible.length <= LIST_COLUMN_LIMIT ? 'list' : 'accordion');
  const titleColumn = visible.find(column => column.m === 'title') ?? visible[0];
  const metaColumns = visible.filter(column => column.m === 'meta');
  const statusColumn = visible.find(column => column.m === 'status');
  const leadColumn = visible.find(column => column.m === 'lead');
  const bodyColumns = visible.filter(column => column !== titleColumn && (column.m === undefined || column.m === 'body'));

  let items: AccordionItem[] = sortedIndices(rows, columns, activeSort).map(index => {
    const row = rows[index]!;
    const key = rowKeyOf(row, index);
    const body = mode === 'list' ? [] : bodyColumns.map((column): [ReactNode, ReactNode] => [column.title, cellOf(column, row)]);
    return {
      key,
      title: titleColumn ? cellOf(titleColumn, row) : null,
      meta: metaColumns.length
        ? metaColumns.map((column, position) => (
            <Fragment key={column.key}>{position > 0 ? META_SEPARATOR : null}{cellOf(column, row)}</Fragment>
          ))
        : undefined,
      status: statusColumn ? cellOf(statusColumn, row) : undefined,
      lead: leadColumn ? cellOf(leadColumn, row) : undefined,
      body: body.length ? body : undefined,
      onOpen: onRowClick ? () => onRowClick(row) : undefined,
      group: groupBy ? groupBy(row) : undefined,
      selected: selectedKey !== undefined && key === selectedKey,
    };
  });
  if (groupBy) items = orderByGroup(items);

  return (
    <div ref={ref} className={rootClass} data-layout={mode}>
      <AccordionList
        items={items}
        caption={mobileCaption ?? caption}
        defaultOpenKeys={defaultOpenKeys}
        openLabel={openLabel}
        headingLevel={headingLevel}
      />
    </div>
  );
}
