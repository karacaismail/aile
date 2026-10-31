import { value } from '../finance-engine/cells.mjs';

/** Classification is source metadata only; it never changes dates or amounts. */
export function purchaseGroupTypes(rows) {
  const categories = new Map();
  for (const row of rows) {
    const key = value(row?.[15]);
    if (!key) continue;
    if (categories.has(key)) throw new Error('Duplicate purchase identity');
    const category = String(value(row[2]) ?? '').trim();
    categories.set(key, category === 'Taşınmadan önce' ? 'Alışveriş · Taşınma öncesi'
      : category === 'Taşınma sonrası Eşya yenileme' ? 'Alışveriş · Taşınma sonrası' : 'Alışveriş');
  }
  return event => {
    if (!['cash', 'purchase'].includes(event.type)) return undefined;
    const key = event.id.startsWith('candidate-') ? event.id.slice(10) : event.id.replace(/-\d+$/, '');
    return categories.get(key);
  };
}
