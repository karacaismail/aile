// Apps Script giriş noktası. esbuild ile apps-script/Code.js'e paketlenir (bkz. scripts/build-gas.mjs).
/* global SpreadsheetApp, LockService, PropertiesService, ContentService, ScriptApp, Session */
import { SHEETS, ITEM_COLUMNS, SETTING_COLUMNS, SCHEMA_VERSION, REQUIRED_ITEM_HEADERS, REQUIRED_SETTING_HEADERS, META_KEYS, type ColumnDef } from '../../shared/schema.ts';
import { missingHeaders, headerIndex, rowToRecord, recordToRow, type Cell } from '../../shared/convert.ts';
import { ulid } from '../../shared/ids.ts';
import type { ApiRequest, ApiResponse, ErrorResponse, HealthResponse } from '../../shared/api.ts';
import { createTableState, applyBatch, readState, dirtyRows, type State, type TableState } from './core.ts';

type Sheet = GoogleAppsScript.Spreadsheet.Sheet;
type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;

const TABLES: Array<{ key: 'kalemler' | 'ayarlar'; name: string; columns: readonly ColumnDef[]; required: readonly string[] }> = [
  { key: 'kalemler', name: SHEETS.items, columns: ITEM_COLUMNS, required: REQUIRED_ITEM_HEADERS },
  { key: 'ayarlar', name: SHEETS.settings, columns: SETTING_COLUMNS, required: REQUIRED_SETTING_HEADERS },
];
const MAX_BODY = 512 * 1024;

function json(obj: unknown) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function fail(error: ErrorResponse['error'], message?: string, extra: Partial<ErrorResponse> = {}): ErrorResponse {
  return { ok: false, error, message, ...extra };
}
function nowIso(): string { return new Date().toISOString(); }

function loadState(ss: Spreadsheet): State | ErrorResponse {
  const out: Partial<State> = {};
  for (const t of TABLES) {
    const sheet = ss.getSheetByName(t.name);
    if (!sheet) return fail('schema', `Sekme yok: ${t.name} (setup çalıştırın)`, { missing: [t.name] });
    const values = sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [[]];
    const headers = (values[0] ?? []).map((h) => String(h).trim());
    const missing = missingHeaders(headers, t.required);
    if (missing.length) return fail('schema', `Eksik sütun: ${missing.join(', ')}`, { missing });
    out[t.key] = createTableState(t.columns, headers, values.slice(1) as Cell[][], 2, nowIso());
  }
  return out as State;
}

function flushState(ss: Spreadsheet, state: State): void {
  for (const t of TABLES) {
    const table: TableState = state[t.key];
    if (!table.dirty.size) continue;
    const sheet = ss.getSheetByName(t.name)!;
    const width = table.headers.length;
    const appended: (string | number | boolean)[][] = [];
    for (const { sheetRow, cells } of dirtyRows(table)) {
      if (sheetRow > 0) sheet.getRange(sheetRow, 1, 1, width).setValues([cells]);
      else appended.push(cells);
    }
    if (appended.length) sheet.getRange(sheet.getLastRow() + 1, 1, appended.length, width).setValues(appended);
  }
  SpreadsheetApp.flush();
}

function checkKey(key: string | undefined): boolean {
  const expected = PropertiesService.getScriptProperties().getProperty('APP_KEY');
  if (!expected) return true;
  return typeof key === 'string' && key === expected;
}

function handle(req: ApiRequest): ApiResponse {
  const ss = SpreadsheetApp.getActive();
  if (req.action === 'health') return healthCheck();
  if (req.action === 'read') {
    if (!checkKey(req.key)) return fail('unauthorized');
    const st = loadState(ss);
    if ('ok' in st && (st as ErrorResponse).ok === false) return st as ErrorResponse;
    return readState(st as State, req.fingerprint, nowIso());
  }
  if (req.action === 'batch') {
    if (!checkKey(req.key)) return fail('unauthorized');
    if (!Array.isArray(req.ops) || req.ops.length === 0) return fail('bad_request', 'ops boş');
    if (req.ops.length > 200) return fail('bad_request', 'Tek istekte en fazla 200 işlem');
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail('busy', 'Tablo meşgul, yeniden deneyin', { retryAfterMs: 3000 });
    try {
      const st = loadState(ss);
      if ('ok' in st && (st as ErrorResponse).ok === false) return st as ErrorResponse;
      const res = applyBatch(st as State, req, nowIso());
      flushState(ss, st as State);
      return res;
    } finally {
      lock.releaseLock();
    }
  }
  return fail('bad_request', 'Bilinmeyen action');
}

