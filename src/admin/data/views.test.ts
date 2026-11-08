import { describe, expect, it } from 'vitest';
import dictionary from '../../../data-platform/dictionaries/views.json';
import fixturePartition from '../../../fixtures/generation-synthetic/d062d4882617b40bffe4d2b0b603125a949c8795992611af1be08f6ef6b7ed10/data/view_definitions/global/00000.json';
import { VIEW_MODES } from '../shell/contracts';
import { TOTAL_UNAVAILABLE_TEXT, createViewCatalog, defaultFilterOpen, readViewDefinitions, type PivotMeasure, type ViewDefinitionInput } from './views';

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

  it('bütçe gözlemlerinde yalnız sayım var; toplam ölçüsü yok (nesilde satır düzeyinde yaprak sahipliği haritası yok)', () => {
    // budget_observation satırları kaynak sekmenin sayı taşıyan her satırıdır: yaprak gider kalemi, gelir, ara toplam
    // ("… toplamı"), genel toplam ("Toplam …") ve adet satırı aynı türdedir. Tür düzeyinde sahiplik bunları ayıramaz.
    expect(measures).toEqual([{ id: 'count', label: 'Kayıt sayısı', aggregate: 'count' }]);
    expect(sums).toEqual([]);
  });

  it('tahminler toplanmaz; ödemelerin kaynakta kaydı yok; alımlar pivotta değil', () => {
    expect(catalog.pivotMeasures('forecast_event')).toEqual([]);
    expect(catalog.pivotMeasures('forecast_month')).toEqual([]);
    expect(catalog.pivotMeasures('payment')).toEqual([]);
    expect(catalog.pivotMeasures('purchase_need')).toEqual([]);
  });

  it('sözlük sum_measures alanı tür düzeyinde toplama izni veremez (ownership_rule: yalnız açık yaprak-satır haritası)', () => {
    const widened = createViewCatalog([
      { key: 'pivot', version: 1, supported_kinds: ['budget_observation', 'forecast_event'], aggregation: { allowed: ['count', 'sum'], sum_measures: { forecast_event: 'cash_change.amount', budget_observation: 'value.decimal' } } },
    ]);
    expect(widened.pivotMeasures('forecast_event').filter((m) => m.aggregate === 'sum')).toEqual([]);
    expect(widened.pivotMeasures('budget_observation').filter((m) => m.aggregate === 'sum')).toEqual([]);
    expect(widened.pivotMeasures('budget_observation').map((m) => m.id)).toEqual(['count']);
  });

  it('sayım da yalnız tanım izin veriyorsa', () => {
    const countless = createViewCatalog([{ key: 'pivot', version: 1, supported_kinds: ['budget_observation'], aggregation: { allowed: ['sum'] } }]);
    expect(countless.pivotMeasures('budget_observation')).toEqual([]);
  });
});

describe('sumUnavailableReason', () => {
  it('bütçe gözlemleri: "Toplam kullanılamaz: …" ve toplamı bozacak satırları adıyla sayar', () => {
    const reason = catalog.sumUnavailableReason('budget_observation');
    expect(reason.startsWith(`${TOTAL_UNAVAILABLE_TEXT}: bütçe gözlemlerinin `)).toBe(true);
    expect(reason).toMatch(/yaprak/);
    expect(reason).toMatch(/gelir/);
    expect(reason).toMatch(/… toplamı/);
    expect(reason).toMatch(/Toplam …/);
    expect(reason).toMatch(/adet/);
    expect(reason.endsWith('.')).toBe(true);
  });

  it('başka türler için sahipliği belirlenmiş ölçünün yokluğunu söyler', () => {
    expect(catalog.sumUnavailableReason('purchase_need')).toBe('Toplam kullanılamaz: alımların sahipliği belirlenmiş toplanabilir ölçüsü yok.');
  });

  it('pivot (sayım) desteklendiği için mod gerekçesi değişmez', () => {
    expect(catalog.unsupportedReason('budget_observation', 'pivot')).toBeNull();
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
