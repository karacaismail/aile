import { useRef, type ReactNode } from 'react';
import { designTokens } from '../../../design/tokens.ts';
import { useProfile } from '../../adaptive/context';
import { useContainerWidth } from '../../device';
import type { RecordRow, ResponsiveColumn } from '../../shell/contracts';
import { FIYAT_YOK, HENUZ_YOK, Money } from '../../ui/Money';
import { ResponsiveTable, requiredTableWidth } from '../../ui/ResponsiveTable';
import { StatusText } from '../../ui/StatusText';
import { BosBolum, akordeonListesi, fotografMetni, isDurumu, sekmeEtiketi, type BagliListeCizici } from './bagliListeler';
import { sayi, tarihMetni, type AydinlatmaSatiri, type IsSatiri, type OdaOzeti } from './model';
import { OdaAdi, OdaSayimi, Toplam, type EvSunumProps } from './ortak';
import { OdaAyrinti } from './OdaAyrinti';
import './EvIkiBolme.wide.css';

// Ev ve odalar — geniş (tablet/masaüstü) sunum; yalnız lazyWide('ev-iki-bolme') ile, geniş profilde indirilir.
// Masaüstü ve alan yeterliyse iki bölme: solda oda tablosu, sağda ayrinti-genislik (384 px) oda paneli; panel açıkken
// tablo sıkı sütunlara (Oda · Planlanan · Gerçekleşen) geçer (README › Sayfa iskeleti 5). Alan dar ya da tablet ise
// ayrıntı listenin yerini alır ("Listeye dön") ve bağlı kayıtlar ResponsiveTable'dır (sığarsa tablo). Durum (seçili oda,
// sekme) EvPage'dedir; profil değişince sunum değişir, kullanıcı durumu korunur. Eşik ölçüyle verilir (useContainerWidth):
// sıkı tablonun gereken genişliği + bosluk-6 + ayrinti-genislik; ölçüm gelmeden (0) masaüstünde iki bölme.

const tamSutunlar: readonly ResponsiveColumn<OdaOzeti>[] = [
  { key: 'label', title: 'Oda', minWidth: 180, m: 'title', render: (oda) => <OdaAdi oda={oda} /> },
  { key: 'code', title: 'Kod', minWidth: 110, m: 'meta' },
  { key: 'asama', title: 'Aşama', minWidth: 150, m: 'status', render: (oda) => <StatusText label={oda.asama} /> },
  { key: 'alim', title: 'Alım', minWidth: 100, render: (oda) => sayi(oda.alimlar.length, 'alım') },
  { key: 'acikIs', title: 'Açık iş', minWidth: 110, render: (oda) => sayi(oda.acikIs, 'açık iş') },
  { key: 'planned', title: 'Planlanan', align: 'right', minWidth: 140, m: 'lead', render: (oda) => <Toplam total={oda.planned} eksik={FIYAT_YOK} /> },
  { key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 140, render: (oda) => <Toplam total={oda.actual} eksik={HENUZ_YOK} /> },
  { key: 'eksik', title: 'Eksik bilgi', minWidth: 170 },
];

const sikiSutunlar: readonly ResponsiveColumn<OdaOzeti>[] = [
  { key: 'label', title: 'Oda', minWidth: 160, m: 'title', render: (oda) => <OdaAdi oda={oda} /> },
  { key: 'planned', title: 'Planlanan', align: 'right', minWidth: 130, m: 'lead', render: (oda) => <Toplam total={oda.planned} eksik={FIYAT_YOK} /> },
  { key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 130, render: (oda) => <Toplam total={oda.actual} eksik={HENUZ_YOK} /> },
];

/** İki bölme için gereken içerik genişliği (CSS px): sıkı tablo + bölme aralığı + ayrıntı paneli. */
export const IKI_BOLME_ESIGI = requiredTableWidth(sikiSutunlar) + designTokens.bosluk6 + designTokens.ayrintiGenislik;

// --- Tablet / dar alan tam sayfa ayrıntısında bağlı kayıt tabloları -------------------------------------------------
const ad = <R extends RecordRow>(): ResponsiveColumn<R> => ({ key: 'label', title: 'Ad', minWidth: 200, m: 'title' });
const kod = <R extends RecordRow>(): ResponsiveColumn<R> => ({ key: 'code', title: 'Kod', minWidth: 120, m: 'meta' });
const durum = <R extends RecordRow>(): ResponsiveColumn<R> => ({
  key: 'status', title: 'Durum', minWidth: 150, m: 'status', render: (row) => <StatusText label={row.status.label} tone={row.status.tone} />,
});
const plan = <R extends RecordRow>(): ResponsiveColumn<R> => ({
  key: 'planned', title: 'Planlanan', align: 'right', minWidth: 140, m: 'lead', render: (row) => <Money value={row.planned} label={FIYAT_YOK} />,
});
const gercek = <R extends RecordRow>(): ResponsiveColumn<R> => ({
  key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 140, render: (row) => <Money value={row.actual} label={HENUZ_YOK} />,
});
const planTarihi = <R extends RecordRow>(title: string): ResponsiveColumn<R> => ({
  key: 'tarih', title, minWidth: 140, render: (row) => tarihMetni(row.dates?.planned, HENUZ_YOK),
});

