import { useId, useMemo } from 'react';
import { Adaptive, lazyWide, useProfile } from '../adaptive';
import { collectionSchemas, useCollection, useGeneration } from '../data';
import type { CollectionName, GenerationState, PurchaseNeedRecord, Relation } from '../data/types';
import { PageHeader } from '../shell/PageHeader';
import type { DataStatusProps, DataStatusState, PageHeaderSummary } from '../shell/contracts';
import { adminPages } from '../shell/navigation';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { LoadingShell } from '../ui/LoadingShell';
import { BILINMIYOR, HENUZ_YOK } from '../ui/Money';
import { IsiYapanlarListesi, TaraflarListesi, TekliflerListesi } from './taraflar/listeler';
import { adaylariTuret, taraflarKaynagi, taraflariTuret, teklifGruplari } from './taraflar/model';
import { karsilastirmaOzeti } from './taraflar/sunum';
import './TaraflarPage.css';

// Tasarım: bundle.js Aile.Pages.Taraflar (masaüstü / tablet / telefon), README "Sayfa iskeleti (sıra sabit)",
// "Veri durumları", "İçerik ilkeleri", "Uyarlanır teslim". Sıra: PageHeader (bölüm İşler → h1 → amaç → eylem →
// DataStatus → özet ≤ 3) → Teklifler (kayıt bazında karşılaştırma) → Taraflar (usta/satıcı, iletişim) → İşi yapanlar.
//
// Uyarlamalı teslim (W0): telefon temel sunumdur — yerel HTML + ui/AccordionList (tablolar akordeon, ilk satır açık).
// Geniş sunum (karşılaştırma yuvaları, tablolar) taraflar/*.wide.tsx içindedir ve yalnız geniş profilde lazyWide ile
// iner; telefon indirmez, geniş modül beklerken ya da yüklenemezse telefon sunumu kullanılır. ui/ modülleri tek tek
// alınır (barrel değil): telefon yolu kullanmadığı Table/Select/Chart grafiğini çekmez.
//
// Veri dürüstlüğü: taraflar e-tablodaki usta satırlarıdır (normalize.mjs → 'providers'). Panel sözleşmesi bu koleksiyonu
// tanımıyorsa okumayı denemez (bilinmeyen bölüm nesli bozuk saydırırdı); manifestte varsa sayısını ve okunmadığını
// adıyla söyler. Teklif = amounts.quote; plan (planned) ve gerçek (actual) ayrı değerlerdir, tek sayıda birleşmez.
// Sheets'e yazma bu dilimde yok: "Teklif kaydet" devre dışı ve nedeni yazılı.

export { adaylariTuret } from './taraflar/model';
export type { Aday, AdayAlani } from './taraflar/model';

const SAYFA = adminPages.find((page) => page.key === 'taraflar')!;

const TekliflerGenis = lazyWide('taraflar-teklifler', () => import('./taraflar/TekliflerGenis.wide'));
const TaraflarTablosu = lazyWide('taraflar-tablo', () => import('./taraflar/TaraflarTablosu.wide'));
const IsiYapanlarTablosu = lazyWide('taraflar-isi-yapanlar', () => import('./taraflar/IsiYapanlarTablosu.wide'));

/** normalize.mjs usta satırlarını bu koleksiyona yazar; panel sözleşmesi tanıyorsa okunur. */
const PROVIDERS = 'providers' as CollectionName;
const PROVIDERS_DESTEKLI = Object.prototype.hasOwnProperty.call(collectionSchemas, PROVIDERS);

const DURUM: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };
const OKUNUYOR = 'Okunuyor';

interface Parca<R> { rows: readonly R[]; loading: boolean; error: string | null }

