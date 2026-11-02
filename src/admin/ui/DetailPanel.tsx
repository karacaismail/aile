import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useDevice } from '../device';
import type { DetailPanelProps as DetailPanelContract, Money as MoneyValue, StatusLabel, Tone } from '../shell/contracts';
import { Button } from './Button';
import { Drawer } from './Drawer';
import { Icon } from './icons';
import { Money, formatMoney } from './Money';
import { Select } from './Select';
import { StatusText } from './StatusText';
import './DetailPanel.css';

// Tasarım: components/DetailPanel/README.md + envanter.md (DetailPanel satırları) + bundle.js DetailPanel (ai-detail).
// Bir kaydın ayrıntısı. Masaüstünde sağdan 384 px çekmece (Drawer; h2 = kayıt adı, görünür "Kapat", Escape ve örtü
// kapatır, odak çekmeceye girer ve açan öğeye döner). Tablet ve telefonda tam sayfa: <section role="dialog" aria-modal>
// kayıt adını taşıyan h2 ile adlandırılır, üstte "Listeye dön", Escape onClose. Sıra sabit (README):
//   1 kimlik + fotoğraf  2 Plan | Gerçek (iki ayrı sütun; fark sözcükle)  3 Durum ve eylemler  4 Bağlı kayıtlar
//   5 Kaynak ve değişiklik izi (dl).
// İçerik ilkeleri: para ₺8.500,00 (ui/Money: tr-TR, iki ondalık, tabular-nums), tarih 28.10.2026, eksik bilgi adıyla
// ("Fiyat yok", "Henüz yok", "Bilinmiyor", "Fotoğraf yok"), plan ve gerçek tek sayıda birleşmez, durum sözcükle
// (StatusText), doğrulanmamış fotoğraf asla gösterilmez. Değişiklik izi bu dilimde props'ta yok (contracts: source);
// uydurulmaz, yalnız kaynak satırları yazılır. Görsel kurallar DetailPanel.css (yalnız --aile tokenları).
// Sözleşme: shell/contracts.ts DetailPanelProps (row, related, source, onClose, onChangeStatus, onUndo); burada
// yalnız isteğe bağlı eklentiler: statusOptions (Select seçenekleri), onPhotoAdd ("Fotoğraf ekle"), inline (test/önizleme).

export interface DetailPanelProps extends DetailPanelContract {
  /** "Durumu değiştir" seçenekleri (iş akışından). onChangeStatus verilmişse ve bu boşsa düğme devre dışıdır, nedeni yazılır. */
  statusOptions?: readonly StatusLabel[];
  /** "Fotoğraf ekle" eylemi; verilmezse düğme çizilmez ("Fotoğraf yok" alanı kalır). */
  onPhotoAdd?(): void;
  /** Geniş ekranda çekmeceyi portal yerine yerinde çizer (önizleme ve yalıtık test). */
  inline?: boolean;
}

const BACK_LABEL = 'Listeye dön';
const PLAN_ACTUAL_LABEL = 'Plan ve gerçek';
const NO_PRICE = 'Fiyat yok';
const NOT_YET = 'Henüz yok';
const UNKNOWN = 'Bilinmiyor';
const NO_PHOTO = 'Fotoğraf yok';
const NO_PHOTO_NOTE = 'Doğrulanmış fotoğraf eklenene kadar görsel gösterilmez.';
const VERIFIED_PHOTO = 'Doğrulanmış fotoğraf';
const ADD_PHOTO = 'Fotoğraf ekle';
const CHANGE_STATUS = 'Durumu değiştir';
const NO_STATUS_OPTIONS = 'Seçilebilir durum yok';
const UNDO = 'Geri al';
const RELATED_HEADING = 'Bağlı kayıtlar';
const NO_RELATED = 'Bağlı kayıt yok';
const SOURCE_HEADING = 'Kaynak ve değişiklik izi';
const NO_SOURCE = 'Kaynak bilgisi yok';

// --- Biçimleme ----------------------------------------------------------------------------------------
/** ISO (2026-10-28 ya da 2026-10-28T14:05:00Z) → 28.10.2026; başka biçim olduğu gibi kalır. */
export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  return match ? `${match[3]}.${match[2]}.${match[1]}` : iso;
}

