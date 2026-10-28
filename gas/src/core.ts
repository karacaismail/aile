// Saf mantık: bellek içi tablo durumu üzerinde okuma/yazma. SpreadsheetApp'e bağımlı değil → Vitest ile test edilir.
import type { ColumnDef } from '../../shared/schema.ts';
import { ITEM_COLUMNS, SETTING_COLUMNS, CASH_COLUMNS, SCHEMA_VERSION, META_KEYS, type BudgetPlan } from '../../shared/schema.ts';
import { rowToRecord, recordToRow, fingerprintOf, type Rec, type Cell } from '../../shared/convert.ts';
import { ulid } from '../../shared/ids.ts';
import type { BatchRequest, BatchResponse, OpResult, ReadResponse, Table, UpsertOp, ApiErrorCode } from '../../shared/api.ts';

export interface TableState {
  columns: readonly ColumnDef[];
  headers: string[];
  rows: Rec[];
  sheetRows: number[]; // rows[i] → sheet satır numarası (1 tabanlı); yeni satırlar için 0
  index: Map<string, number>;
  dirty: Set<number>;
}

/** nakit: app_nakit sekmesi henüz yoksa (setup çalışmadıysa) yoktur; plan: "Giderler Planlanan" okunabildiyse. */
export interface State { kalemler: TableState; ayarlar: TableState; nakit?: TableState; plan?: BudgetPlan }

export const TABLE_COLUMNS: Record<Table, readonly ColumnDef[]> = { kalemler: ITEM_COLUMNS, ayarlar: SETTING_COLUMNS, nakit: CASH_COLUMNS };
const REQUIRED_ON_INSERT: Record<Table, string[]> = { kalemler: ['tip', 'ad'], ayarlar: ['tip', 'anahtar'], nakit: ['tarih', 'tutar', 'kalem'] };
const META = new Set<string>(META_KEYS);

/** Boş satır: yalnız boş hücreler ve onay kutusu doğrulamasının ürettiği FALSE değerleri. */
function isBlankRow(row: readonly Cell[]): boolean {
  return row.every((cell) => cell === '' || cell === null || cell === undefined || cell === false);
}

/** cells: başlık satırı HARİÇ veri satırları; firstSheetRow: ilk veri satırının sheet numarası (genelde 2). */
export function createTableState(columns: readonly ColumnDef[], headers: string[], cells: readonly (readonly Cell[])[], firstSheetRow = 2, now?: string): TableState {
  const st: TableState = { columns, headers, rows: [], sheetRows: [], index: new Map(), dirty: new Set() };
  cells.forEach((row, i) => {
    if (isBlankRow(row)) return;
    const rec = rowToRecord(columns, headers, row);
    const idx = st.rows.length;
    if (!rec.id || typeof rec.id !== 'string') {
      // Sheets'te elle eklenmiş, kimliksiz satır: kimlik ver, bir sonraki yazımda geri yazılır.
      rec.id = ulid();
      if (now) { rec.created_at = rec.created_at ?? now; rec.updated_at = rec.updated_at ?? now; }
      rec.version = Number(rec.version ?? 0) || 0;
      st.dirty.add(idx);
    }
    st.rows.push(rec);
    st.sheetRows.push(firstSheetRow + i);
    st.index.set(String(rec.id), idx);
  });
  return st;
}

export function validateEnums(columns: readonly ColumnDef[], patch: Rec): { field: string; allowed: string[] } | null {
  for (const col of columns) {
    if (!col.enum) continue;
    const v = patch[col.key];
    if (v === undefined || v === null || v === '') continue;
    const allowed = [...col.enum];
    if (col.type === 'enumliste') {
      const arr = Array.isArray(v) ? v : String(v).split(/\r?\n/);
      if (arr.some((x) => x !== '' && !allowed.includes(String(x)))) return { field: col.key, allowed };
    } else if (!allowed.includes(String(v))) {
      return { field: col.key, allowed };
    }
  }
  return null;
}

function cleanPatch(patch: Rec): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k === 'id' || META.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function pick(rec: Rec, keys: string[]): Rec {
  const out: Rec = {};
  for (const k of keys) if (rec[k] !== undefined) out[k] = rec[k];
  return out;
}

function err(id: string, code: ApiErrorCode, message?: string): OpResult {
  return { ok: false, id, error: code, message };
}

