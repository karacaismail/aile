// Kayma testi: src/admin/data/contract.ts (Zod) ile data-platform sözleşmesi aynı kararı vermeli. Kaynaklar salt okunur:
//   - data-platform/schemas/partition.schema.json ve manifest.schema.json (taşınabilir JSON Şeması)
//   - data-platform/postgres-mapping.json (alan, null ve tip eşlemesi; makine okunur kontroller)
//   - data-platform/validate.mjs (üreticinin nesli yazmadan önce çalıştırdığı kapı)
// Yöntem: sentetik nesildeki gerçek biçimli belgeler üzerinde şemadan türetilen değişiklikler üretilir; küçük bir JSON Şeması
// değerlendiricisi ile Zod aynı sonucu vermelidir. Zod'un bilerek daha sıkı olduğu yerler gerekçesiyle listelenir; kullanılmayan
// liste girdisi de hatadır, böylece bayat istisna kalmaz. Zod hiçbir yerde JSON Şemasından gevşek olamaz.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Currency, Decimal, Manifest, PartitionEnvelope, collectionSchemas, parsePartition } from './contract';
import type { CollectionName } from './types';

type Path = (string | number)[];
type JsonObject = Record<string, unknown>;

const ROOT = process.cwd();
const DATA_PLATFORM = join(ROOT, 'data-platform');
const FIXTURE_ROOT = join(ROOT, 'fixtures', 'generation-synthetic');
const GENERATION_DIR = join(FIXTURE_ROOT, readdirSync(FIXTURE_ROOT).find((d) => /^[0-9a-f]{64}$/.test(d)) ?? '');
const readJson = (...parts: string[]): unknown => JSON.parse(readFileSync(join(...parts), 'utf8'));

const PARTITION_SCHEMA = readJson(DATA_PLATFORM, 'schemas', 'partition.schema.json') as JsonObject;
const MANIFEST_SCHEMA = readJson(DATA_PLATFORM, 'schemas', 'manifest.schema.json') as JsonObject;
const MAPPING = readJson(DATA_PLATFORM, 'postgres-mapping.json') as {
  field_groups: Record<string, MappingField[]>;
  collections: { collection: string; include_field_groups?: string[]; fields: MappingField[]; checks?: string[] }[];
  typed_relation_rules: Record<string, unknown>;
};
interface MappingField { source_path: string; postgres_type: string; nullable: boolean }

/**
 * Üretici kapısı (validate.mjs) ayrı bir Node sürecinde çalışır: modül import.meta.url ile sözlük okur ve jsdom test ortamında
 * dosya URL'si üretmez. Süreç yalnız sentetik nesli okur; ağ ve yazma yoktur.
 */
function producerGate(directory: string): { valid: boolean; allowed: string[] } {
  const script = [
    'const m = await import(process.argv[1]);',
    'const r = await m.validateGeneration(process.argv[2]);',
    'process.stdout.write(JSON.stringify({ valid: r.valid, allowed: [...m.allowedCollections] }));',
  ].join(' ');
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script, pathToFileURL(join(DATA_PLATFORM, 'validate.mjs')).href, directory], { encoding: 'utf8' });
  return JSON.parse(out) as { valid: boolean; allowed: string[] };
}

const MANIFEST_RAW = readJson(GENERATION_DIR, 'manifest.json') as JsonObject & { files: { kind: string; path: string; collection?: string }[] };
const PANEL_COLLECTIONS = Object.keys(collectionSchemas) as CollectionName[];
const firstRecord = (collection: string): JsonObject => {
  const file = MANIFEST_RAW.files.find((f) => f.kind === 'partition' && f.collection === collection);
  if (!file) throw new Error(`Sentetik nesilde koleksiyon yok: ${collection}`);
  return structuredClone((readJson(GENERATION_DIR, file.path) as { records: JsonObject[] }).records[0]!);
};

// --- Küçük JSON Şeması değerlendiricisi --------------------------------------------------------------------
// Yalnız data-platform şemalarının kullandığı anahtar sözcükler desteklenir; şemaya yeni bir anahtar sözcük gelirse aşağıdaki
// koruma testi kırılır ve bu değerlendirici bilinçli olarak genişletilir (sessizce yok sayılmaz).
const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description',
  'type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'items', 'minItems', 'minimum', 'pattern', 'format', 'anyOf',
]);
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const FORMATS: Record<string, (s: string) => boolean> = {
  uuid: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  date: (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === s;
  },
};

