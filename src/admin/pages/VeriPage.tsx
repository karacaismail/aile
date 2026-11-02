import { useId, useMemo, type ReactNode } from 'react';
import { useDevice } from '../device';
import {
  useChangeSet,
  useCollection,
  useGeneration,
  type GenerationHandle,
  type GenerationSourceKind,
  type Manifest,
  type SheetRecord,
  type SourceRecord,
} from '../data';
import { PageHeader } from '../shell/PageHeader';
import type { DataStatusProps, PageHeaderSummary, ResponsiveColumn } from '../shell/contracts';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { LoadingShell } from '../ui/LoadingShell';
import { ResponsiveTable } from '../ui/ResponsiveTable';
import { BILINMIYOR, HENUZ_YOK, sayi, zamanMetni } from './veri/bicim';
import { NesilSecimi } from './veri/NesilSecimi';
import { SorunKuyrugu } from './veri/SorunKuyrugu';
import { useKlasorIceAktarma } from './veri/useKlasorIceAktarma';
import './VeriPage.css';

// Tasarım: bundle.js Pages.VeriKalitesi (Sec blokları: "Çözülecek sorunlar", "İçe aktarma geçmişi"), README "Sayfa
// iskeleti", "Veri durumları" ve "Uyarlanır teslim"; ekranlar.md SayfaVeriKalitesi / SayfaVeriKalitesiDar. Telefon önce:
// başlık + amaç + tek birincil eylem ("Klasörden içe aktar") ilk ekranda; sorun kuyruğu türe göre gruplu, kaynak hücre
// adresli ve sayfalı (veri/SorunKuyrugu); tablolar telefonda akordeon/liste (ResponsiveTable). Geniş profil yalnız
// ResponsiveTable'ın tablo biçimini alır; sayfaya özgü geniş-özel modül yok, telefon bu sayfa için antd/echarts/*.wide
// istemez (VeriPage.test.tsx › teslim kuralı).
// Klasör içe aktarma özellik algılamayla seçilir (veri/klasor.ts): showDirectoryPicker → <input webkitdirectory> → yok.
// Klasörde birden çok nesil varsa "Nesil seçin" sorulur. Referanstaki çakışma bloğu ve içe aktarma geçmişi yok: panel
// Sheets'e yazmaz (çakışma üretmez) ve nesil geçmişi tutmaz; bölüm hiç çizilmez. Para yok; sayımlar koleksiyon başına.
// Koleksiyonlar yalnız manifest yayınlandıktan sonra istenir: aksi hâlde depo manifesti eşzamanlı iki kez okuyup iki kez
// yayınlıyordu (açılış uzar, "Yenile" daha uzun süre devre dışı kalır; VeriPage.test.tsx › açılış).

const LOCATION = '/veri';
const SECTION = 'Yapı';
const TITLE = 'Veri kalitesi ve içe aktarma';
const PURPOSE = 'E-tablodan gelen veriyi içe aktarın, eşleşmeyen satırları ve çakışmaları çözün.';
const DESTEK_YOK = 'Bu tarayıcı klasör içe aktarmayı desteklemiyor; nesil geliştirme sunucusundan okunur.';

export { zamanMetni } from './veri/bicim';
export { etkiMetni, sorunTuru } from './veri/sorunlar';

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
  <span className="aile-veri-sayim aile-kucuk aile-ikincil">{`${sayi(count)} ${unit}`}</span>
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
        <SorunKuyrugu sorunlar={issues.rows} />
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
  { key: 'sheetCount', title: 'Sayfa', align: 'right', minWidth: 88, render: row => sayi(row.sheetCount) },
  { key: 'note', title: 'Not', minWidth: 240 },
];

interface SayfaSatiri { id: string; title: string; sourceKey: string; rowCount: number; cellCount: number }

const SAYFA_SUTUNLARI: readonly ResponsiveColumn<SayfaSatiri>[] = [
  { key: 'title', title: 'Başlık', minWidth: 168, m: 'title' },
  { key: 'sourceKey', title: 'Kaynak', minWidth: 136, m: 'meta' },
  { key: 'rowCount', title: 'Dolu satır', align: 'right', minWidth: 112, render: row => sayi(row.rowCount) },
  { key: 'cellCount', title: 'Dolu hücre', align: 'right', minWidth: 112, render: row => sayi(row.cellCount) },
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
          <ResponsiveTable<KaynakSatiri> caption="Kaynaklar" mobileCaption={`${sayi(kaynakSatirlari.length)} kaynak`} columns={KAYNAK_SUTUNLARI} rows={kaynakSatirlari} />
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
          <ResponsiveTable<SayfaSatiri> caption="Sayfalar" mobileCaption={`${sayi(sayfaSatirlari.length)} sayfa`} columns={SAYFA_SUTUNLARI} rows={sayfaSatirlari} />
        </KoleksiyonDurumu>
      </Bolum>
    </>
  );
}

// --- Nesil bilgisi (manifest) -------------------------------------------------------------------------------
interface SayimSatiri { id: string; collection: string; count: number }
const SAYIM_SUTUNLARI: readonly ResponsiveColumn<SayimSatiri>[] = [
  { key: 'collection', title: 'Koleksiyon', minWidth: 200, m: 'title' },
  { key: 'count', title: 'Kayıt', align: 'right', minWidth: 96, m: 'lead', render: row => sayi(row.count) },
];