const alimSutunlari: readonly ResponsiveColumn<RecordRow>[] = [
  ad(), kod(), durum(), plan(), gercek(), planTarihi('Planlanan tarih'),
  { key: 'foto', title: 'Fotoğraf', minWidth: 150, render: fotografMetni },
];
const isSutunlari: readonly ResponsiveColumn<IsSatiri>[] = [
  ad(), kod(), durum(), { key: 'acik', title: 'İş durumu', minWidth: 120, render: isDurumu }, plan(), gercek(), planTarihi('Planlanan tarih'),
];
const esyaSutunlari: readonly ResponsiveColumn<RecordRow>[] = [ad(), kod(), durum(), planTarihi('Yerleşim tarihi'), plan(), gercek()];
const aydinlatmaSutunlari: readonly ResponsiveColumn<AydinlatmaSatiri>[] = [
  ad(), kod(), durum(),
  { key: 'lumen', title: 'Lümen', align: 'right', minWidth: 110 },
  { key: 'renk', title: 'Renk sıcaklığı', align: 'right', minWidth: 140 },
  plan(), gercek(),
];

const tabloListesi: BagliListeCizici = (sekme, oda) => {
  const caption = sekmeEtiketi(sekme);
  let tablo: ReactNode = null;
  if (sekme === 'alimlar' && oda.alimlar.length) tablo = <ResponsiveTable<RecordRow> caption={caption} columns={alimSutunlari} rows={oda.alimlar} />;
  if (sekme === 'isler' && oda.isler.length) tablo = <ResponsiveTable<IsSatiri> caption={caption} columns={isSutunlari} rows={oda.isler} />;
  if (sekme === 'esyalar' && oda.esyalar.length) tablo = <ResponsiveTable<RecordRow> caption={caption} columns={esyaSutunlari} rows={oda.esyalar} />;
  if (sekme === 'aydinlatma' && oda.aydinlatma.length) tablo = <ResponsiveTable<AydinlatmaSatiri> caption={caption} columns={aydinlatmaSutunlari} rows={oda.aydinlatma} />;
  return tablo ?? <BosBolum sekme={sekme} oda={oda} />;
};

export default function EvIkiBolme({ model, secili, sekme, onSekme, onAc, onKapat, baslikRef }: EvSunumProps) {
  const profil = useProfile();
  const kokRef = useRef<HTMLDivElement>(null);
  const genislik = useContainerWidth(kokRef);
  const ikiBolme = profil === 'desktop' && (genislik === 0 || genislik >= IKI_BOLME_ESIGI);

  let icerik: ReactNode;
  if (ikiBolme) {
    icerik = (
      <>
        <div className="aile-ev-genis__liste">
          <OdaSayimi model={model} />
          <ResponsiveTable<OdaOzeti>
            caption="Odalar"
            columns={secili ? sikiSutunlar : tamSutunlar}
            rows={model.odalar}
            selectedKey={secili?.id}
            onRowClick={(oda) => onAc(oda.id, 'yok')}
            openLabel="Odayı aç"
          />
        </div>
        {secili ? (
          <OdaAyrinti
            oda={secili}
            sekme={sekme}
            onSekme={onSekme}
            baslikRef={baslikRef}
            yerlesim="panel"
            onDon={() => onKapat('satir')}
            liste={akordeonListesi}
            className="aile-ev-genis__panel"
          />
        ) : null}
      </>
    );
  } else if (secili) {
    icerik = (
      <OdaAyrinti oda={secili} sekme={sekme} onSekme={onSekme} baslikRef={baslikRef} yerlesim="sayfa" onDon={() => onKapat('satir')} liste={tabloListesi} />
    );
  } else {
    icerik = (
      <div className="aile-ev-genis__liste">
        <OdaSayimi model={model} />
        <ResponsiveTable<OdaOzeti> caption="Odalar" columns={tamSutunlar} rows={model.odalar} onRowClick={(oda) => onAc(oda.id, 'baslik')} openLabel="Odayı aç" />
      </div>
    );
  }

  return (
    <div ref={kokRef} className={`aile-ev-genis${ikiBolme ? ' aile-ev-genis--iki' : ''}${ikiBolme && secili ? ' aile-ev-genis--secili' : ''}`}>
      {icerik}
    </div>
  );
}