function schemaKeywords(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => schemaKeywords(n, out));
  else if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      out.add(key);
      if (key === 'properties' || key === '$defs') Object.values(value as JsonObject).forEach((n) => schemaKeywords(n, out));
      else if (key !== 'const' && key !== 'enum' && key !== 'required') schemaKeywords(value, out);
    }
  }
  return out;
}

function jsonSchema(root: JsonObject) {
  const deref = (schema: unknown): JsonObject => {
    if (!isObject(schema)) throw new Error('Şema düğümü nesne değil');
    const ref = schema.$ref;
    if (typeof ref !== 'string') return schema;
    if (!ref.startsWith('#/')) throw new Error(`Desteklenmeyen $ref: ${ref}`);
    return deref(ref.slice(2).split('/').reduce<unknown>((node, key) => (node as JsonObject)[key], root));
  };
  const hasType = (type: unknown, v: unknown): boolean => {
    switch (type) {
      case 'null': return v === null;
      case 'boolean': return typeof v === 'boolean';
      case 'string': return typeof v === 'string';
      case 'integer': return Number.isInteger(v);
      case 'number': return typeof v === 'number' && Number.isFinite(v);
      case 'array': return Array.isArray(v);
      case 'object': return isObject(v);
      default: throw new Error(`Desteklenmeyen tip: ${String(type)}`);
    }
  };
  const valid = (schema: unknown, v: unknown): boolean => {
    const s = deref(schema);
    if ('const' in s && !deepEqual(s.const, v)) return false;
    if (Array.isArray(s.enum) && !s.enum.some((e) => deepEqual(e, v))) return false;
    if (s.type !== undefined && !(Array.isArray(s.type) ? s.type : [s.type]).some((t) => hasType(t, v))) return false;
    if (typeof v === 'string') {
      if (typeof s.pattern === 'string' && !new RegExp(s.pattern, 'u').test(v)) return false;
      if (typeof s.format === 'string') {
        const check = FORMATS[s.format];
        if (!check) throw new Error(`Desteklenmeyen format: ${s.format}`);
        if (!check(v)) return false;
      }
    }
    if (typeof v === 'number' && typeof s.minimum === 'number' && v < s.minimum) return false;
    if (Array.isArray(v)) {
      if (typeof s.minItems === 'number' && v.length < s.minItems) return false;
      if (s.items !== undefined && !v.every((item) => valid(s.items, item))) return false;
    }
    if (isObject(v)) {
      if (Array.isArray(s.required) && !s.required.every((k) => Object.hasOwn(v, String(k)))) return false;
      const props = isObject(s.properties) ? s.properties : {};
      for (const [k, sub] of Object.entries(props)) if (Object.hasOwn(v, k) && !valid(sub, v[k])) return false;
      const extra = Object.keys(v).filter((k) => !Object.hasOwn(props, k));
      if (s.additionalProperties === false && extra.length > 0) return false;
      if (isObject(s.additionalProperties) && !extra.every((k) => valid(s.additionalProperties, v[k]))) return false;
    }
    if (Array.isArray(s.anyOf) && !s.anyOf.some((branch) => valid(branch, v))) return false;
    return true;
  };
  return { deref, valid };
}

// --- Şemadan türetilen değişiklikler -------------------------------------------------------------------------
const UUID = '07a8cb8b-8cd5-5475-a49f-f07dfa0759fc';
const MONEY_OK = { amount: '8500.00', currency: 'TRY' };
/** Her şema düğümüne denenen değerler: geçerli ve geçersiz örnekler birlikte; para için sayı tipi de denenir. */
const POOL: unknown[] = [
  null, true, false, 0, 1, 2, -1, 1.5, 8500,
  '', 'x', 'rooms', 'Rooms', '1', '0', '8500.00', '-12.5', '1,5', '1.', '+1', '1e3', ' 1', '1.5\n', 'NaN', 'TRY', 'tl', '₺',
  '2026-10-28', '2026-13-01', '2026-02-30', '28.10.2026', '2026-10-28T10:00:00Z', UUID, UUID.toUpperCase(), 'a'.repeat(64), 'A'.repeat(64),
  'private_only', 'snapshot_capture_not_transaction', 'partition',
  [], ['x'], [UUID], {},
  MONEY_OK, { amount: '1,5', currency: 'TRY' }, { amount: 8500, currency: 'TRY' }, { amount: '8500.00', currency: 'tl' },
  { amount: '8500.00' }, { ...MONEY_OK, ek: 1 },
];
/** Eksik alt nesneleri kurarken yaprak adayları (ilk geçerli olan seçilir). */
const SAMPLE_LEAVES: unknown[] = [null, UUID, '2026-10-28', '0', 'TRY', 'a'.repeat(64), 'x', 1, 0, true, {}, []];
const EXTRA = '__ek_alan__';

