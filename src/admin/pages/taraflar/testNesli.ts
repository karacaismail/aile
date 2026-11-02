// Yalnız testler içe aktarır (uygulama kodu değil). Sentetik nesli (fixtures/generation-synthetic) belleğe okur ve
// sayfa testleri için değiştirilmiş bölümler üretir: kayıt alanı ekleme, usta (providers) bölümü ve ilişki ekleme.
// Her değişen bölümün manifest hash'i ve bayt sayısı yeniden yazılır (depo bütünlük denetimi gerçek kalır).
// Gerçek nesil, kasa yolu ya da Sheet kimliği okunmaz.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureGenerationSource, sha256Hex } from '../../data';
import type { PurchaseNeedRecord, Relation } from '../../data/types';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '../../../../fixtures/generation-synthetic');
export const GENERATION_ID = readdirSync(FIXTURE_ROOT).find((name) => statSync(join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = join(FIXTURE_ROOT, GENERATION_ID);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

export const FILES: Readonly<Record<string, string>> = Object.fromEntries(
  walk(GENERATION_DIR)
    .map((full) => relative(GENERATION_DIR, full))
    .filter((rel) => rel === 'manifest.json' || rel.startsWith('data/'))
    .map((rel) => [rel, readFileSync(join(GENERATION_DIR, rel), 'utf8')]),
);

interface ManifestFileJson { path: string; kind: string; sha256: string; bytes: number; collection?: string; count?: number }
interface ManifestJson { counts: Record<string, number>; files: ManifestFileJson[]; tenant_id: string }
interface Envelope<R> { schemaVersion: 1; collection: string; records: R[] }

const MANIFEST = JSON.parse(FILES['manifest.json']!) as ManifestJson;
export const TENANT_ID = MANIFEST.tenant_id;

/** Koleksiyonun (tek) bölüm yolu. */
export function bolumYolu(collection: string): string {
  return MANIFEST.files.find((file) => file.collection === collection)!.path;
}
export function kayitlar<R = PurchaseNeedRecord>(collection: string): R[] {
  return (JSON.parse(FILES[bolumYolu(collection)]!) as Envelope<R>).records;
}

export const PROVIDERS_YOLU = 'data/providers/household/00000.json';

export interface NesilDegisikligi {
  work_orders?(records: PurchaseNeedRecord[]): void;
  purchase_needs?(records: PurchaseNeedRecord[]): void;
  relations?(records: Relation[]): void;
  /** Verilirse nesle providers bölümü eklenir (normalize.mjs: usta satırı → providers). */
  providers?: PurchaseNeedRecord[];
  /** Yalnız manifest girdisi (bölüm dosyası yok): panelin okumadığı koleksiyon. */
  providersYalnizManifest?: number;
}

/** Değişen bölümler + yeniden yazılmış manifest. */
export async function nesil(degisiklik: NesilDegisikligi): Promise<Record<string, string>> {
  const manifest = structuredClone(MANIFEST);
  const out: Record<string, string> = {};
  const yaz = async (collection: string, path: string, records: unknown[]) => {
    const text = JSON.stringify({ schemaVersion: 1, collection, records });
    const entry = { path, kind: 'partition', sha256: await sha256Hex(text), bytes: new TextEncoder().encode(text).byteLength, collection, count: records.length };
    const index = manifest.files.findIndex((file) => file.path === path);
    if (index >= 0) manifest.files[index] = entry;
    else manifest.files.push(entry);
    manifest.counts[collection] = records.length;
    out[path] = text;
  };
  for (const collection of ['work_orders', 'purchase_needs', 'relations'] as const) {
    const mutate = degisiklik[collection] as ((records: unknown[]) => void) | undefined;
    if (!mutate) continue;
    const records = structuredClone(kayitlar<unknown>(collection));
    mutate(records);
    await yaz(collection, bolumYolu(collection), records);
  }
  if (degisiklik.providers) await yaz('providers', PROVIDERS_YOLU, degisiklik.providers);
  if (degisiklik.providersYalnizManifest !== undefined) {
    manifest.files.push({ path: PROVIDERS_YOLU, kind: 'partition', sha256: 'f'.repeat(64), bytes: 10, collection: 'providers', count: degisiklik.providersYalnizManifest });
    manifest.counts.providers = degisiklik.providersYalnizManifest;
  }
  out['manifest.json'] = JSON.stringify(manifest);
  return out;
}

export function kaynak(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files: Record<string, string> = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

/** Sentetik usta kaydı (normalize.mjs biçimi: PurchaseNeed gövdesi, kind 'provider'). */
export function usta(id: number, attributes: Record<string, unknown>, quote: string | null = null): PurchaseNeedRecord {
  return {
    id: `7a000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    tenant_id: TENANT_ID,
    kind: 'provider',
    label: typeof attributes.ad === 'string' ? attributes.ad : `kalem-9${String(id).padStart(2, '0')}`,
    source_record_id: `kalem-9${String(id).padStart(2, '0')}`,
    attributes: { deleted_at: null, ...attributes },
    source_attributes: { tip: 'usta', id: `kalem-9${String(id).padStart(2, '0')}` },
    category_term_id: null,
    phase_term_id: null,
    context_term_ids: [],
    state_snapshot: { decision: null, fulfillment: null, inspection: null, payment: null },
    state_term_ids: { decision: null, fulfillment: null, inspection: null, payment: null },
    amounts: { quote: quote === null ? null : { amount: quote, currency: 'TRY' } },
    dates: {},
    room_id: null,
    deleted_at: null,
    provenance: null,
  };
}

/** usta ↔ kayıt bağı (bagli_idler → associated_with). */
export function bag(source_id: string, target_id: string, n: number): Relation {
  return { id: `7b000000-0000-4000-8000-${String(n).padStart(12, '0')}`, tenant_id: TENANT_ID, kind: 'associated_with', source_id, target_id };
}
