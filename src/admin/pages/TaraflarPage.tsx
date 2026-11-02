import { useId, useMemo } from 'react';
import { useCollection, useGeneration } from '../data';
import type { GenerationState, PurchaseNeedRecord } from '../data/types';
import { useDevice } from '../device';
import { PageHeader } from '../shell/PageHeader';
import type { DataStatusProps, DataStatusState, PageHeaderSummary, ResponsiveColumn } from '../shell/contracts';
import { adminPages } from '../shell/navigation';
import { Button, EmptyState, ErrorState, LoadingShell, Money, ResponsiveTable, Tag } from '../ui';
import './TaraflarPage.css';

// Tasarım: bundle.js Aile.Pages.Taraflar (masaüstü / tablet / telefon), README "Sayfa iskeleti (sıra sabit)",
// "Veri durumları", "İçerik ilkeleri". Sıra: PageHeader (bölüm İşler → h1 → amaç → eylem → DataStatus → özet ≤ 3)
// → Teklif karşılaştırması (3 yuva; telefonda alt alta) → Taraflar → Adaylar.
// Veri dürüstlüğü: nesilde providers (taraf/usta) koleksiyonu YOK; sayfa bunu "Kaynakta taraf/usta kaydı yok" diye
// adıyla söyler, sıfır ya da uydurma kayıt yazmaz. Adaylar yalnız work_orders.attributes.is_kim ("İşi yapan") ve
// usta alanlarındaki kaynak metinden toplanır; taraf kaydı, iletişim ya da ödeme ilişkisi uydurulmaz. Plan (teklif)
// ve gerçek (ödeme) özette ayrı ölçülerdir. Sheets'e yazma bu dilimde yok: "Teklif kaydet" devre dışı ve nedeni yazılı.
// Kart/kenarlık yağmuru yok: bölümler zeminde boşlukla ayrılır; teklif yuvaları yalnız yuzey tonu alır (kenarlık yok).

const SAYFA = adminPages.find((page) => page.key === 'taraflar')!;

/** Aday kaynağı: hangi iş emri alanından geldiği (yalnız kaynak metin; ilişki değil). */
export type AdayAlani = 'is_kim' | 'usta';

export interface Aday {
  /** Kaynak metin, kırpılmış; anahtar olarak da kullanılır. */
  ad: string;
  /** Adın geçtiği alanlar. */
  alanlar: readonly AdayAlani[];
  /** Adın geçtiği iş emirleri (etiket). */
  isler: readonly string[];
}

const ADAY_ALANLARI: readonly AdayAlani[] = ['is_kim', 'usta'];

function metinler(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(metinler);
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? [text] : [];
  }
  return [];
}

/** work_orders.attributes.is_kim / usta (yoksa source_attributes) metinlerini ad bazında toplar; silinmiş kayıt sayılmaz. */
export function adaylariTuret(records: readonly PurchaseNeedRecord[]): Aday[] {
  const map = new Map<string, { alanlar: Set<AdayAlani>; isler: Set<string> }>();
  for (const record of records) {
    if (record.deleted_at) continue;
    const label = record.label ?? record.source_record_id ?? record.id;
    for (const alan of ADAY_ALANLARI) {
      const raw = record.attributes?.[alan] ?? record.source_attributes?.[alan];
      for (const ad of metinler(raw)) {
        const entry = map.get(ad) ?? { alanlar: new Set<AdayAlani>(), isler: new Set<string>() };
        entry.alanlar.add(alan);
        entry.isler.add(label);
        map.set(ad, entry);
      }
    }
  }
  return [...map.entries()]
    .map(([ad, entry]) => ({ ad, alanlar: [...entry.alanlar], isler: [...entry.isler] }))
    .sort((a, b) => b.isler.length - a.isler.length || a.ad.localeCompare(b.ad, 'tr-TR'));
}

const DURUM: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };

interface AdayRow { key: string; ad: string; alan: string; sayi: number; isler: string }

const ADAY_SUTUNLARI: readonly ResponsiveColumn<AdayRow>[] = [
  { key: 'ad', title: 'Aday', minWidth: 200, m: 'title' },
  { key: 'alan', title: 'Kaynak alan', minWidth: 120, m: 'meta' },
  { key: 'sayi', title: 'İş sayısı', align: 'right', minWidth: 96, m: 'lead', render: (row) => <span className="aile-tutar">{row.sayi}</span> },
  { key: 'isler', title: 'İşler', minWidth: 240, m: 'body' },
];

const BILINMIYOR = 'Bilinmiyor';
const OKUNUYOR = 'Okunuyor';
const HENUZ_YOK = 'Henüz yok';
/** Tasarım: karşılaştırma üç teklif yuvasıdır (bundle.js teklif[]); kayıt yokken yuvalar boş durumla çizilir. */
const TEKLIF_YUVASI = 3;
const TEKLIF_ALANLARI = ['Teslim', 'Garanti', 'Kurulum'] as const;

