// Sentetik nesil: fixtures/generation-synthetic/<sha256>/ data-platform sözleşmesine birebir uyar ve
// hiçbir gerçek aile verisi içermez. Üretici deterministik olduğu için test onu geçici klasöre yeniden
// üretir, çıktıyı data-platform doğrulayıcısından geçirir ve Git'teki kopyayla karşılaştırır.
// Üretici ayrı Node sürecinde koşar: data-platform modülleri import.meta.url ile sözlük okur ve Vite dönüşümü
// bunu file: dışı URL'ye çevirir; vitest.config.ts bu görevde değiştirilmez.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'synthetic-generation.mjs');
const fixtureRoot = path.join(root, 'fixtures', 'generation-synthetic');
const uuidV5 = /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const node = process.execPath;

let scratch;
/** @type {{directory: string, generationId: string, counts: Record<string, number>}} */
let produced;
/** @type {any} */
let manifest;
/** @type {Map<string, {collection: string, records: any[], bytes: Buffer}>} */
const partitions = new Map();
const records = collection => [...partitions.values()].filter(p => p.collection === collection).flatMap(p => p.records);

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'aile-synthetic-'));
  const { stdout } = await run(node, [script, scratch], { cwd: root });
  produced = JSON.parse(stdout);
  produced.directory = path.resolve(root, produced.directory);
  manifest = JSON.parse(await readFile(path.join(produced.directory, 'manifest.json'), 'utf8'));
  for (const file of manifest.files) {
    if (file.kind !== 'partition') continue;
    const bytes = await readFile(path.join(produced.directory, file.path));
    const envelope = JSON.parse(bytes.toString('utf8'));
    partitions.set(file.path, { collection: envelope.collection, records: envelope.records, bytes });
  }
}, 60_000);

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('sentetik nesil: manifest', () => {
  it('schemaVersion 1, sentetik tenant UUIDv5, private_only, snapshot tutarlılığı, klasör adı = generation_id', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.tenant_id).toMatch(uuidV5);
    expect(manifest.synthetic).toBe(true);
    expect(manifest.storage_policy).toBe('private_only');
    expect(manifest.consistency).toBe('snapshot_capture_not_transaction');
    expect(manifest.generation_id).toMatch(/^[a-f0-9]{64}$/);
    expect(path.basename(produced.directory)).toBe(manifest.generation_id);
    expect(produced.generationId).toBe(manifest.generation_id);
  });

  it('counts, partition kayıt sayıları ve dosya sha256 değerleri eşleşir', () => {
    const counted = {};
    for (const file of manifest.files) {
      if (file.kind !== 'partition') continue;
      const partition = partitions.get(file.path);
      expect(partition.records).toHaveLength(file.count);
      expect(partition.collection).toBe(file.collection);
      counted[file.collection] = (counted[file.collection] ?? 0) + file.count;
      expect(sha256(partition.bytes)).toBe(file.sha256);
      expect(partition.bytes.byteLength).toBe(file.bytes);
    }
    expect(counted).toEqual(manifest.counts);
    expect(produced.counts).toEqual(manifest.counts);
  });

  it('data-platform doğrulayıcısı (cli validate) geçer', async () => {
    const { stdout } = await run(node, [path.join(root, 'data-platform', 'cli.mjs'), 'validate', '--generation', produced.directory], { cwd: root });
    const result = JSON.parse(stdout);
    expect(result.valid).toBe(true);
    expect(result.generationId).toBe(manifest.generation_id);
  }, 60_000);

  it('manifest.sources sentetiktir, gerçek Sheet kimliği taşımaz', () => {
    expect(manifest.sources.length).toBeGreaterThan(0);
    for (const source of manifest.sources) {
      expect(source.capture.coverage).toBe('synthetic');
      expect(JSON.stringify(source)).toMatch(/sentetik|synthetic/i);
    }
  });
});

