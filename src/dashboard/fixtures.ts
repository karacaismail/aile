// Only synthetic values. Never replace with a downloaded family spreadsheet.
export function syntheticSheets() {
  const months = ['Kasım 2098', 'Aralık 2098', 'Ocak 2099'];
  const grid: (string | number | null)[][] = Array.from({ length: 63 }, () => Array(15).fill(null));
  const labels: Record<number, string> = {
    12: 'Gelir A', 13: 'Gelir B', 14: 'Destek', 15: 'Diğer', 16: 'TOPLAM GELİR',
    18: 'BORÇ VE VERGİ', 19: 'Ödeme A', 25: 'Borç ve vergi toplamı', 27: 'FATURALAR',
    28: 'Fatura A', 36: 'Faturalar toplamı', 38: 'EV', 39: 'Aidat', 40: 'Kira', 42: 'Ev toplamı',
    44: 'OKUL', 45: 'Okul A', 48: 'Okul toplamı', 50: 'GÜNLÜK YAŞAM', 51: 'Günlük A',
    56: 'Günlük yaşam toplamı', 57: 'DÜZENSİZ GİDERLER', 59: 'Tek seferlik + taşınma + özel gün', 62: 'TOPLAM ÖDEMELER', 63: 'BİRİKİM · HARCAMA DEĞİLDİR',
    65: 'EUR adet', 66: 'EUR karşılığı', 67: 'USD adet', 68: 'USD karşılığı',
    69: 'Birikim A', 70: 'Diğer birikim', 71: 'Çekilen', 72: 'NET BİRİKİM', 74: 'SERBEST NAKİT',
  };
  Object.entries(labels).forEach(([row, label]) => { grid[+row - 12][0] = label; });
  for (let m = 1; m <= months.length; m++) {
    for (const row of [12,13,14,15,16,19,25,28,36,39,40,42,45,48,51,56,59,62,66,68,69,70,71,72,74]) grid[row - 12][m] = 0;
    grid[0][m] = grid[4][m] = 10000;
    grid[28 - 12][m] = grid[36 - 12][m] = grid[62 - 12][m] = 4000;
    grid[69 - 12][m] = grid[72 - 12][m] = 2000;
    grid[74 - 12][m] = 4000;
  }
  grid[59-12][2]=500;grid[62-12][2]=4500;grid[74-12][2]=3500;
  return {
    summary: months.map((m, i) => [m, 'Plandan', 10000, 10000, i===1?4500:4000, i===1?4500:4000, 2000, 2000, i===1?3500:4000, i===1?3500:4000, (i + 1) * 4000-(i>0?500:0), (i + 1) * 4000-(i>0?500:0)]),
    plan: grid,
    actual: structuredClone(grid),
    irregular: [
      ['Uzun açıklamalı örnek mobilya / çalışma odası', 'Taşınma', months[1], 500, 500, months[1], 'Planlı', 0, 'Çalışma odası', 1, 500, '1', '', '', 'TEST-1', 0],
      ['Fiyatı beklenen ürün', 'Taşınma', months[1], null, null, months[1], 'Karar bekliyor', null, 'Salon', 1, null, '1', '', '', 'TEST-2', 0],
      ['İptal edilen ürün', 'Tek seferlik', months[1], 0, 0, months[1], 'İptal', 0, '', 1, 50, '', '', '', 'TEST-3', 0],
    ],
  };
}

export function gviz(rows: unknown[][], labels?: string[]) {
  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols: Array.from({ length: rows[0]?.length ?? 0 }, (_, i) => ({ id: String(i), label: labels?.[i] ?? '' })), rows: rows.map(row => ({ c: row.map(v => v === null ? null : { v }) })) } })});`;
}
