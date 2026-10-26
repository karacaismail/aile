// Tohumlama: CSV (Eşya sekmesi dışa aktarımı) + seed/private/*.json → Apps Script batch upsert.
// Çalıştırma: node scripts/seed.ts --csv "<dosya.csv>" --url "<exec>" [--key K] [--dry] [--actor seed]
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsv, csvRowToItem, trLower, type KeywordMap } from '../shared/normalize.ts';
import { ITEM_COLUMNS, SETTING_COLUMNS, type Item, type Oda } from '../shared/schema.ts';
import { validateEnums } from '../gas/src/core.ts';
import type { Op, BatchResponse } from '../shared/api.ts';
import type { Rec } from '../shared/convert.ts';

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Deterministik 26 karakterlik kimlik: aynı anahtar → aynı id (idempotent tohumlama). */
export function seedId(prefix: 'SEED' | 'PLAN' | 'SETT' | 'EXST', key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  let out = '';
  for (let i = 0; i < 20; i++) {
    h = Math.imul(h ^ (i + 1), 0x01000193) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    out += ENC[h & 31];
  }
  return `01${prefix}${out}`;
}

export interface Override { match: string; patch: Rec }

export function applyOverrides(item: Item, overrides: Override[]): Item {
  const name = trLower(item.ad);
  let out: Item = { ...item };
  for (const o of overrides) if (name.includes(trLower(o.match))) out = { ...out, ...(o.patch as Partial<Item>) };
  return out;
}

export function csvToItems(csvText: string, opts: { overrides?: Override[]; odaKeywords?: KeywordMap<Oda> } = {}): Item[] {
  const rows = parseCsv(csvText);
  const header = rows[0] ?? [];
  const items: Item[] = [];
  rows.slice(1).forEach((row, i) => {
    const it = csvRowToItem(row, header, i, { odaKeywords: opts.odaKeywords, idFor: (r) => seedId('SEED', `${(r[0] ?? '').trim()}|${(r[2] ?? '').trim()}`) });
    if (it) items.push(applyOverrides(it, opts.overrides ?? []));
  });
  return items;
}

/** plan.json satırları: kod zorunlu; bagli_kodlar → bagli_idler (kod→id). */
export function planToItems(plan: Array<Rec & { kod: string; bagli_kodlar?: string[] }>, csvItems: Item[]): Item[] {
  const idByKod = new Map<string, string>();
  for (const c of csvItems) if (c.kod) idByKod.set(c.kod, c.id);
  for (const p of plan) idByKod.set(p.kod, seedId('PLAN', p.kod));
  return plan.map((p) => {
    const { bagli_kodlar, ...rest } = p;
    const item = { ...rest, id: seedId('PLAN', p.kod) } as Item;
    if (bagli_kodlar?.length) item.bagli_idler = bagli_kodlar.map((k) => idByKod.get(k) ?? k);
    return item;
  });
}

export function validateAll(items: Rec[], columns = ITEM_COLUMNS): string[] {
  const errs: string[] = [];
  for (const it of items) {
    const e = validateEnums(columns, it);
    if (e) errs.push(`${String(it.kod ?? it.ad ?? it.anahtar ?? it.id)}: ${e.field} geçersiz (izinli: ${e.allowed.join(', ')})`);
    const known = new Set(columns.map((c) => c.key));
    for (const k of Object.keys(it)) if (!known.has(k)) errs.push(`${String(it.kod ?? it.ad ?? it.id)}: bilinmeyen alan '${k}'`);
  }
  return errs;
}

function toOps(table: 'kalemler' | 'ayarlar', rows: Rec[]): Op[] {
  return rows.map((r) => {
    const { id, ...patch } = r;
    return { op: 'upsert', table, id: String(id), opId: `seed:${String(id)}:${Date.now()}`, patch };
  });
}

async function post(url: string, key: string | undefined, actor: string, ops: Op[]): Promise<BatchResponse> {
  const res = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'batch', key, actor, ops }) });
  const text = await res.text();
  try { return JSON.parse(text) as BatchResponse; } catch { throw new Error(`JSON değil: ${text.slice(0, 200)}`); }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function readJson<T>(p: string, fallback: T): T { return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback; }

async function main() {
  const csvPath = arg('csv');
  const url = arg('url') ?? process.env.AILE_API_URL;
  const key = arg('key') ?? process.env.AILE_API_KEY;
  const actor = arg('actor') ?? 'seed';
  const dry = process.argv.includes('--dry');
  const priv = resolve('seed/private');
  const overrides = readJson<Override[]>(`${priv}/overrides.json`, []);
  const odaKeywords = readJson<KeywordMap<Oda>>(`${priv}/keywords.json`, []);
  const plan = readJson<Array<Rec & { kod: string }>>(`${priv}/plan.json`, []);
  const settings = readJson<Rec[]>(`${priv}/settings.json`, []);
  const existing = readJson<Rec[]>(`${priv}/existing.json`, []);

  const csvItems = csvPath ? csvToItems(readFileSync(csvPath, 'utf8'), { overrides, odaKeywords }) : [];
  const planItems = planToItems(plan, csvItems);
  const existingItems = existing.map((e) => ({ ...e, id: seedId('EXST', String(e.kod ?? e.ad)) }));
  const settingRows = settings.map((s) => ({ ...s, id: seedId('SETT', `${String(s.tip)}|${String(s.anahtar)}`) }));

  const errs = [...validateAll(csvItems as unknown as Rec[]), ...validateAll(planItems as unknown as Rec[]), ...validateAll(existingItems), ...validateAll(settingRows, SETTING_COLUMNS)];
  console.log(`CSV: ${csvItems.length} · plan: ${planItems.length} · mevcut: ${existingItems.length} · ayar: ${settingRows.length}`);
  if (errs.length) { console.error('DOĞRULAMA HATALARI:'); for (const e of errs) console.error(' -', e); process.exitCode = 1; return; }
  if (dry || !url) {
    const sample = [...csvItems.slice(0, 3), ...planItems.slice(0, 2)];
    console.log(JSON.stringify(sample, null, 1).slice(0, 2000));
    if (!url) console.log('--url verilmedi: yalnız doğrulama yapıldı.');
    return;
  }
  const all: Op[] = [...toOps('kalemler', [...csvItems, ...existingItems, ...planItems] as unknown as Rec[]), ...toOps('ayarlar', settingRows)];
  let done = 0;
  for (let i = 0; i < all.length; i += 50) {
    const chunk = all.slice(i, i + 50);
    const res = await post(url, key, actor, chunk);
    done += res.doneCount;
    const bad = res.results.filter((r) => !r.ok);
    if (bad.length) console.error('Hata:', JSON.stringify(bad.slice(0, 3)));
    if (!res.ok) { console.error(`Batch durdu: ${res.error} ${res.message ?? ''}`); process.exitCode = 1; break; }
    console.log(`${done}/${all.length} yazıldı`);
  }
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('seed.ts')) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
