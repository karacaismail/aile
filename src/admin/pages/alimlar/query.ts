import type { AmountField, DateField, FacetId, QueryAst, SortField } from '../../data';
import type { SortOption, ViewMode } from '../../shell/contracts';
import { RANGE_KEYS } from '../../shell/FilterPanel';

// Alımlar sorgusu: sıralama seçenekleri, tarih türleri, modlara göre açık filtre boyutları ve filtre seçimlerinden
// QueryAst. Saf; React yok. Aynı boyutta OR, boyutlar arası AND (data/query). Tutar aralığı yalnız planlanana
// uygulanır: plan ve gerçek birleştirilmez.

export interface Siralama extends SortOption { field: SortField }
export const SIRALAR: readonly Siralama[] = [
  { key: 'label', label: 'Ada göre (A–Z)', direction: 'asc', field: 'label' },
  { key: 'planned_desc', label: 'Planlanan tutar (yüksekten)', direction: 'desc', field: 'planned' },
  { key: 'actual_desc', label: 'Gerçekleşen tutar (yüksekten)', direction: 'desc', field: 'actual' },
  { key: 'planned_on', label: 'Planlanan tarih (yakından)', direction: 'asc', field: 'planned_on' },
];
export const VARSAYILAN_SIRA = SIRALAR[0]!;

/** Filtrede tarih türü (DateField). Varsayılan planlanan tarih; seçilmezse URL'ye yazılmaz. */
export const TARIH_TURLERI: readonly { value: DateField; label: string }[] = [
  { value: 'planned_on', label: 'Planlanan teslim' },
  { value: 'order_due_on', label: 'Sipariş' },
  { value: 'delivered_on', label: 'Teslim' },
  { value: 'payment_on', label: 'Ödeme' },
];
export const VARSAYILAN_TARIH: DateField = 'planned_on';

/** Zaman çizelgesinin tek tarihi (RecordRow.dates anahtarı). */
export type ZamanAlani = 'planned' | 'ordered' | 'delivered' | 'paid';
export const ZAMAN_ALANLARI: readonly { value: ZamanAlani; label: string }[] = [
  { value: 'planned', label: 'Planlanan teslim' },
  { value: 'ordered', label: 'Sipariş' },
  { value: 'delivered', label: 'Teslim' },
  { value: 'paid', label: 'Ödeme' },
];
export const VARSAYILAN_ZAMAN: ZamanAlani = 'planned';

/** Modlara göre açık başlayan filtre boyutları (bundle.js Alimlar › openKeys). */
export const ACIK_BOYUTLAR: Record<ViewMode, readonly FacetId[]> = {
  listing: ['category', 'room', 'phase'],
  table: ['room', 'phase'],
  timeline: ['date', 'phase'],
  kanban: ['procurement', 'phase'],
  gantt_chart: ['date', 'phase'],
  pivot: ['phase', 'room'],
};

export const RANGE_PREFIXES: readonly string[] = Object.values(RANGE_KEYS);

/** "28.10.2026" → "2026-10-28"; geçersizse null. */
export function isoTarih(text: string): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, g, a, y] = match;
  const date = new Date(Date.UTC(Number(y), Number(a) - 1, Number(g)));
  if (date.getUTCDate() !== Number(g) || date.getUTCMonth() !== Number(a) - 1) return null;
  return `${y}-${a!.padStart(2, '0')}-${g!.padStart(2, '0')}`;
}

/** "1.234,50" / "1234.50" → "1234.50"; geçersizse null. */
export function ondalik(text: string): string | null {
  const trimmed = text.trim().replace(/\s/g, '');
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
  return /^[0-9]+(\.[0-9]+)?$/.test(normalized) ? normalized : null;
}

const aralikDegeri = (entries: readonly string[] | undefined, prefix: string) =>
  entries?.find(entry => entry.startsWith(prefix))?.slice(prefix.length) ?? '';

export type Secimler = Partial<Record<FacetId, readonly string[]>>;

export function sorguAst(search: string, secimler: Secimler, tarihTuru: DateField, sira: Siralama): QueryAst {
  const facets: Secimler = {};
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
