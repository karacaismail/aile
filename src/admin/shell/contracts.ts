import type { ReactNode, RefObject } from 'react';
import type { IconName } from '../ui/icons';

// Shared contracts for the admin shell. Written by A3, extended by P0b; later agents implement against these, read-only.
export type ViewMode = 'listing' | 'table' | 'timeline' | 'kanban' | 'gantt_chart' | 'pivot';
export const VIEW_MODES: readonly ViewMode[] = ['listing', 'table', 'timeline', 'kanban', 'gantt_chart', 'pivot'];
export const VIEW_LABELS: Record<ViewMode, string> = { listing: 'Liste', table: 'Tablo', timeline: 'Zaman çizelgesi', kanban: 'Kanban', gantt_chart: 'Gantt', pivot: 'Pivot' };

export interface NavLink { path: string; label: string; nested?: boolean }
export interface NavGroup { title: string; links: readonly NavLink[] }

// --- Cihaz, ton, para (tasarım index.d.ts) -----------------------------------------------------------
export type Device = 'phone' | 'tablet' | 'desktop';
/** Tek üst düzey yerleşim profili (src/admin/adaptive/profile.ts); Device ile aynı birleşim, yeni kod bu adı kullanır.
 *  Genişlik + yükseklik + kısa kenardan seçilir: yatay telefon phone kalır, dar masaüstü penceresi phone yerleşimi alır. */
export type Profile = Device;
/** Eklemeli giriş katmanları: coarse = (any-pointer: coarse), fine = (any-pointer: fine), hover = (any-hover: hover).
 *  Hibrit cihazda birden çoğu aynı anda açıktır; profil bunlardan seçilmez, klavye varlığı bunlardan çıkarılmaz. */
export interface InputLayers { readonly coarse: boolean; readonly fine: boolean; readonly hover: boolean }
export type Tone = 'notr' | 'bilgi' | 'olumlu' | 'uyari' | 'hata';
/** Veri platformu para zarfı: ondalık metin ("8500.00") + ISO 4217. Biçimleme ui/Money yapar (₺8.500,00). */
export interface Money { amount: string; currency: string }
export interface StatusLabel { label: string; tone: Tone }

/** Liste / tablo / kanban satır view-model'i. Plan ve gerçek ayrı alanlardır; asla tek sayıda birleşmez. */
export interface RecordRow {
  id: string;
  code: string;
  label: string;
  status: StatusLabel;
  room?: string;
  category?: string;
  owner?: string;
  planned: Money | null;
  actual: Money | null;
  payment?: StatusLabel;
  confidence?: string;
  /** null → "Fotoğraf yok"; verified=false olan görsel asla gösterilmez. */
  photo?: { url: string; verified: boolean } | null;
  dates?: { planned?: string; ordered?: string; delivered?: string; paid?: string };
  kind: string;
}

export interface ResponsiveColumn<R> {
  key: string;
  title: string;
  align?: 'left' | 'right';
  minWidth: number;
  render?(row: R): ReactNode;
  /** Telefon akordeon/listede sütunun rolü; 'hide' gizler. */
  m?: 'title' | 'meta' | 'status' | 'lead' | 'body' | 'hide';
  only?: 'desktop' | 'mobile';
}

export interface AccordionItem {
  key: string;
  title: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  lead?: ReactNode;
  body?: [ReactNode, ReactNode][];
  onOpen?(): void;
  group?: string;
  selected?: boolean;
}

// --- Veri durumu ----------------------------------------------------------------------------------
export type DataStatusState = 'checking' | 'fresh' | 'stale' | 'error' | 'conflict';
export interface DataStatusProps {
  state: DataStatusState;
  /** ISO zaman; gösterim 28.10.2026 14:05. */
  lastReadAt?: string;
  generationId?: string;
  /** stale/error'da son sağlam neslin zamanı. */
  lastGoodAt?: string;
  onRefresh?(): void;
  /** conflict durumunda karşılaştırma görünümünü açar. */
  onCompare?(): void;
  /** Hata metni "Hata: …" ile başlar. */
  message?: string;
}

// --- Sayfa başlığı --------------------------------------------------------------------------------
export interface PageHeaderAction { label: string; icon?: IconName; onClick(): void }
export interface PageHeaderSummary { label: string; value: string; note?: string }
export interface PageHeaderProps {
  location: string;
  /** Grup adı (caption); verilmezse location'dan türetilir. */
  section?: string;
  /** h1 = menü etiketi; verilmezse location'dan türetilir. */
  title?: string;
  /** Sayfanın amacı, tek cümle. */
  purpose?: string;
  lead?: ReactNode;
  /** Tek birincil eylem (telefonda başlıkta yalnız bu + "Diğer"). */
  primary?: ReactNode;
  /** "Diğer" menüsü (OverflowActions). */
  more?: readonly PageHeaderAction[];
  actions?: ReactNode;
  status?: DataStatusProps;
  /** En fazla 3 özet; plan ve gerçek ayrı girdilerdir. */
  summary?: readonly PageHeaderSummary[];
  children?: ReactNode;
}
export interface WorkspaceShellProps { location: string; children: ReactNode }
export interface MobileNavDrawerProps { open: boolean; onClose(): void; location: string; returnFocusTo?: RefObject<HTMLElement | null> }

// --- Sorgu şeridi ---------------------------------------------------------------------------------
export interface SortOption { key: string; label: string; direction: 'asc' | 'desc' }
export interface SavedView { id: string; label: string; onSelect(): void; active?: boolean }
export interface ActiveFilter { id: string; label: string; onRemove(): void }
export interface QueryBarProps {
  mode: ViewMode;
  onModeChange(mode: ViewMode): void;
  supported: readonly ViewMode[];
  unsupportedReason?: Partial<Record<ViewMode, string>>;
  search: string;
  onSearchChange(value: string): void;
  sort?: SortOption;
  sortOptions?: readonly SortOption[];
  onSort?(sort: SortOption): void;
  savedViews?: readonly SavedView[];
  /** Verilirse dışa aktarma düğmesi görünür (ör. "CSV indir"). */
  exportLabel?: string;
  onExport?(): void;
  activeFilters: readonly ActiveFilter[];
  onOpenFilters(): void;
  resultCount: number;
}

// --- Filtre -----------------------------------------------------------------------------------------
export type FilterFacetKind = 'checkbox' | 'tree' | 'date' | 'amount';
export interface FilterOption { value: string; label: string; count?: number; /** tree: üst seçeneğin value'su */ parent?: string }
export interface FilterFacet { id: string; label: string; kind: FilterFacetKind; options: readonly FilterOption[]; selected: readonly string[] }
export interface FilterPanelProps {
  facets: readonly FilterFacet[];
  onToggle(facetId: string, value: string): void;
  onClear(): void;
  /** Açık başlayan facet id'leri. */
  openKeys?: readonly string[];
  /** Çekmece/panel çerçevesi olmadan yalnız içerik (FilterArea içinde). */
  bare?: boolean;
}

// --- Ayrıntı -------------------------------------------------------------------------------------
export interface DetailSections { identity?: ReactNode; facts?: ReactNode; state?: ReactNode; related?: ReactNode; source?: ReactNode }
export interface DetailPanelProps {
  row: RecordRow;
  related?: readonly { label: string; href: string }[];
  /** Kaynak bilgisi: sayfa, hücre (A1), nesil. */
  source?: readonly { label: string; value: string }[];
  onClose(): void;
  onChangeStatus?(next: StatusLabel): void;
  onUndo?(): void;
}
