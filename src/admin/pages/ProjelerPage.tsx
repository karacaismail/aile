import { useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  toneForCode,
  useCollection,
  useGeneration,
  useRows,
  type PurchaseNeedRecord,
  type TaskTemplate,
  type Term,
  type WorkflowDefinition,
} from '../data';
import { useDevice } from '../device';
import type {
  ActiveFilter,
  DataStatusProps,
  FilterFacet,
  PageHeaderSummary,
  RecordRow,
  ResponsiveColumn,
  SortOption,
  StatusLabel,
  Tone,
  ViewMode,
} from '../shell/contracts';
import { FilterDrawer } from '../shell/FilterDrawer';
import { FilterPanel } from '../shell/FilterPanel';
import { PageHeader } from '../shell/PageHeader';
import { QueryBar } from '../shell/QueryBar';
import { EmptyState, ErrorState, FilterArea, Kanban, LoadingShell, Money, ResponsiveTable, StatusText } from '../ui';
import './ProjelerPage.css';

// Projeler ve görevler. Tasarım: README.md › Sayfa iskeleti, bundle.js › Pages.Projeler (section "İşler", amaç cümlesi,
// özet 3 ölçü, sorgu çubuğu mod gantt, Pivot kapalı "projelerde toplanacak tutar alanı yok", Gantt haftalık ızgara: ad
// sütunu solda yapışkan 280 px / telefonda 148 px, hafta 64 / 56 px, "Bu hafta" sütunu bilgi yüzeyi, çubuk tıklanır,
// tarih sürüklemeyle değişmez). Veri: nesilde proje koleksiyonu yok; görev = work_orders + milestones (app_kalemler
// gövdesi, kind work_order / milestone). inspections ayrı bölümde sonuçla (geçti / kaldı / eksik ayrı), task_templates
// ayrı bölümde ve gerçek görev değil (proposed_template). Plan ve gerçek hiçbir yerde tek sayıda birleşmez; eksik bilgi
// adıyla yazılır ("Fiyat yok", "Henüz yok", "Bilinmiyor", "Tarih yok"). Yazma yok: ekleme/değiştirme bu dilimde değil,
// işlevsiz düğme çizilmez. Renk ve ölçü yalnız ProjelerPage.css'te --aile tokenlarıyla.

const LOCATION = '/projeler';
const KONUM_BOLUM = 'İşler';
const BASLIK = 'Projeler ve görevler';
const AMAC = 'Ev projelerini ve görevlerini kim, ne zaman ve hangi sırayla yapacak, görün.';

const BILINMIYOR = 'Bilinmiyor';
const FIYAT_YOK = 'Fiyat yok';
const HENUZ_YOK = 'Henüz yok';
const TARIH_YOK = 'Tarih yok';
const GOREVLER = 'Görevler';
const KONTROLLER = 'Kontroller';
const SABLONLAR = 'Önerilen görev şablonları';
const TARIHSIZ = 'Tarihsiz';
const KANBAN_ETIKET = 'Duruma göre görevler';
const GANTT_ETIKET = 'Gantt çizelgesi, yana kaydırılabilir';
const BU_HAFTA = 'Bu hafta';
const GECIKTI = 'Gecikti';

const KAYNAKTA_GOREV_YOK = 'Kaynakta görev kaydı yok';
const KAYNAKTA_KONTROL_YOK = 'Kaynakta kontrol kaydı yok';
const KAYNAKTA_SABLON_YOK = 'Kaynakta görev şablonu yok';

/** Görev türü adları (kind → sözcük). */
const TUR_ADI: Record<string, string> = { work_order: 'İş', milestone: 'Kilometre taşı' };
const TUR_IS = 'work_order';
const TUR_TAS = 'milestone';

/** Teslimat ekseninde "bitti" sayılan kodlar; iptal kararı da kapatır. Gerisi açık görevdir. */
const BITTI_KODLARI = new Set(['installed', 'delivered', 'done', 'completed']);
const IPTAL_KODLARI = new Set(['cancelled', 'iptal']);

