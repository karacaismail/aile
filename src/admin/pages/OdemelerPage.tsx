import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useCollection, useGeneration, type ForecastEvent, type GenerationState } from '../data';
import { useDevice } from '../device';
import type {
  ActiveFilter, DataStatusProps, DataStatusState, FilterFacet, Money as MoneyValue, RecordRow, ResponsiveColumn, SortOption, StatusLabel, ViewMode,
} from '../shell/contracts';
import { FilterDrawer } from '../shell/FilterDrawer';
import { FilterPanel, RANGE_KEYS, rangeValue } from '../shell/FilterPanel';
import { PageHeader } from '../shell/PageHeader';
import { QueryBar } from '../shell/QueryBar';
import { EmptyState, ErrorState, FilterArea, LoadingShell, ResponsiveTable, Tag, Timeline } from '../ui';
import { formatMoney, HENUZ_YOK, parseMoneyInput } from '../ui/Money';
import './OdemelerPage.css';

// Tasarım: README.md › Sayfa iskeleti; ekranlar.md › Ödemeler (SayfaOdemeler / SayfaOdemelerDar); referans davranış
// bundle.js › Pages.Odemeler (ResponsiveTable groupBy "Gecikenler · Bu hafta · Sonra · Ödenenler", geciken üstte;
// gantt kapalı: "ödemelerin tek tarihi var, süresi yok"; sıralama Tarihe / Tutara göre).
// Veri: nesilde `payments` koleksiyonu YOK (app_nakit boş). Sayfa bunu üstte adıyla söyler ve yerine bütçe tahmin
// olaylarını (forecast_events) "tahmini ödeme" olarak listeler. Tutar plan sütunundadır (measures.planned); gerçek
// (measures.actual) yoksa "Henüz yok" yazılır. Plan ve gerçek hiçbir yerde tek sayıda birleşmez; özet üç ölçüsü de
// ayrı adlandırılır ("Geciken (plan)", "Bu hafta (plan)", "Ödenen (gerçek)").
// Gruplar `now`'a göre: tarihi geçmiş ve ödenmemiş → Gecikenler; 0–6 gün → Bu hafta; sonrası → Sonra; gerçek tutarı
// olan → Ödenenler; tarihsiz → "Tarihi bilinmiyor" (gizlenmez). Durum sözcükle yazılır ("Gecikti · 4 gün"); renk tek
// işaret değildir. Filtreler: tarih (tür + aralık gg.aa.yyyy), tutar (En az / En çok ₺), durum grubu; FilterPanel
// sözleşmesiyle (baslangic= / bitis= / enaz= / encok=). Masaüstünde FilterArea (Zaman çizelgesinde açık, Tabloda
// şerit), tablet ve telefonda FilterDrawer. Yazma eylemi yok: payments kaynakta olmadığı için "Ödeme kaydet" düğmesi
// sahte olurdu; birincil eylem bilinçli olarak verilmez.

export interface OdemelerPageProps {
  location: string;
  /** Bugünün tarihi (gruplama ve gecikme günü için); testte sabitlenir. */
  now?: () => Date;
}

type GroupKey = 'geciken' | 'buhafta' | 'sonra' | 'odenen' | 'bilinmiyor';
const GROUP_ORDER: readonly GroupKey[] = ['geciken', 'buhafta', 'sonra', 'odenen', 'bilinmiyor'];
const GROUP_LABELS: Readonly<Record<GroupKey, string>> = {
  geciken: 'Gecikenler', buhafta: 'Bu hafta', sonra: 'Sonra', odenen: 'Ödenenler', bilinmiyor: 'Tarihi bilinmiyor',
};
const EVENT_TYPES: Readonly<Record<string, string>> = {
  purchase: 'Alım', payment: 'Ödeme', fee: 'Ücret', interest: 'Faiz', borrowing: 'Borçlanma', repayment: 'Geri ödeme',
};
const CERTAINTY: Readonly<Record<string, string>> = { planned: 'Planlandı', estimated: 'Tutar tahmini' };

