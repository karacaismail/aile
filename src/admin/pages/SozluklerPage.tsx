import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  KIND_COLLECTIONS,
  useChangeSet,
  useCollection,
  useGeneration,
  type ChangeOp,
  type GenerationState,
  type PurchaseNeedRecord,
  type Term,
  type ViewDefinition,
  type Vocabulary,
  type WorkflowDefinition,
} from '../data';
import { useDevice } from '../device';
import type { AccordionItem, DataStatusProps, DataStatusState, ResponsiveColumn } from '../shell/contracts';
import { currentAdminLink } from '../shell/navigation';
import { PageHeader } from '../shell/PageHeader';
import { AccordionList, Button, Dialog, EmptyState, ErrorState, FormFooter, Icon, LoadingShell, ResponsiveTable, Select, Table, Tabs, Tag, TextField } from '../ui';
import './SozluklerPage.css';

/** Table sütunu (ui/Table TableColumn ile aynı pay); sayfa kodu ui alt modülüne değil barrel'a ve contracts'a bağlanır. */
type TableColumn<R> = Pick<ResponsiveColumn<R>, 'key' | 'title' | 'align' | 'minWidth' | 'render'>;

// Tasarım: README.md "Sayfa iskeleti" 1–2; bundle.js window.Aile.Pages.Sozlukler. Masaüstü: Tabs (sözlük grupları + İş
// akışları + Görünümler) → her sözlük bir bölüm (h2 + "N değer · ağaç"), ağaç Table (Ad girintili, Üst kategori "—",
// Kullanan kayıt sağa tabular, Eylem) + yardım metni "Kullanılan bir değer … taşınır." İş akışı: durum sırası Tag'lerle
// (ok simgeleri süsleyici) + Geçişler tablosu. Dar ekranda (tablet/telefon, referansla aynı: device !== 'desktop') ağaç
// AccordionList (kök terimler; alt terimler gövdede, alt yoksa "Yok"), geçişler ResponsiveTable list biçimi.
// Veri: vocabularies/terms/workflows/view_definitions nesilden; "kullanan kayıt" yedi tür koleksiyonunun terim alanlarından
// sayılır. Yazma yok: "Terim ekle" ve "Pasifleştir" yalnız yerel değişiklik kümesine `note` op'u (öneri) ekler, çünkü
// Sheets'te sözlük karşılığı yoktur; kullanılan terim pasifleştirilemez (düğme devre dışı + neden yakınında).
// Tüm ölçü ve renkler SozluklerPage.css'te --aile tokenlarıyla; burada sabit px/renk yok. Seçim/odak admin.css.