const SUPPORTED: readonly ViewMode[] = ['table', 'kanban', 'gantt_chart'];
const UNSUPPORTED: Partial<Record<ViewMode, string>> = {
  listing: 'görevlerin fotoğraflı liste satırı yok; tablo aynı bilgiyi verir',
  timeline: 'görevlerin olay akışı yok',
  pivot: 'görevlerde toplanacak tutar alanı yok',
};
const SORTS: readonly SortOption[] = [
  { key: 'start', label: 'Başlangıca göre', direction: 'asc' },
  { key: 'end', label: 'Bitişe göre', direction: 'asc' },
];

const sayi = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

// --- Tarih -------------------------------------------------------------------------------------------
const GUN_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** "2026-12-03" → UTC gün (saat dilimi kaymaz); geçersizse null. */
function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

const iki = (n: number) => String(n).padStart(2, '0');
/** 28.10.2026 */
const tarihMetni = (date: Date) => `${iki(date.getUTCDate())}.${iki(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
/** 28.10 (hafta başlığı). */
const haftaMetni = (date: Date) => `${iki(date.getUTCDate())}.${iki(date.getUTCMonth() + 1)}`;
/** ISO tarih → "28.10.2026" ya da "Tarih yok". */
const tarihVeyaYok = (value: string | null | undefined) => {
  const date = parseIsoDate(value);
  return date ? tarihMetni(date) : TARIH_YOK;
};

/** Yerel takvim günü → UTC gün (now'un saatine değil gününe bakılır). */
function todayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function monday(date: Date): Date {
  const shift = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - shift * GUN_MS);
}

// --- Para toplamı (yalnız özet; plan ve gerçek ayrı toplanır) -----------------------------------------
interface Toplam { parts: string[]; eksik: number }

function toMinor(amount: string): number | null {
  if (!DECIMAL.test(amount.trim())) return null;
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

function paraMetni(minor: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  const value = minor / 100;
  if (CURRENCY_CODE.test(code)) {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }
  return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${currency.trim()}`.trim();
}

/** Para birimine göre ayrı toplam; tutarı olmayan ya da bozuk kayıt "eksik" sayılır. */
function topla(values: readonly (RecordRow['planned'])[]): Toplam {
  const perCurrency = new Map<string, number>();
  let eksik = 0;
  for (const value of values) {
    const minor = value ? toMinor(value.amount) : null;
    if (!value || minor === null) { eksik += 1; continue; }
    perCurrency.set(value.currency, (perCurrency.get(value.currency) ?? 0) + minor);
  }
  return { parts: [...perCurrency.entries()].map(([currency, minor]) => paraMetni(minor, currency)), eksik };
}

// --- Görev satırı ------------------------------------------------------------------------------------
export interface GorevSatiri extends RecordRow {
  /** Kaynak kodu (attributes.kod), yoksa kayıt kodu. */
  kod: string;
  tur: string;
  startOn: string | null;
  endOn: string | null;
  acik: boolean;
  gecikti: boolean;
}

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

function gorevSatirlari(rows: readonly RecordRow[], records: readonly PurchaseNeedRecord[], today: Date): GorevSatiri[] {
  const byId = new Map(records.map(record => [record.id, record] as const));
  return rows.map(row => {
    const record = byId.get(row.id);
    const startOn = record?.dates?.planned_on ?? null;
    const endOn = record?.dates?.end_on ?? null;
    const acik = record ? acikMi(record) : true;
    const end = parseIsoDate(endOn);
    return {
      ...row,
      kod: kaynakKodu(record, row.code),
      tur: TUR_ADI[row.kind] ?? row.kind,
      startOn,
      endOn,
      acik,
      gecikti: acik && end !== null && end.getTime() < today.getTime(),
    };
  });
}

const kucukHarf = (text: string) => text.toLocaleLowerCase('tr-TR');

