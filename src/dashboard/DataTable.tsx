import { useMemo, useState, type ReactNode } from 'react';
export type Column<T> = { key: string; label: string; render: (row: T) => ReactNode; value: (row: T) => string | number | null; numeric?: boolean };
export function DataTable<T>({ rows, columns, rowKey, caption, pageSize = 15 }: { rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string; caption: string; pageSize?: number }) {
  const [sort, setSort] = useState<{ key: string; direction: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const ordered = useMemo(() => {
    const col = columns.find(c => c.key === sort?.key);
    if (!col || !sort) return rows;
    return [...rows].sort((a, b) => {
      const x = col.value(a), y = col.value(b);
      if (x === null) return y === null ? 0 : 1;
      if (y === null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'tr')) * sort.direction;
    });
  }, [columns, rows, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)), safePage = Math.min(page, pages - 1);
  return <div className="data-table-block">
    <div className="table-scroll" tabIndex={0} onKeyDown={e=>{if(e.target===e.currentTarget && ['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.currentTarget.scrollLeft += e.key==='ArrowRight'?80:-80;}}} role="region" aria-label={`${caption}. Dar ekranda yatay kaydırılabilir.`}>
      <table><caption>{caption}</caption><thead><tr>{columns.map(col => <th key={col.key} scope="col" className={col.numeric ? 'numeric' : ''} aria-sort={sort?.key === col.key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button onClick={() => { setPage(0); setSort({ key: col.key, direction: sort?.key === col.key && sort.direction === 1 ? -1 : 1 }); }}>{col.label}<span aria-hidden="true">{sort?.key === col.key ? sort.direction === 1 ? ' ↑' : ' ↓' : ' ↕'}</span></button></th>)}</tr></thead>
      <tbody>{ordered.slice(safePage * pageSize, (safePage + 1) * pageSize).map(row => <tr key={rowKey(row)}>{columns.map(col => <td key={col.key} className={col.numeric ? 'numeric' : ''}>{col.render(row)}</td>)}</tr>)}</tbody></table>
      {!rows.length && <p className="empty-message">Bu filtrelerle eşleşen kayıt yok.</p>}
    </div>
    <div className="table-footer"><span>{rows.length} kayıt{pages > 1 && ` · Sayfa ${safePage + 1} / ${pages}`}</span>{pages > 1 && <div className="button-row"><button className="quiet-button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Önceki</button><button className="quiet-button" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>Sonraki</button></div>}</div>
  </div>;
}