// --- Sözlük adları (Türkçe) -----------------------------------------------------------------------------
const VOCAB_LABELS: Record<string, string> = {
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

type GroupKey = 'kategori' | 'durum' | 'finans' | 'diger';
const FINANS_KEYS = new Set(['funding_type', 'payment_method', 'financial_event']);
function groupOf(vocab: Vocabulary): GroupKey {
  if (vocab.key === 'category') return 'kategori';
  if (vocab.key.endsWith('_state')) return 'durum';
  if (FINANS_KEYS.has(vocab.key)) return 'finans';
  return 'diger';
}
const GROUP_LABELS: Record<GroupKey, string> = { kategori: 'Kategoriler', durum: 'Durumlar', finans: 'Finansman', diger: 'Diğer sözlükler' };
const GROUP_ORDER: readonly GroupKey[] = ['kategori', 'durum', 'finans', 'diger'];

const BILINMIYOR = 'Bilinmiyor';
const ONERI_NOTU = 'Değişiklikler öneri olarak kaydedilir; e-tabloda karşılığı yok.';
const KULLANIM_NOTU = 'Kullanılan bir değer pasifleştirilemez; önce kayıtlar başka bir değere taşınır.';

// --- Metin yardımcıları ------------------------------------------------------------------------------------
function statusText(status: string): string {
  return status === 'proposed_template' ? 'Önerilen şablon' : status;
}

function dataStatusState(state: GenerationState): DataStatusState {
  if (state === 'ready') return 'fresh';
  if (state === 'stale') return 'stale';
  if (state === 'error') return 'error';
  return 'checking';
}

/** Yedi tür koleksiyonundaki terim alanlarından terim → kullanan kayıt sayısı. Silinmiş kayıt sayılmaz. */
export function countTermUsage(records: readonly PurchaseNeedRecord[]): Map<string, number> {
  const usage = new Map<string, number>();
  const bump = (id: string | null | undefined) => {
    if (!id) return;
    usage.set(id, (usage.get(id) ?? 0) + 1);
  };
  for (const record of records) {
    if (record.deleted_at) continue;
    bump(record.category_term_id);
    bump(record.phase_term_id);
    bump(record.legacy_status_term_id);
    for (const id of record.context_term_ids ?? []) bump(id);
    for (const id of Object.values(record.state_term_ids ?? {})) bump(id);
  }
  return usage;
}

/** Etkin (geri alınmamış, telafi olmayan) oplar; ChangeSet.effective ile aynı kural. */
function effectiveOps(ops: readonly ChangeOp[]): ChangeOp[] {
  const undone = new Set(ops.map((op) => op.undoes).filter((id): id is string => typeof id === 'string'));
  return ops.filter((op) => !op.undoes && !undone.has(op.opId));
}

// --- Bölüm iskeleti (bundle Sec): h2 + sağda kısa bilgi, kart/kenarlık yok ------------------------------------
function Section({ title, extra, children }: { title: string; extra?: ReactNode; children?: ReactNode }) {
  return (
    <section className="aile-sz-bolum" aria-label={title}>
      <div className="aile-sz-bolum-ust">
        <h2 className="aile-sz-h2">{title}</h2>
        {extra ? <span className="aile-kucuk aile-ikincil aile-sz-sayim">{extra}</span> : null}
      </div>
      {children}
    </section>
  );
}

// --- Sözlük ağacı -------------------------------------------------------------------------------------------
interface TermRow {
  key: string;
  term: Term;
  depth: 0 | 1;
  parentLabel: string | null;
  usage: number;
  children: Term[];
  proposed: boolean;
}

function flattenTree(terms: readonly Term[], usage: Map<string, number>, proposedIds: ReadonlySet<string>): TermRow[] {
  const byId = new Map(terms.map((term) => [term.id, term] as const));
  const childrenOf = new Map<string, Term[]>();
  const roots: Term[] = [];
  for (const term of terms) {
    const parent = term.parent_id ? byId.get(term.parent_id) : undefined;
    if (!parent) roots.push(term); // üst yoksa veya nesilde bulunamadıysa kök sayılır (gizleme yok)
    else childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), term]);
  }
  const rows: TermRow[] = [];
  for (const root of roots) {
    const children = childrenOf.get(root.id) ?? [];
    rows.push({ key: root.id, term: root, depth: 0, parentLabel: null, usage: usage.get(root.id) ?? 0, children, proposed: proposedIds.has(root.id) });
    for (const child of children) {
      rows.push({ key: child.id, term: child, depth: 1, parentLabel: root.label, usage: usage.get(child.id) ?? 0, children: [], proposed: proposedIds.has(child.id) });
    }
  }
  return rows;
}

interface VocabularySectionProps {
  vocab: Vocabulary;
  terms: readonly Term[];
  usage: Map<string, number>;
  proposedIds: ReadonlySet<string>;
  narrow: boolean;
  canPropose: boolean;
  onDeactivate(term: Term): void;
}

