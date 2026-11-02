import { useId, useMemo, useState, type ReactNode } from 'react';
import { useCollection, useGeneration, useRows } from '../data';
import type { GenerationState, PurchaseNeedRecord, Relation, Room, Term, UUID } from '../data/types';
import { useDevice } from '../device';
import { adminLeads } from '../shell/navigation';
import { PageHeader } from '../shell/PageHeader';
import type { DataStatusProps, DataStatusState, Money as MoneyValue, PageHeaderSummary, RecordRow, ResponsiveColumn } from '../shell/contracts';
import { Button, EmptyState, ErrorState, LoadingShell, Money, ResponsiveTable, StatusText, Tabs } from '../ui';
import { BILINMIYOR, FIYAT_YOK, HENUZ_YOK, formatMoney } from '../ui/Money';
import './EvPage.css';

// Ev ve odalar. Tasarım: README.md "Sayfa iskeleti" + bundle.js Aile.Pages.Odalar (masaüstü: fotoğraf · oda · Planlanan ·
// Gerçekleşen satırları; dar: aynı satır alt alta tutarlarla) + components/SayfaOdalar*/preview.html. Burada oda listesi
// ResponsiveTable'dır (masaüstü tablo, telefon akordeon); satır seçilince odanın Eşyalar (layout_items) ve Aydınlatma
// (lighting_specs) sekmeleri açılır: masaüstünde sağda ayrinti-genislik 384 px, tablet ve telefonda listenin yerinde
// "Listeye dön" ile. Veri yalnız doğrulanmış nesilden: rooms + purchase_needs + layout_items + lighting_specs +
// work_orders + relations + terms. Plan ve gerçek ayrı toplanır ve ayrı yazılır; eksik bilgi adıyla ("Fiyat yok",
// "Henüz yok", "Bilinmiyor"). Bağlı alım sayısı relations (located_in → oda) ile sayılır. Odasız alımlar "Oda bilinmiyor"
// satırında toplanır. Zamanlı yerleşim (layout_items.dates.planned_on) yoksa "Henüz yok". "Oda ekle" yok: bu dilimde
// odaya yazma (değişiklik kümesi op'u) tanımlı değil, çalışmayan düğme çizilmez.

const LOCATION = '/ev';
const ODASIZ_ID = 'odasiz';
const ODA_BILINMIYOR = 'Oda bilinmiyor';
const EKSIK_YOK = 'Eksik yok';
const BIRDEN_COK = 'Birden çok';
const KAPALI_IS = new Set(['installed', 'delivered', 'completed']);

type Sekme = 'esya' | 'aydinlatma';
const SEKMELER: readonly { key: Sekme; label: string }[] = [
  { key: 'esya', label: 'Eşyalar' },
  { key: 'aydinlatma', label: 'Aydınlatma' },
];

const DURUM: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };

// --- Para toplamı (metin ondalık, yuvarlama yok) ------------------------------------------------------------
interface Toplam { value: MoneyValue | null; mixed: boolean; count: number }
const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;

/** Aynı para biriminde tutarları ölçekli tam sayıyla toplar; birim karışıksa mixed (sayfa "Bilinmiyor" yazar). */
export function toplaTutar(values: readonly (MoneyValue | null | undefined)[]): Toplam {
  const gecerli = values.filter((value): value is MoneyValue => Boolean(value) && DECIMAL.test(value!.amount.trim()));
  if (gecerli.length === 0) return { value: null, mixed: false, count: 0 };
  const currency = gecerli[0]!.currency.trim().toUpperCase();
  if (gecerli.some((value) => value.currency.trim().toUpperCase() !== currency)) return { value: null, mixed: true, count: gecerli.length };
  const olcek = Math.max(2, ...gecerli.map((value) => value.amount.split('.')[1]?.length ?? 0));
  let toplam = 0n;
  for (const value of gecerli) {
    const [tam, kesir = ''] = value.amount.trim().split('.');
    const negatif = tam!.startsWith('-');
    const buyukluk = BigInt(tam!.replace('-', '')) * 10n ** BigInt(olcek) + BigInt(kesir.padEnd(olcek, '0'));
    toplam += negatif ? -buyukluk : buyukluk;
  }
  const isaret = toplam < 0n ? '-' : '';
  const mutlak = toplam < 0n ? -toplam : toplam;
  const bolen = 10n ** BigInt(olcek);
  return { value: { amount: `${isaret}${mutlak / bolen}.${String(mutlak % bolen).padStart(olcek, '0')}`, currency }, mixed: false, count: gecerli.length };
}

