// Sheets hücresi ↔ uygulama değeri dönüşümleri. Başlık ADI ile eşleme yapılır, sabit indeks yok.
import type { ColumnDef, ColumnType } from './schema.ts';

export type Cell = string | number | boolean | Date | null | undefined;
export type Rec = Record<string, unknown>;

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Date → yyyy-MM-dd (yerel bileşenler; Apps Script'te script saat dilimi, tarayıcıda cihaz saat dilimi). */
export function formatDateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Türkçe sayı metni: "1.250,50" → 1250.5, "5.000" → 5000, "12" → 12. */
export function parseNumberTr(raw: string): number | undefined {
  const s = raw.replace(/\s+/g, '');
  if (s === '' || s === '-') return undefined;
  if (!/^-?[\d.,]+$/.test(s)) return undefined;
  let norm: string;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    norm = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    norm = s.replace(/\./g, '').replace(',', '.');
  } else {
    norm = s;
  }
  const n = Number(norm);
  return Number.isFinite(n) ? n : undefined;
}

export function cellToValue(type: ColumnType, cell: Cell): unknown {
  if (cell === null || cell === undefined) return undefined;
  switch (type) {
    case 'sayi': {
      if (typeof cell === 'number') return Number.isFinite(cell) ? cell : undefined;
      if (typeof cell === 'boolean') return cell ? 1 : 0;
      if (cell instanceof Date) return undefined;
      return parseNumberTr(String(cell));
    }
    case 'bool': {
      if (typeof cell === 'boolean') return cell;
      const s = String(cell).trim().toLowerCase();
      if (s === '') return undefined;
      if (['true', '1', 'evet', 'x', 'doğru'].includes(s)) return true;
      if (['false', '0', 'hayır', 'hayir', 'yanlış'].includes(s)) return false;
      return undefined;
    }
    case 'liste':
    case 'enumliste': {
      if (Array.isArray(cell)) return (cell as unknown[]).map(String).map((x) => x.trim()).filter(Boolean);
      const s = String(cell);
      const parts = s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      return parts.length ? parts : undefined;
    }
    case 'tarih': {
      if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? undefined : formatDateLocal(cell);
      const s = String(cell).trim();
      if (s === '') return undefined;
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
    }
    case 'tarihsaat': {
      if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? undefined : cell.toISOString();
      const s = String(cell).trim();
      return s === '' ? undefined : s;
    }
    case 'enum':
    case 'metin':
    case 'uzunmetin':
    default: {
      if (cell instanceof Date) return cell.toISOString();
      const s = String(cell);
      return s.trim() === '' ? undefined : s;
    }
  }
}

export function valueToCell(type: ColumnType, value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  switch (type) {
    case 'sayi': return typeof value === 'number' ? value : (parseNumberTr(String(value)) ?? '');
    case 'bool': return typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true';
    case 'liste':
    case 'enumliste': return Array.isArray(value) ? value.map(String).join('\n') : String(value);
    default: return String(value);
  }
}

export function headerIndex(headers: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  headers.forEach((h, i) => { const k = String(h).trim(); if (k && !m.has(k)) m.set(k, i); });
  return m;
}

export function missingHeaders(headers: readonly string[], required: readonly string[]): string[] {
  const have = new Set(headers.map((h) => String(h).trim()));
  return required.filter((r) => !have.has(r));
}

export function rowToRecord(columns: readonly ColumnDef[], headers: readonly string[], row: readonly Cell[]): Rec {
  const defs = new Map(columns.map((col) => [col.key, col]));
  const rec: Rec = {};
  headers.forEach((h, i) => {
    const def = defs.get(String(h).trim());
    if (!def) return;
    const v = cellToValue(def.type, row[i]);
    if (v !== undefined) rec[def.key] = v;
  });
  return rec;
}

export function recordToRow(columns: readonly ColumnDef[], headers: readonly string[], rec: Rec): (string | number | boolean)[] {
  const defs = new Map(columns.map((col) => [col.key, col]));
  return headers.map((h) => {
    const def = defs.get(String(h).trim());
    if (!def) return '';
    return valueToCell(def.type, rec[def.key]);
  });
}

/** Hızlı FNV-1a; sunucu parmak izi için. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function fingerprintOf(items: readonly Rec[], settings: readonly Rec[]): string {
  const parts: string[] = [];
  let maxUpdated = '';
  let sumVersion = 0;
  for (const list of [items, settings]) {
    for (const r of list) {
      const u = String(r.updated_at ?? '');
      if (u > maxUpdated) maxUpdated = u;
      sumVersion += Number(r.version ?? 0) || 0;
      parts.push(`${String(r.id ?? '')}|${String(r.version ?? '')}|${u}|${String(r.deleted_at ?? '')}`);
    }
  }
  parts.sort();
  return `${items.length}:${settings.length}:${sumVersion}:${maxUpdated}:${fnv1a(parts.join('\n'))}`;
}
