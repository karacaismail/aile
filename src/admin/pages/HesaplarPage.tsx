import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { useProfile } from '../adaptive/context';
import { lazyWide } from '../adaptive/loader';
import { useCollection, useGeneration } from '../data/useGeneration';
import type { GenerationState } from '../data/types';
import type { DataStatusProps, DataStatusState, PageHeaderAction, PageHeaderSummary } from '../shell/contracts';
import { PageHeader } from '../shell/PageHeader';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorState } from '../ui/ErrorState';
import { LoadingShell } from '../ui/LoadingShell';
import { BILINMIYOR, formatMoney, HENUZ_YOK } from '../ui/Money';
import { Select } from '../ui/Select';
import { BakiyeListesi } from './hesaplar/BakiyeListesi';
import {
  buAyMi, donemBakiyeleri, donemMetni, donemSecenekleri, kapanisOzeti, projeksiyon, tahminAdlari, varsayilanDonem,
} from './hesaplar/model';
import './HesaplarPage.css';

// Hesaplar ve borçlar (Para). Tasarım: tasarim-sistemi/README.md "Sayfa iskeleti" + "Uyarlanır teslim", bundle.js
// Aile.Pages.Hesaplar (Sec › Hesaplar mobileMode list, Sec › Borçlar; başlıkta "Hesap ekle" + Diğer › "Borç ekle";
// özet üç ölçü). Veri gerçeği: nesilde hesap ve borç koleksiyonu yoktur; tek bakiye kaynağı forecast_months'tır
// (hesaplar/model.ts). Bu yüzden:
//  - Hesaplar bölümü seçili dönemin tahmini bakiyelerini düz liste satırı olarak gösterir (kart değil); her satır
//    "Tahmin" der, toplam satırı yoktur; ayların ve tahminlerin bakiyeleri toplanmaz. Hesap kaydı yokluğu adıyla yazılır.
//  - Dönem ui/Select ile seçilir: telefonda alt sayfa (BottomSheet). Varsayılan, içinde bulunulan ay (Europe/Istanbul).
//  - Borçlar bölümü "Kaynakta borç kaydı yok" der; tutar uydurulmaz. Özet hesap/borç toplamını uydurmaz.
//  - Geniş profil (tablet/masaüstü) ek olarak tüm dönemlerin tablosu ve kapanış çizgisini yükler
//    (hesaplar/Projeksiyon.wide.tsx, lazyWide); telefon bunu ve echarts'ı indirmez.
// Durumlar ayrı ve adıyla: yükleniyor (iskelet), boş ("Kaynakta tahmin dönemi kaydı yok"), hata ("Hata: …" + Yeniden
// dene, tutar yok), eski veri (son başarılı tahmin + "Eski veri"). Nesil hiç okunamazsa sayfa düzeyinde tek hata.
// Yazma yok: "Hesap ekle" ve "Borç ekle" bunu açıklayan diyalog açar (telefonda alt sayfa). ui/ API'si doğrudan
// modül yollarıyla alınır (barrel değil): telefon sayfa parçası yalnız kullandığı bileşenleri çeker.

export interface HesaplarPageProps {
  /** Hash yolu; PageHeader bölüm/menü adını buradan doğrular. */
  location?: string;
  /** "Bugün" (varsayılan dönem ve "Bu ay" notu için); verilmezse açılış anı. Testler sabitler. */
  today?: Date;
}

const ProjeksiyonWide = lazyWide('hesaplar-projeksiyon', () => import('./hesaplar/Projeksiyon.wide'));