function Nesil({ manifest, generation }: { manifest: Manifest; generation: GenerationHandle }) {
  const changeSet = useChangeSet();
  const sayimlar = useMemo<SayimSatiri[]>(
    () => Object.entries(manifest.counts).sort(([a], [b]) => a.localeCompare(b, 'tr-TR')).map(([collection, count]) => ({ id: collection, collection, count })),
    [manifest.counts],
  );
  const bekleyen = changeSet.ready ? sayi(changeSet.pending) : changeSet.message ?? 'Kapalı';
  return (
    <Bolum title="Nesil">
      <dl className="aile-veri-nesil">
        <div className="aile-veri-nesil-satir">
          <dt className="aile-kucuk aile-ikincil">Nesil kimliği</dt>
          <dd><code className="aile-veri-kimlik aile-kucuk">{manifest.generation_id}</code></dd>
        </div>
        <div className="aile-veri-nesil-satir">
          <dt className="aile-kucuk aile-ikincil">Tutarlılık</dt>
          <dd>{tutarlilikMetni(manifest.consistency)}</dd>
        </div>
        <div className="aile-veri-nesil-satir">
          <dt className="aile-kucuk aile-ikincil">Kaynak</dt>
          <dd className="aile-veri-kaynak">{`${KAYNAK_TURU[generation.source.kind]} · ${generation.source.label}`}</dd>
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
        <ResponsiveTable<SayimSatiri> caption="Koleksiyon sayıları" mobileCaption={`${sayi(sayimlar.length)} koleksiyon`} columns={SAYIM_SUTUNLARI} rows={sayimlar} mobileMode="list" />
      ) : (
        <p className="aile-veri-bos aile-ikincil">Manifestte koleksiyon sayısı yok.</p>
      )}
    </Bolum>
  );
}

// --- Sayfa -------------------------------------------------------------------------------------------------
/** Özet manifest sayımlarından gelir (koleksiyon indirmeden); sayım yoksa uydurulmaz: "Henüz yok". */
function ozetOlculeri(manifest: Manifest | null): PageHeaderSummary[] {
  const counts = manifest?.counts ?? {};
  const sorun = counts.issues === undefined ? HENUZ_YOK : sayi(counts.issues);
  const kaynak = counts.sources === undefined ? HENUZ_YOK : sayi(counts.sources);
  const koleksiyon = manifest ? sayi(Object.keys(counts).length) : HENUZ_YOK;
  const kaynakOlcusu: PageHeaderSummary = { label: 'Kaynak', value: kaynak };
  if (counts.sheets !== undefined) kaynakOlcusu.note = `${sayi(counts.sheets)} sayfa`;
  return [{ label: 'Çözülecek sorun', value: sorun }, kaynakOlcusu, { label: 'Koleksiyon', value: koleksiyon }];
}

export function VeriPage() {
  const generation = useGeneration();
  const device = useDevice();
  const noteId = useId();
  const { manifest, state, refresh, pickDirectory, sourceMessage } = generation;
  const iceAktarma = useKlasorIceAktarma(pickDirectory);

  const status = useMemo(() => ({ ...dataStatusFor(generation), onRefresh: () => void refresh() }), [generation, refresh]);
  const summary = useMemo(() => ozetOlculeri(manifest), [manifest]);
  const onRetry = () => void refresh();
  const desteklenmiyor = iceAktarma.yontem === 'yok';
  const okunuyor = iceAktarma.asama === 'okunuyor';

  const primary = (
    <>
      <Button
        variant="primary"
        icon="download"
        disabled={desteklenmiyor || okunuyor}
        aria-describedby={desteklenmiyor ? noteId : undefined}
        onClick={iceAktarma.baslat}
      >
        Klasörden içe aktar
      </Button>
      {iceAktarma.yontem === 'girdi' ? (
        <input ref={iceAktarma.girdiRef} className="aile-veri-girdi" type="file" multiple hidden tabIndex={-1} onChange={iceAktarma.dosyalarSecildi} />
      ) : null}
    </>
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
        {desteklenmiyor ? <p id={noteId} className="aile-veri-not aile-kucuk aile-ikincil">{DESTEK_YOK}</p> : null}
        {okunuyor ? <p role="status" className="aile-veri-not aile-kucuk aile-ikincil">Klasör okunuyor…</p> : null}
        {iceAktarma.hata ? <p role="alert" className="aile-veri-hata">{iceAktarma.hata}</p> : null}
        {sourceMessage ? <p role="alert" className="aile-veri-hata">{sourceMessage}</p> : null}
      </PageHeader>
      <div className="aile-veri-icerik">{body}</div>
      <NesilSecimi
        open={iceAktarma.asama === 'secim'}
        adaylar={iceAktarma.adaylar}
        atlanan={iceAktarma.atlanan}
        onSec={iceAktarma.sec}
        onVazgec={iceAktarma.vazgec}
      />
    </div>
  );
}
