import { useId, useMemo, useState, type ReactNode } from 'react';
import { Adaptive, lazyWide, useProfile } from '../adaptive';
import { useCollection, useGeneration, useRows } from '../data';
import type { DataStatusProps, PageHeaderSummary } from '../shell/contracts';
import { PageHeader } from '../shell/PageHeader';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { LoadingShell } from '../ui/LoadingShell';
import { KontrollerBolumu, SablonlarBolumu } from './projeler/Bolumler';
import {
  FIYAT_YOK, HENUZ_YOK, TUR_IS, TUR_TAS, gorevSatirlari, kontrolSatirlari, projeGruplari, sablonGorunumleri, sayi, todayUtc,
  topla, toplamMetni, workflowColumns,
} from './projeler/model';
import { ProjelerTelefon } from './projeler/ProjelerTelefon';
import './ProjelerPage.css';

// Projeler ve görevler. Tasarım: README.md › Sayfa iskeleti + Uyarlanır teslim, bundle.js › Pages.Projeler (bölüm
// "İşler", amaç cümlesi, özet 3 ölçü, birincil eylem; geniş ekranda sorgu çubuğu + 56 px filtre şeridi + Tablo/Kanban/
// Gantt). Mobil önce: telefon sunumu (projeler/ProjelerTelefon) proje listesi → proje ayrıntısı → görevler; yerel HTML,
// tablolar akordeon (ilk satır açık), seçim alttan açılır. Geniş (tablet/masaüstü) çalışma alanı projeler/
// ProjelerGenis.wide içinde ve yalnız lazyWide ile yüklenir; telefon onu, Kanban'ı, Gantt'ı ve sorgu/filtre kodunu
// indirmez. Veri: nesilde proje koleksiyonu yok; görevler proje aşamasına göre toplanır (projeler/model). Kontroller
// (geçti / kaldı / eksik ayrı) ve önerilen görev şablonları (gerçek görev değil; Türkçe ad + sürüm, ham anahtar yalnız
// ayrıntıda) ayrı bölümlerdedir. Plan ve gerçek tek sayıda birleşmez; eksik bilgi adıyla yazılır. Yazma yok.
//
// Hazır sinyali: sayfa okuduğu her koleksiyon (useRows'un istediği odalar, ilişkiler, medya, sözlükler dahil) gelene kadar
// iskeleti (aria-busy) korur; yarım indeksle ("Bilinmiyor" oda) satır çizilmez ve iskelet ile tazelik satırı birlikte biter.

export {
  ganttPlan, kontrolSonucu, projeGruplari, sablonGorunumleri, workflowColumns,
  type GanttBar, type GanttInput, type GanttPlan, type GanttWeek, type GorevSatiri, type Proje, type SablonGorunumu,
} from './projeler/model';

const LOCATION = '/projeler';
const KONUM_BOLUM = 'İşler';
const BASLIK = 'Projeler ve görevler';
const AMAC = 'Ev projelerini ve görevlerini kim, ne zaman ve hangi sırayla yapacak, görün.';
const EKLE_NOTU = 'Proje ve görev kaydı bu sürümde yalnız e-tablodan gelir; panelden ekleme henüz yok.';
const KAYNAKTA_GOREV_YOK = 'Kaynakta görev kaydı yok';

const ProjelerGenisWide = lazyWide('projeler-genis', () => import('./projeler/ProjelerGenis.wide'));

function dataStatus(generation: ReturnType<typeof useGeneration>): DataStatusProps {
  const state: DataStatusProps['state'] =
    generation.state === 'ready' ? 'fresh' : generation.state === 'stale' ? 'stale' : generation.state === 'error' ? 'error' : 'checking';
  const props: DataStatusProps = { state, onRefresh: () => void generation.refresh() };
  if (generation.lastReadAt) props.lastReadAt = generation.lastReadAt;
  if (generation.generationId) props.generationId = generation.generationId;
  if (generation.lastGoodAt) props.lastGoodAt = generation.lastGoodAt;
  if (generation.message) props.message = generation.message;
  return props;
}

export interface ProjelerPageProps {
  /** Bugünün kaynağı (geciken ve "Bu hafta" hesabı); varsayılan gerçek saat. Test sabit gün verir. */
  now?: () => Date;
}

