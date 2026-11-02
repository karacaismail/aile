import type { ReactNode } from 'react';
import type { AccordionItem, RecordRow } from '../../shell/contracts';
import { AccordionList } from '../../ui/AccordionList';
import { EmptyState } from '../../ui/EmptyState';
import { FIYAT_YOK, HENUZ_YOK, Money } from '../../ui/Money';
import { StatusText } from '../../ui/StatusText';
import { FOTOGRAF_YOK, SEKMELER, tarihMetni, type AydinlatmaSatiri, type IsSatiri, type OdaOzeti, type Sekme } from './model';

// Odaya bağlı kayıtlar (Alımlar · İşler · Eşyalar · Aydınlatma). Telefonda ve masaüstü yan panelinde (dar alan) akordeon:
// ilk satır açık, başlıkta ad · kod · durum · planlanan; gövdede plan ve gerçek AYRI etiketlerle, eksik bilgi adıyla.
// Tablet tam sayfa ayrıntısındaki tablo sürümü geniş modüldedir (EvIkiBolme.wide.tsx).

export type BagliListeCizici = (sekme: Sekme, oda: OdaOzeti) => ReactNode;

export const sekmeEtiketi = (sekme: Sekme) => SEKMELER.find((item) => item.key === sekme)!.label;

const BOS: Record<Sekme, { tur: string; odasiz: string }> = {
  alimlar: { tur: 'alım', odasiz: 'Odası bilinmeyen alım yok' },
  isler: { tur: 'iş', odasiz: 'Odası bilinmeyen iş yok' },
  esyalar: { tur: 'eşya', odasiz: 'Odası bilinmeyen eşya yok' },
  aydinlatma: { tur: 'aydınlatma', odasiz: 'Odası bilinmeyen aydınlatma kaydı yok' },
};

/** Sekmede kayıt yoksa dürüst metin: "Bu odada eşya kaydı yok". */
export function BosBolum({ sekme, oda }: { sekme: Sekme; oda: OdaOzeti }) {
  const bos = BOS[sekme];
  return oda.odasiz
    ? <EmptyState title={bos.odasiz} message="Kaynakta odası boş bırakılmış bu türde kayıt bulunmadı." />
    : <EmptyState title={`Bu odada ${bos.tur} kaydı yok`} message={`Kaynakta bu odaya bağlı ${bos.tur} kaydı bulunmadı.`} />;
}

export const fotografMetni = (row: RecordRow) => (row.photo?.verified ? 'Doğrulanmış fotoğraf var' : FOTOGRAF_YOK);
export const isDurumu = (row: IsSatiri) => (row.acik ? 'Açık' : 'Kapandı');

const planlanan = (row: RecordRow): [ReactNode, ReactNode] => ['Planlanan', <Money value={row.planned} label={FIYAT_YOK} />];
const gerceklesen = (row: RecordRow): [ReactNode, ReactNode] => ['Gerçekleşen', <Money value={row.actual} label={HENUZ_YOK} />];

function kalem(row: RecordRow, body: [ReactNode, ReactNode][]): AccordionItem {
  return {
    key: row.id,
    title: row.label,
    meta: row.code,
    status: <StatusText label={row.status.label} tone={row.status.tone} />,
    lead: <Money value={row.planned} label={FIYAT_YOK} />,
    body,
  };
}

function kalemler(sekme: Sekme, oda: OdaOzeti): AccordionItem[] {
  switch (sekme) {
    case 'alimlar':
      return oda.alimlar.map((row) => kalem(row, [planlanan(row), gerceklesen(row), ['Planlanan tarih', tarihMetni(row.dates?.planned, HENUZ_YOK)], ['Fotoğraf', fotografMetni(row)]]));
    case 'isler':
      return oda.isler.map((row) => kalem(row, [['İş durumu', isDurumu(row)], planlanan(row), gerceklesen(row), ['Planlanan tarih', tarihMetni(row.dates?.planned, HENUZ_YOK)]]));
    case 'esyalar':
      return oda.esyalar.map((row) => kalem(row, [['Yerleşim tarihi', tarihMetni(row.dates?.planned, HENUZ_YOK)], planlanan(row), gerceklesen(row)]));
    case 'aydinlatma':
      return oda.aydinlatma.map((row: AydinlatmaSatiri) => kalem(row, [['Lümen', row.lumen], ['Renk sıcaklığı', row.renk], planlanan(row), gerceklesen(row)]));
  }
}

/** Telefon ve yan panel: akordeon (ilk satır açık); bölge adı sekme etiketi. */
export const akordeonListesi: BagliListeCizici = (sekme, oda) => {
  const items = kalemler(sekme, oda);
  if (items.length === 0) return <BosBolum sekme={sekme} oda={oda} />;
  return <AccordionList caption={sekmeEtiketi(sekme)} items={items} />;
};