const NOT = 'Kaynakta kaydedilmiş ödeme yok (app_nakit boş). Aşağıdaki satırlar bütçe tahmin olaylarıdır (forecast_events); gerçekleşen ödeme değildir.';
const KAYNAKTA_YOK_BASLIK = 'Kaynakta tahmini ödeme kaydı yok';
const KAYNAKTA_YOK_METIN = 'Nesilde forecast_events koleksiyonu boş. Bütçe sayfasındaki tahmin üretilince ödemeler burada görünür.';
const TABLO_ADI = 'Tahmini ödemeler';
const ODEME_YOK = 'Ödeme yok';
const KOD_YOK = 'Kod yok';
const TARIHI_BILINMIYOR = 'Tarihi bilinmiyor';
const HAFTA_GUN = 7;
const GUN_MS = 86_400_000;

const SUPPORTED: readonly ViewMode[] = ['table', 'timeline'];
const UNSUPPORTED: Partial<Record<ViewMode, string>> = {
  listing: 'tahmini ödemelerin fotoğrafı ve odası yok',
  kanban: 'tahmini ödemelerin durum akışı yok',
  gantt_chart: 'ödemelerin tek tarihi var, süresi yok',
  pivot: 'tahmini ödemelerin kırılım boyutu yok',
};
const SORTS: readonly SortOption[] = [
  { key: 'tarih', label: 'Tarihe göre', direction: 'asc' },
  { key: 'tutar', label: 'Tutara göre', direction: 'desc' },
];

const sayi = new Intl.NumberFormat('tr-TR');
const tarihBicimi = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const ISO_GUN = /^(\d{4})-(\d{2})-(\d{2})/;
const TR_GUN = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

// --- Tarih yardımcıları (gün sayısı; saat dilimi etkisi yok) ---------------------------------------------
/** ISO "YYYY-MM-DD" → epoch gün; okunamazsa null. */
export function isoToDay(iso: string | null | undefined): number | null {
  const m = iso ? ISO_GUN.exec(iso) : null;
  if (!m) return null;
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(day) ? null : Math.floor(day / GUN_MS);
}
/** "gg.aa.yyyy" → epoch gün; boş ya da okunamayan girdi null. */
export function trToDay(text: string): number | null {
  const m = TR_GUN.exec(text.trim());
  if (!m) return null;
  const year = Number(m[3]);
  const month = Number(m[2]);
  const date = Number(m[1]);
  const utc = new Date(Date.UTC(year, month - 1, date));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== date) return null;
  return Math.floor(utc.getTime() / GUN_MS);
}
const dayToText = (day: number) => tarihBicimi.format(new Date(day * GUN_MS));
const todayOf = (now: Date) => Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / GUN_MS);

// --- Para toplamı (ondalık metin, kuruş tam sayısı; yuvarlama yok) ------------------------------------
function toCents(amount: string): bigint | null {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return null;
  const frac = (m[3] ?? '').padEnd(2, '0');
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) return null;
  const cents = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  return m[1] ? -cents : cents;
}
/** Aynı para birimindeki tutarları toplar; boş liste null; karışık birim ya da bozuk tutar "Bilinmiyor" (undefined). */
export function sumMoney(values: readonly MoneyValue[]): MoneyValue | null | undefined {
  if (values.length === 0) return null;
  const currency = values[0]!.currency;
  let total = 0n;
  for (const value of values) {
    if (value.currency !== currency) return undefined;
    const cents = toCents(value.amount);
    if (cents === null) return undefined;
    total += cents;
  }
  const sign = total < 0n ? '-' : '';
  const abs = total < 0n ? -total : total;
  return { amount: `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`, currency };
}
const amountNumber = (value: MoneyValue | null) => (value ? Number(value.amount) : null);

// --- Satır modeli ----------------------------------------------------------------------------------------
export interface OdemeRow {
  id: string;
  code: string;
  label: string;
  type: string;
  day: number | null;
  dateText: string;
  planned: MoneyValue | null;
  actual: MoneyValue | null;
  group: GroupKey;
  status: StatusLabel;
}

const moneyOf = (value: unknown): MoneyValue | null => {
  if (!value || typeof value !== 'object') return null;
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  return typeof amount === 'string' && typeof currency === 'string' ? { amount, currency } : null;
};

