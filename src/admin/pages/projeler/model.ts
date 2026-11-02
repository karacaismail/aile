import { BUDGET_TIME_ZONE, sumMoney, toneForCode, type PurchaseNeedRecord, type TaskTemplate, type Term, type WorkflowDefinition } from '../../data';
import type { Money, RecordRow, StatusLabel, SortOption, Tone } from '../../shell/contracts';
import { formatMoney } from '../../ui/Money';

// Projeler ve görevler sayfasının saf modeli (React yok): telefon sunumu ve geniş modül (lazyWide) aynı veriyi buradan
// alır. Veri: nesilde proje koleksiyonu yok; görev = work_orders + milestones (app_kalemler gövdesi). "Proje" kaynakta
// ayrı kayıt olmadığından görevlerin proje aşaması (phase sözlüğü, ör. "Taşınma öncesi") ile toplanır; aşaması
// olmayan görevler "Bilinmiyor" projesindedir (eksik bilgi adıyla). Plan ve gerçek hiçbir yerde tek sayıda birleşmez.
// Para toplamı kesin ondalıkla (actuals.sumMoney, bigint; Number×100 ve Math.round yok), biçim ui/Money formatMoney.
// "Bugün" ve "Gecikti" Europe/Istanbul takvim günüyle (Genel ve Ödemeler ile aynı; cihazın saat dilimi değil).

export const BILINMIYOR = 'Bilinmiyor';
export const FIYAT_YOK = 'Fiyat yok';
export const HENUZ_YOK = 'Henüz yok';
export const TARIH_YOK = 'Tarih yok';
export const GECIKTI = 'Gecikti';

/** Görev türü adları (kind → sözcük). */
const TUR_ADI: Record<string, string> = { work_order: 'İş', milestone: 'Kilometre taşı' };
export const TUR_IS = 'work_order';
export const TUR_TAS = 'milestone';

/** Teslimat ekseninde "bitti" sayılan kodlar; iptal kararı da kapatır. Gerisi açık görevdir. */
const BITTI_KODLARI = new Set(['installed', 'delivered', 'done', 'completed']);
const IPTAL_KODLARI = new Set(['cancelled', 'iptal']);

export const sayi = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;

// --- Tarih -------------------------------------------------------------------------------------------
const GUN_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** "2026-12-03" → UTC gün (saat dilimi kaymaz); geçersizse null. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

