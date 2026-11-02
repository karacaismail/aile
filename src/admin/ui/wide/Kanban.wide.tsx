import { useId, useLayoutEffect, useRef } from 'react';
import { BOS_SUTUN, KanbanCard, KanbanColumnHeader, buildColumns, restoreFocusedCard, type KanbanBoardProps } from '../Kanban.parts';
import './Kanban.wide.css';

// Geniş-özel (tablet/masaüstü) Kanban pano ızgarası. Yalnız ui/Kanban.tsx içindeki lazyWide('ui-kanban-pano', …) ile
// iner; telefon profilinde hiç indirilmez (W0 *.wide kuralı). antd gerekmez: yerel HTML + Kanban.parts (telefon-
// güvenli ortak grup/kart parçaları). Tasarım: components/Kanban/README.md — sütun = tedarik durumu, zemin
// liste-zemin, kart yuzey; pano kendi içinde yatay kayar, sayfa kaymaz; sürükleme yok (durum değişimi ayrıntıdaki
// eylemle). Adlı, sekme sırasındaki kaydırma bölgesi Kanban.tsx'tedir (liste ↔ pano geçişinde aynı düğüm); burada
// yalnız sütunlar. Sütun adları/rolleri telefon listesiyle aynıdır. Sütun 248 px (Kanban.wide.css).
// Yedek listede bir kart odaktayken ızgara gelirse o kart sökülür ve odak body'ye düşer; bağlanınca odak aynı kaydın
// kartına döner (Kanban.parts restoreFocusedCard). Kullanıcı odağı başka yere taşıdıysa dokunulmaz.

export default function KanbanBoard({ items, columns, selectedKey, onOpen }: KanbanBoardProps) {
  const baseId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const board = buildColumns(items, columns);
  useLayoutEffect(() => {
    if (gridRef.current) restoreFocusedCard(gridRef.current);
  }, []);
  return (
    <div ref={gridRef} className="aile-kanban-izgara" data-kanban-izgara="">
      {board.map((column, index) => {
        const headingId = `${baseId}-sutun-${index}`;
        return (
          <section key={column.label} className="aile-kanban-sutun" aria-label={column.label}>
            <KanbanColumnHeader column={column} headingId={headingId} />
            {column.rows.length > 0 ? (
              <ul className="aile-kanban-kartlar" aria-labelledby={headingId}>
                {column.rows.map(row => (
                  <li key={row.id} className="aile-kanban-oge">
                    <KanbanCard row={row} selected={selectedKey !== undefined && row.id === selectedKey} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="aile-kanban-bos">{BOS_SUTUN}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
