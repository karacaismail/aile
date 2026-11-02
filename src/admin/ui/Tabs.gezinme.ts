// Tabs öğesi ve APG gezinme yardımcıları (sekme, radyo ve telefon listesi ortak kullanır). Saf fonksiyonlar; React yok.
export interface TabItem {
  key: string;
  label: string;
  /** Devre dışı seçenek görünür kalır; gerekçesi `note` ile verilir. */
  disabled?: boolean;
}

/** İlk etkin öğenin anahtarı; hepsi devre dışıysa ilk öğe (seçim gösterimi için), liste boşsa undefined. */
export const ilkEtkin = (items: readonly TabItem[]) => (items.find(item => !item.disabled) ?? items[0])?.key;

/** Son etkin öğenin anahtarı (End). */
export const sonEtkin = (items: readonly TabItem[]) => [...items].reverse().find(item => !item.disabled)?.key;

/**
 * `from` konumundan `adim` yönünde bir sonraki etkin öğe. `sar` true iken uçlarda başa/sona döner (APG Tabs ve Radio
 * Group); false iken uçta durur (APG Listbox). Etkin öğe yoksa undefined.
 */
export function komsuEtkin(items: readonly TabItem[], from: number, adim: 1 | -1, sar = true): string | undefined {
  const n = items.length;
  for (let i = 1; i <= n; i += 1) {
    const index = from + adim * i;
    if (!sar && (index < 0 || index >= n)) return undefined;
    const item = items[((index % n) + n) % n];
    if (item && !item.disabled) return item.key;
  }
  return undefined;
}