function Tutar({ toplam, label }: { toplam: Toplam; label: string }) {
  return toplam.mixed ? <Money value={null} label={BILINMIYOR} /> : <Money value={toplam.value} label={label} />;
}

/** ISO YYYY-MM-DD → 28.10.2026; yoksa "Henüz yok". */
function tarih(iso: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return match ? `${match[3]}.${match[2]}.${match[1]}` : HENUZ_YOK;
}

const sayi = (n: number, birim: string) => `${n} ${birim}`;

// --- Oda satırı view-model -----------------------------------------------------------------------------------
interface OdaSatiri {
  id: string;
  label: string;
  code: string;
  asama: string;
  /** relations located_in → bu oda (odasız satırda oda bağı olmayan alım sayısı). */
  alim: number;
  acikGorev: number;
  planned: Toplam;
  actual: Toplam;
  eksik: string;
}

function odaKimligi(record: PurchaseNeedRecord, relationsBySource: ReadonlyMap<UUID, readonly Relation[]>, roomsById: ReadonlyMap<UUID, Room>): string | null {
  if (record.room_id && roomsById.has(record.room_id)) return record.room_id;
  for (const rel of relationsBySource.get(record.id) ?? []) if (rel.kind === 'located_in' && roomsById.has(rel.target_id)) return rel.target_id;
  return null;
}

function grupla<R extends PurchaseNeedRecord>(records: readonly R[], relationsBySource: ReadonlyMap<UUID, readonly Relation[]>, roomsById: ReadonlyMap<UUID, Room>) {
  const map = new Map<string, R[]>();
  for (const record of records) {
    if (record.deleted_at) continue;
    const key = odaKimligi(record, relationsBySource, roomsById) ?? ODASIZ_ID;
    const list = map.get(key);
    if (list) list.push(record);
    else map.set(key, [record]);
  }
  return map;
}

function asamaMetni(records: readonly PurchaseNeedRecord[], termsById: ReadonlyMap<UUID, Term>): string {
  const etiketler = new Set<string>();
  for (const record of records) {
    const term = record.phase_term_id ? termsById.get(record.phase_term_id) : undefined;
    if (term) etiketler.add(term.label);
  }
  if (etiketler.size === 0) return BILINMIYOR;
  if (etiketler.size === 1) return [...etiketler][0]!;
  return BIRDEN_COK;
}

function eksikMetni(rows: readonly RecordRow[]): string {
  const fiyat = rows.filter((row) => row.planned === null).length;
  const fotograf = rows.filter((row) => !row.photo).length;
  const parcalar = [fiyat > 0 ? sayi(fiyat, 'fiyat') : null, fotograf > 0 ? sayi(fotograf, 'fotoğraf') : null].filter(Boolean);
  return parcalar.length ? parcalar.join(' · ') : EKSIK_YOK;
}

const acikIs = (record: PurchaseNeedRecord) =>
  record.state_snapshot?.decision !== 'cancelled' && !KAPALI_IS.has(record.state_snapshot?.fulfillment ?? '');

// --- Sütunlar ------------------------------------------------------------------------------------------------
const planlananSutun = <R extends { planned: MoneyValue | null }>(): ResponsiveColumn<R> => ({
  key: 'planned', title: 'Planlanan', align: 'right', minWidth: 140, m: 'lead', render: (row) => <Money value={row.planned} label={FIYAT_YOK} />,
});
const gercekSutun = <R extends { actual: MoneyValue | null }>(): ResponsiveColumn<R> => ({
  key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 140, render: (row) => <Money value={row.actual} label={HENUZ_YOK} />,
});
const kayitTemel: readonly ResponsiveColumn<RecordRow>[] = [
  { key: 'label', title: 'Ad', minWidth: 200, m: 'title' },
  { key: 'code', title: 'Kod', minWidth: 120, m: 'meta' },
  { key: 'status', title: 'Durum', minWidth: 150, m: 'status', render: (row) => <StatusText label={row.status.label} tone={row.status.tone} /> },
];
const esyaSutunlari: readonly ResponsiveColumn<RecordRow>[] = [
  ...kayitTemel,
  planlananSutun<RecordRow>(),
  gercekSutun<RecordRow>(),
  { key: 'yerlesim', title: 'Yerleşim tarihi', minWidth: 140, render: (row) => tarih(row.dates?.planned) },
];

