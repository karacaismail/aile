import { dateFromSerial, grid, iso, value } from './cells.mjs';

const TITLE = 'Parametreler', MOVE_ROW = 4, VALUE_COLUMN = 2;

/** One move date in the sheet drives the engine too; the installed policy is only the fallback. */
export function moveDateOverrides(source, { day }) {
  if (!source.sheets.some(sheet => sheet.properties.title === TITLE)) return null;
  const serial = value(grid(source, TITLE)[MOVE_ROW]?.[VALUE_COLUMN]);
  if (typeof serial !== 'number' || !Number.isFinite(serial)) throw new Error('Source preflight: Parametreler taşınma tarihi geçersiz');
  const moved = dateFromSerial(serial);
  return { protectUntil: iso(moved), firstDate: iso(new Date(Date.UTC(moved.getUTCFullYear(), moved.getUTCMonth() + 1, day))) };
}
