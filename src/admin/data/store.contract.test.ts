import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationSource } from './store';

// Sözleşme doğrulaması (contract.ts + zod) depodan tembel yüklenir (telefon girişi zod'u statik çekmez; ölçüm
// docs/ADMIN-BUDGETS.md). Doğrulama sıkılığı aynıdır: aynı şemalar her manifest ve parçada çalışır. Doğrulama parçası
// indirilemezse okuma ad verilen bir hatayla reddedilir ve yenileme modülü yeniden ister.
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

  it('doğrulama parçası indirilemezse okuma ad verilen hatayla reddedilir; yenileme modülü yeniden ister', async () => {
    vi.doMock('./contract', () => {
      throw new TypeError('Failed to fetch dynamically imported module: /aile/assets/contract-0000.js');
    });
    const { CONTRACT_LOAD_FAILED, GenerationStore } = await import('./store');
    const store = new GenerationStore(fixtureSource(), { cache: null });
    await expect(store.loadManifest()).rejects.toThrow(CONTRACT_LOAD_FAILED);
    expect(store.status.state).toBe('error');
    expect(store.status.message).toBe(`Hata: ${CONTRACT_LOAD_FAILED}`);

    vi.doUnmock('./contract');
    await store.refresh();
    expect(store.status.state).toBe('ready');
    expect((await store.loadManifest()).schemaVersion).toBe(1);
  });
});
