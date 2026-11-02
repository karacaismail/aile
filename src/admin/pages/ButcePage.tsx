import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { lazyWide, useProfile } from '../adaptive';
import { Button, DataStatus, EmptyState, ErrorState, LoadingShell, Money, ResponsiveTable, Select, StatusText } from '../ui';
import type { DataStatusState, PageHeaderAction, PageHeaderSummary, ResponsiveColumn, Tone } from '../shell/contracts';
import { PageHeader } from '../shell/PageHeader';
import {
  LIVE_FAILURE_TITLE, MIRRORS_PLAN_NOTE, RECORDED_IN_SOURCE_TEXT, RECORDED_NOT_YET_TEXT, currentPeriod, isFuturePeriod, lastGoodBudget, lastReadAtOf,
  liveBudget, useCollection, useGeneration, type BudgetViewModel, type GenerationState, type LiveBudgetOptions, type LiveBudgetResult,
} from '../data';
import { ActualValue, PlannedValue, StatusValue } from './butce/cells';
import {
  HESAPLANMADI, budgetRowsFor, compareWithLive, defaultPeriod, periodLabel, periodMirrorsPlan,
  type BudgetRow, type Ownership,
} from './butce/model';
import './ButcePage.css';

// Bütçe ve nakit — tasarım: README.md "Sayfa iskeleti" + "Uyarlanır teslim", ekranlar.md SayfaButce / SayfaButceDar,
// bundle.js Pages.Butce (sütunlar Kalem · Planlanan · Gerçekleşen · Fark · Durum; telefonda Kalem title, Tür meta, Fark
// lead, Durum status). Veri: budget_observations hücre gözlemleri; muhasebe kaydı ya da toplanabilir toplam DEĞİLDİR.
// Saf mantık butce/model.ts'te (plan ve gerçek ayrı; Gerçekleşen anlamı yalnız data/actuals.ts'ten: gelecek dönem
// "Henüz yok", kanıtsız değer "Kaynakta yazılı", oran yalnız spendLabel'dan; fark yalnız iki taraf bilinen ve aynı para
// biriminde iken). Özet tutar değil sayımdır; sayfa hiçbir gözlemi toplamaz.
// Uyarlamalı teslim (W0): bu dosya telefon temel sunumudur ve antd/echarts/geniş kodu statik istemez. Telefonda kalem kalem
// akordeon (ResponsiveTable, ilk satır açık), dönem seçimi alttan açılan sayfa (Select telefonda BottomSheet). Seçili
// kalemin aylık eğilimi (Chart + yanında tablo) geniş-özeldir: butce/ButceTrend.wide.tsx, lazyWide ile yalnız tablet ve
// masaüstünde yüklenir; telefonda hiç indirilmez.
// Canlı GViz (live.liveBudget) ikinci DataStatus satırıdır (region "Canlı Sheet", başlığın dışında, gövdenin ilk satırı;
// başlıkta tek tazelik satırı nesildir): başarılıysa son okuma + nesil ile fark sayısı; hata sonucu son iyi okumayı
// (result.lastGood) taşıyorsa "eski" (lastGoodAt = lastReadAtOf(result)) ve yanında sınıflanmış neden; yoksa yalnız
// d01'in sınıflanmış "Hata: …" metni (tarayıcının ham "Failed to fetch" metni asla; tutar yok). Panelden yazma yok:
// "Kalem ekle" devre dışı ve nedeni yazılı.
// Durumlar ayrı ve adıyla: yükleniyor (LoadingShell), boş (EmptyState), hata (ErrorState, eski tutar yok), eski veri
// (son başarılı nesil gösterilir; tazelik satırı "stale").

export { budgetRowsFor, compareWithLive, defaultPeriod, periodLabel, type BudgetRow, type Ownership };

export interface ButcePageProps {
  location?: string;
  /** Varsayılan dönem, Gerçekleşen anlamı (gelecek dönem) ve canlı okuma zamanı için; test enjeksiyonu. */
  now?: () => Date;
  /** Canlı Sheet okuması; false ise satır çizilmez ve ağa çıkılmaz. */
  live?: boolean;
  liveBudgetImpl?: (options: LiveBudgetOptions) => Promise<LiveBudgetResult>;
  /** Saklı son iyi canlı okuma (açılışta, ağa çıkmadan); varsayılan live.lastGoodBudget (IndexedDB). Test enjeksiyonu. */
  lastGoodImpl?: () => Promise<BudgetViewModel | null>;
}