/** Kuruş cinsinden tam sayı; ondalık metin ("1234.50") ikili kayan nokta hatasına düşmez. */
const toMinor = (amount: string) => Math.round(Number(amount) * 100);

export interface Difference { text: string; tone: Tone }

/** Plan ile gerçek farkı sözcükle. İkisi de yoksa yazılmaz (null); para birimleri farklıysa hesaplanmaz, nedeni yazılır. */
export function differenceText(planned: MoneyValue | null, actual: MoneyValue | null): Difference | null {
  if (!planned || !actual) return null;
  if (planned.currency !== actual.currency) {
    return { text: `Fark bilinmiyor: para birimleri farklı (${planned.currency}, ${actual.currency})`, tone: 'notr' };
  }
  const plannedMinor = toMinor(planned.amount);
  const actualMinor = toMinor(actual.amount);
  if (!Number.isFinite(plannedMinor) || !Number.isFinite(actualMinor)) return null;
  const diff = actualMinor - plannedMinor;
  if (diff === 0) return { text: 'Planla aynı', tone: 'notr' };
  const abs = formatMoney({ amount: (Math.abs(diff) / 100).toFixed(2), currency: planned.currency });
  return diff < 0 ? { text: `Planın altında: ${abs}`, tone: 'olumlu' } : { text: `Planın üstünde: ${abs}`, tone: 'uyari' };
}

// --- Parçalar -----------------------------------------------------------------------------------------
const Missing = ({ children }: { children: string }) => <span className="aile-detail-eksik">{children}</span>;