export function TaraflarPage() {
  const device = useDevice();
  const generation = useGeneration();
  const workOrders = useCollection('work_orders');
  const notId = useId();
  const karsilastirmaId = useId();
  const taraflarId = useId();
  const adaylarId = useId();

  const adaylar = useMemo(() => adaylariTuret(workOrders.rows), [workOrders.rows]);
  const adayRows = useMemo<AdayRow[]>(
    () => adaylar.map((aday) => ({ key: aday.ad, ad: aday.ad, alan: aday.alanlar.join(' · '), sayi: aday.isler.length, isler: aday.isler.join(', ') })),
    [adaylar],
  );

  const sayim = (secici: (record: PurchaseNeedRecord) => boolean): string => {
    if (workOrders.error) return BILINMIYOR;
    if (workOrders.loading) return OKUNUYOR;
    return String(workOrders.rows.filter((record) => !record.deleted_at && secici(record)).length);
  };

  const status: DataStatusProps = {
    state: DURUM[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: () => void generation.refresh(),
  };

  // Plan ve gerçek ayrı ölçüler; tek sayıda birleşmez. Taraf kaydı: koleksiyon yok → "Henüz yok" (sıfır değil).
  const summary: readonly PageHeaderSummary[] = [
    { label: 'Taraf kaydı', value: HENUZ_YOK, note: 'kaynakta koleksiyon yok' },
    { label: 'Teklifli iş (plan)', value: sayim((record) => Boolean(record.amounts.quote)), note: 'iş emirlerinde teklif tutarı' },
    { label: 'Ödenmiş iş (gerçek)', value: sayim((record) => Boolean(record.amounts.actual)), note: 'iş emirlerinde gerçek tutar' },
  ];

  const generationFailed = generation.state === 'error' && generation.manifest === null;
  const narrow = device === 'phone';

  return (
    <div className="aile-taraflar">
      <PageHeader
        location={SAYFA.path}
        section={SAYFA.section}
        title={SAYFA.label}
        purpose={SAYFA.purpose}
        primary={
          <Button variant="primary" icon="plus" disabled aria-describedby={notId}>
            Teklif kaydet
          </Button>
        }
        status={status}
        summary={summary}
      >
        <p id={notId} className="aile-taraflar__not aile-kucuk aile-ikincil">
          Teklif ve taraf kaydı bu sürümde yalnız e-tablodan gelir; panelden ekleme henüz yok.
        </p>
      </PageHeader>

      {generationFailed ? (
        <ErrorState title="Nesil okunamadı" message={generation.message ?? 'Hata: nesil okunamadı'} onRetry={() => void generation.refresh()} />
      ) : (
        <>
          <section className="aile-taraflar__bolum" aria-labelledby={karsilastirmaId}>
            <div className="aile-taraflar__bolum-baslik">
              <h2 id={karsilastirmaId} className="aile-taraflar__h2">Teklif karşılaştırması</h2>
              <p className="aile-taraflar__sayim aile-kucuk aile-ikincil">Karşılaştırılacak teklif yok</p>
            </div>
            <p className="aile-kucuk aile-ikincil aile-taraflar__aciklama">
              Kaynakta teklif kaydı yok; yuvalar teklif geldiğinde dolacak alanları gösterir.
            </p>
            <div className="aile-taraflar__karsilastirma" data-testid="teklif-karsilastirma" data-layout={narrow ? 'alt-alta' : 'yan-yana'}>
              {Array.from({ length: TEKLIF_YUVASI }, (_, index) => {
                const baslikId = `${karsilastirmaId}-yuva-${index + 1}`;
                return (
                  <div key={index} role="group" aria-labelledby={baslikId} className="aile-taraflar__yuva">
                    <div className="aile-taraflar__yuva-baslik">
                      <strong id={baslikId}>Teklif {index + 1}</strong>
                      <Tag tone="notr">Teklif yok</Tag>
                    </div>
                    <dl className="aile-taraflar__alanlar">
                      <div>
                        <dt className="aile-kucuk aile-ikincil">Tutar</dt>
                        <dd><Money value={null} /></dd>
                      </div>
                      {TEKLIF_ALANLARI.map((alan) => (
                        <div key={alan}>
                          <dt className="aile-kucuk aile-ikincil">{alan}</dt>
                          <dd className="aile-ikincil">{BILINMIYOR}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="aile-taraflar__bolum" aria-labelledby={taraflarId}>
            <div className="aile-taraflar__bolum-baslik">
              <h2 id={taraflarId} className="aile-taraflar__h2">Taraflar</h2>
            </div>
            <EmptyState
              title="Kaynakta taraf/usta kaydı yok"
              message="Bu nesil taraf (providers) koleksiyonu içermiyor; e-tablodaki usta satırları henüz dönüştürülmedi."
            />
          </section>

          <section className="aile-taraflar__bolum" aria-labelledby={adaylarId}>
            <div className="aile-taraflar__bolum-baslik">
              <h2 id={adaylarId} className="aile-taraflar__h2">Adaylar</h2>
              {!workOrders.loading && !workOrders.error ? (
                <p className="aile-taraflar__sayim aile-kucuk aile-ikincil">{adaylar.length > 0 ? `${adaylar.length} aday` : 'Aday yok'}</p>
              ) : null}
            </div>
            <p className="aile-kucuk aile-ikincil aile-taraflar__aciklama">
              İş emirlerindeki İşi yapan (is_kim) ve usta alanlarından toplandı; yalnız kaynak metin, taraf kaydına bağ değil.
            </p>
            {workOrders.loading ? (
              <LoadingShell rows={3} narrow={narrow} />
            ) : workOrders.error ? (
              <ErrorState title="İş emirleri okunamadı" message={workOrders.error} onRetry={() => void generation.refresh()} />
            ) : adayRows.length === 0 ? (
              <EmptyState title="Kaynakta aday yok" message="İş emirlerinde İşi yapan (is_kim) ya da usta alanı dolu değil." />
            ) : (
              <ResponsiveTable columns={ADAY_SUTUNLARI} rows={adayRows} caption="Adaylar" mobileCaption={`${adayRows.length} aday`} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