interface AydinlatmaSatiri extends RecordRow { lumen: string; renk: string }
const aydinlatmaSutunlari: readonly ResponsiveColumn<AydinlatmaSatiri>[] = [
  ...(kayitTemel as readonly ResponsiveColumn<AydinlatmaSatiri>[]),
  { key: 'lumen', title: 'Lümen', align: 'right', minWidth: 110 },
  { key: 'renk', title: 'Renk sıcaklığı', align: 'right', minWidth: 130 },
  planlananSutun<AydinlatmaSatiri>(),
  gercekSutun<AydinlatmaSatiri>(),
];

const odaSutunlari: readonly ResponsiveColumn<OdaSatiri>[] = [
  { key: 'label', title: 'Oda', minWidth: 200, m: 'title' },
  { key: 'code', title: 'Kod', minWidth: 110, m: 'meta' },
  { key: 'asama', title: 'Aşama', minWidth: 150, m: 'status', render: (row) => <StatusText label={row.asama} /> },
  { key: 'alim', title: 'Alım', minWidth: 110, render: (row) => sayi(row.alim, 'alım') },
  { key: 'acikGorev', title: 'Açık görev', minWidth: 120, render: (row) => sayi(row.acikGorev, 'açık görev') },
  { key: 'planned', title: 'Planlanan', align: 'right', minWidth: 140, m: 'lead', render: (row) => <Tutar toplam={row.planned} label={FIYAT_YOK} /> },
  { key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 140, render: (row) => <Tutar toplam={row.actual} label={HENUZ_YOK} /> },
  { key: 'eksik', title: 'Eksik bilgi', minWidth: 170 },
];

function olcu(label: string, value: string, note?: string): PageHeaderSummary {
  return note ? { label, value, note } : { label, value };
}

function veriDurumu(generation: ReturnType<typeof useGeneration>): DataStatusProps {
  const status: DataStatusProps = { state: DURUM[generation.state], onRefresh: () => void generation.refresh() };
  if (generation.lastReadAt) status.lastReadAt = generation.lastReadAt;
  if (generation.generationId) status.generationId = generation.generationId;
  if (generation.lastGoodAt) status.lastGoodAt = generation.lastGoodAt;
  if (generation.message) status.message = generation.message;
  return status;
}