const KONUM = '/hesaplar';
const BOLUM = 'Para';
const BASLIK = 'Hesaplar ve borçlar';
const AMAC = 'Hesap bakiyelerini ve kalan borçları, taksit planıyla birlikte görün.';
const KAYNAKTA_YOK = 'Kaynakta kayıt yok';
const YUKLENIYOR = 'Yükleniyor';
const KAYNAK_NOTU = 'Bakiye tek kaynaktan, nakit tahmininden gelir: tahmindir, gerçek banka hesabı kaydı değildir. Aylar ve tahminler toplanmaz.';
const HESAP_YOK = 'Kaynakta hesap kaydı yok: bakiye hesap hesap değil, tek nakit tahmini olarak gelir.';
const BORC_YOK = 'Kaynakta borç kaydı yok';
const DONEM_YOK = 'Kaynakta tahmin dönemi kaydı yok';
const DONEM_YOK_NEDEN = 'Tahmin e-tabloda tanımlanıp yeni nesil üretilince bakiyeler burada görünür.';
const ESKI_VERI = 'Eski veri: son başarılı nesil gösteriliyor; yenilenemedi.';
const KAPANIS_ETIKETI = 'Kapanış bakiyesi (tahmin)';
const ISKELET_SATIR = 3;

const DURUM: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };

type Ekleme = 'hesap' | 'borc';
const EKLEME: Record<Ekleme, { title: string; neden: string }> = {
  hesap: { title: 'Hesap ekle', neden: 'Kaynakta hesap koleksiyonu yok: doğrulanmış nesilde hesap kaydı bulunmuyor.' },
  borc: { title: 'Borç ekle', neden: 'Kaynakta borç koleksiyonu yok: doğrulanmış nesilde borç kaydı bulunmuyor.' },
};
const YAZMA_YOK = 'E-tabloya yazma bu sürümde yok; kayıt e-tabloda tanımlanıp yeni nesil üretilince burada görünür.';

