import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import {
  FACETS,
  MISSING_LABELS,
  UNKNOWN,
  createViewCatalog,
  defaultFilterOpen,
  readViewDefinitions,
  toneForCode,
  useChangeSet,
  useCollection,
  useGeneration,
  useQuery,
  useRows,
  type AmountField,
  type ChangeOp,
  type DateField,
  type FacetId,
  type MissingValue,
  type PurchaseNeedRecord,
  type QueryAst,
  type SortField,
  type StateAxis,
  type Term,
  type WorkflowDefinition,
} from '../data';
import { useDevice } from '../device';
import {
  VIEW_LABELS,
  VIEW_MODES,
  type ActiveFilter,
  type DataStatusProps,
  type FilterFacet,
  type FilterOption,
  type Money as MoneyValue,
  type PageHeaderSummary,
  type RecordRow,
  type ResponsiveColumn,
  type SortOption,
  type StatusLabel,
  type ViewMode,
} from '../shell/contracts';
import { FilterDrawer } from '../shell/FilterDrawer';
import { FilterPanel, RANGE_KEYS } from '../shell/FilterPanel';
import { PageHeader } from '../shell/PageHeader';
import { QueryBar } from '../shell/QueryBar';
import {
  Button,
  DetailPanel,
  EmptyState,
  ErrorState,
  FilterArea,
  Kanban,
  ListRow,
  LoadingShell,
  Money,
  PivotStack,
  ResponsiveTable,
  Select,
  StatusText,
  Table,
  Timeline,
} from '../ui';
import './AlimlarPage.css';

// Alımlar ve eşyalar — dikey dilim. Tasarım: README › Sayfa iskeleti (başlık → özet ≤3 → sorgu çubuğu → filtreler →
// ayrıntı), ekranlar.md (EkranListe/Tablo/Kanban/Zaman, SayfaAlimlarPivot, EkranAyrinti; dar biçimler) ve bundle.js
// Aile.Pages.Alimlar (section "Alım ve envanter", amaç cümlesi, özet Planlanan · Gerçekleşen · Fiyatı eksik, birincil
// "Alım ekle", modlara göre açık filtre boyutları, ayrıntı masaüstünde sağda 384, dar ekranda tam sayfa).
// Veri: purchase_needs (useQuery: FACETS + facetCounts; aynı boyutta OR, boyutlar arası AND), modlar view_definitions'tan
// (views.supportedModes; desteklenmeyen mod gerekçesiyle devre dışı), durum geçişleri workflows'tan; yazma yalnız yerel
// change set (state_change, Geri al). Sheets'e yazma ve yeni kayıt ekleme bu dilimde yok; "Alım ekle" işlevsiz
// görünmesin diye devre dışı ve nedeni yazılı. Plan ve gerçek hiçbir yerde tek sayıda birleşmez; eksik bilgi adıyla.
// URL: wouter hash konumu "#/alimlar[/<id>][?mod=…&ara=…&room=…]". wouter'ın iç içe rota deseni "/alimlar"dan sonra
// "/" ya da son bekler; bu yüzden seçim yokken sorgu "#/alimlar/?…" biçiminde yazılır. Yazım history.replaceState ile
// (geçmiş kirlenmez); dışarıdan gelen hashchange durumu geri okur. Renk ve ölçü yalnız AlimlarPage.css'te --aile tokenlarıyla.

const KIND = 'purchase_need';
const KONUM = '/alimlar';
const KONUM_BOLUM = 'Alım ve envanter';
const BASLIK = 'Alımlar ve eşyalar';
const AMAC = 'Ev için alınacak ve alınmış her şeyi plan ve gerçek tutarıyla izleyin.';
const EKLE_NOTU = 'Yeni alım kaynak e-tabloya eklenir; panel bu sürümde yalnız durum değişikliğini yerel olarak tutar.';

const FIYAT_YOK = 'Fiyat yok';
const HENUZ_YOK = 'Henüz yok';
const BILINMIYOR = 'Bilinmiyor';
const KAYIT_YOK = 'Kayıt yok';
const KAYNAKTA_YOK = 'Kaynakta alım kaydı yok';
const SONUCLAR = 'Sonuçlar';
/** Ayrıntıyı açabilen öğeler: satır düğmesi, tablo satırı (tabIndex 0), kart ve bağlantılar. */
const ODAKLANABILIR = 'button, a[href], [tabindex]:not([tabindex="-1"])';
const PIVOT_BASLIK = 'Oda ve duruma göre planlanan ve gerçekleşen tutar';
const KANBAN_ETIKET = 'Duruma göre alımlar';

const DEFAULT_MODE: ViewMode = 'listing';
/** view_definitions okunamazsa ya da hiçbir mod tanımlı değilse en temel iki görünüm. */
const TEMEL_MODLAR: readonly ViewMode[] = ['listing', 'table'];

const sayi = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

// --- Sıralama, tarih alanları ----------------------------------------------------------------------------
interface Siralama extends SortOption { field: SortField }
const SIRALAR: readonly Siralama[] = [
  { key: 'label', label: 'Ada göre (A–Z)', direction: 'asc', field: 'label' },
  { key: 'planned_desc', label: 'Planlanan tutar (yüksekten)', direction: 'desc', field: 'planned' },
  { key: 'actual_desc', label: 'Gerçekleşen tutar (yüksekten)', direction: 'desc', field: 'actual' },
  { key: 'planned_on', label: 'Planlanan tarih (yakından)', direction: 'asc', field: 'planned_on' },
];
const VARSAYILAN_SIRA = SIRALAR[0]!;

/** Filtrede tarih türü (DateField). Varsayılan planlanan tarih; seçilmezse URL'ye yazılmaz. */
const TARIH_TURLERI: readonly { value: DateField; label: string }[] = [
  { value: 'planned_on', label: 'Planlanan teslim' },
  { value: 'order_due_on', label: 'Sipariş' },
  { value: 'delivered_on', label: 'Teslim' },
  { value: 'payment_on', label: 'Ödeme' },
];
const VARSAYILAN_TARIH: DateField = 'planned_on';