describe('sentetik nesil: koleksiyonlar', () => {
  it('purchase_needs ≥ 24; en az 3 kayıtta plan ve gerçek null; en az 2 silinmiş; oda/kategori/aşama/bağlam/ödeme çeşitli', () => {
    const needs = records('purchase_needs');
    expect(needs.length).toBeGreaterThanOrEqual(24);
    expect(needs.filter(r => r.amounts.planned === null && r.amounts.actual === null).length).toBeGreaterThanOrEqual(3);
    expect(needs.filter(r => r.deleted_at !== null).length).toBeGreaterThanOrEqual(2);
    expect(new Set(needs.map(r => r.room_id)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(needs.map(r => r.category_term_id)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(needs.map(r => r.phase_term_id)).size).toBeGreaterThanOrEqual(2);
    expect(needs.some(r => r.context_term_ids.length > 0)).toBe(true);
    expect(new Set(needs.map(r => r.state_snapshot.payment)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(needs.map(r => r.state_snapshot.decision)).size).toBeGreaterThanOrEqual(3);
    for (const need of needs) {
      expect(need.kind).toBe('purchase_need');
      for (const money of Object.values(need.amounts)) if (money !== null) expect(money).toMatchObject({ amount: expect.stringMatching(/^-?[0-9]+(\.[0-9]+)?$/), currency: 'TRY' });
    }
  });

  it('media_references 3: 1 doğrulanmış, 2 aday; rooms 6; sayılar görev kadar', () => {
    const media = records('media_references');
    expect(media).toHaveLength(3);
    expect(media.filter(m => m.verification === 'verified')).toHaveLength(1);
    expect(media.filter(m => m.verification === 'not_verified' && m.kind === 'image_candidate')).toHaveLength(2);
    expect(records('rooms')).toHaveLength(6);
    expect(records('forecast_events')).toHaveLength(20);
    expect(records('issues')).toHaveLength(10);
    expect(records('work_orders')).toHaveLength(8);
    expect(records('milestones')).toHaveLength(4);
    expect(records('inspections')).toHaveLength(5);
    expect(manifest.counts.payments).toBeUndefined();
    expect(manifest.counts.providers).toBeUndefined();
  });

  it('terms sözlükten gelir: her vocabularies kaydı en az bir terim taşır, kategori ağacı var', () => {
    const vocabularies = records('vocabularies');
    const terms = records('terms');
    expect(vocabularies.length).toBeGreaterThanOrEqual(13);
    for (const vocabulary of vocabularies) expect(terms.some(t => t.vocabulary_id === vocabulary.id), vocabulary.key).toBe(true);
    expect(terms.some(t => t.parent_id !== null)).toBe(true);
    expect(records('workflows')).toHaveLength(6);
    expect(records('view_definitions')).toHaveLength(6);
    expect(records('task_templates').length).toBeGreaterThan(0);
  });

  it('budget_observations: 24 ay × 8 satır, plan ve gerçek ayrı kayıt', () => {
    const observations = records('budget_observations');
    expect(new Set(observations.map(o => o.period)).size).toBe(24);
    expect(new Set(observations.map(o => o.label)).size).toBe(8);
    expect(observations.filter(o => o.basis === 'planned')).toHaveLength(24 * 8);
    expect(observations.filter(o => o.basis === 'recorded_aggregate')).toHaveLength(24 * 8);
    for (const o of observations) expect(o.payment_evidence).toBe(false);
  });

  it('relations tutarlı FK: her kaynak/hedef nesilde var, located_in hedefi oda', () => {
    const ids = new Map();
    for (const partition of partitions.values()) for (const record of partition.records) ids.set(record.id, partition.collection);
    const relations = records('relations');
    expect(relations.length).toBeGreaterThan(0);
    for (const relation of relations) {
      expect(ids.has(relation.source_id)).toBe(true);
      expect(ids.has(relation.target_id)).toBe(true);
      if (relation.kind === 'located_in') expect(ids.get(relation.target_id)).toBe('rooms');
    }
    expect(relations.some(r => r.kind === 'depends_on')).toBe(true);
  });

  it('hiçbir etiket gerçek ad gibi durmaz: "Örnek …" dizgeleri ve örnek alan adları', () => {
    for (const collection of ['purchase_needs', 'work_orders', 'rooms', 'milestones', 'inspections', 'lighting_specs', 'layout_items', 'forecast_events']) {
      for (const record of records(collection)) expect(record.label, `${collection}/${record.id}`).toMatch(/^Örnek /);
    }
    for (const media of records('media_references')) expect(new URL(media.url).hostname).toMatch(/\.invalid$/);
    for (const source of records('sources')) expect(source.spreadsheet_id).toMatch(/^synthetic-/);
  });
});

describe('sentetik nesil: Git kopyası', () => {
  it('fixtures/generation-synthetic tek nesil içerir ve geçici üretimle bayt bayt aynıdır (deterministik)', async () => {
    const entries = (await readdir(fixtureRoot, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
    expect(entries).toEqual([manifest.generation_id]);
    const committed = JSON.parse(await readFile(path.join(fixtureRoot, manifest.generation_id, 'manifest.json'), 'utf8'));
    expect(committed).toEqual(manifest);
    for (const file of manifest.files) {
      const bytes = await readFile(path.join(fixtureRoot, manifest.generation_id, file.path));
      expect(sha256(bytes), file.path).toBe(file.sha256);
    }
  });
});