const iki = (n: number) => String(n).padStart(2, '0');
/** 28.10.2026 */
export const tarihMetni = (date: Date) => `${iki(date.getUTCDate())}.${iki(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
/** 28.10 (hafta başlığı). */
const haftaMetni = (date: Date) => `${iki(date.getUTCDate())}.${iki(date.getUTCMonth() + 1)}`;
/** ISO tarih → "28.10.2026" ya da "Tarih yok". */
export const tarihVeyaYok = (value: string | null | undefined) => {
  const date = parseIsoDate(value);
  return date ? tarihMetni(date) : TARIH_YOK;
};
/** İki uç → "03.11.2026 – 20.06.2027"; biri yoksa adıyla ("Bitiş yok"), ikisi de yoksa "Tarih yok". */
export function aralikMetni(start: string | null, end: string | null): string {
  if (!start && !end) return TARIH_YOK;
  return `${start ? tarihVeyaYok(start) : 'Başlangıç yok'} – ${end ? tarihVeyaYok(end) : 'Bitiş yok'}`;
}

const istanbulGunu = new Intl.DateTimeFormat('en-CA', { timeZone: BUDGET_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Anın Europe/Istanbul takvim günü → UTC gün (saate değil güne bakılır). Geçersiz an RangeError (gün uydurulmaz). */
export function todayUtc(now: Date): Date {
  if (Number.isNaN(now.getTime())) throw new RangeError('Hata: geçersiz tarih; bugün belirlenemedi.');
  const parts = istanbulGunu.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
}

function monday(date: Date): Date {
  const shift = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - shift * GUN_MS);
}

// --- Para toplamı (plan ve gerçek ayrı toplanır) -----------------------------------------------------
export interface Toplam { parts: string[]; eksik: number }

/** Para birimine göre ayrı, kesin toplam (sumMoney); tutarı olmayan ya da bozuk kayıt "eksik" sayılır. */
export function topla(values: readonly RecordRow['planned'][]): Toplam {
  const perCurrency = new Map<string, Money[]>();
  let eksik = 0;
  for (const value of values) {
    if (!value || !DECIMAL.test(value.amount.trim())) { eksik += 1; continue; }
    // Birim kodu sumMoney ile aynı biçimde (kırpılmış, büyük harf) gruplanır: "try" ve "TRY" tek toplamdır.
    const currency = value.currency.trim().toUpperCase();
    const list = perCurrency.get(currency) ?? [];
    list.push({ amount: value.amount.trim(), currency });
    perCurrency.set(currency, list);
  }
  return { parts: [...perCurrency.values()].map(list => formatMoney(sumMoney(list).money)), eksik };
}

/** Toplamın metni; hiç tutar yoksa eksiklik adı ("Fiyat yok", "Henüz yok"). */
export const toplamMetni = (toplam: Toplam, yok: string) => (toplam.parts.length ? toplam.parts.join(' · ') : yok);

// --- Görev satırı ------------------------------------------------------------------------------------
export interface GorevSatiri extends RecordRow {
  /** Kaynak kodu (attributes.kod), yoksa kayıt kodu. */
  kod: string;
  tur: string;
  startOn: string | null;
  endOn: string | null;
  acik: boolean;
  gecikti: boolean;
  /** Proje = proje aşaması terimi; aşaması yoksa '' (BILINMEYEN_PROJE). */
  projeId: string;
  projeAdi: string;
}

/** Aşaması olmayan (ya da sözlükte bulunmayan) görevlerin ortak projesi. */
export const BILINMEYEN_PROJE = '';

function acikMi(record: PurchaseNeedRecord): boolean {
  const snapshot = record.state_snapshot ?? { decision: null, fulfillment: null, inspection: null, payment: null };
  if (snapshot.decision && IPTAL_KODLARI.has(snapshot.decision)) return false;
  if (snapshot.fulfillment && (BITTI_KODLARI.has(snapshot.fulfillment) || IPTAL_KODLARI.has(snapshot.fulfillment))) return false;
  return true;
}

function kaynakKodu(record: PurchaseNeedRecord | undefined, fallback: string): string {
  const kod = record?.attributes?.kod ?? record?.source_attributes?.kod;
  return typeof kod === 'string' && kod.trim() !== '' ? kod.trim() : fallback;
}

/** Terim kimliği → etiket (proje aşaması); yoksa undefined. */
export type AsamaAdi = (termId: string) => string | undefined;

export function gorevSatirlari(rows: readonly RecordRow[], records: readonly PurchaseNeedRecord[], today: Date, asamaAdi: AsamaAdi = () => undefined): GorevSatiri[] {
  const byId = new Map(records.map(record => [record.id, record] as const));
  return rows.map(row => {
    const record = byId.get(row.id);
    const startOn = record?.dates?.planned_on ?? null;
    const endOn = record?.dates?.end_on ?? null;
    const acik = record ? acikMi(record) : true;
    const end = parseIsoDate(endOn);
    const phaseId = record?.phase_term_id ?? null;
    const phaseLabel = phaseId ? asamaAdi(phaseId) : undefined;
    return {
      ...row,
      kod: kaynakKodu(record, row.code),
      tur: TUR_ADI[row.kind] ?? row.kind,
      startOn,
      endOn,
      acik,
      gecikti: acik && end !== null && end.getTime() < today.getTime(),
      projeId: phaseId && phaseLabel ? phaseId : BILINMEYEN_PROJE,
      projeAdi: phaseId && phaseLabel ? phaseLabel : BILINMIYOR,
    };
  });
}

const kucukHarf = (text: string) => text.toLocaleLowerCase('tr-TR');

export function aramaEslesir(row: GorevSatiri, search: string): boolean {
  const needle = kucukHarf(search.trim());
  if (!needle) return true;
  return [row.label, row.kod, row.code, row.owner ?? '', row.room ?? '', row.projeAdi].some(field => kucukHarf(field).includes(needle));
}

export const SIRALAMALAR: readonly SortOption[] = [
  { key: 'start', label: 'Başlangıca göre', direction: 'asc' },
  { key: 'end', label: 'Bitişe göre', direction: 'asc' },
];

/** Tarihe göre kararlı sıralama; tarihsizler sonda. */
export function tariheGoreSirala<R extends Pick<GorevSatiri, 'startOn' | 'endOn'>>(rows: readonly R[], sort: SortOption = SIRALAMALAR[0]!): R[] {
  const key: 'startOn' | 'endOn' = sort.key === 'end' ? 'endOn' : 'startOn';
  return [...rows].sort((a, b) => {
    const da = a[key];
    const db = b[key];
    if (da === db) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return sort.direction === 'desc' ? db.localeCompare(da) : da.localeCompare(db);
  });
}

// --- Projeler (proje aşamasına göre) -------------------------------------------------------------------
export interface Proje {
  id: string;
  ad: string;
  /** Başlangıca göre sıralı görevler. */
  gorevler: readonly GorevSatiri[];
  acik: number;
  geciken: number;
  bitti: number;
  /** En erken başlangıç / en geç bitiş (ISO); yoksa null. */
  baslangic: string | null;
  bitis: string | null;
  planlanan: Toplam;
  gerceklesen: Toplam;
}

/** Görevleri projelere toplar. Sıra: en erken başlangıca göre ("hangi sırayla"), tarihsiz proje sonra, "Bilinmiyor" en sonda. */
export function projeGruplari(gorevler: readonly GorevSatiri[]): Proje[] {
  const gruplar = new Map<string, GorevSatiri[]>();
  for (const gorev of gorevler) {
    const list = gruplar.get(gorev.projeId);
    if (list) list.push(gorev);
    else gruplar.set(gorev.projeId, [gorev]);
  }
  const projeler = [...gruplar.entries()].map(([id, list]): Proje => {
    const sirali = tariheGoreSirala(list);
    const starts = sirali.map(row => row.startOn).filter((value): value is string => Boolean(value)).sort();
    const ends = sirali.map(row => row.endOn).filter((value): value is string => Boolean(value)).sort();
    return {
      id,
      ad: sirali[0]!.projeAdi,
      gorevler: sirali,
      acik: sirali.filter(row => row.acik).length,
      geciken: sirali.filter(row => row.gecikti).length,
      bitti: sirali.filter(row => !row.acik).length,
      baslangic: starts[0] ?? null,
      bitis: ends[ends.length - 1] ?? null,
      planlanan: topla(sirali.map(row => row.planned)),
      gerceklesen: topla(sirali.map(row => row.actual)),
    };
  });
  const rank = (proje: Proje) => (proje.id === BILINMEYEN_PROJE ? 2 : proje.baslangic ? 0 : 1);
  return projeler.sort((a, b) => rank(a) - rank(b)
    || (a.baslangic && b.baslangic ? a.baslangic.localeCompare(b.baslangic) : 0)
    || a.ad.localeCompare(b.ad, 'tr-TR'));
}

/** "10 görev · 7 açık · 1 geciken" (geciken yalnız varsa). */
export function projeOzeti(proje: Proje): string {
  const parcalar = [`${sayi.format(proje.gorevler.length)} görev`, `${sayi.format(proje.acik)} açık`];
  if (proje.geciken > 0) parcalar.push(`${sayi.format(proje.geciken)} geciken`);
  return parcalar.join(' · ');
}

/** Telefondaki "Göster" seçimi: proje görevlerini duruma göre daraltır. */
export type GorevKumesi = 'tum' | 'acik' | 'geciken' | 'biten';
export const GOREV_KUMELERI: readonly { key: GorevKumesi; label: string; test(row: GorevSatiri): boolean }[] = [
  { key: 'tum', label: 'Tüm görevler', test: () => true },
  { key: 'acik', label: 'Açık görevler', test: row => row.acik },
  { key: 'geciken', label: 'Geciken görevler', test: row => row.gecikti },
  { key: 'biten', label: 'Biten görevler', test: row => !row.acik },
];

// --- Kanban sütunları (teslimat iş akışı) -------------------------------------------------------------
/** workflows › key "fulfillment" geçişlerinin sırasıyla terimler; iş akışı yoksa undefined (Kanban kayıttan türetir). */
export function workflowColumns(workflows: readonly WorkflowDefinition[], terms: readonly Term[], key = 'fulfillment'): StatusLabel[] | undefined {
  const workflow = workflows.find(item => item.key === key);
  if (!workflow || !Array.isArray(workflow.transitions)) return undefined;
  const termsById = new Map(terms.map(term => [term.id, term] as const));
  const seen = new Set<string>();
  const columns: StatusLabel[] = [];
  for (const transition of workflow.transitions) {
    for (const id of [transition.from_term_id, transition.to_term_id]) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const term = termsById.get(id);
      if (term) columns.push({ label: term.label, tone: toneForCode(term.code) });
    }
  }
  return columns.length ? columns : undefined;
}

// --- Gantt planı ---------------------------------------------------------------------------------------
export interface GanttInput {
  id: string;
  label: string;
  start?: string | null;
  end?: string | null;
  /** Ad altındaki ikinci satır (kod · durum). */
  meta?: string;
  tone?: Tone;
  late?: boolean;
  /** Proje satırı (görevlerin üstünde, kalın; çubuğu aşamanın ilk başlangıcından son bitişine). */
  group?: boolean;
}
export interface GanttWeek { label: string; start: Date; current: boolean }
export interface GanttBar extends GanttInput { startWeek: number; endWeek: number; startText: string; endText: string }
export interface GanttPlan { weeks: GanttWeek[]; dated: GanttBar[]; undated: GanttInput[] }

/** Başlangıç ve bitişi olan (ve sıralı) kayıtlar haftalara oturur; gerisi "Tarihsiz". Haftalar bugünün pazartesisinden ya da en erken başlangıçtan en geç bitişe. */
export function ganttPlan(rows: readonly GanttInput[], now: Date): GanttPlan {
  const today = todayUtc(now);
  const dated: { row: GanttInput; start: Date; end: Date }[] = [];
  const undated: GanttInput[] = [];
  for (const row of rows) {
    const start = parseIsoDate(row.start);
    const end = parseIsoDate(row.end);
    if (start && end && end.getTime() >= start.getTime()) dated.push({ row, start, end });
    else undated.push(row);
  }
  const thisMonday = monday(today);
  let first = thisMonday;
  let last = thisMonday;
  for (const { start, end } of dated) {
    const s = monday(start);
    const e = monday(end);
    if (s.getTime() < first.getTime()) first = s;
    if (e.getTime() > last.getTime()) last = e;
  }
  const count = Math.round((last.getTime() - first.getTime()) / (7 * GUN_MS)) + 1;
  const weeks: GanttWeek[] = Array.from({ length: count }, (_, index) => {
    const start = new Date(first.getTime() + index * 7 * GUN_MS);
    return { label: haftaMetni(start), start, current: start.getTime() === thisMonday.getTime() };
  });
  const weekIndex = (date: Date) => Math.round((monday(date).getTime() - first.getTime()) / (7 * GUN_MS));
  return {
    weeks,
    dated: dated.map(({ row, start, end }) => ({
      ...row,
      startWeek: weekIndex(start),
      endWeek: weekIndex(end),
      startText: tarihMetni(start),
      endText: tarihMetni(end),
    })),
    undated,
  };
}

/** Tarihsiz listede neyin eksik olduğu adıyla. */
export function eksikTarih(row: GanttInput): string {
  const start = parseIsoDate(row.start);
  const end = parseIsoDate(row.end);
  if (start && end) return 'Bitiş başlangıçtan önce';
  if (start) return 'Bitiş yok';
  if (end) return 'Başlangıç yok';
  return TARIH_YOK;
}

/** Projeye göre gruplu Gantt girdisi: her proje satırı, altında başlangıca göre görevleri. */
export function ganttGirdileri(gorevler: readonly GorevSatiri[]): GanttInput[] {
  return projeGruplari(gorevler).flatMap(proje => [
    { id: `proje:${proje.id || 'bilinmiyor'}`, label: proje.ad, start: proje.baslangic, end: proje.bitis, meta: `Proje aşaması · ${projeOzeti(proje)}`, group: true },
    ...proje.gorevler.map(row => ({
      id: row.id,
      label: row.label,
      start: row.startOn,
      end: row.endOn,
      meta: `${row.kod} · ${row.status.label}`,
      tone: row.status.tone,
      late: row.gecikti,
    })),
  ]);
}

// --- Kontroller ----------------------------------------------------------------------------------------
export type KontrolSonucu = 'gecti' | 'kaldi' | 'eksik' | 'bilinmiyor';
export const SONUC: Record<KontrolSonucu, StatusLabel> = {
  gecti: { label: 'Geçti', tone: 'olumlu' },
  kaldi: { label: 'Kaldı', tone: 'hata' },
  eksik: { label: 'Eksik', tone: 'uyari' },
  bilinmiyor: { label: BILINMIYOR, tone: 'notr' },
};

export interface KontrolSatiri extends RecordRow { kod: string; sonuc: KontrolSonucu }

/** Kontrol yapıldı (inspection completed) ile kontrol geçti (attributes.tamam) ayrı alanlardır; biri diğerinden türetilmez. */
export function kontrolSonucu(record: PurchaseNeedRecord | undefined): KontrolSonucu {
  if (!record) return 'bilinmiyor';
  const state = record.state_snapshot?.inspection ?? null;
  if (state !== 'completed') return 'eksik';
  const tamam = record.attributes?.tamam ?? record.source_attributes?.tamam;
  if (tamam === true) return 'gecti';
  if (tamam === false) return 'kaldi';
  return 'bilinmiyor';
}

export function kontrolSatirlari(rows: readonly RecordRow[], records: readonly PurchaseNeedRecord[]): KontrolSatiri[] {
  const byId = new Map(records.map(record => [record.id, record] as const));
  return rows.map(row => {
    const record = byId.get(row.id);
    return { ...row, kod: kaynakKodu(record, row.code), sonuc: kontrolSonucu(record) };
  });
}

// --- Görev şablonları ----------------------------------------------------------------------------------
export interface SablonGorunumu {
  id: string;
  /** Kullanıcıya görünen Türkçe ad; yoksa "Adı bilinmiyor" (ham anahtar başlık olmaz). */
  baslik: string;
  /** "Sürüm 1" ya da "Sürüm bilinmiyor". */
  surum: string;
  kosul: string;
  /** Önce yapılacak şablonların Türkçe adları. */
  once: readonly string[];
  kabul: readonly string[];
  /** Ham makine anahtarı: yalnız ayrıntıda, "Teknik anahtar" etiketiyle. */
  anahtar: string;
}

export const ADI_BILINMIYOR = 'Adı bilinmiyor';
const KOSUL_YOK = 'Koşul yazılmamış';

const metin = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const metinler = (value: unknown): string[] => (Array.isArray(value) ? value.map(metin).filter((item): item is string => Boolean(item)) : []);

/** Şablonları Türkçe adla görünüme çevirir ve ada göre sıralar. Bağımlılıklar kimlikten Türkçe ada çözülür. */
export function sablonGorunumleri(sablonlar: readonly TaskTemplate[]): SablonGorunumu[] {
  const baslikOf = (sablon: TaskTemplate) => metin(sablon['title']) ?? ADI_BILINMIYOR;
  const byId = new Map(sablonlar.map(sablon => [sablon.id, sablon] as const));
  return sablonlar
    .map(sablon => {
      const ids = Array.isArray(sablon.dependency_template_ids) ? sablon.dependency_template_ids : [];
      const version = sablon.version;
      return {
        id: sablon.id,
        baslik: baslikOf(sablon),
        surum: typeof version === 'number' && Number.isFinite(version) ? `Sürüm ${sayi.format(version)}` : 'Sürüm bilinmiyor',
        kosul: metin(sablon['applies_when']) ?? KOSUL_YOK,
        once: ids.map(id => {
          const dep = byId.get(id);
          return dep ? baslikOf(dep) : BILINMIYOR;
        }),
        kabul: metinler(sablon['acceptance_criteria']),
        anahtar: sablon.key,
      };
    })
    .sort((a, b) => a.baslik.localeCompare(b.baslik, 'tr-TR'));
}
