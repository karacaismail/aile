import { designTokens } from '../../design/tokens.ts';
import { sumMoney } from '../data/actuals';
import type { Money, RecordRow, StatusLabel } from '../shell/contracts';
import { Icon } from './icons';
import { PRESS_HANDLERS } from './Kanban.press';
import { BILINMIYOR, FIYAT_YOK, HENUZ_YOK, formatMoney } from './Money';
import { Tag } from './Tag';

// Kanban'ın telefon listesi (Kanban.tsx) ve geniş panosu (wide/Kanban.wide.tsx) için ortak, telefon-güvenli parçalar:
// grup kurma, grup başlığı (durum etiketi + "N kayıt" + planlanan toplam) ve kart. Geniş modül bunları statik içe
// aktarır; tersi yoktur (bu dosya *.wide çekmez). Tasarım: components/Kanban/README.md, bundle.js Kanban/KanbanCard.
//  - Başlık toplamı yalnız Planlanan'dır; Gerçekleşen toplama girmez (plan ve gerçek tek sayıda birleşmez). Toplam
//    data/actuals sumMoney ile kesin ondalıkta (bigint), para birimine göre ayrı; fiyatsız ve bozuk tutar sayıyla.
//  - Kart yerel <button>: ad, kod · oda ("Bilinmiyor"), 56 px yalnız doğrulanmış fotoğraf ya da "Fotoğraf yok",
//    Planlanan ("Fiyat yok") ve Gerçekleşen ("Henüz yok") ayrı, ödeme etiketi. İçerik yalnız phrasing öğeleri.
//    Seçili kart aria-current="true" (seçim odaktan ayrıdır). Basılı geri bildirim Pointer Events ile (Kanban.press).
// Görsel kurallar Kanban.css (yalnız --aile tokenları); odak çizgisini admin.css çizer ([data-focus-line]).

export const KANBAN_ETIKET = 'Tedarik durumuna göre alımlar';
export const FOTOGRAF_YOK = 'Fotoğraf yok';
export const BOS_SUTUN = 'Bu durumda kayıt yok.';
export const PLANLANAN = 'Planlanan';
export const GERCEKLESEN = 'Gerçekleşen';
export const ODEME = 'Ödeme';

/** Liste ve pano ızgarasının ortak girdisi (geniş pano bu alt kümeyle çizer; adlı bölge Kanban.tsx'tedir). */
export interface KanbanBoardProps {
  items: readonly RecordRow[];
  columns?: readonly StatusLabel[];
  selectedKey?: string;
  onOpen?(row: RecordRow): void;
}

// --- Gruplar ----------------------------------------------------------------------------------------
export interface KanbanColumn extends StatusLabel { rows: RecordRow[] }

/** Verilen sıra önce (boş sütunlar dahil), sonra kayıtlarda ilk görülen durumlar. Durum etiketine göre tekil. */
export function buildColumns(items: readonly RecordRow[], columns?: readonly StatusLabel[]): KanbanColumn[] {
  const byLabel = new Map<string, KanbanColumn>();
  const order: KanbanColumn[] = [];
  const add = (status: StatusLabel) => {
    const column: KanbanColumn = { label: status.label, tone: status.tone, rows: [] };
    byLabel.set(status.label, column);
    order.push(column);
    return column;
  };
  for (const status of columns ?? []) if (!byLabel.has(status.label)) add(status);
  for (const row of items) (byLabel.get(row.status.label) ?? add(row.status)).rows.push(row);
  return order;
}

