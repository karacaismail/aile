import type { ChangeOp, GenerationState, PurchaseNeedRecord, Term, Vocabulary, WorkflowDefinition } from '../../data';
import type { DataStatusState } from '../../shell/contracts';

// Sözlükler ve iş akışları sayfasının saf mantığı (React yok; telefon ve geniş sunum ortak kullanır). Makine anahtarı
// (sözlük key, tür, alan yolu, durum) arayüze Türkçe adıyla çıkar; bilinmeyen anahtar uydurulmaz, olduğu gibi yazılır.
// Terim ağacı her derinlikte kurulur (sentetik nesilde kök › alt › torun var); döngü ve yetim terim kaybolmaz.

export const BILINMIYOR = 'Bilinmiyor';
const tr = (a: string, b: string) => a.localeCompare(b, 'tr-TR');

// --- Türkçe adlar ---------------------------------------------------------------------------------------
const VOCAB_LABELS: Readonly<Record<string, string>> = {
  category: 'Kategoriler',
  phase: 'Proje aşaması',
  life_context: 'Yaşam bağlamı',
  legacy_status: 'Eski durum',
  fulfillment_state: 'Tedarik durumu',
  decision_state: 'Karar durumu',
  payment_state: 'Ödeme durumu',
  inspection_state: 'Kontrol durumu',
  task_state: 'Görev durumu',
  provider_state: 'Taraf durumu',
  payment_method: 'Ödeme yöntemi',
  financial_event: 'Finansal olay',
  funding_type: 'Finansman türleri',
};

/** Sözlük anahtarının Türkçe adı; bilinmeyen anahtar olduğu gibi döner (uydurma yok). */
export function vocabularyLabel(key: string): string {
  return VOCAB_LABELS[key] ?? key;
}

const KIND_LABELS: Readonly<Record<string, string>> = {
  purchase_need: 'Alım',
  lighting_spec: 'Aydınlatma özelliği',
  work_order: 'İş',
  layout_item: 'Yerleşim öğesi',
  inspection: 'Kontrol',
  automation_scene: 'Senaryo',
  milestone: 'Kilometre taşı',
  provider: 'Taraf',
  payment: 'Ödeme',
  budget_observation: 'Bütçe gözlemi',
  forecast_event: 'Tahmin olayı',
  forecast_month: 'Tahmin ayı',
};

/** Kayıt türünün Türkçe adı (tekil); bilinmeyen tür olduğu gibi. */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  id: 'Kimlik',
  label: 'Ad',
  'dates.planned_on': 'Planlanan tarih',
  'dates.end_on': 'Bitiş tarihi',
  occurred_on: 'Gerçekleşme tarihi',
  period: 'Dönem',
};

/** Görünüm tanımındaki alan yolunun Türkçe adı; bilinmeyen yol olduğu gibi. */
export function fieldLabel(path: string): string {
  return FIELD_LABELS[path] ?? path;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  proposed_template: 'Önerilen şablon',
  active: 'Etkin',
  draft: 'Taslak',
  deprecated: 'Kullanımdan kalktı',
};

/** Tanım durumu (iş akışı / görünüm); boşsa "Bilinmiyor", tanınmayan değer olduğu gibi. */
export function statusText(status: string | null | undefined): string {
  if (!status || !status.trim()) return BILINMIYOR;
  return STATUS_LABELS[status] ?? status;
}

export function dataStatusState(state: GenerationState): DataStatusState {
  if (state === 'ready') return 'fresh';
  if (state === 'stale') return 'stale';
  if (state === 'error') return 'error';
  return 'checking';
}

// --- Bölümler (Sözlük seçimi) ------------------------------------------------------------------------------
export type GroupKey = 'kategori' | 'durum' | 'finans' | 'diger';
export const WORKFLOW_SECTION = 'akis';
export const VIEWS_SECTION = 'gorunum';
const FINANS_KEYS = new Set(['funding_type', 'payment_method', 'financial_event']);
const GROUP_LABELS: Readonly<Record<GroupKey, string>> = { kategori: 'Kategoriler', durum: 'Durumlar', finans: 'Finansman', diger: 'Diğer sözlükler' };
const GROUP_ORDER: readonly GroupKey[] = ['kategori', 'durum', 'finans', 'diger'];

function groupOf(vocab: Vocabulary): GroupKey {
  if (vocab.key === 'category') return 'kategori';
  if (vocab.key.endsWith('_state')) return 'durum';
  if (FINANS_KEYS.has(vocab.key)) return 'finans';
  return 'diger';
}

export interface VocabularyGroup { key: GroupKey; label: string; vocabs: Vocabulary[] }
export interface SectionOption { key: string; label: string }