/** Zaman çizelgesinin tek tarihi (RecordRow.dates anahtarı). */
type ZamanAlani = 'planned' | 'ordered' | 'delivered' | 'paid';
const ZAMAN_ALANLARI: readonly { value: ZamanAlani; label: string }[] = [
  { value: 'planned', label: 'Planlanan teslim' },
  { value: 'ordered', label: 'Sipariş' },
  { value: 'delivered', label: 'Teslim' },
  { value: 'paid', label: 'Ödeme' },
];
const VARSAYILAN_ZAMAN: ZamanAlani = 'planned';

/** Modlara göre açık başlayan filtre boyutları (bundle.js Alimlar › openKeys). */
const ACIK_BOYUTLAR: Record<ViewMode, readonly FacetId[]> = {
  listing: ['category', 'room', 'phase'],
  table: ['room', 'phase'],
  timeline: ['date', 'phase'],
  kanban: ['procurement', 'phase'],
  gantt_chart: ['date', 'phase'],
  pivot: ['phase', 'room'],
};

const FACET_IDS: readonly FacetId[] = FACETS.map(facet => facet.id);
const RANGE_PREFIXES: readonly string[] = Object.values(RANGE_KEYS);

// --- URL (hash) durumu --------------------------------------------------------------------------------------
export interface AlimlarUrlState {
  /** Seçili kayıt (ayrıntı açık). */
  id: string | null;
  mode: ViewMode | null;
  search: string;
  /** SIRALAR anahtarı. */
  sort: string | null;
  /** FacetId → seçili değerler (aralık boyutlarında "baslangic=…" gibi girdiler). */
  facets: Record<string, readonly string[]>;
  /** Filtre tarih türü (DateField); varsayılansa null. */
  dateType: string | null;
  /** Zaman çizelgesi tarih alanı; varsayılansa null. */
  timelineField: string | null;
}

const URL_ANAHTAR = { mode: 'mod', search: 'ara', sort: 'sira', dateType: 'tarih', timelineField: 'zaman' } as const;

const isViewMode = (value: string | null): value is ViewMode => value !== null && (VIEW_MODES as readonly string[]).includes(value);

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Durumu hash'e çevirir: "#/alimlar", "#/alimlar/<id>", "#/alimlar/?mod=…", "#/alimlar/<id>?mod=…". */
export function buildAlimlarHash(state: AlimlarUrlState, location = KONUM): string {
  const params = new URLSearchParams();
  if (state.mode) params.set(URL_ANAHTAR.mode, state.mode);
  if (state.search) params.set(URL_ANAHTAR.search, state.search);
  if (state.sort) params.set(URL_ANAHTAR.sort, state.sort);
  for (const id of FACET_IDS) {
    const values = state.facets[id];
    if (values && values.length) params.set(id, values.map(value => encodeURIComponent(value)).join(','));
  }
  if (state.dateType) params.set(URL_ANAHTAR.dateType, state.dateType);
  if (state.timelineField) params.set(URL_ANAHTAR.timelineField, state.timelineField);
  const query = params.toString();
  const idPart = state.id ? `/${encodeURIComponent(state.id)}` : '';
  if (!query) return `#${location}${idPart}`;
  return `#${location}${idPart || '/'}?${query}`;
}