interface Probe { label: string; apply(doc: unknown): unknown }
const fmt = (path: Path) => (path.length ? path.join('.') : '(kök)');

function setAt(doc: unknown, path: Path, value: unknown, seeds: [Path, unknown][], remove = false): unknown {
  const copy = structuredClone(doc);
  for (const [seedPath, seed] of seeds) {
    const parent = seedPath.slice(0, -1).reduce<unknown>((n, k) => (n as JsonObject)[k as string], copy) as JsonObject;
    const key = seedPath[seedPath.length - 1] as string;
    if (parent[key] === undefined || parent[key] === null) parent[key] = structuredClone(seed);
  }
  if (path.length === 0) return structuredClone(value);
  const parent = path.slice(0, -1).reduce<unknown>((n, k) => (n as JsonObject)[k as string], copy) as JsonObject;
  const key = path[path.length - 1] as string;
  if (remove) delete parent[key];
  else parent[key] = structuredClone(value);
  return copy;
}

function probesFor(schemaApi: ReturnType<typeof jsonSchema>, schema: unknown, instance: unknown, path: Path, seeds: [Path, unknown][]): Probe[] {
  const s = schemaApi.deref(schema);
  const out: Probe[] = POOL.map((value) => ({ label: `${fmt(path)} = ${JSON.stringify(value)}`, apply: (doc) => setAt(doc, path, value, seeds) }));

  const sample = (node: unknown): unknown => {
    const n = schemaApi.deref(node);
    const types = Array.isArray(n.type) ? n.type : n.type === undefined ? [] : [n.type];
    if (types.includes('object') || isObject(n.properties) || Array.isArray(n.required)) {
      const obj: JsonObject = {};
      const props = isObject(n.properties) ? n.properties : {};
      for (const key of (n.required as string[] | undefined) ?? []) {
        const sub = props[key] ?? (isObject(n.additionalProperties) ? n.additionalProperties : {});
        obj[key] = SAMPLE_LEAVES.find((leaf) => schemaApi.valid(sub, leaf));
      }
      return obj;
    }
    return undefined;
  };

  let base = instance;
  let childSeeds = seeds;
  if (base === undefined || base === null) {
    const built = sample(s);
    if (built === undefined) return out;
    if (!schemaApi.valid(s, built)) throw new Error(`Örnek kurulamadı: ${fmt(path)}`);
    base = built;
    childSeeds = [...seeds, [path, built]];
  }

  if (isObject(base)) {
    const props = isObject(s.properties) ? s.properties : {};
    if (instance !== undefined && instance !== null && Array.isArray(s.required)) {
      for (const key of s.required as string[]) {
        if (Object.hasOwn(base, key)) out.push({ label: `${fmt([...path, key])} silindi`, apply: (doc) => setAt(doc, [...path, key], undefined, seeds, true) });
      }
    }
    for (const [key, sub] of Object.entries(props)) out.push(...probesFor(schemaApi, sub, base[key], [...path, key], childSeeds));
    if (s.additionalProperties === false) {
      out.push({ label: `${fmt([...path, EXTRA])} = 1`, apply: (doc) => setAt(doc, [...path, EXTRA], 1, childSeeds) });
    } else if (isObject(s.additionalProperties)) {
      out.push(...probesFor(schemaApi, s.additionalProperties, undefined, [...path, EXTRA], childSeeds));
    }
  } else if (Array.isArray(base) && s.items !== undefined) {
    out.push(...probesFor(schemaApi, s.items, base[0], [...path, 0], childSeeds));
  }
  return out;
}