function VocabularySection({ vocab, terms, usage, proposedIds, narrow, canPropose, onDeactivate }: VocabularySectionProps) {
  const label = vocabularyLabel(vocab.key);
  const reasonId = useId();
  const rows = useMemo(() => flattenTree(terms, usage, proposedIds), [terms, usage, proposedIds]);
  const isTree = rows.some((row) => row.depth === 1);
  const parentTitle = vocab.key === 'category' ? 'Üst kategori' : 'Üst terim';

  const action = (row: TermRow) => {
    if (row.proposed) return <Tag tone="uyari">Pasifleştirme önerildi</Tag>;
    const blocked = row.usage > 0;
    return (
      <Button variant="quiet" disabled={blocked || !canPropose} aria-describedby={blocked ? reasonId : undefined} onClick={() => onDeactivate(row.term)}>
        Pasifleştir
      </Button>
    );
  };

  const name = (row: TermRow) => (
    <span className="aile-sz-ad" data-depth={row.depth}>
      {row.depth === 1 ? <span className="aile-ikincil" aria-hidden="true">└</span> : null}
      <span className={row.depth === 0 ? 'aile-sz-ad-kok' : undefined}>{row.term.label}</span>
      {row.term.legacy ? <Tag>Eski</Tag> : null}
    </span>
  );

  const columns: TableColumn<TermRow>[] = [
    { key: 'ad', title: 'Ad', minWidth: 240, render: name },
    { key: 'kod', title: 'Kod', minWidth: 136, render: (row) => <code className="aile-sz-kod">{row.term.code}</code> },
    { key: 'ust', title: parentTitle, minWidth: 160, render: (row) => row.parentLabel ?? '—' },
    { key: 'kayit', title: 'Kullanan kayıt', align: 'right', minWidth: 136, render: (row) => <span className="aile-tutar">{row.usage}</span> },
    { key: 'eylem', title: 'Eylem', minWidth: 200, render: action },
  ];

  const items: AccordionItem[] = rows
    .filter((row) => row.depth === 0)
    .map((row) => ({
      key: row.key,
      title: row.term.label,
      meta: `${row.usage} kayıt kullanıyor${row.children.length ? ` · ${row.children.length} alt kategori` : ''}`,
      status: row.term.legacy ? 'Eski' : undefined,
      body: [
        ...(row.children.length
          ? row.children.map((child): [ReactNode, ReactNode] => [`└ ${child.label}`, `${usage.get(child.id) ?? 0} kayıt`])
          : [['Alt kategori', <span className="aile-ikincil">Yok</span>] as [ReactNode, ReactNode]]),
        ['Kod', <code className="aile-sz-kod">{row.term.code}</code>],
        ['Eylem', action(row)],
      ],
    }));

  const count = `${terms.length} değer${isTree ? ' · ağaç' : ''}`;

  return (
    <Section title={label} extra={count}>
      {terms.length === 0 ? (
        <p className="aile-sz-bos">Kaynakta terim kaydı yok</p>
      ) : narrow ? (
        <AccordionList items={items} caption={count} openLabel="Düzenle" />
      ) : (
        <Table<TermRow> caption={label} rows={rows} columns={columns} />
      )}
      <p id={reasonId} className="aile-kucuk aile-ikincil aile-sz-yardim">{KULLANIM_NOTU}</p>
      <p className="aile-kucuk aile-ikincil aile-sz-yardim">{ONERI_NOTU}</p>
    </Section>
  );
}

// --- İş akışları --------------------------------------------------------------------------------------------
interface TransitionRow { key: string; dan: string; na: string; kanit: string }

function WorkflowSection({ workflow, vocab, termsById, narrow }: { workflow: WorkflowDefinition; vocab: Vocabulary | undefined; termsById: Map<string, Term>; narrow: boolean }) {
  const label = vocab ? vocabularyLabel(vocab.key) : BILINMIYOR;
  const termLabel = (id: string | undefined) => (id ? termsById.get(id)?.label ?? BILINMIYOR : BILINMIYOR);

  const states: string[] = [];
  for (const transition of workflow.transitions) {
    for (const id of [transition.from_term_id, transition.to_term_id]) {
      const text = termLabel(id);
      if (!states.includes(text)) states.push(text);
    }
  }
  const rows: TransitionRow[] = workflow.transitions.map((transition, index) => ({
    key: `${workflow.id}-${index}`,
    dan: termLabel(transition.from_term_id),
    na: termLabel(transition.to_term_id),
    kanit: transition.requires_evidence ? 'Evet' : 'Hayır',
  }));
  const columns: ResponsiveColumn<TransitionRow>[] = [
    { key: 'dan', title: 'Durumdan', minWidth: 176, m: 'title', render: (row) => (narrow ? `${row.dan} → ${row.na}` : row.dan) },
    ...(narrow ? [] : [{ key: 'na', title: 'Duruma', minWidth: 176, m: 'hide' } as ResponsiveColumn<TransitionRow>]),
    { key: 'kanit', title: 'Kanıt gerekir', minWidth: 136, m: 'meta', render: (row) => row.kanit },
  ];

  return (
    <Section title={`İş akışı · ${label}`} extra={`${rows.length} geçiş · ${statusText(workflow.status)} · sürüm ${workflow.version}`}>
      {rows.length === 0 ? (
        <p className="aile-sz-bos">Kaynakta geçiş kaydı yok</p>
      ) : (
        <>
          <ol className={`aile-sz-akis${narrow ? ' aile-sz-akis--dar' : ''}`} aria-label="Durum sırası">
            {states.map((state, index) => (
              <li key={state}>
                <Tag tone={index === states.length - 1 ? 'olumlu' : index === 0 ? 'notr' : 'bilgi'}>{state}</Tag>
                {index < states.length - 1 ? <Icon name={narrow ? 'chevronDown' : 'chevronRight'} /> : null}
              </li>
            ))}
          </ol>
          <ResponsiveTable<TransitionRow> caption={`Geçişler · ${label}`} mobileCaption={`${rows.length} geçiş`} mobileMode="list" rows={rows} columns={columns} />
        </>
      )}
    </Section>
  );
}

