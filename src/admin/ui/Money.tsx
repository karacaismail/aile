import { MIXED_CURRENCY_TEXT, type MoneyTotal } from '../data/actuals';
import type { Money as MoneyValue } from '../shell/contracts';
import './Money.css';

// Para tutarı: biçimleyici + <span class="aile-tutar">. Tasarım README › İçerik ilkeleri: "Para: ₺8.500,00 (tr-TR,
// iki ondalık), tutar stiliyle, tablo ve satırda sağa hizalı." Tipografi `tutar` 16/24/500, tabular-nums; biçim
// admin.css'teki .aile-tutar'dan gelir, Money.css tabular-nums'u kendisi de taşır (portallanan katmanlar) ve eksik
// değeri boyar (tasarım .ai-missing: ikincil renk, 400). Telefon sunumu antd'siz: yalnız yerel HTML + --aile-* tokenları.
// Eksik bilgi saklanmaz, adıyla yazılır: plan için "Fiyat yok", gerçek için "Henüz yok"; ₺0,00 asla eksiğin yerine
// geçmez (PivotStack ile aynı karar). Bozuk bir tutar "yok" diye sunulmaz: "Bilinmiyor".
// Veri platformu tutarı metin ondalık taşır ("8500.00", Decimal: ^-?[0-9]+(\.[0-9]+)?$); Intl.NumberFormat'a metin
// verilir (ES2023), sayıya çevrilip yuvarlanmaz. Sıfırın yönü yoktur: "-0.00" de "₺0,00" yazılır (signDisplay).
// Toplamlar data/actuals.ts sumMoney ile kesin hesaplanır (MoneyTotal); farklı para birimleri toplanmaz: Money onları
// "Birden çok para birimi" diye adlandırır (eksik değil, birleşik değil).
// İşaretli gösterim (sign): ton (hata/olumlu) yalnız destekler; yön her zaman metindedir ("-₺420,00", "+₺420,00").
// Giriş tarafında ondalık virgül, binlik noktadır (README hata örneği: "Hata: Tutar yalnız rakam ve virgül
// içerebilir."); belirsiz girdi ("8.5", "8500.50") tahmin edilmez, null döner.
// Para birimi tek kaynaklıdır (ISO 4217); kod bozuksa fırlatmaz, sayı + kod yazar. Tasarım tesliminde ayrı bir Money
// bileşeni yok (index.d.ts / bundle.js); referans davranış bundle.js içindeki `para` kullanımı ve `.ai-num`/`.ai-missing`.

/** Tek tutar ya da actuals.sumMoney toplamı. */
export type MoneyInput = MoneyValue | MoneyTotal | null | undefined;

/**
 * İşaretli tutar (fark, kalan, nakit değişimi): 'negative' yalnız eksi tutarı hata tonunda gösterir (kalan aşımı);
 * 'both' artıyı da "+" ile yazar ve olumlu tonda gösterir. Sıfır, eksik ve bozuk değer tonlanmaz.
 */
export type MoneySign = 'negative' | 'both';

export interface MoneyProps {
  /** Veri platformu para zarfı ya da MoneyTotal; null ya da undefined = bilgi yok. */
  value: MoneyInput;
  /** Eksik değerin adı (README: eksik bilgi adıyla). Plan için "Fiyat yok" (varsayılan), gerçek için "Henüz yok". */
  label?: string;
  /** İşaret ve ton; verilmezse düz metin, ton yok. */
  sign?: MoneySign;
  className?: string;
  id?: string;
}

export const FIYAT_YOK = 'Fiyat yok';
export const HENUZ_YOK = 'Henüz yok';
export const BILINMIYOR = 'Bilinmiyor';

const LOCALE = 'tr-TR';
const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
type SignDisplay = 'negative' | 'exceptZero';
const FRACTION = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

const plainFormats = new Map<SignDisplay, Intl.NumberFormat>();
const currencyFormats = new Map<string, Intl.NumberFormat>();

function plainFormat(signDisplay: SignDisplay): Intl.NumberFormat {
  let format = plainFormats.get(signDisplay);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, { ...FRACTION, signDisplay });
    plainFormats.set(signDisplay, format);
  }
  return format;
}

function currencyFormat(currency: string, signDisplay: SignDisplay): Intl.NumberFormat | null {
  const code = currency.trim().toUpperCase();
  if (!CURRENCY_CODE.test(code)) return null;
  const key = `${code}:${signDisplay}`;
  let format = currencyFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code, ...FRACTION, signDisplay });
    currencyFormats.set(key, format);
  }
  return format;
}

const isTotal = (value: MoneyInput): value is MoneyTotal =>
  typeof value === 'object' && value !== null && 'counted' in value && 'currencies' in value;

type MoneyState = 'known' | 'missing' | 'mixed';
interface MoneyText { text: string; state: MoneyState; tone?: 'hata' | 'olumlu' }

function describeMoney(value: MoneyInput, missing: string, sign?: MoneySign): MoneyText {
  if (isTotal(value)) {
    if (value.money) return describeMoney(value.money, missing, sign);
    return value.currencies.length > 1 ? { text: MIXED_CURRENCY_TEXT, state: 'mixed' } : { text: missing, state: 'missing' };
  }
  if (value == null) return { text: missing, state: 'missing' };
  const amount = value.amount.trim();
  if (!DECIMAL.test(amount)) return { text: BILINMIYOR, state: 'missing' };
  const literal = amount as `${number}`;
  const signDisplay: SignDisplay = sign === 'both' ? 'exceptZero' : 'negative';
  const format = currencyFormat(value.currency, signDisplay);
  // Yön Intl'in kendi parçalarından okunur: metinle aynı yuvarlama, sıfır (eksi sıfır dahil) işaretsiz.
  const parts = (format ?? plainFormat(signDisplay)).formatToParts(literal);
  const number = parts.map(part => part.value).join('');
  const text = format ? number : `${number} ${value.currency.trim()}`.trim();
  const tone = !sign ? undefined : parts.some(part => part.type === 'minusSign') ? 'hata' : parts.some(part => part.type === 'plusSign') ? 'olumlu' : undefined;
  return { text, state: 'known', tone };
}

/**
 * "₺8.500,00" (tr-TR, iki ondalık, para birimi koduna göre simge); null/undefined → `missing` ("Fiyat yok").
 * MoneyTotal: tek birimde toplam yazılır, birden çok birim "Birden çok para birimi", boş toplam `missing`.
 */
export function formatMoney(value: MoneyInput, missing: string = FIYAT_YOK): string {
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

export function Money({ value, label = FIYAT_YOK, sign, className, id }: MoneyProps) {
  const { text, state, tone } = describeMoney(value, label, sign);
  const classes = ['aile-tutar', state !== 'known' && 'aile-tutar--eksik', className].filter(Boolean).join(' ');
  return (
    <span
      id={id}
      className={classes}
      data-missing={state === 'missing' ? 'true' : undefined}
      data-mixed={state === 'mixed' ? 'true' : undefined}
      data-tone={tone}
    >
      {text}
    </span>
  );
}
