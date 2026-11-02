import { useRef, type CSSProperties, type ReactNode } from 'react';
import { designTokens } from '../../../design/tokens.ts';
import type { Term } from '../../data';
import { useContainerWidth, useProfile } from '../../device';
import type { ResponsiveColumn } from '../../shell/contracts';
import { Table } from '../../ui/Table';
import { Tag } from '../../ui/Tag';
import { BILINMIYOR, type TermNode, type TermUsage } from './model';
import './TermTable.wide.css';

// Geniş-özel (tablet/masaüstü) sözlük ağacı tablosu; SozluklerPage lazyWide('sozlukler-terim-tablosu') ile yükler,
// telefon profili bu modülü hiç indirmez. Tasarım: bundle.js Aile.Pages.Sozlukler masaüstü tablosu — Ad (girintili,
// kök 600, alt "└"), E-tablo kodu (alias), Üst kategori ("—"), Kullanan kayıt (sağa, tabular; alt dallar dahil), Eylem.
// Tablette tablo sığmazsa (sütun en küçükleri + hücre dolgusu > alan) temel sunum olan açılır ağaç gösterilir
// (README: "Tablo sığıyorsa tablo"). Masaüstünde tablo her zaman kalır; dar alanda kendi içinde yana kayar (ui/Table).

type TableColumn<R> = Pick<ResponsiveColumn<R>, 'key' | 'title' | 'align' | 'minWidth' | 'render'>;

export interface TermTableWideProps {
  /** Tablonun adı (sözlüğün Türkçe adı). */
  caption: string;
  /** Derinlik öncelikli düz liste (flattenTermTree). */
  rows: readonly TermNode[];
  usage: ReadonlyMap<string, TermUsage | null>;
  /** "Üst kategori" ya da "Üst terim". */
  parentTitle: string;
  renderAction(term: Term): ReactNode;
  /** Tablet alanı tabloya yetmezse gösterilen temel sunum (açılır ağaç). */
  narrowView: ReactNode;
}

interface Row { key: string; node: TermNode }

/** ui/ResponsiveTable ile aynı sığma ölçüsü: sütun en küçükleri + sütun başına iki yanlık hücre dolgusu. */
const requiredWidth = (columns: readonly TableColumn<Row>[]) => columns.reduce((sum, column) => sum + column.minWidth + 2 * designTokens.bosluk4, 0);

export default function TermTableWide({ caption, rows, usage, parentTitle, renderAction, narrowView }: TermTableWideProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(ref);
  const profile = useProfile();

  const columns: TableColumn<Row>[] = [
    {
      key: 'ad',
      title: 'Ad',
      minWidth: 240,
      render: ({ node }) => (
        <span className="aile-sz-tablo-ad" data-depth={node.depth} style={{ '--aile-sz-derinlik': node.depth } as CSSProperties}>
          {node.depth > 0 ? <span className="aile-sz-tablo-dal" aria-hidden="true">└</span> : null}
          <span className={node.depth === 0 ? 'aile-sz-tablo-kok' : undefined}>{node.term.label}</span>
          {node.term.legacy ? <>{' '}<Tag>Eski</Tag></> : null}
        </span>
      ),
    },
    { key: 'kod', title: 'E-tablo kodu', minWidth: 136, render: ({ node }) => <code className="aile-sz-kod">{node.term.code}</code> },
    { key: 'ust', title: parentTitle, minWidth: 160, render: ({ node }) => node.parent?.label ?? '—' },
    {
      key: 'kayit',
      title: 'Kullanan kayıt',
      align: 'right',
      minWidth: 136,
      render: ({ node }) => {
        const termUsage = usage.get(node.term.id) ?? null;
        return termUsage === null ? <span className="aile-ikincil">{BILINMIYOR}</span> : <span className="aile-tutar">{termUsage.total}</span>;
      },
    },
    { key: 'eylem', title: 'Eylem', minWidth: 200, render: ({ node }) => renderAction(node.term) },
  ];

  const tableRows: Row[] = rows.map((node) => ({ key: node.term.id, node }));
  const tooNarrow = profile === 'tablet' && width > 0 && width < requiredWidth(columns);

  return (
    <div ref={ref} className="aile-sz-tablo" data-layout={tooNarrow ? 'agac' : 'tablo'}>
      {tooNarrow ? narrowView : <Table<Row> caption={caption} rows={tableRows} columns={columns} />}
    </div>
  );
}