// --- Görünüm tanımları --------------------------------------------------------------------------------------
interface ViewRow { key: string; ad: string; anahtar: string; durum: string; surum: string; turler: string; alanlar: string }

function ViewsSection({ views }: { views: readonly ViewDefinition[] }) {
  const rows: ViewRow[] = views.map((view) => {
    const kinds = Array.isArray(view.supported_kinds) ? (view.supported_kinds as string[]) : [];
    const fields = Array.isArray(view.required_fields) ? (view.required_fields as string[]) : [];
    return {
      key: view.id,
      ad: typeof view.label === 'string' ? view.label : view.key,
      anahtar: view.key,
      durum: statusText(view.status),
      surum: String(view.version),
      turler: kinds.length ? `${kinds.length} tür` : 'Henüz yok',
      alanlar: fields.length ? fields.join(', ') : 'Henüz yok',
    };
  });
  const columns: ResponsiveColumn<ViewRow>[] = [
    { key: 'ad', title: 'Görünüm', minWidth: 160, m: 'title' },
    { key: 'anahtar', title: 'Anahtar', minWidth: 136, m: 'meta' },
    { key: 'durum', title: 'Durum', minWidth: 160, m: 'status' },
    { key: 'surum', title: 'Sürüm', minWidth: 96, m: 'body' },
    { key: 'turler', title: 'Desteklenen tür', minWidth: 136, m: 'body' },
    { key: 'alanlar', title: 'Gerekli alanlar', minWidth: 240, m: 'body' },
  ];
  return (
    <Section title="Görünüm tanımları" extra={`${views.length} tanım`}>
      {views.length === 0 ? (
        <p className="aile-sz-bos">Kaynakta görünüm tanımı kaydı yok</p>
      ) : (
        <ResponsiveTable<ViewRow> caption="Görünüm tanımları" mobileCaption={`${views.length} tanım`} rows={rows} columns={columns} />
      )}
    </Section>
  );
}

