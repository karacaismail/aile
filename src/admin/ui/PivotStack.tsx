import { useId, useRef, useState } from 'react';
import { lazyWide } from '../adaptive';
import { useContainerWidth, useDevice } from '../device';
import { Button } from './Button';
import { Icon } from './icons';
import { PRESS_HANDLERS } from './Kanban.press';
import {
  CellValue, GENEL_TOPLAM, KAYIT_YOK, Pair, RoleMark, excludedNote, pivotTableMinWidth, summarizePivot,
  type PivotRow, type PivotSummary,
} from './PivotStack.parts';
import './PivotStack.css';

// Tasarım › components/PivotStack/README.md + index.d.ts PivotStackProps; referans davranış bundle.js PivotStack /
// PivotTable. Uyarlamalı teslim (W0 sözleşmesi):
//  - Telefon (ve tablette tablo kapsayıcıya sığmıyorsa): yığılmış özet. Satır boyutu dış katman, sütun değerleri
//    açılınca alt alta. Satır başlığı APG disclosure (aria-expanded/controls, kapalı bölge hidden+inert); ilk satır
//    açık gelir, birden çok satır açık kalabilir, üstte "Tümünü aç / kapat". 240 ms tek eğri; reduced-motion anlık.
//  - Geniş (masaüstü; tablette sığarsa): pivot tablo + yapışkan ilk sütun, ui/wide/Pivot.wide.tsx'ten yalnız lazyWide
//    ile; beklerken ve yükleme hatasında yığın yedektir; telefonda hiç indirilmez.
//  - Her iki biçimde üstte genel toplam. Planlanan / Gerçekleşen her yerde ayrı, asla tek sayıda birleşmez. Eksik plan
//    "Fiyat yok", eksik gerçek "Henüz yok", iki değer de yoksa hücre "Kayıt yok", sayı olmayan değer "Bilinmiyor".
//  - Yalnız sahipliği belirlenmiş (yaprak) satırlar toplanır; alt toplam satırı çocuklarıyla yeniden toplanmaz,
//    sahipsiz satır gösterilir ama toplanmaz; toplama girmeyenler toplamın altında adıyla yazılır (PivotStack.parts).
// antd Collapse kullanılmaz; bu dosya ve statik içe aktardıkları antd çekmez. Odak çizgisini admin.css çizer
// ([data-focus-line]); görsel kurallar PivotStack.css (yalnız --aile tokenları).

export type { PivotCell, PivotRow, PivotRowMeta, PivotRowRole } from './PivotStack.parts';

export interface PivotStackProps {
  /** Sütun adları (ör. proje aşamaları); hücreler bu sırayla okunur. */
  columns: string[];
  rows: PivotRow[];
  /** Üst satırda kısa özet ("6 oda · 4 aşama"). */
  caption?: string;
  /** Genel toplam başlığı; varsayılan "Genel toplam". */
  totalLabel?: string;
  /** İlk satır açık gelsin (AccordionList kuralı); varsayılan true. */
  firstOpen?: boolean;
  className?: string;
  /** Geniş tablonun ve kaydırma bölgesinin erişilebilir adı; varsayılan "Pivot tablo". */
  label?: string;
  /** Geniş tablonun köşe başlığı (ör. "Oda / Aşama"); varsayılan "Satır". */
  cornerLabel?: string;
}

const PIVOT_TABLO = 'Pivot tablo';
const SATIR = 'Satır';

const PivotTable = lazyWide('ui-pivot-tablo', () => import('./wide/Pivot.wide'));

