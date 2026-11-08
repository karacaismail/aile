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
const SOURCE = '6edfe45e-b55d-5905-9c03-28b30dee686d';

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

describe('contract: providers (e-tablodaki usta satırları)', () => {
  // data-platform/normalize.mjs: "usta" satırı kind 'provider' ile 'providers' koleksiyonuna, alımlarla aynı app_kalemler
  // gövdesiyle yazılır; postgres-mapping providers: kind = 'provider'. Taraflar sayfası bu koleksiyonu okur. Sentetik
  // nesilde usta satırı yok: kayıt alım gövdesinden yalnız tür değiştirilerek türetilir.
  const usta = () => ({ ...purchaseNeedFixture(), kind: 'provider', label: 'Usta Ali' });
  const zarf = (records: unknown[]) => ({ schemaVersion: 1, collection: 'providers', records });

  it('panel sözleşmesi providers koleksiyonunu tanır; usta satırı kayıpsız ayrışır', () => {
    expect(collectionSchemas).toHaveProperty('providers');
    const kayit = usta();
    expect(parsePartition('providers' as CollectionName, zarf([kayit])).records).toEqual([kayit]);
  });

  it('providers yalnız kind = provider taşır; alım ya da boş tür reddedilir', () => {
    for (const kind of ['purchase_need', 'unclassified_item', '']) {
      expect(() => parsePartition('providers' as CollectionName, zarf([{ ...usta(), kind }])), kind).toThrow(ZodError);
    }
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
    // Para birimi bilinmeyebilir (yerel biçim TRY demiyorsa); tutar ise sözleşmede NOT NULL (validate.mjs + postgres-mapping).
    expect(BudgetObservation.parse({ ...base, period: '2027-10', value: { decimal: '8500.00', currency: null } }).value.currency).toBeNull();
    expect(() => BudgetObservation.parse({ ...base, period: '2027-10', value: { decimal: null, currency: null } })).toThrow(ZodError);
    expect(() => BudgetObservation.parse({ ...base, period: '2027-10', value: { currency: 'TRY' } })).toThrow(ZodError);
    expect(() => BudgetObservation.parse({ ...base, period: '2027-10', value: { decimal: 8500, currency: 'TRY' } })).toThrow(ZodError);
    expect(() => BudgetObservation.parse({ ...base, period: '2027/10', value: { decimal: '1', currency: 'TRY' } })).toThrow(ZodError);
    expect(() => BudgetObservation.parse({ ...base, period: '2027-10', value: { decimal: '1', currency: 'TRY' }, basis: 7 })).toThrow(ZodError);
  });

  it('forecast_event: occurred_on ISO gün, cash_change Money', () => {
    const base = {
      id: ID, tenant_id: TENANT, kind: 'forecast_event', forecast_id: TERM, event_type: 'purchase', record_basis: 'forecast',
      source_id: SOURCE, source_record_id: 'olay-1', label: 'Olay', occurred_on: '2026-11-01',
    };
    expect(ForecastEvent.parse({ ...base, occurred_on: '2026-11-01', cash_change: { amount: '16600.00', currency: 'TRY' } }).occurred_on).toBe('2026-11-01');
    expect(() => ForecastEvent.parse({ ...base, occurred_on: '01.11.2026' })).toThrow(ZodError);
    expect(() => ForecastEvent.parse({ ...base, cash_change: { amount: '16,600', currency: 'TRY' } })).toThrow(ZodError);
  });

  it('view_definition ve workflow: sürüm/geçiş alanları', () => {
    const vd = ViewDefinition.parse({ id: ID, tenant_id: TENANT, key: 'table', label: 'Tablo', version: 1, status: 'proposed_template', capabilities: ['filter'], supported_kinds: ['purchase_need'], aggregation: null });
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

// --- Sözleşme sertleştirmesi: data-platform ile hizalı kurallar -------------------------------------------------
const firstOf = (collection: CollectionName): Record<string, unknown> => {
  // Sentetik nesilde usta satırı yok; normalize.mjs onu alım gövdesiyle, yalnız kind 'provider' olarak yazar.
  if ((collection as string) === 'providers') return { ...firstOf('purchase_needs'), kind: 'provider' };
  const file = partitions.find((p) => p.collection === collection);
  if (!file) throw new Error(`Sentetik nesilde koleksiyon yok: ${collection}`);
  return structuredClone((readJson(file.path) as { records: Record<string, unknown>[] }).records[0]!);
};
const envelopeOf = (collection: CollectionName, records: unknown[] = [firstOf(collection)]) => ({ schemaVersion: 1, collection, records });
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMoney = (v: Record<string, unknown>) => Object.keys(v).sort().join(',') === 'amount,currency';
const UNKNOWN_KEY = '__gelecek_alan__';
/** Bilinmeyen anahtara konacak değer adayları: serbest nesne, para, ISO gün, uuid. Düğümün kabul ettiği ilki kullanılır. */
const UNKNOWN_VALUES: unknown[] = [{ not: 'ileride eklenen alan' }, { amount: '1.00', currency: 'TRY' }, '2026-01-01', TERM, ['x'], 0];

function objectPaths(node: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(node)) return node.length ? objectPaths(node[0], [...path, 0]) : [];
  if (!isPlain(node)) return [];
  // Para zarfı şemada additionalProperties:false'tur; bilinmeyen anahtar orada reddedilir (aşağıda ayrıca sınanır).
  if (isMoney(node)) return [];
  return [path, ...Object.entries(node).flatMap(([k, v]) => objectPaths(v, [...path, k]))];
}
const at = (doc: unknown, path: (string | number)[]) => path.reduce<unknown>((n, k) => (n as Record<string | number, unknown>)[k], doc);

describe('contract: bilinmeyen alanlar kaybolmaz', () => {
  it.each(partitions.map((p) => p.collection as CollectionName).filter((c, i, all) => all.indexOf(c) === i))(
    '%s: kaydın her nesne düğümüne eklenen bilinmeyen alan ayrıştırmadan aynen çıkar',
    (collection) => {
      const record = firstOf(collection);
      const lost: string[] = [];
      for (const path of objectPaths(record)) {
        const kept = UNKNOWN_VALUES.some((value) => {
          const copy = structuredClone(record);
          (at(copy, path) as Record<string, unknown>)[UNKNOWN_KEY] = value;
          const result = collectionSchemas[collection].safeParse(copy);
          return result.success && JSON.stringify((at(result.data, path) as Record<string, unknown>)[UNKNOWN_KEY]) === JSON.stringify(value);
        });
        if (!kept) lost.push(path.join('.') || '(kayıt)');
      }
      expect(lost).toEqual([]);
    },
  );

  it('manifest: kök, dosya ve kaynak düğümlerindeki bilinmeyen alanlar korunur', () => {
    const raw = readJson('manifest.json') as Record<string, unknown>;
    const lost: string[] = [];
    for (const path of objectPaths(raw)) {
      const kept = UNKNOWN_VALUES.some((value) => {
        const copy = structuredClone(raw);
        (at(copy, path) as Record<string, unknown>)[UNKNOWN_KEY] = value;
        const result = Manifest.safeParse(copy);
        return result.success && JSON.stringify((at(result.data, path) as Record<string, unknown>)[UNKNOWN_KEY]) === JSON.stringify(value);
      });
      if (!kept) lost.push(path.join('.') || '(kök)');
    }
    expect(lost).toEqual([]);
  });

  it('zarf ve para zarfı kapalıdır: bilinmeyen alan sessizce düşürülmez, reddedilir (şema additionalProperties:false)', () => {
    expect(() => parsePartition('rooms', { ...envelopeOf('rooms'), ek: true })).toThrow(ZodError);
    expect(() => PartitionEnvelope.parse({ ...envelopeOf('rooms'), ek: true })).toThrow(ZodError);
    expect(() => Money.parse({ amount: '1.00', currency: 'TRY', ek: 1 })).toThrow(ZodError);
    const r = purchaseNeedFixture();
    (r.amounts as Record<string, unknown>).planned = { amount: '700.00', currency: 'TRY', kur: '1' };
    expect(() => PurchaseNeed.parse(r)).toThrow(ZodError);
  });
});

describe('contract: schemaVersion yalnız 1', () => {
  const BAD_VERSIONS: unknown[] = [2, 0, -1, 1.5, '1', null, true, undefined];

  it('manifest: 1 dışı her değer ve eksik sürüm reddedilir', () => {
    const raw = readJson('manifest.json') as Record<string, unknown>;
    for (const schemaVersion of BAD_VERSIONS) {
      const doc = { ...raw, schemaVersion };
      if (schemaVersion === undefined) delete doc.schemaVersion;
      expect(Manifest.safeParse(doc).success, String(schemaVersion)).toBe(false);
    }
  });

  it.each(collectionNames())('%s: zarf 1 dışı sürümle reddedilir', (collection) => {
    for (const schemaVersion of BAD_VERSIONS) {
      const doc: Record<string, unknown> = { ...envelopeOf(collection), schemaVersion };
      if (schemaVersion === undefined) delete doc.schemaVersion;
      expect(() => parsePartition(collection, doc), String(schemaVersion)).toThrow(ZodError);
    }
    expect(parsePartition(collection, envelopeOf(collection)).schemaVersion).toBe(1);
  });
});

function collectionNames(): CollectionName[] {
  return Object.keys(collectionSchemas) as CollectionName[];
}

describe('contract: para ondalık dizgedir, sayıya çevrilmeden doğrulanır', () => {
  it('çok basamaklı ve hassas ondalıklar birebir korunur (Number hassasiyeti aşılır)', () => {
    for (const amount of ['9007199254740993.01', '12345678901234567890.123456789012345678', '0.1', '-0.00', '007', '-12.5']) {
      expect(Decimal.parse(amount)).toBe(amount);
      expect(Money.parse({ amount, currency: 'TRY' }).amount).toBe(amount);
    }
  });

  it('sayı, üslü, NaN, boşluklu, satır sonlu ve yerel rakamlı tutarlar reddedilir', () => {
    for (const amount of [8500, 1.5, 0, '1e3', '1E3', 'NaN', 'Infinity', '+1', ' 1', '1 ', '1.5\n', '٣', '1_000', '0x10', '1.2.3']) {
      expect(Decimal.safeParse(amount).success, JSON.stringify(amount)).toBe(false);
    }
  });

  it('her para taşıyan alanda sayı tipindeki tutar reddedilir', () => {
    const asNumber = { amount: 8500, currency: 'TRY' };
    const cases: [CollectionName, (r: Record<string, unknown>) => void][] = [
      ['purchase_needs', (r) => { (r.amounts as Record<string, unknown>).estimated_min = asNumber; }],
      ['purchase_needs', (r) => { (r.amounts as Record<string, unknown>).gelecek_tutar = asNumber; }],
      ['budget_observations', (r) => { (r.value as Record<string, unknown>).decimal = 8500; }],
      ['forecast_events', (r) => { r.cash_change = asNumber; }],
      ['forecast_events', (r) => { (r.measures as Record<string, unknown>).planned = asNumber; }],
      ['forecast_months', (r) => { (r.measures as Record<string, unknown>).balance = asNumber; }],
      ['rooms', (r) => { r.amount = asNumber; }],
    ];
    for (const [collection, mutate] of cases) {
      const r = firstOf(collection);
      mutate(r);
      expect(collectionSchemas[collection].safeParse(r).success, `${collection}: ${JSON.stringify(r).slice(0, 60)}`).toBe(false);
    }
  });
});

describe('contract: data-platform ile hizalı kayıt kuralları', () => {
  it('budget_observation: payment_evidence sözleşmede yalnız false; true, "false" ve eksik reddedilir', () => {
    const r = firstOf('budget_observations');
    expect(BudgetObservation.parse(r).payment_evidence).toBe(false);
    for (const payment_evidence of [true, 'false', 0, null]) {
      expect(BudgetObservation.safeParse({ ...r, payment_evidence }).success, String(payment_evidence)).toBe(false);
    }
    const { payment_evidence: _omit, ...without } = r;
    expect(BudgetObservation.safeParse(without).success).toBe(false);
  });

  it('tahmin kayıtları record_basis "forecast" taşımak zorunda (gerçek işlem iddiası reddedilir)', () => {
    for (const collection of ['forecasts', 'forecast_events', 'forecast_months'] as const) {
      const r = firstOf(collection);
      expect(collectionSchemas[collection].safeParse(r).success, collection).toBe(true);
      expect(collectionSchemas[collection].safeParse({ ...r, record_basis: 'actual' }).success, collection).toBe(false);
      const { record_basis: _omit, ...without } = r;
      expect(collectionSchemas[collection].safeParse(without).success, collection).toBe(false);
    }
  });

  it('kalem koleksiyonu yalnız kendi türünü kabul eder', () => {
    const lighting = firstOf('lighting_specs');
    expect(() => parsePartition('purchase_needs', envelopeOf('purchase_needs', [lighting]))).toThrow(ZodError);
    expect(parsePartition('lighting_specs', envelopeOf('lighting_specs', [lighting])).records[0]!.kind).toBe('lighting_spec');
  });

  it('uygulama kayıtları (ayar, oda, kalem) etiket, kaynak kimliği ve öznitelik taşır', () => {
    for (const collection of ['settings', 'rooms', 'purchase_needs'] as const) {
      for (const key of ['label', 'source_id', 'source_record_id', 'source_attributes', 'attributes']) {
        const r = firstOf(collection);
        delete r[key];
        expect(collectionSchemas[collection].safeParse(r).success, `${collection}.${key}`).toBe(false);
      }
    }
  });

  it('deleted_at saat dilimli ISO zaman damgasıdır', () => {
    const r = purchaseNeedFixture();
    expect(PurchaseNeed.safeParse({ ...r, deleted_at: '2026-10-20T09:30:00.000Z' }).success).toBe(true);
    expect(PurchaseNeed.safeParse({ ...r, deleted_at: '2026-10-20T12:30:00+03:00' }).success).toBe(true);
    for (const deleted_at of ['dün', '2026-10-20', '2026-10-20T09:30:00', '']) {
      expect(PurchaseNeed.safeParse({ ...r, deleted_at }).success, deleted_at).toBe(false);
    }
  });

  it('terim: parent_id (null olabilir) ve legacy zorunlu', () => {
    const r = firstOf('terms');
    for (const key of ['parent_id', 'legacy']) {
      const copy = { ...r };
      delete copy[key];
      expect(Term.safeParse(copy).success, key).toBe(false);
    }
  });

  it('iş akışı geçişi iki uçta da terim kimliği taşır', () => {
    const r = firstOf('workflows') as { transitions: Record<string, unknown>[] };
    const copy = structuredClone(r);
    delete copy.transitions[0]!.from_term_id;
    expect(WorkflowDefinition.safeParse(copy).success).toBe(false);
  });

  it('issue: detail zorunlu, null olamaz', () => {
    const r = firstOf('issues');
    expect(collectionSchemas.issues.safeParse({ ...r, detail: null }).success).toBe(false);
    const { detail: _omit, ...without } = r;
    expect(collectionSchemas.issues.safeParse(without).success).toBe(false);
  });

  it('manifest: parça dosyası koleksiyon adı ve kayıt sayısı taşır; nesil kimliği sha256', () => {
    const raw = readJson('manifest.json') as { files: Record<string, unknown>[] } & Record<string, unknown>;
    const index = raw.files.findIndex((f) => f.kind === 'partition');
    for (const key of ['collection', 'count']) {
      const copy = structuredClone(raw);
      delete copy.files[index]![key];
      expect(Manifest.safeParse(copy).success, key).toBe(false);
    }
    expect(Manifest.safeParse({ ...raw, generation_id: 'gen-1' }).success).toBe(false);
    expect(Manifest.safeParse({ ...raw, generation_id: 'A'.repeat(64) }).success).toBe(false);
  });
});
