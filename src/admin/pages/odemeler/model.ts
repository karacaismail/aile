import { BUDGET_TIME_ZONE, MIXED_CURRENCY_TEXT, sumMoney, type ForecastEvent, type Manifest } from '../../data';
import type { ActiveFilter, FilterFacet, Money as MoneyValue, PageHeaderSummary, RecordRow, SortOption, StatusLabel } from '../../shell/contracts';
import { RANGE_KEYS, rangeValue } from '../../shell/FilterPanel';
import { BILINMIYOR, formatMoney, parseMoneyInput } from '../../ui/Money';

// Ödemeler sayfasının saf modeli (React yok; telefon ve geniş sunum aynı modeli kullanır).
// Veri gerçeği: nesilde `payments` koleksiyonu yok (data/contract.ts). Sayfa bunu adıyla söyler ve bütçe tahmin olaylarını
// (forecast_events) "tahmini ödeme" olarak listeler. Bir tahmin olayı hiçbir yerde ödeme gibi görünmez:
//  - "Ödendi" ya da "Gecikti" yazılmaz. Tarihi geçen olay için ödenip ödenmediği bilinmez: "Tarihi geçti · N gün".
//  - Gerçekleşen sütunu "Ödeme kaydı yok" der; olayda ölçülmüş bir gerçek tutar varsa "Kaynakta yazılı" ile gösterilir
//    (ödeme kanıtı yok; data/actuals.ts sözleşmesi; hücre Tutar.tsx'te). Plan ve gerçek tek sayıda birleşmez.
// Gruplar tarihe göre: Tarihi geçenler · Bu hafta (0–6 gün) · ay ay ("Aralık 2026") · Tarihi bilinmiyor. Tutara göre
// sıralamada ay kırılımı kalkar, zaman kovaları (Tarihi geçenler · Bu hafta · Sonra · Tarihi bilinmiyor) kalır; böylece
// tarihi geçen olaylar her sıralamada üstte durur. Bugün Europe/Istanbul takvim günüdür (BUDGET_TIME_ZONE).

export type ZamanKovasi = 'gecmis' | 'hafta' | 'sonra' | 'bilinmiyor';
export type SiralamaAnahtari = 'tarih' | 'tutar';

export const KOVA_SIRASI: readonly ZamanKovasi[] = ['gecmis', 'hafta', 'sonra', 'bilinmiyor'];
const KOVA_GRUP: Readonly<Record<ZamanKovasi, string>> = {
  gecmis: 'Tarihi geçenler', hafta: 'Bu hafta', sonra: 'Sonra', bilinmiyor: 'Tarihi bilinmiyor',
};
const KOVA_FILTRE: Readonly<Record<ZamanKovasi, string>> = {
  gecmis: 'Tarihi geçti', hafta: 'Bu hafta', sonra: 'Sonra', bilinmiyor: 'Tarihi bilinmiyor',
};
const OLAY_TURLERI: Readonly<Record<string, string>> = {
  purchase: 'Alım', payment: 'Ödeme', fee: 'Ücret', interest: 'Faiz', borrowing: 'Borçlanma', repayment: 'Geri ödeme',
};
const KESINLIK: Readonly<Record<string, StatusLabel>> = {
  planned: { label: 'Planlandı', tone: 'notr' },
  estimated: { label: 'Tutar tahmini', tone: 'uyari' },
};
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'] as const;

export const KAYNAKTA_ODEME_YOK = 'Kaynakta ödeme kaydı yok';
export const ODEME_KAYDI_YOK = 'Ödeme kaydı yok';
export const TARIHI_BILINMIYOR = 'Tarihi bilinmiyor';
export const TUR_BILINMIYOR = 'bilinmiyor';
export const LISTE_ADI = 'Tahmini ödemeler';
export const TELEFON_SAYFA = 10;
export const GENIS_SAYFA = 50;
const KOD_YOK = 'Kod yok';
const AD_YOK = 'Adı yok';
const YOK = 'Yok';
const HAFTA_GUN = 7;
const GUN_MS = 86_400_000;
const DATE_TYPE = 'tahmini';

export const SIRALAMALAR: readonly SortOption[] = [
  { key: 'tarih', label: 'Tarihe göre', direction: 'asc' },
  { key: 'tutar', label: 'Tutara göre', direction: 'desc' },
];

