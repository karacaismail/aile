import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { Adaptive, lazyWide } from '../adaptive';
import {
  KIND_COLLECTIONS,
  useChangeSet,
  useCollection,
  useGeneration,
  type Term,
  type ViewDefinition,
  type Vocabulary,
  type WorkflowDefinition,
} from '../data';
import { useDevice } from '../device';
import type { DataStatusProps, ResponsiveColumn } from '../shell/contracts';
import { currentAdminLink } from '../shell/navigation';
import { PageHeader } from '../shell/PageHeader';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { FormFooter } from '../ui/FormFooter';
import { LoadingShell } from '../ui/LoadingShell';
import { ResponsiveTable } from '../ui/ResponsiveTable';
import { Select } from '../ui/Select';
import { Tabs } from '../ui/Tabs';
import { Tag } from '../ui/Tag';
import { TextField } from '../ui/TextField';
import {
  BILINMIYOR,
  VIEWS_SECTION,
  WORKFLOW_SECTION,
  aggregateUsage,
  buildTermTree,
  countTermUsage,
  countTermUsageByKind,
  dataStatusState,
  effectiveOps,
  fieldLabel,
  flattenTermTree,
  kindLabel,
  sectionOptions,
  statusText,
  transitionRows,
  vocabularyLabel,
  workflowStates,
  type DirectUsage,
  type TermUsage,
  type TransitionRow,
} from './sozlukler/model';
import type { TermTableWideProps } from './sozlukler/TermTable.wide';
import { CATEGORY_NOUN, TERM_NOUN, TermTree } from './sozlukler/TermTree';
import './SozluklerPage.css';

// Sözlükler ve iş akışları. Tasarım: README "Sayfa iskeleti" 1–2; bundle.js window.Aile.Pages.Sozlukler; ekranlar.md
// SayfaSozlukler / SayfaSozluklerDar. Uyarlamalı teslim (W0): telefon temel sunumdur ve her profilde önce o çizilir —
// "Sözlük" seçimi ui Select (telefonda alt sayfa, role=dialog), terim ağacı iç içe açılır liste (sozlukler/TermTree,
// yerel HTML + APG disclosure, ilk kök açık), geçişler ve görünümler ResponsiveTable (telefonda liste/akordeon).
// Geniş (tablet/masaüstü): sekme şeridi + ağaç tablosu sozlukler/TermTable.wide (lazyWide; telefon indirmez); bölüm
// içeriği sekmelerin panelidir (role=tabpanel).
// Veri: vocabularies/terms/workflows/view_definitions nesilden; "kullanan kayıt" yedi tür koleksiyonunun terim
// alanlarından, üst terim alt dallarını kapsar. Bir tür koleksiyonu okunamazsa kullanım "Bilinmiyor"dur, 0 sayılmaz.
// Yazma yok: "Terim ekle" ve "Pasifleştir" yalnız yerel değişiklik kümesine `note` op'u (öneri) ekler, çünkü Sheets'te
// sözlük karşılığı yoktur; kullanılan (ya da kullanımı bilinmeyen) terim pasifleştirilemez (düğme devre dışı + neden).
// Ölçü ve renkler CSS'te --aile tokenlarıyla; burada sabit px/renk yok. Odak çizgisi admin.css.

export { countTermUsage, vocabularyLabel };

const TermTableWide = lazyWide<TermTableWideProps>('sozlukler-terim-tablosu', () => import('./sozlukler/TermTable.wide'));

const ONERI_NOTU = 'Değişiklikler öneri olarak kaydedilir; e-tabloda karşılığı yok.';
const KULLANIM_NOTU = 'Kullanılan bir değer pasifleştirilemez; önce kayıtlar başka bir değere taşınır.';
const KULLANIM_BILINMIYOR_NOTU = 'Kullanan kayıtlar sayılamadı; kayıtlar okunana kadar pasifleştirme önerilemez.';

/** Kullanım sayımı için okunan yedi tür (KIND_COLLECTIONS sırası; hook sayısı sabit). */
const KIND_KEYS = Object.keys(KIND_COLLECTIONS) as (keyof typeof KIND_COLLECTIONS)[];

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

// --- Pasifleştir eylemi (telefon ağacı ve geniş tablo ortak) -------------------------------------------------
interface TermActionProps {
  term: Term;
  usage: TermUsage | null;
  proposed: boolean;
  canPropose: boolean;
  usedReasonId: string;
  unknownReasonId: string;
  onDeactivate(term: Term): void;
}

