import { useId, useMemo, type ReactNode } from 'react';
import { useDevice } from '../device';
import {
  useChangeSet,
  useCollection,
  useGeneration,
  type GenerationHandle,
  type GenerationSourceKind,
  type Issue,
  type Manifest,
  type SheetRecord,
  type SourceRecord,
} from '../data';
import { PageHeader } from '../shell/PageHeader';
import type { DataStatusProps, PageHeaderSummary, ResponsiveColumn, Tone } from '../shell/contracts';
import { Button, EmptyState, ErrorState, LoadingShell, ResponsiveTable, Tag } from '../ui';
import './VeriPage.css';

// Tasarım: bundle.js Pages.VeriKalitesi (Sec blokları: "Çözülecek sorunlar" listesi, "İçe aktarma geçmişi" tablosu),
// README "Sayfa iskeleti" (başlık → özet → içerik) ve "Veri durumları". Referanstaki gömülü örnek veri yerine her şey
// nesilden gelir: issues kuyruğu (ResponsiveTable, telefonda türe göre gruplanmış akordeon), sources ve sheets tabloları,
// manifest'ten nesil bilgisi (kimlik, tutarlılık, koleksiyon sayıları). Referansın "E-tablodan içe aktar" birincil eylemi
// bu dilimde "Klasörden içe aktar"dır (File System Access API; desteklenmeyen tarayıcıda düğme devre dışı ve nedeni
// yanında yazar); "Yenile" yalnız tazelik satırındadır (DataStatus), ikinci bir Yenile düğmesi yok. Referanstaki çakışma
// bloğu ve içe aktarma geçmişi burada yok: panel Sheets'e yazmaz (çakışma üretmez) ve nesil geçmişi tutmaz; bu dürüstçe
// "Henüz yok" ile değil, bölümün hiç çizilmemesiyle ifade edilir. Para yok; sayımlar koleksiyon başına ayrı yazılır.
// Ham antd/echarts yok; her şey ../ui barrel'ından. Renk/px VeriPage.css'te yalnız --aile tokenlarıyla.

const LOCATION = '/veri';
const SECTION = 'Yapı';
const TITLE = 'Veri kalitesi ve içe aktarma';
const PURPOSE = 'E-tablodan gelen veriyi içe aktarın, eşleşmeyen satırları ve çakışmaları çözün.';
const HENUZ_YOK = 'Henüz yok';
const BILINMIYOR = 'Bilinmiyor';
const AYRINTI_YOK = 'Ayrıntı yok';
const KAYNAK_BILINMIYOR = 'Kaynak bilinmiyor';
const ZAMAN_DILIMI = 'Europe/Istanbul';

const sayiBicimi = new Intl.NumberFormat('tr-TR');
const tarihBicimi = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: ZAMAN_DILIMI });
const saatBicimi = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: ZAMAN_DILIMI });

/** ISO zaman → "28.10.2026 11:00" (İstanbul); geçersiz/boş → "Bilinmiyor". */
export function zamanMetni(iso: unknown): string {
  if (typeof iso !== 'string' || iso.trim() === '') return BILINMIYOR;
  const an = new Date(iso);
  if (Number.isNaN(an.getTime())) return BILINMIYOR;
  return `${tarihBicimi.format(an)} ${saatBicimi.format(an)}`;
}

// --- Nesil durumu → tazelik satırı ------------------------------------------------------------------------
/** GenerationState → DataStatusState. idle/checking okunuyor; ready taze; stale eski (son iyi nesil korunur); error hata. */
export function dataStatusFor(generation: GenerationHandle): DataStatusProps {
  const { state, generationId, lastReadAt, lastGoodAt, message } = generation;
  const base: DataStatusProps = { state: 'checking' };
  if (generationId) base.generationId = generationId;
  if (lastReadAt) base.lastReadAt = lastReadAt;
  if (lastGoodAt) base.lastGoodAt = lastGoodAt;
  if (message) base.message = message;
  switch (state) {
    case 'ready':
      return { ...base, state: 'fresh' };
    case 'stale':
      return { ...base, state: 'stale' };
    case 'error':
      return { ...base, state: 'error' };
    default:
      return base;
  }
}

