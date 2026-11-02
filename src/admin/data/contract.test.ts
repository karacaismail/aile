import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  BudgetObservation,
  Decimal,
  ForecastEvent,
  IsoDate,
  Manifest,
  MediaReference,
  Money,
  PartitionEnvelope,
  Period,
  PurchaseNeed,
  Relation,
  Term,
  ViewDefinition,
  WorkflowDefinition,
  collectionSchemas,
  parseManifest,
  parsePartition,
} from './contract';
import type { CollectionName } from './types';

// Sentetik nesil: fixtures/generation-synthetic/<sha256>/ (tek klasör; gerçek nesil Git dışındadır).
const FIXTURE_ROOT = join(process.cwd(), 'fixtures', 'generation-synthetic');
const GENERATION_DIR = join(FIXTURE_ROOT, readdirSync(FIXTURE_ROOT).find((d) => /^[0-9a-f]{64}$/.test(d)) ?? '');
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(GENERATION_DIR, rel), 'utf8'));
const manifestRaw = readJson('manifest.json') as { files: { kind: string; path: string; collection?: string; count?: number }[] };
const partitions = manifestRaw.files.filter((f) => f.kind === 'partition');

const TENANT = '89bb71d8-2e82-56a2-b231-843cbc783ba2';
const ID = '07a8cb8b-8cd5-5475-a49f-f07dfa0759fc';
const TERM = 'e9e8380c-00ed-5e8d-b54e-24ee8fae5645';

function purchaseNeedFixture(): Record<string, unknown> {
  const env = readJson('data/purchase_needs/household/00000.json') as { records: Record<string, unknown>[] };
  return structuredClone(env.records[0]);
}

describe('contract: sentetik nesil', () => {
  it('manifest parse olur ve dosya/count alanları korunur', () => {
    const m = parseManifest(readJson('manifest.json'));
    expect(m.schemaVersion).toBe(1);
    expect(m.tenant_id).toBe(TENANT);
    expect(m.files.length).toBe(manifestRaw.files.length);
    expect(m.counts.purchase_needs).toBe(28);
    // Bilinmeyen alan kaybolmaz (synthetic, currency_policy manifest şemasında adlandırılmamış).
    expect((m as Record<string, unknown>).synthetic).toBe(true);
  });

  it('manifest: bozuk şema sürümü reddedilir', () => {
    const raw = readJson('manifest.json') as Record<string, unknown>;
    expect(() => Manifest.parse({ ...raw, schemaVersion: 2 })).toThrow(ZodError);
    expect(() => Manifest.parse({ ...raw, tenant_id: 'tenant-1' })).toThrow(ZodError);
  });

  it('panelin indirdiği her koleksiyon için şema vardır', () => {
    const names = new Set(partitions.map((p) => p.collection));
    for (const name of names) expect(collectionSchemas, `şema: ${name}`).toHaveProperty(String(name));
  });

  it.each(partitions.map((p) => [p.path, p.collection as CollectionName, p.count] as const))(
    '%s parse olur',
    (path, collection, count) => {
      const parsed = parsePartition(collection, readJson(path));
      expect(parsed.collection).toBe(collection);
      expect(parsed.records).toHaveLength(count ?? 0);
      for (const r of parsed.records) {
        expect(r.tenant_id).toBe(TENANT);
        expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
      }
    },
  );

  it('zarf: koleksiyon adı eşleşmezse reddedilir', () => {
    const env = readJson('data/rooms/household/00000.json');
    expect(() => parsePartition('terms', env)).toThrow(ZodError);
  });

  it('zarf: records dizisi zorunlu, schemaVersion 1 zorunlu', () => {
    expect(() => PartitionEnvelope.parse({ schemaVersion: 1, collection: 'rooms' })).toThrow(ZodError);
    expect(() => PartitionEnvelope.parse({ schemaVersion: '1', collection: 'rooms', records: [] })).toThrow(ZodError);
    expect(() => PartitionEnvelope.parse({ schemaVersion: 1, collection: 'Rooms', records: [] })).toThrow(ZodError);
  });

  it('bilinmeyen kayıt alanları passthrough ile korunur', () => {
    const r = purchaseNeedFixture();
    r.yeni_alan = { not: 'ileride eklenen alan' };
    const parsed = PurchaseNeed.parse(r) as Record<string, unknown>;
    expect(parsed.yeni_alan).toEqual({ not: 'ileride eklenen alan' });
    expect(parsed.attributes).toEqual(r.attributes);
  });
});

