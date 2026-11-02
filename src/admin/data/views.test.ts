import { describe, expect, it } from 'vitest';
import dictionary from '../../../data-platform/dictionaries/views.json';
import fixturePartition from '../../../fixtures/generation-synthetic/d062d4882617b40bffe4d2b0b603125a949c8795992611af1be08f6ef6b7ed10/data/view_definitions/global/00000.json';
import { VIEW_MODES } from '../shell/contracts';
import { createViewCatalog, defaultFilterOpen, readViewDefinitions, type PivotMeasure, type ViewDefinitionInput } from './views';

// Sözlük (data-platform/dictionaries/views.json) ile nesildeki view_definitions aynı altı tanımı taşır; ikisi de okunur.
const catalog = createViewCatalog(dictionary as ViewDefinitionInput[]);

describe('supportedModes', () => {
  it('alımlar için liste, tablo, zaman çizelgesi ve kanban; Gantt ve pivot yok', () => {
    expect(catalog.supportedModes('purchase_need')).toEqual(['listing', 'table', 'timeline', 'kanban']);
  });

  it('işler için Gantt var, pivot yok; sıra VIEW_MODES sırasıdır', () => {
    const modes = catalog.supportedModes('work_order');
    expect(modes).toEqual(['listing', 'table', 'timeline', 'kanban', 'gantt_chart']);
    expect(modes).toEqual(VIEW_MODES.filter((mode) => modes.includes(mode)));
  });

  it('bütçe gözlemleri için liste, tablo ve pivot', () => {
    expect(catalog.supportedModes('budget_observation')).toEqual(['listing', 'table', 'pivot']);
  });

  it('tahmin ayı yalnız tabloda', () => {
    expect(catalog.supportedModes('forecast_month')).toEqual(['table']);
  });

  it('bilinmeyen tür hiçbir modu desteklemez', () => {
    expect(catalog.supportedModes('something_else')).toEqual([]);
  });

  it('aynı anahtarın birden çok sürümünde en yüksek sürüm geçerlidir', () => {
    const older = { key: 'listing', version: 1, supported_kinds: ['purchase_need'] };
    const newer = { key: 'listing', version: 2, supported_kinds: ['milestone'] };
    const versioned = createViewCatalog([older, newer]);
    expect(versioned.supportedModes('purchase_need')).toEqual([]);
    expect(versioned.supportedModes('milestone')).toEqual(['listing']);
  });
});

describe('unsupportedReason', () => {
  it('desteklenen modda gerekçe yok', () => {
    expect(catalog.unsupportedReason('purchase_need', 'listing')).toBeNull();
    expect(catalog.unsupportedReason('work_order', 'gantt_chart')).toBeNull();
    expect(catalog.unsupportedReason('budget_observation', 'pivot')).toBeNull();
  });

  it('alımlar için Gantt gerekçesi tasarım metniyle birebir aynıdır', () => {
    expect(catalog.unsupportedReason('purchase_need', 'gantt_chart')).toBe('Gantt kullanılamaz: alımların başlangıç ve bitiş tarihi yok.');
  });

  it('pivot gerekçesi sahipliği belirlenmiş ölçü eksikliğini söyler', () => {
    const reason = catalog.unsupportedReason('purchase_need', 'pivot');
    expect(reason).toMatch(/^Pivot kullanılamaz: alımların /);
    expect(reason).toMatch(/sahipli/);
    expect(reason?.endsWith('.')).toBe(true);
  });

  it('her gerekçe "<Mod etiketi> kullanılamaz: " ile başlar ve noktayla biter', () => {
    const reason = catalog.unsupportedReason('budget_observation', 'kanban');
    expect(reason).toMatch(/^Kanban kullanılamaz: bütçe gözlemlerinin .+\.$/);
    expect(catalog.unsupportedReason('forecast_month', 'timeline')).toMatch(/^Zaman çizelgesi kullanılamaz: tahmin aylarının .+\.$/);
  });

  it('bilinmeyen tür için gerekçe "bu kayıtların" der', () => {
    expect(catalog.unsupportedReason('something_else', 'table')).toMatch(/^Tablo kullanılamaz: bu kayıtların .+\.$/);
  });

  it('nesilde tanım yoksa bunu söyler', () => {
    const empty = createViewCatalog([]);
    expect(empty.supportedModes('purchase_need')).toEqual([]);
    expect(empty.unsupportedReason('purchase_need', 'listing')).toBe('Liste kullanılamaz: görünüm tanımı nesilde yok.');
  });
});

