import { useCallback, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Adaptive, lazyWide, useProfile } from '../adaptive';
import {
  currentPeriod,
  useChangeSet,
  useCollection,
  useGeneration,
  type ChangeOp,
  type GenerationState,
  type Term,
  type Vocabulary,
} from '../data';
import { PageHeader } from '../shell/PageHeader';
import { currentAdminLink } from '../shell/navigation';
import type { DataStatusProps, DataStatusState, PageHeaderSummary } from '../shell/contracts';
import { Button } from '../ui/Button';
import { ErrorState } from '../ui/ErrorState';
import { LoadingShell } from '../ui/LoadingShell';
import { GenelTelefon } from './genel/GenelTelefon';
import {
  AYLIK_BASLIK,
  BAGLANTI,
  KAYNAKTA_YOK,
  PENCERE_GUN,
  aylikSatirlar,
  bekleyenIsler,
  butceSatirlari,
  dikkatIsteyenler,
  donemAdi,
  gecikenKayitlar,
  gecikenOlcusu,
  istanbulGunu,
  kalanNakit,
  metin,
  nitelik,
  odenecekOlcusu,
  planAynasiNotu,
  yaklasanOdemeler,
  type GenelGorev,
  type GenelGorunum,
  type GenelSunumProps,
} from './genel/model';
import './GenelPage.css';

// Genel durum sayfası. Tasarım: README.md "Sayfa iskeleti" 1–2 (başlık → en çok üç ölçü, kutusuz), components/Overview/
// README.md (dört blok; her blok başlığında ilgili sayfaya bağlantı) ve bundle.js Aile.Pages.Genel. W0 uyarlamalı teslim:
//  - Telefon profili (temel sunum, genel/GenelTelefon): yerel HTML; özet ölçüler (başlıkta), yaklaşan ödemeler ve dikkat
//    isteyenler önce, bütçe tablosu akordeon, bekleyen işler yerel onay kutusu, aylık grafik yerine tablo karşılığı.
//    antd, ECharts ve *.wide modülü telefonda indirilmez.
//  - Tablet/masaüstü: GenelPage.wide (lazyWide 'genel-genis'): Overview + aylık grafik ve yanında aynı değerler tablosu.
//    Yüklenirken ya da yüklenemezse telefon sunumu kullanılabilir kalır (Adaptive).
// Veri anlamı genel/model.ts → data/actuals.ts: dönem ve "bugün" Europe/Istanbul; gelecek ayın Gerçekleşeni "Henüz yok";
// kanıtsız değer "Kaynakta yazılı" (yüzde ve "harcandı" yok); unclassified/silinmiş gözlem toplamlara girmez; toplamlar
// kesin ondalık; plan aynası notu. Plan ve gerçek hiçbir yerde tek sayıda birleşmez; eksik bilgi adıyla yazılır.
// Veri durumları ayrı ve adıyla (data-durum): yükleniyor (LoadingShell), hata (ErrorState, tutar yok), eski (son iyi veri
// + DataStatus "yenilenemedi"), hazır. Nesilde olmayan koleksiyon "Kaynakta … kaydı yok" der.
// Bekleyen işler: işaretlemek yerel değişiklik kümesine fulfillment → installed yazar (geri alınabilir); Sheets'e yazma yok.
// Yükleme: tahmin olayları (forecast_events, olay ayına göre parçalı) yalnız 7 günlük pencerenin aylarından okunur; kapsamlı
// satırlar boş olabilir, kaynağın boş olup olmadığını nesil manifestinin sayımı söyler.

export interface GenelPageProps {
  /** Hash yolu; başlık bölüm/ad/amaç buradan türetilir. */
  location?: string;
  /** "Bugün"; test deterministikliği için enjekte edilir. Dönem ve gün Europe/Istanbul takviminden okunur. */
  now?: () => Date;
}

const YOL = '/genel';
const BIRINCIL_EYLEM = 'Aylık rapor';
const RAPOR_YOLU = '/raporlar';
const OKUNUYOR = 'Genel durum okunuyor';
const KURULDU = 'installed';
const simdi = () => new Date();
const GUN_MS = 24 * 60 * 60 * 1000;

/** Ödeme penceresinin [an, an + PENCERE_GUN gün] İstanbul takvim ayları (pencere bir aydan kısa: bir ya da iki ay). */
const pencereDonemleri = (an: Date) => [...new Set([currentPeriod(an), currentPeriod(new Date(an.getTime() + PENCERE_GUN * GUN_MS))])];

const GenelGenis = lazyWide<GenelSunumProps>('genel-genis', () => import('./GenelPage.wide'));

