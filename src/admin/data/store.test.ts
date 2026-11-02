import { beforeEach, describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ContractError,
  GenerationStore,
  HEAVY_COLLECTIONS,
  HeavyCollectionError,
  IntegrityError,
  defaultPartitionCache,
  partitionPeriod,
  periodsBetween,
  type GenerationSource,
  type PartitionCache,
  type StoreStatus,
} from './store';
import type { ReadTextOptions } from './sources';
import type { CollectionName } from './types';

const FIXTURE_ROOT = path.resolve(__dirname, '../../../fixtures/generation-synthetic');

/** Sentetik nesli diskten okur; test başına bozma/çökme ayarlanabilir. */
class FixtureSource implements GenerationSource {
  readonly reads: string[] = [];
  corrupt = new Set<string>();
  failing = new Set<string>();
  failAll = false;
  /** Verilirse manifest.json yerine bu metin döner (yenilemede bozuk aday). */
  manifestOverride: string | null = null;
  readonly options: { path: string; options?: ReadTextOptions }[] = [];
  constructor(private readonly root: string) {}
  async readText(relative: string, options?: ReadTextOptions): Promise<string> {
    this.reads.push(relative);
    this.options.push({ path: relative, options });
    if (this.failAll || this.failing.has(relative)) throw new Error(`okunamadı: ${relative}`);
    if (relative === 'manifest.json' && this.manifestOverride !== null) return this.manifestOverride;
    const text = await readFile(path.join(this.root, relative), 'utf8');
    return this.corrupt.has(relative) ? `${text} ` : text;
  }
}

class MemoryCache implements PartitionCache {
  readonly map = new Map<string, string>();
  readonly gets: string[] = [];
  async get(key: string) {
    this.gets.push(key);
    return this.map.get(key);
  }
  async set(key: string, value: string) {
    this.map.set(key, value);
  }
}

let generationDir: string;
let generationId: string;
let source: FixtureSource;

async function manifestOf(dir: string) {
  return JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as {
    counts: Record<string, number>;
    files: { path: string; kind: string; collection?: string; count?: number }[];
  };
}

beforeEach(async () => {
  const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true });
  const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
  expect(dirs).toHaveLength(1);
  generationId = dirs[0]!;
  generationDir = path.join(FIXTURE_ROOT, generationId);
  source = new FixtureSource(generationDir);
});

function track(store: GenerationStore) {
  const states: StoreStatus['state'][] = [];
  store.subscribe(status => states.push(status.state));
  return states;
}