export function doPost(e: GoogleAppsScript.Events.DoPost) {
  try {
    const raw = e?.postData?.contents ?? '';
    if (raw.length > MAX_BODY) return json(fail('bad_request', 'Gövde çok büyük'));
    let req: ApiRequest;
    try { req = JSON.parse(raw) as ApiRequest; } catch { return json(fail('bad_request', 'JSON çözülemedi')); }
    return json(handle(req));
  } catch (error) {
    return json(fail('internal', String((error as Error)?.message ?? error)));
  }
}

export function doGet(e: GoogleAppsScript.Events.DoGet) {
  const action = e?.parameter?.action ?? 'health';
  if (action === 'health') return json(healthCheck());
  if (action === 'setup') {
    // İdempotent kurulum: sekmeler + başlıklar + tetikleyici. Yalnız bu scriptin sahibi adına çalışır.
    try { return json({ ok: true, app: 'aile', message: setup(), health: healthCheck() }); }
    catch (error) { return json(fail('internal', String((error as Error)?.message ?? error))); }
  }
  return json(fail('bad_request', 'GET yalnız health/setup için'));
}

export function healthCheck(): HealthResponse {
  const ss = SpreadsheetApp.getActive();
  const warnings: string[] = [];
  const triggers = ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction());
  if (!triggers.includes('onEditInstallable')) warnings.push('onEditInstallable tetikleyicisi yok (setup çalıştırın)');
  for (const t of TABLES) if (!ss.getSheetByName(t.name)) warnings.push(`Sekme yok: ${t.name}`);
  const tz = ss.getSpreadsheetTimeZone();
  if (tz !== 'Europe/Istanbul') warnings.push(`Tablo saat dilimi ${tz}; Europe/Istanbul bekleniyor`);
  let fingerprint: string | undefined;
  if (!warnings.some((w) => w.startsWith('Sekme yok'))) {
    const st = loadState(ss);
    if (!('error' in st)) {
      const r = readState(st as State, undefined, nowIso());
      fingerprint = r.fingerprint;
    }
  }
  return { ok: true, app: 'aile', schemaVersion: SCHEMA_VERSION, serverTime: nowIso(), fingerprint, triggers, warnings };
}

// ---------------- Kurulum ----------------