export function ProjelerPage({ now }: ProjelerPageProps) {
  const profile = useProfile();
  const phone = profile === 'phone';
  const generation = useGeneration();
  const notId = useId();

  // Sayfanın okuduğu koleksiyonların hepsi (useRows'un iç bağımlılıkları dahil); hazır sinyali bunlardan türer.
  const isler = useCollection('work_orders');
  const taslar = useCollection('milestones');
  const kontroller = useCollection('inspections');
  const sablonlar = useCollection('task_templates');
  const akislar = useCollection('workflows');
  const terimler = useCollection('terms');
  const odalar = useCollection('rooms');
  const iliskiler = useCollection('relations');
  const medya = useCollection('media_references');
  const sozlukler = useCollection('vocabularies');
  const isSatirlari = useRows(TUR_IS);
  const tasSatirlari = useRows(TUR_TAS);
  const kontrolHam = useRows('inspection');

  const simdi = useMemo(() => (now ?? (() => new Date()))(), [now]);
  const today = useMemo(() => todayUtc(simdi), [simdi]);
  const [seciliProjeId, setSeciliProjeId] = useState<string | null>(null);

  const asamaAdi = useMemo(() => {
    const byId = new Map(terimler.rows.map(term => [term.id, term.label] as const));
    return (id: string) => byId.get(id);
  }, [terimler.rows]);
  const gorevler = useMemo(
    () => gorevSatirlari([...isSatirlari, ...tasSatirlari], [...isler.rows, ...taslar.rows], today, asamaAdi),
    [isSatirlari, tasSatirlari, isler.rows, taslar.rows, today, asamaAdi],
  );
  const projeler = useMemo(() => projeGruplari(gorevler), [gorevler]);
  const kanbanSutunlari = useMemo(() => workflowColumns(akislar.rows, terimler.rows), [akislar.rows, terimler.rows]);
  const kontrolListesi = useMemo(() => kontrolSatirlari(kontrolHam, kontroller.rows), [kontrolHam, kontroller.rows]);
  const sablonListesi = useMemo(() => sablonGorunumleri(sablonlar.rows), [sablonlar.rows]);

  // --- Durumlar ---
  const ortak = [terimler, odalar, iliskiler, medya, sozlukler];
  const gorevParcalari = [isler, taslar, akislar, ...ortak];
  const gorevYukleniyor = gorevParcalari.some(part => part.loading);
  const gorevHatasi = gorevParcalari.find(part => part.error !== null)?.error ?? null;
  const kontrolParcalari = [kontroller, ...ortak];
  const kontrolYukleniyor = kontrolParcalari.some(part => part.loading);
  const kontrolHatasi = kontrolParcalari.find(part => part.error !== null)?.error ?? null;
  // Manifest gelmeden bölümler çizilmez: koleksiyon hataları manifest hatasından önce düşebilir; tek alert, tek iskelet.
  const manifestYok = generation.manifest === null;
  const pageError = manifestYok && generation.state === 'error';
  const pageLoading = manifestYok && !pageError;
  const gorevHazir = !manifestYok && !gorevYukleniyor && !gorevHatasi;
  const yenile = () => void generation.refresh();

  // --- Özet: açık görev · planlanan · gerçekleşen (plan ve gerçek ayrı girdiler) ---
  const summary = useMemo<PageHeaderSummary[]>(() => {
    const acik = gorevler.filter(row => row.acik).length;
    const geciken = gorevler.filter(row => row.gecikti).length;
    const plan = topla(gorevler.map(row => row.planned));
    const gercek = topla(gorevler.map(row => row.actual));
    const olcu = (label: string, value: string, note?: string): PageHeaderSummary => (note ? { label, value, note } : { label, value });
    return [
      olcu('Açık görev', sayi.format(acik), geciken > 0 ? `${sayi.format(geciken)} geciken` : `${sayi.format(gorevler.length)} görev`),
      olcu('Planlanan', toplamMetni(plan, FIYAT_YOK), plan.eksik ? `${sayi.format(plan.eksik)} fiyatsız` : undefined),
      olcu('Gerçekleşen', toplamMetni(gercek, HENUZ_YOK), gercek.eksik ? `${sayi.format(gercek.eksik)} henüz yok` : undefined),
    ];
  }, [gorevler]);

  const header = (
    <PageHeader
      location={LOCATION}
      section={KONUM_BOLUM}
      title={BASLIK}
      purpose={AMAC}
      primary={
        <Button variant="primary" icon="plus" disabled aria-describedby={notId}>
          Görev ekle
        </Button>
      }
      status={dataStatus(generation)}
      summary={gorevHazir && gorevler.length > 0 ? summary : undefined}
    >
      <p id={notId} className="aile-projeler-not aile-kucuk aile-ikincil">{EKLE_NOTU}</p>
    </PageHeader>
  );

  if (pageError) {
    return (
      <div className="aile-projeler">
        {header}
        <ErrorState title="Nesil okunamadı" message={generation.message ?? 'Hata: nesil manifesti okunamadı.'} onRetry={yenile} />
      </div>
    );
  }
  if (pageLoading) {
    return (
      <div className="aile-projeler">
        {header}
        <LoadingShell rows={6} narrow={phone} />
      </div>
    );
  }

  let gorevIcerik: ReactNode;
  if (gorevYukleniyor) {
    gorevIcerik = <LoadingShell rows={6} narrow={phone} />;
  } else if (gorevHatasi) {
    gorevIcerik = <ErrorState title="Görevler okunamadı" message={gorevHatasi} onRetry={yenile} />;
  } else if (gorevler.length === 0) {
    gorevIcerik = (
      <EmptyState
        title={KAYNAKTA_GOREV_YOK}
        message="Nesilde work_orders ve milestones koleksiyonu boş ya da yok. Panel görev uydurmaz; kaynak e-tabloya kayıt eklenince burada görünür."
      />
    );
  } else {
    gorevIcerik = (
      <Adaptive
        phone={<ProjelerTelefon projeler={projeler} seciliId={seciliProjeId} onSec={setSeciliProjeId} onGeri={() => setSeciliProjeId(null)} />}
        wide={<ProjelerGenisWide gorevler={gorevler} kanbanSutunlari={kanbanSutunlari} now={simdi} />}
      />
    );
  }

  // Telefonda proje ayrıntısı tam sayfadır: o sırada kontroller ve şablonlar çizilmez.
  const tamSayfaAyrinti = phone && gorevHazir && seciliProjeId !== null && projeler.some(proje => proje.id === seciliProjeId);

  return (
    <div className="aile-projeler">
      {header}
      {gorevIcerik}
      {tamSayfaAyrinti ? null : (
        <>
          <KontrollerBolumu satirlar={kontrolListesi} loading={kontrolYukleniyor} error={kontrolHatasi} onRetry={yenile} narrow={phone} />
          <SablonlarBolumu sablonlar={sablonListesi} loading={sablonlar.loading} error={sablonlar.error} onRetry={yenile} narrow={phone} />
        </>
      )}
    </div>
  );
}
