import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangeSet, FixtureGenerationSource, GenerationProvider, createMemoryStorage, type GenerationSource, type PurchaseNeedRecord, type Term, type WorkflowDefinition } from '../../data';
import { DeviceContext } from '../../device';
import type { Device } from '../../shell/contracts';
import { AlimlarPage } from '../AlimlarPage';

// Yalnız Alımlar birim testleri içindir (uygulama kodu içe aktarmaz). Sentetik nesil (fixtures/generation-synthetic)
// belleğe okunur; gerçek nesil, kasa yolu ve Sheet kimliği okunmaz, ağ çağrısı yoktur.

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

export const PURCHASES_PATH = 'data/purchase_needs/household/00000.json';
export const VIEWS_PATH = 'data/view_definitions/global/00000.json';
export const PURCHASES = (JSON.parse(FILES[PURCHASES_PATH]!) as { records: PurchaseNeedRecord[] }).records;
export const TERMS = (JSON.parse(FILES['data/terms/global/00000.json']!) as { records: Term[] }).records;
export const WORKFLOWS = (JSON.parse(FILES['data/workflows/global/00000.json']!) as { records: WorkflowDefinition[] }).records;
export const ROOMS = (JSON.parse(FILES['data/rooms/household/00000.json']!) as { records: { id: string; label: string }[] }).records;
export const ALL_LABELS = PURCHASES.map((record) => record.label!);
export const byLabel = (label: string) => PURCHASES.find((record) => record.label === label)!;
export const roomId = (label: string) => ROOMS.find((room) => room.label === label)!.id;
export const termByLabel = (vocabularyCode: string, label: string) => {
  const workflow = WORKFLOWS.find((item) => item.key === vocabularyCode)!;
  return TERMS.find((term) => term.vocabulary_id === workflow.vocabulary_id && term.label === label)!;
};

interface ManifestFileEntry { path: string; sha256: string; bytes: number; count?: number; collection?: string }
interface ManifestShape { files: ManifestFileEntry[]; counts: Record<string, number> }

/** Bölümü yeni kayıtlarla yeniden yazar; depo bütünlüğü doğruladığı için manifestteki sha256/bytes/count da güncellenir. */
export function rewritten(path: string, mutate: (records: Record<string, unknown>[]) => Record<string, unknown>[], manifestText = FILES['manifest.json']!): Record<string, string> {
  const envelope = JSON.parse(FILES[path]!) as { collection: string; records: Record<string, unknown>[] };
  const records = mutate(envelope.records);
  const text = JSON.stringify({ ...envelope, records });
  const manifest = JSON.parse(manifestText) as ManifestShape;
  manifest.files = manifest.files.map((file) =>
    file.path === path ? { ...file, sha256: createHash('sha256').update(text, 'utf8').digest('hex'), bytes: Buffer.byteLength(text, 'utf8'), count: records.length } : file,
  );
  manifest.counts = { ...manifest.counts, [envelope.collection]: records.length };
  return { [path]: text, 'manifest.json': JSON.stringify(manifest) };
}

/** view_definitions › pivot tanımına purchase_need eklenir (pivot dalını sınamak için sentetik değişiklik). */
export const PIVOT_ACIK = rewritten(VIEWS_PATH, (records) =>
  records.map((record) => (record['key'] === 'pivot' ? { ...record, supported_kinds: [...(record['supported_kinds'] as string[]), 'purchase_need'] } : record)),
);

export function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

/** İlk okumada sentetik nesli verir; kesilince (offline = true) her okuma "kaynak yok" hatasıyla düşer (eski veri durumu). */
export class KesilebilenKaynak implements GenerationSource {
  readonly kind = 'fixture' as const;
  readonly label = 'sentetik (kesilebilir)';
  offline = false;
  private readonly inner = fixtureSource();
  readText(path: string): Promise<string> {
    if (this.offline) return Promise.reject(new Error(`Kaynak okunamadı: ${path}`));
    return this.inner.readText(path);
  }
}

export interface SetupOptions { device?: Device; overrides?: Record<string, string | null>; changeSet?: boolean; source?: GenerationSource }

export function setup({ device = 'desktop', overrides, changeSet = true, source }: SetupOptions = {}) {
  const kaynak = source ?? fixtureSource(overrides);
  const loader = changeSet ? () => ChangeSet.load({ storage: createMemoryStorage(), now: () => '2026-11-02T10:00:00.000Z' }) : null;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DeviceContext.Provider value={device}>
        <GenerationProvider source={kaynak} cache={null} changeSet={loader}>
          {children}
        </GenerationProvider>
      </DeviceContext.Provider>
    );
  }
  return { user: userEvent.setup(), ...render(<AlimlarPage location="/alimlar" />, { wrapper: Wrapper }) };
}

/**
 * Sonuç bölgesinde adı verilen kaydın etkileşim öğesi (liste satırı düğmesi ya da tablo satırı). Önce metinle bulunur,
 * sonra rolü ve erişilebilir adı yalnız o öğede doğrulanır. Neden: 28 satırlık bölgede getByRole(…, { name }) her
 * adayın adını hesaplar; jsdom'da bu her alt düğüm için getComputedStyle demektir ve antd'nin yüzlerce CSS kuralıyla yük
 * altında tek sorgu 1,5 sn'yi bulur. waitFor her turda bu sorguyu tekrarlayınca test 5 sn'yi aşıyordu (kök neden).
 */
export function kayitOgesi(region: HTMLElement, label: string, role: 'button' | 'row' = 'button'): HTMLElement {
  const secici = role === 'button' ? 'button' : 'tr, [role="row"]';
  const adaylar = within(region)
    .getAllByText(label, { exact: true })
    .map((metin) => metin.closest<HTMLElement>(secici))
    .filter((oge): oge is HTMLElement => oge !== null && region.contains(oge));
  const oge = [...new Set(adaylar)];
  expect(oge, `${label} için tek ${role}`).toHaveLength(1);
  expect(oge[0]).toHaveAccessibleName(role === 'button' ? new RegExp(label) : new RegExp(`^${label} `));
  return oge[0]!;
}