describe('defaultFilterOpen', () => {
  it('liste ve zaman çizelgesinde filtre paneli açık, diğerlerinde şerit', () => {
    expect(defaultFilterOpen('listing')).toBe(true);
    expect(defaultFilterOpen('timeline')).toBe(true);
    expect(defaultFilterOpen('table')).toBe(false);
    expect(defaultFilterOpen('kanban')).toBe(false);
    expect(defaultFilterOpen('gantt_chart')).toBe(false);
    expect(defaultFilterOpen('pivot')).toBe(false);
  });
});

describe('pivotMeasures', () => {
  const measures = catalog.pivotMeasures('budget_observation');
  const sums = measures.filter((m): m is PivotMeasure & { aggregate: 'sum' } => m.aggregate === 'sum');

  it('bütçe gözlemlerinde sayım ve basis başına ayrı toplam vardır', () => {
    expect(measures.some((m) => m.aggregate === 'count')).toBe(true);
    expect(sums.map((m) => m.basis).sort()).toEqual(['planned', 'recorded_aggregate']);
    for (const sum of sums) expect(sum.field).toBe('value.decimal');
  });

  it('plan ve gerçek tek toplamda birleşmez; basis belirsiz ölçü yok', () => {
    expect(sums.every((m) => typeof m.basis === 'string' && m.basis.length > 0)).toBe(true);
    expect(sums.some((m) => m.basis === 'unclassified')).toBe(false);
    const planned = sums.find((m) => m.basis === 'planned');
    const recorded = sums.find((m) => m.basis === 'recorded_aggregate');
    expect(planned?.id).not.toBe(recorded?.id);
    expect(planned?.label).not.toBe(recorded?.label);
  });

  it('tahminler toplanmaz; ödemelerin kaynakta kaydı yok; alımlar pivotta değil', () => {
    expect(catalog.pivotMeasures('forecast_event')).toEqual([]);
    expect(catalog.pivotMeasures('forecast_month')).toEqual([]);
    expect(catalog.pivotMeasures('payment')).toEqual([]);
    expect(catalog.pivotMeasures('purchase_need')).toEqual([]);
  });

  it('sözlük sum_measures alanı sahiplik haritasını genişletemez', () => {
    const widened = createViewCatalog([
      { key: 'pivot', version: 1, supported_kinds: ['budget_observation', 'forecast_event'], aggregation: { allowed: ['count', 'sum'], sum_measures: { forecast_event: 'cash_change.amount', budget_observation: 'value.decimal' } } },
    ]);
    expect(widened.pivotMeasures('forecast_event').filter((m) => m.aggregate === 'sum')).toEqual([]);
    expect(widened.pivotMeasures('budget_observation').filter((m) => m.aggregate === 'sum')).toHaveLength(2);
  });
});

describe('readViewDefinitions', () => {
  it('nesil parçasını okur ve sözlükle aynı sonuca varır', () => {
    const fromGeneration = createViewCatalog(readViewDefinitions(fixturePartition));
    for (const kind of ['purchase_need', 'work_order', 'milestone', 'budget_observation', 'forecast_event', 'forecast_month', 'inspection']) {
      expect(fromGeneration.supportedModes(kind)).toEqual(catalog.supportedModes(kind));
      for (const mode of VIEW_MODES) expect(fromGeneration.unsupportedReason(kind, mode)).toBe(catalog.unsupportedReason(kind, mode));
    }
    expect(fromGeneration.pivotMeasures('budget_observation')).toEqual(catalog.pivotMeasures('budget_observation'));
  });

  it('yanlış koleksiyon veya şema sürümünü reddeder', () => {
    expect(() => readViewDefinitions({ schemaVersion: 1, collection: 'terms', records: [] })).toThrow(/view_definitions/);
    expect(() => readViewDefinitions({ schemaVersion: 2, collection: 'view_definitions', records: [] })).toThrow(/schemaVersion/);
  });

  it('silinmiş tanımları atlar', () => {
    const defs = readViewDefinitions({
      schemaVersion: 1,
      collection: 'view_definitions',
      records: [
        { id: 'a', tenant_id: 't', key: 'listing', version: 1, status: 'proposed_template', supported_kinds: ['purchase_need'], deleted_at: '2026-10-01T00:00:00Z' },
        { id: 'b', tenant_id: 't', key: 'table', version: 1, status: 'proposed_template', supported_kinds: ['purchase_need'] },
      ],
    });
    expect(createViewCatalog(defs).supportedModes('purchase_need')).toEqual(['table']);
  });
});
