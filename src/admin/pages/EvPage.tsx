import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Adaptive, lazyWide } from '../adaptive/loader';
import { useProfile } from '../adaptive/context';
import { useCollection, useGeneration, useRows } from '../data/useGeneration';
import type { GenerationState, PurchaseNeedRecord } from '../data/types';
import { adminLeads } from '../shell/navigation';
import { PageHeader } from '../shell/PageHeader';
import type { DataStatusProps, DataStatusState, PageHeaderSummary, RecordRow } from '../shell/contracts';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { LoadingShell } from '../ui/LoadingShell';
import { FIYAT_YOK, HENUZ_YOK } from '../ui/Money';
import { EvTelefon } from './ev/EvTelefon';
import { evModeli, sayi, toplamMetni, type Sekme } from './ev/model';
import { OdaSecici } from './ev/OdaSecici';
import { odaSatirinaOdaklan, type EvSunumProps, type OdakHedefi } from './ev/ortak';
import './EvPage.css';

// Ev ve odalar. Tasarım: README.md "Sayfa iskeleti" + "Uyarlanır teslim", bundle.js Aile.Pages.Odalar,
// components/SayfaOdalar(Dar). Mobil önce: telefon sunumu (ev/EvTelefon) yerel HTML + ui bileşenleri; oda listesi
// akordeon (ilk satır açık), oda seçimi başlıktaki "Oda seç" ile alttan açılan sayfada, oda ayrıntısı tam sayfa.
// Geniş profil (tablet/masaüstü) ek olarak ev/EvIkiBolme.wide'ı lazyWide ile indirir: oda tablosu + masaüstünde 384 px
// yan ayrıntı (iki bölme); telefon bu modülü hiç istemez. Seçili oda ve sekme burada tutulur: profil değişince korunur.
// Veri yalnız doğrulanmış nesilden: rooms + relations + terms + purchase_needs + work_orders + layout_items +
// lighting_specs (+ satırlar için veri katmanının yardımcı koleksiyonları). Plan ve gerçek ayrı toplanır ve ayrı yazılır;
// eksik bilgi adıyla. "Oda ekle" yok: bu dilimde odaya yazma (değişiklik kümesi op'u) tanımlı değil, çalışmayan düğme
// çizilmez. Durumlar: hata (eski tutar gösterilmez) → yükleniyor (iskelet) → oda yok (dürüst metin) → liste; eski veri
// (stale) son sağlam nesli gösterir ve tazelik satırı "yenilenemedi" der.

const LOCATION = '/ev';
const EvIkiBolme = lazyWide<EvSunumProps>('ev-iki-bolme', () => import('./ev/EvIkiBolme.wide'));

const DURUM: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };

function veriDurumu(generation: ReturnType<typeof useGeneration>): DataStatusProps {
  const status: DataStatusProps = { state: DURUM[generation.state], onRefresh: () => void generation.refresh() };
  if (generation.lastReadAt) status.lastReadAt = generation.lastReadAt;
  if (generation.generationId) status.generationId = generation.generationId;
  if (generation.lastGoodAt) status.lastGoodAt = generation.lastGoodAt;
  if (generation.message) status.message = generation.message;
  return status;
}

function olcu(label: string, value: string, note?: string): PageHeaderSummary {
  return note ? { label, value, note } : { label, value };
}