/** Hash'i okur; bu sayfanın yolu değilse null. Geçersiz mod/sıra/tarih değerleri yok sayılır. */
export function parseAlimlarHash(hash: string, location = KONUM): AlimlarUrlState | null {
  const raw = hash.replace(/^#/, '');
  const mark = raw.indexOf('?');
  const path = mark >= 0 ? raw.slice(0, mark) : raw;
  const query = mark >= 0 ? raw.slice(mark + 1) : '';
  if (path !== location && !path.startsWith(`${location}/`)) return null;
  const rest = path.slice(location.length).replace(/^\/+/, '').replace(/\/+$/, '');
  const id = rest ? decode(rest) : null;
  const params = new URLSearchParams(query);
  const mode = params.get(URL_ANAHTAR.mode);
  const sort = params.get(URL_ANAHTAR.sort);
  const dateType = params.get(URL_ANAHTAR.dateType);
  const timelineField = params.get(URL_ANAHTAR.timelineField);
  const facets: Record<string, readonly string[]> = {};
  for (const facetId of FACET_IDS) {
    const value = params.get(facetId);
    if (!value) continue;
    const values = value.split(',').map(decode).filter((item): item is string => item !== null && item !== '');
    if (values.length) facets[facetId] = values;
  }
  return {
    id: id || null,
    mode: isViewMode(mode) ? mode : null,
    search: params.get(URL_ANAHTAR.search) ?? '',
    sort: sort && SIRALAR.some(option => option.key === sort) ? sort : null,
    facets,
    dateType: dateType && TARIH_TURLERI.some(option => option.value === dateType) ? dateType : null,
    timelineField: timelineField && ZAMAN_ALANLARI.some(option => option.value === timelineField) ? timelineField : null,
  };
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

// --- Durum geçişi (iş akışı) --------------------------------------------------------------------------------
const EKSEN_ADI: Record<StateAxis, string> = { decision: 'Karar', fulfillment: 'Tedarik', inspection: 'Kontrol', payment: 'Ödeme' };

/** Satırın birincil durum ekseni (indexes.stateLabel ile aynı öncelik): iptal kararı örter; sonra tedarik; yoksa karar. */
export function durumEkseni(record: PurchaseNeedRecord): StateAxis {
  const snapshot = record.state_snapshot;
  const decision = snapshot?.decision ?? null;
  if (decision && toneForCode(decision) === 'hata') return 'decision';
  if (snapshot?.fulfillment || record.state_term_ids?.fulfillment) return 'fulfillment';
  return 'decision';
}

export type GecisSonucu =
  | { ok: true; axis: StateAxis; from: { code: string | null; term_id: string | null }; to: { code: string; term_id: string } }
  | { ok: false; reason: string };

function durumAdi(record: PurchaseNeedRecord, axis: StateAxis, termsById: ReadonlyMap<string, Term>): string {
  const termId = record.state_term_ids?.[axis] ?? null;
  return (termId ? termsById.get(termId)?.label : undefined) ?? record.state_snapshot?.[axis] ?? BILINMIYOR;
}

/** Kaydın birincil ekseninde hedef terime geçiş: yalnız iş akışında tanımlı ve kanıt istemeyen geçiş kabul edilir. */
export function durumGecisi(record: PurchaseNeedRecord, toTermId: string, workflows: readonly WorkflowDefinition[], terms: readonly Term[]): GecisSonucu {
  const axis = durumEkseni(record);
  const termsById = new Map(terms.map(term => [term.id, term] as const));
  const fromId = record.state_term_ids?.[axis] ?? null;
  const fromCode = record.state_snapshot?.[axis] ?? null;
  const fromLabel = durumAdi(record, axis, termsById);
  const to = termsById.get(toTermId);
  if (!to) return { ok: false, reason: 'Hata: hedef durum sözlükte yok.' };
  const workflow = workflows.find(item => item.key === axis);
  if (!workflow || !Array.isArray(workflow.transitions)) {
    return { ok: false, reason: `Hata: ${EKSEN_ADI[axis]} iş akışı kaynakta tanımlı değil.` };
  }
  const transition = workflow.transitions.find(item => item.from_term_id === fromId && item.to_term_id === toTermId);
  if (!transition) return { ok: false, reason: `Hata: ${fromLabel} → ${to.label} geçişi iş akışında yok.` };
  if (transition.requires_evidence) {
    return { ok: false, reason: `Hata: ${fromLabel} → ${to.label} geçişi kanıt ister; panel bu sürümde kanıt eklemez.` };
  }
  return { ok: true, axis, from: { code: fromCode, term_id: fromId }, to: { code: to.code, term_id: to.id } };
}

/** Birincil eksende iş akışının izin verdiği (kanıt istemeyen) hedef terimler, geçiş sırasıyla. */
function izinliHedefler(record: PurchaseNeedRecord, workflows: readonly WorkflowDefinition[], termsById: ReadonlyMap<string, Term>): Term[] {
  const axis = durumEkseni(record);
  const fromId = record.state_term_ids?.[axis] ?? null;
  const workflow = workflows.find(item => item.key === axis);
  if (!workflow || !fromId || !Array.isArray(workflow.transitions)) return [];
  const out: Term[] = [];
  for (const transition of workflow.transitions) {
    if (transition.from_term_id !== fromId || transition.requires_evidence || !transition.to_term_id) continue;
    const term = termsById.get(transition.to_term_id);
    if (term && !out.some(item => item.id === term.id)) out.push(term);
  }
  return out;
}

const BOS_ANLIK = { decision: null, fulfillment: null, inspection: null, payment: null };

/** Ham kayıt + bu kaydın etkin yerel opları (changeSet.apply ile aynı kural). */
function guncelKayit(record: PurchaseNeedRecord, ops: readonly ChangeOp[]): PurchaseNeedRecord {
  if (!ops.length) return record;
  const snapshot = { ...BOS_ANLIK, ...record.state_snapshot };
  const termIds = { ...BOS_ANLIK, ...record.state_term_ids };
  for (const op of ops) {
    if (op.kind !== 'state_change') continue;
    snapshot[op.after.axis] = op.after.code;
    termIds[op.after.axis] = op.after.term_id;
  }
  return { ...record, state_snapshot: snapshot, state_term_ids: termIds };
}

// --- Para (yalnız özet ve pivot; plan ve gerçek ayrı toplanır) -------------------------------------------
const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;

function toMinor(money: MoneyValue | null | undefined): number | null {
  if (!money || !DECIMAL.test(money.amount.trim())) return null;
  const value = Number(money.amount);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

const fromMinor = (minor: number, currency: string): MoneyValue => ({ amount: (minor / 100).toFixed(2), currency });

type ParaToplami = Map<string, number>;

function paraEkle(total: ParaToplami, money: MoneyValue | null | undefined): boolean {
  const minor = toMinor(money);
  if (minor === null || !money) return false;
  total.set(money.currency, (total.get(money.currency) ?? 0) + minor);
  return true;
}

const paraMetni = new Map<string, Intl.NumberFormat>();
function paraYaz(minor: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ${currency}`;
  let format = paraMetni.get(code);
  if (!format) {
    format = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    paraMetni.set(code, format);
  }
  return format.format(minor / 100);
}

// --- Filtre girdileri -----------------------------------------------------------------------------------------
/** "28.10.2026" → "2026-10-28"; geçersizse null. */
function isoTarih(text: string): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, g, a, y] = match;
  const date = new Date(Date.UTC(Number(y), Number(a) - 1, Number(g)));
  if (date.getUTCDate() !== Number(g) || date.getUTCMonth() !== Number(a) - 1) return null;
  return `${y}-${a!.padStart(2, '0')}-${g!.padStart(2, '0')}`;
}

/** "1.234,50" / "1234.50" → "1234.50"; geçersizse null. */
function ondalik(text: string): string | null {
  const trimmed = text.trim().replace(/\s/g, '');
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
  return /^[0-9]+(\.[0-9]+)?$/.test(normalized) ? normalized : null;
}

const aralikDegeri = (entries: readonly string[] | undefined, prefix: string) =>
  entries?.find(entry => entry.startsWith(prefix))?.slice(prefix.length) ?? '';

function sorguAst(search: string, secimler: Partial<Record<FacetId, readonly string[]>>, tarihTuru: DateField, sira: Siralama): QueryAst {
  const facets: Partial<Record<FacetId, readonly string[]>> = {};
  for (const [id, values] of Object.entries(secimler) as [FacetId, readonly string[]][]) {
    if (id === 'date' || id === 'amount' || !values.length) continue;
    facets[id] = values;
  }
  const ast: QueryAst = { facets, sort: { field: sira.field, dir: sira.direction } };
  if (search.trim()) ast.text = search.trim();
  const from = isoTarih(aralikDegeri(secimler.date, RANGE_KEYS.baslangic));
  const to = isoTarih(aralikDegeri(secimler.date, RANGE_KEYS.bitis));
  if (from || to) {
    ast.dateField = tarihTuru;
    ast.dateRange = {};
    if (from) ast.dateRange.from = from;
    if (to) ast.dateRange.to = to;
  }
  const min = ondalik(aralikDegeri(secimler.amount, RANGE_KEYS.enAz));
  const max = ondalik(aralikDegeri(secimler.amount, RANGE_KEYS.enCok));
  if (min || max) {
    const field: AmountField = 'planned';
    ast.amountField = field;
    ast.amountRange = {};
    if (min) ast.amountRange.min = min;
    if (max) ast.amountRange.max = max;
  }
  return ast;
}

// --- Pivot (oda × durum) ---------------------------------------------------------------------------------------
interface PivotHucre { plan: ParaToplami; gercek: ParaToplami; kayit: number }
const bosHucre = (): PivotHucre => ({ plan: new Map(), gercek: new Map(), kayit: 0 });
function hucreEkle(cell: PivotHucre, row: RecordRow) {
  cell.kayit += 1;
  paraEkle(cell.plan, row.planned);
  paraEkle(cell.gercek, row.actual);
}

interface PivotSatiri { key: string; oda: string; hucreler: Map<string, PivotHucre>; toplam: PivotHucre; toplamSatiri?: boolean }
interface Pivot { sutunlar: string[]; satirlar: PivotSatiri[] }

const collator = new Intl.Collator('tr-TR', { sensitivity: 'base', numeric: true });
const bilinmeyenSonda = (a: string, b: string) => (a === BILINMIYOR ? 1 : b === BILINMIYOR ? -1 : collator.compare(a, b));

export function pivotHesapla(rows: readonly RecordRow[]): Pivot {
  const sutunlar: string[] = [];
  const odalar = new Map<string, PivotSatiri>();
  const genel: PivotSatiri = { key: '__toplam', oda: 'Toplam', hucreler: new Map(), toplam: bosHucre(), toplamSatiri: true };
  for (const row of rows) {
    const oda = row.room ?? BILINMIYOR;
    const durum = row.status.label || BILINMIYOR;
    if (!sutunlar.includes(durum)) sutunlar.push(durum);
    let satir = odalar.get(oda);
    if (!satir) {
      satir = { key: oda, oda, hucreler: new Map(), toplam: bosHucre() };
      odalar.set(oda, satir);
    }
    for (const target of [satir, genel]) {
      let cell = target.hucreler.get(durum);
      if (!cell) {
        cell = bosHucre();
        target.hucreler.set(durum, cell);
      }
      hucreEkle(cell, row);
      hucreEkle(target.toplam, row);
    }
  }
  sutunlar.sort((a, b) => (a === BILINMIYOR ? 1 : b === BILINMIYOR ? -1 : 0));
  const satirlar = [...odalar.values()].sort((a, b) => bilinmeyenSonda(a.oda, b.oda));
  return { sutunlar, satirlar: rows.length ? [...satirlar, genel] : [] };
}

function ParaListesi({ total, missing }: { total: ParaToplami; missing: string }) {
  if (total.size === 0) return <span className="aile-alimlar-eksik">{missing}</span>;
  return (
    <>
      {[...total.entries()].map(([currency, minor], index) => (
        <span key={currency}>
          {index > 0 ? ' · ' : null}
          <Money value={fromMinor(minor, currency)} />
        </span>
      ))}
    </>
  );
}

function PivotDeger({ cell }: { cell: PivotHucre | undefined }) {
  if (!cell || cell.kayit === 0) return <span className="aile-alimlar-eksik">{KAYIT_YOK}</span>;
  return (
    <span className="aile-alimlar-pv">
      <span className="aile-alimlar-pv-satir"><span className="aile-alimlar-pv-k aile-kucuk">Plan </span><ParaListesi total={cell.plan} missing={FIYAT_YOK} /></span>
      <span className="aile-alimlar-pv-satir"><span className="aile-alimlar-pv-k aile-kucuk">Gerçek </span><ParaListesi total={cell.gercek} missing={HENUZ_YOK} /></span>
    </span>
  );
}

// --- Tablo sütunları -------------------------------------------------------------------------------------------
const durumMetni = (status: StatusLabel | undefined) =>
  status ? <StatusText label={status.label} tone={status.tone} /> : <span className="aile-alimlar-eksik">{BILINMIYOR}</span>;

const SUTUNLAR: readonly ResponsiveColumn<RecordRow>[] = [
  { key: 'label', title: 'Alım', minWidth: 200, m: 'title', render: row => <span className="aile-alimlar-ad">{row.label}</span> },
  { key: 'code', title: 'Kimlik', minWidth: 120, m: 'meta', render: row => row.code },
  { key: 'planned', title: 'Planlanan', align: 'right', minWidth: 136, m: 'lead', render: row => <Money value={row.planned} label={FIYAT_YOK} /> },
  { key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 152, m: 'body', render: row => <Money value={row.actual} label={HENUZ_YOK} /> },
  { key: 'status', title: 'Durum', minWidth: 160, m: 'status', render: row => durumMetni(row.status) },
  { key: 'room', title: 'Oda', minWidth: 136, m: 'meta', render: row => row.room ?? BILINMIYOR },
  { key: 'payment', title: 'Ödeme durumu', minWidth: 152, m: 'body', render: row => durumMetni(row.payment) },
  { key: 'owner', title: 'Sorumlu', minWidth: 128, m: 'body', render: row => row.owner ?? BILINMIYOR },
  { key: 'category', title: 'Kategori', minWidth: 192, m: 'hide', render: row => row.category ?? BILINMIYOR },
];

// --- Veri durumu --------------------------------------------------------------------------------------------------
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

interface Bildirim { tone: 'bilgi' | 'hata'; text: string }

// --- Sayfa ----------------------------------------------------------------------------------------------------------
export interface AlimlarPageProps {
  /** Rota yolu (hash konumu); varsayılan "/alimlar". */
  location?: string;
}

export function AlimlarPage({ location = KONUM }: AlimlarPageProps) {
  const device = useDevice();
  const narrow = device !== 'desktop';
  const generation = useGeneration();
  const changeSet = useChangeSet();
  const notId = useId();

  const kayitlar = useCollection('purchase_needs');
  const odalar = useCollection('rooms');
  const terimler = useCollection('terms');
  const akislar = useCollection('workflows');
  const gorunumler = useCollection('view_definitions');
  const tumSatirlar = useRows(KIND);

  // --- Durum (ilk değer URL'den) ---
  const [ilk] = useState(() => parseAlimlarHash(currentHash(), location));
  const [mode, setMode] = useState<ViewMode>(ilk?.mode ?? DEFAULT_MODE);
  const [search, setSearch] = useState(ilk?.search ?? '');
  const [sira, setSira] = useState<Siralama>(() => SIRALAR.find(option => option.key === ilk?.sort) ?? VARSAYILAN_SIRA);
  const [secimler, setSecimler] = useState<Partial<Record<FacetId, readonly string[]>>>(() => ({ ...(ilk?.facets ?? {}) }) as Partial<Record<FacetId, readonly string[]>>);
  const [tarihTuru, setTarihTuru] = useState<DateField>(() => (ilk?.dateType as DateField | null) ?? VARSAYILAN_TARIH);
  const [zamanAlani, setZamanAlani] = useState<ZamanAlani>(() => (ilk?.timelineField as ZamanAlani | null) ?? VARSAYILAN_ZAMAN);
  const [secili, setSecili] = useState<string | null>(ilk?.id ?? null);
  const [filtreAcik, setFiltreAcik] = useState(false);
  const [bildirim, setBildirim] = useState<Bildirim | null>(null);
  const filtreDugmesi = useRef<HTMLElement | null>(null);

  // --- Görünüm kataloğu: hangi modlar anlamlı ---
  const katalog = useMemo(() => {
    const records = gorunumler.rows.filter(row => !row.deleted_at);
    return createViewCatalog(readViewDefinitions({ schemaVersion: 1, collection: 'view_definitions', records }));
  }, [gorunumler.rows]);
  const katalogHazir = !gorunumler.loading;
  const destek = useMemo(() => {
    const tanimli = katalogHazir && !gorunumler.error ? katalog.supportedModes(KIND) : [];
    const modes = tanimli.length ? tanimli : [...TEMEL_MODLAR];
    const reasons: Partial<Record<ViewMode, string>> = {};
    for (const key of VIEW_MODES) {
      if (modes.includes(key)) continue;
      const full = gorunumler.error
        ? 'görünüm tanımları okunamadı.'
        : katalog.unsupportedReason(KIND, key) ?? '';
      reasons[key] = full.replace(`${VIEW_LABELS[key]} kullanılamaz: `, '');
    }
    return { modes, reasons };
  }, [katalog, katalogHazir, gorunumler.error]);
  const etkinMod: ViewMode = destek.modes.includes(mode) ? mode : destek.modes.includes(DEFAULT_MODE) ? DEFAULT_MODE : destek.modes[0]!;

  // --- Sorgu ---
  const ast = sorguAst(search, secimler, tarihTuru, sira);
  const sorgu = useQuery(KIND, ast);

  const termsById = useMemo(() => new Map(terimler.rows.map(term => [term.id, term] as const)), [terimler.rows]);
  const roomsById = useMemo(() => new Map(odalar.rows.map(room => [room.id, room.label ?? room.code] as const)), [odalar.rows]);

  const secenekAdi = useCallback(
    (facetId: FacetId, value: string): string => {
      if (value === UNKNOWN) return BILINMIYOR;
      if (facetId === 'missing') return MISSING_LABELS[value as MissingValue] ?? value;
      if (facetId === 'room') return roomsById.get(value) ?? value;
      if (facetId === 'category' || facetId === 'phase' || facetId === 'context' || facetId === 'procurement' || facetId === 'payment') {
        return termsById.get(value)?.label ?? value;
      }
      return value;
    },
    [roomsById, termsById],
  );

  const facets = useMemo<FilterFacet[]>(() => {
    const out: FilterFacet[] = [];
    for (const def of FACETS) {
      if (def.kind === 'date') {
        out.push({
          id: def.id,
          label: def.label,
          kind: 'date',
          options: TARIH_TURLERI,
          selected: [...(tarihTuru !== VARSAYILAN_TARIH ? [tarihTuru] : []), ...(secimler.date ?? [])],
        });
        continue;
      }
      if (def.kind === 'amount') {
        out.push({ id: def.id, label: `${def.label} (planlanan)`, kind: 'amount', options: [], selected: secimler.amount ?? [] });
        continue;
      }
      const counts = sorgu.counts[def.id as Exclude<FacetId, 'date' | 'amount'>] ?? {};
      const keys = new Set(Object.keys(counts));
      const options: FilterOption[] = [...keys]
        .map(value => {
          const option: FilterOption = { value, label: secenekAdi(def.id, value), count: counts[value] ?? 0 };
          if (def.kind === 'tree') {
            const parent = termsById.get(value)?.parent_id;
            if (parent && keys.has(parent)) option.parent = parent;
          }
          return option;
        })
        .sort((a, b) => bilinmeyenSonda(a.label, b.label));
      if (!options.length) continue;
      out.push({ id: def.id, label: def.label, kind: def.kind, options, selected: secimler[def.id] ?? [] });
    }
    return out;
  }, [sorgu.counts, secimler, tarihTuru, secenekAdi, termsById]);

  const toggle = useCallback((facetId: string, value: string) => {
    const id = facetId as FacetId;
    if (id === 'date' && TARIH_TURLERI.some(option => option.value === value)) {
      setTarihTuru(value as DateField);
      return;
    }
    if (id === 'date' || id === 'amount') {
      const prefix = RANGE_PREFIXES.find(item => value.startsWith(item));
      if (!prefix) return;
      setSecimler(prev => {
        const kept = (prev[id] ?? []).filter(entry => !entry.startsWith(prefix));
        return { ...prev, [id]: value.length > prefix.length ? [...kept, value] : kept };
      });
      return;
    }
    setSecimler(prev => {
      const list = prev[id] ?? [];
      return { ...prev, [id]: list.includes(value) ? list.filter(item => item !== value) : [...list, value] };
    });
  }, []);

  const temizle = useCallback(() => {
    setSecimler({});
    setSearch('');
  }, []);

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = [];
    if (search.trim()) list.push({ id: 'ara', label: `Arama: ${search.trim()}`, onRemove: () => setSearch('') });
    for (const def of FACETS) {
      const values = secimler[def.id] ?? [];
      for (const value of values) {
        let label: string;
        if (def.id === 'date' || def.id === 'amount') {
          const prefix = RANGE_PREFIXES.find(item => value.startsWith(item));
          if (!prefix) continue;
          const shown = value.slice(prefix.length);
          label =
            prefix === RANGE_KEYS.baslangic ? `Başlangıç: ${shown}` :
            prefix === RANGE_KEYS.bitis ? `Bitiş: ${shown}` :
            prefix === RANGE_KEYS.enAz ? `En az (planlanan): ${shown} ₺` : `En çok (planlanan): ${shown} ₺`;
        } else {
          label = `${def.label}: ${secenekAdi(def.id, value)}`;
        }
        list.push({ id: `${def.id}:${value}`, label, onRemove: () => toggle(def.id, def.id === 'date' || def.id === 'amount' ? value.slice(0, value.indexOf('=') + 1) : value) });
      }
    }
    return list;
  }, [search, secimler, secenekAdi, toggle]);

  // --- URL eşitleme ---
  const hashMode = katalogHazir ? etkinMod : mode;
  useEffect(() => {
    const current = currentHash();
    if (current && current !== '#' && current !== '#/' && parseAlimlarHash(current, location) === null) return;
    const next = buildAlimlarHash(
      {
        id: secili,
        mode: hashMode === DEFAULT_MODE ? null : hashMode,
        search: search.trim(),
        sort: sira.key === VARSAYILAN_SIRA.key ? null : sira.key,
        facets: secimler,
        dateType: tarihTuru === VARSAYILAN_TARIH ? null : tarihTuru,
        timelineField: zamanAlani === VARSAYILAN_ZAMAN ? null : zamanAlani,
      },
      location,
    );
    if (current === next) return;
    const url = new URL(window.location.href);
    url.hash = next;
    window.history.replaceState(window.history.state, '', url.href);
  }, [location, secili, hashMode, search, sira, secimler, tarihTuru, zamanAlani]);

  useEffect(() => {
    const onHashChange = () => {
      const state = parseAlimlarHash(currentHash(), location);
      if (!state) return;
      setSecili(state.id);
      setMode(state.mode ?? DEFAULT_MODE);
      setSearch(state.search);
      setSira(SIRALAR.find(option => option.key === state.sort) ?? VARSAYILAN_SIRA);
      setSecimler({ ...state.facets } as Partial<Record<FacetId, readonly string[]>>);
      setTarihTuru((state.dateType as DateField | null) ?? VARSAYILAN_TARIH);
      setZamanAlani((state.timelineField as ZamanAlani | null) ?? VARSAYILAN_ZAMAN);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [location]);

  // --- Ayrıntı ve odak ---
  // Açan öğe: sonuç bölgesinde tıklanan odaklanabilir öğe (yakalama aşamasında, satırın onClick'inden önce kaydedilir),
  // yoksa odaklı öğe. WebKit/Safari düğmeye tıklayınca düğmeyi odaklamaz; activeElement body ya da odaklanabilir bir
  // ata (main, tabIndex -1) olur. Klavyeyle açılışta (tablo satırında Enter) tuş basımı kaydı sıfırlar, odaklı öğe kullanılır.
  const acan = useRef<HTMLElement | null>(null);
  const tiklanan = useRef<HTMLElement | null>(null);
  const odakGeri = useRef(false);
  const tiklamaKaydet = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    tiklanan.current = event.target instanceof Element ? event.target.closest<HTMLElement>(ODAKLANABILIR) : null;
  }, []);
  const tiklamaSifirla = useCallback(() => { tiklanan.current = null; }, []);
  const ac = useCallback((row: RecordRow) => {
    const active = document.activeElement;
    acan.current = tiklanan.current ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    tiklanan.current = null;
    setBildirim(null);
    setSecili(row.id);
  }, []);
  const kapat = useCallback(() => {
    // Dar ekranda tam sayfa kapanınca liste görünür olur, odak burada döner. Masaüstünde Drawer de açıldığı andaki
    // odaklı öğeye döndürür; Safari'de o öğe body olduğundan dönüş burada da yapılır (aynı öğeyse etkisizdir).
    odakGeri.current = true;
    setSecili(null);
  }, []);
  useEffect(() => {
    if (secili !== null || !odakGeri.current) return;
    odakGeri.current = false;
    if (acan.current?.isConnected) acan.current.focus();
  }, [secili]);

  const seciliSatir = secili ? tumSatirlar.find(row => row.id === secili) : undefined;
  const seciliHam = secili ? kayitlar.rows.find(record => record.id === secili) : undefined;
  const bekleyen = secili ? changeSet.pendingFor(secili) : [];
  const seciliKayit = seciliHam ? guncelKayit(seciliHam, bekleyen) : undefined;
  const hedefler = seciliKayit ? izinliHedefler(seciliKayit, akislar.rows, termsById) : [];
  const durumSecenekleri: StatusLabel[] = seciliSatir
    ? [seciliSatir.status, ...hedefler.map(term => ({ label: term.label, tone: toneForCode(term.code) }))]
    : [];

  const durumDegistir = async (next: StatusLabel) => {
    if (!seciliKayit || !seciliSatir || next.label === seciliSatir.status.label) return;
    const hedef = hedefler.find(term => term.label === next.label);
    if (!hedef) {
      setBildirim({ tone: 'hata', text: `Hata: ${seciliSatir.status.label} → ${next.label} geçişi iş akışında yok.` });
      return;
    }
    const sonuc = durumGecisi(seciliKayit, hedef.id, akislar.rows, terimler.rows);
    if (!sonuc.ok) {
      setBildirim({ tone: 'hata', text: sonuc.reason });
      return;
    }
    try {
      await changeSet.add({
        recordId: seciliKayit.id,
        kind: 'state_change',
        before: { axis: sonuc.axis, code: sonuc.from.code, term_id: sonuc.from.term_id },
        after: { axis: sonuc.axis, code: sonuc.to.code, term_id: sonuc.to.term_id },
      });
      setBildirim({ tone: 'bilgi', text: `Durum yerel olarak değişti: ${seciliSatir.status.label} → ${hedef.label}. Değişiklik kaynağa yazılmadı.` });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setBildirim({ tone: 'hata', text: text.startsWith('Hata: ') ? text : `Hata: ${text}` });
    }
  };

  const sonOp = bekleyen.length ? bekleyen[bekleyen.length - 1] : undefined;
  const geriAl = async () => {
    if (!sonOp) return;
    const sonuc = await changeSet.undo(sonOp.opId);
    setBildirim(sonuc.ok ? { tone: 'bilgi', text: 'Değişiklik geri alındı.' } : { tone: 'hata', text: `Hata: ${sonuc.reason}` });
  };

  const kaynak = useMemo(() => {
    if (!seciliHam) return [];
    const list: { label: string; value: string }[] = [];
    const provenance = seciliHam.provenance;
    if (provenance?.sheet_title) list.push({ label: 'Sayfa', value: provenance.sheet_title });
    if (provenance && Number.isFinite(provenance.row)) list.push({ label: 'Satır', value: sayi.format(provenance.row) });
    if (seciliHam.source_record_id) list.push({ label: 'Kaynak kimliği', value: seciliHam.source_record_id });
    if (generation.generationId) list.push({ label: 'Nesil', value: generation.generationId.slice(0, 12) });
    if (bekleyen.length) list.push({ label: 'Yerel değişiklik', value: `${sayi.format(bekleyen.length)} bekleyen; kaynağa yazılmadı` });
    return list;
  }, [seciliHam, generation.generationId, bekleyen.length]);

  // --- Özet: Planlanan · Gerçekleşen · Fiyatı eksik (plan ve gerçek ayrı girdiler) ---
  const summary = useMemo<PageHeaderSummary[]>(() => {
    const plan: ParaToplami = new Map();
    const gercek: ParaToplami = new Map();
    let planSayisi = 0;
    let gercekSayisi = 0;
    let fiyatsiz = 0;
    for (const row of tumSatirlar) {
      if (paraEkle(plan, row.planned)) planSayisi += 1;
      else fiyatsiz += 1;
      if (paraEkle(gercek, row.actual)) gercekSayisi += 1;
    }
    const yaz = (total: ParaToplami, missing: string) =>
      total.size ? [...total.entries()].map(([currency, minor]) => paraYaz(minor, currency)).join(' · ') : missing;
    return [
      { label: 'Planlanan', value: yaz(plan, FIYAT_YOK), note: `${sayi.format(planSayisi)} kayıt` },
      { label: 'Gerçekleşen', value: yaz(gercek, HENUZ_YOK), note: `${sayi.format(gercekSayisi)} kayıt` },
      { label: 'Fiyatı eksik', value: sayi.format(fiyatsiz), note: 'kayıt' },
    ];
  }, [tumSatirlar]);

  // --- Durumlar ---
  const manifestYok = generation.manifest === null;
  const pageError = manifestYok && generation.state === 'error';
  const pageLoading = manifestYok && !pageError;
  const yukleniyor = sorgu.loading || terimler.loading || odalar.loading;
  const hata = sorgu.error ?? kayitlar.error;
  const kaynaktaYok = !yukleniyor && !hata && sorgu.total === 0;

  const header = (
    <PageHeader
      location={location}
      section={KONUM_BOLUM}
      title={BASLIK}
      purpose={AMAC}
      primary={
        <Button variant="primary" icon="plus" disabled aria-describedby={notId}>
          Alım ekle
        </Button>
      }
      status={dataStatus(generation)}
      summary={yukleniyor || hata || manifestYok || kaynaktaYok ? undefined : summary}
    >
      <p id={notId} className="aile-alimlar-not aile-kucuk aile-ikincil">{EKLE_NOTU}</p>
    </PageHeader>
  );

  if (pageError) {
    return (
      <div className="aile-alimlar">
        {header}
        <ErrorState title="Nesil okunamadı" message={generation.message ?? 'Hata: nesil manifesti okunamadı.'} onRetry={() => void generation.refresh()} />
      </div>
    );
  }
  if (pageLoading || yukleniyor) {
    return (
      <div className="aile-alimlar">
        {header}
        <LoadingShell rows={6} narrow={device === 'phone'} label="Alımlar yükleniyor" />
      </div>
    );
  }
  if (hata) {
    return (
      <div className="aile-alimlar">
        {header}
        <ErrorState title="Alımlar okunamadı" message={hata} onRetry={() => void generation.refresh()} />
      </div>
    );
  }
  if (kaynaktaYok) {
    return (
      <div className="aile-alimlar">
        {header}
        <EmptyState
          title={KAYNAKTA_YOK}
          message="Nesilde purchase_needs koleksiyonu boş ya da yok. Panel alım uydurmaz; kaynak e-tabloya kayıt eklenince burada görünür."
        />
      </div>
    );
  }

  const rows = sorgu.rows;
  const detayAcik = Boolean(seciliSatir);

  let icerik: ReactNode;
  if (rows.length === 0) {
    icerik = <EmptyState filters={activeFilters} onClear={temizle} />;
  } else if (etkinMod === 'table') {
    icerik = (
      <ResponsiveTable<RecordRow>
        columns={SUTUNLAR}
        rows={rows}
        caption={BASLIK}
        mobileCaption={`${sayi.format(rows.length)} kayıt`}
        selectedKey={secili ?? undefined}
        onRowClick={ac}
        openLabel="Ayrıntıyı aç"
      />
    );
  } else if (etkinMod === 'kanban') {
    icerik = (
      <>
        <p className="aile-alimlar-not aile-ikincil">{`${sayi.format(rows.length)} kayıt · pano yana kayar`}</p>
        <Kanban items={rows} selectedKey={secili ?? undefined} onOpen={ac} label={KANBAN_ETIKET} />
      </>
    );
  } else if (etkinMod === 'timeline') {
    icerik = (
      <>
        <div className="aile-alimlar-arac">
          <Select
            label="Tarih alanı"
            options={ZAMAN_ALANLARI}
            value={zamanAlani}
            onChange={value => setZamanAlani(value as ZamanAlani)}
            className="aile-alimlar-secim"
          />
        </div>
        <Timeline items={rows} dateField={zamanAlani} selectedKey={secili ?? undefined} onOpen={ac} />
      </>
    );
  } else if (etkinMod === 'pivot') {
    const pivot = pivotHesapla(rows);
    const pivotSutunlari = [
      { key: 'oda', title: 'Oda / Durum', minWidth: 160, render: (row: PivotSatiri) => <span className="aile-alimlar-pv-oda">{row.oda}</span> },
      ...pivot.sutunlar.map(durum => ({
        key: `d:${durum}`,
        title: durum,
        align: 'right' as const,
        minWidth: 168,
        render: (row: PivotSatiri) => <PivotDeger cell={row.hucreler.get(durum)} />,
      })),
      { key: 'toplam', title: 'Toplam', align: 'right' as const, minWidth: 184, render: (row: PivotSatiri) => <PivotDeger cell={row.toplam} /> },
    ];
    const tryOnly = (total: ParaToplami) => {
      const minor = total.get('TRY');
      return minor === undefined ? null : minor / 100;
    };
    const baskaPara = rows.some(row => (row.planned && row.planned.currency !== 'TRY') || (row.actual && row.actual.currency !== 'TRY'));
    icerik = (
      <>
        <p className="aile-alimlar-not aile-ikincil">
          Satırlar: Oda · Sütunlar: Durum · Değer: Plan ve gerçek ayrı; satır ve sütun toplamı her ölçü için ayrı hesaplanır.
        </p>
        {device === 'phone' ? (
          <>
            {baskaPara ? <p className="aile-alimlar-not aile-ikincil">Telefon özeti yalnız TRY tutarlarını gösterir; diğer para birimleri tabloda ayrı yazılır.</p> : null}
            <PivotStack
              columns={pivot.sutunlar}
              rows={pivot.satirlar
                .filter(row => !row.toplamSatiri)
                .map(row => [row.oda, pivot.sutunlar.map(durum => {
                  const cell = row.hucreler.get(durum);
                  return [cell ? tryOnly(cell.plan) : null, cell ? tryOnly(cell.gercek) : null] as [number | null, number | null];
                })] as [string, [number | null, number | null][]])}
              caption={`${sayi.format(pivot.satirlar.length - 1)} oda · ${sayi.format(pivot.sutunlar.length)} durum`}
              totalLabel="Genel toplam"
            />
          </>
        ) : (
          <Table<PivotSatiri> columns={pivotSutunlari} rows={pivot.satirlar} caption={PIVOT_BASLIK} />
        )}
      </>
    );
  } else {
    icerik = (
      <ul className="aile-alimlar-liste" aria-label="Alımlar">
        {!narrow && !detayAcik ? <ListRow.Header /> : null}
        {rows.map(row => (
          <ListRow key={row.id} row={row} selected={row.id === secili} narrow={narrow || detayAcik} onClick={() => ac(row)} />
        ))}
      </ul>
    );
  }

  const sonucBolgesi = (
    <section className="aile-alimlar-sonuc" aria-label={SONUCLAR} onClickCapture={tiklamaKaydet} onKeyDownCapture={tiklamaSifirla}>
      {icerik}
    </section>
  );

  const detay = seciliSatir ? (
    <DetailPanel
      key={seciliSatir.id}
      row={seciliSatir}
      source={kaynak}
      onClose={kapat}
      statusOptions={durumSecenekleri}
      onChangeStatus={changeSet.ready && seciliKayit ? next => void durumDegistir(next) : undefined}
      onUndo={changeSet.ready && sonOp ? () => void geriAl() : undefined}
      inline={!narrow}
    />
  ) : null;

  const bildirimNode = bildirim ? (
    <p role={bildirim.tone === 'hata' ? 'alert' : 'status'} className="aile-alimlar-bildirim" data-tone={bildirim.tone}>
      {bildirim.text}
    </p>
  ) : null;

  const sorguCubugu = (
    <QueryBar
      mode={etkinMod}
      onModeChange={setMode}
      supported={destek.modes}
      unsupportedReason={destek.reasons}
      search={search}
      onSearchChange={setSearch}
      sort={sira}
      sortOptions={SIRALAR}
      onSort={option => setSira(SIRALAR.find(item => item.key === option.key) ?? VARSAYILAN_SIRA)}
      activeFilters={activeFilters}
      onOpenFilters={() => {
        filtreDugmesi.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setFiltreAcik(true);
      }}
      resultCount={rows.length}
    />
  );

  const openKeys = ACIK_BOYUTLAR[etkinMod];

  if (narrow) {
    return (
      <div className="aile-alimlar" data-device={device}>
        <div className="aile-alimlar-govde" hidden={detayAcik}>
          {header}
          {sorguCubugu}
          {detayAcik ? null : bildirimNode}
          <FilterArea panel={null}>{sonucBolgesi}</FilterArea>
          <FilterDrawer
            open={filtreAcik}
            onClose={() => setFiltreAcik(false)}
            resultCount={rows.length}
            facets={facets}
            onToggle={toggle}
            onClear={temizle}
            openKeys={openKeys}
            returnFocusTo={filtreDugmesi}
          />
        </div>
        {detayAcik ? bildirimNode : null}
        {detay}
      </div>
    );
  }

  const filtrePaneli = <FilterPanel bare facets={facets} onToggle={toggle} onClear={temizle} openKeys={openKeys} />;
  return (
    <div className="aile-alimlar" data-device={device}>
      {header}
      {sorguCubugu}
      {bildirimNode}
      <div className="aile-alimlar-yerlesim" data-ayrinti={detayAcik ? 'acik' : 'kapali'}>
        {/* Mod değişince filtre alanı moda göre açık/şerit başlar (key); ayrıntı dışarıda kalır, mod değişiminde yeniden kurulmaz. */}
        <FilterArea key={etkinMod} panel={filtrePaneli} defaultOpen={defaultFilterOpen(etkinMod)} count={activeFilters.length}>
          {sonucBolgesi}
        </FilterArea>
        {detay ? <div className="aile-alimlar-ayrinti">{detay}</div> : null}
      </div>
    </div>
  );
}
