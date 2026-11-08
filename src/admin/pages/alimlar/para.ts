import type { Money as MoneyValue } from '../../shell/contracts';

// Para toplamı (yalnız özet ve pivot). Plan ve gerçek her zaman ayrı toplanır; para birimi başına ayrı tutulur.
// Kuruş tam sayısıyla toplanır (ondalık metin ikili kayan nokta hatasına düşmez). Saf; React yok.

const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;

export function toMinor(money: MoneyValue | null | undefined): number | null {
  if (!money || !DECIMAL.test(money.amount.trim())) return null;
  const value = Number(money.amount);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export const fromMinor = (minor: number, currency: string): MoneyValue => ({ amount: (minor / 100).toFixed(2), currency });

/** Para birimi → kuruş toplamı. */
export type ParaToplami = Map<string, number>;

/** Okunabilir tutarı toplama ekler; eklenemezse (yok ya da geçersiz) false. */
export function paraEkle(total: ParaToplami, money: MoneyValue | null | undefined): boolean {
  const minor = toMinor(money);
  if (minor === null || !money) return false;
  total.set(money.currency, (total.get(money.currency) ?? 0) + minor);
  return true;
}

const bicimler = new Map<string, Intl.NumberFormat>();
/** 56550000 kuruş + "TRY" → "₺565.500,00"; geçersiz ISO kodunda sayı tr-TR, kod yanına. */
export function paraYaz(minor: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ${currency}`;
  let format = bicimler.get(code);
  if (!format) {
    format = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    bicimler.set(code, format);
  }
  return format.format(minor / 100);
}

/** Toplamın metni: birden çok para birimi " · " ile ayrı yazılır; boşsa eksik metni ("Fiyat yok", "Henüz yok"). */
export function toplamMetni(total: ParaToplami, missing: string): string {
  return total.size ? [...total.entries()].map(([currency, minor]) => paraYaz(minor, currency)).join(' · ') : missing;
}