/** Zod'un JSON Şemasından bilerek daha sıkı olduğu yerler. Her biri üretici kapısına (validate.mjs) veya eşlemeye dayanır. */
const STRICTER_BY_DESIGN: { where: RegExp; why: string }[] = [
  {
    where: /^zarf:[a-z_]+ collection = "/,
    why: 'validate.mjs: zarfın koleksiyon adı manifest kaydıyla aynı olmalı; parsePartition yalnız istenen adı kabul eder',
  },
  {
    where: /^zarf:[a-z_]+ records\.0\.amounts = \{"amount"/,
    why: 'validate.mjs recordShape: amounts içindeki her değer para (veya null) olmalı; bilinmeyen anahtar da para olarak doğrulanır',
  },
  {
    where: /^zarf:forecast_events records\.0\.occurred_on = null$/,
    why: 'postgres-mapping: forecast_events.occurred_on date NOT NULL (tahmin olayının tarihi zorunlu)',
  },
  {
    where: /^manifest files\.0\.collection = "/,
    why: 'validate.mjs: parça dosyası zarfla aynı koleksiyon adını taşır; ad zarf deseni ^[a-z_]+$ ile doğrulanır',
  },
];

function compare(scope: string, probes: Probe[], base: unknown, jsonValid: (doc: unknown) => boolean, zodValid: (doc: unknown) => boolean) {
  const looser: string[] = [];
  const stricter: string[] = [];
  const seen = new Set<string>();
  for (const probe of probes) {
    const label = `${scope} ${probe.label}`;
    if (seen.has(label)) continue;
    seen.add(label);
    const doc = probe.apply(base);
    const j = jsonValid(doc);
    const zz = zodValid(doc);
    if (!j && zz) looser.push(label);
    if (j && !zz) stricter.push(label);
  }
  return { looser, stricter, count: seen.size };
}

const partitionApi = jsonSchema(PARTITION_SCHEMA);
const manifestApi = jsonSchema(MANIFEST_SCHEMA);
/** Değişiklik taraması yüzlerce ayrıştırma yapar; yük altındaki makinede varsayılan 5 sn yerine bu testlere açık süre. */
const HEAVY_MS = 30_000;

/** Koleksiyon başına tarama bir kez yapılır; hem koleksiyon testi hem bayat-istisna testi aynı sonucu kullanır. */
const envelopeResults = new Map<CollectionName, { base: unknown; parse: (d: unknown) => boolean; result: ReturnType<typeof compare> }>();
function envelopeResult(collection: CollectionName) {
  const cached = envelopeResults.get(collection);
  if (cached) return cached;
  const base = { schemaVersion: 1, collection, records: [firstRecord(collection)] };
  const parse = (d: unknown) => {
    try {
      parsePartition(collection, d);
      return true;
    } catch {
      return false;
    }
  };
  const probes = probesFor(partitionApi, PARTITION_SCHEMA, base, [], []);
  const entry = { base, parse, result: compare(`zarf:${collection}`, probes, base, (d) => partitionApi.valid(PARTITION_SCHEMA, d), parse) };
  envelopeResults.set(collection, entry);
  return entry;
}

describe('kayma: data-platform JSON Şeması ↔ Zod', () => {
  it('değerlendirici şemalardaki bütün anahtar sözcükleri tanır', () => {
    const used = new Set([...schemaKeywords(PARTITION_SCHEMA), ...schemaKeywords(MANIFEST_SCHEMA)]);
    expect([...used].filter((k) => !SUPPORTED_KEYWORDS.has(k))).toEqual([]);
  });

  it('desenler kelimesi kelimesine aynıdır (ondalık, para birimi, nesil kimliği, koleksiyon adı)', () => {
    const defs = PARTITION_SCHEMA.$defs as Record<string, JsonObject>;
    const pattern = (schema: z.ZodType) => (z.toJSONSchema(schema) as { pattern?: string }).pattern;
    expect(pattern(Decimal)).toBe(defs.decimal!.pattern);
    expect(pattern(Currency)).toBe(((defs.money!.properties as JsonObject).currency as JsonObject).pattern);
    const manifestProps = MANIFEST_SCHEMA.properties as Record<string, JsonObject>;
    type Node = { pattern?: string; additionalProperties?: unknown; properties: Record<string, Node>; items: Node };
    const manifestJson = z.toJSONSchema(Manifest, { unrepresentable: 'any' }) as unknown as Node;
    expect(manifestJson.properties.generation_id!.pattern).toBe(manifestProps.generation_id!.pattern);
    const fileItem = ((manifestProps.files as JsonObject).items as JsonObject).properties as Record<string, JsonObject>;
    expect(manifestJson.properties.files!.items.properties.sha256!.pattern).toBe(fileItem.sha256!.pattern);
    const envelopeProps = PARTITION_SCHEMA.properties as Record<string, JsonObject>;
    const envelopeJson = z.toJSONSchema(PartitionEnvelope, { unrepresentable: 'any' }) as unknown as Node;
    expect(envelopeJson.properties.collection!.pattern).toBe(envelopeProps.collection!.pattern);
    expect(envelopeJson.additionalProperties).toBe(PARTITION_SCHEMA.additionalProperties);
  });

  it('manifest: şemanın reddettiğini Zod da reddeder, kabul ettiğini kabul eder', () => {
    // Parça dosyası başa alınır ki dosya girdisi değişiklikleri parça kurallarına da değsin.
    const files = [...MANIFEST_RAW.files].sort((a, b) => Number(b.kind === 'partition') - Number(a.kind === 'partition'));
    const base = { ...MANIFEST_RAW, files };
    expect(manifestApi.valid(MANIFEST_SCHEMA, base)).toBe(true);
    expect(Manifest.safeParse(base).success).toBe(true);
    const probes = probesFor(manifestApi, MANIFEST_SCHEMA, base, [], []);
    const result = compare('manifest', probes, base, (d) => manifestApi.valid(MANIFEST_SCHEMA, d), (d) => Manifest.safeParse(d).success);
    expect(result.count).toBeGreaterThan(400);
    expect(result.looser).toEqual([]);
    expect(result.stricter.filter((l) => !STRICTER_BY_DESIGN.some((e) => e.where.test(l)))).toEqual([]);
    STRICTER_BY_DESIGN.filter((e) => e.where.source.startsWith('^manifest')).forEach((e) => expect(result.stricter.some((l) => e.where.test(l)), e.why).toBe(true));
  }, HEAVY_MS);

  it.each(PANEL_COLLECTIONS)('zarf ve kayıt (%s): şemanın reddettiğini Zod da reddeder, kabul ettiğini kabul eder', (collection) => {
    const { base, parse, result } = envelopeResult(collection);
    expect(partitionApi.valid(PARTITION_SCHEMA, base)).toBe(true);
    expect(parse(base)).toBe(true);
    expect(result.count).toBeGreaterThan(500);
    expect(result.looser).toEqual([]);
    expect(result.stricter.filter((l) => !STRICTER_BY_DESIGN.some((e) => e.where.test(l)))).toEqual([]);
  }, HEAVY_MS);

  it('bilinçli sıkılık listesinde kullanılmayan (bayat) girdi yok', () => {
    const labels = PANEL_COLLECTIONS.flatMap((collection) => envelopeResult(collection).result.stricter);
    const unused = STRICTER_BY_DESIGN.filter((e) => e.where.source.startsWith('^zarf') && !labels.some((l) => e.where.test(l)));
    expect(unused.map((e) => e.why)).toEqual([]);
  }, HEAVY_MS * 4);
});

// --- postgres-mapping.json -------------------------------------------------------------------------------------
/** Eşleme tipine göre yanlış değerler; numeric için sayı tipi de reddedilmeli (para number'a çevrilmeden doğrulanır). */
const WRONG_BY_TYPE: Record<string, unknown[]> = {
  uuid: ['x', 7, UUID.slice(0, 35)],
  'uuid[]': [['x'], 'x'],
  date: ['01.11.2026', '2026-02-30', '2026-11-01T00:00:00Z', 20261101],
  numeric: ['1,5', 1.5, '1e3', '', ' 1', 'NaN'],
  integer: [1.5, '1'],
  boolean: ['true', 1, null],
  'char(3)': ['tl', 'TRYX', '₺'],
  text: [7, true, {}],
  timestamptz: ['dün', '2026-10-20', '2026-10-20T09:30:00'],
  jsonb: [],
};

/** Eşlemeden bilerek ayrılınan yerler (gerekçeli). */
const MAPPING_EXCEPTIONS: { where: RegExp; why: string }[] = [
  {
    where: /\.attributes\.son_op_id: text 7$|\.attributes\.son_op_id: text true$|\.attributes\.son_op_id: text \{\}$/,
    why: 'attributes.son_op_id "metin" türündedir ve normalize.mjs bu türü dönüştürmez; panel bu alanı okumaz, kaynak hücre başka tipte olabilir',
  },
];

const mappingFields = (entry: (typeof MAPPING.collections)[number]): MappingField[] =>
  [...(entry.include_field_groups ?? []).flatMap((g) => MAPPING.field_groups[g] ?? []), ...entry.fields].filter((f) => !f.source_path.startsWith('$'));

function getAt(doc: unknown, path: string[]): unknown {
  return path.reduce<unknown>((n, k) => (isObject(n) ? n[k] : undefined), doc);
}

/** Yolun ebeveynleri yoksa (ör. amounts.quote null) geçerli bir tohum koyar: kardeş amount+currency varsa para, yoksa boş nesne. */
function seeded(record: JsonObject, path: string[], siblings: Set<string>): JsonObject {
  const copy = structuredClone(record);
  let node: JsonObject = copy;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const prefix = path.slice(0, i + 1).join('.');
    if (!isObject(node[key])) node[key] = siblings.has(`${prefix}.amount`) && siblings.has(`${prefix}.currency`) ? { ...MONEY_OK } : {};
    node = node[key] as JsonObject;
  }
  return copy;
}

