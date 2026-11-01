// Generated from the existing finance validators. Run node data-platform/build-finance-adapter.mjs.
// src/finance/contract.ts
var financeSchemaVersion = "finance-v1";
var monthlyHeaders = ["Ay", "Nakit", "KMH anapara", "KMH faiz + vergi", "Kart borcu", "Gelecek taksit", "Birikimde kalan", "Net nakit ve bor\xE7", "Fon eksi\u011Fi"];
var dailyHeaders = ["Tarih", "Ad\u0131m", "T\xFCr", "Nakit de\u011Fi\u015Fimi", "Gerekli bakiye", "Harcanabilir nakit", "KMH anapara", "KMH faiz + vergi", "Denizbank anapara", "Denizbank faiz + vergi", "\u0130\u015Fbank anapara", "\u0130\u015Fbank faiz + vergi", "Gelecek taksit taahh\xFCd\xFC", "Toplam kart borcu", "Fon eksi\u011Fi", "Kesinlik", "Kaynak", "ID"];
var financeWire = {
  version: "finance-wire-v1",
  sheet: "_Finans web",
  fullRange: "A1:T6000",
  metadataRange: "A1:T11",
  headers: ["kind", "index", ...Array.from({ length: 18 }, (_, index) => `c${index + 1}`)]
};

// src/finance/wire.ts
var invalid = (reason) => {
  throw new Error(`Finansman verisi do\u011Frulanamad\u0131: ${reason}. Tutarlar g\xF6sterilmiyor.`);
};
var stale = () => {
  throw new Error("E-tablo kayna\u011F\u0131 de\u011Fi\u015Fti; finansman hesab\u0131 yenilenmeli. Tutarlar g\xF6sterilmiyor.");
};
var digestPattern = /^[a-f0-9]{64}$/;
function rowValues(row, kind, index, width) {
  if (!row || row.length !== 20 || row.some((value) => typeof value !== "string") || row[0] !== kind || row[1] !== `i:${index}`) return invalid("aktar\u0131m kay\u0131t t\xFCr\xFC, s\u0131ras\u0131 veya s\xFCtunlar\u0131 tutars\u0131z");
  if (row.slice(width + 2).some((value) => value !== "z:")) invalid("aktar\u0131mda beklenmeyen s\xFCtun var");
  return row.slice(2, width + 2).map((value) => {
    const token = value;
    if (token === "z:") return null;
    if (token.startsWith("s:")) return token.slice(2);
    if (/^n:-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(token)) {
      const number2 = Number(token.slice(2));
      if (Number.isFinite(number2)) return number2;
    }
    return invalid("aktar\u0131m h\xFCcresi eksik veya say\u0131 bi\xE7imi ge\xE7ersiz");
  });
}
var strings = (values) => values.map((value) => typeof value === "string" ? value : invalid("aktar\u0131m metni eksik"));
function readFinanceWireMetadata(table, exact = true) {
  if (table.labels.length !== 20 || table.labels.some((label, index) => label !== financeWire.headers[index])) invalid("aktar\u0131m ba\u015Fl\u0131klar\u0131 de\u011Fi\u015Fmi\u015F");
  if (table.rows.length < 10 || exact && table.rows.length !== 10) invalid("kaynak kontrol\xFC kay\u0131t say\u0131s\u0131 tutars\u0131z");
  const manifest = strings(rowValues(table.rows[0], "manifest", 0, 2));
  if (manifest[0] !== financeWire.version || !digestPattern.test(manifest[1])) invalid("aktar\u0131m s\xFCr\xFCm\xFC veya i\xE7erik \xF6zeti ge\xE7ersiz");
  const values = Array.from({ length: 9 }, (_, index) => strings(rowValues(table.rows[index + 1], "meta", index, 1))[0]);
  if (values[2] === "FALSE") stale();
  if (values[2] !== "TRUE") invalid("kaynak g\xFCncelli\u011Fi teyit edilemedi");
  if (values[5] !== financeSchemaVersion || !digestPattern.test(values[6])) invalid("kaynak s\xF6zle\u015Fmesi veya s\xFCr\xFCm\xFC ge\xE7ersiz");
  if (values.some((value) => !value.trim())) invalid("kaynak kontrol\xFC eksik");
  const count = (index, maximum) => /^[1-9]\d*$/.test(values[index]) && Number(values[index]) <= maximum ? Number(values[index]) : invalid("kay\u0131t say\u0131s\u0131 ge\xE7ersiz");
  return { payloadHash: manifest[1], values, eventCount: count(3, 5957), monthCount: count(4, 26) };
}
function financeCanonicalPayload(source) {
  return JSON.stringify([financeWire.version, financeSchemaVersion, source.metadata.rows.map((row) => row[0]), source.monthly.labels, source.monthly.rows, source.daily.labels, source.daily.rows]);
}
async function decodeFinanceWire(table) {
  const metadata2 = readFinanceWireMetadata(table, false);
  if (table.rows.length !== 12 + metadata2.monthCount + metadata2.eventCount) invalid("aktar\u0131m kay\u0131t say\u0131s\u0131 tutars\u0131z");
  let next = 10;
  const monthly = { labels: strings(rowValues(table.rows[next++], "monthly-header", 0, 9)), rows: Array.from({ length: metadata2.monthCount }, (_, index) => rowValues(table.rows[next++], "monthly", index, 9)) };
  const daily = { labels: strings(rowValues(table.rows[next++], "daily-header", 0, 18)), rows: Array.from({ length: metadata2.eventCount }, (_, index) => rowValues(table.rows[next++], "daily", index, 18)) };
  const source = { metadata: { labels: [""], rows: metadata2.values.map((value) => [value]) }, monthly, daily };
  if (!globalThis.crypto?.subtle) invalid("g\xFCvenli SHA-256 do\u011Frulamas\u0131 bu ortamda kullan\u0131lam\u0131yor");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(financeCanonicalPayload(source)));
  const actualHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actualHash !== metadata2.payloadHash) invalid("i\xE7erik \xF6zeti kaynak \xFCretimiyle uyu\u015Fmuyor");
  return { source, metadata: metadata2 };
}