export function TaraflarPage() {
  const generation = useGeneration();
  const narrow = useProfile() === 'phone';
  const kaynak = taraflarKaynagi(generation.manifest, PROVIDERS_DESTEKLI);
  const ustaKaynagi = kaynak.durum === 'okunur';
  const isler = useCollection('work_orders');
  const alimlar = useCollection('purchase_needs');
  // Usta ve bağları yalnız koleksiyon okunabilirken yüklenir. Hook sırası sabit kalsın diye çağrı koşulsuzdur: okunmuyorsa
  // zaten yüklenen iş emirlerine bağlanır (ek indirme yok) ve sonucu kullanılmaz. Sayfa yeniden kurulmaz.
  const ustaParcasi = useCollection(ustaKaynagi ? PROVIDERS : 'work_orders') as unknown as Parca<PurchaseNeedRecord>;
  const iliskiParcasi = useCollection(ustaKaynagi ? 'relations' : 'work_orders') as unknown as Parca<Relation>;
  const ustalar = ustaKaynagi ? ustaParcasi : null;
  const iliskiler = ustaKaynagi ? iliskiParcasi : null;
  const notId = useId();
  const tekliflerId = useId();
  const taraflarId = useId();
  const isiYapanlarId = useId();
  const yeniden = () => void generation.refresh();

  const teklifParcalari: Parca<unknown>[] = [isler, alimlar, ...(ustalar && iliskiler ? [ustalar, iliskiler] : [])];
  const teklifYukleniyor = teklifParcalari.some((parca) => parca.loading);
  const teklifHatasi = teklifParcalari.find((parca) => parca.error !== null)?.error ?? null;

  const gruplar = useMemo(
    () => teklifGruplari({ kayitlar: [...isler.rows, ...alimlar.rows], taraflar: ustalar?.rows, iliskiler: iliskiler?.rows }),
    [isler.rows, alimlar.rows, ustalar?.rows, iliskiler?.rows],
  );
  const taraflar = useMemo(() => (ustalar ? taraflariTuret(ustalar.rows) : []), [ustalar?.rows]);
  const adaylar = useMemo(() => adaylariTuret(isler.rows), [isler.rows]);
  const ozetler = gruplar.flatMap((grup) => {
    const metin = karsilastirmaOzeti(grup);
    return metin ? [{ key: grup.key, metin }] : [];
  });

  const teklifSayisi = gruplar.reduce((toplam, grup) => toplam + grup.teklifler.length, 0);
  const kayitSayisi = gruplar.filter((grup) => grup.durum === 'bagli').length;
  const karsilastirmaSayisi = gruplar.filter((grup) => grup.durum === 'bagli' && grup.teklifler.length >= 2).length;
  const generationFailed = generation.state === 'error' && generation.manifest === null;

  const teklifOlcusu = (sayi: number): string => (teklifHatasi ? BILINMIYOR : teklifYukleniyor ? OKUNUYOR : sayi > 0 ? String(sayi) : HENUZ_YOK);
  const tarafOlcusu = ((): PageHeaderSummary => {
    const label = 'Taraf kaydı';
    switch (kaynak.durum) {
      case 'bilinmiyor': return { label, value: generationFailed ? BILINMIYOR : OKUNUYOR };
      case 'yok': return { label, value: HENUZ_YOK, note: 'kaynakta usta satırı yok' };
      case 'okunamiyor': return { label, value: BILINMIYOR, note: 'bu sürümde okunmuyor' };
      case 'okunur':
        if (ustalar?.error) return { label, value: BILINMIYOR };
        if (!ustalar || ustalar.loading) return { label, value: OKUNUYOR };
        return { label, value: taraflar.length > 0 ? String(taraflar.length) : HENUZ_YOK, note: 'usta ve satıcı' };
    }
  })();

  // Teklif ile plan/gerçek ayrı ölçülerdir; özet teklifleri ve karşılaştırılabilir kayıtları sayar, tutar birleştirmez.
  const summary: readonly PageHeaderSummary[] = [
    tarafOlcusu,
    { label: 'Teklif', value: teklifOlcusu(teklifSayisi), note: kayitSayisi > 0 && !teklifHatasi && !teklifYukleniyor ? `${kayitSayisi} kayıt için` : undefined },
    { label: 'Karşılaştırma', value: teklifOlcusu(karsilastirmaSayisi), note: 'en az iki teklifli kayıt' },
  ];

  const status: DataStatusProps = {
    state: DURUM[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: yeniden,
  };

  const yukleniyor = <LoadingShell rows={3} narrow={narrow} />;

  const tekliflerIcerigi = teklifYukleniyor ? yukleniyor
    : teklifHatasi ? <ErrorState title="Teklifler okunamadı" message={teklifHatasi} onRetry={yeniden} />
    : gruplar.length === 0 ? <EmptyState title="Kaynakta teklif yok" message="Alım, iş emri ve usta kayıtlarında teklif tutarı (Teklif TL) dolu değil." />
    : (
      <>
        {ozetler.length > 0 ? (
          <ul className="aile-taraflar__ozetler" aria-label="Karşılaştırma özeti">
            {ozetler.map(({ key, metin }) => <li key={key}>{metin}</li>)}
          </ul>
        ) : null}
        <Adaptive phone={<TekliflerListesi gruplar={gruplar} />} wide={<TekliflerGenis gruplar={gruplar} />} />
      </>
    );

  const taraflarIcerigi = kaynak.durum === 'bilinmiyor' ? yukleniyor
    : kaynak.durum === 'yok' ? (
      <EmptyState
        title="Kaynakta taraf kaydı yok"
        message="Bu nesilde usta satırı yok; e-tabloya usta eklendiğinde ad, meslek, teklif ve iletişim burada listelenir."
      />
    )
    : kaynak.durum === 'okunamiyor' ? (
      <EmptyState
        title="Taraf kayıtları bu sürümde okunmuyor"
        message={`${kaynak.sayi !== null ? `Nesilde ${kaynak.sayi} taraf kaydı var` : 'Nesilde taraf kayıtları var'}; panelin veri sözleşmesi bu koleksiyonu henüz tanımıyor. İletişim ve teklif bilgisi: Bilinmiyor.`}
      />
    )
    : !ustalar || ustalar.loading ? yukleniyor
    : ustalar.error ? <ErrorState title="Taraflar okunamadı" message={ustalar.error} onRetry={yeniden} />
    : taraflar.length === 0 ? <EmptyState title="Kaynakta taraf kaydı yok" message="Nesildeki usta satırlarının hepsi silinmiş." />
    : <Adaptive phone={<TaraflarListesi taraflar={taraflar} />} wide={<TaraflarTablosu taraflar={taraflar} />} />;

  const isiYapanlarIcerigi = isler.loading ? yukleniyor
    : isler.error ? <ErrorState title="İş emirleri okunamadı" message={isler.error} onRetry={yeniden} />
    : adaylar.length === 0 ? <EmptyState title="Kaynakta işi yapan bilgisi yok" message="İş emirlerinde İşi yapan (is_kim) alanı dolu değil." />
    : <Adaptive phone={<IsiYapanlarListesi adaylar={adaylar} />} wide={<IsiYapanlarTablosu adaylar={adaylar} />} />;

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
        <ErrorState title="Nesil okunamadı" message={generation.message ?? 'Hata: nesil okunamadı'} onRetry={yeniden} />
      ) : (
        <>
          <section className="aile-taraflar__bolum" aria-labelledby={tekliflerId}>
            <div className="aile-taraflar__bolum-baslik">
              <h2 id={tekliflerId} className="aile-taraflar__h2">Teklifler</h2>
              {!teklifYukleniyor && !teklifHatasi && teklifSayisi > 0 ? (
                <p className="aile-taraflar__sayim aile-kucuk aile-ikincil">{`${teklifSayisi} teklif · ${kayitSayisi} kayıt`}</p>
              ) : null}
            </div>
            <p className="aile-taraflar__aciklama aile-kucuk aile-ikincil">
              Alım ve iş kayıtlarındaki teklif tutarı ile bu kayıtlara bağlı usta teklifleri. Teklif ödeme değildir; plan ve gerçek ayrı yazılır.
            </p>
            {tekliflerIcerigi}
          </section>

          <section className="aile-taraflar__bolum" aria-labelledby={taraflarId}>
            <div className="aile-taraflar__bolum-baslik">
              <h2 id={taraflarId} className="aile-taraflar__h2">Taraflar</h2>
              {kaynak.durum === 'okunur' && ustalar && !ustalar.loading && !ustalar.error && taraflar.length > 0 ? (
                <p className="aile-taraflar__sayim aile-kucuk aile-ikincil">{`${taraflar.length} taraf`}</p>
              ) : null}
            </div>
            <p className="aile-taraflar__aciklama aile-kucuk aile-ikincil">
              E-tablodaki usta satırları: ad, meslek, teklif ve iletişim. Kaynakta olmayan bilgi Bilinmiyor diye yazılır.
            </p>
            {taraflarIcerigi}
          </section>

          <section className="aile-taraflar__bolum" aria-labelledby={isiYapanlarId}>
            <div className="aile-taraflar__bolum-baslik">
              <h2 id={isiYapanlarId} className="aile-taraflar__h2">İşi yapanlar</h2>
              {!isler.loading && !isler.error && adaylar.length > 0 ? (
                <p className="aile-taraflar__sayim aile-kucuk aile-ikincil">{`${adaylar.length} işi yapan`}</p>
              ) : null}
            </div>
            <p className="aile-taraflar__aciklama aile-kucuk aile-ikincil">
              İş emirlerindeki İşi yapan (is_kim) alanından; yalnız kaynak metin, taraf kaydına bağ değil.
            </p>
            {isiYapanlarIcerigi}
          </section>
        </>
      )}
    </div>
  );
}