describe('kayma: postgres-mapping alan/null/tip ↔ Zod', () => {
  const entries = MAPPING.collections.filter((c) => (PANEL_COLLECTIONS as string[]).includes(c.collection));

  it('eşleme panelin her koleksiyonunu tanımlar; eşlemedeki her tip için yanlış değer listesi vardır', () => {
    expect(entries.map((c) => c.collection).sort()).toEqual([...PANEL_COLLECTIONS].sort());
    const types = new Set(entries.flatMap((c) => mappingFields(c).map((f) => f.postgres_type)));
    expect([...types].filter((t) => !(t in WRONG_BY_TYPE))).toEqual([]);
  });

  it.each(PANEL_COLLECTIONS)('%s: NOT NULL alan eksik/null reddedilir; yanlış tip reddedilir', (collection) => {
    const entry = entries.find((c) => c.collection === collection)!;
    const fields = mappingFields(entry);
    const siblings = new Set(fields.map((f) => f.source_path));
    const schema = collectionSchemas[collection];
    const record = firstRecord(collection);
    const failures: string[] = [];
    const used = new Set<RegExp>();
    const accepts = (doc: unknown) => schema.safeParse(doc).success;
    const expectReject = (label: string, doc: unknown) => {
      if (!accepts(doc)) return;
      const exception = MAPPING_EXCEPTIONS.find((e) => e.where.test(label));
      if (exception) used.add(exception.where);
      else failures.push(label);
    };
    for (const field of fields) {
      const path = field.source_path.split('.');
      const base = seeded(record, path, siblings);
      if (!accepts(base)) {
        failures.push(`${collection}.${field.source_path}: tohumlu temel kayıt geçersiz`);
        continue;
      }
      const key = path[path.length - 1]!;
      const withValue = (value: unknown, remove = false) => {
        const copy = structuredClone(base);
        const target = (path.length > 1 ? getAt(copy, path.slice(0, -1)) : copy) as JsonObject;
        if (remove) delete target[key];
        else target[key] = value;
        return copy;
      };
      if (!field.nullable) {
        expectReject(`${collection}.${field.source_path}: NOT NULL eksik`, withValue(undefined, true));
        expectReject(`${collection}.${field.source_path}: NOT NULL null`, withValue(null));
      }
      for (const wrong of WRONG_BY_TYPE[field.postgres_type] ?? []) {
        expectReject(`${collection}.${field.source_path}: ${field.postgres_type} ${JSON.stringify(wrong)}`, withValue(wrong));
      }
    }
    expect(failures).toEqual([]);
  });

  it('makine okunur eşitlik kontrolleri Zod tarafından uygulanır; nitelikli olanlar listelenir', () => {
    const qualified: string[] = [];
    const failures: string[] = [];
    for (const entry of entries) {
      const collection = entry.collection as CollectionName;
      const schema = collectionSchemas[collection];
      const record = firstRecord(collection);
      for (const check of entry.checks ?? []) {
        const eq = /^(\w+) = ('([^']*)'|true|false)(?: and (\w+) = '([^']*)')?(.*)$/.exec(check);
        const inList = /^(\w+) in ([a-z_,]+)\.$/.exec(check);
        if (eq) {
          const rest = eq[6]!;
          if (/for (this|the current) export/.test(rest)) {
            qualified.push(`${collection}: ${check}`);
            continue;
          }
          if (!(rest === '.' || rest.startsWith(';'))) {
            failures.push(`${collection}: tanınmayan kontrol biçimi: ${check}`);
            continue;
          }
          const pairs: [string, unknown][] = [[eq[1]!, eq[3] !== undefined ? eq[3] : eq[2] === 'true']];
          if (eq[4]) pairs.push([eq[4], eq[5]]);
          for (const [field, expected] of pairs) {
            if (!schema.safeParse({ ...record, [field]: expected }).success) failures.push(`${collection}.${field}: beklenen ${JSON.stringify(expected)} reddedildi`);
            const other = typeof expected === 'boolean' ? !expected : `${String(expected)}_baska`;
            if (schema.safeParse({ ...record, [field]: other }).success) failures.push(`${collection}.${field}: ${JSON.stringify(other)} kabul edildi (${check})`);
          }
        } else if (inList) {
          const [, field, list] = inList;
          for (const value of list!.split(',')) if (!schema.safeParse({ ...record, [field!]: value }).success) failures.push(`${collection}.${field}: ${value} reddedildi`);
          if (schema.safeParse({ ...record, [field!]: 'liste_disi' }).success) failures.push(`${collection}.${field}: liste dışı değer kabul edildi`);
        }
      }
    }
    expect(failures).toEqual([]);
    // Nitelikli ("bu dışa aktarım için") kontroller değişmez sayılmaz; listede yeni bir girdi bilinçli karar ister.
    expect(qualified).toEqual(["workflows: status = 'proposed_template' for this export."]);
  });

  it('ilişki türleri typed_relation_rules ile aynıdır', () => {
    const kinds = Object.keys(MAPPING.typed_relation_rules);
    const record = firstRecord('relations');
    for (const kind of kinds) expect(collectionSchemas.relations.safeParse({ ...record, kind }).success, kind).toBe(true);
    expect(collectionSchemas.relations.safeParse({ ...record, kind: 'payment' }).success).toBe(false);
  });

  it('media_references: yalnız http/https adresi kabul edilir (eşleme: "Allow only http/https references")', () => {
    const record = firstRecord('media_references');
    for (const url of ['https://example.invalid/a.jpg', 'http://example.invalid/b.webp']) expect(collectionSchemas.media_references.safeParse({ ...record, url }).success, url).toBe(true);
    for (const url of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://example.invalid/a.jpg', 'file:///etc/passwd']) {
      expect(collectionSchemas.media_references.safeParse({ ...record, url }).success, url).toBe(false);
    }
  });
});