function TermAction({ term, usage, proposed, canPropose, usedReasonId, unknownReasonId, onDeactivate }: TermActionProps) {
  if (proposed) return <Tag tone="uyari">Pasifleştirme önerildi</Tag>;
  const unknown = usage === null;
  const used = !unknown && usage.total > 0;
  return (
    <Button
      variant="quiet"
      disabled={unknown || used || !canPropose}
      aria-describedby={unknown ? unknownReasonId : used ? usedReasonId : undefined}
      onClick={() => onDeactivate(term)}
    >
      Pasifleştir
    </Button>
  );
}

// --- Sözlük bölümü ---------------------------------------------------------------------------------------------
interface VocabularySectionProps {
  vocab: Vocabulary;
  terms: readonly Term[];
  direct: ReadonlyMap<string, DirectUsage> | null;
  proposedIds: ReadonlySet<string>;
  canPropose: boolean;
  onDeactivate(term: Term): void;
}

function VocabularySection({ vocab, terms, direct, proposedIds, canPropose, onDeactivate }: VocabularySectionProps) {
  const label = vocabularyLabel(vocab.key);
  const usedReasonId = useId();
  const unknownReasonId = useId();
  const tree = useMemo(() => buildTermTree(terms), [terms]);
  const flat = useMemo(() => flattenTermTree(tree), [tree]);
  const usage = useMemo(() => aggregateUsage(tree, direct), [tree, direct]);
  const isTree = flat.some((node) => node.depth > 0);
  const noun = vocab.key === 'category' ? CATEGORY_NOUN : TERM_NOUN;

  const renderAction = (term: Term) => (
    <TermAction
      term={term}
      usage={usage.get(term.id) ?? null}
      proposed={proposedIds.has(term.id)}
      canPropose={canPropose}
      usedReasonId={usedReasonId}
      unknownReasonId={unknownReasonId}
      onDeactivate={onDeactivate}
    />
  );
  const treeView = <TermTree label={label} nodes={tree} usage={usage} noun={noun} renderAction={renderAction} />;

  return (
    <Section title={label} extra={`${terms.length} değer${isTree ? ' · ağaç' : ''}`}>
      {terms.length === 0 ? (
        <p className="aile-sz-bos">Kaynakta terim kaydı yok</p>
      ) : (
        <Adaptive
          phone={treeView}
          wide={<TermTableWide caption={label} rows={flat} usage={usage} parentTitle={noun.parent} renderAction={renderAction} narrowView={treeView} />}
        />
      )}
      {direct === null ? <p id={unknownReasonId} className="aile-kucuk aile-ikincil aile-sz-yardim">{KULLANIM_BILINMIYOR_NOTU}</p> : null}
      <p id={usedReasonId} className="aile-kucuk aile-ikincil aile-sz-yardim">{KULLANIM_NOTU}</p>
      <p className="aile-kucuk aile-ikincil aile-sz-yardim">{ONERI_NOTU}</p>
    </Section>
  );
}

// --- İş akışları --------------------------------------------------------------------------------------------
interface WorkflowSectionProps { workflow: WorkflowDefinition; vocab: Vocabulary | undefined; termLabel(id: string): string }

const TRANSITION_COLUMNS: readonly ResponsiveColumn<TransitionRow>[] = [
  { key: 'gecis', title: 'Geçiş', minWidth: 176, m: 'title', only: 'mobile', render: (row) => `${row.dan} → ${row.na}` },
  { key: 'dan', title: 'Durumdan', minWidth: 176, only: 'desktop' },
  { key: 'na', title: 'Duruma', minWidth: 176, only: 'desktop' },
  { key: 'kanit', title: 'Kanıt gerekir', minWidth: 136, only: 'desktop', render: (row) => (row.kanit ? 'Evet' : 'Hayır') },
  { key: 'kanitMetin', title: 'Kanıt', minWidth: 136, m: 'meta', only: 'mobile', render: (row) => (row.kanit ? 'Kanıt gerekir' : 'Kanıt gerekmez') },
];

function WorkflowSection({ workflow, vocab, termLabel }: WorkflowSectionProps) {
  const label = vocab ? vocabularyLabel(vocab.key) : BILINMIYOR;
  const states = useMemo(() => workflowStates(workflow, termLabel), [workflow, termLabel]);
  const rows = useMemo(() => transitionRows(workflow, termLabel), [workflow, termLabel]);

  return (
    <Section title={`İş akışı · ${label}`} extra={`${rows.length} geçiş · ${statusText(workflow.status)} · sürüm ${workflow.version}`}>
      {rows.length === 0 ? (
        <p className="aile-sz-bos">Kaynakta geçiş kaydı yok</p>
      ) : (
        <>
          <ol className="aile-sz-akis" aria-label="Durum sırası">
            {states.map((state) => (
              <li key={state.id}>
                <Tag>{state.label}</Tag>
                {state.start ? <>{' '}<span className="aile-kucuk aile-ikincil">başlangıç</span></> : null}
                {state.terminal ? <>{' '}<span className="aile-kucuk aile-ikincil">son durum</span></> : null}
              </li>
            ))}
          </ol>
          <ResponsiveTable<TransitionRow>
            caption={`Geçişler · ${label}`}
            mobileCaption={`${rows.length} geçiş`}
            mobileMode="list"
            rows={rows}
            columns={TRANSITION_COLUMNS}
          />
        </>
      )}
    </Section>
  );
}