function aramaEslesir(row: GorevSatiri, search: string): boolean {
  const needle = kucukHarf(search.trim());
  if (!needle) return true;
  return [row.label, row.kod, row.code, row.owner ?? '', row.room ?? ''].some(field => kucukHarf(field).includes(needle));
}

function tariheGoreSirala(rows: readonly GorevSatiri[], sort: SortOption): GorevSatiri[] {
  const key: 'startOn' | 'endOn' = sort.key === 'end' ? 'endOn' : 'startOn';
  return [...rows].sort((a, b) => {
    const da = a[key];
    const db = b[key];
    if (da === db) return 0;
    if (da === null) return 1; // tarihsizler sonda
    if (db === null) return -1;
    return sort.direction === 'desc' ? db.localeCompare(da) : da.localeCompare(db);
  });
}

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

function eksikTarih(row: GanttInput): string {
  const start = parseIsoDate(row.start);
  const end = parseIsoDate(row.end);
  if (start && end) return 'Bitiş başlangıçtan önce';
  if (start) return 'Bitiş yok';
  if (end) return 'Başlangıç yok';
  return TARIH_YOK;
}

interface GanttProps { plan: GanttPlan; narrow: boolean }

function Gantt({ plan, narrow }: GanttProps) {
  const { weeks, dated, undated } = plan;
  const style = { '--aile-projeler-hafta-sayisi': weeks.length } as CSSProperties;
  return (
    <div className="aile-projeler-gantt-alan" data-narrow={narrow ? 'true' : 'false'}>
      <div className="aile-projeler-gantt" role="region" aria-label={GANTT_ETIKET} tabIndex={0} data-narrow={narrow ? 'true' : 'false'}>
        {dated.length === 0 ? (
          <p className="aile-projeler-not">Çizelgede gösterilecek başlangıç ve bitiş tarihli görev yok.</p>
        ) : (
          <table className="aile-projeler-gantt__tablo" style={style}>
            <caption className="aile-projeler-gizli">Gantt çizelgesi</caption>
            <thead>
              <tr>
                <th scope="col" className="aile-projeler-gantt__ad aile-projeler-gantt__baslik">Görev</th>
                {weeks.map(week => (
                  <th key={week.label + week.start.getTime()} scope="col" className="aile-projeler-gantt__hafta" data-current={week.current ? 'true' : undefined}>
                    <span>{week.label}</span>
                    {week.current ? <span className="aile-projeler-gantt__simdi aile-kucuk">{BU_HAFTA}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dated.map(bar => (
                <tr key={bar.id}>
                  <th scope="row" className="aile-projeler-gantt__ad">
                    <span className="aile-projeler-gantt__etiket">{bar.label}</span>
                    {bar.meta ? <span className="aile-projeler-gantt__meta aile-kucuk aile-ikincil">{bar.meta}</span> : null}
                  </th>
                  <td className="aile-projeler-gantt__iz" colSpan={weeks.length}>
                    <span className="aile-projeler-gantt__izgara">
                      <span
                        role="img"
                        aria-label={`${bar.label}: ${bar.startText} – ${bar.endText}`}
                        className="aile-projeler-gantt__cubuk"
                        data-tone={bar.tone ?? 'notr'}
                        data-late={bar.late ? 'true' : undefined}
                        style={{ gridColumn: `${bar.startWeek + 1} / ${bar.endWeek + 2}` }}
                      >
                        <span aria-hidden="true">{bar.late ? GECIKTI : `${bar.startText} – ${bar.endText}`}</span>
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <section className="aile-projeler-tarihsiz" aria-label={TARIHSIZ}>
        <h3 className="aile-projeler-tarihsiz__baslik">{TARIHSIZ}</h3>
        {undated.length === 0 ? (
          <p className="aile-ikincil aile-projeler-not">Tarihsiz kayıt yok</p>
        ) : (
          <ul className="aile-projeler-tarihsiz__liste">
            {undated.map(row => (
              <li key={row.id}>
                <span className="aile-projeler-tarihsiz__ad">{row.label}</span>
                <span className="aile-kucuk aile-ikincil">{[row.meta, eksikTarih(row)].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="aile-projeler-not aile-ikincil">
        {narrow
          ? 'Çizelge yana kayar; görev adları solda sabit kalır.'
          : 'Tarihi değiştirmek sürüklemeye bağlı değildir; kaydın tarih alanlarıyla yapılır.'}
      </p>
    </div>
  );
}

// --- Kontroller ----------------------------------------------------------------------------------------
type KontrolSonucu = 'gecti' | 'kaldi' | 'eksik' | 'bilinmiyor';
const SONUC: Record<KontrolSonucu, StatusLabel> = {
  gecti: { label: 'Geçti', tone: 'olumlu' },
  kaldi: { label: 'Kaldı', tone: 'hata' },
  eksik: { label: 'Eksik', tone: 'uyari' },
  bilinmiyor: { label: BILINMIYOR, tone: 'notr' },
};

interface KontrolSatiri extends RecordRow { kod: string; sonuc: KontrolSonucu }

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

function kontrolSatirlari(rows: readonly RecordRow[], records: readonly PurchaseNeedRecord[]): KontrolSatiri[] {
  const byId = new Map(records.map(record => [record.id, record] as const));
  return rows.map(row => {
    const record = byId.get(row.id);
    return { ...row, kod: kaynakKodu(record, row.code), sonuc: kontrolSonucu(record) };
  });
}

const KONTROL_SUTUNLARI: readonly ResponsiveColumn<KontrolSatiri>[] = [
  { key: 'label', title: 'Kontrol', minWidth: 200, m: 'title', render: row => row.label },
  { key: 'kod', title: 'Kod', minWidth: 112, m: 'meta', render: row => row.kod },
  { key: 'sonuc', title: 'Sonuç', minWidth: 112, m: 'status', render: row => <StatusText label={SONUC[row.sonuc].label} tone={SONUC[row.sonuc].tone} /> },
  { key: 'durum', title: 'Kontrol durumu', minWidth: 160, render: row => <StatusText label={row.status.label} tone={row.status.tone} /> },
  { key: 'room', title: 'Oda', minWidth: 128, render: row => row.room ?? BILINMIYOR },
];

// --- Sütunlar ------------------------------------------------------------------------------------------
const GOREV_SUTUNLARI: readonly ResponsiveColumn<GorevSatiri>[] = [
  { key: 'label', title: 'Görev', minWidth: 200, m: 'title', render: row => row.label },
  { key: 'kod', title: 'Kod · Tür', minWidth: 160, m: 'meta', render: row => `${row.kod} · ${row.tur}` },
  { key: 'status', title: 'Durum', minWidth: 144, m: 'status', render: row => <StatusText label={row.status.label} tone={row.status.tone} /> },
  { key: 'planned', title: 'Planlanan', align: 'right', minWidth: 128, m: 'lead', render: row => <Money value={row.planned} label={FIYAT_YOK} /> },
  { key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 128, render: row => <Money value={row.actual} label={HENUZ_YOK} /> },
  { key: 'room', title: 'Oda', minWidth: 128, render: row => row.room ?? BILINMIYOR },
  { key: 'owner', title: 'Sorumlu', minWidth: 128, render: row => row.owner ?? BILINMIYOR },
  { key: 'startOn', title: 'Başlangıç', minWidth: 112, render: row => tarihVeyaYok(row.startOn) },
  { key: 'endOn', title: 'Bitiş', minWidth: 112, render: row => (row.gecikti ? `${tarihVeyaYok(row.endOn)} · ${GECIKTI}` : tarihVeyaYok(row.endOn)) },
];

const gorevGrubu = (row: GorevSatiri) => (row.gecikti ? `${GECIKTI} · ${row.status.label}` : row.status.label);
const kontrolGrubu = (row: KontrolSatiri) => SONUC[row.sonuc].label;

// --- Bölüm -----------------------------------------------------------------------------------------------
function Bolum({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="aile-projeler-bolum" aria-labelledby={id}>
      <div className="aile-projeler-bolum__bas">
        <h2 id={id} className="aile-projeler-bolum__baslik">{title}</h2>
        {lead ? <div className="aile-projeler-bolum__lead aile-ikincil">{lead}</div> : null}
      </div>
      {children}
    </section>
  );
}

// --- Veri durumu eşlemesi ---------------------------------------------------------------------------------
function dataStatus(generation: ReturnType<typeof useGeneration>): DataStatusProps {
  const state: DataStatusProps['state'] =
    generation.state === 'ready' ? 'fresh' : generation.state === 'stale' ? 'stale' : generation.state === 'error' ? 'error' : 'checking';
  const props: DataStatusProps = { state, onRefresh: () => void generation.refresh() };
  if (generation.lastReadAt) props.lastReadAt = generation.lastReadAt;
  if (generation.generationId) props.generationId = generation.generationId;
  if (generation.lastGoodAt) props.lastGoodAt = generation.lastGoodAt;
  if (generation.message) props.message = generation.message;
  return props;
}

// --- Sayfa -------------------------------------------------------------------------------------------------
export interface ProjelerPageProps {
  /** Bugünün kaynağı (geciken ve "Bu hafta" hesabı); varsayılan gerçek saat. Test sabit gün verir. */
  now?: () => Date;
}

export function ProjelerPage({ now }: ProjelerPageProps) {
  const device = useDevice();
  const narrow = device !== 'desktop';
  const generation = useGeneration();

  const isler = useCollection('work_orders');
  const taslar = useCollection('milestones');
  const kontroller = useCollection('inspections');
  const sablonlar = useCollection('task_templates');
  const akislar = useCollection('workflows');
  const terimler = useCollection('terms');
  const isSatirlari = useRows(TUR_IS);
  const tasSatirlari = useRows(TUR_TAS);
  const kontrolSatirlariHam = useRows('inspection');

  const today = useMemo(() => todayUtc((now ?? (() => new Date()))()), [now]);

  const [mode, setMode] = useState<ViewMode>('table');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>(SORTS[0]!);
  const [turSecimi, setTurSecimi] = useState<readonly string[]>([]);
  const [durumSecimi, setDurumSecimi] = useState<readonly string[]>([]);
  const [filtreAcik, setFiltreAcik] = useState(false);
  const filtreDugmesi = useRef<HTMLElement | null>(null);

  const gorevler = useMemo(
    () => gorevSatirlari([...isSatirlari, ...tasSatirlari], [...isler.rows, ...taslar.rows], today),
    [isSatirlari, tasSatirlari, isler.rows, taslar.rows, today],
  );

  const facets = useMemo<FilterFacet[]>(() => {
    const turSayim = new Map<string, number>();
    const durumSayim = new Map<string, number>();
    for (const row of gorevler) {
      turSayim.set(row.tur, (turSayim.get(row.tur) ?? 0) + 1);
      durumSayim.set(row.status.label, (durumSayim.get(row.status.label) ?? 0) + 1);
    }
    const options = (map: Map<string, number>) => [...map.entries()].map(([value, count]) => ({ value, label: value, count }));
    return [
      { id: 'tur', label: 'Tür', kind: 'checkbox', options: options(turSayim), selected: turSecimi },
      { id: 'durum', label: 'Durum', kind: 'checkbox', options: options(durumSayim), selected: durumSecimi },
    ];
  }, [gorevler, turSecimi, durumSecimi]);

  const toggle = (facetId: string, value: string) => {
    const flip = (list: readonly string[]) => (list.includes(value) ? list.filter(item => item !== value) : [...list, value]);
    if (facetId === 'tur') setTurSecimi(flip);
    else if (facetId === 'durum') setDurumSecimi(flip);
  };
  const temizle = () => {
    setTurSecimi([]);
    setDurumSecimi([]);
    setSearch('');
  };

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = [];
    if (search.trim()) list.push({ id: 'ara', label: `Arama: ${search.trim()}`, onRemove: () => setSearch('') });
    for (const value of turSecimi) list.push({ id: `tur:${value}`, label: `Tür: ${value}`, onRemove: () => toggle('tur', value) });
    for (const value of durumSecimi) list.push({ id: `durum:${value}`, label: `Durum: ${value}`, onRemove: () => toggle('durum', value) });
    return list;
  }, [search, turSecimi, durumSecimi]);

  const sonuc = useMemo(() => {
    const filtered = gorevler.filter(
      row =>
        aramaEslesir(row, search) &&
        (turSecimi.length === 0 || turSecimi.includes(row.tur)) &&
        (durumSecimi.length === 0 || durumSecimi.includes(row.status.label)),
    );
    return tariheGoreSirala(filtered, sort);
  }, [gorevler, search, turSecimi, durumSecimi, sort]);

  const kanbanSutunlari = useMemo(() => workflowColumns(akislar.rows, terimler.rows), [akislar.rows, terimler.rows]);

  const gantt = useMemo(
    () =>
      ganttPlan(
        sonuc.map(row => ({
          id: row.id,
          label: row.label,
          start: row.startOn,
          end: row.endOn,
          meta: `${row.kod} · ${row.status.label}`,
          tone: row.status.tone,
          late: row.gecikti,
        })),
        (now ?? (() => new Date()))(),
      ),
    [sonuc, now],
  );

  const kontrolListesi = useMemo(() => kontrolSatirlari(kontrolSatirlariHam, kontroller.rows), [kontrolSatirlariHam, kontroller.rows]);
  const kontrolSayim = useMemo(() => {
    const out: Record<KontrolSonucu, number> = { gecti: 0, kaldi: 0, eksik: 0, bilinmiyor: 0 };
    for (const row of kontrolListesi) out[row.sonuc] += 1;
    return out;
  }, [kontrolListesi]);

  const sablonListesi = useMemo(
    () => [...sablonlar.rows].sort((a, b) => sablonBasligi(a).localeCompare(sablonBasligi(b), 'tr-TR')),
    [sablonlar.rows],
  );

  // --- Özet: açık görev · planlanan · gerçekleşen (plan ve gerçek ayrı girdiler) ---
  const summary = useMemo<PageHeaderSummary[]>(() => {
    const acik = gorevler.filter(row => row.acik).length;
    const geciken = gorevler.filter(row => row.gecikti).length;
    const plan = topla(gorevler.map(row => row.planned));
    const gercek = topla(gorevler.map(row => row.actual));
    const acikNotu = geciken > 0 ? `${sayi.format(geciken)} geciken` : `${sayi.format(gorevler.length)} görev`;
    return [
      { label: 'Açık görev', value: sayi.format(acik), note: acikNotu },
      { label: 'Planlanan', value: plan.parts.length ? plan.parts.join(' · ') : FIYAT_YOK, note: plan.eksik ? `${sayi.format(plan.eksik)} fiyatsız` : undefined },
      { label: 'Gerçekleşen', value: gercek.parts.length ? gercek.parts.join(' · ') : HENUZ_YOK, note: gercek.eksik ? `${sayi.format(gercek.eksik)} henüz yok` : undefined },
    ].map(item => (item.note === undefined ? { label: item.label, value: item.value } : item));
  }, [gorevler]);

  // Ağır görünümler (antd tablo, Kanban, Gantt) yalnız kendi verisi değişince yeniden çizilir. Depo her koleksiyon
  // okumasında durumu checking → ready çevirir ve sayfa (tazelik satırı için) yeniden çizilir; aynı öğe kimliği React'e
  // alt ağacı atlatır, böylece durum değişimi tabloyu baştan çizdirmez.
  const gorevGorunumu = useMemo<ReactNode>(() => {
    if (mode === 'kanban') return <Kanban items={sonuc} columns={kanbanSutunlari} label={KANBAN_ETIKET} />;
    if (mode === 'gantt_chart') return <Gantt plan={gantt} narrow={narrow} />;
    return (
      <ResponsiveTable<GorevSatiri>
        columns={GOREV_SUTUNLARI}
        rows={sonuc}
        caption={GOREVLER}
        mobileCaption={`${sayi.format(sonuc.length)} görev`}
        groupBy={gorevGrubu}
      />
    );
  }, [mode, sonuc, kanbanSutunlari, gantt, narrow]);

  const kontrolTablosu = useMemo<ReactNode>(
    () => (
      <ResponsiveTable<KontrolSatiri>
        columns={KONTROL_SUTUNLARI}
        rows={kontrolListesi}
        caption={KONTROLLER}
        mobileCaption={`${sayi.format(kontrolListesi.length)} kontrol`}
        groupBy={kontrolGrubu}
      />
    ),
    [kontrolListesi],
  );

  // --- Durumlar ---
  // Manifest gelmeden bölümler çizilmez: koleksiyon hataları manifest hatasından önce düşebilir; tek alert, tek iskelet.
  const manifestYok = generation.manifest === null;
  const pageError = manifestYok && generation.state === 'error';
  const pageLoading = manifestYok && !pageError;
  const gorevYukleniyor = isler.loading || taslar.loading || terimler.loading;
  const gorevHatasi = isler.error ?? taslar.error ?? terimler.error;
  const gorevYok = !gorevYukleniyor && !gorevHatasi && gorevler.length === 0;

  const header = (
    <PageHeader
      location={LOCATION}
      section={KONUM_BOLUM}
      title={BASLIK}
      purpose={AMAC}
      status={dataStatus(generation)}
      summary={gorevYukleniyor || gorevHatasi || manifestYok ? undefined : summary}
    />
  );

  if (pageError) {
    return (
      <div className="aile-projeler">
        {header}
        <ErrorState title="Nesil okunamadı" message={generation.message ?? 'Hata: nesil manifesti okunamadı.'} onRetry={() => void generation.refresh()} />
      </div>
    );
  }
  if (pageLoading) {
    return (
      <div className="aile-projeler">
        {header}
        <LoadingShell rows={6} narrow={device === 'phone'} />
      </div>
    );
  }

  let gorevIcerik: ReactNode;
  if (gorevYukleniyor) {
    gorevIcerik = <LoadingShell rows={6} narrow={device === 'phone'} />;
  } else if (gorevHatasi) {
    gorevIcerik = <ErrorState title="Görevler okunamadı" message={gorevHatasi} onRetry={() => void generation.refresh()} />;
  } else if (gorevYok) {
    gorevIcerik = (
      <EmptyState
        title={KAYNAKTA_GOREV_YOK}
        message="Nesilde work_orders ve milestones koleksiyonu boş ya da yok. Panel görev uydurmaz; kaynak e-tabloya kayıt eklenince burada görünür."
      />
    );
  } else if (sonuc.length === 0) {
    gorevIcerik = <EmptyState filters={activeFilters} onClear={temizle} />;
  } else {
    gorevIcerik = gorevGorunumu;
  }

  const sorgu = !gorevYukleniyor && !gorevHatasi && !gorevYok ? (
    <QueryBar
      mode={mode}
      onModeChange={setMode}
      supported={SUPPORTED}
      unsupportedReason={UNSUPPORTED}
      search={search}
      onSearchChange={setSearch}
      sort={sort}
      sortOptions={SORTS}
      onSort={setSort}
      activeFilters={activeFilters}
      onOpenFilters={() => setFiltreAcik(true)}
      resultCount={sonuc.length}
    />
  ) : null;

  const filtrePaneli = <FilterPanel bare facets={facets} onToggle={toggle} onClear={temizle} openKeys={['tur', 'durum']} />;
  const gorevAlani = narrow ? (
    <>
      {gorevIcerik}
      <FilterDrawer
        open={filtreAcik}
        onClose={() => setFiltreAcik(false)}
        resultCount={sonuc.length}
        facets={facets}
        onToggle={toggle}
        onClear={temizle}
        openKeys={['tur', 'durum']}
        returnFocusTo={filtreDugmesi}
      />
    </>
  ) : (
    // Tablo, Kanban ve Gantt: masaüstünde filtre 56 px şeritle başlar (README › Uyarlanır teslim); mod değişince yeniden kurulur.
    <FilterArea key={mode} panel={filtrePaneli} defaultOpen={false} count={activeFilters.length}>
      {gorevIcerik}
    </FilterArea>
  );

  return (
    <div className="aile-projeler" data-device={device}>
      {header}
      {sorgu}
      {gorevAlani}

      <Bolum
        title={KONTROLLER}
        lead="Kontrol yapıldı ile kontrol geçti ayrı alanlardır; eksik sonuç tamamlandı sayılmaz."
      >
        {kontroller.loading ? (
          <LoadingShell rows={3} narrow={device === 'phone'} label="Kontroller yükleniyor" />
        ) : kontroller.error ? (
          <ErrorState title="Kontroller okunamadı" message={kontroller.error} onRetry={() => void generation.refresh()} />
        ) : kontrolListesi.length === 0 ? (
          <p className="aile-projeler-not">{KAYNAKTA_KONTROL_YOK}</p>
        ) : (
          <>
            <ul className="aile-projeler-sayimlar" aria-label="Kontrol sonuçları">
              {(['gecti', 'kaldi', 'eksik'] as const).map(key => (
                <li key={key} className="aile-projeler-sayim">
                  <span className="aile-projeler-sayim__etiket aile-kucuk aile-ikincil">{SONUC[key].label}</span>
                  <span className="aile-projeler-sayim__deger">{sayi.format(kontrolSayim[key])}</span>
                </li>
              ))}
              {kontrolSayim.bilinmiyor > 0 ? (
                <li className="aile-projeler-sayim">
                  <span className="aile-projeler-sayim__etiket aile-kucuk aile-ikincil">{BILINMIYOR}</span>
                  <span className="aile-projeler-sayim__deger">{sayi.format(kontrolSayim.bilinmiyor)}</span>
                </li>
              ) : null}
            </ul>
            {kontrolTablosu}
          </>
        )}
      </Bolum>

      <Bolum
        title={SABLONLAR}
        lead={
          <>
            Bunlar gerçek görev değil: iş akışının önerdiği şablonlardır (taslak). Görev yalnız kaynakta kayıt olarak eklenince görev listesine girer.
            {sablonListesi.length ? ` ${sayi.format(sablonListesi.length)} şablon.` : ''}
          </>
        }
      >
        {sablonlar.loading ? (
          <LoadingShell rows={3} narrow={device === 'phone'} label="Şablonlar yükleniyor" />
        ) : sablonlar.error ? (
          <ErrorState title="Şablonlar okunamadı" message={sablonlar.error} onRetry={() => void generation.refresh()} />
        ) : sablonListesi.length === 0 ? (
          <p className="aile-projeler-not">{KAYNAKTA_SABLON_YOK}</p>
        ) : (
          <ul className="aile-projeler-sablonlar">
            {sablonListesi.map(sablon => (
              <li key={sablon.id} className="aile-projeler-sablon">
                <span className="aile-projeler-sablon__baslik">{sablonBasligi(sablon)}</span>
                <span className="aile-projeler-sablon__kosul aile-ikincil">{sablonKosulu(sablon)}</span>
                <span className="aile-projeler-sablon__anahtar aile-kucuk aile-ikincil">{sablon.key} · sürüm {sayi.format(sablon.version)}</span>
              </li>
            ))}
          </ul>
        )}
      </Bolum>
    </div>
  );
}

function sablonBasligi(sablon: TaskTemplate): string {
  const title = sablon['title'];
  return typeof title === 'string' && title.trim() ? title.trim() : sablon.key;
}

function sablonKosulu(sablon: TaskTemplate): string {
  const when = sablon['applies_when'];
  return typeof when === 'string' && when.trim() ? when.trim() : 'Koşul yazılmamış';
}