/** "Planlanan ₺26.500,00 · 1 fiyatsız"; para birimleri ilk görülme sırasıyla ayrı; hiç fiyat yoksa "Planlanan: fiyat yok". */
export function plannedTotalText(rows: readonly RecordRow[]): string {
  const byCurrency = new Map<string, Money[]>();
  let unpriced = 0;
  for (const row of rows) {
    if (!row.planned) { unpriced += 1; continue; }
    const currency = row.planned.currency.trim().toUpperCase();
    const group = byCurrency.get(currency) ?? [];
    group.push(row.planned);
    byCurrency.set(currency, group);
  }
  const parts: string[] = [];
  for (const group of byCurrency.values()) {
    const total = sumMoney(group);
    unpriced += total.missing;
    if (total.money) parts.push(formatMoney(total.money));
  }
  if (parts.length === 0) return `${PLANLANAN}: fiyat yok`;
  return `${PLANLANAN} ${parts.join(' · ')}${unpriced > 0 ? ` · ${unpriced} fiyatsız` : ''}`;
}

/** Bölgede son odaklanan kartın kayıt id'si (DOM verisi; React yönetmez). Liste → pano geçişinde odak bununla korunur. */
export const ODAK_KAYIT = 'odakKayit';

/** Bölgedeki odak olayından son odaklanan kartı kaydeder; kart dışı odakta siler. */
export function rememberFocusedCard(region: HTMLElement, target: EventTarget | null) {
  const card = target instanceof Element ? target.closest('[data-kanban-kayit]') : null;
  const id = card && region.contains(card) ? card.getAttribute('data-kanban-kayit') : null;
  if (id) region.dataset[ODAK_KAYIT] = id;
  else delete region.dataset[ODAK_KAYIT];
}

/** Yeni ızgara bağlanınca: odak kaybolmuşsa (eski kart söküldü, odak body) aynı kaydın kartına döner. */
export function restoreFocusedCard(grid: HTMLElement) {
  const region = grid.closest<HTMLElement>('[data-gorunum]');
  const id = region?.dataset[ODAK_KAYIT];
  const active = document.activeElement;
  if (!id || (active && active !== document.body)) return;
  const card = Array.from(grid.querySelectorAll<HTMLElement>('[data-kanban-kayit]')).find(element => element.getAttribute('data-kanban-kayit') === id);
  card?.focus({ preventScroll: true });
}

/** Grup başlığı: h3 (durum etiketi tonuyla + "N kayıt") ve planlanan toplam. */
export function KanbanColumnHeader({ column, headingId }: { column: KanbanColumn; headingId: string }) {
  return (
    <header className="aile-kanban-sutun-baslik">
      <h3 id={headingId} className="aile-kanban-sutun-ad">
        <Tag tone={column.tone}>{column.label}</Tag>
        {' '}
        <span className="aile-kanban-sutun-sayi">{column.rows.length} kayıt</span>
      </h3>
      <span className="aile-kanban-sutun-toplam">{plannedTotalText(column.rows)}</span>
    </header>
  );
}

// --- Kart -------------------------------------------------------------------------------------------
function Photo({ photo }: { photo: RecordRow['photo'] }) {
  // Doğrulanmamış görsel çizilmez (başka ürünün resmi olabilir); yuva süsleyicidir, "Fotoğraf yok" ayrıca yazılır.
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

export interface KanbanCardProps {
  row: RecordRow;
  selected: boolean;
  onOpen?(row: RecordRow): void;
  /** Kart adının id'si: kartın yanındaki eylemler (ör. "Durumu değiştir") açıklama olarak bağlanır. */
  titleId?: string;
}

export function KanbanCard({ row, selected, onOpen, titleId }: KanbanCardProps) {
  const hasPhoto = !!row.photo?.verified;
  const payment = row.payment ?? { label: BILINMIYOR, tone: 'notr' as const };
  return (
    <button
      type="button"
      className="aile-kanban-kart"
      data-focus-line=""
      aria-current={selected ? 'true' : undefined}
      data-kanban-kayit={row.id}
      onClick={onOpen ? () => onOpen(row) : undefined}
      {...PRESS_HANDLERS}
    >
      <span className="aile-kanban-kart-ust">
        <Photo photo={row.photo} />
        <span className="aile-kanban-kart-ana">
          <span id={titleId} className="aile-kanban-kart-ad">{row.label}</span>
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
