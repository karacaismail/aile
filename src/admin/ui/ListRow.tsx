import { designTokens } from '../../design/tokens.ts';
import { useDevice } from '../device';
import type { Money as MoneyValue, RecordRow } from '../shell/contracts';
import { Icon } from './icons';
import { BILINMIYOR } from './StatusText';
import { Tag } from './Tag';
import './ListRow.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/ListRow/README.md + index.d.ts ListRowProps; referans davranış
// bundle.js ListRow / ListHeader / Photo / Tutar. Liste görünümünde tek kayıt; tıklanınca ayrıntıyı açar.
//  - <li><button>: liste öğesi anlamını <li>, eylemi gerçek bir düğme taşır (Enter/Space yerleşik; li'ye role yok).
//  - Fotoğraf: 56 px görsel yalnız photo.verified ise; değilse boş yuva (imageOff) + bir kez "Fotoğraf yok".
//    Doğrulanmamış görselin adresi DOM'a hiç girmez (başka ürünün resmi asla). Görsel süsleyicidir (alt=""):
//    başlık yanında yazılıdır, düğme adı kaydın adını iki kez okumaz.
//  - Planlanan ve Gerçekleşen ayrı sütun; eksikse adıyla: "Fiyat yok" / "Henüz yok". Asla tek sayıda birleşmez.
//    Biçim ₺8.500,00 (tr-TR, 2 ondalık; .aile-tutar tabular-nums). ui/Money bu dilimde stub olduğu için biçimleme
//    burada yerel bir Tutar ile yapılır; Money indiğinde Tutar onu çağıracak biçimde tek noktada tutuldu.
//  - Dar biçim (narrow): fotoğraf + ana sütun; tutarlar etiketli iki sütun hâlinde satırın altında. narrow
//    verilmezse cihazdan türer (telefon → dar); kabuk ayrıntı paneli yanında daralan liste için narrow verir.
//  - Seçim = aria-current="true" + secili yüzey + 600 ağırlık (odaktan ayrı). Hover tek yol değildir.
//  - Odak: satırda çizgi satırın alt kenarındadır (admin.css'teki tr/[role=row] kuralının aynısı, ListRow.css'te
//    .aile-listrow-dugme için); outline/halka/box-shadow yok. Renk ve ölçüler yalnız --aile tokenlarından.

export interface ListRowProps {
  row: RecordRow;
  /** Seçili satır (aria-current). Seçim odaktan ayrıdır. */
  selected?: boolean;
  /** Dar biçim; verilmezse useDevice() === 'phone'. */
  narrow?: boolean;
  /** Tıklama ya da Enter/Space: ayrıntıyı açar. */
  onClick?(): void;
  className?: string;
}

export interface ListRowHeaderProps {
  /** İkinci sütunun adı; varsayılan "Alım". */
  title?: string;
  className?: string;
}

export const FIYAT_YOK = 'Fiyat yok';
export const HENUZ_YOK = 'Henüz yok';
export const FOTOGRAF_YOK = 'Fotoğraf yok';
const PLANLANAN = 'Planlanan';
const GERCEKLESEN = 'Gerçekleşen';

const FRACTION = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const formatters = new Map<string, (value: number) => string>();
function moneyFormatter(currency: string): (value: number) => string {
  let format = formatters.get(currency);
  if (!format) {
    try {
      const withSymbol = new Intl.NumberFormat('tr-TR', { style: 'currency', currency, ...FRACTION });
      format = value => withSymbol.format(value);
    } catch {
      // Geçersiz ISO 4217 kodu: sayı tr-TR, kod yanına.
      const plain = new Intl.NumberFormat('tr-TR', FRACTION);
      format = value => `${plain.format(value)} ${currency}`;
    }
    formatters.set(currency, format);
  }
  return format;
}

