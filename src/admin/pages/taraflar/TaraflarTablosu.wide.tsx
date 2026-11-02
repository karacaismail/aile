import type { ResponsiveColumn } from '../../shell/contracts';
import { FIYAT_YOK, Money } from '../../ui/Money';
import { ResponsiveTable } from '../../ui/ResponsiveTable';
import { Iletisim } from './Iletisim';
import type { Taraf } from './model';
import { ADI_BILINMIYOR, BILINMIYOR, garantiMetni, mykMetni, sureMetni } from './sunum';

// Geniş (tablet/masaüstü) taraflar tablosu — tasarım bundle.js Aile.Pages.Taraflar › Taraflar ResponsiveTable. Masaüstünde
// tablo (ilk sütun yapışkan, tablo kendi içinde yatay kayar); tablette sığmazsa akordeon. Yalnız geniş profilde yüklenir.
// Tutar sütunu addan hemen sonra (README › Tablo). İletişim sütunu yerel tel:/WhatsApp bağlantıları.

const SUTUNLAR: readonly ResponsiveColumn<Taraf>[] = [
  { key: 'ad', title: 'Taraf', minWidth: 200, m: 'title', render: (taraf) => taraf.ad ?? ADI_BILINMIYOR },
  { key: 'teklif', title: 'Teklif', align: 'right', minWidth: 136, m: 'lead', render: (taraf) => <Money value={taraf.teklif} label={FIYAT_YOK} /> },
  { key: 'meslek', title: 'Meslek', minWidth: 120, m: 'meta', render: (taraf) => taraf.meslek ?? BILINMIYOR },
  { key: 'sure', title: 'Teklif süresi', minWidth: 120, render: (taraf) => sureMetni(taraf.sureGun) },
  { key: 'garanti', title: 'Garanti', minWidth: 104, render: (taraf) => garantiMetni(taraf.garantiAy) },
  { key: 'myk', title: 'MYK belgesi', minWidth: 128, render: (taraf) => mykMetni(taraf.myk) },
  { key: 'iletisim', title: 'İletişim', minWidth: 216, render: (taraf) => <Iletisim ad={taraf.ad} telefon={taraf.telefon} iletisim={taraf.iletisim} /> },
];

export interface TaraflarTablosuProps {
  taraflar: readonly Taraf[];
}

export default function TaraflarTablosu({ taraflar }: TaraflarTablosuProps) {
  return <ResponsiveTable columns={SUTUNLAR} rows={taraflar} caption="Taraflar" mobileCaption={`${taraflar.length} taraf`} />;
}