function ensureSheet(ss: Spreadsheet, name: string, columns: readonly ColumnDef[]): Sheet {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const keys = columns.map((c) => c.key);
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim()) : [];
  if (existing.filter(Boolean).length === 0) {
    sheet.getRange(1, 1, 1, keys.length).setValues([keys]);
  } else {
    const missing = keys.filter((k) => !existing.includes(k));
    if (missing.length) sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
  const idx = headerIndex(headers);
  const maxRows = Math.max(sheet.getMaxRows(), 1000);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f3eee6');
  for (const col of columns) {
    const i = idx.get(col.key);
    if (i === undefined) continue;
    const colRange = sheet.getRange(2, i + 1, maxRows - 1, 1);
    const header = sheet.getRange(1, i + 1);
    header.setNote(`${col.label} (${col.type}${col.enum ? ': ' + col.enum.join(' | ') : ''})`);
    if (col.type === 'tarih' || col.type === 'tarihsaat' || col.type === 'metin' || col.type === 'uzunmetin' || col.type === 'liste' || col.type === 'enumliste') {
      colRange.setNumberFormat('@');
    } else if (col.type === 'sayi') {
      colRange.setNumberFormat('#,##0.##');
    }
    if (col.enum && col.type === 'enum') {
      const rule = SpreadsheetApp.newDataValidation().requireValueInList([...col.enum], true).setAllowInvalid(true).build();
      colRange.setDataValidation(rule);
    } else if (col.type === 'bool') {
      const rule = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(true).build();
      colRange.setDataValidation(rule);
    }
    sheet.setColumnWidth(i + 1, col.key === 'ad' || col.key === 'not' || col.key === 'deger' ? 240 : 110);
  }
  // Modül sütunlarını gruplayıp daralt: kimlik/ortak/meta dışındakiler
  const groups = new Map<string, number[]>();
  columns.forEach((col) => {
    const i = idx.get(col.key);
    if (i === undefined) return;
    if (['kimlik', 'ortak'].includes(col.group)) return;
    const arr = groups.get(col.group) ?? [];
    arr.push(i + 1);
    groups.set(col.group, arr);
  });
  try {
    sheet.getRange(1, 1, 1, headers.length).shiftColumnGroupDepth(0);
    for (const cols of groups.values()) {
      const start = Math.min(...cols);
      const count = Math.max(...cols) - start + 1;
      if (sheet.getColumnGroupDepth(start) === 0) sheet.getRange(1, start, 1, count).shiftColumnGroupDepth(1);
    }
    sheet.collapseAllColumnGroups();
  } catch (_e) { /* gruplama desteklenmiyorsa atla */ }
  const protection = sheet.getRange(1, 1, 1, headers.length).protect();
  protection.setDescription('aile: başlık satırı (uygulama bu adları kullanır)');
  protection.setWarningOnly(true);
  return sheet;
}

/** Editörden ya da clasp ile bir kez çalıştırılır. İdempotent. */
export function setup(): string {
  const ss = SpreadsheetApp.getActive();
  for (const t of TABLES) ensureSheet(ss, t.name, t.columns);
  const triggers = ScriptApp.getProjectTriggers();
  if (!triggers.some((t) => t.getHandlerFunction() === 'onEditInstallable')) {
    ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss).onEdit().create();
  }
  const msg = `setup tamam: ${TABLES.map((t) => t.name).join(', ')}; tetikleyici: onEditInstallable; tz=${ss.getSpreadsheetTimeZone()}`;
  console.log(msg);
  return msg;
}

/** Installable onEdit: Sheets'te elle düzenlenen satırları damgalar (programatik yazımlar tetiklemez). */
export function onEditInstallable(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  const range = e?.range;
  if (!range) return;
  const sheet = range.getSheet();
  const t = TABLES.find((x) => x.name === sheet.getName());
  if (!t) return;
  const rowStart = range.getRow();
  if (rowStart === 1) return; // başlık
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim());
  const colStart = range.getColumn();
  const colEnd = colStart + range.getNumColumns() - 1;
  const editedKeys = headers.slice(colStart - 1, colEnd).filter(Boolean);
  const meta = new Set<string>(META_KEYS);
  if (editedKeys.length && editedKeys.every((k) => meta.has(k))) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const now = nowIso();
    const user = (() => { try { return e.user?.getEmail?.() || Session.getActiveUser().getEmail() || 'sheets'; } catch { return 'sheets'; } })();
    const rowEnd = rowStart + range.getNumRows() - 1;
    const values = sheet.getRange(rowStart, 1, rowEnd - rowStart + 1, lastCol).getValues();
    const out = values.map((cells) => {
      const rec = rowToRecord(t.columns, headers, cells as Cell[]);
      const blank = cells.every((c) => c === '' || c === null);
      if (blank) return cells;
      if (!rec.id) { rec.id = ulid(); rec.created_at = now; }
      rec.updated_at = now;
      rec.updated_by = user;
      rec.version = (Number(rec.version ?? 0) || 0) + 1;
      rec.son_op_id = `sheet:${now}`;
      rec.son_degisen_alanlar = editedKeys.filter((k) => !meta.has(k));
      return recordToRow(t.columns, headers, rec);
    });
    sheet.getRange(rowStart, 1, out.length, lastCol).setValues(out);
  } finally {
    lock.releaseLock();
  }
}