describe('GenerationStore › nesil yükleme', () => {
  it('başta idle; manifest doğrulanır ve generation_id okunur; checking → ready', async () => {
    const store = new GenerationStore(source, { cache: null });
    expect(store.status.state).toBe('idle');
    const states = track(store);
    const manifest = await store.loadManifest();
    expect(manifest.generation_id).toBe(generationId);
    expect(states).toEqual(['checking', 'ready']);
    expect(store.status).toMatchObject({ state: 'ready', generationId, lastGoodGenerationId: generationId, message: null });
    expect(store.status.lastReadAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(store.status.lastReadAt!))).toBe(false);
  });

  it('bozuk manifest sözleşmeyi geçmez → ContractError, state error', async () => {
    const broken: GenerationSource = { readText: async () => JSON.stringify({ schemaVersion: 1, generation_id: 'x' }) };
    const store = new GenerationStore(broken, { cache: null });
    await expect(store.loadManifest()).rejects.toBeInstanceOf(ContractError);
    expect(store.status.state).toBe('error');
    expect(store.status.message).toMatch(/^Hata: /);
  });

  it('koleksiyon: manifest.files içindeki parçaları bulur, hash doğrular, kayıtları yayınlar', async () => {
    const store = new GenerationStore(source, { cache: null });
    const manifest = await manifestOf(generationDir);
    const records = await store.loadCollection('purchase_needs');
    expect(records).toHaveLength(manifest.counts.purchase_needs!);
    expect(records[0]).toMatchObject({ id: expect.any(String), tenant_id: expect.any(String), kind: 'purchase_need' });
    expect(store.getCollection('purchase_needs')).toBe(records);
    // Yalnız manifest + ilgili parça okunur; bütün nesil indirilmez.
    const partitionReads = source.reads.filter(p => p.startsWith('data/'));
    const expected = manifest.files.filter(f => f.kind === 'partition' && f.collection === 'purchase_needs').map(f => f.path);
    expect(partitionReads.sort()).toEqual(expected.sort());
    expect(store.status.state).toBe('ready');
  });

  it('çok parçalı koleksiyon bütün parçaları birleştirir', async () => {
    const store = new GenerationStore(source, { cache: null });
    const manifest = await manifestOf(generationDir);
    const parts = manifest.files.filter(f => f.kind === 'partition' && f.collection === 'budget_observations');
    expect(parts.length).toBeGreaterThan(1);
    const records = await store.loadCollection('budget_observations');
    expect(records).toHaveLength(manifest.counts.budget_observations!);
  });

  it('manifestte olmayan koleksiyon boş döner (Kaynakta kayıt yok), hata değil', async () => {
    const store = new GenerationStore(source, { cache: null });
    const records = await store.loadCollection('payments' as CollectionName);
    expect(records).toEqual([]);
    expect(store.status.state).toBe('ready');
  });

  it('source_cells / source_rows asla yüklenmez', async () => {
    expect([...HEAVY_COLLECTIONS].sort()).toEqual(['source_cells', 'source_rows']);
    const store = new GenerationStore(source, { cache: null });
    await store.loadManifest();
    const before = source.reads.length;
    await expect(store.loadCollection('source_cells' as CollectionName)).rejects.toBeInstanceOf(HeavyCollectionError);
    await expect(store.loadCollection('source_rows' as CollectionName)).rejects.toBeInstanceOf(HeavyCollectionError);
    expect(source.reads).toHaveLength(before);
  });
});