const DURUM: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };

/** Değişiklik kümesindeki bekleyen "kuruldu" işlemi (varsa). */
const kurulduOpu = (ops: readonly ChangeOp[]) =>
  ops.find(op => op.kind === 'state_change' && op.after.axis === 'fulfillment' && op.after.code === KURULDU);

export function GenelPage({ location = YOL, now }: GenelPageProps) {
  const profile = useProfile();
  const [, navigate] = useLocation();
  const generation = useGeneration();
  const changeSet = useChangeSet();
  // "Bugün" bağlama başına bir kez okunur; dönem ve gün İstanbul takviminden (cihazın yerel saat dilimi değil).
  const an = useMemo(() => (now ?? simdi)(), [now]);
  const bugun = useMemo(() => istanbulGunu(an), [an]);
  const donem = useMemo(() => currentPeriod(an), [an]);
  // Ödeme penceresi [bugün, bugün + 7 gün) en çok iki takvim ayına düşer; yalnız o ayların parçaları istenir.
  const olayDonemleri = useMemo(() => pencereDonemleri(an), [an]);

  const aylar = useCollection('forecast_months');
  const olaylar = useCollection('forecast_events', { periods: olayDonemleri });
  const gozlemler = useCollection('budget_observations');
  const alimlar = useCollection('purchase_needs');
  const isler = useCollection('work_orders');
  const medya = useCollection('media_references');
  const sorunlar = useCollection('issues');
  const terimler = useCollection('terms');
  const sozlukler = useCollection('vocabularies');
  const parcalar = [aylar, olaylar, gozlemler, alimlar, isler, medya, sorunlar, terimler, sozlukler];
  // Pencere dışındaki aylar okunmadığından "kaynakta tahmin olayı yok" kararı kapsamlı satırlardan değil, sayımdan.
  const olayKaydiYok = (generation.manifest?.counts.forecast_events ?? 0) === 0;

  const gecikenler = useMemo(() => gecikenKayitlar([...alimlar.rows, ...isler.rows], bugun), [alimlar.rows, isler.rows, bugun]);
  const odemeler = useMemo(() => yaklasanOdemeler(olaylar.rows, bugun), [olaylar.rows, bugun]);
  const butce = useMemo(() => butceSatirlari(gozlemler.rows, donem, an), [gozlemler.rows, donem, an]);
  const aynaNotu = useMemo(() => planAynasiNotu(gozlemler.rows, donem), [gozlemler.rows, donem]);
  const aylik = useMemo(() => aylikSatirlar(gozlemler.rows, an), [gozlemler.rows, an]);
  const dikkat = useMemo(
    () => dikkatIsteyenler({ alimlar: alimlar.rows, medya: medya.rows, sorunlar: sorunlar.rows, geciken: gecikenler.length }),
    [alimlar.rows, medya.rows, sorunlar.rows, gecikenler.length],
  );
  const bekleyen = useMemo(() => bekleyenIsler(isler.rows), [isler.rows]);
  const gorevler = useMemo<GenelGorev[]>(
    () =>
      bekleyen.map(record => ({
        id: record.id,
        label: metin(record.label) ?? 'Adsız iş',
        code: nitelik(record, 'kod', 'code') ?? record.source_record_id,
        owner: nitelik(record, 'sorumlu', 'sahip', 'owner'),
        due: record.dates?.planned_on ?? undefined,
        done: kurulduOpu(changeSet.pendingFor(record.id)) !== undefined,
      })),
    // changeSet handle'ı add/undo sonrası yenilenir; done bayrağı o yüzden ona bağlıdır.
    [bekleyen, changeSet],
  );

  // "Kuruldu" terimi: fulfillment_state sözlüğündeki installed; yoksa yalnız kod yazılır (term_id null).
  const kurulduTerimi = useMemo(() => {
    const sozluk = sozlukler.rows.find((v: Vocabulary) => v.key === 'fulfillment_state');
    return terimler.rows.find((t: Term) => t.code === KURULDU && (!sozluk || t.vocabulary_id === sozluk.id))?.id ?? null;
  }, [sozlukler.rows, terimler.rows]);

  const gorevIsaretle = useCallback(
    async (id: string, done: boolean) => {
      const record = bekleyen.find(row => row.id === id);
      if (!record) return;
      const mevcut = kurulduOpu(changeSet.pendingFor(record.id));
      if (done && !mevcut) {
        await changeSet.add({
          recordId: record.id,
          kind: 'state_change',
          before: { axis: 'fulfillment', code: record.state_snapshot?.fulfillment ?? null, term_id: record.state_term_ids?.fulfillment ?? null },
          after: { axis: 'fulfillment', code: KURULDU, term_id: kurulduTerimi },
        });
      } else if (!done && mevcut) {
        await changeSet.undo(mevcut.opId);
      }
    },
    [bekleyen, changeSet, kurulduTerimi],
  );

  const ayAdi = donemAdi(donem);
  const gorunum = useMemo<GenelGorunum>(
    () => ({
      odemeler: {
        title: `Yaklaşan ödemeler · ${PENCERE_GUN} gün`,
        link: BAGLANTI.butce,
        items: odemeler,
        empty: olayKaydiYok ? KAYNAKTA_YOK.forecast_events : `Önümüzdeki ${PENCERE_GUN} günde ödeme yok`,
      },
      dikkat: { title: 'Dikkat isteyenler', link: BAGLANTI.veri, items: dikkat, empty: 'Dikkat isteyen kayıt yok' },
      butce: {
        title: `Bütçe · ${ayAdi}`,
        link: BAGLANTI.butce,
        items: butce,
        empty: gozlemler.rows.length === 0 ? KAYNAKTA_YOK.budget_observations : `${ayAdi} için bütçe kalemi yok`,
        note: aynaNotu,
      },
      gorevler: {
        title: 'Bekleyen işler',
        link: BAGLANTI.projeler,
        items: gorevler,
        empty: isler.rows.length === 0 ? KAYNAKTA_YOK.work_orders : 'Bekleyen iş yok',
      },
      aylik: {
        title: AYLIK_BASLIK,
        link: BAGLANTI.butce,
        items: aylik,
        empty: gozlemler.rows.length === 0 ? KAYNAKTA_YOK.budget_observations : 'Aylık bütçe toplamı yok',
      },
    }),
    [odemeler, olayKaydiYok, dikkat, ayAdi, butce, gozlemler.rows.length, aynaNotu, gorevler, isler.rows.length, aylik],
  );

  const sayfa = currentAdminLink(location);
  const durum: DataStatusProps = {
    state: DURUM[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: () => void generation.refresh(),
  };
  const yeniden = () => void generation.refresh();

  // Nesil okunamadı ve elde son iyi nesil yok: tutar gösterilmez.
  const nesilHatasi = generation.state === 'error' && generation.manifest === null;
  const koleksiyonHatasi = parcalar.find(parca => parca.error !== null)?.error ?? null;
  const yukleniyor = !nesilHatasi && ((generation.manifest === null && generation.state !== 'stale') || parcalar.some(parca => parca.loading));
  const hazir = !nesilHatasi && !yukleniyor && koleksiyonHatasi === null;
  const durumAdi = nesilHatasi || (koleksiyonHatasi && !yukleniyor) ? 'hata' : yukleniyor ? 'yukleniyor' : generation.state === 'stale' ? 'eski' : 'hazir';

  const ozet: readonly PageHeaderSummary[] | undefined = hazir
    ? [kalanNakit(aylar.rows, donem), odenecekOlcusu(odemeler, olayKaydiYok), gecikenOlcusu(gecikenler, alimlar.rows.length === 0 && isler.rows.length === 0)]
    : undefined;
  const isaretle = changeSet.ready ? (id: string, done: boolean) => void gorevIsaretle(id, done) : undefined;

  return (
    <div className="aile-genel" data-durum={durumAdi}>
      <PageHeader
        location={location}
        section={sayfa.section}
        title={sayfa.label}
        purpose={sayfa.purpose}
        primary={
          <Button variant="secondary" icon="sheet" onClick={() => navigate(RAPOR_YOLU)}>
            {BIRINCIL_EYLEM}
          </Button>
        }
        status={durum}
        summary={ozet}
      />
      {nesilHatasi ? (
        <ErrorState title={generation.message ?? 'Nesil okunamadı'} message="Doğrulanmış nesil okunamadı. Tutarlar, yanıltmaması için gösterilmiyor." onRetry={yeniden} />
      ) : koleksiyonHatasi && !yukleniyor ? (
        <ErrorState title={koleksiyonHatasi} message="Bir koleksiyon okunamadı. Tutarlar, yanıltmaması için gösterilmiyor." onRetry={yeniden} />
      ) : yukleniyor ? (
        <LoadingShell narrow={profile === 'phone'} label={OKUNUYOR} />
      ) : (
        <Adaptive
          phone={<GenelTelefon gorunum={gorunum} onToggleTask={isaretle} />}
          wide={<GenelGenis gorunum={gorunum} onToggleTask={isaretle} />}
        />
      )}
    </div>
  );
}
