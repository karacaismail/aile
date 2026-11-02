import { useId } from 'react';
import { designTokens } from '../../design/tokens.ts';
import { useDevice } from '../device';
import type { Money, RecordRow, StatusLabel } from '../shell/contracts';
import { Icon } from './icons';
import { BILINMIYOR, FIYAT_YOK, HENUZ_YOK, formatMoney } from './Money';
import { Tag } from './Tag';
import './Kanban.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Kanban/README.md + index.d.ts KanbanProps; referans davranış
// bundle.js Kanban/KanbanCard (KOLONLAR, para, Tutar, Photo). Kayıtları tedarik durumuna göre sütunlara dizer.
//  - Sütun: durum etiketi (Tag, tonuyla) + "N kayıt" + sütunun planlanan toplamı; fiyatsız kayıt sayısı ayrıca yazılır
//    ("Planlanan ₺26.500,00 · 1 fiyatsız"); hiç fiyat yoksa "Planlanan: fiyat yok". Gerçekleşen toplama girmez: plan ve
//    gerçek asla tek sayıda birleşmez. Toplam kuruş tam sayısıyla, para birimine göre ayrı hesaplanır.
//  - Kart: 56 px fotoğraf yalnız verified ise (başka ürünün resmi asla), değilse yuva + "Fotoğraf yok"; ad; kod · oda
//    (oda yoksa "Bilinmiyor"); Planlanan ("Fiyat yok") ve Gerçekleşen ("Henüz yok") ayrı; ödeme etiketi ("Ödeme: …").
//    Kart yerel <button>: tıklama ve Enter/Space onOpen(kayıt); içeriği yalnız phrasing öğeleri (geçerli HTML).
//    Seçili kart (selectedKey = id) aria-current="true": secili yüzey + 600 ağırlık (Kanban.css). Seçim odaktan ayrıdır.
//  - Pano role="region", sekme sırasında (yatay kaydırma klavyeyle de yapılabilsin); kendi içinde yatay kayar, sayfa
//    kaymaz. Telefonda (useDevice 'phone' ya da narrow) 264 px sütun + scroll-snap; geniş ekranda 248 px.
//  - Sürükleme yok: durumu değiştirme ayrıntıdaki "Durumu değiştir" eyleminin işidir (README).
// Görsel kurallar Kanban.css (yalnız --aile tokenları); odak çizgisini admin.css çizer ([data-focus-line]).
// Para biçimi tek kaynaktan: ui/Money formatMoney (tr-TR, 2 ondalık, ₺ önde, bozuk tutar "Bilinmiyor"). Kanban yalnız
// sütun toplamını hesaplar (kuruş tam sayısı, para birimine göre ayrı) ve biçimlemeyi Money'ye bırakır.

export interface KanbanProps {
  items: readonly RecordRow[];
  /** Sütun sırası (tedarik durumu sözlüğü). Verilmezse kayıtların durumundan ilk görülme sırasıyla türetilir;
   *  boş sütun yalnız burada verilince çizilir ("Bu durumda kayıt yok."). */
  columns?: readonly StatusLabel[];
  /** Seçili (ayrıntısı açık) kaydın id'si. */
  selectedKey?: string;
  /** Kart tıklaması ya da Enter/Space. */
  onOpen?(row: RecordRow): void;
  /** Dar biçimi zorlar (264 px sütun, scroll-snap); verilmezse useDevice() === 'phone'. */
  narrow?: boolean;
  /** Panonun erişilebilir adı. */
  label?: string;
  className?: string;
}

export const KANBAN_ETIKET = 'Tedarik durumuna göre alımlar';
const FOTOGRAF_YOK = 'Fotoğraf yok';
const BOS_SUTUN = 'Bu durumda kayıt yok.';
const PLANLANAN = 'Planlanan';
const GERCEKLESEN = 'Gerçekleşen';
const ODEME = 'Ödeme';