export function EvPage() {
  const profil = useProfile();
  const generation = useGeneration();

  const rooms = useCollection('rooms');
  const relations = useCollection('relations');
  const terms = useCollection('terms');
  const needs = useCollection('purchase_needs');
  const workOrders = useCollection('work_orders');
  const layout = useCollection('layout_items');
  const lighting = useCollection('lighting_specs');
  const needRows = useRows('purchase_need');
  const workRows = useRows('work_order');
  const layoutRows = useRows('layout_item');
  const lightingRows = useRows('lighting_spec');

  const parcalar = [rooms, relations, terms, needs, workOrders, layout, lighting];
  const loading = parcalar.some((part) => part.loading);
  const error = parcalar.find((part) => part.error !== null)?.error ?? null;

  const satirlar = useMemo(() => {
    const map = new Map<string, RecordRow>();
    for (const rows of [needRows, workRows, layoutRows, lightingRows]) for (const row of rows) map.set(row.id, row);
    return map;
  }, [needRows, workRows, layoutRows, lightingRows]);

  const model = useMemo(
    () => evModeli({
      rooms: rooms.rows,
      relations: relations.rows,
      terms: terms.rows,
      needs: needs.rows,
      workOrders: workOrders.rows,
      layout: layout.rows,
      lighting: lighting.rows,
      satir: (record: PurchaseNeedRecord) => satirlar.get(record.id),
    }),
    [rooms.rows, relations.rows, terms.rows, needs.rows, workOrders.rows, layout.rows, lighting.rows, satirlar],
  );

  const [seciliId, setSeciliId] = useState<string | null>(null);
  const [sonAcilan, setSonAcilan] = useState<string | null>(null);
  const [sekme, setSekme] = useState<Sekme>('alimlar');
  const [seciciAcik, setSeciciAcik] = useState(false);
  const [seciminDonusu, setSeciminDonusu] = useState(false);
  const baslikRef = useRef<HTMLHeadingElement>(null);
  const icerikRef = useRef<HTMLDivElement>(null);
  /** Bir sonraki çizimden sonra odağın gideceği yer; yerine getirilince temizlenir. */
  const odakIstegi = useRef<{ hedef: OdakHedefi; id: string } | null>(null);

  const secili = model.odalar.find((oda) => oda.id === seciliId) ?? null;
  const hazir = !loading && error === null;

  // Odak: tam sayfa ayrıntı açılınca başlığa, listeye dönünce odanın satırına. Geniş modül geç gelebilir: istek, hedef
  // belirene kadar bekler (her çizimden sonra denenir).
  useLayoutEffect(() => {
    const istek = odakIstegi.current;
    if (!istek) return;
    if (istek.hedef === 'baslik' && baslikRef.current) {
      baslikRef.current.focus();
      odakIstegi.current = null;
    } else if (istek.hedef === 'satir' && odaSatirinaOdaklan(icerikRef.current, istek.id)) {
      odakIstegi.current = null;
    }
  });

  const ac = (id: string, odak: OdakHedefi) => {
    if (id !== seciliId) setSekme('alimlar');
    setSeciliId(id);
    setSonAcilan(id);
    odakIstegi.current = odak === 'yok' ? null : { hedef: odak, id };
  };
  const kapat = (odak: OdakHedefi) => {
    const id = seciliId;
    setSeciliId(null);
    odakIstegi.current = id && odak !== 'yok' ? { hedef: odak, id } : null;
  };
  const seciciyiAc = () => {
    setSeciminDonusu(false);
    setSeciciAcik(true);
  };
  const seciciden = (id: string) => {
    setSeciminDonusu(true);
    setSeciciAcik(false);
    ac(id, 'baslik');
  };

  const ozet = useMemo<PageHeaderSummary[]>(() => [
    olcu('Oda', String(model.odaSayisi), model.odasizAlim > 0 ? `+${sayi(model.odasizAlim, 'alım')} odasız` : undefined),
    olcu('Planlanan', toplamMetni(model.planned, FIYAT_YOK), sayi(model.alimSayisi, 'alım')),
    olcu('Gerçekleşen', toplamMetni(model.actual, HENUZ_YOK), sayi(model.actual.counted, 'alımda')),
  ], [model]);

  const telefon = profil === 'phone';
  const odaVar = hazir && model.odaSayisi > 0;

  let icerik: ReactNode;
  if (error !== null) {
    icerik = <ErrorState message="Nesil okunamadı. Tutarlar, yanıltmaması için gösterilmiyor." detail={error} onRetry={() => void generation.refresh()} />;
  } else if (loading) {
    icerik = <LoadingShell rows={6} narrow={telefon} />;
  } else if (model.odaSayisi === 0) {
    icerik = (
      <EmptyState
        title="Kaynakta oda kaydı yok"
        message={`Bu nesilde oda kaydı yok; odalar e-tablonun ayarlar sayfasındaki oda satırlarından gelir.${model.odasizAlim > 0 ? ` Odaya bağlanmamış ${sayi(model.odasizAlim, 'alım')} var.` : ''}`}
      />
    );
  } else {
    const sunum: EvSunumProps = {
      model, secili, sekme, onSekme: setSekme, onAc: ac, onKapat: kapat, baslikRef, sonAcilan,
    };
    icerik = <Adaptive phone={<EvTelefon {...sunum} />} wide={<EvIkiBolme {...sunum} />} />;
  }

  return (
    <>
      <PageHeader
        location={LOCATION}
        purpose={adminLeads[LOCATION]}
        status={veriDurumu(generation)}
        summary={hazir ? ozet : undefined}
        primary={telefon && odaVar ? <Button variant="primary" iconEnd="chevronDown" onClick={seciciyiAc}>Oda seç</Button> : undefined}
      />
      <div ref={icerikRef} className="aile-ev" data-ev-gorunum={secili ? 'ayrinti' : 'liste'}>
        {icerik}
      </div>
      {telefon && odaVar ? (
        <OdaSecici
          open={seciciAcik}
          odalar={model.odalar}
          seciliId={seciliId}
          onSec={seciciden}
          onClose={() => setSeciciAcik(false)}
          returnFocusTo={seciminDonusu ? baslikRef : undefined}
        />
      ) : null}
    </>
  );
}