describe('GenerationStore › bütünlük', () => {
  it('bozuk hash → IntegrityError, veri yayınlanmaz, state error', async () => {
    source.corrupt.add('data/purchase_needs/household/00000.json');
    const store = new GenerationStore(source, { cache: null });
    await expect(store.loadCollection('purchase_needs')).rejects.toBeInstanceOf(IntegrityError);
    expect(store.getCollection('purchase_needs')).toBeUndefined();
    expect(store.status.state).toBe('error');
    expect(store.status.message).toMatch(/^Hata: /);
  });

  it('bozuk hash ile yenileme → stale: aday nesil reddedilir, son iyi veri ve lastGoodGenerationId uyarıyla korunur', async () => {
    const store = new GenerationStore(source, { cache: null });
    const good = await store.loadCollection('purchase_needs');
    const goodAt = store.status.lastGoodAt;
    source.corrupt.add('data/purchase_needs/household/00000.json');
    const states = track(store);
    await expect(store.refresh()).rejects.toBeInstanceOf(IntegrityError);
    // Yarım/bozuk aday yayınlanmaz; yayındaki son iyi nesil durur → "eski" (DataStatus: "Son başarılı nesil … · yenilenemedi").
    expect(states).toEqual(['checking', 'stale']);
    expect(store.status.state).toBe('stale');
    expect(store.status.message).toMatch(/^Hata: .*bütünlük/);
    expect(store.getCollection('purchase_needs')).toBe(good);
    expect(store.status.generationId).toBe(generationId);
    expect(store.status.lastGoodGenerationId).toBe(generationId);
    expect(store.status.lastGoodAt).toBe(goodAt);
  });

  it('sözleşmeye uymayan manifestle yenileme → stale, son iyi nesil korunur', async () => {
    const store = new GenerationStore(source, { cache: null });
    const good = await store.loadCollection('rooms');
    source.manifestOverride = JSON.stringify({ schemaVersion: 1, generation_id: 'yarim' });
    await expect(store.refresh()).rejects.toBeInstanceOf(ContractError);
    expect(store.status.state).toBe('stale');
    expect(store.getCollection('rooms')).toBe(good);
    expect(store.status.lastGoodGenerationId).toBe(generationId);
  });

  it('yenileme başarısızken son iyi nesilden başka koleksiyon yüklemek uyarıyı silmez; başarılı yenileme ready yapar', async () => {
    const store = new GenerationStore(source, { cache: null });
    await store.loadCollection('rooms');
    source.failAll = true;
    await expect(store.refresh()).rejects.toThrow();
    const staleMessage = store.status.message;
    expect(store.status.state).toBe('stale');
    source.failAll = false;
    await store.loadCollection('terms');
    expect(store.status.state).toBe('stale');
    expect(store.status.message).toBe(staleMessage);
    await store.refresh();
    expect(store.status.state).toBe('ready');
    expect(store.status.message).toBeNull();
  });

  it('yarım nesil: ikinci parça çökerse koleksiyon yayınlanmaz, önceki iyi koleksiyonlar durur', async () => {
    const store = new GenerationStore(source, { cache: null });
    const rooms = await store.loadCollection('rooms');
    const manifest = await manifestOf(generationDir);
    const parts = manifest.files.filter(f => f.kind === 'partition' && f.collection === 'budget_observations').map(f => f.path);
    source.failing.add(parts[1]!);
    await expect(store.loadCollection('budget_observations')).rejects.toThrow();
    expect(store.getCollection('budget_observations')).toBeUndefined();
    expect(store.getCollection('rooms')).toBe(rooms);
  });

  it('yenileme kaynağa ulaşamazsa → stale; eski veri korunur; sonraki başarılı yenileme ready', async () => {
    const store = new GenerationStore(source, { cache: null });
    const good = await store.loadCollection('rooms');
    const states = track(store);
    source.failAll = true;
    await expect(store.refresh()).rejects.toThrow();
    expect(states).toEqual(['checking', 'stale']);
    expect(store.status.state).toBe('stale');
    expect(store.status.lastGoodGenerationId).toBe(generationId);
    expect(store.getCollection('rooms')).toBe(good);
    expect(store.status.message).toMatch(/^Hata: /);

    source.failAll = false;
    await store.refresh();
    expect(store.status.state).toBe('ready');
    expect(store.status.message).toBeNull();
    expect(store.getCollection('rooms')).toHaveLength(good.length);
  });

  it('ilk yüklemede kaynak yoksa (iyi nesil yok) → error', async () => {
    source.failAll = true;
    const store = new GenerationStore(source, { cache: null });
    await expect(store.loadManifest()).rejects.toThrow();
    expect(store.status.state).toBe('error');
    expect(store.status.lastGoodGenerationId).toBeNull();
  });
});

