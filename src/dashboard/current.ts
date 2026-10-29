import type { Budget, Category, Cell, Grid, Irregular, Month } from './data';

const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const aliases = [['oc', 'oca'], ['şub'], ['mar'], ['nis'], ['may'], ['haz'], ['tem'], ['ağu'], ['eyl'], ['eki'], ['kas'], ['ar', 'ara']];
const text = (value: Cell | undefined) => value == null ? '' : String(value).trim();
const lower = (value: Cell | undefined) => text(value).toLocaleLowerCase('tr');
const number = (value: Cell | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const required = (value: Cell | undefined) => { const result = number(value); if (result === null) throw new Error('Zorunlu bütçe tutarı eksik veya hatalı; son tutarlı veriler korunuyor.'); return result; };
const optionalMoney = (value: Cell | undefined) => value == null || value === '' ? null : required(value);
const mismatch = () => { throw new Error('Bütçe sekmeleri henüz tutarlı değil. Son başarılı veriler korunuyor.'); };

export function sheetMonthKey(value: Cell | undefined): string {
  let date: Date | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  if (typeof value === 'string') {
    const gviz = /^Date\((\d{4}),(\d{1,2}),(\d{1,2})(?:,[\d,]+)?\)$/.exec(value);
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (gviz || iso) {
      const matched = gviz ?? iso!;
      const year = +matched[1], month = +matched[2] - (iso ? 1 : 0), day = +matched[3];
      date = new Date(Date.UTC(year, month, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) date = undefined;
    } else {
      const label = /^([\p{L}]+)[\s'’]+(\d{2}|\d{4})$/u.exec(value.trim().toLocaleLowerCase('tr'));
      if (label) {
        const month = monthNames.findIndex((name, i) => name.toLocaleLowerCase('tr') === label[1] || aliases[i].includes(label[1]));
        if (month >= 0) date = new Date(Date.UTC(label[2].length === 2 ? 2000 + +label[2] : +label[2], month, 1));
      }
    }
  }
  if (!date || !Number.isFinite(date.getTime())) throw new Error('Ay başlıkları veya gider tarihleri doğrulanamadı.');
  return date.toISOString().slice(0, 7);
}
const labelFor = (key: string) => `${monthNames[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`;
const oneRow = (rows: Grid, pattern: RegExp) => {
  const found = rows.filter(row => pattern.test(lower(row[0])));
  if (found.length !== 1) throw new Error('E-tablo şeması değişmiş; bütçe satırı doğrulanamadı.');
  return found[0];
};
export const isCurrentBudget = (rows: Grid) => rows.some(row => /^kasadan çıkan\s*·\s*brüt$/.test(lower(row[0])));
export type CurrentBudgetRaw = { summary: Grid; plan: Grid; actual: Grid; cash: Grid; irregular: Grid };

export function buildCurrentBudget(raw: CurrentBudgetRaw): Budget {
  const header = oneRow(raw.plan, /^kalem$/);
  const activeHeaders = header.slice(1);
  while (activeHeaders.length && (activeHeaders.at(-1) == null || activeHeaders.at(-1) === '')) activeHeaders.pop();
  if (!activeHeaders.length) throw new Error('Bütçe ayları eksik.');
  const keys = activeHeaders.map(sheetMonthKey);
  keys.forEach((key, i) => {
    if (i > 0 && new Date(Date.UTC(Number(keys[i - 1].slice(0, 4)), Number(keys[i - 1].slice(5)), 1)).toISOString().slice(0, 7) !== key) mismatch();
  });
  const actualHeader = oneRow(raw.actual, /^kalem$/);
  if (keys.some((key, i) => sheetMonthKey(actualHeader[i + 1]) !== key)) mismatch();
  if (!raw.cash[0] || keys.some((key, i) => sheetMonthKey(raw.cash[0][i + 1]) !== key)) mismatch();
  const summaryRows = raw.summary.filter(row => /^\S+ \d{4}$/.test(text(row[0])));
  if (summaryRows.length !== keys.length) mismatch();
  const months = summaryRows.map((row, i): Month => {
    if (sheetMonthKey(row[0]) !== keys[i]) mismatch();
    return { label: labelFor(keys[i]), key: keys[i], source: text(row[1]), income: { plan: required(row[2]), current: required(row[3]) }, expense: { plan: required(row[4]), current: required(row[5]) }, saving: { plan: required(row[6]), current: required(row[7]) }, free: { plan: required(row[8]), current: required(row[9]) }, balance: { plan: required(row[10]), current: required(row[11]) } };
  });
  const pairRows = (pattern: RegExp) => {
    const rows = raw.cash.filter(row => pattern.test(lower(row[0])));
    if (rows.length !== 2) throw new Error('Kasa plan/güncel satırları doğrulanamadı.');
    return rows;
  };
  for (const [field, pattern] of [['income', /^gelir$/], ['expense', /^brüt nakit çıkışı$/], ['saving', /^birikim alımları\s*·\s*tl$/], ['free', /^aylık net nakit$/], ['balance', /^ay sonu nakit$/]] as const) {
    const rows = pairRows(pattern);
    months.forEach((month, i) => { if (Math.abs(month[field].plan - required(rows[0][i + 1])) > .05 || Math.abs(month[field].current - required(rows[1][i + 1])) > .05) mismatch(); });
  }
  for (const [field, pattern] of [['income', /^toplam gelir$/], ['expense', /^kasadan çıkan\s*·\s*brüt$/], ['free', /^kasa\s*·\s*aylık net hareket$/], ['balance', /^nakitte kalan\s*·\s*ay sonu$/]] as const) {
    const plan = oneRow(raw.plan, pattern), actual = oneRow(raw.actual, pattern);
    months.forEach((month, i) => { if (Math.abs(month[field].plan - required(plan[i + 1])) > .05 || Math.abs(month[field].current - required(actual[i + 1])) > .05) mismatch(); });
  }
  const definitions = [
    { label: 'Gelir', start: /^gelir$/, end: /^toplam gelir$/, kind: 'income' },
    { label: 'Borç ve vergi', start: /^borç ve vergi$/, end: /^borç ve vergi toplamı$/, kind: 'expense' },
    { label: 'Faturalar', start: /^faturalar$/, end: /^faturalar toplamı$/, kind: 'expense' },
    { label: 'Ev', start: /^ev$/, end: /^ev toplamı$/, kind: 'expense' },
    { label: 'Okul', start: /^okul$/, end: /^okul toplamı$/, kind: 'expense' },
    { label: 'Günlük yaşam', start: /^günlük yaşam$/, end: /^günlük yaşam toplamı$/, kind: 'expense' },
    { label: 'Düzensiz giderler', start: /^düzensiz giderler$/, end: /^arızi alışveriş toplamı$/, kind: 'expense' },
  ] as const;
  const categories: Category[] = [], groups: Category[] = [];
  for (const group of definitions) {
    const start = raw.plan.indexOf(oneRow(raw.plan, group.start)), end = raw.plan.indexOf(oneRow(raw.plan, group.end));
    if (end <= start) mismatch();
    const pair = (row: Cell[]): Category => {
      const candidates = raw.actual.filter(candidate => text(candidate[0]) === text(row[0]));
      if (candidates.length !== 1) mismatch();
      return { id: `${group.label}/${text(row[0])}`, label: text(row[0]), group: group.label, kind: group.kind, plan: keys.map((_, i) => optionalMoney(row[i + 1])), current: keys.map((_, i) => optionalMoney(candidates[0][i + 1])) };
    };
    groups.push({ ...pair(raw.plan[end]), label: group.label });
    if (group.label === 'Düzensiz giderler') categories.push(pair(raw.plan[end]));
    else raw.plan.slice(start + 1, end).filter(row => text(row[0])).forEach(row => categories.push(pair(row)));
  }
  const savingTotal: Category = { id: 'Birikim/Alımlar', label: 'Birikim', group: 'Birikim', kind: 'saving', plan: months.map(month => month.saving.plan), current: months.map(month => month.saving.current) };
  groups.push(savingTotal); categories.push({ ...savingTotal, label: 'Birikim alımları · TL' });
  const irregularHeader = raw.irregular.find(row => text(row[0]) === 'Gider / açıklama');
  const expected = ['Gider / açıklama', 'Kategori', 'Durum', 'Planlanan tarih', 'Ödeme tarihi', 'Plan', 'Gerçekleşen', 'Fark', 'Yer / Bölüm', 'Plan girdisi', 'Not', 'Kaynak / ürün', 'Kayıt kimliği', 'Elle değişti', 'Kasa kimliği'];
  if (!irregularHeader || expected.some((label, i) => text(irregularHeader[i]) !== label)) throw new Error('Arızi Giderler sütunları doğrulanamadı.');
  const seen = new Set<string>();
  const monthValue = (value: Cell | undefined) => value == null || value === '' ? '' : labelFor(sheetMonthKey(value));
  const irregular = raw.irregular.slice(raw.irregular.indexOf(irregularHeader) + 1).filter(row => text(row[0])).map((row): Irregular => {
    const id = text(row[14]);
    if (!id || seen.has(id)) throw new Error('Arızi Giderler kayıt kimliği eksik veya yinelenmiş.');
    seen.add(id);
    return { id, label: text(row[0]), type: text(row[1]), status: text(row[2]), planMonth: monthValue(row[3]), month: monthValue(row[4]), plan: optionalMoney(row[5]), current: optionalMoney(row[6]), room: text(row[8]), note: text(row[10]), manual: required(row[13]) > 0 };
  });
  const irregularTotal = groups.find(group => group.label === 'Düzensiz giderler')!;
  months.forEach((month, i) => {
    for (const field of ['plan', 'current'] as const) {
      const monthField = field === 'plan' ? 'planMonth' : 'month';
      const total = irregular.filter(item => item[monthField] === month.label).reduce((sum, item) => sum + (item[field] ?? 0), 0);
      const expectedTotal = irregularTotal[field][i];
      if (expectedTotal === null || Math.abs(total - expectedTotal) > .05) mismatch();
    }
  });
  return { months, categories, groups, irregular, schema: 'cashflow' };
}