export function toOdemeRow(event: ForecastEvent, today: number): OdemeRow {
  const measures = (event.measures ?? {}) as { planned?: unknown; actual?: unknown };
  const planned = moneyOf(measures.planned) ?? moneyOf(event.amount);
  const actual = moneyOf(measures.actual);
  const day = isoToDay(event.occurred_on);
  const certainty = typeof event.certainty === 'string' ? (CERTAINTY[event.certainty] ?? 'Planlandı') : 'Planlandı';
  const certaintyTone = event.certainty === 'estimated' ? 'uyari' : 'notr';
  let group: GroupKey;
  let status: StatusLabel;
  if (actual) {
    group = 'odenen';
    status = { label: 'Ödendi', tone: 'olumlu' };
  } else if (day === null) {
    group = 'bilinmiyor';
    status = { label: TARIHI_BILINMIYOR, tone: 'uyari' };
  } else if (day < today) {
    group = 'geciken';
    status = { label: `Gecikti · ${sayi.format(today - day)} gün`, tone: 'hata' };
  } else {
    group = day < today + HAFTA_GUN ? 'buhafta' : 'sonra';
    status = { label: certainty, tone: certaintyTone };
  }
  const rawType = typeof event.event_type === 'string' ? event.event_type : '';
  return {
    id: event.id,
    code: event.source_record_id ?? KOD_YOK,
    label: event.label ?? 'Adı yok',
    type: EVENT_TYPES[rawType] ?? (rawType || 'Bilinmiyor'),
    day,
    dateText: day === null ? TARIHI_BILINMIYOR : dayToText(day),
    planned,
    actual,
    group,
    status,
  };
}

const toRecordRow = (row: OdemeRow): RecordRow => ({
  id: row.id,
  code: row.code,
  label: row.label,
  status: row.status,
  category: row.type,
  planned: row.planned,
  actual: row.actual,
  dates: row.day === null ? {} : { paid: new Date(row.day * GUN_MS).toISOString().slice(0, 10) },
  kind: 'forecast_event',
});

// --- Filtre durumu --------------------------------------------------------------------------------------
type Selected = Record<'tarih' | 'tutar' | 'durum', readonly string[]>;
const EMPTY_SELECTED: Selected = { tarih: [], tutar: [], durum: [] };
const DATE_TYPE = 'tahmini';
const RANGE_PREFIXES: readonly string[] = Object.values(RANGE_KEYS);

/** Aynı önekli eski aralık girdisini değiştirir; boş değer girdiyi kaldırır; seçenek değeri iki durumlu. */
function toggleValue(current: readonly string[], value: string): readonly string[] {
  const prefix = RANGE_PREFIXES.find(p => value.startsWith(p));
  if (prefix) {
    const rest = current.filter(entry => !entry.startsWith(prefix));
    return value.length > prefix.length ? [...rest, value] : rest;
  }
  return current.includes(value) ? current.filter(entry => entry !== value) : [...current, value];
}

const DATA_STATUS: Readonly<Record<GenerationState, DataStatusState>> = {
  idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error',
};