// --- Sözlükler (veri platformu kodları → Türkçe) ------------------------------------------------------------
/** normalize.mjs / taxonomy.mjs sorun kodları; bilinmeyen kod olduğu gibi yazılır (gizlenmez). */
const SORUN_TURU: Record<string, string> = {
  invalid_link: 'Geçersiz bağlantı',
  unknown_term: 'Bilinmeyen terim',
  unresolved_relation: 'Çözülmeyen ilişki',
  invalid_date: 'Geçersiz tarih',
  invalid_amount: 'Geçersiz tutar',
  missing_record_id: 'Kayıt kimliği eksik',
  duplicate_record_id: 'Yinelenen kayıt kimliği',
  unresolved_room: 'Çözülmeyen oda',
  unknown_phase: 'Bilinmeyen aşama',
  unknown_category: 'Bilinmeyen kategori',
  formula_error: 'Formül hatası',
  source_only_sheet: 'Yalnız kaynak sayfa',
};
export const sorunTuru = (code: string): string => SORUN_TURU[code] ?? code;

const SORUN_DURUMU: Record<string, { label: string; tone: Tone }> = {
  review: { label: 'Gözden geçirilecek', tone: 'uyari' },
  error: { label: 'Hata', tone: 'hata' },
  info: { label: 'Bilgi', tone: 'bilgi' },
  resolved: { label: 'Çözüldü', tone: 'olumlu' },
};
const sorunDurumu = (severity: string | undefined) =>
  severity && severity.trim() ? (SORUN_DURUMU[severity] ?? { label: severity, tone: 'notr' as Tone }) : { label: BILINMIYOR, tone: 'notr' as Tone };

const AYRINTI_ALANI: Record<string, string> = {
  value: 'Değer', vocabulary: 'Sözlük', field: 'Alan', kind: 'Tür', target: 'Hedef', lookup: 'Arama', sheet: 'Sayfa',
  message: 'İleti', type: 'Tip', reason: 'Neden', column: 'Sütun', row: 'Satır', expected: 'Beklenen', actual: 'Okunan',
};

