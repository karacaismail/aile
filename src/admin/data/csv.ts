// İstemci tarafı CSV dışa aktarımı (Raporlar ve Bütçe ortak). Saf kısım (csvCell, toCsv) React ve DOM bilmez;
// downloadCsv yalnız tarayıcıda çağrılır. Biçim: tr-TR Excel için ';' ayırıcı, CRLF satır sonu, UTF-8 BOM.
//
// Formül enjeksiyonu: hücre metni (gözlem etiketi, oda adı, sorun kodu) bağlantıya sahip herkesin düzenleyebildiği
// Sheet'ten gelir. "=", "+", "-", "@", TAB ya da CR ile başlayan hücreyi Excel, LibreOffice ve Google Sheets formül olarak
// çalıştırır; tırnak içine almak korumaz. Böyle bir değer saf ondalık sayı değilse başına "'" eklenir (metin olarak
// açılır), sonra tırnak kuralı uygulanır. Saf ondalık sayı ("-1250.00", "8500") olduğu gibi kalır: eksi tutar sayıdır.

const FORMULA_START = /^[=+\-@\t\r]/;
const PURE_DECIMAL = /^-?\d+(\.\d+)?$/;
const NEEDS_QUOTES = /[;"\r\n]/;
const SEPARATOR = ';';
const LINE_BREAK = '\r\n';
const BOM = '﻿';

/** İndirme başlamadan blob bağlantısı bırakılırsa WebKit indirmeyi iptal eder; bırakma bu kadar ertelenir. */
export const CSV_REVOKE_DELAY_MS = 1000;

export type CsvRows = readonly (readonly string[])[];

/** Tek hücre: formül başlangıcı metne çevrilir, ayırıcı/tırnak/satır sonu içeren değer tırnaklanır. */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) && !PURE_DECIMAL.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Satırları ';' ile ayırır, her hücreyi csvCell'den geçirir; CRLF ve UTF-8 BOM ile başlar. */
export function toCsv(rows: CsvRows): string {
  return `${BOM}${rows.map(row => row.map(csvCell).join(SEPARATOR)).join(LINE_BREAK)}`;
}

/**
 * CSV'yi dosya olarak indirir: bağlantı belgeye eklenip tıklanır ve kaldırılır (WebKit belgede olmayan bağlantıyı
 * indirmeyebilir); blob URL indirme başladıktan sonra, CSV_REVOKE_DELAY_MS sonunda bırakılır. Ağa ya da Sheets'e yazma yok.
 */
export function downloadCsv(filename: string, rows: CsvRows): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), CSV_REVOKE_DELAY_MS);
}