describe('kayma: üretici kapısı ve koleksiyon listesi', () => {
  const gate = producerGate(GENERATION_DIR);

  it('validate.mjs sentetik nesli geçirir ve Zod her parçayı kayıpsız ayrıştırır (çıktı girdiyle birebir aynı)', () => {
    expect(gate.valid).toBe(true);
    for (const file of MANIFEST_RAW.files.filter((f) => f.kind === 'partition')) {
      const raw = readJson(GENERATION_DIR, file.path);
      expect(parsePartition(file.collection as CollectionName, raw), file.path).toEqual(raw);
    }
  });

  it('üreticinin koleksiyonları = panelin şemaları + bilerek indirilmeyenler', () => {
    const NOT_DOWNLOADED = ['payments', 'providers', 'source_cells', 'source_rows', 'unclassified_items'];
    const producer = [...gate.allowed].sort();
    expect(producer).toEqual([...PANEL_COLLECTIONS, ...NOT_DOWNLOADED].sort());
    expect(MAPPING.collections.map((c) => c.collection).sort()).toEqual(producer);
  });

  it('sentetik nesildeki şema ve eşleme kopyaları data-platform ile bayt bayt aynıdır', () => {
    for (const [inGeneration, inRepo] of [
      ['schemas/partition.schema.json', 'schemas/partition.schema.json'],
      ['schemas/manifest.schema.json', 'schemas/manifest.schema.json'],
      ['schemas/source-manifest.schema.json', 'schemas/source-manifest.schema.json'],
      ['contracts/postgres-mapping.json', 'postgres-mapping.json'],
    ] as const) {
      expect(readFileSync(join(GENERATION_DIR, inGeneration), 'utf8'), inGeneration).toBe(readFileSync(join(DATA_PLATFORM, inRepo), 'utf8'));
    }
  });
});