export function PivotStack({
  columns, rows, caption, totalLabel = GENEL_TOPLAM, firstOpen = true, className, label = PIVOT_TABLO, cornerLabel = SATIR,
}: PivotStackProps) {
  const id = useId();
  const totalId = `${id}-toplam`;
  const device = useDevice();
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(rootRef);
  const summary = summarizePivot(columns, rows);
  const note = excludedNote(summary.excluded);
  const hasRows = rows.length > 0;
  // Masaüstünde tablo kendi bölgesinde yatay kayar; tablette yalnız kapsayıcıya sığıyorsa (README).
  const table = hasRows && (device === 'desktop' || (device === 'tablet' && width >= pivotTableMinWidth(columns.length)));

  const stack = <Stack columns={columns} rows={rows} caption={caption} firstOpen={firstOpen} summary={summary} idBase={id} />;

  return (
    <div ref={rootRef} className={['aile-pivot', className].filter(Boolean).join(' ')}>
      {hasRows ? (
        <div className="aile-pivot-total" role="group" aria-labelledby={totalId}>
          <span id={totalId} className="aile-pivot-total-label">{totalLabel}</span>
          <Pair value={summary.grand} />
        </div>
      ) : null}
      {note ? <p className="aile-pivot-not aile-kucuk aile-ikincil">{note}</p> : null}
      {table ? (
        <PivotTable columns={columns} rows={rows} summary={summary} caption={caption} label={label} cornerLabel={cornerLabel} wideFallback={stack} />
      ) : stack}
    </div>
  );
}

// --- Yığın (telefon temel sunumu) --------------------------------------------------------------------
interface StackProps {
  columns: readonly string[];
  rows: readonly PivotRow[];
  caption?: string;
  firstOpen: boolean;
  summary: PivotSummary;
  idBase: string;
}

function Stack({ columns, rows, caption, firstOpen, summary, idBase }: StackProps) {
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set(firstOpen && rows[0] ? [rows[0][0]] : []));
  const hasRows = rows.length > 0;
  const allOpen = hasRows && rows.every(([label]) => openKeys.has(label));

  const toggleRow = (label: string) => {
    setOpenKeys(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };
  const toggleAll = () => setOpenKeys(allOpen ? new Set() : new Set(rows.map(([label]) => label)));

  return (
    <>
      {caption || hasRows ? (
        <div className="aile-pivot-bar">
          {caption ? <p className="aile-pivot-caption aile-kucuk aile-ikincil">{caption}</p> : <span />}
          {hasRows ? <Button variant="quiet" onClick={toggleAll}>{allOpen ? 'Tümünü kapat' : 'Tümünü aç'}</Button> : null}
        </div>
      ) : null}

      {hasRows ? (
        <ul className="aile-pivot-rows" data-gorunum="yigin">
          {rows.map((row, index) => {
            const [label, cells] = row;
            const open = openKeys.has(label);
            const buttonId = `${idBase}-s${index}-baslik`;
            const panelId = `${idBase}-s${index}-icerik`;
            return (
              <li key={`${index}:${label}`} className="aile-pivot-row" data-rol={row[2]?.role ?? 'leaf'}>
                <button
                  type="button"
                  id={buttonId}
                  className="aile-pivot-head"
                  aria-expanded={open}
                  aria-controls={panelId}
                  data-focus-line=""
                  onClick={() => toggleRow(label)}
                  {...PRESS_HANDLERS}
                >
                  <span className="aile-pivot-title">
                    <span className="aile-pivot-title-ad">{label}</span>
                    {' '}
                    <RoleMark row={row} />
                  </span>
                  {' '}
                  <Pair value={summary.rowTotals[index]!} />
                  <Icon name="chevronDown" className="aile-pivot-chev" />
                </button>
                <div id={panelId} role="region" aria-labelledby={buttonId} className="aile-pivot-panel" hidden={!open} inert={!open}>
                  <div className="aile-pivot-inner">
                    <dl className="aile-pivot-cells">
                      {columns.map((column, j) => (
                        <div key={`${j}:${column}`} className="aile-pivot-cell">
                          <dt className="aile-pivot-cell-k">{column}</dt>
                          <dd className="aile-pivot-cell-v"><CellValue cell={cells[j]} /></dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="aile-pivot-bos aile-ikincil">{KAYIT_YOK}</p>
      )}
    </>
  );
}