const LOCATION = '/butce';
const SECTION = 'Para';
const TITLE = 'Bütçe ve nakit';
const PURPOSE = 'Ayın gelirini, planlanan giderlerini ve kalan nakdi kalem kalem izleyin.';
const CAPTION = 'Bütçe kalemleri';
const EMPTY_TITLE = 'Kaynakta bütçe gözlemi kaydı yok';
const EMPTY_MESSAGE = 'Nesilde budget_observations koleksiyonu boş; Plan ve Gerçekleşen sayfalarında aylık başlıklı satır bulunmadı.';
const ADD_DISABLED_REASON = "Bu dilimde kalem eklenmez; Sheets'e yazma yok.";

/** Geniş-özel aylık eğilim; telefonda indirilmez (lazyWide stale guard). */
const ButceTrendWide = lazyWide('butce-egilim', () => import('./butce/ButceTrend.wide'));

const systemNow = () => new Date();

// --- Durum eşlemeleri ---------------------------------------------------------------------------------------
const GENERATION_STATUS: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };
const OWNERSHIP_LABEL: Record<Ownership, { label: string; tone: Tone }> = {
  leaf: { label: 'Kalem', tone: 'notr' },
  subtotal: { label: 'Ara toplam', tone: 'bilgi' },
  unknown: { label: 'Bilinmiyor', tone: 'notr' },
};
/** Telefon akordeon başlığında sütun adı yok: bilinmeyen tür adıyla yazılır. */
const OWNERSHIP_UNKNOWN_MOBILE = 'Tür bilinmiyor';

/**
 * Canlı okuma durumu (d01 sözleşmesi): başarı taze; hata sonucu son iyi okumayı (lastGood) taşıyorsa "eski" — son iyi
 * okuma gösterilir ama taze sayılmaz, zamanı lastReadAtOf(result); son iyi okuma yoksa yalnız sınıflanmış hata metni.
 */
type LiveState =
  /** previous: okunurken elde tutulan son okuma (önceki sonuç ya da açılışta saklı son iyi okuma); yoksa null. */
  | { status: 'checking'; previous: BudgetViewModel | null }
  | { status: 'ok'; budget: BudgetViewModel }
  | { status: 'stale'; budget: BudgetViewModel; lastGoodAt: string; message: string }
  | { status: 'error'; message: string };

/**
 * Okuyucu sözleşme dışı reddederse (liveBudget reddetmez; enjekte okuyucu edebilir) tarayıcının ham metni ("Failed to
 * fetch", "Load failed") gösterilmez: live.ts'in bilinmeyen hata sınıfıyla aynı Türkçe metin.
 */
const UNEXPECTED_LIVE_FAILURE = `Hata: ${LIVE_FAILURE_TITLE.network}. Bilinmeyen hata.`;

function liveStateOf(result: LiveBudgetResult): LiveState | null {
  if (result.ok) return { status: 'ok', budget: result.budget };
  if (result.kind === 'aborted') return null;
  const lastGoodAt = lastReadAtOf(result);
  if (result.lastGood && lastGoodAt) return { status: 'stale', budget: result.lastGood, lastGoodAt, message: result.message };
  return { status: 'error', message: result.message };
}

/** Elde tutulan son canlı okuma: taze ya da eski sonuç, okunurken önceki. */
const budgetOf = (state: LiveState): BudgetViewModel | null =>
  state.status === 'ok' || state.status === 'stale' ? state.budget : state.status === 'checking' ? state.previous : null;

function useLiveBudget(enabled: boolean, impl: ButcePageProps['liveBudgetImpl'], lastGoodImpl: ButcePageProps['lastGoodImpl'], now: (() => Date) | undefined) {
  const [state, setState] = useState<LiveState>({ status: 'checking', previous: null });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(count => count + 1), []);
  const read = impl ?? liveBudget;
  const readLastGood = lastGoodImpl ?? lastGoodBudget;
  // Açılışta saklı son iyi okuma (d01): ağ okuması sürerken "Son okuma …" zamanı ve sahiplik eşlemesi ondan gelir; taze
  // sayılmaz (durum "Okunuyor…"). Okuma bundan önce biterse dokunulmaz.
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    readLastGood().then(
      budget => {
        if (active && budget) setState(current => (current.status === 'checking' && !current.previous ? { status: 'checking', previous: budget } : current));
      },
      () => {},
    );
    return () => { active = false; };
  }, [enabled, readLastGood]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    // Yeniden okurken önceki okuma elde kalır: Tür sütunu ve fark sayımı "Bilinmiyor"a dönüp geri gelmez.
    setState(current => ({ status: 'checking', previous: budgetOf(current) }));
    Promise.resolve()
      .then(() => read({ signal: controller.signal, now }))
      .then(
        result => {
          if (controller.signal.aborted) return;
          const next = liveStateOf(result);
          if (next) setState(next);
        },
        () => {
          if (!controller.signal.aborted) setState({ status: 'error', message: UNEXPECTED_LIVE_FAILURE });
        },
      );
    return () => controller.abort();
  }, [enabled, read, now, attempt]);
  return { state, retry };
}

