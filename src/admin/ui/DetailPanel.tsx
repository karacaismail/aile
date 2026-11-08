import { useEffect, useId, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useDevice } from '../device';
import type { DetailPanelProps as DetailPanelContract, Money as MoneyValue, StatusLabel, Tone } from '../shell/contracts';
import { Button } from './Button';
import { useVisualViewportInsets } from './FormFooter.viewport';
import { Icon } from './icons';
import { Money, formatMoney } from './Money';
import { Select } from './Select';
import { StatusText } from './StatusText';
import './DetailPanel.css';

// Tasarım: components/DetailPanel/README.md + envanter.md (DetailPanel satırları) + bundle.js DetailPanel (ai-detail).
// Bir kaydın ayrıntısı; antd çekmecesi yok, tek yerel uygulama (telefon profili antd istemez).
//  - Telefon ve tablet (envanter: tam sayfa): ekranı kaplayan modal katman <section role="dialog" aria-modal>. Üstte
//    "Listeye dön" çubuğu, ortada kendi içinde kayan içerik, altta isteğe bağlı eylem altlığı (footer, genelde
//    FormFooter). Güvenli alanlar (safe-area-inset-*) katmanın iç boşluğudur; sanal klavye açıkken katman görsel görünüm
//    alanına sığar (FormFooter.viewport.ts), böylece altlık klavyenin üstünde kalır.
//  - Masaüstü: sağda ayrinti-genislik (384 px) panel; başlık h2 = kayıt adı + görünür "Kapat". inline verilirse liste
//    yanında akışta, modal değil (liste kullanılabilir kalır); verilmezse örtülü (ortu) modal katman, örtü tıklaması kapatır.
//  - Odak: açılınca diyaloğun köküne (tabIndex -1) girer; modalda Tab/Shift+Tab katmanda döner; Escape kapatır (portallı
//    alt katmandan ya da açık combobox'tan gelen Escape o katmanındır). Kapanınca (sökülünce) odak returnFocusTo'ya, yoksa
//    açıldığı anda odaklı olan öğeye döner; odak bu arada panel dışında başka bir öğeye taşındıysa dokunulmaz.
// Sıra sabit (README): 1 kimlik + fotoğraf  2 Plan | Gerçek (iki ayrı sütun; fark sözcükle)  3 Durum ve eylemler
//   4 Bağlı kayıtlar  5 Kaynak ve değişiklik izi (dl).
// İçerik ilkeleri: para ₺8.500,00 (ui/Money: tr-TR, iki ondalık, tabular-nums), tarih 28.10.2026, eksik bilgi adıyla
// ("Fiyat yok", "Henüz yok", "Bilinmiyor", "Fotoğraf yok"), plan ve gerçek tek sayıda birleşmez, durum sözcükle
// (StatusText), doğrulanmamış fotoğraf asla gösterilmez. Değişiklik izi bu dilimde props'ta yok (contracts: source);
// uydurulmaz, yalnız kaynak satırları yazılır. Görsel kurallar DetailPanel.css (yalnız --aile tokenları). Hareket yok:
// açılış/kapanış anlıktır (yalnız girişte oynayan geçiş yasak; sökülen katmanın çıkış yaşam döngüsü yok).
// Sözleşme: shell/contracts.ts DetailPanelProps (row, related, source, onClose, onChangeStatus, onUndo); burada
// yalnız isteğe bağlı eklentiler: statusOptions, onPhotoAdd, inline, footer, returnFocusTo.

export interface DetailPanelProps extends DetailPanelContract {
  /** "Durumu değiştir" seçenekleri (iş akışından). onChangeStatus verilmişse ve bu boşsa düğme devre dışıdır, nedeni yazılır. */
  statusOptions?: readonly StatusLabel[];
  /** "Fotoğraf ekle" eylemi; verilmezse düğme çizilmez ("Fotoğraf yok" alanı kalır). */
  onPhotoAdd?(): void;
  /** Masaüstünde örtülü modal katman yerine liste yanında akışta (modal değil) yan panel. */
  inline?: boolean;
  /** Eylem altlığı (genelde FormFooter); içerikten sonra panelin altında durur, içerik kayarken yerinde kalır. */
  footer?: ReactNode;
  /** Kapanınca odağın döneceği öğe; verilmezse açıldığı anda odaklı olan öğe (Safari'de tıklama odak taşımaz). */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

const BACK_LABEL = 'Listeye dön';
const CLOSE_LABEL = 'Kapat';
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

// --- Odak ---------------------------------------------------------------------------------------------
const TAB_STOP = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', 'summary', 'iframe', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Katmandaki sekme durakları (belge sırası); kapalı (hidden/inert) bölgelerin içi sayılmaz. */
function tabStops(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TAB_STOP)).filter(element => element.tabIndex >= 0 && !element.closest('[hidden], [inert]'));
}

/** Açık açılır liste ya da menü Escape'i kendisi işler (APG combobox / menu button); ayrıntı o anda kapanmaz. */
const ownsEscape = (target: Element) => target.closest('[role="combobox"][aria-expanded="true"], [aria-haspopup][aria-expanded="true"]') !== null;

const isPageRoot = (element: Element | null) => !element || element === document.body || element === document.documentElement;