// --- Bekleyen öneriler --------------------------------------------------------------------------------------
function Proposals({ ops, onUndo }: { ops: readonly ChangeOp[]; onUndo(opId: string): void }) {
  if (ops.length === 0) return null;
  return (
    <Section title="Bekleyen öneriler" extra={`${ops.length} öneri`}>
      <ul className="aile-sz-oneriler">
        {ops.map((op) => {
          const text = op.kind === 'note' ? op.after.note ?? '' : BILINMIYOR;
          return (
            <li key={op.opId} className="aile-sz-oneri">
              <span className="aile-sz-oneri-metin">
                <span>{text}</span>
                <span className="aile-kucuk aile-ikincil">Öneri olarak kaydedildi</span>
              </span>
              <Button variant="quiet" icon="undo" aria-label={`Geri al: ${text}`} onClick={() => onUndo(op.opId)}>Geri al</Button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// --- Terim ekle diyaloğu -------------------------------------------------------------------------------------
interface AddTermDialogProps {
  vocabularies: readonly Vocabulary[];
  defaultVocabularyId: string | undefined;
  narrow: boolean;
  onClose(): void;
  onSubmit(vocab: Vocabulary, label: string): Promise<void>;
}

function AddTermDialog({ vocabularies, defaultVocabularyId, narrow, onClose, onSubmit }: AddTermDialogProps) {
  const [vocabId, setVocabId] = useState(defaultVocabularyId ?? vocabularies[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const vocab = vocabularies.find((candidate) => candidate.id === vocabId);

  const submit = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Terim adı boş olamaz');
      return;
    }
    if (!vocab) {
      setStatus('Hata: Sözlük seçilmedi');
      return;
    }
    try {
      await onSubmit(vocab, trimmed);
      onClose();
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'Hata: Öneri kaydedilemedi');
    }
  };

  return (
    <Dialog
      title="Terim ekle"
      onClose={onClose}
      footer={
        <FormFooter
          primaryLabel="Öneri olarak kaydet"
          secondaryLabel="Vazgeç"
          onPrimary={() => void submit()}
          onSecondary={onClose}
          {...(status ? { status, statusTone: 'hata' as const } : {})}
          narrow={narrow}
          sticky={false}
        />
      }
    >
      <div className="aile-sz-form">
        <Select
          label="Sözlük"
          options={vocabularies.map((candidate) => ({ value: candidate.id, label: vocabularyLabel(candidate.key) }))}
          value={vocabId || undefined}
          onChange={setVocabId}
        />
        <TextField
          label="Terim adı"
          value={label}
          onChange={(next) => {
            setLabel(next);
            if (error) setError(undefined);
          }}
          placeholder="Bahçe mobilyası"
          error={error}
          required
        />
        <p className="aile-kucuk aile-ikincil">Öneri olarak kaydedilir; e-tabloya yazılmaz.</p>
      </div>
    </Dialog>
  );
}

// --- Sayfa -----------------------------------------------------------------------------------------------
export interface SozluklerPageProps { location?: string }

export function SozluklerPage({ location = '/sozlukler' }: SozluklerPageProps) {
  const device = useDevice();
  const narrow = device !== 'desktop';
  const link = currentAdminLink(location);
  const generation = useGeneration();
  const changes = useChangeSet();

  const vocabularies = useCollection('vocabularies');
  const terms = useCollection('terms');
  const workflows = useCollection('workflows');
  const views = useCollection('view_definitions');
  // Kullanan kayıt sayımı için yedi tür koleksiyonu (hook sayısı sabit).
  const purchaseNeeds = useCollection(KIND_COLLECTIONS.purchase_need);
  const lightingSpecs = useCollection(KIND_COLLECTIONS.lighting_spec);
  const workOrders = useCollection(KIND_COLLECTIONS.work_order);
  const layoutItems = useCollection(KIND_COLLECTIONS.layout_item);
  const inspections = useCollection(KIND_COLLECTIONS.inspection);
  const automationScenes = useCollection(KIND_COLLECTIONS.automation_scene);
  const milestones = useCollection(KIND_COLLECTIONS.milestone);
  const kindParts = [purchaseNeeds, lightingSpecs, workOrders, layoutItems, inspections, automationScenes, milestones];
  const core = [vocabularies, terms, workflows, views];

  const loading = core.some((part) => part.loading) || kindParts.some((part) => part.loading);
  const error = core.find((part) => part.error !== null)?.error ?? null;
  const manifestFailed = generation.state === 'error' && generation.manifest === null;

  const usage = useMemo(() => countTermUsage(kindParts.flatMap((part) => part.rows)), [
    purchaseNeeds.rows, lightingSpecs.rows, workOrders.rows, layoutItems.rows, inspections.rows, automationScenes.rows, milestones.rows,
  ]);
  const termsById = useMemo(() => new Map(terms.rows.map((term) => [term.id, term] as const)), [terms.rows]);
  const vocabsById = useMemo(() => new Map(vocabularies.rows.map((vocab) => [vocab.id, vocab] as const)), [vocabularies.rows]);
  const termsByVocab = useMemo(() => {
    const map = new Map<string, Term[]>();
    for (const term of terms.rows) map.set(term.vocabulary_id, [...(map.get(term.vocabulary_id) ?? []), term]);
    return map;
  }, [terms.rows]);

  // Yalnız bu sayfanın kayıtlarına (terim/sözlük) ait öneriler; başka sayfaların notları burada görünmez.
  const proposals = useMemo(() => {
    const known = new Set<string>([...termsById.keys(), ...vocabsById.keys()]);
    return effectiveOps(changes.ops).filter((op) => op.kind === 'note' && known.has(op.recordId));
  }, [changes.ops, termsById, vocabsById]);
  const proposedTermIds = useMemo(() => new Set(proposals.filter((op) => termsById.has(op.recordId)).map((op) => op.recordId)), [proposals, termsById]);

  const groups = useMemo(() => {
    const map = new Map<GroupKey, Vocabulary[]>();
    for (const vocab of vocabularies.rows) map.set(groupOf(vocab), [...(map.get(groupOf(vocab)) ?? []), vocab]);
    return GROUP_ORDER.filter((key) => map.has(key)).map((key) => ({ key, label: GROUP_LABELS[key], vocabs: map.get(key)! }));
  }, [vocabularies.rows]);

  const tabItems = useMemo(
    () => [...groups.map((group) => ({ key: group.key, label: group.label })), { key: 'akis', label: 'İş akışları' }, { key: 'gorunum', label: 'Görünümler' }],
    [groups],
  );
  const [tab, setTab] = useState<string | undefined>();
  const activeTab = tab ?? tabItems[0]!.key;
  const [adding, setAdding] = useState(false);

  const propose = async (recordId: string, note: string) => {
    await changes.add({ recordId, kind: 'note', before: { note: null }, after: { note } });
  };
  const deactivate = (term: Term) => {
    void propose(term.id, `Pasifleştir: ${term.label}`);
  };
  const addTerm = async (vocab: Vocabulary, label: string) => {
    await propose(vocab.id, `Terim ekle: ${label} (${vocabularyLabel(vocab.key)})`);
  };
  const undo = (opId: string) => {
    void changes.undo(opId);
  };

  const status: DataStatusProps = {
    state: dataStatusState(generation.state),
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: () => void generation.refresh(),
  };

  const ready = !loading && !error && !manifestFailed;
  const summary = ready
    ? [
        { label: 'Sözlük', value: String(vocabularies.rows.length) },
        { label: 'Terim', value: String(terms.rows.length) },
        { label: 'İş akışı', value: String(workflows.rows.length) },
      ]
    : undefined;

  const activeGroup = groups.find((group) => group.key === activeTab);

  let content: ReactNode;
  if (manifestFailed || error) {
    content = <ErrorState message={(error ?? generation.message ?? 'Hata: Nesil okunamadı').replace(/^Hata:\s*/, '')} onRetry={() => void generation.refresh()} />;
  } else if (loading) {
    content = <LoadingShell rows={6} narrow={device === 'phone'} />;
  } else if (vocabularies.rows.length === 0 && activeGroup === undefined && activeTab !== 'akis' && activeTab !== 'gorunum') {
    content = <EmptyState title="Kaynakta sözlük kaydı yok" message="Nesilde vocabularies koleksiyonu boş." />;
  } else {
    content = (
      <>
        <Tabs label="Sözlük" items={tabItems} activeKey={activeTab} onChange={setTab} />
        {activeGroup
          ? activeGroup.vocabs.map((vocab) => (
              <VocabularySection
                key={vocab.id}
                vocab={vocab}
                terms={termsByVocab.get(vocab.id) ?? []}
                usage={usage}
                proposedIds={proposedTermIds}
                narrow={narrow}
                canPropose={changes.ready}
                onDeactivate={deactivate}
              />
            ))
          : null}
        {activeTab === 'akis'
          ? workflows.rows.length === 0
            ? <Section title="İş akışları"><p className="aile-sz-bos">Kaynakta iş akışı kaydı yok</p></Section>
            : workflows.rows.map((workflow) => (
                <WorkflowSection key={workflow.id} workflow={workflow} vocab={vocabsById.get(workflow.vocabulary_id)} termsById={termsById} narrow={narrow} />
              ))
          : null}
        {activeTab === 'gorunum' ? <ViewsSection views={views.rows} /> : null}
        <Proposals ops={proposals} onUndo={undo} />
      </>
    );
  }

  return (
    <div className="aile-sz">
      <PageHeader
        location={location}
        purpose={link.purpose}
        primary={
          <Button variant="primary" icon="plus" disabled={!ready || !changes.ready || vocabularies.rows.length === 0} onClick={() => setAdding(true)}>
            Terim ekle
          </Button>
        }
        status={status}
        summary={summary}
      />
      {content}
      {adding ? (
        <AddTermDialog
          vocabularies={vocabularies.rows}
          defaultVocabularyId={activeGroup?.vocabs[0]?.id}
          narrow={device === 'phone'}
          onClose={() => setAdding(false)}
          onSubmit={addTerm}
        />
      ) : null}
    </div>
  );
}
