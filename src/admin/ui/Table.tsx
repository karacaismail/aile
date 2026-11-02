import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { designTokens } from '../../design/tokens.ts';
import { useDevice } from '../device';
import type { ResponsiveColumn } from '../shell/contracts';
import { AntTable, ConfigProvider, type AntTableColumnsType, type ThemeConfig } from './antd';
import './Table.css';

// Tasarım: tasarim-sistemi/components/Table/README.md. Çok sütunlu karşılaştırma; yalnız tablo kendi içinde yatay
// kayar (scroll x max-content), başlık yapışkan, her sütun minWidth alır, tutar sütunları sağa ve .aile-tutar ile.
// Satır tıklanır ve Enter ile açılır; seçili satır secili yüzey + 600 ağırlık; odak çizgisini admin.css çizer
// (tr:focus-visible::after). Telefon/tablet uyarlaması ResponsiveTable'ın işidir; burası her zaman tablodur.

/** Tablo sütunu: contracts ResponsiveColumn'un tablo payı (m/only alanları ResponsiveTable'a aittir). */
export type TableColumn<R> = Pick<ResponsiveColumn<R>, 'key' | 'title' | 'align' | 'minWidth' | 'render'>;

export interface TableProps<R extends object> {
  columns: readonly TableColumn<R>[];
  rows: readonly R[];
  /** Satır anahtarı; verilmezse `key`, yoksa `id`, o da yoksa sıra numarası. */
  rowKey?(row: R): string;
  /** Seçili satırın anahtarı (aria-selected + secili yüzey). Seçim odaktan ayrıdır. */
  selectedKey?: string;
  /** Satıra tıklama ya da Enter; verilmezse satırlar sekme sırasına girmez. */
  onRowClick?(row: R): void;
  /** Görsel gizli <caption>; tabloyu adlandırır. */
  caption?: string;
  /** Verilirse gövde bu yükseklikte (CSS px) kendi içinde kayar ve başlık sabit kalır; verilmezse başlık sayfaya yapışır. */
  maxHeight?: number;
  className?: string;
}

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

// Yalnız bu tabloya özgü antd Table token'ları; ortak tema (antdTheme.ts) paylaşımlı ve salt okunur.
// Başlık hücreleri arasındaki dikey ayırıcı yok (kenar yağmuru yok); hücre boşluğu bosluk-3 / bosluk-4.
const tableTheme: ThemeConfig = {
  components: {
    Table: {
      headerSplitColor: 'transparent',
      cellPaddingBlock: designTokens.bosluk3, cellPaddingInline: designTokens.bosluk4,
      cellPaddingBlockMD: designTokens.bosluk3, cellPaddingInlineMD: designTokens.bosluk4,
      cellPaddingBlockSM: designTokens.bosluk3, cellPaddingInlineSM: designTokens.bosluk4,
    },
  },
};

export function Table<R extends object>({ columns, rows, rowKey, selectedKey, onRowClick, caption, maxHeight, className }: TableProps<R>) {
  const device = useDevice();
  const keyOf = (row: R, index = 0) => (rowKey ? rowKey(row) : defaultRowKey(row, index));

  const antColumns: AntTableColumnsType<R> = columns.map((column, index) => ({
    key: column.key,
    title: column.title,
    align: column.align ?? 'left',
    minWidth: column.minWidth,
    // Masaüstünde ilk sütun yapışkan: yatay kaydırmada kimlik/ad görünür kalır.
    fixed: index === 0 && device === 'desktop' ? 'start' : undefined,
    onHeaderCell: () => ({ className: 'aile-table-baslik', style: { minWidth: column.minWidth } }),
    onCell: () => ({ className: column.align === 'right' ? 'aile-table-hucre aile-tutar' : 'aile-table-hucre' }),
    render: (_value: unknown, row: R) => (column.render ? column.render(row) : defaultCell(row, column.key)),
  }));

  const onRow = (row: R, index?: number) => {
    const selected = selectedKey !== undefined && keyOf(row, index) === selectedKey;
    return {
      // antd rowSelectedBg / rowSelectedHoverBg token'ları (antdTheme.ts › Table) bu sınıfla uygulanır;
      // seçim antd rowSelection değil, sayfanın selectedKey'idir.
      className: selected ? 'aile-table-satir ant-table-row-selected' : 'aile-table-satir',
      'aria-selected': selected || undefined,
      tabIndex: onRowClick ? 0 : undefined,
      onClick: (event: MouseEvent<HTMLElement>) => {
        if (onRowClick && !fromControl(event)) onRowClick(row);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (!onRowClick || event.key !== 'Enter' || event.target !== event.currentTarget) return;
        event.preventDefault();
        onRowClick(row);
      },
    };
  };

  return (
    <ConfigProvider theme={tableTheme}>
      <AntTable<R>
        className={className ? `aile-table ${className}` : 'aile-table'}
        data-device={device}
        columns={antColumns}
        dataSource={rows as R[]}
        rowKey={keyOf}
        pagination={false}
        tableLayout="auto"
        sticky={maxHeight === undefined}
        scroll={{ x: 'max-content', y: maxHeight }}
        caption={caption}
        onRow={onRow}
        locale={{ emptyText: 'Henüz yok' }}
      />
    </ConfigProvider>
  );
}