// offline-finance:offline-sheet
var sheetUrl = "";

// src/finance/data.ts
var financeSheetUrl = `${sheetUrl}?range=${encodeURIComponent("'Finansman'!A1")}`;
var invalid2 = (reason) => {
  throw new Error(`Finansman verisi do\u011Frulanamad\u0131: ${reason}. Tutarlar g\xF6sterilmiyor.`);
};
var stale2 = () => {
  throw new Error("E-tablo kayna\u011F\u0131 de\u011Fi\u015Fti; finansman hesab\u0131 yenilenmeli. Finansman sayfas\u0131ndaki kaynak kontrol\xFC tamamlanana kadar tutarlar g\xF6sterilmiyor.");
};
var text = (value, label) => typeof value === "string" && value.trim() ? value.trim() : invalid2(`${label} eksik`);
var number = (value) => typeof value === "number" && Number.isFinite(value) ? value : invalid2("tutar eksik veya ge\xE7ersiz");
var nonnegative = (value) => {
  const n = number(value);
  return n >= 0 ? n : invalid2("bor\xE7 veya kullan\u0131labilir tutar negatif");
};
var moneyEpsilon = 1e-6;
var close = (left, right) => Math.abs(left - right) <= moneyEpsilon;
var isEmpty = (row) => row.every((value) => value === null || value === "");
function metadata(table) {
  if (table.rows[2]?.[0] === "FALSE") stale2();
  if (table.rows[2]?.[0] !== "TRUE") invalid2("kaynak g\xFCncelli\u011Fi teyit edilemedi");
  if (table.rows[5]?.[0] !== financeSchemaVersion) invalid2("s\xF6zle\u015Fme s\xFCr\xFCm\xFC de\u011Fi\u015Fmi\u015F");
  const count = (row, maximum) => {
    const value = text(table.rows[row]?.[0], "kay\u0131t say\u0131s\u0131");
    return /^[1-9]\d*$/.test(value) && Number(value) <= maximum ? Number(value) : invalid2("kay\u0131t say\u0131s\u0131 ge\xE7ersiz");
  };
  const fingerprint = text(table.rows[6]?.[0], "kaynak s\xFCr\xFCm\xFC");
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) invalid2("kaynak s\xFCr\xFCm\xFC ge\xE7ersiz");
  return { status: text(table.rows[1]?.[0], "hesap durumu"), notes: [text(table.rows[7]?.[0], "hesap kapsam\u0131"), text(table.rows[8]?.[0], "hesap ko\u015Fullar\u0131")], eventCount: count(3, 5957), monthCount: count(4, 26), fingerprint };
}
function rows(table, headers, expectedCount) {
  if (table.labels.length !== headers.length || table.labels.some((label, index) => label !== headers[index])) invalid2("s\xFCtun ba\u015Fl\u0131klar\u0131 de\u011Fi\u015Fmi\u015F");
  const records = table.rows.filter((row) => !isEmpty(row));
  if (records.length !== expectedCount || records.some((row) => row.length > headers.length && !isEmpty(row.slice(headers.length)))) invalid2("kay\u0131t say\u0131s\u0131 tutars\u0131z");
  return records;
}
var validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && (/* @__PURE__ */ new Date(`${value}T00:00:00Z`)).toISOString().slice(0, 10) === value;
function buildFinance(source) {
  const meta = metadata(source.metadata);
  const ids = /* @__PURE__ */ new Set();
  const events = rows(source.daily, dailyHeaders, meta.eventCount).map((row, index, all) => {
    const date = text(row[0], "tarih");
    if (!validDate(date) || index > 0 && date < String(all[index - 1][0])) invalid2("tarih veya kronolojik s\u0131ra ge\xE7ersiz");
    const id = text(row[17], "i\u015Flem kimli\u011Fi");
    if (ids.has(id)) invalid2("i\u015Flem kimli\u011Fi yinelenmi\u015F");
    ids.add(id);
    const event = { date, title: text(row[1], "ad\u0131m"), type: text(row[2], "t\xFCr"), cashChange: number(row[3]), requiredBalance: number(row[4]), cash: nonnegative(row[5]), kmhPrincipal: nonnegative(row[6]), kmhCost: nonnegative(row[7]), denizPrincipal: nonnegative(row[8]), denizCost: nonnegative(row[9]), isPrincipal: nonnegative(row[10]), isCost: nonnegative(row[11]), futureInstalments: nonnegative(row[12]), cardDebt: nonnegative(row[13]), fundingGap: nonnegative(row[14]), certainty: text(row[15], "kesinlik"), source: text(row[16], "kaynak"), id };
    if (!close(event.cardDebt, event.denizPrincipal + event.denizCost + event.isPrincipal + event.isCost)) invalid2("kart borcu mutabakat\u0131 tutars\u0131z");
    if (event.futureInstalments > event.denizPrincipal + event.isPrincipal + moneyEpsilon) invalid2("gelecek taksit anaparadan fazla");
    if (!close(event.cash, Math.max(0, event.requiredBalance))) invalid2("harcanabilir nakit net bakiyeyle tutars\u0131z");
    const negativeBalance = Math.max(0, -event.requiredBalance);
    if (event.kmhPrincipal > negativeBalance + moneyEpsilon) invalid2("KMH anaparas\u0131 net bakiyeyle tutars\u0131z");
    const uncoveredPrincipal = negativeBalance - event.kmhPrincipal;
    if (event.fundingGap + moneyEpsilon < uncoveredPrincipal || event.fundingGap > uncoveredPrincipal + event.kmhCost + moneyEpsilon) invalid2("fon eksi\u011Fi nakit ve KMH ile tutars\u0131z");
    if (index > 0 && !close(number(all[index - 1][4]) + event.cashChange, event.requiredBalance)) invalid2("nakit bakiye zinciri tutars\u0131z");
    return event;
  });
  const months = rows(source.monthly, monthlyHeaders, meta.monthCount).map((row, index, all) => {
    const month = text(row[0], "ay");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || index > 0 && month <= String(all[index - 1][0])) invalid2("ay s\u0131ras\u0131 ge\xE7ersiz");
    return { month, cash: nonnegative(row[1]), kmhPrincipal: nonnegative(row[2]), kmhCost: nonnegative(row[3]), cardDebt: nonnegative(row[4]), futureInstalments: nonnegative(row[5]), reserve: nonnegative(row[6]), knownNetAssets: number(row[7]), fundingGap: nonnegative(row[8]) };
  });
  const dailyMonths = [...new Set(events.map((event) => event.date.slice(0, 7)))];
  if (dailyMonths.length !== months.length || dailyMonths.some((month, index) => month !== months[index].month)) invalid2("ayl\u0131k ve g\xFCnl\xFCk kapsam farkl\u0131");
  for (const month of months) {
    const last = events.findLast((event) => event.date.startsWith(month.month));
    if (!["cash", "kmhPrincipal", "kmhCost", "cardDebt", "futureInstalments", "fundingGap"].every((key) => close(month[key], last[key]))) invalid2("ay sonu bakiyeleri tutars\u0131z");
    if (!close(month.knownNetAssets, last.requiredBalance + month.reserve - last.kmhCost - last.cardDebt)) invalid2("net nakit ve bor\xE7 mutabakat\u0131 tutars\u0131z");
  }
  return { status: meta.status, notes: meta.notes, fingerprint: meta.fingerprint, months, events };
}
export {
  buildFinance,
  decodeFinanceWire
};