describe('GenerationStore › önbellek', () => {
  it('parça metni generation_id anahtarıyla önbelleğe yazılır ve ikinci okuma kaynaktan değil önbellekten gelir', async () => {
    const cache = new MemoryCache();
    const first = new GenerationStore(source, { cache });
    await first.loadCollection('rooms');
    const keys = [...cache.map.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(generationId);
    expect(keys[0]).toContain('data/rooms/household/00000.json');

    const second = new FixtureSource(generationDir);
    const store = new GenerationStore(second, { cache });
    const records = await store.loadCollection('rooms');
    expect(records).toHaveLength((await manifestOf(generationDir)).counts.rooms!);
    expect(second.reads).toEqual(['manifest.json']);
  });

  it('önbellekteki parça hash ile yeniden doğrulanır; bozuksa kaynaktan okunur ve önbellek düzeltilir', async () => {
    const cache = new MemoryCache();
    await new GenerationStore(source, { cache }).loadCollection('rooms');
    const key = [...cache.map.keys()][0]!;
    const goodText = cache.map.get(key)!;
    cache.map.set(key, '{"schemaVersion":1,"collection":"rooms","records":[]}');

    const fresh = new FixtureSource(generationDir);
    const store = new GenerationStore(fresh, { cache });
    const records = await store.loadCollection('rooms');
    expect(records.length).toBeGreaterThan(0);
    expect(fresh.reads).toContain('data/rooms/household/00000.json');
    expect(cache.map.get(key)).toBe(goodText);
  });

  it('önbellek hatası yüklemeyi engellemez', async () => {
    const broken: PartitionCache = {
      get: async () => { throw new Error('idb kapalı'); },
      set: async () => { throw new Error('idb kapalı'); },
    };
    const store = new GenerationStore(source, { cache: broken });
    await expect(store.loadCollection('rooms')).resolves.toHaveLength((await manifestOf(generationDir)).counts.rooms!);
    expect(store.status.state).toBe('ready');
  });
});

// --- Tembel parça yükleme -------------------------------------------------------------------------------

/** Parça okumalarını elle bırakılana kadar bekletir; manifest hemen döner. Okuma seçeneklerini (signal) kaydeder. */
class GatedSource implements GenerationSource {
  readonly pending: { path: string; options?: ReadTextOptions; release(): void }[] = [];
  readonly started: string[] = [];
  constructor(private readonly inner: FixtureSource) {}
  readText(relative: string, options?: ReadTextOptions): Promise<string> {
    if (relative === 'manifest.json') return this.inner.readText(relative, options);
    this.started.push(relative);
    return new Promise<string>((resolve, reject) => {
      const entry = {
        path: relative,
        options,
        release: () => {
          const at = this.pending.indexOf(entry);
          if (at >= 0) this.pending.splice(at, 1);
          this.inner.readText(relative, options).then(resolve, reject);
        },
      };
      this.pending.push(entry);
      options?.signal?.addEventListener('abort', () => {
        const at = this.pending.indexOf(entry);
        if (at >= 0) this.pending.splice(at, 1);
        reject(new DOMException('İstek iptal edildi', 'AbortError'));
      });
    });
  }
  releaseAll() {
    for (const entry of [...this.pending]) entry.release();
  }
}

async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

function partitionsOf(manifest: Awaited<ReturnType<typeof manifestOf>>, collection: string) {
  return manifest.files
    .filter(f => f.kind === 'partition' && f.collection === collection)
    .map(f => ({ path: f.path, count: f.count ?? 0 }));
}

describe('GenerationStore › dönem bazında tembel parça yükleme', () => {
  it('partitionPeriod parça yolundaki YYYY-MM bölütünü bulur; dönemsiz parça null', () => {
    expect(partitionPeriod('data/forecast_events/budget/2026-11/00000.json')).toBe('2026-11');
    expect(partitionPeriod('data/forecast_months/budget/00000.json')).toBeNull();
    expect(partitionPeriod('data/budget_observations/budget/201/00000.json')).toBeNull();
    expect(partitionPeriod('data/x/budget/2026-13/00000.json')).toBeNull();
  });

  it('periodsBetween iki tarihi kapsayan yerel takvim aylarını verir (iki uç dahil)', () => {
    expect(periodsBetween(new Date(2026, 10, 28), new Date(2026, 11, 5))).toEqual(['2026-11', '2026-12']);
    expect(periodsBetween(new Date(2026, 11, 30), new Date(2027, 0, 2))).toEqual(['2026-12', '2027-01']);
    expect(periodsBetween(new Date(2026, 10, 3), new Date(2026, 10, 9))).toEqual(['2026-11']);
    expect(periodsBetween(new Date(2026, 11, 1), new Date(2026, 10, 1))).toEqual([]);
  });

  it("periodsBetween timeZone verilince ayları o saat diliminde hesaplar (bütçe dönemi Europe/Istanbul)", () => {
    // 2026-10-31T22:30Z İstanbul'da 1 Kasım 01:30'dur; UTC'de hâlâ Ekim.
    const from = new Date('2026-10-31T22:30:00Z');
    const to = new Date('2026-11-07T22:30:00Z');
    expect(periodsBetween(from, to, { timeZone: 'Europe/Istanbul' })).toEqual(['2026-11']);
    expect(periodsBetween(from, to, { timeZone: 'UTC' })).toEqual(['2026-10', '2026-11']);
    expect(periodsBetween(new Date('2026-12-31T20:59:00Z'), new Date('2026-12-31T21:00:00Z'), { timeZone: 'Europe/Istanbul' })).toEqual(['2026-12', '2027-01']);
    expect(() => periodsBetween(from, to, { timeZone: 'Gecersiz/Bolge' })).toThrow(RangeError);
  });

  it('periods verilince yalnız o dönemlerin parçaları okunur; tam koleksiyon yayınlanmış sayılmaz', async () => {
    const store = new GenerationStore(source, { cache: null });
    const manifest = await manifestOf(generationDir);
    const all = partitionsOf(manifest, 'forecast_events');
    expect(all.length).toBeGreaterThan(10);
    const wanted = all.filter(f => ['2026-11', '2027-01'].includes(partitionPeriod(f.path)!));
    expect(wanted).toHaveLength(2);

    const records = await store.loadCollection('forecast_events', { periods: ['2027-01', '2026-11'] });
    const reads = source.reads.filter(p => p.startsWith('data/forecast_events/'));
    expect(reads.sort()).toEqual(wanted.map(f => f.path).sort());
    expect(records).toHaveLength(wanted.reduce((sum, f) => sum + f.count, 0));
    expect(store.getCollection('forecast_events', { periods: ['2026-11', '2027-01'] })).toBe(records);
    expect(store.getCollection('forecast_events')).toBeUndefined();
    expect(store.status.state).toBe('ready');
  });

  it('aynı kapsam (sırasız/tekrarlı dönem) bellekten döner; tam yükleme bellekteki parçaları yeniden indirmez', async () => {
    const store = new GenerationStore(source, { cache: null });
    const manifest = await manifestOf(generationDir);
    const all = partitionsOf(manifest, 'forecast_events');
    const first = await store.loadCollection('forecast_events', { periods: ['2026-11'] });
    const again = await store.loadCollection('forecast_events', { periods: ['2026-11', '2026-11'] });
    expect(again).toBe(first);
    expect(source.reads.filter(p => p.startsWith('data/forecast_events/'))).toHaveLength(1);

    const full = await store.loadCollection('forecast_events');
    expect(full).toHaveLength(manifest.counts.forecast_events!);
    const reads = source.reads.filter(p => p.startsWith('data/forecast_events/'));
    expect(reads).toHaveLength(all.length);
    expect(new Set(reads).size).toBe(all.length);
  });

  it('dönemsiz parçalar dönem kapsamında da okunur (ör. forecast_months tek parça)', async () => {
    const store = new GenerationStore(source, { cache: null });
    const manifest = await manifestOf(generationDir);
    const records = await store.loadCollection('forecast_months', { periods: ['2026-11'] });
    expect(records).toHaveLength(manifest.counts.forecast_months!);
  });

  it('geçersiz dönem okumadan reddedilir', async () => {
    const store = new GenerationStore(source, { cache: null });
    await expect(store.loadCollection('forecast_events', { periods: ['2026-13'] })).rejects.toThrow(/dönem/i);
    expect(source.reads.filter(p => p.startsWith('data/'))).toEqual([]);
  });
});

describe('GenerationStore › tekilleştirme ve eşzamanlılık', () => {
  it('eşzamanlı ilk yüklemelerde manifest bir kez okunur', async () => {
    const store = new GenerationStore(source, { cache: null });
    await Promise.all([store.loadManifest(), store.loadCollection('rooms'), store.loadCollection('terms'), store.loadManifest()]);
    expect(source.reads.filter(p => p === 'manifest.json')).toHaveLength(1);
    expect(store.status.state).toBe('ready');
  });

  it('aynı koleksiyonu eşzamanlı isteyen iki çağrı parçayı bir kez okur ve aynı diziyi alır', async () => {
    const store = new GenerationStore(source, { cache: null });
    await store.loadManifest();
    const [a, b] = await Promise.all([store.loadCollection('rooms'), store.loadCollection('rooms')]);
    expect(a).toBe(b);
    expect(source.reads.filter(p => p === 'data/rooms/household/00000.json')).toHaveLength(1);
  });

  it('dönem kapsamı ile tam yükleme aynı parçayı eşzamanlı isterse parça bir kez okunur', async () => {
    const store = new GenerationStore(source, { cache: null });
    await store.loadManifest();
    await Promise.all([store.loadCollection('forecast_events', { periods: ['2026-11'] }), store.loadCollection('forecast_events')]);
    const path2611 = source.reads.filter(p => partitionPeriod(p) === '2026-11');
    expect(path2611).toHaveLength(1);
  });

  it('koleksiyonun parçaları paralel okunur, eşzamanlı okuma en fazla 6', async () => {
    const gated = new GatedSource(source);
    const store = new GenerationStore(gated, { cache: null });
    const loading = store.loadCollection('forecast_events');
    await settle();
    expect(gated.pending).toHaveLength(6);
    expect(store.status.state).toBe('checking');
    // Yük altında bir sonraki parça sha256 bitene dek başlamayabilir: bekleyen kuyruğu yükleme bitene dek boşalt.
    let finished = false;
    loading.then(() => (finished = true), () => (finished = true));
    let peak = 0;
    while (!finished) {
      peak = Math.max(peak, gated.pending.length);
      gated.releaseAll();
      await settle(1);
    }
    expect(peak).toBeLessThanOrEqual(6);
    const manifest = await manifestOf(generationDir);
    await expect(loading).resolves.toHaveLength(manifest.counts.forecast_events!);
    expect(store.status.state).toBe('ready');
  });

  it('eşzamanlı iki yenileme tek okuma yapar', async () => {
    const store = new GenerationStore(source, { cache: null });
    await store.loadCollection('rooms');
    const before = source.reads.filter(p => p === 'manifest.json').length;
    await Promise.all([store.refresh(), store.refresh()]);
    expect(source.reads.filter(p => p === 'manifest.json')).toHaveLength(before + 1);
    expect(store.status.state).toBe('ready');
  });
});

describe('GenerationStore › iptal', () => {
  it('signal iptal edilince çağrı AbortError ile reddedilir, parça okuması iptal sinyali alır, durum hata olmaz', async () => {
    const gated = new GatedSource(source);
    const store = new GenerationStore(gated, { cache: null });
    await store.loadManifest();
    const controller = new AbortController();
    const states = track(store);
    const loading = store.loadCollection('forecast_events', { periods: ['2026-11'], signal: controller.signal });
    await settle();
    expect(gated.pending).toHaveLength(1);
    const readSignal = gated.pending[0]!.options?.signal;
    expect(readSignal?.aborted).toBe(false);
    controller.abort();
    const error = await loading.catch(e => e);
    expect((error as Error).name).toBe('AbortError');
    expect(readSignal?.aborted).toBe(true);
    expect(states).toEqual(['checking', 'ready']);
    expect(store.status.message).toBeNull();
    expect(store.getCollection('forecast_events', { periods: ['2026-11'] })).toBeUndefined();

    // İptal edilen parça bellekte kalmaz: sonraki istek yeniden okur ve başarır.
    const retry = store.loadCollection('forecast_events', { periods: ['2026-11'] });
    await settle();
    expect(gated.started.filter(p => partitionPeriod(p) === '2026-11')).toHaveLength(2);
    gated.releaseAll();
    await expect(retry).resolves.toHaveLength(1);
  });

  it('aynı parçayı bekleyen başka çağıran varsa iptal okumayı durdurmaz', async () => {
    const gated = new GatedSource(source);
    const store = new GenerationStore(gated, { cache: null });
    await store.loadManifest();
    const controller = new AbortController();
    const cancelled = store.loadCollection('rooms', { signal: controller.signal });
    const kept = store.loadCollection('rooms');
    await settle();
    expect(gated.pending).toHaveLength(1);
    const readSignal = gated.pending[0]!.options?.signal;
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(readSignal?.aborted).toBe(false);
    gated.releaseAll();
    await expect(kept).resolves.toHaveLength((await manifestOf(generationDir)).counts.rooms!);
    expect(gated.started).toHaveLength(1);
  });

  it('önceden iptal edilmiş signal hiçbir okuma başlatmaz', async () => {
    const store = new GenerationStore(source, { cache: null });
    await store.loadManifest();
    const controller = new AbortController();
    controller.abort();
    await expect(store.loadCollection('rooms', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(source.reads.filter(p => p.startsWith('data/'))).toEqual([]);
  });
});

describe('GenerationStore › nesil sabitleme ve yenileme kapsamı', () => {
  it("parça okumaları manifestin generation_id'siyle istenir; manifest okuması sabitlenmez", async () => {
    const store = new GenerationStore(source, { cache: null });
    await store.loadCollection('rooms');
    const manifestRead = source.options.find(o => o.path === 'manifest.json');
    expect(manifestRead?.options?.generationId).toBeUndefined();
    const partitionRead = source.options.find(o => o.path === 'data/rooms/household/00000.json');
    expect(partitionRead?.options?.generationId).toBe(generationId);
  });

  it('yenileme dönem kapsamlarını yeni nesilden yeniden okur ve yeni diziyi yayınlar', async () => {
    const store = new GenerationStore(source, { cache: null });
    const before = await store.loadCollection('forecast_events', { periods: ['2026-11'] });
    const reads = () => source.reads.filter(p => partitionPeriod(p) === '2026-11').length;
    expect(reads()).toBe(1);
    await store.refresh();
    expect(reads()).toBe(2);
    const after = store.getCollection('forecast_events', { periods: ['2026-11'] });
    expect(after).not.toBe(before);
    expect(after).toHaveLength(before.length);
    // Yenileme kapsam dışındaki dönemleri indirmez.
    expect(source.reads.filter(p => p.startsWith('data/forecast_events/'))).toHaveLength(2);
  });
});

describe('GenerationStore › iptal yarışı', () => {
  it('manifest çözüldükten sonraki her mikro görev adımında iptal: işlenmemiş ret kalmaz, durum hata olmaz', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      for (let hops = 0; hops < 12; hops += 1) {
        const store = new GenerationStore(new FixtureSource(generationDir), { cache: null });
        const controller = new AbortController();
        let chain: Promise<unknown> = store.loadManifest();
        for (let i = 0; i < hops; i += 1) chain = chain.then(() => undefined);
        void chain.then(() => controller.abort());
        const outcome = await store.loadCollection('forecast_events', { signal: controller.signal }).then(
          () => 'tamam',
          (error: Error) => error.name,
        );
        expect(['AbortError', 'tamam'], `adım ${hops}`).toContain(outcome);
        await settle(5);
        expect(store.status.state, `adım ${hops}`).toBe('ready');
      }
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('defaultPartitionCache (Pages için kalıcı önbelleği kapatma)', () => {
  it("VITE_AILE_PARTITION_CACHE 'off' ya da 'memory' → kalıcı önbellek yok (null)", () => {
    expect(defaultPartitionCache({ VITE_AILE_PARTITION_CACHE: 'off' })).toBeNull();
    expect(defaultPartitionCache({ VITE_AILE_PARTITION_CACHE: ' Memory ' })).toBeNull();
  });

  it('tanınmayan değer gizlilik için kapalı sayılır (fail-closed)', () => {
    expect(defaultPartitionCache({ VITE_AILE_PARTITION_CACHE: 'of' })).toBeNull();
  });

  it("verilmezse ya da 'idb' ise IndexedDB önbelleği istenir (IndexedDB yoksa yine null)", () => {
    const original = (globalThis as { indexedDB?: unknown }).indexedDB;
    try {
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
      expect(defaultPartitionCache({})).toBeNull();
      (globalThis as { indexedDB?: unknown }).indexedDB = {};
      for (const env of [{}, { VITE_AILE_PARTITION_CACHE: 'idb' }, { VITE_AILE_PARTITION_CACHE: '' }]) {
        const cache = defaultPartitionCache(env);
        expect(cache, JSON.stringify(env)).not.toBeNull();
        expect(typeof cache!.get).toBe('function');
        expect(typeof cache!.set).toBe('function');
      }
    } finally {
      if (original === undefined) delete (globalThis as { indexedDB?: unknown }).indexedDB;
      else (globalThis as { indexedDB?: unknown }).indexedDB = original;
    }
  });
});