// --- Sayfa ----------------------------------------------------------------------------------------------
export function OdemelerPage({ location, now }: OdemelerPageProps) {
  const device = useDevice();
  const generation = useGeneration();
  const events = useCollection('forecast_events');
  const today = todayOf(now ? now() : new Date());

  const [mode, setMode] = useState<ViewMode>('table');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>(SORTS[0]!);
  const [selected, setSelected] = useState<Selected>(EMPTY_SELECTED);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const rows = useMemo(() => events.rows.map(event => toOdemeRow(event, today)), [events.rows, today]);

  // Aralıklar
  const baslangic = trToDay(rangeValue(selected.tarih, RANGE_KEYS.baslangic));
  const bitis = trToDay(rangeValue(selected.tarih, RANGE_KEYS.bitis));
  const enAzText = parseMoneyInput(rangeValue(selected.tutar, RANGE_KEYS.enAz));
  const enCokText = parseMoneyInput(rangeValue(selected.tutar, RANGE_KEYS.enCok));
  const enAz = enAzText === null ? null : Number(enAzText);
  const enCok = enCokText === null ? null : Number(enCokText);
  const durumlar = selected.durum.filter((value): value is GroupKey => (GROUP_ORDER as readonly string[]).includes(value));

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    const list = rows.filter(row => {
      if (q && !`${row.label} ${row.code} ${row.type}`.toLocaleLowerCase('tr-TR').includes(q)) return false;
      if (baslangic !== null && (row.day === null || row.day < baslangic)) return false;
      if (bitis !== null && (row.day === null || row.day > bitis)) return false;
      const amount = amountNumber(row.planned);
      if (enAz !== null && (amount === null || amount < enAz)) return false;
      if (enCok !== null && (amount === null || amount > enCok)) return false;
      if (durumlar.length > 0 && !durumlar.includes(row.group)) return false;
      return true;
    });
    const byGroup = (row: OdemeRow) => GROUP_ORDER.indexOf(row.group);
    const bySort = (a: OdemeRow, b: OdemeRow) => {
      if (sort.key === 'tutar') {
        const diff = (amountNumber(a.planned) ?? -Infinity) - (amountNumber(b.planned) ?? -Infinity);
        return sort.direction === 'desc' ? -diff : diff;
      }
      const diff = (a.day ?? Infinity) - (b.day ?? Infinity);
      return sort.direction === 'desc' ? -diff : diff;
    };
    return [...list].sort((a, b) => byGroup(a) - byGroup(b) || bySort(a, b));
  }, [rows, search, baslangic, bitis, enAz, enCok, durumlar, sort]);

  const groupCounts = useMemo(() => {
    const counts = new Map<GroupKey, number>();
    for (const row of rows) counts.set(row.group, (counts.get(row.group) ?? 0) + 1);
    return counts;
  }, [rows]);

  // Özet: plan ve gerçek ayrı ölçüler
  const summary = useMemo(() => {
    const planOf = (group: GroupKey) => {
      const members = rows.filter(row => row.group === group);
      const total = sumMoney(members.map(row => row.planned).filter((value): value is MoneyValue => value !== null));
      return { value: members.length === 0 ? ODEME_YOK : formatMoney(total, ODEME_YOK), note: `${sayi.format(members.length)} tahmini ödeme` };
    };
    const paid = rows.filter(row => row.actual !== null);
    const paidTotal = sumMoney(paid.map(row => row.actual!));
    return [
      { label: 'Geciken (plan)', ...planOf('geciken') },
      { label: 'Bu hafta (plan)', ...planOf('buhafta') },
      {
        label: 'Ödenen (gerçek)',
        value: paid.length === 0 ? HENUZ_YOK : formatMoney(paidTotal, HENUZ_YOK),
        note: paid.length === 0 ? 'Kaynakta kaydedilmiş ödeme yok' : `${sayi.format(paid.length)} ödeme`,
      },
    ];
  }, [rows]);

  const onToggle = useCallback((facetId: string, value: string) => {
    if (facetId !== 'tarih' && facetId !== 'tutar' && facetId !== 'durum') return;
    setSelected(current => ({ ...current, [facetId]: toggleValue(current[facetId], value) }));
  }, []);
  const onClear = useCallback(() => setSelected(EMPTY_SELECTED), []);
  const remove = (facetId: keyof Selected, value: string) => () => onToggle(facetId, value);

  const facets: readonly FilterFacet[] = [
    { id: 'tarih', label: 'Tarih', kind: 'date', options: [{ value: DATE_TYPE, label: 'Tahmini tarih' }], selected: selected.tarih },
    { id: 'tutar', label: 'Tutar (plan)', kind: 'amount', options: [], selected: selected.tutar },
    {
      id: 'durum', label: 'Durum', kind: 'checkbox', selected: selected.durum,
      options: GROUP_ORDER.map(key => ({ value: key, label: GROUP_LABELS[key], count: groupCounts.get(key) ?? 0 })),
    },
  ];

  const activeFilters: ActiveFilter[] = [];
  const baslangicText = rangeValue(selected.tarih, RANGE_KEYS.baslangic);
  const bitisText = rangeValue(selected.tarih, RANGE_KEYS.bitis);
  if (baslangicText && bitisText) {
    activeFilters.push({ id: 'tarih', label: `Tarih: ${baslangicText} – ${bitisText}`, onRemove: () => setSelected(c => ({ ...c, tarih: [] })) });
  } else if (baslangicText) {
    activeFilters.push({ id: 'tarih-b', label: `Tarih: ${baslangicText} ve sonrası`, onRemove: remove('tarih', RANGE_KEYS.baslangic) });
  } else if (bitisText) {
    activeFilters.push({ id: 'tarih-s', label: `Tarih: ${bitisText} ve öncesi`, onRemove: remove('tarih', RANGE_KEYS.bitis) });
  }
  if (enAzText !== null) {
    activeFilters.push({ id: 'enaz', label: `Tutar: en az ${formatMoney({ amount: enAzText, currency: 'TRY' })}`, onRemove: remove('tutar', RANGE_KEYS.enAz) });
  }
  if (enCokText !== null) {
    activeFilters.push({ id: 'encok', label: `Tutar: en çok ${formatMoney({ amount: enCokText, currency: 'TRY' })}`, onRemove: remove('tutar', RANGE_KEYS.enCok) });
  }
  for (const group of durumlar) activeFilters.push({ id: `durum-${group}`, label: `Durum: ${GROUP_LABELS[group]}`, onRemove: remove('durum', group) });

  const status: DataStatusProps = {
    state: DATA_STATUS[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: () => void generation.refresh(),
  };

  const columns: readonly ResponsiveColumn<OdemeRow>[] = [
    { key: 'tarih', title: 'Tarih', minWidth: 112, m: 'meta', render: row => row.dateText },
    {
      key: 'ad', title: 'Ödeme', minWidth: 220, m: 'title', only: 'desktop',
      render: row => (
        <>
          <strong className="aile-odemeler-ad">{row.label}</strong>
          <span className="aile-kucuk aile-ikincil">{`${row.code} · ${row.type}`}</span>
        </>
      ),
    },
    { key: 'ad2', title: 'Ödeme', minWidth: 220, m: 'title', only: 'mobile', render: row => row.label },
    { key: 'tur', title: 'Tür', minWidth: 120, m: 'meta', only: 'mobile', render: row => row.type },
    { key: 'plan', title: 'Planlanan', align: 'right', minWidth: 128, m: 'lead', render: row => formatMoney(row.planned) },
    { key: 'gercek', title: 'Gerçekleşen', align: 'right', minWidth: 128, render: row => formatMoney(row.actual, HENUZ_YOK) },
    { key: 'durum', title: 'Durum', minWidth: 160, m: 'status', render: row => <Tag tone={row.status.tone}>{row.status.label}</Tag> },
    { key: 'kod', title: 'Kimlik', minWidth: 112, only: 'mobile', render: row => row.code },
  ];

  const geciken = filtered.filter(row => row.group === 'geciken').length;
  const countText = `${sayi.format(filtered.length)} tahmini ödeme${geciken > 0 ? ` · ${sayi.format(geciken)} geciken` : ''}`;
  const timelineRows = useMemo(() => filtered.map(toRecordRow), [filtered]);

  let content: ReactNode;
  const loading = events.loading || generation.state === 'idle' || generation.state === 'checking';
  if (events.error && rows.length === 0) {
    content = <ErrorState message={events.error} onRetry={() => void generation.refresh()} />;
  } else if (generation.state === 'error' && rows.length === 0) {
    content = <ErrorState message={generation.message ?? undefined} onRetry={() => void generation.refresh()} />;
  } else if (loading && rows.length === 0) {
    content = <LoadingShell narrow={device === 'phone'} />;
  } else if (rows.length === 0) {
    content = <EmptyState title={KAYNAKTA_YOK_BASLIK} message={KAYNAKTA_YOK_METIN} />;
  } else if (filtered.length === 0) {
    content = <EmptyState filters={activeFilters.length ? activeFilters : [`Arama: ${search}`]} onClear={() => { onClear(); setSearch(''); }} />;
  } else {
    content = (
      <>
        <p className="aile-odemeler-sayim">{countText}</p>
        {mode === 'timeline' ? (
          <Timeline items={timelineRows} dateField="paid" />
        ) : (
          <ResponsiveTable<OdemeRow>
            caption={TABLO_ADI}
            mobileCaption={countText}
            columns={columns}
            rows={filtered}
            groupBy={row => GROUP_LABELS[row.group]}
          />
        )}
      </>
    );
  }

  const panel = <FilterPanel bare facets={facets} onToggle={onToggle} onClear={onClear} />;

  return (
    <div className="aile-odemeler">
      <PageHeader
        location={location}
        section="Para"
        title="Ödemeler"
        purpose="Planlanan, yapılan ve geciken ödemeleri tarihleriyle izleyin."
        status={status}
        summary={summary}
      />
      <p role="note" className="aile-odemeler-not aile-ikincil">{NOT}</p>
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
        onOpenFilters={() => setDrawerOpen(true)}
        resultCount={filtered.length}
      />
      {device === 'desktop' ? (
        <FilterArea key={mode} defaultOpen={mode === 'timeline'} count={activeFilters.length} panel={panel}>
          {content}
        </FilterArea>
      ) : (
        <>
          {content}
          <FilterDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            resultCount={filtered.length}
            facets={facets}
            onToggle={onToggle}
            onClear={onClear}
          />
        </>
      )}
    </div>
  );
}