function applyUpsert(table: TableState, tableName: Table, op: UpsertOp, actor: string, now: string): OpResult {
  const patch = cleanPatch(op.patch);
  const invalid = validateEnums(table.columns, patch);
  if (invalid) return { ...err(op.id, 'invalid_enum', `Geçersiz değer: ${invalid.field}`), message: `${invalid.field}: izinli değerler ${invalid.allowed.join(', ')}` };
  const keys = Object.keys(patch);
  const idx = table.index.get(op.id);

  if (idx === undefined) {
    const need = REQUIRED_ON_INSERT[tableName];
    const missing = need.filter((k) => patch[k] === undefined || patch[k] === '');
    if (missing.length) return err(op.id, 'bad_request', `Yeni kayıt için zorunlu: ${missing.join(', ')}`);
    const rec: Rec = { id: op.id };
    for (const k of keys) if (patch[k] !== null) rec[k] = patch[k];
    rec.created_at = now; rec.updated_at = now; rec.updated_by = actor; rec.version = 1;
    rec.son_op_id = op.opId; rec.son_degisen_alanlar = keys;
    const newIdx = table.rows.length;
    table.rows.push(rec); table.sheetRows.push(0); table.index.set(op.id, newIdx); table.dirty.add(newIdx);
    return { ok: true, id: op.id, row: rec };
  }

  const row = table.rows[idx];
  if (row.son_op_id === op.opId) return { ok: true, id: op.id, row, duplicate: true };

  const currentVersion = Number(row.version ?? 0) || 0;
  let conflictKeys: string[] = [];
  if (op.baseVersion !== undefined && op.baseVersion < currentVersion) {
    const last = Array.isArray(row.son_degisen_alanlar) ? (row.son_degisen_alanlar as string[]) : [];
    conflictKeys = keys.filter((k) => last.includes(k));
  }
  const applied = keys.filter((k) => !conflictKeys.includes(k));
  const result: OpResult = { ok: true, id: op.id, row };
  if (conflictKeys.length) {
    result.conflict = {
      keys: conflictKeys,
      serverValues: pick(row, conflictKeys),
      serverVersion: currentVersion,
      updatedBy: row.updated_by as string | undefined,
      updatedAt: row.updated_at as string | undefined,
    };
  }
  if (applied.length) {
    for (const k of applied) {
      if (patch[k] === null || patch[k] === '') delete row[k];
      else row[k] = patch[k];
    }
    row.updated_at = now; row.updated_by = actor; row.version = currentVersion + 1;
    row.son_op_id = op.opId; row.son_degisen_alanlar = applied;
    table.dirty.add(idx);
  }
  return result;
}

export function applyBatch(state: State, req: BatchRequest, now: string): BatchResponse {
  const results: OpResult[] = [];
  let doneCount = 0;
  let ok = true;
  const actor = (req.actor || 'bilinmeyen').toString().slice(0, 60);
  for (const op of req.ops ?? []) {
    const tableName = op.table;
    const table = state[tableName];
    if (!table) { results.push(err(op.id, 'bad_request', `Bilinmeyen tablo: ${String(tableName)}`)); ok = false; break; }
    let r: OpResult;
    if (op.op === 'upsert') {
      r = applyUpsert(table, tableName, op, actor, now);
    } else if (op.op === 'delete' || op.op === 'restore') {
      const idx = table.index.get(op.id);
      if (idx === undefined) r = err(op.id, 'not_found', 'Kayıt bulunamadı (Sheets\'te silinmiş olabilir)');
      else {
        const row = table.rows[idx];
        if (row.son_op_id === op.opId) r = { ok: true, id: op.id, row, duplicate: true };
        else {
          if (op.op === 'delete') row.deleted_at = now; else delete row.deleted_at;
          row.updated_at = now; row.updated_by = actor; row.version = (Number(row.version ?? 0) || 0) + 1;
          row.son_op_id = op.opId; row.son_degisen_alanlar = ['deleted_at'];
          table.dirty.add(idx);
          r = { ok: true, id: op.id, row };
        }
      }
    } else {
      r = err((op as { id?: string }).id ?? '', 'bad_request', 'Bilinmeyen işlem');
    }
    results.push(r);
    if (!r.ok) { ok = false; break; }
    doneCount++;
  }
  const fp = stateFingerprint(state);
  const last = results[results.length - 1];
  return { ok, results, doneCount, fingerprint: fp, serverTime: now, error: ok ? undefined : last?.error, message: ok ? undefined : last?.message };
}

export function stateFingerprint(state: State): string {
  return fingerprintOf(state.kalemler.rows, state.ayarlar.rows, state.nakit?.rows, state.plan ? JSON.stringify(state.plan) : '');
}

