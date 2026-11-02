// Nesil deposu: doğrulanmış JSON neslini (manifest + parçalar) okur, sha256 ile bütünlüğünü doğrular, bellekte tutar
// ve parça metinlerini generation_id anahtarıyla idb-keyval'de önbellekler. React/antd bilmez; kabuk `subscribe`
// ile durumu izler. Yarım veya bozuk nesil asla son iyi veriyi ezmez: aday nesil tamamlanmadan yayınlanmaz.
import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';
import { parseManifest, parsePartition } from './contract';
import type { BaseRecord, CollectionName, GenerationState, Manifest, ManifestFile, PartitionEnvelope } from './types';

/** Hücre/satır dökümleri ağırdır; panel bunları hiçbir koşulda indirmez. */
export const HEAVY_COLLECTIONS: readonly string[] = ['source_cells', 'source_rows'];

/** Nesil kökünden göreli yolu ('manifest.json', 'data/<koleksiyon>/<bölüm>/<parça>.json') UTF-8 metin olarak okur. */
export interface GenerationSource {
  readText(path: string): Promise<string>;
}

/** Parça metni önbelleği; anahtar `<generation_id>/<yol>`. Önbellek hatası yüklemeyi hiçbir zaman durdurmaz. */
export interface PartitionCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface StoreStatus {
  state: GenerationState;
  /** Yayında olan (son iyi) neslin kimliği. */
  generationId: string | null;
  /** Son başarılı okumanın ISO zamanı. */
  lastReadAt: string | null;
  lastGoodGenerationId: string | null;
  lastGoodAt: string | null;
  /** stale/error'da "Hata: …" ile başlar; ready'de null. */
  message: string | null;
}

export interface GenerationStoreOptions {
  /** null → önbellek yok. Verilmezse idb-keyval (IndexedDB yoksa yine önbellek yok). */
  cache?: PartitionCache | null;
  now?: () => Date;
}

/** Manifest hash'i ile okunan içerik uyuşmuyor; veri yayınlanmaz. */
export class IntegrityError extends Error {
  override readonly name = 'IntegrityError';
  constructor(readonly path: string, readonly expected: string, readonly actual: string) {
    super(`${path} bütünlük doğrulamasını geçmedi (beklenen ${expected.slice(0, 12)}…, okunan ${actual.slice(0, 12)}…)`);
  }
}

/** Manifest ya da parça zarfı veri platformu sözleşmesine uymuyor. */
export class ContractError extends Error {
  override readonly name = 'ContractError';
  constructor(readonly path: string, detail: string) {
    super(`${path} sözleşmeye uymuyor: ${detail}`);
  }
}

export class HeavyCollectionError extends Error {
  override readonly name = 'HeavyCollectionError';
  constructor(readonly collection: string) {
    super(`${collection} panel tarafından indirilmez`);
  }
}

interface Snapshot {
  generationId: string;
  manifest: Manifest;
  collections: Map<CollectionName, readonly BaseRecord[]>;
  readAt: string;
}

type Listener = (status: StoreStatus) => void;

const IDB_DATABASE = 'aile-admin';
const IDB_STORE = 'partitions';

export function createIdbPartitionCache(): PartitionCache | null {
  if (typeof indexedDB === 'undefined') return null;
  let store: UseStore | undefined;
  const useStore = () => (store ??= createStore(IDB_DATABASE, IDB_STORE));
  return {
    async get(key) {
      const value = await get<unknown>(key, useStore());
      return typeof value === 'string' ? value : undefined;
    },
    async set(key, value) {
      await set(key, value, useStore());
    },
  };
}

