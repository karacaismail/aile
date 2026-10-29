import { TIMELINE_HEADERS, type TimelineTable } from './contract';

const row = (id: string, date: string, order: number, type: string, cashChange: number, bankChange: number, cash: number, debt: number, certainty = 'Teyitli plan') => [id, date, order, type, `Adım ${id}`, 'Örnek kaynak', cashChange, bankChange, 0, cash, debt, 0, debt, certainty, '', 0, date.slice(0, 7)];
export function syntheticTimeline(): TimelineTable {
  return { labels: [...TIMELINE_HEADERS], rows: [
    row('opening', '2098-11-01', 1, 'Başlangıç', 0, 100, 0, 100),
    row('income', '2098-11-10', 1, 'Gelir', 1000, 0, 1000, 100, 'Tarih varsayımı'),
    row('purchase', '2098-11-11', 1, 'Alışveriş', 0, 400, 1000, 500),
    row('payment', '2098-11-27', 1, 'Kart ödemesi', -200, -200, 800, 300),
    row('control', '2098-11-30', 99, 'Kontrol', 0, 0, 800, 300, 'Ay sonu kontrolü'),
    row('rent', '2098-12-01', 1, 'Gider', -900, 0, -100, 300, 'Tarih varsayımı'),
    row('income-next', '2098-12-10', 1, 'Gelir', 1000, 0, 900, 300),
    row('control-next', '2098-12-31', 99, 'Kontrol', 0, 0, 900, 300, 'Ay sonu kontrolü'),
  ] };
}

export function syntheticLongTimeline(): TimelineTable {
  const rows: TimelineTable['rows'] = [];
  for (let month = 0; month < 26; month++) {
    const start = new Date(Date.UTC(2098, 10 + month, 1));
    const period = start.toISOString().slice(0, 7);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const count = month < 14 ? 28 : 27;
    for (let step = 0; step < count; step++) {
      const opening = month === 0 && step === 0, control = step === count - 1;
      const date = control ? end : `${period}-${String(step + 1).padStart(2, '0')}`;
      rows.push([`LONG-${month}-${step}`, date, 1, opening ? 'Başlangıç' : control ? 'Kontrol' : 'Gider', `Örnek adım ${rows.length + 1}`, 'Sentetik tahmin', opening ? 1234567 : 0, opening ? 654321 : 0, 0, 1234567, 654321, 0, 654321, control ? 'Ay sonu kontrolü' : 'Tarih varsayımı', 'İleri dönem için düzenlenebilir tahmin.', 0, period]);
    }
  }
  return { labels: [...TIMELINE_HEADERS], rows };
}