/** "Hata: Sheets'e ulaşılamadı. …" → "Sheets'e ulaşılamadı. …" (eski durumda neden; DataStatus "yenilenemedi" der). */
const reasonOf = (message: string) => message.trim().replace(/^Hata:\s*/i, '');

/** Gerçekleşen özeti: gelecek dönem ya da kayıt yoksa "Henüz yok"; varsa sayım + kanıt notu (tutar toplanmaz). */
function actualSummary(rows: readonly BudgetRow[], future: boolean, unclassified: number): PageHeaderSummary {
  const extra = unclassified ? `${unclassified} sınıflanmamış` : undefined;
  if (future) return { label: 'Gerçekleşen', value: RECORDED_NOT_YET_TEXT, note: extra };
  const recorded = rows.filter(row => row.recorded?.kind === 'recorded' || row.actualAmbiguous);
  if (!recorded.length) return { label: 'Gerçekleşen', value: RECORDED_NOT_YET_TEXT, note: extra };
  const inSource = recorded.some(row => row.recorded?.kind === 'recorded' && !row.recorded.evidence);
  const note = [inSource ? RECORDED_IN_SOURCE_TEXT : null, extra].filter(Boolean).join(' · ') || undefined;
  return { label: 'Gerçekleşen', value: `${recorded.length} gözlem`, note };
}