/** detail nesnesini "Alan: değer · Alan: değer" biçiminde yazar; boşsa "Ayrıntı yok". */
export function etkiMetni(detail: unknown): string {
  if (detail === null || detail === undefined) return AYRINTI_YOK;
  if (typeof detail !== 'object') return String(detail);
  const parts = Object.entries(detail as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${AYRINTI_ALANI[key] ?? key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  return parts.length ? parts.join(' · ') : AYRINTI_YOK;
}

const KAYNAK_TURU: Record<GenerationSourceKind, string> = { http: 'Sunucu', directory: 'Klasör', fixture: 'Fixture' };
const TUTARLILIK: Record<string, string> = {
  snapshot_capture_not_transaction: 'Anlık görüntü; işlem değil',
  not_transactional: 'İşlem değil',
  transactional: 'İşlem',
};
const tutarlilikMetni = (value: unknown): string => (typeof value === 'string' && value ? (TUTARLILIK[value] ?? value) : BILINMIYOR);

// --- Yardımcı parçalar ------------------------------------------------------------------------------------------
function Bolum({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="aile-veri-bolum" aria-labelledby={id}>
      <div className="aile-veri-bolum-bas">
        <h2 id={id} className="aile-veri-bolum-baslik">{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

const Sayim = ({ count, unit }: { count: number; unit: string }) => (
  <span className="aile-veri-sayim aile-kucuk aile-ikincil">{`${sayiBicimi.format(count)} ${unit}`}</span>
);

/** Koleksiyon bölümünün ortak durumları: okunuyor → iskelet; hata → ErrorState; boş → dürüst metin; dolu → children. */
function KoleksiyonDurumu({
  loading, error, empty, emptyTitle, emptyMessage, rows, onRetry, children,
}: { loading: boolean; error: string | null; empty: boolean; emptyTitle: string; emptyMessage: string; rows: number; onRetry(): void; children: ReactNode }) {
  const device = useDevice();
  if (loading) return <LoadingShell rows={rows} narrow={device === 'phone'} />;
  if (error) return <ErrorState title="Koleksiyon okunamadı" message={error} onRetry={onRetry} />;
  if (empty) return <EmptyState title={emptyTitle} message={emptyMessage} />;
  return <>{children}</>;
}

// --- Çözülecek sorunlar (issues) -----------------------------------------------------------------------------
function kaynakMetni(issue: Issue): string {
  const prov = issue.provenance;
  if (!prov) return KAYNAK_BILINMIYOR;
  const parts = [prov.sheet_title, prov.a1, prov.source_key].filter(part => typeof part === 'string' && part.trim() !== '');
  return parts.length ? parts.join(' · ') : KAYNAK_BILINMIYOR;
}

const SORUN_SUTUNLARI: readonly ResponsiveColumn<Issue>[] = [
  { key: 'tur', title: 'Tür', minWidth: 168, m: 'title', render: issue => sorunTuru(issue.code) },
  { key: 'kaynak', title: 'Kaynak', minWidth: 208, m: 'meta', render: kaynakMetni },
  { key: 'etki', title: 'Etki', minWidth: 288, m: 'body', render: issue => etkiMetni(issue.detail) },
  {
    key: 'durum', title: 'Durum', minWidth: 168, m: 'status',
    render: issue => {
      const durum = sorunDurumu(issue.severity);
      return <Tag tone={durum.tone}>{durum.label}</Tag>;
    },
  },
];

function Sorunlar({ onRetry }: { onRetry(): void }) {
  const issues = useCollection('issues');
  const count = issues.rows.length;
  return (
    <Bolum title="Çözülecek sorunlar" extra={!issues.loading && !issues.error && count > 0 ? <Sayim count={count} unit="kayıt" /> : undefined}>
      <KoleksiyonDurumu
        loading={issues.loading}
        error={issues.error}
        empty={count === 0}
        emptyTitle="Kaynakta sorun kaydı yok"
        emptyMessage="Bu nesilde issues koleksiyonu yok ya da boş; doğrulama sorunu bildirilmedi."
        rows={4}
        onRetry={onRetry}
      >
        <ResponsiveTable<Issue>
          caption="Çözülecek sorunlar"
          mobileCaption={`${sayiBicimi.format(count)} sorun`}
          columns={SORUN_SUTUNLARI}
          rows={issues.rows}
          groupBy={issue => sorunTuru(issue.code)}
        />
      </KoleksiyonDurumu>
    </Bolum>
  );
}

// --- Kaynaklar (sources) ve sayfalar (sheets) ----------------------------------------------------------------
interface KaynakSatiri { id: string; key: string; capturedAt: string; coverage: string; consistency: string; sheetCount: number; note: string }

function captureOf(source: SourceRecord): Record<string, unknown> {
  const capture = (source as { capture?: unknown }).capture;
  return capture && typeof capture === 'object' ? (capture as Record<string, unknown>) : {};
}
const metin = (value: unknown, fallback = BILINMIYOR): string => (typeof value === 'string' && value.trim() ? value : fallback);

const KAYNAK_SUTUNLARI: readonly ResponsiveColumn<KaynakSatiri>[] = [
  { key: 'key', title: 'Anahtar', minWidth: 136, m: 'title' },
  { key: 'capturedAt', title: 'Yakalama', minWidth: 168, m: 'meta' },
  { key: 'coverage', title: 'Kapsam', minWidth: 120 },
  { key: 'consistency', title: 'Tutarlılık', minWidth: 136 },
  { key: 'sheetCount', title: 'Sayfa', align: 'right', minWidth: 88, render: row => sayiBicimi.format(row.sheetCount) },
  { key: 'note', title: 'Not', minWidth: 240 },
];

interface SayfaSatiri { id: string; title: string; sourceKey: string; rowCount: number; cellCount: number }

const SAYFA_SUTUNLARI: readonly ResponsiveColumn<SayfaSatiri>[] = [
  { key: 'title', title: 'Başlık', minWidth: 168, m: 'title' },
  { key: 'sourceKey', title: 'Kaynak', minWidth: 136, m: 'meta' },
  { key: 'rowCount', title: 'Dolu satır', align: 'right', minWidth: 112, render: row => sayiBicimi.format(row.rowCount) },
  { key: 'cellCount', title: 'Dolu hücre', align: 'right', minWidth: 112, render: row => sayiBicimi.format(row.cellCount) },
];

function KaynaklarVeSayfalar({ onRetry }: { onRetry(): void }) {
  const sources = useCollection('sources');
  const sheets = useCollection('sheets');

  const keyById = useMemo(() => new Map(sources.rows.map(source => [source.id, metin(source.key)] as const)), [sources.rows]);
  const sheetCountBySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sheet of sheets.rows) counts.set(sheet.source_id, (counts.get(sheet.source_id) ?? 0) + 1);
    return counts;
  }, [sheets.rows]);

  const kaynakSatirlari = useMemo<KaynakSatiri[]>(
    () =>
      sources.rows.map(source => {
        const capture = captureOf(source);
        return {
          id: source.id,
          key: metin(source.key),
          capturedAt: zamanMetni(capture.completed_at),
          coverage: metin(capture.coverage),
          consistency: tutarlilikMetni(capture.consistency),
          sheetCount: sheetCountBySource.get(source.id) ?? 0,
          note: metin(capture.note, 'Not yok'),
        };
      }),
    [sources.rows, sheetCountBySource],
  );

  const sayfaSatirlari = useMemo<SayfaSatiri[]>(
    () =>
      sheets.rows.map((sheet: SheetRecord) => ({
        id: sheet.id,
        title: metin(sheet.properties?.title, 'Başlık yok'),
        sourceKey: keyById.get(sheet.source_id) ?? BILINMIYOR,
        rowCount: sheet.nonempty_row_count ?? 0,
        cellCount: sheet.nonempty_cell_count ?? 0,
      })),
    [sheets.rows, keyById],
  );

  return (
    <>
      <Bolum title="Kaynaklar" extra={!sources.loading && !sources.error && kaynakSatirlari.length > 0 ? <Sayim count={kaynakSatirlari.length} unit="kaynak" /> : undefined}>
        <KoleksiyonDurumu
          loading={sources.loading || sheets.loading}
          error={sources.error}
          empty={kaynakSatirlari.length === 0}
          emptyTitle="Kaynakta kaynak kaydı yok"
          emptyMessage="Bu nesilde sources koleksiyonu yok ya da boş."
          rows={2}
          onRetry={onRetry}
        >
          <ResponsiveTable<KaynakSatiri> caption="Kaynaklar" mobileCaption={`${sayiBicimi.format(kaynakSatirlari.length)} kaynak`} columns={KAYNAK_SUTUNLARI} rows={kaynakSatirlari} />
        </KoleksiyonDurumu>
      </Bolum>
      <Bolum title="Sayfalar" extra={!sheets.loading && !sheets.error && sayfaSatirlari.length > 0 ? <Sayim count={sayfaSatirlari.length} unit="sayfa" /> : undefined}>
        <KoleksiyonDurumu
          loading={sheets.loading || sources.loading}
          error={sheets.error}
          empty={sayfaSatirlari.length === 0}
          emptyTitle="Kaynakta sayfa kaydı yok"
          emptyMessage="Bu nesilde sheets koleksiyonu yok ya da boş."
          rows={3}
          onRetry={onRetry}
        >
          <ResponsiveTable<SayfaSatiri> caption="Sayfalar" mobileCaption={`${sayiBicimi.format(sayfaSatirlari.length)} sayfa`} columns={SAYFA_SUTUNLARI} rows={sayfaSatirlari} />
        </KoleksiyonDurumu>
      </Bolum>
    </>
  );
}

// --- Nesil bilgisi (manifest) -------------------------------------------------------------------------------
interface SayimSatiri { id: string; collection: string; count: number }
const SAYIM_SUTUNLARI: readonly ResponsiveColumn<SayimSatiri>[] = [
  { key: 'collection', title: 'Koleksiyon', minWidth: 200, m: 'title' },
  { key: 'count', title: 'Kayıt', align: 'right', minWidth: 96, m: 'lead', render: row => sayiBicimi.format(row.count) },
];

function Nesil({ manifest, generation }: { manifest: Manifest; generation: GenerationHandle }) {
  const changeSet = useChangeSet();
  const sayimlar = useMemo<SayimSatiri[]>(
    () => Object.entries(manifest.counts).sort(([a], [b]) => a.localeCompare(b, 'tr-TR')).map(([collection, count]) => ({ id: collection, collection, count })),
    [manifest.counts],
  );
  const bekleyen = changeSet.ready ? sayiBicimi.format(changeSet.pending) : changeSet.message ?? 'Kapalı';
  return (
    <Bolum title="Nesil">
      <dl className="aile-veri-nesil">
        <div className="aile-veri-nesil-satir">
          <dt className="aile-kucuk aile-ikincil">Nesil kimliği</dt>
          <dd><code className="aile-veri-kimlik">{manifest.generation_id}</code></dd>
        </div>
        <div className="aile-veri-nesil-satir">
          <dt className="aile-kucuk aile-ikincil">Tutarlılık</dt>
          <dd>{tutarlilikMetni(manifest.consistency)}</dd>
        </div>
        <div className="aile-veri-nesil-satir">
          <dt className="aile-kucuk aile-ikincil">Kaynak</dt>
          <dd>{`${KAYNAK_TURU[generation.source.kind]} · ${generation.source.label}`}</dd>
        </div>
        <div className="aile-veri-nesil-satir">
          <dt className="aile-kucuk aile-ikincil">Son okuma</dt>
          <dd>{zamanMetni(generation.lastReadAt)}</dd>
        </div>
        <div className="aile-veri-nesil-satir">
          <dt className="aile-kucuk aile-ikincil">Bekleyen yerel değişiklik</dt>
          <dd>{bekleyen}</dd>
        </div>
      </dl>
      {sayimlar.length > 0 ? (
        <ResponsiveTable<SayimSatiri> caption="Koleksiyon sayıları" mobileCaption={`${sayiBicimi.format(sayimlar.length)} koleksiyon`} columns={SAYIM_SUTUNLARI} rows={sayimlar} mobileMode="list" />
      ) : (
        <p className="aile-veri-bos aile-ikincil">Manifestte koleksiyon sayısı yok.</p>
      )}
    </Bolum>
  );
}

// --- Sayfa -------------------------------------------------------------------------------------------------
function ozetOlculeri(manifest: Manifest | null, issueCount: number | null): PageHeaderSummary[] {
  const counts = manifest?.counts ?? {};
  const sorun = counts.issues === undefined ? HENUZ_YOK : sayiBicimi.format(issueCount ?? counts.issues);
  const kaynak = counts.sources === undefined ? HENUZ_YOK : sayiBicimi.format(counts.sources);
  const sayfa = counts.sheets === undefined ? undefined : `${sayiBicimi.format(counts.sheets)} sayfa`;
  const koleksiyon = manifest ? sayiBicimi.format(Object.keys(counts).length) : HENUZ_YOK;
  const olculer: PageHeaderSummary[] = [{ label: 'Çözülecek sorun', value: sorun }, { label: 'Kaynak', value: kaynak }, { label: 'Koleksiyon', value: koleksiyon }];
  if (sayfa) olculer[1] = { ...olculer[1]!, note: sayfa };
  return olculer;
}

export function VeriPage() {
  const generation = useGeneration();
  const device = useDevice();
  const issues = useCollection('issues');
  const noteId = useId();
  const { manifest, state, refresh, pickDirectory, canPickDirectory, sourceMessage } = generation;

  const status = useMemo(() => ({ ...dataStatusFor(generation), onRefresh: () => void refresh() }), [generation, refresh]);
  const issueCount = !issues.loading && !issues.error ? issues.rows.length : null;
  const summary = useMemo(() => ozetOlculeri(manifest, issueCount), [manifest, issueCount]);
  const onRetry = () => void refresh();

  const primary = (
    <Button variant="primary" icon="download" disabled={!canPickDirectory} aria-describedby={canPickDirectory ? undefined : noteId} onClick={() => void pickDirectory()}>
      Klasörden içe aktar
    </Button>
  );

  let body: ReactNode;
  if (state === 'error') {
    body = <ErrorState title="Veri okunamadı" message={generation.message ?? 'Hata: nesil okunamadı'} onRetry={onRetry} />;
  } else if (!manifest) {
    body = <LoadingShell rows={4} narrow={device === 'phone'} label="Nesil okunuyor" />;
  } else {
    body = (
      <>
        <Sorunlar onRetry={onRetry} />
        <KaynaklarVeSayfalar onRetry={onRetry} />
        <Nesil manifest={manifest} generation={generation} />
      </>
    );
  }

  return (
    <div className={`aile-veri${device === 'phone' ? ' aile-veri--dar' : ''}`}>
      <PageHeader location={LOCATION} section={SECTION} title={TITLE} purpose={PURPOSE} primary={primary} status={status} summary={summary}>
        {canPickDirectory ? null : (
          <p id={noteId} className="aile-veri-not aile-kucuk aile-ikincil">
            Bu tarayıcı klasör içe aktarmayı desteklemiyor; nesil geliştirme sunucusundan okunur.
          </p>
        )}
        {sourceMessage ? <p role="alert" className="aile-veri-hata">{sourceMessage}</p> : null}
      </PageHeader>
      <div className="aile-veri-icerik">{body}</div>
    </div>
  );
}