// --- Sayfa -----------------------------------------------------------------------------------------------------
export function EvPage() {
  const device = useDevice();
  const dar = device !== 'desktop';
  const generation = useGeneration();

  const rooms = useCollection('rooms');
  const relations = useCollection('relations');
  const terms = useCollection('terms');
  const needs = useCollection('purchase_needs');
  const layout = useCollection('layout_items');
  const lighting = useCollection('lighting_specs');
  const workOrders = useCollection('work_orders');
  const needRows = useRows('purchase_need');
  const layoutRows = useRows('layout_item');
  const lightingRows = useRows('lighting_spec');

  const parcalar = [rooms, relations, terms, needs, layout, lighting, workOrders];
  const loading = parcalar.some((part) => part.loading);
  const error = parcalar.find((part) => part.error !== null)?.error ?? null;

  const [seciliId, setSeciliId] = useState<string | null>(null);
  const [sekme, setSekme] = useState<Sekme>('esya');
  const baslikId = useId();

  const indeks = useMemo(() => {
    const roomsById = new Map<UUID, Room>();
    for (const room of rooms.rows) if (!room.deleted_at) roomsById.set(room.id, room);
    const relationsBySource = new Map<UUID, Relation[]>();
    const bagliAlim = new Map<UUID, number>();
    for (const rel of relations.rows) {
      const list = relationsBySource.get(rel.source_id);
      if (list) list.push(rel);
      else relationsBySource.set(rel.source_id, [rel]);
      if (rel.kind === 'located_in' && roomsById.has(rel.target_id)) bagliAlim.set(rel.target_id, (bagliAlim.get(rel.target_id) ?? 0) + 1);
    }
    const termsById = new Map<UUID, Term>(terms.rows.map((term) => [term.id, term]));
    return { roomsById, relationsBySource, bagliAlim, termsById };
  }, [rooms.rows, relations.rows, terms.rows]);

  const needRowsById = useMemo(() => new Map(needRows.map((row) => [row.id, row])), [needRows]);
  const layoutRowsById = useMemo(() => new Map(layoutRows.map((row) => [row.id, row])), [layoutRows]);
  const lightingRowsById = useMemo(() => new Map(lightingRows.map((row) => [row.id, row])), [lightingRows]);

  const gruplar = useMemo(
    () => ({
      needs: grupla(needs.rows, indeks.relationsBySource, indeks.roomsById),
      layout: grupla(layout.rows, indeks.relationsBySource, indeks.roomsById),
      lighting: grupla(lighting.rows, indeks.relationsBySource, indeks.roomsById),
      workOrders: grupla(workOrders.rows, indeks.relationsBySource, indeks.roomsById),
    }),
    [needs.rows, layout.rows, lighting.rows, workOrders.rows, indeks],
  );

  const odalar = useMemo<OdaSatiri[]>(() => {
    const satir = (id: string, label: string, code: string, alim: number): OdaSatiri => {
      const kayitlar = gruplar.needs.get(id) ?? [];
      const rows = kayitlar.map((record) => needRowsById.get(record.id)).filter((row): row is RecordRow => Boolean(row));
      return {
        id, label, code, alim,
        asama: asamaMetni(kayitlar, indeks.termsById),
        acikGorev: (gruplar.workOrders.get(id) ?? []).filter(acikIs).length,
        planned: toplaTutar(rows.map((row) => row.planned)),
        actual: toplaTutar(rows.map((row) => row.actual)),
        eksik: eksikMetni(rows),
      };
    };
    const liste = [...indeks.roomsById.values()]
      .sort((a, b) => (a.label ?? a.code).localeCompare(b.label ?? b.code, 'tr-TR'))
      .map((room) => satir(room.id, room.label ?? room.code, room.code, indeks.bagliAlim.get(room.id) ?? 0));
    const odasiz = gruplar.needs.get(ODASIZ_ID) ?? [];
    if (odasiz.length > 0) liste.push(satir(ODASIZ_ID, ODA_BILINMIYOR, BILINMIYOR, odasiz.length));
    return liste;
  }, [gruplar, indeks, needRowsById]);

  const ozet = useMemo<PageHeaderSummary[]>(() => {
    const rows = needRows;
    const planned = toplaTutar(rows.map((row) => row.planned));
    const actual = toplaTutar(rows.map((row) => row.actual));
    const odasiz = (gruplar.needs.get(ODASIZ_ID) ?? []).length;
    return [
      olcu('Oda', String(indeks.roomsById.size), odasiz > 0 ? `+${odasiz} alım odasız` : undefined),
      olcu('Planlanan', planned.mixed ? BILINMIYOR : formatMoney(planned.value, FIYAT_YOK), sayi(rows.length, 'alım')),
      olcu('Gerçekleşen', actual.mixed ? BILINMIYOR : formatMoney(actual.value, HENUZ_YOK), sayi(actual.count, 'alımda')),
    ];
  }, [needRows, gruplar, indeks]);

  const secili = odalar.find((oda) => oda.id === seciliId) ?? null;
  const hazir = !loading && error === null;

  const sec = (oda: OdaSatiri) => {
    setSeciliId(oda.id);
    setSekme('esya');
  };

  // Sıra: hata (eski tutar gösterilmez) → yükleniyor (bütün koleksiyonlar gelmeden kısmi sayım çizilmez) → oda yok → liste.
  // Eski veri (stale): yükleyici son sağlam kayıtları korur, hata yoktur; tazelik satırı DataStatus ile uyarır.
  const odasizSayisi = (gruplar.needs.get(ODASIZ_ID) ?? []).length;
  let icerik: ReactNode;
  if (error !== null) {
    icerik = <ErrorState message="Nesil okunamadı. Tutarlar, yanıltmaması için gösterilmiyor." detail={error} onRetry={() => void generation.refresh()} />;
  } else if (loading) {
    icerik = <LoadingShell rows={6} narrow={device === 'phone'} />;
  } else if (indeks.roomsById.size === 0) {
    icerik = (
      <EmptyState
        title="Kaynakta oda kaydı yok"
        message={`Bu nesilde rooms koleksiyonu boş; odalar e-tablonun ayarlar sayfasındaki oda satırlarından gelir.${odasizSayisi > 0 ? ` Odaya bağlanmamış ${sayi(odasizSayisi, 'alım')} var.` : ''}`}
      />
    );
  } else {
    const liste = (
      <div className="aile-ev-liste">
        <p className="aile-ev-sayim">
          <strong>{sayi(odalar.length, 'satır')}</strong>
          <span className="aile-ikincil">{` · ${sayi(indeks.roomsById.size, 'oda')}${gruplar.needs.has(ODASIZ_ID) ? ' ve odasız alımlar' : ''}`}</span>
        </p>
        <ResponsiveTable<OdaSatiri>
          caption="Odalar"
          columns={odaSutunlari}
          rows={odalar}
          selectedKey={secili?.id}
          onRowClick={sec}
          openLabel="Ayrıntıyı aç"
        />
      </div>
    );
    const ayrinti = secili ? (
      <section className="aile-ev-ayrinti" aria-labelledby={baslikId}>
        {dar ? (
          <Button variant="quiet" icon="back" onClick={() => setSeciliId(null)}>
            Listeye dön
          </Button>
        ) : null}
        <h2 id={baslikId} className="aile-ev-ayrinti__baslik">{secili.label}</h2>
        <p className="aile-kucuk aile-ikincil aile-ev-ayrinti__meta">
          {`${secili.code} · ${sayi(secili.alim, 'alım')} · ${sayi(secili.acikGorev, 'açık görev')} · Aşama: ${secili.asama}`}
        </p>
        <dl className="aile-ev-ayrinti__tutarlar">
          <div><dt className="aile-kucuk aile-ikincil">Planlanan</dt><dd><Tutar toplam={secili.planned} label={FIYAT_YOK} /></dd></div>
          <div><dt className="aile-kucuk aile-ikincil">Gerçekleşen</dt><dd><Tutar toplam={secili.actual} label={HENUZ_YOK} /></dd></div>
        </dl>
        <Tabs label="Oda bölümleri" items={SEKMELER} activeKey={sekme} onChange={(key) => setSekme(key as Sekme)} />
        {sekme === 'esya' ? <EsyaSekmesi kayitlar={gruplar.layout.get(secili.id) ?? []} rowsById={layoutRowsById} /> : null}
        {sekme === 'aydinlatma' ? <AydinlatmaSekmesi kayitlar={gruplar.lighting.get(secili.id) ?? []} rowsById={lightingRowsById} /> : null}
      </section>
    ) : null;
    icerik = (
      <div className={`aile-ev${dar ? ' aile-ev--dar' : ' aile-ev--genis'}${ayrinti ? ' aile-ev--secili' : ''}`}>
        {dar && ayrinti ? null : liste}
        {ayrinti}
      </div>
    );
  }

  return (
    <>
      <PageHeader location={LOCATION} purpose={adminLeads[LOCATION]} status={veriDurumu(generation)} summary={hazir ? ozet : undefined} />
      {icerik}
    </>
  );
}