// --- Görünüm tanımları --------------------------------------------------------------------------------------
interface ViewRow { key: string; ad: string; durum: string; surum: string; turler: string; alanlar: string }

const VIEW_COLUMNS: readonly ResponsiveColumn<ViewRow>[] = [
  { key: 'ad', title: 'Görünüm', minWidth: 160, m: 'title' },
  { key: 'durum', title: 'Durum', minWidth: 160, m: 'meta' },
  { key: 'surum', title: 'Sürüm', minWidth: 96, m: 'body' },
  { key: 'turler', title: 'Desteklenen türler', minWidth: 240, m: 'body' },
  { key: 'alanlar', title: 'Gerekli alanlar', minWidth: 240, m: 'body' },
];

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

function ViewsSection({ views }: { views: readonly ViewDefinition[] }) {
  const rows: ViewRow[] = views.map((view) => {
    const kinds = stringList(view.supported_kinds);
    const fields = stringList(view.required_fields);
    return {
      key: view.id,
      ad: typeof view.label === 'string' && view.label.trim() ? view.label : BILINMIYOR,
      durum: statusText(view.status),
      surum: view.version === undefined || view.version === null ? BILINMIYOR : String(view.version),
      turler: kinds.length ? kinds.map(kindLabel).join(', ') : 'Henüz yok',
      alanlar: fields.length ? fields.map(fieldLabel).join(', ') : 'Henüz yok',
    };
  });
  return (
    <Section title="Görünüm tanımları" extra={`${views.length} tanım`}>
      {views.length === 0 ? (
        <p className="aile-sz-bos">Kaynakta görünüm tanımı kaydı yok</p>
      ) : (
        <ResponsiveTable<ViewRow> caption="Görünüm tanımları" mobileCaption={`${views.length} tanım`} rows={rows} columns={VIEW_COLUMNS} />
      )}
    </Section>
  );
}