/** Dolu sözlük grupları sabit sırada, ardından İş akışları ve Görünümler (masaüstü sekme, telefon Select seçenekleri). */
export function sectionOptions(vocabularies: readonly Vocabulary[]): { groups: VocabularyGroup[]; options: SectionOption[] } {
  const byGroup = new Map<GroupKey, Vocabulary[]>();
  for (const vocab of vocabularies) {
    const key = groupOf(vocab);
    byGroup.set(key, [...(byGroup.get(key) ?? []), vocab]);
  }
  const groups = GROUP_ORDER.filter((key) => byGroup.has(key)).map((key) => ({
    key,
    label: GROUP_LABELS[key],
    vocabs: [...byGroup.get(key)!].sort((a, b) => tr(vocabularyLabel(a.key), vocabularyLabel(b.key))),
  }));
  const options = [
    ...groups.map(({ key, label }) => ({ key, label })),
    { key: WORKFLOW_SECTION, label: 'İş akışları' },
    { key: VIEWS_SECTION, label: 'Görünümler' },
  ];
  return { groups, options };
}

// --- Terim ağacı ----------------------------------------------------------------------------------------------
export interface TermNode {
  term: Term;
  depth: number;
  /** Ağaçtaki üst terim; kök için null (üstü nesilde yoksa da kök sayılır). */
  parent: Term | null;
  children: TermNode[];
}

/**
 * Terimleri ebeveyn → alt ağacına kurar; her düzey Türkçe alfabe sırasında. Üstü nesilde olmayan terim köktür (gizlenmez).
 * Döngüdeki terimler (x → z → x) hiçbir kökten erişilemez; kaybolmasınlar diye ilk görülen kök sayılır.
 */
export function buildTermTree(terms: readonly Term[]): TermNode[] {
  const byId = new Map(terms.map((term) => [term.id, term] as const));
  const childrenOf = new Map<string, Term[]>();
  const roots: Term[] = [];
  for (const term of terms) {
    const parent = term.parent_id ? byId.get(term.parent_id) : undefined;
    if (!parent || parent.id === term.id) roots.push(term);
    else childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), term]);
  }
  const placed = new Set<string>();
  const build = (term: Term, depth: number, parent: Term | null): TermNode => {
    placed.add(term.id);
    const kids = (childrenOf.get(term.id) ?? []).filter((child) => !placed.has(child.id)).sort((a, b) => tr(a.label, b.label));
    const node: TermNode = { term, depth, parent, children: [] };
    for (const child of kids) if (!placed.has(child.id)) node.children.push(build(child, depth + 1, term));
    return node;
  };
  const tree = [...roots].sort((a, b) => tr(a.label, b.label)).map((root) => build(root, 0, null));
  // Döngüde kalanlar: kök olarak eklenir (ad sırasıyla), alt dalları yine kurulur.
  for (const term of [...terms].sort((a, b) => tr(a.label, b.label))) {
    if (!placed.has(term.id)) tree.push(build(term, 0, null));
  }
  return tree;
}