// --- Sayfa -------------------------------------------------------------------------------------------------
export function ButcePage({ location = LOCATION, now, live = true, liveBudgetImpl, lastGoodImpl }: ButcePageProps) {
  const profile = useProfile();
  const addReasonId = useId();
  const generation = useGeneration();
  const observations = useCollection('budget_observations');
  const { state: liveState, retry: retryLive } = useLiveBudget(live, liveBudgetImpl, lastGoodImpl, now);
  // Eski (stale) ya da okunurken elde tutulan canlı okuma da sahiplik eşlemesi ve karşılaştırma için kullanılır; canlı
  // satırı durumunu ("eski", "Okunuyor…") ayrıca söyler.
  const liveBudgetModel = budgetOf(liveState);

  // Gerçekleşen anlamı yalnız içinde bulunulan aya (Europe/Istanbul) bağlıdır: aynı ay içinde aynı an kullanılır, ay
  // değişince yeni an (bağımlılık bilerek yalnız dönem metni; satırlar her çizimde yeniden hesaplanmaz).
  const instant = (now ?? systemNow)();
  const todayPeriod = currentPeriod(instant);
  const today = useMemo(() => instant, [todayPeriod]);

  const periods = useMemo(() => {
    const set = new Set<string>();
    for (const observation of observations.rows) if (!observation.deleted_at && observation.period) set.add(observation.period);
    return [...set].sort();
  }, [observations.rows]);

  const [chosenPeriod, setChosenPeriod] = useState<string | null>(null);
  const period = chosenPeriod && periods.includes(chosenPeriod) ? chosenPeriod : defaultPeriod(periods, today);

  const rows = useMemo(() => (period ? budgetRowsFor(observations.rows, period, liveBudgetModel, today) : []), [observations.rows, period, liveBudgetModel, today]);
  const mirrored = useMemo(() => (period ? periodMirrorsPlan(observations.rows, period) : false), [observations.rows, period]);
  const [chosenLabel, setChosenLabel] = useState<string | null>(null);
  const selected = rows.find(row => row.label === chosenLabel) ?? rows[0] ?? null;

  const plannedCount = rows.filter(row => row.planned || row.plannedAmbiguous || row.plannedUnreadable).length;
  const unclassifiedCount = rows.reduce((total, row) => total + row.unclassified, 0);
  const ambiguousCount = rows.filter(row => row.plannedAmbiguous || row.actualAmbiguous).length;
  const future = period ? isFuturePeriod(period, today) : false;

  const summary: PageHeaderSummary[] | undefined = period
    ? [
        { label: 'Dönem', value: periodLabel(period), note: `${periods.length} dönem` },
        { label: 'Planlanan', value: `${plannedCount} gözlem`, note: ambiguousCount ? `${ambiguousCount} yinelenen` : undefined },
        actualSummary(rows, future, unclassifiedCount),
      ]
    : undefined;

  const exportRows = useCallback(() => {
    if (typeof window === 'undefined' || !rows.length) return;
    const head = ['Kalem', 'Dönem', 'Planlanan', 'Gerçekleşen', 'Fark', 'Para birimi', 'Durum', 'Tür'];
    const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = rows.map(row => [
      row.label, row.period, row.planned?.amount ?? '', row.actual?.amount ?? '', row.difference?.amount ?? '',
      row.planned?.currency ?? row.actual?.currency ?? '', row.status.label, OWNERSHIP_LABEL[row.ownership].label,
    ].map(cell).join(';'));
    const blob = new Blob([`﻿${[head.map(cell).join(';'), ...lines].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `butce-${period ?? 'donem'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [rows, period]);
  const more: PageHeaderAction[] = [{ label: 'Dışa aktar', icon: 'download', onClick: exportRows }];

  const status = {
    state: GENERATION_STATUS[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: () => { void generation.refresh(); },
  };

  const columns = useMemo<ResponsiveColumn<BudgetRow>[]>(() => [
    {
      key: 'label', title: 'Kalem', minWidth: 200, m: 'title', only: 'desktop',
      render: row => (
        <span className={`aile-butce-kalem${row.parent ? ' aile-butce-kalem--alt' : ''}`} data-level={row.parent ? 2 : 1}>
          <span className="aile-butce-kalem-ad">{row.label}</span>
          {row.parent ? <span className="aile-kucuk aile-ikincil">{row.parent}</span> : null}
        </span>
      ),
    },
    { key: 'planned', title: 'Planlanan', align: 'right', minWidth: 128, render: row => <PlannedValue planned={row.planned} unknown={row.plannedAmbiguous || row.plannedUnreadable} /> },
    { key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 136, render: row => <ActualValue recorded={row.recorded} unknown={row.actualAmbiguous} /> },
    { key: 'difference', title: 'Fark', align: 'right', minWidth: 120, only: 'desktop', render: row => <Money value={row.difference} label={HESAPLANMADI} /> },
    { key: 'status', title: 'Durum', minWidth: 136, m: 'status', render: row => <StatusValue row={row} /> },
    { key: 'ownership', title: 'Tür', minWidth: 120, only: 'desktop', render: row => <StatusText label={OWNERSHIP_LABEL[row.ownership].label} tone={OWNERSHIP_LABEL[row.ownership].tone} /> },
    // Telefon (SayfaButceDar): başlıkta düz kalem adı (title), altında ara toplam · tür (meta), sağda Fark (lead); gövdede
    // yinelenmez. Başlıkta sütun adı yoktur: "Bilinmiyor" ya da çıplak tutar neyi söylediğini yazar ("Tür bilinmiyor",
    // "Fark ₺…").
    { key: 'labelMobile', title: 'Kalem', minWidth: 0, m: 'title', only: 'mobile', render: row => row.label },
    {
      key: 'ownershipMobile', title: 'Tür', minWidth: 0, m: 'meta', only: 'mobile',
      render: row => {
        const kind = row.ownership === 'unknown' ? OWNERSHIP_UNKNOWN_MOBILE : OWNERSHIP_LABEL[row.ownership].label;
        return row.parent ? `${row.parent} · ${kind}` : kind;
      },
    },
    {
      key: 'differenceMobile', title: 'Fark', minWidth: 0, m: 'lead', only: 'mobile',
      render: row => (
        <span className="aile-butce-fark">
          <span className="aile-kucuk aile-ikincil">Fark</span> <Money value={row.difference} label={HESAPLANMADI} />
        </span>
      ),
    },
  ], []);

  const periodOptions = useMemo(() => periods.map(value => ({ value, label: periodLabel(value) })), [periods]);

  // --- Gövde ---------------------------------------------------------------------------------------------
  let body: ReactNode;
  if (observations.error) {
    body = (
      <div className="aile-butce-durumu">
        <ErrorState title="Bütçe gözlemleri okunamadı" message={observations.error} onRetry={() => { void generation.refresh(); }} />
      </div>
    );
  } else if (observations.loading) {
    body = <LoadingShell rows={8} narrow={profile === 'phone'} label="Bütçe gözlemleri yükleniyor" />;
  } else if (!period) {
    body = (
      <div className="aile-butce-durumu">
        <EmptyState title={EMPTY_TITLE} message={EMPTY_MESSAGE} />
      </div>
    );
  } else {
    body = (
      <>
        <div className="aile-butce-arac">
          <Select label="Dönem" options={periodOptions} value={period} onChange={setChosenPeriod} icon="calendar" className="aile-butce-donem" />
          {/* Tek satır içi kap: flex öğesinin baştaki boşluğu kırpılmasın ("8 kalem · Kasım 2026"). */}
          <p className="aile-butce-sayim"><span><strong>{rows.length} kalem</strong><span className="aile-ikincil"> · {periodLabel(period)}</span></span></p>
        </div>
        {mirrored ? <p role="note" className="aile-butce-not aile-butce-ayna">{MIRRORS_PLAN_NOTE}</p> : null}
        {rows.length ? (
          <ResponsiveTable<BudgetRow>
            caption={CAPTION}
            mobileCaption={`${rows.length} kalem`}
            columns={columns}
            rows={rows}
            selectedKey={selected?.key}
            onRowClick={row => setChosenLabel(row.label)}
            groupBy={liveBudgetModel ? row => row.parent ?? (row.ownership === 'subtotal' ? row.label : 'Diğer') : undefined}
          />
        ) : (
          <div className="aile-butce-durumu">
            <EmptyState title={`${periodLabel(period)} döneminde kalem yok`} message="Bu dönemde silinmemiş, etiketli bütçe gözlemi bulunmadı; başka bir dönem seçin." />
          </div>
        )}
        <p className="aile-kucuk aile-ikincil aile-butce-not">
          Fark = Planlanan − Gerçekleşen; eksi ise kalem aşılmıştır. Ödeme kanıtı olmayan Gerçekleşen değeri “{RECORDED_IN_SOURCE_TEXT}”
          diye işaretlenir ve oran hesaplanmaz; içinde bulunulan aydan sonraki dönemde Gerçekleşen “{RECORDED_NOT_YET_TEXT}”.
          Gözlemler toplanmaz; ara toplam satırı çocuklarıyla toplanmaz
          {liveBudgetModel ? '. Tür canlı Sheet eşlemesinden gelir.' : '; satır türü canlı Sheet eşlemesi olmadan bilinmez.'}
        </p>
        {selected ? <ButceTrendWide observations={observations.rows} periods={periods} label={selected.label} today={today} /> : null}
      </>
    );
  }

  // --- Canlı Sheet satırı ----------------------------------------------------------------------------------
  let liveRow: ReactNode = null;
  if (live) {
    const liveStatus: DataStatusState = liveState.status === 'checking' ? 'checking' : liveState.status === 'ok' ? 'fresh' : liveState.status;
    const differing = liveBudgetModel && period ? compareWithLive(rows, liveBudgetModel, period) : null;
    liveRow = (
      <section className="aile-butce-canli" aria-label="Canlı Sheet">
        <span className="aile-kucuk aile-ikincil aile-butce-canli-etiket">Canlı Sheet</span>
        <DataStatus
          state={liveStatus}
          lastReadAt={liveBudgetModel && liveState.status !== 'stale' ? liveBudgetModel.readAt : undefined}
          lastGoodAt={liveState.status === 'stale' ? liveState.lastGoodAt : undefined}
          message={liveState.status === 'error' ? liveState.message : undefined}
          onRefresh={retryLive}
        />
        {liveState.status === 'stale' ? <span className="aile-kucuk aile-ikincil aile-butce-canli-neden">{reasonOf(liveState.message)}</span> : null}
        {differing !== null ? (
          <span className="aile-kucuk aile-butce-canli-fark">{differing === 0 ? 'Nesil ile fark yok' : `Nesil ile ${differing} fark`}</span>
        ) : null}
      </section>
    );
  }

  return (
    <div className="aile-butce">
      <PageHeader
        location={location}
        section={SECTION}
        title={TITLE}
        purpose={PURPOSE}
        primary={
          <span className="aile-butce-birincil">
            <Button variant="primary" icon="plus" disabled aria-describedby={addReasonId}>Kalem ekle</Button>
            <span id={addReasonId} className="aile-kucuk aile-ikincil">{ADD_DISABLED_REASON}</span>
          </span>
        }
        more={more}
        status={status}
        summary={summary}
      />
      {/* Başlıkta tek tazelik satırı (nesil, PageHeader status); canlı Sheet satırı ikinci kaynak olduğu için başlığın
          dışında, gövdenin ilk satırıdır. */}
      <div className="aile-butce-govde">
        {liveRow}
        {body}
      </div>
    </div>
  );
}
