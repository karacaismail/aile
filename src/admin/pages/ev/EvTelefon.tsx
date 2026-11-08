import type { AccordionItem } from '../../shell/contracts';
import { AccordionList } from '../../ui/AccordionList';
import { FIYAT_YOK, HENUZ_YOK } from '../../ui/Money';
import { StatusText } from '../../ui/StatusText';
import { akordeonListesi } from './bagliListeler';
import { sayi, type OdaOzeti } from './model';
import { OdaAdi, OdaSayimi, Toplam, type EvSunumProps } from './ortak';
import { OdaAyrinti } from './OdaAyrinti';

// Telefon (temel) sunumu: geniş modül beklerken ve telefon profilinde çizilir. Oda listesi akordeondur (ilk satır
// açık; listeye dönünce son açılan oda açık gelir), başlıkta ad · kod · sayımlar · aşama · planlanan; gövdede plan ve
// gerçek ayrı etiketlerle, eksik bilgi adıyla, "Odayı aç". Seçili oda listenin yerini alır (tam sayfa, "Listeye dön").
// Tablo, antd ya da geniş-özel kod yoktur.

function odaKalemi(oda: OdaOzeti, onAc: (id: string) => void): AccordionItem {
  return {
    key: oda.id,
    title: <OdaAdi oda={oda} />,
    meta: `${oda.code} · ${sayi(oda.alimlar.length, 'alım')} · ${oda.acikIs} açık iş`,
    status: <StatusText label={`Aşama: ${oda.asama}`} />,
    lead: <Toplam total={oda.planned} eksik={FIYAT_YOK} />,
    body: [
      ['Planlanan', <Toplam total={oda.planned} eksik={FIYAT_YOK} />],
      ['Gerçekleşen', <Toplam total={oda.actual} eksik={HENUZ_YOK} />],
      ['İş', `${sayi(oda.isler.length, 'iş')} (${oda.acikIs} açık)`],
      ['Eksik bilgi', oda.eksik],
    ],
    onOpen: () => onAc(oda.id),
  };
}

export function EvTelefon({ model, secili, sekme, onSekme, onAc, onKapat, baslikRef, sonAcilan }: EvSunumProps) {
  if (secili) {
    return (
      <OdaAyrinti
        oda={secili}
        sekme={sekme}
        onSekme={onSekme}
        baslikRef={baslikRef}
        yerlesim="sayfa"
        onDon={() => onKapat('satir')}
        liste={akordeonListesi}
      />
    );
  }
  const acik = sonAcilan && model.odalar.some((oda) => oda.id === sonAcilan) ? [sonAcilan] : undefined;
  return (
    <div className="aile-ev-liste">
      <OdaSayimi model={model} />
      <AccordionList
        caption="Odalar"
        items={model.odalar.map((oda) => odaKalemi(oda, (id) => onAc(id, 'baslik')))}
        defaultOpenKeys={acik}
        openLabel="Odayı aç"
      />
    </div>
  );
}