/** Yayındaki nesil dışındaki önbellek girdilerini siler; kabuk yeni nesil ready olduktan sonra çağırabilir. */
export async function pruneIdbPartitionCache(keepGenerationId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const store = createStore(IDB_DATABASE, IDB_STORE);
  const all = await keys<string>(store);
  await Promise.all(all.filter(key => typeof key === 'string' && !key.startsWith(`${keepGenerationId}/`)).map(key => del(key, store)));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class GenerationStore {
  private readonly cache: PartitionCache | null;
  private readonly now: () => Date;
  private readonly listeners = new Set<Listener>();
  /** Yayındaki (son iyi) nesil. Yalnız tamamlanmış aday ile değişir. */
  private current: Snapshot | null = null;
  private state: GenerationState = 'idle';
  private message: string | null = null;
  private lastReadAt: string | null = null;
  private lastGoodAt: string | null = null;
  private inflight: Promise<void> | null = null;

  constructor(private readonly source: GenerationSource, options: GenerationStoreOptions = {}) {
    this.cache = options.cache === undefined ? createIdbPartitionCache() : options.cache;
    this.now = options.now ?? (() => new Date());
  }

  get status(): StoreStatus {
    return {
      state: this.state,
      generationId: this.current?.generationId ?? null,
      lastReadAt: this.lastReadAt,
      lastGoodGenerationId: this.current?.generationId ?? null,
      lastGoodAt: this.lastGoodAt,
      message: this.message,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Manifesti okur ve doğrular. Yayında nesil yoksa boş koleksiyon haritasıyla ready yapar; varsa yalnız döner. */
  async loadManifest(): Promise<Manifest> {
    if (this.current) return this.current.manifest;
    await this.run(async () => {
      const snapshot = await this.readManifest();
      this.publish(snapshot);
    });
    return this.current!.manifest;
  }

  /** Koleksiyonu belleğe alır (bir kez); bütün parçalar doğrulanmadan hiçbir kaydı yayınlamaz. */
  async loadCollection(name: CollectionName): Promise<readonly BaseRecord[]> {
    if (HEAVY_COLLECTIONS.includes(name)) throw new HeavyCollectionError(name);
    await this.loadManifest();
    const existing = this.current!.collections.get(name);
    if (existing) return existing;
    await this.run(async () => {
      const snapshot = this.current!;
      const records = await this.readCollection(snapshot, name);
      snapshot.collections.set(name, records);
      this.touch();
    });
    return this.current!.collections.get(name)!;
  }

  getCollection(name: CollectionName): readonly BaseRecord[] | undefined {
    return this.current?.collections.get(name);
  }

  /** Manifesti ve yüklü koleksiyonları yeniden okur; aday nesil eksiksiz doğrulanmadan yayın değişmez. */
  async refresh(): Promise<void> {
    await this.run(async () => {
      const candidate = await this.readManifest();
      const wanted = this.current ? [...this.current.collections.keys()] : [];
      for (const name of wanted) candidate.collections.set(name, await this.readCollection(candidate, name));
      this.publish(candidate);
    });
  }

  // --- iç ---------------------------------------------------------------------------------------

  /** Aynı anda tek iş: checking → ready | stale | error geçişlerini tek yerden yürütür. */
  private async run(work: () => Promise<void>): Promise<void> {
    while (this.inflight) await this.inflight.catch(() => undefined);
    const job = (async () => {
      this.setState('checking', null);
      try {
        await work();
        this.setState('ready', null);
      } catch (error) {
        const untrusted = error instanceof IntegrityError || error instanceof ContractError;
        const next: GenerationState = this.current && !untrusted ? 'stale' : 'error';
        this.setState(next, `Hata: ${errorMessage(error)}`);
        throw error;
      }
    })();
    this.inflight = job;
    try {
      await job;
    } finally {
      this.inflight = null;
    }
  }

  private setState(state: GenerationState, message: string | null) {
    this.state = state;
    this.message = message;
    const status = this.status;
    for (const listener of this.listeners) listener(status);
  }

  private publish(snapshot: Snapshot) {
    this.current = snapshot;
    this.touch();
  }

  private touch() {
    const at = this.now().toISOString();
    this.lastReadAt = at;
    this.lastGoodAt = at;
    if (this.current) this.current.readAt = at;
  }

  private async readManifest(): Promise<Snapshot> {
    const text = await this.source.readText('manifest.json');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new ContractError('manifest.json', errorMessage(error));
    }
    let manifest: Manifest;
    try {
      manifest = parseManifest(raw) as Manifest;
    } catch (error) {
      throw new ContractError('manifest.json', errorMessage(error));
    }
    // Deponun çalışması için gereken asgari biçim; sözleşme şeması gevşekse bile burada durur.
    if (!manifest || typeof manifest !== 'object' || manifest.schemaVersion !== 1) throw new ContractError('manifest.json', 'schemaVersion 1 değil');
    if (typeof manifest.generation_id !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.generation_id)) throw new ContractError('manifest.json', 'generation_id sha256 değil');
    if (!Array.isArray(manifest.files)) throw new ContractError('manifest.json', 'files dizisi yok');
    for (const file of manifest.files) {
      if (!file || typeof file.path !== 'string' || typeof file.sha256 !== 'string') throw new ContractError('manifest.json', 'files girdisi path/sha256 taşımıyor');
    }
    return { generationId: manifest.generation_id, manifest, collections: new Map(), readAt: this.now().toISOString() };
  }

  private async readCollection(snapshot: Snapshot, name: CollectionName): Promise<readonly BaseRecord[]> {
    const files = snapshot.manifest.files.filter(file => file.kind === 'partition' && file.collection === name);
    const records: BaseRecord[] = [];
    for (const file of files) {
      const text = await this.readPartitionText(snapshot.generationId, file);
      records.push(...this.parsePartition(name, file.path, text));
    }
    return records;
  }

  /** Önce önbellek (hash yeniden doğrulanır), sonra kaynak; her iki yol da manifest hash'ini geçmek zorundadır. */
  private async readPartitionText(generationId: string, file: ManifestFile): Promise<string> {
    const key = `${generationId}/${file.path}`;
    const cached = await this.cacheGet(key);
    if (cached !== undefined && (await sha256Hex(cached)) === file.sha256) return cached;
    const text = await this.source.readText(file.path);
    const actual = await sha256Hex(text);
    if (actual !== file.sha256) throw new IntegrityError(file.path, file.sha256, actual);
    await this.cacheSet(key, text);
    return text;
  }

  private parsePartition(name: CollectionName, path: string, text: string): BaseRecord[] {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new ContractError(path, errorMessage(error));
    }
    let envelope: PartitionEnvelope;
    try {
      envelope = parsePartition(name, raw) as PartitionEnvelope;
    } catch (error) {
      throw new ContractError(path, errorMessage(error));
    }
    if (!envelope || envelope.schemaVersion !== 1 || !Array.isArray(envelope.records)) throw new ContractError(path, 'parça zarfı schemaVersion 1 / records değil');
    if (envelope.collection !== name) throw new ContractError(path, `zarf koleksiyonu ${String(envelope.collection)}, beklenen ${name}`);
    return envelope.records;
  }

  private async cacheGet(key: string): Promise<string | undefined> {
    if (!this.cache) return undefined;
    try {
      return await this.cache.get(key);
    } catch {
      return undefined;
    }
  }

  private async cacheSet(key: string, value: string): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.set(key, value);
    } catch {
      // Önbellek yardımcıdır; yazılamaması veriyi etkilemez.
    }
  }
}