// --- Bekleyen öneriler --------------------------------------------------------------------------------------
function Proposals({ ops, onUndo }: { ops: readonly { opId: string; text: string }[]; onUndo(opId: string): void }) {
  if (ops.length === 0) return null;
  return (
    <Section title="Bekleyen öneriler" extra={`${ops.length} öneri`}>
      <ul className="aile-sz-oneriler">
        {ops.map(({ opId, text }) => (
          <li key={opId} className="aile-sz-oneri">
            <span className="aile-sz-oneri-metin">
              <span>{text}</span>
              <span className="aile-kucuk aile-ikincil">Öneri olarak kaydedildi</span>
            </span>
            <Button variant="quiet" icon="undo" aria-label={`Geri al: ${text}`} onClick={() => onUndo(opId)}>Geri al</Button>
          </li>
        ))}
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
  const options = useMemo(
    () => vocabularies.map((candidate) => ({ value: candidate.id, label: vocabularyLabel(candidate.key) })).sort((a, b) => a.label.localeCompare(b.label, 'tr-TR')),
    [vocabularies],
  );

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
        <Select label="Sözlük" options={options} value={vocabId || undefined} onChange={setVocabId} />
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
  const phone = device === 'phone';
  const link = currentAdminLink(location);
  const generation = useGeneration();
  const changes = useChangeSet();

  const vocabularies = useCollection('vocabularies');
  const terms = useCollection('terms');
  const workflows = useCollection('workflows');
  const views = useCollection('view_definitions');
  // Kullanan kayıt sayımı için yedi tür koleksiyonu (hook sayısı ve sırası sabit: KIND_COLLECTIONS).
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
  const usageFailed = kindParts.some((part) => part.error !== null);

  // Doğrudan kullanım (tür başına); bir tür okunamadıysa null: bilinmeyen kullanım 0 sayılmaz.
  const direct = useMemo<ReadonlyMap<string, DirectUsage> | null>(
    () => (usageFailed ? null : countTermUsageByKind(kindParts.map((part, index) => ({ kind: KIND_KEYS[index]!, records: part.rows })))),
    [usageFailed, purchaseNeeds.rows, lightingSpecs.rows, workOrders.rows, layoutItems.rows, inspections.rows, automationScenes.rows, milestones.rows],
  );
  const termsById = useMemo(() => new Map(terms.rows.map((term) => [term.id, term] as const)), [terms.rows]);
  const vocabsById = useMemo(() => new Map(vocabularies.rows.map((vocab) => [vocab.id, vocab] as const)), [vocabularies.rows]);
  const termsByVocab = useMemo(() => {
    const map = new Map<string, Term[]>();
    for (const term of terms.rows) map.set(term.vocabulary_id, [...(map.get(term.vocabulary_id) ?? []), term]);
    return map;
  }, [terms.rows]);
  // İş akışları sözlüklerinin Türkçe adına göre (Görev, Karar, Kontrol …); sözlüğü bilinmeyen sona.
  const sortedWorkflows = useMemo(() => {
    const nameOf = (workflow: WorkflowDefinition) => {
      const vocab = vocabsById.get(workflow.vocabulary_id);
      return vocab ? vocabularyLabel(vocab.key) : '\uffff';
    };
    return [...workflows.rows].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'tr-TR'));
  }, [workflows.rows, vocabsById]);
  const termLabel = useCallback((id: string) => termsById.get(id)?.label ?? BILINMIYOR, [termsById]);

  // Yalnız bu sayfanın kayıtlarına (terim/sözlük) ait öneriler; başka sayfaların notları burada görünmez.
  const proposals = useMemo(() => {
    const known = new Set<string>([...termsById.keys(), ...vocabsById.keys()]);
    return effectiveOps(changes.ops).filter((op) => op.kind === 'note' && known.has(op.recordId));
  }, [changes.ops, termsById, vocabsById]);
  const proposedTermIds = useMemo(() => new Set(proposals.filter((op) => termsById.has(op.recordId)).map((op) => op.recordId)), [proposals, termsById]);
  const proposalRows = useMemo(
    () => proposals.map((op) => ({ opId: op.opId, text: op.kind === 'note' && typeof op.after.note === 'string' ? op.after.note : BILINMIYOR })),
    [proposals],
  );

  const { groups, options } = useMemo(() => sectionOptions(vocabularies.rows), [vocabularies.rows]);
  const [section, setSection] = useState<string | undefined>();
  const activeSection = section !== undefined && options.some((option) => option.key === section) ? section : options[0]!.key;
  const activeGroup = groups.find((group) => group.key === activeSection);
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

  let content: ReactNode;
  if (manifestFailed || error) {
    content = <ErrorState message={(error ?? generation.message ?? 'Hata: Nesil okunamadı').replace(/^Hata:\s*/, '')} onRetry={() => void generation.refresh()} />;
  } else if (loading) {
    content = <LoadingShell rows={6} narrow={phone} />;
  } else if (vocabularies.rows.length === 0) {
    content = <EmptyState title="Kaynakta sözlük kaydı yok" message="Nesilde sözlük (vocabularies) koleksiyonu boş; terim, iş akışı ve görünüm gösterilemez." />;
  } else {
    const sectionContent = (
      <>
        {activeGroup
          ? activeGroup.vocabs.map((vocab) => (
              <VocabularySection
                key={vocab.id}
                vocab={vocab}
                terms={termsByVocab.get(vocab.id) ?? []}
                direct={direct}
                proposedIds={proposedTermIds}
                canPropose={changes.ready}
                onDeactivate={deactivate}
              />
            ))
          : null}
        {activeSection === WORKFLOW_SECTION
          ? workflows.rows.length === 0
            ? <Section title="İş akışları"><p className="aile-sz-bos">Kaynakta iş akışı kaydı yok</p></Section>
            : sortedWorkflows.map((workflow) => (
                <WorkflowSection key={workflow.id} workflow={workflow} vocab={vocabsById.get(workflow.vocabulary_id)} termLabel={termLabel} />
              ))
          : null}
        {activeSection === VIEWS_SECTION ? <ViewsSection views={views.rows} /> : null}
      </>
    );
    // Telefonda "Sözlük" seçimi alt sayfadır, bölüm içeriği seçimin altında akar. Geniş profilde içerik sekmelerin
    // panelidir (APG Tabs: role=tabpanel seçili sekmeyle adlı, sekme aria-controls ile bağlı). Bekleyen öneriler
    // sekmeye bağlı değildir, panelin dışında kalır.
    content = (
      <div className="aile-sz-icerik">
        {phone ? (
          <>
            <Select label="Sözlük" options={options.map(({ key, label }) => ({ value: key, label }))} value={activeSection} onChange={setSection} className="aile-sz-secim" />
            {sectionContent}
          </>
        ) : (
          <Tabs label="Sözlük" items={options} activeKey={activeSection} onChange={setSection}>
            <div className="aile-sz-panel">{sectionContent}</div>
          </Tabs>
        )}
        <Proposals ops={proposalRows} onUndo={undo} />
      </div>
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
          narrow={phone}
          onClose={() => setAdding(false)}
          onSubmit={addTerm}
        />
      ) : null}
    </div>
  );
}