export function readState(state: State, fingerprint: string | undefined, now: string): ReadResponse {
  const fp = stateFingerprint(state);
  if (fingerprint && fingerprint === fp) return { ok: true, notModified: true, fingerprint: fp, serverTime: now, schemaVersion: SCHEMA_VERSION };
  return {
    ok: true,
    fingerprint: fp,
    serverTime: now,
    schemaVersion: SCHEMA_VERSION,
    items: state.kalemler.rows as unknown as ReadResponse extends { items: infer I } ? I : never,
    settings: state.ayarlar.rows as never,
    ...(state.nakit ? { cash: state.nakit.rows as never } : {}),
    ...(state.plan ? { plan: state.plan } : {}),
  } as ReadResponse;
}

/** Yazılacak satırları üretir: [sheetRow, cells] (sheetRow 0 → sona eklenecek). */
export function dirtyRows(table: TableState): Array<{ sheetRow: number; cells: (string | number | boolean)[] }> {
  const out: Array<{ sheetRow: number; cells: (string | number | boolean)[] }> = [];
  for (const idx of [...table.dirty].sort((a, b) => a - b)) {
    out.push({ sheetRow: table.sheetRows[idx], cells: recordToRow(table.columns, table.headers, table.rows[idx]) });
  }
  return out;
}

// ---------------- Bütçe sekmeleri ----------------

/** Ay sütunları C..N (0 tabanlı 2..13); etiket sütunu B (1). */
const LABEL_COL = 1;
const FIRST_MONTH_COL = 2;
const MONTH_HEADER = /^OCA/i;

function num(cell: Cell): number {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : 0;
  if (typeof cell === 'string') {
    const n = parseFloat(cell.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export interface PlanLayoutRow { label: string; group: string; sheetRow: number }

/**
 * "Giderler Planlanan" değer ızgarasını (1. satırdan, A sütunundan) okur. Grup başlığı: C sütununda "OCA" olan satır;
 * grup, B'si "TOPLAMLAR" olan satırla biter. Adı boş başlık (ikinci tablo) okumayı durdurur.
 */
export function parsePlan(values: readonly (readonly Cell[])[], year?: number): { plan: BudgetPlan; layout: PlanLayoutRow[] } {
  const plan: BudgetPlan = { year, groups: [] };
  const layout: PlanLayoutRow[] = [];
  let group: BudgetPlan['groups'][number] | null = null;
  for (let r = 0; r < values.length; r++) {
    const row = values[r] ?? [];
    const label = String(row[LABEL_COL] ?? '').trim();
    const head = String(row[FIRST_MONTH_COL] ?? '').trim();
    if (MONTH_HEADER.test(head)) {
      if (!label) { if (plan.groups.length) break; continue; }
      group = { name: label, rows: [] };
      plan.groups.push(group);
      continue;
    }
    if (!group || !label) continue;
    if (/^TOPLAM/i.test(label)) { group = null; continue; }
    const months: number[] = [];
    for (let m = 0; m < 12; m++) months.push(num(row[FIRST_MONTH_COL + m] as Cell));
    group.rows.push({ label, plan: months });
    layout.push({ label, group: group.name, sheetRow: r + 1 });
  }
  return { plan, layout };
}

const colLetter = (i: number): string => {
  let n = i + 1; let out = '';
  while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); }
  return out;
};

/**
 * Gerçekleşen hücresi formülü. Kural: o kalem için o ay günlükte kayıt yoksa plan gösterilir (otomatik ödenen krediler
 * kaydedilmese de toplam bozulmaz); kayıt varsa kapanmış ayda gerçek toplam, açık ya da gelecek ayda max(gerçek, plan).
 */
export function actualFormula(opts: { cashSheet: string; cashHeaders: readonly string[]; planSheet: string; panoYearCell: string; sheetRow: number; month: number }): string {
  const { cashSheet, cashHeaders, planSheet, panoYearCell, sheetRow, month } = opts;
  const col = (key: string) => {
    const i = cashHeaders.indexOf(key);
    if (i < 0) throw new Error(`app_nakit sütunu yok: ${key}`);
    const L = colLetter(i);
    return `'${cashSheet}'!$${L}$2:$${L}`;
  };
  const cell = colLetter(FIRST_MONTH_COL + month - 1);
  const crit = `${col('kalem')},TRIM($B${sheetRow}),${col('tarih')},${panoYearCell}&"-${String(month).padStart(2, '0')}*",${col('deleted_at')},""`;
  return `=LET(n,COUNTIFS(${crit}),a,SUMIFS(${col('tutar')},${crit}),p,'${planSheet}'!${cell}${sheetRow},`
    + `IF(n=0,p,IF(DATE(${panoYearCell},${month}+1,1)<=TODAY(),a,MAX(a,p))))`;
}

/** Eski hâl (geri alma): plan kopyası. */
export function planCopyFormula(planSheet: string, sheetRow: number, month: number): string {
  return `='${planSheet}'!${colLetter(FIRST_MONTH_COL + month - 1)}${sheetRow}`;
}
