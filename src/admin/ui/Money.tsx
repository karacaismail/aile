import type { Money as MoneyValue } from '../shell/contracts';
import './Money.css';

// Para tutarı: biçimleyici + <span class="aile-tutar">. Tasarım README › İçerik ilkeleri: "Para: ₺8.500,00 (tr-TR,
// iki ondalık), tutar stiliyle, tablo ve satırda sağa hizalı." Tipografi `tutar` 16/24/500, tabular-nums; biçim
// admin.css'teki .aile-tutar'dan gelir, Money.css yalnız eksik değeri boyar (tasarım .ai-missing: ikincil renk, 400).
// Eksik bilgi saklanmaz, adıyla yazılır: plan için "Fiyat yok", gerçek için "Henüz yok"; ₺0,00 asla eksiğin yerine
// geçmez (PivotStack ile aynı karar). Bozuk bir tutar "yok" diye sunulmaz: "Bilinmiyor".
// Veri platformu tutarı metin ondalık taşır ("8500.00", Decimal: ^-?[0-9]+(\.[0-9]+)?$); Intl.NumberFormat'a metin
// verilir (ES2023), sayıya çevrilip yuvarlanmaz. Giriş tarafında ondalık virgül, binlik noktadır (README hata örneği:
// "Hata: Tutar yalnız rakam ve virgül içerebilir."); belirsiz girdi ("8.5", "8500.50") tahmin edilmez, null döner.
// Para birimi tek kaynaklıdır (ISO 4217); kod bozuksa fırlatmaz, sayı + kod yazar. Tasarım tesliminde ayrı bir Money
// bileşeni yok (index.d.ts / bundle.js); referans davranış bundle.js içindeki `para` kullanımı ve `.ai-num`/`.ai-missing`.

export interface MoneyProps {
  /** Veri platformu para zarfı; null ya da undefined = bilgi yok. */
  value: MoneyValue | null | undefined;
  /** Eksik değerin adı (README: eksik bilgi adıyla). Plan için "Fiyat yok" (varsayılan), gerçek için "Henüz yok". */
  label?: string;
  className?: string;
  id?: string;
}

export const FIYAT_YOK = 'Fiyat yok';
export const HENUZ_YOK = 'Henüz yok';
export const BILINMIYOR = 'Bilinmiyor';

const LOCALE = 'tr-TR';
const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const FRACTION = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

const plainFormat = new Intl.NumberFormat(LOCALE, FRACTION);
const currencyFormats = new Map<string, Intl.NumberFormat>();

function currencyFormat(currency: string): Intl.NumberFormat | null {
  const code = currency.trim().toUpperCase();
  if (!CURRENCY_CODE.test(code)) return null;
  let format = currencyFormats.get(code);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code, ...FRACTION });
    currencyFormats.set(code, format);
  }
  return format;
}

interface MoneyText { text: string; known: boolean }

function describeMoney(value: MoneyValue | null | undefined, missing: string): MoneyText {
  if (value == null) return { text: missing, known: false };
  const amount = value.amount.trim();
  if (!DECIMAL.test(amount)) return { text: BILINMIYOR, known: false };
  const literal = amount as `${number}`;
  const format = currencyFormat(value.currency);
  if (format) return { text: format.format(literal), known: true };
  return { text: `${plainFormat.format(literal)} ${value.currency.trim()}`.trim(), known: true };
}

/** "₺8.500,00" (tr-TR, iki ondalık, para birimi koduna göre simge); null/undefined → `missing` ("Fiyat yok"). */
export function formatMoney(value: MoneyValue | null | undefined, missing: string = FIYAT_YOK): string {
  return describeMoney(value, missing).text;
}

// Kabul edilen giriş: isteğe bağlı "-", tam kısım (düz rakamlar ya da 3'lü noktalı gruplar), isteğe bağlı ",ondalık"
// (en çok 2). Baştaki "₺" ve sondaki "₺"/"TL" (boşluklu da) kullanıcı yapıştırması için tolere edilir.
const INPUT = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
const LEADING_SYMBOL = /^₺\s*/;
const TRAILING_SYMBOL = /\s*(?:₺|TL)$/i;

/** "8.500,50" → "8500.50" (platform ondalık metni, her zaman iki ondalık). Geçersiz ya da belirsiz girdi → null. */
export function parseMoneyInput(input: string): string | null {
  const cleaned = input.trim().replace(LEADING_SYMBOL, '').replace(TRAILING_SYMBOL, '').trim();
  const match = INPUT.exec(cleaned);
  if (!match) return null;
  const [, sign = '', integer, fraction = ''] = match;
  const digits = integer.replace(/\./g, '').replace(/^0+(?=\d)/, '');
  const cents = `${fraction}00`.slice(0, 2);
  const magnitude = `${digits}.${cents}`;
  if (/^0+\.00$/.test(magnitude)) return '0.00';
  return `${sign}${magnitude}`;
}

export function Money({ value, label = FIYAT_YOK, className, id }: MoneyProps) {
  const { text, known } = describeMoney(value, label);
  const classes = ['aile-tutar', !known && 'aile-tutar--eksik', className].filter(Boolean).join(' ');
  return (
    <span id={id} className={classes} data-missing={known ? undefined : 'true'}>
      {text}
    </span>
  );
}
