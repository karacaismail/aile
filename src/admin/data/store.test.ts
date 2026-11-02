import { beforeEach, describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ContractError,
  GenerationStore,
  HEAVY_COLLECTIONS,
  HeavyCollectionError,
  IntegrityError,
  type GenerationSource,
  type PartitionCache,
  type StoreStatus,
} from './store';
import type { CollectionName } from './types';

const FIXTURE_ROOT = path.resolve(__dirname, '../../../fixtures/generation-synthetic');

/** Sentetik nesli diskten okur; test başına bozma/çökme ayarlanabilir. */
class FixtureSource implements GenerationSource {
  readonly reads: string[] = [];
  corrupt = new Set<string>();
  failing = new Set<string>();
  failAll = false;
  constructor(private readonly root: string) {}
  async readText(relative: string): Promise<string> {
    this.reads.push(relative);
    if (this.failAll || this.failing.has(relative)) throw new Error(`okunamadı: ${relative}`);
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
    files: { path: string; kind: string; collection?: string }[];
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

  it('bozuk hash ile yenileme → error, önceki iyi veri ve lastGoodGenerationId korunur', async () => {
    const store = new GenerationStore(source, { cache: null });
    const good = await store.loadCollection('purchase_needs');
    const goodAt = store.status.lastGoodAt;
    source.corrupt.add('data/purchase_needs/household/00000.json');
    await expect(store.refresh()).rejects.toBeInstanceOf(IntegrityError);
    expect(store.status.state).toBe('error');
    expect(store.getCollection('purchase_needs')).toBe(good);
    expect(store.status.lastGoodGenerationId).toBe(generationId);
    expect(store.status.lastGoodAt).toBe(goodAt);
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