// --- Toplam -----------------------------------------------------------------------------------------
/** Ondalık metni kuruşa (tam sayı) çevirir; sayı değilse null. Toplam kayan noktada değil kuruşta tutulur. */
function toMinor(amount: string): number | null {
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Kuruş toplamını platform ondalık metnine çevirir ("2650000" → "26500.00"); biçimlemeyi Money yapar. */
const minorToMoney = (minor: number, currency: string): Money => ({ amount: (minor / 100).toFixed(2), currency });

/** Sütun başlığının toplam satırı: yalnız planlanan, para birimine göre ayrı; fiyatsızlar (ve sayı olmayan tutarlar) sayıyla. */
function plannedTotal(rows: readonly RecordRow[]): string {
  const perCurrency = new Map<string, number>();
  let unpriced = 0;
  for (const row of rows) {
    const minor = row.planned === null ? null : toMinor(row.planned.amount);
    if (row.planned === null || minor === null) { unpriced += 1; continue; }
    perCurrency.set(row.planned.currency, (perCurrency.get(row.planned.currency) ?? 0) + minor);
  }
  if (perCurrency.size === 0) return `${PLANLANAN}: fiyat yok`;
  const parts = [...perCurrency.entries()].map(([currency, minor]) => formatMoney(minorToMoney(minor, currency)));
  const unpricedPart = unpriced > 0 ? ` · ${unpriced} fiyatsız` : '';
  return `${PLANLANAN} ${parts.join(' · ')}${unpricedPart}`;
}

// --- Sütunlar ---------------------------------------------------------------------------------------
interface Column extends StatusLabel { rows: RecordRow[] }

function buildColumns(items: readonly RecordRow[], columns?: readonly StatusLabel[]): Column[] {
  const byLabel = new Map<string, Column>();
  const order: Column[] = [];
  const add = (status: StatusLabel) => {
    const column: Column = { label: status.label, tone: status.tone, rows: [] };
    byLabel.set(status.label, column);
    order.push(column);
    return column;
  };
  for (const status of columns ?? []) if (!byLabel.has(status.label)) add(status);
  for (const row of items) {
    const column = byLabel.get(row.status.label) ?? add(row.status);
    column.rows.push(row);
  }
  return order;
}

// --- Kart -------------------------------------------------------------------------------------------
function Photo({ photo }: { photo: RecordRow['photo'] }) {
  // Doğrulanmamış görsel çizilmez; yuva süsleyicidir, "Fotoğraf yok" metni kartta ayrıca yazılır.
  if (photo && photo.verified) {
    return <img className="aile-kanban-foto" src={photo.url} alt="" width={designTokens.fotografListe} height={designTokens.fotografListe} />;
  }
  return (
    <span className="aile-kanban-foto aile-kanban-foto--yok" aria-hidden="true">
      <Icon name="imageOff" />
    </span>
  );
}

function Amount({ caption, money, missing }: { caption: string; money: Money | null; missing: string }) {
  return (
    <span className="aile-kanban-tutar">
      <span className="aile-kanban-tutar-etiket">{caption}</span>
      {money ? <span className="aile-kanban-tutar-deger">{formatMoney(money, missing)}</span> : <span className="aile-kanban-eksik">{missing}</span>}
    </span>
  );
}

function KanbanCard({ row, selected, onOpen }: { row: RecordRow; selected: boolean; onOpen?: (row: RecordRow) => void }) {
  const hasPhoto = !!row.photo?.verified;
  const payment = row.payment ?? { label: BILINMIYOR, tone: 'notr' as const };
  return (
    <button
      type="button"
      className="aile-kanban-kart"
      data-focus-line=""
      aria-current={selected ? 'true' : undefined}
      onClick={onOpen ? () => onOpen(row) : undefined}
    >
      <span className="aile-kanban-kart-ust">
        <Photo photo={row.photo} />
        <span className="aile-kanban-kart-ana">
          <span className="aile-kanban-kart-ad">{row.label}</span>
          <span className="aile-kanban-kart-meta">{row.code} · {row.room ?? BILINMIYOR}</span>
          {!hasPhoto && <span className="aile-kanban-kart-fotoyok">{FOTOGRAF_YOK}</span>}
        </span>
      </span>
      <span className="aile-kanban-kart-tutarlar">
        <Amount caption={PLANLANAN} money={row.planned} missing={FIYAT_YOK} />
        <Amount caption={GERCEKLESEN} money={row.actual} missing={HENUZ_YOK} />
      </span>
      <span className="aile-kanban-kart-etiketler">
        <Tag tone={payment.tone}>{`${ODEME}: ${payment.label}`}</Tag>
      </span>
    </button>
  );
}

// --- Pano -------------------------------------------------------------------------------------------
export function Kanban({ items, columns, selectedKey, onOpen, narrow, label = KANBAN_ETIKET, className }: KanbanProps) {
  const device = useDevice();
  const dar = narrow ?? device === 'phone';
  const baseId = useId();
  const board = buildColumns(items, columns);
  const classes = ['aile-kanban', dar && 'aile-kanban--dar', className].filter(Boolean).join(' ');

  return (
    <div className={classes} role="region" aria-label={label} data-device={device} tabIndex={0}>
      {board.map((column, index) => {
        const headingId = `${baseId}-sutun-${index}`;
        return (
          <section key={column.label} className="aile-kanban-sutun" aria-label={column.label}>
            <header className="aile-kanban-sutun-baslik">
              <h3 id={headingId} className="aile-kanban-sutun-ad">
                <Tag tone={column.tone}>{column.label}</Tag>
                <span className="aile-kanban-sutun-sayi">{column.rows.length} kayıt</span>
              </h3>
              <span className="aile-kanban-sutun-toplam">{plannedTotal(column.rows)}</span>
            </header>
            {column.rows.length > 0 ? (
              <ul className="aile-kanban-kartlar" aria-labelledby={headingId}>
                {column.rows.map(row => (
                  <li key={row.id}>
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
