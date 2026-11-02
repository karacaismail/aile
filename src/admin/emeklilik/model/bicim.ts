// Türkçe sayı yazımı (yerel ayardan bağımsız, belirlenimci): binlik ayırıcı nokta, ondalık ayırıcı virgül.

/** 3500 → '3.500'. */
export function tamSayi(n: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Tamsayı bekleniyor: ${n}`);
  const mutlak = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? `−${mutlak}` : mutlak;
}

/** 0.45 → '%45', 0.105 → '%10,5'. */
export function yuzde(oran: number): string {
  if (!Number.isFinite(oran)) throw new RangeError(`Oran sonlu olmalı: ${oran}`);
  const deger = Number((oran * 100).toPrecision(12));
  return `%${String(deger).replace('.', ',')}`;
}

const sonNoktasiz = (metin: string) => metin.trim().replace(/\.+$/, '');

/** Nedenleri tekrarsız ve '; ' ile birleştirir; aradaki nokta düşer, son nedenin noktası korunur. */
export function nedenleriBirlestir(nedenler: readonly string[]): string {
  const tekil = [...new Set(nedenler.map((n) => n.trim()).filter((n) => n.length > 0))];
  if (tekil.length <= 1) return tekil[0] ?? '';
  const son = tekil[tekil.length - 1];
  return tekil.map(sonNoktasiz).join('; ') + (son.endsWith('.') ? '.' : '');
}

/** Cümle içine yerleştirmek için: tekrarsız, '; ' ile birleşik, sonda nokta yok. */
export function nedenleriSirala(nedenler: readonly string[]): string {
  return sonNoktasiz(nedenleriBirlestir(nedenler));
}