/** "8500.00" + "TRY" → "₺8.500,00"; okunamayan tutar "Bilinmiyor". */
export function formatMoney(money: MoneyValue): string {
  const value = Number(money.amount);
  if (money.amount.trim() === '' || !Number.isFinite(value)) return BILINMIYOR;
  return moneyFormatter(money.currency)(value);
}

function Tutar({ value, missing }: { value: MoneyValue | null; missing: string }) {
  if (value === null) return <span className="aile-listrow-eksik">{missing}</span>;
  return <span className="aile-tutar">{formatMoney(value)}</span>;
}

function Foto({ photo }: { photo: RecordRow['photo'] }) {
  if (photo && photo.verified && photo.url) {
    return (
      <img
        className="aile-listrow-foto"
        src={photo.url}
        alt=""
        width={designTokens.fotografListe}
        height={designTokens.fotografListe}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <span className="aile-listrow-foto aile-listrow-foto--yok" aria-hidden="true">
      <Icon name="imageOff" />
    </span>
  );
}

function hasPhoto(photo: RecordRow['photo']): boolean {
  return !!photo && photo.verified && !!photo.url;
}

export function ListRow({ row, selected, narrow, onClick, className }: ListRowProps) {
  const device = useDevice();
  const dar = narrow ?? device === 'phone';
  const statusLabel = row.status.label.trim() || BILINMIYOR;
  const meta = row.room ? `${row.code} · ${row.room}` : row.code;
  const classes = ['aile-listrow', className].filter(Boolean).join(' ');

  const main = (
    <span className="aile-listrow-ana">
      <span className="aile-listrow-ad">{row.label}</span>
      <span className="aile-listrow-meta">{meta}</span>
      <span className="aile-listrow-etiketler">
        <Tag tone={row.status.tone}>{statusLabel}</Tag>
        {!hasPhoto(row.photo) && <span className="aile-listrow-fotoyok">{FOTOGRAF_YOK}</span>}
      </span>
    </span>
  );

  return (
    <li className={classes}>
      <button
        type="button"
        className="aile-listrow-dugme"
        data-bicim={dar ? 'dar' : 'genis'}
        aria-current={selected ? 'true' : undefined}
        onClick={onClick}
      >
        <Foto photo={row.photo} />
        {main}
        {dar ? (
          <span className="aile-listrow-tutarlar">
            <span data-tutar="planlanan">
              <span className="aile-listrow-etiket">{PLANLANAN}</span>
              <Tutar value={row.planned} missing={FIYAT_YOK} />
            </span>
            <span data-tutar="gerceklesen">
              <span className="aile-listrow-etiket">{GERCEKLESEN}</span>
              <Tutar value={row.actual} missing={HENUZ_YOK} />
            </span>
          </span>
        ) : (
          <>
            <span className="aile-listrow-hucre" data-tutar="planlanan">
              <span className="aile-listrow-gizli">{PLANLANAN} </span>
              <Tutar value={row.planned} missing={FIYAT_YOK} />
            </span>
            <span className="aile-listrow-hucre" data-tutar="gerceklesen">
              <span className="aile-listrow-gizli">{GERCEKLESEN} </span>
              <Tutar value={row.actual} missing={HENUZ_YOK} />
            </span>
            <Icon name="chevronRight" className="aile-listrow-ok" />
          </>
        )}
      </button>
    </li>
  );
}

/** Geniş biçimde listenin üst satırı; sütunlar satır içinde zaten adlandırılır, bu yüzden aria-hidden. */
function ListRowHeader({ title = 'Alım', className }: ListRowHeaderProps) {
  const classes = ['aile-listrow-ust', className].filter(Boolean).join(' ');
  return (
    <li className={classes} aria-hidden="true">
      <span>Foto</span>
      <span>{title}</span>
      <span className="aile-listrow-hucre">{PLANLANAN}</span>
      <span className="aile-listrow-hucre">{GERCEKLESEN}</span>
      <span />
    </li>
  );
}

ListRow.Header = ListRowHeader;