function Bolum({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="aile-hesaplar__blok" aria-labelledby={id}>
      <div className="aile-hesaplar__bas">
        <h2 id={id} className="aile-hesaplar__baslik">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function HesaplarPage({ location = KONUM, today }: HesaplarPageProps) {
  const profile = useProfile();
  const telefon = profile === 'phone';
  const generation = useGeneration();
  const forecasts = useCollection('forecasts');
  const months = useCollection('forecast_months');
  const [acilis] = useState(() => new Date());
  const bugun = today ?? acilis;
  const [secim, setSecim] = useState<string | null>(null);
  const [ekleme, setEkleme] = useState<Ekleme | null>(null);
  const kapat = useCallback(() => setEkleme(null), []);

  const veri = useMemo(() => projeksiyon(months.rows, tahminAdlari(forecasts.rows)), [months.rows, forecasts.rows]);
  const varsayilan = useMemo(() => varsayilanDonem(veri.donemler, bugun), [veri.donemler, bugun]);
  const secili = secim !== null && veri.donemler.includes(secim) ? secim : varsayilan;
  const secenekler = useMemo(() => donemSecenekleri(veri.donemler, bugun), [veri.donemler, bugun]);

  const yukleniyor = months.loading || forecasts.loading;
  const hata = months.error ?? forecasts.error;
  const refresh = generation.refresh;
  const yenile = useCallback(() => { void refresh(); }, [refresh]);
  // Nesil hiç okunamadı: sayfa düzeyinde tek hata; hesap/borç yokluğu da iddia edilmez. Koleksiyon önce manifesti okur:
  // manifest yokken gelen koleksiyon hatası da nesil hatasıdır (bölüm hatası kısa süre görünüp yer değiştirmez).
  // Manifest varken parça hatası bölümde kalır.
  const nesilHatasi = generation.manifest === null && (generation.state === 'error' || hata !== null);
  const veriVar = !yukleniyor && !hata && veri.donemler.length > 0;

  const status: DataStatusProps = {
    state: DURUM[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: yenile,
  };

  let kapanis: PageHeaderSummary;
  if (nesilHatasi || hata) {
    kapanis = { label: KAPANIS_ETIKETI, value: BILINMIYOR };
  } else if (yukleniyor) {
    kapanis = { label: KAPANIS_ETIKETI, value: YUKLENIYOR };
  } else {
    const ozet = kapanisOzeti(veri, varsayilan);
    kapanis = ozet.kind === 'tek'
      ? { label: KAPANIS_ETIKETI, value: formatMoney(ozet.deger, BILINMIYOR), note: `${donemMetni(varsayilan ?? undefined)} · tahmin, gerçek değil` }
      : ozet.kind === 'cok'
        ? { label: KAPANIS_ETIKETI, value: `${ozet.sayi} tahmin`, note: 'bakiyeler toplanmaz' }
        : { label: KAPANIS_ETIKETI, value: HENUZ_YOK };
  }
  const hesapToplami = nesilHatasi ? BILINMIYOR : KAYNAKTA_YOK;
  const summary: readonly PageHeaderSummary[] = [
    { label: 'Hesaplardaki toplam', value: hesapToplami },
    { label: 'Kalan borç', value: hesapToplami },
    kapanis,
  ];
  const more: readonly PageHeaderAction[] = [{ label: 'Borç ekle', icon: 'plus', onClick: () => setEkleme('borc') }];

  const header = (
    <PageHeader
      location={location}
      section={BOLUM}
      title={BASLIK}
      purpose={AMAC}
      primary={<Button variant="primary" icon="plus" onClick={() => setEkleme('hesap')}>Hesap ekle</Button>}
      more={more}
      status={status}
      summary={summary}
    />
  );

  let bakiyeIcerik: ReactNode;
  if (hata) {
    bakiyeIcerik = (
      <div className="aile-hesaplar__hata">
        <ErrorState title="Bakiye tahmini okunamadı" message={hata} onRetry={yenile} />
      </div>
    );
  } else if (yukleniyor) {
    bakiyeIcerik = <LoadingShell rows={ISKELET_SATIR} narrow={telefon} />;
  } else if (veri.donemler.length === 0 || !secili) {
    bakiyeIcerik = (
      <div className="aile-hesaplar__bos">
        <p className="aile-hesaplar__bos-baslik">{DONEM_YOK}</p>
        <p className="aile-kucuk aile-ikincil">{DONEM_YOK_NEDEN}</p>
      </div>
    );
  } else {
    bakiyeIcerik = (
      <>
        {/* Canlı durum bölgesi: duyurulur; kaydın kendisi değildir (son iyi içerik aynen kalır, f05 eski veri). */}
        {generation.state === 'stale' ? <p role="status" className="aile-hesaplar__eski">{ESKI_VERI}</p> : null}
        <div className="aile-hesaplar__secici">
          <Select label="Dönem" options={secenekler} value={secili} onChange={setSecim} />
        </div>
        <BakiyeListesi donem={donemMetni(secili)} buAy={buAyMi(secili, bugun)} gruplar={donemBakiyeleri(veri, secili)} />
      </>
    );
  }

  return (
    <div className={`aile-hesaplar${telefon ? ' aile-hesaplar--dar' : ''}`}>
      {header}
      {nesilHatasi ? (
        <div className="aile-hesaplar__hata">
          <ErrorState title="Nesil okunamadı" message={generation.message ?? undefined} onRetry={yenile} />
        </div>
      ) : (
        <>
          <Bolum title="Hesaplar">
            <p className="aile-hesaplar__not">{KAYNAK_NOTU}</p>
            {bakiyeIcerik}
            <p className="aile-hesaplar__yok aile-kucuk aile-ikincil">{HESAP_YOK}</p>
          </Bolum>
          <Bolum title="Borçlar">
            <p className="aile-hesaplar__yok aile-ikincil">{BORC_YOK}</p>
          </Bolum>
          {veriVar ? <ProjeksiyonWide veri={veri} secili={secili} onSec={setSecim} /> : null}
        </>
      )}
      {ekleme ? (
        <Dialog title={EKLEME[ekleme].title} onClose={kapat}>
          <p className="aile-hesaplar__neden">{EKLEME[ekleme].neden}</p>
          <p className="aile-hesaplar__neden aile-ikincil">{YAZMA_YOK}</p>
        </Dialog>
      ) : null}
    </div>
  );
}