// --- Bileşen ------------------------------------------------------------------------------------------
export function DetailPanel({
  row, related = [], source = [], onClose, onChangeStatus, onUndo, statusOptions = [], onPhotoAdd, inline, footer, returnFocusTo,
}: DetailPanelProps) {
  const device = useDevice();
  const narrow = device !== 'desktop';
  const modal = narrow || !inline;
  const id = useId();
  const headingId = `aile-detail-baslik${id}`;
  const relatedId = `aile-detail-baglar${id}`;
  const noOptionsId = `aile-detail-durum-not${id}`;
  const root = useRef<HTMLElement>(null);

  // Açan öğe: açılırken, odak içeri taşınmadan önce (layout aşaması) saklanır. Safari'de tıklama odak taşımadığından
  // body olabilir; o zaman yalnız returnFocusTo kullanılır. StrictMode'un deneme yeniden bağlanmasında odak artık
  // paneldedir; ilk kayıt korunur.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (opener.current) return;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && !isPageRoot(active) && !root.current?.contains(active) ? active : null;
  }, []);

  // Giriş: açılınca ve kayıt değişince odak diyaloğun köküne (içeride zaten odak varsa dokunulmaz).
  useEffect(() => {
    const element = root.current;
    if (element && !element.contains(document.activeElement)) element.focus({ preventScroll: true });
  }, [row.id]);

  // Dönüş: sökülünce. Passive temizlik React'in commit sonundaki seçim geri yüklemesinden sonradır; mikro görevde
  // yeniden bağlanma (StrictMode'un deneme sökümü) ayıklanır ve aynı commit'te sayfanın kendi odak kararı önce uygulanır.
  // Odak panel dışında başka bir öğeye taşındıysa dokunulmaz.
  const returnTarget = useRef(returnFocusTo);
  returnTarget.current = returnFocusTo;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const element = root.current;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (mounted.current) return;
        const active = document.activeElement;
        if (!isPageRoot(active) && !(element && element.contains(active))) return;
        const target = returnTarget.current?.current ?? opener.current;
        if (target?.isConnected) target.focus({ preventScroll: true });
      });
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const element = root.current;
    const target = event.target;
    // Portallı alt katmanlardan (React ağacında kabarcıklanan) gelen tuşlar o katmanındır.
    if (!element || !(target instanceof Element) || !element.contains(target)) return;
    if (event.key === 'Escape') {
      if (event.defaultPrevented || ownsEscape(target)) return;
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !modal) return;
    const stops = tabStops(element);
    if (stops.length === 0) {
      event.preventDefault();
      element.focus({ preventScroll: true });
      return;
    }
    const active = document.activeElement;
    const wrapToLast = event.shiftKey && (active === stops[0] || active === element);
    const wrapToFirst = !event.shiftKey && active === stops[stops.length - 1];
    if (!wrapToLast && !wrapToFirst) return;
    event.preventDefault();
    (wrapToLast ? stops[stops.length - 1] : stops[0]).focus();
  };

  // Telefon katmanı görsel görünüm alanına sığar (sanal klavye açıkken altlık klavyenin üstünde kalır).
  const insets = useVisualViewportInsets(narrow);
  const layerStyle = narrow && (insets.top > 0 || insets.bottom > 0)
    ? ({ '--aile-detail-ust': `${insets.top}px`, '--aile-detail-alt': `${insets.bottom}px` } as CSSProperties)
    : undefined;

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
    <div className="aile-detail-govde">
      {identity}
      {planActual}
      {statusActions}
      {relatedRecords}
      {sourceTrail}
    </div>
  );
  const footerNode = footer ? <div className="aile-detail-altlik">{footer}</div> : null;

  if (narrow) {
    return (
      <section
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="aile-detail aile-detail--dar"
        data-device={device}
        data-record={row.id}
        style={layerStyle}
        onKeyDown={onKeyDown}
      >
        <div className="aile-detail-bar">
          <Button variant="quiet" icon="back" onClick={onClose}>{BACK_LABEL}</Button>
        </div>
        {body}
        {footerNode}
      </section>
    );
  }

  const panel = (
    <section
      ref={root}
      role="dialog"
      aria-modal={modal ? 'true' : undefined}
      aria-labelledby={headingId}
      tabIndex={-1}
      className={['aile-detail', 'aile-detail--genis', inline && 'aile-detail--yerinde'].filter(Boolean).join(' ')}
      data-record={row.id}
      onKeyDown={onKeyDown}
    >
      <div className="aile-detail-ust">
        <h2 id={headingId} className="aile-detail-ust-baslik">{row.label}</h2>
        <Button variant="quiet" icon="close" onClick={onClose}>{CLOSE_LABEL}</Button>
      </div>
      {body}
      {footerNode}
    </section>
  );
  if (inline) return panel;
  // Örtülü katman: örtü süsleyicidir (aria-hidden); kapatmanın erişilebilir yolları "Kapat" ve Escape. Kapanış tamamlanan
  // tıklamadadır (pointercancel ile kaydırmaya dönen dokunma kapatmaz).
  return (
    <div className="aile-detail-katman">
      <div className="aile-detail-ortu" aria-hidden="true" onClick={onClose} />
      {panel}
    </div>
  );
}
