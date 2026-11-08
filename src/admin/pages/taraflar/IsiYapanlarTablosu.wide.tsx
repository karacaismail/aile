import type { ResponsiveColumn } from '../../shell/contracts';
import { ResponsiveTable } from '../../ui/ResponsiveTable';
import { isKimEtiketi, type Aday, type AdayAlani } from './model';

// Geniş (tablet/masaüstü) "İşi yapanlar" tablosu. İş emirlerindeki İşi yapan (is_kim) ve usta metninden; taraf kaydına
// bağ değildir. Yalnız geniş profilde lazyWide ile yüklenir; telefon düz listeyi (listeler.tsx) kullanır.

interface Satir { key: string; ad: string; alan: string; sayi: number; isler: string }

const ALAN: Record<AdayAlani, string> = { is_kim: 'İşi yapan', usta: 'Usta' };

const SUTUNLAR: readonly ResponsiveColumn<Satir>[] = [
  { key: 'ad', title: 'İşi yapan', minWidth: 200, m: 'title' },
  { key: 'sayi', title: 'İş sayısı', align: 'right', minWidth: 96, m: 'lead', render: (satir) => <span className="aile-tutar">{satir.sayi}</span> },
  { key: 'alan', title: 'Kaynak alan', minWidth: 120, m: 'meta' },
  { key: 'isler', title: 'İşler', minWidth: 240, m: 'body' },
];

export interface IsiYapanlarTablosuProps {
  adaylar: readonly Aday[];
}

export default function IsiYapanlarTablosu({ adaylar }: IsiYapanlarTablosuProps) {
  const rows = adaylar.map((aday): Satir => ({
    key: aday.ad,
    ad: aday.alanlar.includes('is_kim') ? isKimEtiketi(aday.ad) : aday.ad,
    alan: aday.alanlar.map((alan) => ALAN[alan]).join(' · '),
    sayi: aday.isler.length,
    isler: aday.isler.join(', '),
  }));
  return <ResponsiveTable columns={SUTUNLAR} rows={rows} caption="İşi yapanlar" mobileCaption={`${rows.length} işi yapan`} />;
}