describe('contract: para', () => {
  it('ondalık metin kabul edilir; sayıya çevrilmez', () => {
    expect(Money.parse({ amount: '8500.00', currency: 'TRY' })).toEqual({ amount: '8500.00', currency: 'TRY' });
    expect(Decimal.parse('-12.5')).toBe('-12.5');
    expect(Decimal.parse('0')).toBe('0');
  });

  it('boş tutar sıfıra dönmez, reddedilir', () => {
    expect(() => Money.parse({ amount: '', currency: 'TRY' })).toThrow(ZodError);
    expect(() => Decimal.parse('')).toThrow(ZodError);
  });

  it('"1,5" (virgüllü) ve sayı tipinde tutar reddedilir', () => {
    expect(() => Money.parse({ amount: '1,5', currency: 'TRY' })).toThrow(ZodError);
    expect(() => Money.parse({ amount: 1.5, currency: 'TRY' })).toThrow(ZodError);
    expect(() => Decimal.parse('1.')).toThrow(ZodError);
    expect(() => Decimal.parse(' 1.5')).toThrow(ZodError);
  });

  it('para birimi 3 büyük harf olmalı', () => {
    expect(() => Money.parse({ amount: '1.00', currency: 'tl' })).toThrow(ZodError);
    expect(() => Money.parse({ amount: '1.00', currency: '₺' })).toThrow(ZodError);
    expect(() => Money.parse({ amount: '1.00' })).toThrow(ZodError);
  });

  it('Money null olabilir (planlanan/gerçek bilinmiyor); ama tek sayıda birleştirme yapılmaz', () => {
    const r = purchaseNeedFixture();
    const parsed = PurchaseNeed.parse(r);
    expect(parsed.amounts.actual).toBeNull();
    expect(parsed.amounts.planned).toEqual({ amount: '700.00', currency: 'TRY' });
  });

  it('purchase_need: amounts içindeki bozuk para reddedilir', () => {
    const r = purchaseNeedFixture();
    (r.amounts as Record<string, unknown>).planned = { amount: '', currency: 'TRY' };
    expect(() => PurchaseNeed.parse(r)).toThrow(ZodError);
  });
});

describe('contract: tarih ve dönem', () => {
  it('ISO gün kabul edilir', () => {
    expect(IsoDate.parse('2026-10-28')).toBe('2026-10-28');
  });

  it('geçersiz tarih reddedilir', () => {
    for (const bad of ['28.10.2026', '2026-13-01', '2026-02-30', '2026-10-28T10:00:00Z', '', 'yok']) {
      expect(() => IsoDate.parse(bad), bad).toThrow(ZodError);
    }
  });

  it('purchase_need.dates içinde geçersiz tarih reddedilir', () => {
    const r = purchaseNeedFixture();
    (r.dates as Record<string, unknown>).planned_on = '26.12.2026';
    expect(() => PurchaseNeed.parse(r)).toThrow(ZodError);
  });

  it('dönem YYYY-MM', () => {
    expect(Period.parse('2027-10')).toBe('2027-10');
    expect(() => Period.parse('2027-13')).toThrow(ZodError);
    expect(() => Period.parse('2027-1')).toThrow(ZodError);
    expect(() => Period.parse('10/2027')).toThrow(ZodError);
  });
});