function DateValue({ iso }: { iso?: string }) {
  return iso ? <span className="aile-detail-tarih">{formatDate(iso)}</span> : <Missing>{UNKNOWN}</Missing>;
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="aile-detail-olgu">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// --- Bileşen ------------------------------------------------------------------------------------------
export function DetailPanel({ row, related = [], source = [], onClose, onChangeStatus, onUndo, statusOptions = [], onPhotoAdd, inline }: DetailPanelProps) {
  const device = useDevice();
  const narrow = device !== 'desktop';
  const id = useId();
  const headingId = `aile-detail-baslik${id}`;
  const relatedId = `aile-detail-baglar${id}`;
  const noOptionsId = `aile-detail-durum-not${id}`;

  // Dar ekranda tam sayfa diyalog: açılınca odak diyaloğun başına girer (tabIndex -1), Escape kapatır.
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (narrow) root.current?.focus({ preventScroll: true });
  }, [narrow, row.id]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };

  // Doğrulanmamış görsel asla gösterilmez (README: başka ürünün resmi asla gösterilmez).
  const photo = row.photo && row.photo.verified ? row.photo : null;
  const difference = differenceText(row.planned, row.actual);
  const currentStatusIndex = statusOptions.findIndex(option => option.label === row.status.label);

  const identity = (
    <section className="aile-detail-sec aile-detail-kimlik">
      <div className="aile-detail-id">
        <span className="aile-detail-meta">{row.category ? `${row.code} · ${row.category}` : row.code}</span>
        {narrow && <h2 id={headingId} className="aile-detail-baslik">{row.label}</h2>}
        <span className="aile-detail-meta">{`Oda: ${row.room ?? UNKNOWN} · Sorumlu: ${row.owner ?? UNKNOWN}`}</span>
      </div>
      {photo ? (
        <figure className="aile-detail-foto">
          <img src={photo.url} alt={`${row.label} fotoğrafı`} />
          <figcaption className="aile-detail-meta">{VERIFIED_PHOTO}</figcaption>
        </figure>
      ) : (
        <div className="aile-detail-fotoyok">
          <Icon name="imageOff" />
          <strong>{NO_PHOTO}</strong>
          <span className="aile-detail-meta">{NO_PHOTO_NOTE}</span>
          {onPhotoAdd && <Button variant="secondary" icon="plus" onClick={onPhotoAdd}>{ADD_PHOTO}</Button>}
        </div>
      )}
    </section>
  );

  const planActual = (
    <section className="aile-detail-sec" aria-label={PLAN_ACTUAL_LABEL}>
      <div className="aile-detail-pg">
        <div className="aile-detail-pg-col">
          <h3>Plan</h3>
          <dl>
            <Fact term="Tutar"><Money value={row.planned} label={NO_PRICE} /></Fact>
            <Fact term="Hedef tarih"><DateValue iso={row.dates?.planned} /></Fact>
          </dl>
        </div>
        <div className="aile-detail-pg-col">
          <h3>Gerçek</h3>
          <dl>
            <Fact term="Tutar"><Money value={row.actual} label={NOT_YET} /></Fact>
            <Fact term="Sipariş"><DateValue iso={row.dates?.ordered} /></Fact>
            <Fact term="Teslim"><DateValue iso={row.dates?.delivered} /></Fact>
            <Fact term="Ödeme"><DateValue iso={row.dates?.paid} /></Fact>
          </dl>
        </div>
      </div>
      {difference && <p className={`aile-detail-fark aile-detail-fark--${difference.tone}`}>{difference.text}</p>}
    </section>
  );

  const statusActions = (
    <section className="aile-detail-sec">
      <h3>Durum ve eylemler</h3>
      <dl className="aile-detail-durumlar">
        <Fact term="Durum"><StatusText label={row.status.label} tone={row.status.tone} /></Fact>
        <Fact term="Ödeme">{row.payment ? <StatusText label={row.payment.label} tone={row.payment.tone} /> : <Missing>{UNKNOWN}</Missing>}</Fact>
        <Fact term="Veri güveni">{row.confidence ?? <Missing>{UNKNOWN}</Missing>}</Fact>
      </dl>
      {(onChangeStatus || onUndo) && (
        <div className="aile-detail-eylemler">
          {onChangeStatus && (statusOptions.length > 0 ? (
            <Select
              label={CHANGE_STATUS}
              className="aile-detail-durum-sec"
              options={statusOptions.map((option, index) => ({ value: String(index), label: option.label }))}
              value={currentStatusIndex >= 0 ? String(currentStatusIndex) : undefined}
              onChange={value => {
                const next = statusOptions[Number(value)];
                if (next) onChangeStatus(next);
              }}
            />
          ) : (
            <>
              <Button disabled aria-describedby={noOptionsId}>{CHANGE_STATUS}</Button>
              <p id={noOptionsId} className="aile-detail-meta">{NO_STATUS_OPTIONS}</p>
            </>
          ))}
          {onUndo && <Button variant="quiet" icon="undo" onClick={onUndo}>{UNDO}</Button>}
        </div>
      )}
    </section>
  );

  const relatedRecords = (
    <section className="aile-detail-sec">
      <h3 id={relatedId}>{RELATED_HEADING}</h3>
      {related.length > 0 ? (
        <ul className="aile-detail-baglar" aria-labelledby={relatedId}>
          {related.map(link => (
            <li key={`${link.href}#${link.label}`}>
              <a className="aile-detail-bag" href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="aile-detail-eksik aile-detail-not">{NO_RELATED}</p>
      )}
    </section>
  );

  const sourceTrail = (
    <section className="aile-detail-sec">
      <h3>{SOURCE_HEADING}</h3>
      {source.length > 0 ? (
        <dl className="aile-detail-kaynak">
          {source.map(entry => <Fact key={entry.label} term={entry.label}>{entry.value}</Fact>)}
        </dl>
      ) : (
        <p className="aile-detail-eksik aile-detail-not">{NO_SOURCE}</p>
      )}
    </section>
  );

  const body = (
    <>
      {identity}
      {planActual}
      {statusActions}
      {relatedRecords}
      {sourceTrail}
    </>
  );

  if (narrow) {
    return (
      <section
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="aile-detail aile-detail--dar"
        data-record={row.id}
        onKeyDown={onKeyDown}
      >
        <div className="aile-detail-bar">
          <Button variant="quiet" icon="back" onClick={onClose}>{BACK_LABEL}</Button>
        </div>
        {body}
      </section>
    );
  }

  return (
    <Drawer title={row.label} onClose={onClose} inline={inline} className="aile-detail aile-detail--genis">
      {body}
    </Drawer>
  );
}
