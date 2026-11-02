import { useId, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Icon } from './icons';
import './PivotStack.css';

// Tasarım › components/PivotStack/README.md + index.d.ts PivotStackProps; referans davranış bundle.js PivotStack
// (AccordionList üstüne kurulu). Pivotun telefondaki biçimi (tablette tablo sığmazsa da bu): satır boyutu dış katman,
// sütun değerleri açılınca alt alta. Üstte genel toplam; her satırın kapalı başlığında satır toplamı; her hücre
// Planlanan / Gerçekleşen ayrı, asla tek sayıda birleşmez. Eksik plan "Fiyat yok", eksik gerçek "Henüz yok",
// iki değer de yoksa hücre "Kayıt yok". Para ₺8.500,00 (tr-TR, 2 ondalık, tabular). İlk satır açık gelir; birden çok
// satır açık kalabilir; üstte "Tümünü aç / kapat". Satır başlığı APG disclosure (aria-expanded/controls, kapalı bölge
// hidden+inert) — ui/Disclosure başlığı tek satır metin + kısa sayım taşır, iki satırlık Planlanan/Gerçekleşen çifti
// 320 px'te oraya sığmaz; aynı işaretleme ve 240 ms tek eğri burada kurulur. antd Collapse kullanılmaz.
// Odak çizgisini admin.css çizer ([data-focus-line]); görsel kurallar PivotStack.css (yalnız --aile tokenları).

/** Bir hücre: [planlanan, gerçekleşen]; null = o değer yok. Tutarlar TRY, sayı olarak. */
export type PivotCell = [plan: number | null, actual: number | null];
/** Bir satır: [satır adı, sütun sırasıyla hücreler]. */
export type PivotRow = [label: string, cells: PivotCell[]];

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
}

const PLANLANAN = 'Planlanan';
const GERCEKLESEN = 'Gerçekleşen';
const FIYAT_YOK = 'Fiyat yok';
const HENUZ_YOK = 'Henüz yok';
const KAYIT_YOK = 'Kayıt yok';
const GENEL_TOPLAM = 'Genel toplam';

// ui/Money henüz stub; aynı biçim (₺8.500,00) burada yerel. Money gelince tek kaynağa bağlanır.
const TRY_FORMAT = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Bilinen değerleri toplar; hiç değer yoksa null kalır (₺0,00 yazılmaz, adıyla "Fiyat yok" / "Henüz yok" denir). */
function sumCells(cells: readonly PivotCell[]): PivotCell {
  let plan: number | null = null;
  let actual: number | null = null;
  for (const [p, a] of cells) {
    if (p != null) plan = (plan ?? 0) + p;
    if (a != null) actual = (actual ?? 0) + a;
  }
  return [plan, actual];
}

function Amount({ value, missing }: { value: number | null; missing: string }): ReactNode {
  if (value == null) return <span className="aile-pivot-eksik">{missing}</span>;
  return <span className="aile-tutar">{TRY_FORMAT.format(value)}</span>;
}

/** Planlanan ve Gerçekleşen alt alta, ikisi de adıyla; renk ya da konum tek işaret değil. */
function Pair({ value }: { value: PivotCell }) {
  return (
    <span className="aile-pivot-pair">
      <span className="aile-pivot-pair-line">
        <span className="aile-pivot-k aile-kucuk">{PLANLANAN}</span> <Amount value={value[0]} missing={FIYAT_YOK} />
      </span>
      {' '}
      <span className="aile-pivot-pair-line">
        <span className="aile-pivot-k aile-kucuk">{GERCEKLESEN}</span> <Amount value={value[1]} missing={HENUZ_YOK} />
      </span>
    </span>
  );
}

export function PivotStack({ columns, rows, caption, totalLabel = GENEL_TOPLAM, firstOpen = true, className }: PivotStackProps) {
  const id = useId();
  const totalId = `${id}-toplam`;
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set(firstOpen && rows[0] ? [rows[0][0]] : []));

  const hasRows = rows.length > 0;
  const allOpen = hasRows && rows.every(([label]) => openKeys.has(label));
  const grand = sumCells(rows.map(([, cells]) => sumCells(cells)));

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
    <div className={['aile-pivot', className].filter(Boolean).join(' ')}>
      {hasRows ? (
        <div className="aile-pivot-total" role="group" aria-labelledby={totalId}>
          <span id={totalId} className="aile-pivot-total-label">{totalLabel}</span>
          <Pair value={grand} />
        </div>
      ) : null}

      {caption || hasRows ? (
        <div className="aile-pivot-bar">
          {caption ? <p className="aile-pivot-caption aile-kucuk aile-ikincil">{caption}</p> : <span />}
          {hasRows ? (
            <Button variant="quiet" onClick={toggleAll}>{allOpen ? 'Tümünü kapat' : 'Tümünü aç'}</Button>
          ) : null}
        </div>
      ) : null}

      {hasRows ? (
        <ul className="aile-pivot-rows">
          {rows.map(([label, cells], index) => {
            const open = openKeys.has(label);
            const buttonId = `${id}-s${index}-baslik`;
            const panelId = `${id}-s${index}-icerik`;
            return (
              <li key={label} className="aile-pivot-row">
                <button
                  type="button"
                  id={buttonId}
                  className="aile-pivot-head"
                  aria-expanded={open}
                  aria-controls={panelId}
                  data-focus-line=""
                  onClick={() => toggleRow(label)}
                >
                  <span className="aile-pivot-title">{label}</span>
                  {' '}
                  <Pair value={sumCells(cells)} />
                  <Icon name="chevronDown" className="aile-pivot-chev" />
                </button>
                <div id={panelId} role="region" aria-labelledby={buttonId} className="aile-pivot-panel" hidden={!open} inert={!open}>
                  <div className="aile-pivot-inner">
                    <dl className="aile-pivot-cells">
                      {columns.map((column, j) => {
                        const cell = cells[j] ?? [null, null];
                        const empty = cell[0] == null && cell[1] == null;
                        return (
                          <div key={column} className="aile-pivot-cell">
                            <dt className="aile-pivot-cell-k">{column}</dt>
                            <dd className="aile-pivot-cell-v">
                              {empty ? <span className="aile-pivot-eksik">{KAYIT_YOK}</span> : <Pair value={cell} />}
                            </dd>
                          </div>
                        );
                      })}
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
    </div>
  );
}