const sayi = new Intl.NumberFormat('tr-TR');
const ISO_GUN = /^(\d{4})-(\d{2})-(\d{2})/;
const TR_GUN = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const istanbulGunu = new Intl.DateTimeFormat('en-CA', { timeZone: BUDGET_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

// --- Tarih (epoch gün; saat dilimi kayması yok) --------------------------------------------------------------------
function utcDay(year: number, month: number, date: number): number | null {
  const utc = new Date(Date.UTC(year, month - 1, date));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== date) return null;
  return Math.floor(utc.getTime() / GUN_MS);
}

/** ISO "YYYY-MM-DD" → epoch gün; okunamazsa null. */
export function isoToDay(iso: string | null | undefined): number | null {
  const m = iso ? ISO_GUN.exec(iso.trim()) : null;
  return m ? utcDay(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** "gg.aa.yyyy" → epoch gün; boş ya da okunamayan girdi null. */
export function trToDay(text: string): number | null {
  const m = TR_GUN.exec(text.trim());
  return m ? utcDay(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/** Verilen anın Europe/Istanbul takvim günü (epoch gün). */
export function todayOf(now: Date): number {
  return isoToDay(istanbulGunu.format(now))!;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const dayDate = (day: number) => new Date(day * GUN_MS);
/** 28.10.2026 */
export const dayToText = (day: number) => {
  const d = dayDate(day);
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
};
const dayToIso = (day: number) => dayDate(day).toISOString().slice(0, 10);
const ayAnahtari = (day: number) => dayToIso(day).slice(0, 7);
const ayAdi = (day: number) => {
  const d = dayDate(day);
  return `${AYLAR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

// --- Satır modeli ------------------------------------------------------------------------------------------------
export interface OdemeRow {
  id: string;
  code: string;
  label: string;
  /** Olay türü etiketi ("Alım"); bilinmiyorsa "Bilinmiyor". */
  type: string;
  /** Filtre değeri: ham event_type ya da "bilinmiyor". */
  typeKey: string;
  day: number | null;
  dateText: string;
  planned: MoneyValue | null;
  /** Olayda ölçülmüş gerçek tutar (ödeme kanıtı değildir); çoğu olayda yok. */
  actual: MoneyValue | null;
  kova: ZamanKovasi;
  status: StatusLabel;
  /** Kesinlik sözcüğü ("Planlandı", "Tutar tahmini", "Bilinmiyor"). */
  certainty: string;
  /** Kaynak yeri ("_Finans web · satır 40") ya da "Bilinmiyor". */
  source: string;
}

const moneyOf = (value: unknown): MoneyValue | null => {
  if (!value || typeof value !== 'object') return null;
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  return typeof amount === 'string' && typeof currency === 'string' ? { amount, currency } : null;
};

function kovaOf(day: number | null, today: number): ZamanKovasi {
  if (day === null) return 'bilinmiyor';
  if (day < today) return 'gecmis';
  return day < today + HAFTA_GUN ? 'hafta' : 'sonra';
}

export function toOdemeRow(event: ForecastEvent, today: number): OdemeRow {
  const measures = (event.measures && typeof event.measures === 'object' ? event.measures : {}) as { planned?: unknown; actual?: unknown };
  const day = isoToDay(typeof event.occurred_on === 'string' ? event.occurred_on : null);
  const kova = kovaOf(day, today);
  const certaintyKey = typeof event.certainty === 'string' ? event.certainty : '';
  const kesinlik = KESINLIK[certaintyKey];
  let status: StatusLabel;
  if (kova === 'gecmis') status = { label: `Tarihi geçti · ${sayi.format(today - day!)} gün`, tone: 'uyari' };
  else if (kova === 'bilinmiyor') status = { label: TARIHI_BILINMIYOR, tone: 'uyari' };
  else status = kesinlik ?? { label: 'Tahmin', tone: 'notr' };
  const rawType = typeof event.event_type === 'string' ? event.event_type.trim() : '';
  const provenance = event.provenance;
  return {
    id: event.id,
    code: event.source_record_id || KOD_YOK,
    label: event.label || AD_YOK,
    type: OLAY_TURLERI[rawType] ?? (rawType || BILINMIYOR),
    typeKey: rawType || TUR_BILINMIYOR,
    day,
    dateText: day === null ? TARIHI_BILINMIYOR : dayToText(day),
    planned: moneyOf(measures.planned) ?? moneyOf(event.amount),
    actual: moneyOf(measures.actual),
    kova,
    status,
    certainty: kesinlik?.label ?? BILINMIYOR,
    source: provenance ? `${provenance.sheet_title} · satır ${sayi.format(provenance.row)}` : BILINMIYOR,
  };
}

/** Silinmiş olaylar listelenmez; kalanlar satır modeline çevrilir. */
export function toOdemeRows(events: readonly ForecastEvent[], today: number): OdemeRow[] {
  return events.filter(event => !event.deleted_at).map(event => toOdemeRow(event, today));
}

/** Zaman çizelgesi için RecordRow (tek tarih alanı). */
export const toRecordRow = (row: OdemeRow): RecordRow => ({
  id: row.id,
  code: row.code,
  label: row.label,
  status: row.status,
  category: row.type,
  planned: row.planned,
  actual: row.actual,
  dates: row.day === null ? {} : { paid: dayToIso(row.day) },
  kind: 'forecast_event',
});

// --- Grup ve sıralama --------------------------------------------------------------------------------------------
export interface Grup { key: string; label: string }

export function grupOf(row: OdemeRow, siralama: SiralamaAnahtari): Grup {
  if (row.kova === 'sonra' && siralama === 'tarih') return { key: `ay:${ayAnahtari(row.day!)}`, label: ayAdi(row.day!) };
  return { key: row.kova, label: KOVA_GRUP[row.kova] };
}

const tutarSayisi = (value: MoneyValue | null) => {
  if (!value) return null;
  const n = Number(value.amount);
  return Number.isFinite(n) ? n : null;
};

/** Kova sırası korunur; tarihe göre: geçmiş bugüne yakın önce, gelecek yakın önce. Tutara göre: büyükten küçüğe, tutarsız sonda. */
export function sirala(rows: readonly OdemeRow[], siralama: SiralamaAnahtari): OdemeRow[] {
  const kova = (row: OdemeRow) => KOVA_SIRASI.indexOf(row.kova);
  const tarih = (a: OdemeRow, b: OdemeRow) => {
    if (a.day === null || b.day === null) return 0;
    return a.kova === 'gecmis' ? b.day - a.day : a.day - b.day;
  };
  const tutar = (a: OdemeRow, b: OdemeRow) => {
    const x = tutarSayisi(a.planned);
    const y = tutarSayisi(b.planned);
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    return y - x;
  };
  const ad = (a: OdemeRow, b: OdemeRow) => a.label.localeCompare(b.label, 'tr-TR');
  return [...rows].sort((a, b) => kova(a) - kova(b) || (siralama === 'tutar' ? tutar(a, b) || tarih(a, b) : tarih(a, b)) || ad(a, b));
}

// --- Filtre ------------------------------------------------------------------------------------------------------
export type FiltreAnahtari = 'tarih' | 'tutar' | 'durum' | 'tur';
export type Secimler = Readonly<Record<FiltreAnahtari, readonly string[]>>;
export const BOS_SECIM: Secimler = { tarih: [], tutar: [], durum: [], tur: [] };
const FILTRE_ANAHTARLARI: readonly string[] = ['tarih', 'tutar', 'durum', 'tur'];
const RANGE_PREFIXES: readonly string[] = Object.values(RANGE_KEYS);

export const filtreAnahtariMi = (id: string): id is FiltreAnahtari => FILTRE_ANAHTARLARI.includes(id);

/** Aralık girdisi aynı önekli eskisini değiştirir (boş değer kaldırır); seçenek değeri iki durumlu. */
export function degistir(current: readonly string[], value: string): readonly string[] {
  const prefix = RANGE_PREFIXES.find(p => value.startsWith(p));
  if (prefix) {
    const rest = current.filter(entry => !entry.startsWith(prefix));
    return value.length > prefix.length ? [...rest, value] : rest;
  }
  return current.includes(value) ? current.filter(entry => entry !== value) : [...current, value];
}

interface Kosullar {
  q: string;
  baslangic: number | null;
  bitis: number | null;
  enAz: number | null;
  enCok: number | null;
  durumlar: readonly string[];
  turler: readonly string[];
}

function kosullar(arama: string, secim: Secimler): Kosullar {
  const enAz = parseMoneyInput(rangeValue(secim.tutar, RANGE_KEYS.enAz));
  const enCok = parseMoneyInput(rangeValue(secim.tutar, RANGE_KEYS.enCok));
  return {
    q: arama.trim().toLocaleLowerCase('tr-TR'),
    baslangic: trToDay(rangeValue(secim.tarih, RANGE_KEYS.baslangic)),
    bitis: trToDay(rangeValue(secim.tarih, RANGE_KEYS.bitis)),
    enAz: enAz === null ? null : Number(enAz),
    enCok: enCok === null ? null : Number(enCok),
    durumlar: secim.durum,
    turler: secim.tur,
  };
}

export function filtrele(rows: readonly OdemeRow[], arama: string, secim: Secimler): OdemeRow[] {
  const k = kosullar(arama, secim);
  return rows.filter(row => {
    if (k.q && !`${row.label} ${row.code} ${row.type}`.toLocaleLowerCase('tr-TR').includes(k.q)) return false;
    if (k.baslangic !== null && (row.day === null || row.day < k.baslangic)) return false;
    if (k.bitis !== null && (row.day === null || row.day > k.bitis)) return false;
    const tutar = tutarSayisi(row.planned);
    if (k.enAz !== null && (tutar === null || tutar < k.enAz)) return false;
    if (k.enCok !== null && (tutar === null || tutar > k.enCok)) return false;
    if (k.durumlar.length > 0 && !k.durumlar.includes(row.kova)) return false;
    if (k.turler.length > 0 && !k.turler.includes(row.typeKey)) return false;
    return true;
  });
}

const say = <K extends string>(rows: readonly OdemeRow[], key: (row: OdemeRow) => K) => {
  const counts = new Map<K, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return counts;
};

/** Filtre boyutları; her seçenekte sayım, "Bilinmiyor" ayrı değer (sayımı 0 olsa da). */
export function facetler(rows: readonly OdemeRow[], secim: Secimler): FilterFacet[] {
  const kovalar = say(rows, row => row.kova);
  const turler = say(rows, row => row.typeKey);
  const turEtiketi = new Map(rows.map(row => [row.typeKey, row.type] as const));
  const turSecenekleri = [...turEtiketi.entries()]
    .filter(([key]) => key !== TUR_BILINMIYOR)
    .sort((a, b) => a[1].localeCompare(b[1], 'tr-TR'))
    .map(([value, label]) => ({ value, label, count: turler.get(value) ?? 0 }));
  return [
    { id: 'tarih', label: 'Tarih', kind: 'date', options: [{ value: DATE_TYPE, label: 'Tahmini tarih' }], selected: secim.tarih },
    { id: 'tutar', label: 'Tutar (plan)', kind: 'amount', options: [], selected: secim.tutar },
    {
      id: 'durum', label: 'Durum', kind: 'checkbox', selected: secim.durum,
      options: KOVA_SIRASI.map(key => ({ value: key, label: KOVA_FILTRE[key], count: kovalar.get(key) ?? 0 })),
    },
    {
      id: 'tur', label: 'Tür', kind: 'checkbox', selected: secim.tur,
      options: [...turSecenekleri, { value: TUR_BILINMIYOR, label: BILINMIYOR, count: turler.get(TUR_BILINMIYOR) ?? 0 }],
    },
  ];
}

/** Etkin filtre etiketleri (kaldırılabilir). onRemove(facet, value) sayfanın değiştirme işlevidir. */
export function etkinFiltreler(
  secim: Secimler,
  turEtiketi: (key: string) => string,
  kaldir: (facet: FiltreAnahtari, value: string) => void,
  temizle: (facet: FiltreAnahtari) => void,
): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  const baslangic = rangeValue(secim.tarih, RANGE_KEYS.baslangic);
  const bitis = rangeValue(secim.tarih, RANGE_KEYS.bitis);
  if (baslangic && bitis) out.push({ id: 'tarih', label: `Tarih: ${baslangic} – ${bitis}`, onRemove: () => temizle('tarih') });
  else if (baslangic) out.push({ id: 'tarih-b', label: `Tarih: ${baslangic} ve sonrası`, onRemove: () => kaldir('tarih', RANGE_KEYS.baslangic) });
  else if (bitis) out.push({ id: 'tarih-s', label: `Tarih: ${bitis} ve öncesi`, onRemove: () => kaldir('tarih', RANGE_KEYS.bitis) });
  const enAz = parseMoneyInput(rangeValue(secim.tutar, RANGE_KEYS.enAz));
  const enCok = parseMoneyInput(rangeValue(secim.tutar, RANGE_KEYS.enCok));
  if (enAz !== null) out.push({ id: 'enaz', label: `Tutar: en az ${formatMoney({ amount: enAz, currency: 'TRY' })}`, onRemove: () => kaldir('tutar', RANGE_KEYS.enAz) });
  if (enCok !== null) out.push({ id: 'encok', label: `Tutar: en çok ${formatMoney({ amount: enCok, currency: 'TRY' })}`, onRemove: () => kaldir('tutar', RANGE_KEYS.enCok) });
  for (const value of secim.durum) {
    if ((KOVA_SIRASI as readonly string[]).includes(value)) {
      out.push({ id: `durum-${value}`, label: `Durum: ${KOVA_FILTRE[value as ZamanKovasi]}`, onRemove: () => kaldir('durum', value) });
    }
  }
  for (const value of secim.tur) out.push({ id: `tur-${value}`, label: `Tür: ${turEtiketi(value)}`, onRemove: () => kaldir('tur', value) });
  return out;
}

// --- Ödeme kaynağı ve özet ---------------------------------------------------------------------------------------
export type OdemeKaynagi = { durum: 'bilinmiyor' } | { durum: 'yok' } | { durum: 'var'; sayi: number };

/** Manifest okunmadan kaynak hakkında hüküm verilmez; payments koleksiyonu yoksa "yok". */
export function odemeKaynagi(manifest: Manifest | null): OdemeKaynagi {
  if (!manifest) return { durum: 'bilinmiyor' };
  const dosyalar = manifest.files.filter(file => file.collection === 'payments');
  const sayim = manifest.counts.payments ?? dosyalar.reduce((total, file) => total + (file.count ?? 0), 0);
  return sayim > 0 || dosyalar.length > 0 ? { durum: 'var', sayi: sayim } : { durum: 'yok' };
}

export function odemeKaynagiMetni(kaynak: OdemeKaynagi): string {
  if (kaynak.durum === 'yok') return KAYNAKTA_ODEME_YOK;
  if (kaynak.durum === 'var') return `Kaynakta ${sayi.format(kaynak.sayi)} ödeme kaydı var; panel bunları okumuyor`;
  return 'Ödeme kaynağı bilinmiyor';
}

/** Tutar toplamı metni: tek para birimi → ₺; birden çok → adıyla; hiç okunur tutar yok → "Bilinmiyor". */
function toplamMetni(values: readonly (MoneyValue | null)[]): { metin: string; eksik: number } {
  const total = sumMoney(values.map(value => value ?? undefined));
  if (total.money) return { metin: formatMoney(total.money, BILINMIYOR), eksik: total.missing };
  return { metin: total.currencies.length > 1 ? MIXED_CURRENCY_TEXT : BILINMIYOR, eksik: total.missing };
}

/** Üç özet ölçüsü; plan ve gerçek ayrı adlandırılır, gerçek ödeme bilinmediği için "Bilinmiyor" der. */
export function ozet(rows: readonly OdemeRow[], kaynak: OdemeKaynagi): PageHeaderSummary[] {
  const gecmis = rows.filter(row => row.kova === 'gecmis');
  const gecmisToplam = toplamMetni(gecmis.map(row => row.planned));
  const gecmisNot = gecmis.length === 0 ? 'Tarihi geçen tahmin yok'
    : `${sayi.format(gecmis.length)} tahmin · ödeme durumu bilinmiyor${gecmisToplam.eksik > 0 ? ` · ${sayi.format(gecmisToplam.eksik)} tutar bilinmiyor` : ''}`;
  const siradaki = rows
    .filter(row => row.kova === 'hafta' || row.kova === 'sonra')
    .reduce<OdemeRow | null>((best, row) => (best === null || row.day! < best.day! ? row : best), null);
  return [
    { label: 'Tarihi geçen (plan)', value: gecmis.length === 0 ? YOK : gecmisToplam.metin, note: gecmisNot },
    siradaki
      ? { label: 'Sıradaki (plan)', value: formatMoney(siradaki.planned, BILINMIYOR), note: `${siradaki.dateText} · ${siradaki.type}` }
      : { label: 'Sıradaki (plan)', value: YOK, note: 'Tarihi gelecek tahmin yok' },
    { label: 'Yapılan (gerçek)', value: BILINMIYOR, note: odemeKaynagiMetni(kaynak) },
  ];
}

// --- Sayım ve sayfalama metinleri --------------------------------------------------------------------------------
export function sayimMetni(rows: readonly OdemeRow[]): string {
  const gecmis = rows.filter(row => row.kova === 'gecmis').length;
  return `${sayi.format(rows.length)} tahmini ödeme${gecmis > 0 ? ` · ${sayi.format(gecmis)} tarihi geçti` : ''}`;
}
export const gosterilenMetni = (gosterilen: number, toplam: number) => `Gösterilen ${sayi.format(gosterilen)} / ${sayi.format(toplam)}`;
export const dahaFazlaMetni = (kalan: number, adim: number) => `${sayi.format(Math.min(kalan, adim))} tahmini ödeme daha göster`;