describe('contract: kayıt şemaları', () => {
  it('purchase_need: term kimlikleri uuid; state_term_ids dört eksen', () => {
    const r = purchaseNeedFixture();
    r.category_term_id = 'mutfak_sofra';
    expect(() => PurchaseNeed.parse(r)).toThrow(ZodError);

    const r2 = purchaseNeedFixture();
    r2.context_term_ids = [TERM, 'x'];
    expect(() => PurchaseNeed.parse(r2)).toThrow(ZodError);

    const r3 = purchaseNeedFixture();
    r3.state_term_ids = { decision: TERM };
    expect(() => PurchaseNeed.parse(r3)).toThrow(ZodError);

    const r4 = purchaseNeedFixture();
    (r4.state_term_ids as Record<string, unknown>).payment = 'paid';
    expect(() => PurchaseNeed.parse(r4)).toThrow(ZodError);
  });

  it('term/vocabulary: code ve label zorunlu, parent null olabilir', () => {
    const ok = Term.parse({ id: ID, tenant_id: TENANT, vocabulary_id: TERM, code: 'beyaz_esya', label: 'Beyaz eşya', parent_id: null, legacy: false });
    expect(ok.parent_id).toBeNull();
    expect(() => Term.parse({ id: ID, tenant_id: TENANT, vocabulary_id: TERM, code: '', label: 'x', parent_id: null, legacy: false })).toThrow(ZodError);
    expect(() => Term.parse({ id: ID, tenant_id: TENANT, vocabulary_id: TERM, code: 'a', parent_id: null, legacy: false })).toThrow(ZodError);
    // order/active isteğe bağlı; verilirse tipi doğrulanır.
    expect(() => Term.parse({ id: ID, tenant_id: TENANT, vocabulary_id: TERM, code: 'a', label: 'A', parent_id: null, legacy: false, order: 'ilk' })).toThrow(ZodError);
  });

  it('relation: source_id, target_id uuid ve kind zorunlu', () => {
    expect(Relation.parse({ id: ID, tenant_id: TENANT, kind: 'located_in', source_id: TERM, target_id: ID }).kind).toBe('located_in');
    expect(() => Relation.parse({ id: ID, tenant_id: TENANT, kind: 'located_in', source_id: TERM })).toThrow(ZodError);
    expect(() => Relation.parse({ id: ID, tenant_id: TENANT, source_id: TERM, target_id: ID })).toThrow(ZodError);
  });

  it('media_reference: url ve verification zorunlu; license isteğe bağlı', () => {
    const base = { id: ID, tenant_id: TENANT, entity_id: TERM, kind: 'image_candidate', rights_status: 'unknown' };
    expect(MediaReference.parse({ ...base, url: 'https://example.invalid/a.jpg', verification: 'verified', license: 'CC0' }).license).toBe('CC0');
    expect(() => MediaReference.parse({ ...base, url: 'degil', verification: 'verified' })).toThrow(ZodError);
    expect(() => MediaReference.parse({ ...base, url: 'https://example.invalid/a.jpg' })).toThrow(ZodError);
  });

  it('budget_observation: period, basis, value.decimal metin', () => {
    const base = { id: ID, tenant_id: TENANT, kind: 'budget_observation', label: 'Satır', basis: 'planned', payment_evidence: false };
    expect(BudgetObservation.parse({ ...base, period: '2027-10', value: { decimal: '8500.00', currency: 'TRY' } }).value.decimal).toBe('8500.00');
    expect(BudgetObservation.parse({ ...base, period: '2027-10', value: { decimal: null, currency: null } }).value.decimal).toBeNull();
    expect(() => BudgetObservation.parse({ ...base, period: '2027-10', value: { decimal: 8500, currency: 'TRY' } })).toThrow(ZodError);
    expect(() => BudgetObservation.parse({ ...base, period: '2027/10', value: { decimal: '1', currency: 'TRY' } })).toThrow(ZodError);
    expect(() => BudgetObservation.parse({ ...base, period: '2027-10', value: { decimal: '1', currency: 'TRY' }, basis: 7 })).toThrow(ZodError);
  });

  it('forecast_event: occurred_on ISO gün, cash_change Money', () => {
    const base = { id: ID, tenant_id: TENANT, kind: 'forecast_event', forecast_id: TERM, event_type: 'purchase' };
    expect(ForecastEvent.parse({ ...base, occurred_on: '2026-11-01', cash_change: { amount: '16600.00', currency: 'TRY' } }).occurred_on).toBe('2026-11-01');
    expect(() => ForecastEvent.parse({ ...base, occurred_on: '01.11.2026' })).toThrow(ZodError);
    expect(() => ForecastEvent.parse({ ...base, cash_change: { amount: '16,600', currency: 'TRY' } })).toThrow(ZodError);
  });

  it('view_definition ve workflow: sürüm/geçiş alanları', () => {
    const vd = ViewDefinition.parse({ id: ID, tenant_id: TENANT, key: 'table', version: 1, status: 'proposed_template', capabilities: ['filter'], supported_kinds: ['purchase_need'], aggregation: null });
    expect(vd.key).toBe('table');
    expect(() => ViewDefinition.parse({ id: ID, tenant_id: TENANT, key: 'table', version: '1', status: 'proposed_template' })).toThrow(ZodError);

    const wf = WorkflowDefinition.parse({ id: ID, tenant_id: TENANT, key: 'task', version: 1, status: 'proposed_template', vocabulary_id: TERM, transitions: [{ from_term_id: TERM, to_term_id: ID, requires_evidence: false }] });
    expect(wf.transitions[0].requires_evidence).toBe(false);
    expect(() => WorkflowDefinition.parse({ id: ID, tenant_id: TENANT, key: 'task', version: 1, status: 'proposed_template', vocabulary_id: TERM, transitions: [{ from_term_id: 'a', to_term_id: ID, requires_evidence: false }] })).toThrow(ZodError);
    expect(() => WorkflowDefinition.parse({ id: ID, tenant_id: TENANT, key: 'task', version: 1, status: 'proposed_template', vocabulary_id: TERM })).toThrow(ZodError);
  });

  it('bilinmeyen koleksiyon adı için parsePartition hata verir', () => {
    expect(() => parsePartition('payments' as CollectionName, { schemaVersion: 1, collection: 'payments', records: [] })).toThrow();
  });
});
