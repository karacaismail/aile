import { syntheticTimeline, syntheticLongTimeline } from '../src/timeline/fixtures';
import { syntheticFinance } from '../src/finance/fixtures';
import { financeRanges } from '../src/finance/contract';
import { gviz } from '../src/dashboard/fixtures';

// Preserve the existing synthetic UX scenarios while serving the new native
// contract. This adapter is test-only and does not consume the old validator.
export { syntheticTimeline, syntheticLongTimeline };
export function timelineResponse(url: string, table: ReturnType<typeof syntheticTimeline>) {
  const source = syntheticFinance();
  source.daily.rows = table.rows.map((row, index, all) => {
    const net = Number(row[9]);
    const card = Number(row[10]) + Number(row[11]);
    return [row[1], row[4], row[3], index ? net - Number(all[index - 1][9]) : 0, net, Math.max(0, net), 0, 0, row[10], 0, row[11], 0, 0, card, Math.max(0, -net), row[13], `${row[5]} · ${row[14] || 'Sentetik kaynak açıklaması'}`, row[0]];
  });
  const months = [...new Set(table.rows.map(row => String(row[16])))];
  source.monthly.rows = months.map(month => {
    const last = source.daily.rows.findLast(row => String(row[0]).startsWith(month))!;
    return [month, last[5], last[6], last[7], last[13], last[12], 0, Number(last[4]) - Number(last[7]) - Number(last[13]), last[14]];
  });
  source.metadata.rows[3] = [String(source.daily.rows.length)];
  source.metadata.rows[4] = [String(months.length)];
  const params = new URL(url).searchParams;
  if (params.get('sheet') !== 'Finansman') throw new Error('Unexpected financial feed');
  const key = Object.entries(financeRanges).find(([, value]) => value === params.get('range'))?.[0] as keyof typeof source;
  if (!key) throw new Error('Unexpected finance range');
  return gviz(source[key].rows, source[key].labels);
}
