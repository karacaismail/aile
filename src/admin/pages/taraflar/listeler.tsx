import type { ReactNode } from 'react';
import type { AccordionItem } from '../../shell/contracts';
import { AccordionList } from '../../ui/AccordionList';
import { FIYAT_YOK, HENUZ_YOK, Money } from '../../ui/Money';
import { Tag } from '../../ui/Tag';
import { Iletisim } from './Iletisim';
import { isKimEtiketi, type Aday, type Taraf, type TeklifGrubu } from './model';
import {
  ADI_BILINMIYOR, BILINMIYOR, MESLEK_BILINMIYOR, TARAF_BILINMIYOR, garantiMetni, grupBasligi, mykMetni, sureMetni,
} from './sunum';

// Telefon (temel) sunumu: README "Uyarlanır teslim" — tablolar akordeon, ilk satır açık; ≤3 anlamlı sütunlu liste düz.
// Geniş profilde de geniş modül yüklenene ya da yüklenemezse bu sunum kullanılır (Adaptive fallback). Yalnız yerel
// HTML + ui/AccordionList; antd, echarts ya da geniş-özel kod yok.

type Govde = [ReactNode, ReactNode][];

/** Teklifler: kayıt başına grup (h3); satır = teklif. Plan ve gerçek kaydındır, teklifle birleşmez. */
export function TekliflerListesi({ gruplar }: { gruplar: readonly TeklifGrubu[] }) {
  const items: AccordionItem[] = gruplar.flatMap((grup) =>
    grup.teklifler.map((teklif): AccordionItem => {
      const body: Govde = [['Teklif', <Money value={teklif.tutar} />]];
      if (grup.durum === 'bagli') {
        body.push(['Planlanan', <Money value={grup.plan} label={FIYAT_YOK} />], ['Gerçekleşen', <Money value={grup.gercek} label={HENUZ_YOK} />]);
      }
      body.push(
        ['Süre', sureMetni(teklif.sureGun)],
        ['Garanti', garantiMetni(teklif.garantiAy)],
        ['Telefon', teklif.telefon ?? BILINMIYOR],
        ['İletişim', <Iletisim ad={teklif.tarafAdi} telefon={teklif.telefon} iletisim={teklif.iletisim} />],
      );
      return {
        key: teklif.key,
        title: teklif.tarafAdi ?? TARAF_BILINMIYOR,
        status: teklif.key === grup.enDusukKey ? <Tag tone="olumlu">En düşük fiyat</Tag> : undefined,
        lead: <Money value={teklif.tutar} />,
        body,
        group: grupBasligi(grup),
      };
    }),
  );
  return <AccordionList items={items} caption={`${items.length} teklif`} />;
}

/** Taraflar (usta/satıcı): kapalı satırda ad, meslek ve teklif; açılınca telefon, iletişim bağlantıları ve kaynak. */
export function TaraflarListesi({ taraflar }: { taraflar: readonly Taraf[] }) {
  const items = taraflar.map((taraf): AccordionItem => ({
    key: taraf.id,
    title: taraf.ad ?? ADI_BILINMIYOR,
    meta: taraf.meslek ?? MESLEK_BILINMIYOR,
    lead: <Money value={taraf.teklif} label={FIYAT_YOK} />,
    body: [
      ['Telefon', taraf.telefon ?? BILINMIYOR],
      ['İletişim', <Iletisim ad={taraf.ad} telefon={taraf.telefon} iletisim={taraf.iletisim} />],
      ['Teklif süresi', sureMetni(taraf.sureGun)],
      ['Garanti', garantiMetni(taraf.garantiAy)],
      ['MYK belgesi', mykMetni(taraf.myk)],
      ['Kaynak', taraf.kaynak ?? taraf.kod ?? BILINMIYOR],
    ],
  }));
  return <AccordionList items={items} caption={`${items.length} taraf`} />;
}

/** İşi yapanlar: üç anlamlı alan (ad, işler, sayı) → düz liste, açılma yok. */
export function IsiYapanlarListesi({ adaylar }: { adaylar: readonly Aday[] }) {
  const items = adaylar.map((aday): AccordionItem => ({
    key: aday.ad,
    title: aday.alanlar.includes('is_kim') ? isKimEtiketi(aday.ad) : aday.ad,
    meta: aday.isler.join(', '),
    lead: `${aday.isler.length} iş`,
  }));
  return <AccordionList items={items} caption={`${items.length} işi yapan`} />;
}