/** Derinlik öncelikli düz liste: her terim ebeveyninden hemen sonra (masaüstü tablo satırları). */
export function flattenTermTree(nodes: readonly TermNode[]): TermNode[] {
  const out: TermNode[] = [];
  const visit = (node: TermNode) => {
    out.push(node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return out;
}

// --- Kullanım ---------------------------------------------------------------------------------------------
type UsageRecord = Pick<PurchaseNeedRecord, 'deleted_at' | 'category_term_id' | 'phase_term_id' | 'legacy_status_term_id' | 'context_term_ids' | 'state_term_ids'>;

function termIdsOf(record: UsageRecord): string[] {
  const ids: (string | null | undefined)[] = [record.category_term_id, record.phase_term_id, record.legacy_status_term_id, ...(record.context_term_ids ?? []), ...Object.values(record.state_term_ids ?? {})];
  return ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** Yedi tür koleksiyonundaki terim alanlarından terim → kullanan kayıt sayısı. Silinmiş kayıt sayılmaz. */
export function countTermUsage(records: readonly UsageRecord[]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const record of records) {
    if (record.deleted_at) continue;
    for (const id of termIdsOf(record)) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  return usage;
}

export interface KindCount { kind: string; count: number }
export interface DirectUsage { total: number; kinds: KindCount[] }

/** Terim → doğrudan kullanım (toplam + tür başına, tür sırası verilen sırayla). */
export function countTermUsageByKind(parts: readonly { kind: string; records: readonly UsageRecord[] }[]): Map<string, DirectUsage> {
  const usage = new Map<string, DirectUsage>();
  for (const { kind, records } of parts) {
    for (const [id, count] of countTermUsage(records)) {
      const entry = usage.get(id) ?? { total: 0, kinds: [] };
      entry.total += count;
      entry.kinds.push({ kind, count });
      usage.set(id, entry);
    }
  }
  return usage;
}

export interface TermUsage {
  /** Bu terime doğrudan bağlı kayıt. */
  direct: number;
  /** Alt dallar dahil (üst kategori alt dallarını kapsar). Pasifleştirme bu sayıya bakar. */
  total: number;
  kinds: KindCount[];
}

/**
 * Alt dallar dahil kullanım. direct null ise (bir tür koleksiyonu okunamadı) her terim null döner: bilinmeyen kullanım
 * 0 sayılmaz, pasifleştirme önerilemez.
 */
export function aggregateUsage(roots: readonly TermNode[], direct: ReadonlyMap<string, DirectUsage> | null): Map<string, TermUsage | null> {
  const out = new Map<string, TermUsage | null>();
  const visit = (node: TermNode): TermUsage | null => {
    const childUsages = node.children.map(visit);
    if (!direct) {
      out.set(node.term.id, null);
      return null;
    }
    const own = direct.get(node.term.id);
    const kinds = new Map<string, number>();
    for (const part of [own ?? null, ...childUsages]) {
      for (const { kind, count } of part?.kinds ?? []) kinds.set(kind, (kinds.get(kind) ?? 0) + count);
    }
    const usage: TermUsage = {
      direct: own?.total ?? 0,
      total: (own?.total ?? 0) + childUsages.reduce((sum, child) => sum + (child?.total ?? 0), 0),
      kinds: [...kinds].map(([kind, count]) => ({ kind, count })),
    };
    out.set(node.term.id, usage);
    return usage;
  };
  roots.forEach(visit);
  return out;
}

/** Düğüm başlığındaki kullanım ifadesi. null = sayılamadı. */
export function usageText(total: number | null): string {
  if (total === null) return 'Kullanım bilinmiyor';
  return total === 0 ? 'Kullanan kayıt yok' : `${total} kayıt kullanıyor`;
}

/** "Alım 3 · İş 2" — kullanan kayıtların türlere dağılımı. */
export function kindBreakdown(kinds: readonly KindCount[]): string {
  return kinds.map(({ kind, count }) => `${kindLabel(kind)} ${count}`).join(' · ');
}

// --- İş akışı -------------------------------------------------------------------------------------------------
export interface WorkflowState { id: string; label: string; start: boolean; terminal: boolean }

/**
 * Durumlar başlangıçtan geçiş sırasıyla, derinlik öncelikli: ana yol önce, yan yollar sonra. Başlangıç = girişi olmayan
 * durum(lar); hepsi döngüdeyse ilk geçişin kaynağı. Son durum = çıkışı olmayan durum. Ulaşılamayan durumlar sona eklenir.
 */
export function workflowStates(workflow: WorkflowDefinition, labelOf: (id: string) => string): WorkflowState[] {
  const order: string[] = [];
  const outgoing = new Map<string, string[]>();
  const incoming = new Set<string>();
  // Tanımsız uç (sözleşmede from/to isteğe bağlı) '' kimliğiyle tek "Bilinmiyor" durumu olur.
  for (const transition of workflow.transitions) {
    const from = transition.from_term_id ?? '';
    const to = transition.to_term_id ?? '';
    for (const id of [from, to]) if (!order.includes(id)) order.push(id);
    outgoing.set(from, [...(outgoing.get(from) ?? []), to]);
    incoming.add(to);
  }
  if (order.length === 0) return [];
  const sourceless = order.filter((id) => !incoming.has(id));
  const starts = sourceless.length ? sourceless : [workflow.transitions[0]!.from_term_id ?? ''];
  const visited: string[] = [];
  const visit = (id: string) => {
    if (visited.includes(id)) return;
    visited.push(id);
    for (const next of outgoing.get(id) ?? []) visit(next);
  };
  starts.forEach(visit);
  order.forEach(visit);
  return visited.map((id) => ({ id, label: labelOf(id), start: starts.includes(id), terminal: !outgoing.has(id) }));
}

export interface TransitionRow { key: string; dan: string; na: string; kanit: boolean }

export function transitionRows(workflow: WorkflowDefinition, labelOf: (id: string) => string): TransitionRow[] {
  return workflow.transitions.map((transition, index) => ({
    key: `${workflow.id}-${index}`,
    dan: labelOf(transition.from_term_id ?? ''),
    na: labelOf(transition.to_term_id ?? ''),
    kanit: transition.requires_evidence === true,
  }));
}

// --- Değişiklik kümesi ------------------------------------------------------------------------------------------
/** Etkin (geri alınmamış, telafi olmayan) oplar; ChangeSet.effective ile aynı kural. */
export function effectiveOps(ops: readonly ChangeOp[]): ChangeOp[] {
  const undone = new Set(ops.map((op) => op.undoes).filter((id): id is string => typeof id === 'string'));
  return ops.filter((op) => !op.undoes && !undone.has(op.opId));
}