function EsyaSekmesi({ kayitlar, rowsById }: { kayitlar: readonly PurchaseNeedRecord[]; rowsById: ReadonlyMap<string, RecordRow> }) {
  const rows = kayitlar.map((record) => rowsById.get(record.id)).filter((row): row is RecordRow => Boolean(row));
  if (rows.length === 0) return <EmptyState title="Kaynakta bu oda için eşya kaydı yok" message="layout_items koleksiyonunda bu odaya bağlı kayıt bulunmadı." />;
  return <ResponsiveTable<RecordRow> caption="Eşyalar" columns={esyaSutunlari} rows={rows} openLabel="Ayrıntıyı aç" />;
}

const metinOzellik = (record: PurchaseNeedRecord, key: string): string | undefined => {
  for (const bag of [record.attributes, record.source_attributes]) {
    const value = bag?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
};

function AydinlatmaSekmesi({ kayitlar, rowsById }: { kayitlar: readonly PurchaseNeedRecord[]; rowsById: ReadonlyMap<string, RecordRow> }) {
  const rows: AydinlatmaSatiri[] = [];
  for (const record of kayitlar) {
    const row = rowsById.get(record.id);
    if (!row) continue;
    const lumen = metinOzellik(record, 'lumen');
    const renk = metinOzellik(record, 'renk_sicakligi_k');
    rows.push({ ...row, lumen: lumen ? `${lumen} lm` : BILINMIYOR, renk: renk ? `${renk} K` : BILINMIYOR });
  }
  if (rows.length === 0) return <EmptyState title="Kaynakta bu oda için aydınlatma kaydı yok" message="lighting_specs koleksiyonunda bu odaya bağlı kayıt bulunmadı." />;
  return <ResponsiveTable<AydinlatmaSatiri> caption="Aydınlatma" columns={aydinlatmaSutunlari} rows={rows} openLabel="Ayrıntıyı aç" />;
}
