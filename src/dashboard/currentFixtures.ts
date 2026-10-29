import type { CurrentBudgetRaw } from './current';
import type { Cell, Grid } from './data';

// Synthetic schema fixture only. Never copy personal budgets into this file.
export function syntheticCurrentSheets(): CurrentBudgetRaw {
  const labels = ['Kasım 2098', 'Aralık 2098', 'Ocak 2099'];
  const dates: Cell[] = [(Date.UTC(2098, 10, 1) - Date.UTC(1899, 11, 30)) / 86400000, 'Date(2098,11,1)', "Oc'99"];
  const row = (label: string, values = [0, 0, 0]): Cell[] => [label, ...values];
  const plan: Grid = [
    ['Kalem', ...dates], ['GELİR'], row('Gelir A', [10000, 10000, 10000]), row('TOPLAM GELİR', [10000, 10000, 10000]),
    ['BORÇ VE VERGİ'], row('Ödeme A'), row('Borç ve vergi toplamı'),
    ['FATURALAR'], row('Fatura A', [4000, 4000, 4000]), row('Faturalar toplamı', [4000, 4000, 4000]),
    ['EV'], row('Kira'), row('Ev toplamı'), ['OKUL'], row('Okul A'), row('Okul toplamı'),
    ['GÜNLÜK YAŞAM'], row('Günlük A'), row('Günlük yaşam toplamı'), ['DÜZENSİZ GİDERLER'], row('Arızi alışveriş toplamı', [0, 500, 0]),
    row('Kasadan çıkan · brüt', [4000, 4500, 4000]), ['BİRİKİM'], row('EUR alımı · miktarı', [10, 10, 10]), row('USD alımı · miktarı', [10, 10, 10]), row('Altın · ayrılan TL', [1000, 1000, 1000]),
    row('KASA · aylık net hareket', [4000, 3500, 4000]), row('NAKİTTE KALAN · ay sonu', [4000, 7500, 11500]),
  ];
  const cashBlock: Grid = [row('Gelir', [10000, 10000, 10000]), row('BRÜT NAKİT ÇIKIŞI', [4000, 4500, 4000]), row('Birikim alımları · TL', [2000, 2000, 2000]), row('AYLIK NET NAKİT', [4000, 3500, 4000]), row('AY SONU NAKİT', [4000, 7500, 11500])];
  return {
    plan, actual: structuredClone(plan), cash: [[null, ...dates], ...cashBlock, ...structuredClone(cashBlock)],
    summary: labels.map((label, i) => [label, 'Plandan', 10000, 10000, i === 1 ? 4500 : 4000, i === 1 ? 4500 : 4000, 2000, 2000, i === 1 ? 3500 : 4000, i === 1 ? 3500 : 4000, [4000, 7500, 11500][i], [4000, 7500, 11500][i]]),
    irregular: [
      ['Gider / açıklama', 'Kategori', 'Durum', 'Planlanan tarih', 'Ödeme tarihi', 'Plan', 'Gerçekleşen', 'Fark', 'Yer / Bölüm', 'Plan girdisi', 'Not', 'Kaynak / ürün', 'Kayıt kimliği', 'Elle değişti', 'Kasa kimliği'],
      ['Örnek mobilya', 'Taşınma', 'Planlı', '2098-12-01', 'Date(2098,11,10)', 500, 500, 0, 'Çalışma odası', 500, 'Örnek not', '', 'record-1', 1, 'TEST-1'],
      ['Fiyatı beklenen ürün', 'Taşınma', 'Karar bekliyor', '2098-12-01', '2098-12-10', null, null, null, 'Salon', null, '', '', 'record-2', 0, 'TEST-2'],
      ['İptal edilen ürün', 'Tek seferlik', 'İptal', '2098-12-01', '2098-12-10', 0, 0, 0, '', 50, '', '', 'record-3', 0, 'TEST-3'],
    ],
  };
}
