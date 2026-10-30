export const value = cell => Object.values(cell?.effectiveValue ?? {})[0];
export const column = index => {
  let result = '';
  for (index++; index; index = Math.floor((index - 1) / 26)) result = String.fromCharCode(65 + (index - 1) % 26) + result;
  return result;
};
export function grid(input, title) {
  const sheet = input.sheets.find(item => item.properties.title === title);
  if (!sheet) throw new Error(`Missing source sheet: ${title}`);
  const rows = [];
  for (const block of sheet.data ?? []) for (const [i, row] of (block.rowData ?? []).entries()) {
    const y = (block.startRow ?? 0) + i;
    rows[y] ??= [];
    for (const [j, cell] of (row.values ?? []).entries()) {
      const x = (block.startColumn ?? 0) + j;
      rows[y][x] = { ...rows[y][x], ...cell };
    }
  }
  return rows;
}
export const serial = date => Math.round((date.valueOf() - Date.UTC(1899, 11, 30)) / 86400000);
export const iso = date => date.toISOString().slice(0, 10);
export const dateFromSerial = day => new Date(Date.UTC(1899, 11, 30) + day * 86400000);

/** Clone JSON-like native cell data without a platform structuredClone dependency. */
export const clone = value => value == null || typeof value !== "object" ? value : Array.isArray(value) ? value.map(clone) : Object.fromEntries(Object.entries(value).map(([key,item]) => [key,clone(item)]));
