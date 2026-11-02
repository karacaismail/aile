import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError } from '../adaptive/chunkError';
import type { GenerationSource } from './store';

// Sözleşme doğrulaması (contract.ts + zod) depodan tembel yüklenir (telefon girişi zod'u statik çekmez; ölçüm
// docs/ADMIN-BUDGETS.md). Doğrulama sıkılığı aynıdır: aynı şemalar her manifest ve parçada çalışır. Doğrulama parçası
// indirilemezse okuma ContractLoadError ile reddedilir (veri yayınlanmaz): çevrim içi parça hatası eski sürümdür
// (CONTRACT_STALE_BUILD, sayfa "Yeni sürüm var · Yenile"), çevrim dışı ya da parça dışı hata CONTRACT_LOAD_FAILED ve
// yenileme modülü yeniden ister. Manifest/kaynak hatası sözleşme hatasının arkasında kalmaz (p-fix m1, n2).
const FIXTURE_ROOT = path.resolve(__dirname, '../../../fixtures/generation-synthetic');

let generationDir: string;
beforeEach(async () => {
  const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  expect(dirs).toHaveLength(1);
  generationDir = path.join(FIXTURE_ROOT, dirs[0]!);
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock('./contract');
  vi.resetModules();
});

const fixtureSource = (texts: Record<string, string> = {}): GenerationSource => ({
  readText: async (relative: string) => texts[relative] ?? readFile(path.join(generationDir, relative), 'utf8'),
});

describe('GenerationStore › tembel sözleşme doğrulaması', () => {
  it('sentetik nesil doğrulanıp yüklenir; manifest ve parça aynı şemalarla reddedilir (sıkılık aynı)', async () => {
    const { ContractError, GenerationStore } = await import('./store');
    const store = new GenerationStore(fixtureSource(), { cache: null });
    const manifest = await store.loadManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect((await store.loadCollection('purchase_needs')).length).toBeGreaterThan(0);

    // Zod'un reddettiği manifest (eksik sha256) ve parça (bütçe gözlemi ödeme kanıtı taşıyamaz) yine reddedilir.
    const raw = JSON.parse(await readFile(path.join(generationDir, 'manifest.json'), 'utf8')) as { files: Record<string, unknown>[] };
    const brokenManifest = { ...raw, files: raw.files.map((file, index) => (index === 0 ? { ...file, sha256: undefined } : file)) };
    const rejected = new GenerationStore(fixtureSource({ 'manifest.json': JSON.stringify(brokenManifest) }), { cache: null });
    await expect(rejected.loadManifest()).rejects.toBeInstanceOf(ContractError);
    await expect(rejected.loadManifest()).rejects.toThrow('files[0].sha256: metin bekleniyor');

    const { parsePartition } = await import('./contract');
    const file = raw.files.find((entry) => entry.collection === 'budget_observations') as { path: string };
    const envelope = JSON.parse(await readFile(path.join(generationDir, file.path), 'utf8')) as { records: Record<string, unknown>[] };
    envelope.records[0] = { ...envelope.records[0], payment_evidence: true };
    expect(() => parsePartition('budget_observations', envelope)).toThrow();
  });

  it('doğrulama parçası çevrim dışı indirilemezse okuma ad verilen hatayla reddedilir; yenileme modülü yeniden ister', async () => {
    vi.doMock('./contract', () => {
      throw new TypeError('Failed to fetch dynamically imported module: /aile/assets/contract-0000.js');
    });
    const offline = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const { CONTRACT_LOAD_FAILED, ContractLoadError, GenerationStore, isStaleBuildMessage } = await import('./store');
    const store = new GenerationStore(fixtureSource(), { cache: null });
    try {
      const failure = await store.loadManifest().then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(ContractLoadError);
      expect(failure).toMatchObject({ message: CONTRACT_LOAD_FAILED, staleBuild: false });
      expect(store.status.state).toBe('error');
      expect(store.status.message).toBe(`Hata: ${CONTRACT_LOAD_FAILED}`);
      expect(isStaleBuildMessage(store.status.message)).toBe(false);
    } finally {
      offline.mockRestore();
    }

    vi.doUnmock('./contract');
    await store.refresh();
    expect(store.status.state).toBe('ready');
    expect((await store.loadManifest()).schemaVersion).toBe(1);
  });

  it('çevrim içiyken parça yükleme hatası eski sürümdür: ad verilen "Yeni sürüm var" hatası, veri yayınlanmaz (fail closed)', async () => {
    vi.doMock('./contract', () => {
      throw new TypeError('Failed to fetch dynamically imported module: /aile/assets/contract-0000.js');
    });
    const { CONTRACT_STALE_BUILD, ContractLoadError, GenerationStore, isStaleBuildMessage, loadContract } = await import('./store');
    const direct = await loadContract().then(() => null, (error: unknown) => error);
    expect(direct).toBeInstanceOf(ContractLoadError);
    expect(direct).toMatchObject({ name: 'ContractLoadError', message: CONTRACT_STALE_BUILD, staleBuild: true });
    // Asıl neden (tarayıcının parça hatası) cause zincirindedir; vitest doMock fabrikası onu bir kez daha sarar.
    expect(isChunkLoadError((direct as Error).cause)).toBe(true);

    const store = new GenerationStore(fixtureSource(), { cache: null });
    await expect(store.loadManifest()).rejects.toThrow(CONTRACT_STALE_BUILD);
    expect(store.status).toMatchObject({ state: 'error', generationId: null, message: `Hata: ${CONTRACT_STALE_BUILD}` });
    expect(isStaleBuildMessage(store.status.message)).toBe(true);
    await expect(store.loadCollection('purchase_needs')).rejects.toThrow(CONTRACT_STALE_BUILD);
    expect(store.getCollection('purchase_needs')).toBeUndefined();
    expect(isStaleBuildMessage(null)).toBe(false);
    expect(isStaleBuildMessage(`Hata: ${CONTRACT_STALE_BUILD} ek`)).toBe(false);
  });

  it('parça dışı hata (modül değerlendirme) eski sürüm sayılmaz: "Yeniden dene" yolu', async () => {
    vi.doMock('./contract', () => {
      throw new SyntaxError('Unexpected token');
    });
    const { CONTRACT_LOAD_FAILED, GenerationStore } = await import('./store');
    const store = new GenerationStore(fixtureSource(), { cache: null });
    await expect(store.loadManifest()).rejects.toMatchObject({ message: CONTRACT_LOAD_FAILED, staleBuild: false });
  });

  it('manifest/kaynak hatası sözleşme hatasının arkasında kalmaz (ikisi birlikte düşerse kaynak hatası adıyla)', async () => {
    vi.doMock('./contract', () => {
      throw new TypeError('Failed to fetch dynamically imported module: /aile/assets/contract-0000.js');
    });
    const { CONTRACT_LOAD_FAILED, CONTRACT_STALE_BUILD, GenerationStore } = await import('./store');
    const unreachable: GenerationSource = { readText: async () => { throw new Error('Kaynak erişilemedi: manifest.json (503)'); } };
    const store = new GenerationStore(unreachable, { cache: null });
    await expect(store.loadManifest()).rejects.toThrow('Kaynak erişilemedi: manifest.json (503)');
    expect(store.status.message).toBe('Hata: Kaynak erişilemedi: manifest.json (503)');
    expect(store.status.message).not.toContain(CONTRACT_LOAD_FAILED);
    expect(store.status.message).not.toContain(CONTRACT_STALE_BUILD);
  });
});
