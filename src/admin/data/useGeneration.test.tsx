// React bağlamı ve hook'lar: GenerationProvider → useGeneration / useCollection / useRows / useQuery / useChangeSet.
// Depo, kaynak, indeks ve sorgu katmanları gerçektir (komşu dosyalar); nesil sentetik fixture'dan belleğe okunur.
// changeSet.ts komşu agent'ta yazılıyor: burada sahte ChangeSet ile yalnız hook'un bağlama mantığı sınanır.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useEffect, type ReactNode } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CollectionName, PurchaseNeedRecord } from './types';
import { FixtureGenerationSource } from './sources';

interface FakeOp { opId: string; recordId: string; kind: string; before: unknown; after: unknown; at: string; actor: 'local'; undone?: boolean }

vi.mock('./changeSet', () => {
  /** Sahte değişiklik kümesi: 'note' işlemi etiketi after.note ile değiştirir (yalnız bağlama testi için). */
  class ChangeSet {
    static load = vi.fn(async () => new ChangeSet());
    readonly ops: FakeOp[] = [];
    readonly persistence = 'ok';
    get pending(): number {
      return this.ops.filter((op) => !op.undone).length;
    }
    async add(input: { recordId: string; kind: string; before: unknown; after: unknown }): Promise<FakeOp> {
      const op: FakeOp = { opId: `OP${String(this.ops.length + 1).padStart(3, '0')}`, ...input, at: '2026-10-28T14:05:00.000Z', actor: 'local' };
      this.ops.push(op);
      return op;
    }
    async undo(opId: string): Promise<{ ok: true; op: FakeOp } | { ok: false; reason: string }> {
      const op = this.ops.find((candidate) => candidate.opId === opId);
      if (!op) return { ok: false, reason: 'Değişiklik bulunamadı' };
      op.undone = true;
      return { ok: true, op };
    }
    apply<R extends { id: string }>(records: readonly R[]): R[] {
      return records.map((record) => {
        const notes = this.ops.filter((op) => !op.undone && op.recordId === record.id && op.kind === 'note');
        const last = notes[notes.length - 1];
        return last ? { ...record, label: (last.after as { note: string }).note } : record;
      });
    }
    pendingFor(recordId: string): FakeOp[] {
      return this.ops.filter((op) => !op.undone && op.recordId === recordId);
    }
    toBatch(): { ops: never[]; skipped: never[] } {
      return { ops: [], skipped: [] };
    }
  }
  return {
    ChangeSet,
    CHANGE_SET_KEY: 'aile-admin/change-set',
    createIdbStorage: vi.fn(() => ({ get: async () => undefined, set: async () => undefined })),
    createMemoryStorage: vi.fn(() => ({ get: async () => undefined, set: async () => undefined })),
  };
});

import { ChangeSet } from './changeSet';
import {
  CollectionLoader,
  GenerationProvider,
  collectionForKind,
  useChangeSet,
  useCollection,
  useGeneration,
  useQuery,
  useRows,
  type GenerationProviderProps,
} from './useGeneration';

// --- Sentetik nesil → bellek -------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '../../../fixtures/generation-synthetic');
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find((name) => statSync(join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = join(FIXTURE_ROOT, GENERATION_ID);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

const FILES: Record<string, string> = Object.fromEntries(
  walk(GENERATION_DIR)
    .map((full) => relative(GENERATION_DIR, full))
    .filter((rel) => rel === 'manifest.json' || rel.startsWith('data/'))
    .map((rel) => [rel, readFileSync(join(GENERATION_DIR, rel), 'utf8')]),
);
const MANIFEST = JSON.parse(FILES['manifest.json']!) as { counts: Record<string, number> };
const NEEDS = (JSON.parse(FILES['data/purchase_needs/household/00000.json']!) as { records: PurchaseNeedRecord[] }).records;
const LAMBADER = NEEDS.find((record) => record.source_record_id === 'kalem-027')!;
const ROOM_WITH_FOUR = LAMBADER.room_id!;

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

function wrapperWith(props: Partial<GenerationProviderProps> = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <GenerationProvider source={props.source ?? fixtureSource()} cache={null} {...props}>
        {children}
      </GenerationProvider>
    );
  };
}

// --- Sağlayıcı ---------------------------------------------------------------------------------------
describe('GenerationProvider › useGeneration', () => {
  it('idle → checking → ready; manifest, generationId ve lastReadAt dolar', async () => {
    const states: string[] = [];
    function Probe() {
      const generation = useGeneration();
      useEffect(() => {
        states.push(generation.state);
      }, [generation.state]);
      return <output>{generation.generationId ?? 'Henüz yok'}</output>;
    }
    const Wrapper = wrapperWith();
    const view = render(
      <Wrapper>
        <Probe />
      </Wrapper>,
    );
    expect(view.getByRole('status')).toHaveTextContent('Henüz yok');
    await waitFor(() => expect(view.getByRole('status')).toHaveTextContent(GENERATION_ID));
    expect(states).toEqual(['idle', 'checking', 'ready']);
  });

  it('manifest ve kaynak bilgisi hook üzerinden okunur', async () => {
    const { result } = renderHook(() => useGeneration(), { wrapper: wrapperWith() });
    // renderHook etkileri act içinde çalıştırır: ilk okuma zaten 'checking' (idle → checking geçişi Probe testinde).
    expect(result.current.state).toBe('checking');
    expect(result.current.manifest).toBeNull();
    expect(result.current.generationId).toBeNull();
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.manifest?.generation_id).toBe(GENERATION_ID);
    expect(result.current.manifest?.counts.purchase_needs).toBe(MANIFEST.counts.purchase_needs);
    expect(result.current.generationId).toBe(GENERATION_ID);
    expect(Number.isNaN(Date.parse(result.current.lastReadAt!))).toBe(false);
    expect(result.current.message).toBeNull();
    expect(result.current.source).toEqual({ kind: 'fixture', label: 'sentetik' });
  });

  it('bozuk manifest: error, mesaj "Hata: " ile başlar, manifest yok', async () => {
    const { result } = renderHook(() => useGeneration(), { wrapper: wrapperWith({ source: fixtureSource({ 'manifest.json': '{bozuk' }) }) });
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.message).toMatch(/^Hata: /);
    expect(result.current.manifest).toBeNull();
    expect(result.current.generationId).toBeNull();
  });

  it('refresh: yeniden okur, ready kalır ve lastReadAt ilerler', async () => {
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 9, 28, 14, 5, tick++));
    const { result } = renderHook(() => useGeneration(), { wrapper: wrapperWith({ now }) });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    const before = result.current.lastReadAt!;
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state).toBe('ready');
    expect(Date.parse(result.current.lastReadAt!)).toBeGreaterThan(Date.parse(before));
    expect(result.current.manifest?.generation_id).toBe(GENERATION_ID);
  });

  it('pickDirectory: desteklenmeyen tarayıcıda false döner ve "Hata: " mesajı verir; kaynak değişmez', async () => {
    const { result } = renderHook(() => useGeneration(), { wrapper: wrapperWith() });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.canPickDirectory).toBe(false);
    let picked: boolean | undefined;
    await act(async () => {
      picked = await result.current.pickDirectory();
    });
    expect(picked).toBe(false);
    expect(result.current.sourceMessage).toMatch(/^Hata: /);
    expect(result.current.source.kind).toBe('fixture');
    expect(result.current.state).toBe('ready');
  });

  it('sağlayıcı dışında kullanım "Hata: " ile fırlatır', () => {
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useGeneration())).toThrow(/^Hata: /);
    silenced.mockRestore();
  });
});

// --- Koleksiyon ----------------------------------------------------------------------------------------
describe('useCollection', () => {
  it('loading → kayıtlar; manifest sayısı kadar oda gelir', async () => {
    const { result } = renderHook(() => useCollection('rooms'), { wrapper: wrapperWith() });
    expect(result.current).toEqual({ rows: [], loading: true, error: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.rows).toHaveLength(MANIFEST.counts.rooms!);
    expect(result.current.rows[0]!.kind).toBe('room');
  });

  it('nesilde olmayan koleksiyon (payments) kayıtsız ve hatasız döner: sayfa "Kaynakta kayıt yok" der', async () => {
    const { result } = renderHook(() => useCollection('payments' as CollectionName), { wrapper: wrapperWith() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ rows: [], loading: false, error: null });
  });

  it('parça okunamazsa error "Hata: " ile dolar, satırlar boş kalır', async () => {
    const source = fixtureSource({ 'data/rooms/household/00000.json': null });
    const { result } = renderHook(() => useCollection('rooms'), { wrapper: wrapperWith({ source }) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toMatch(/^Hata: /);
  });

  it('aynı koleksiyonu isteyen iki hook tek yükleme yapar ve aynı diziyi paylaşır', async () => {
    const source = fixtureSource();
    const reads: string[] = [];
    const original = source.readText.bind(source);
    source.readText = (path: string) => {
      reads.push(path);
      return original(path);
    };
    const { result } = renderHook(() => [useCollection('terms'), useCollection('terms')] as const, { wrapper: wrapperWith({ source }) });
    await waitFor(() => expect(result.current[0].loading).toBe(false));
    expect(result.current[1].loading).toBe(false);
    expect(result.current[0].rows).toBe(result.current[1].rows);
    expect(reads.filter((path) => path.startsWith('data/terms/'))).toHaveLength(1);
  });
});

describe('CollectionLoader (saf TS)', () => {
  it('ensure tek sefer yükler; hata mesajı "Hata: " ile başlar; snapshot referansı kararlı', async () => {
    const calls: string[] = [];
    const fakeStore = {
      loadCollection: async (name: string) => {
        calls.push(name);
        if (name === 'issues') throw new Error('okunamadı');
        return [{ id: 'a', tenant_id: 't' }];
      },
      getCollection: () => undefined,
    };
    const loader = new CollectionLoader(fakeStore);
    const notified: number[] = [];
    loader.subscribe(() => notified.push(1));
    const pending = loader.snapshot('rooms');
    expect(pending).toEqual({ rows: [], loading: true, error: null });
    await Promise.all([loader.ensure('rooms'), loader.ensure('rooms')]);
    expect(calls).toEqual(['rooms']);
    const ready = loader.snapshot('rooms');
    expect(ready.rows).toHaveLength(1);
    expect(loader.snapshot('rooms')).toBe(ready);
    await loader.ensure('issues');
    expect(loader.snapshot('issues')).toEqual({ rows: [], loading: false, error: 'Hata: okunamadı' });
    expect(notified.length).toBeGreaterThan(0);
  });
});

// --- Satırlar ve sorgu ------------------------------------------------------------------------------------
describe('collectionForKind', () => {
  it('yedi kaydın koleksiyonunu verir; bilinmeyen tür "Hata: " ile fırlatır', () => {
    expect(collectionForKind('purchase_need')).toBe('purchase_needs');
    expect(collectionForKind('work_order')).toBe('work_orders');
    expect(collectionForKind('milestone')).toBe('milestones');
    expect(() => collectionForKind('payment')).toThrow(/^Hata: /);
  });
});

describe('useRows', () => {
  it('purchase_need → RecordRow[]; plan ve gerçek ayrı alanlar, oda adı çözülür', async () => {
    const { result } = renderHook(() => useRows('purchase_need'), { wrapper: wrapperWith() });
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toHaveLength(MANIFEST.counts.purchase_needs!));
    const row = result.current.find((candidate) => candidate.id === LAMBADER.id)!;
    expect(row.code).toBe('kalem-027');
    expect(row.label).toBe('Örnek lambader');
    expect(row.planned).toEqual({ amount: '700.00', currency: 'TRY' });
    expect(row.actual).toBeNull();
    expect(row.kind).toBe('purchase_need');
    expect(typeof row.room).toBe('string');
  });
});

describe('useQuery', () => {
  const ROOM_AST = { facets: { room: [ROOM_WITH_FOUR] } } as const;

  it('filtresiz sorgu tüm kayıtları verir; counts bütün odaları sayar', async () => {
    const { result } = renderHook(() => useQuery('purchase_need', { facets: {} }), { wrapper: wrapperWith() });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.total).toBe(NEEDS.length);
    expect(result.current.ids.size).toBe(NEEDS.length);
    expect(result.current.rows).toHaveLength(NEEDS.length);
    expect(result.current.counts.room[ROOM_WITH_FOUR]).toBe(4);
    expect(result.current.counts.room.unknown).toBe(4);
  });

  it('oda filtresi id kümesini ve satırları daraltır; ids ile rows aynı kayıtlar', async () => {
    const { result } = renderHook(() => useQuery('purchase_need', ROOM_AST), { wrapper: wrapperWith() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ids.size).toBe(4);
    expect(result.current.rows.map((row) => row.id).sort()).toEqual([...result.current.ids].sort());
    expect(result.current.ids.has(LAMBADER.id)).toBe(true);
    expect(result.current.total).toBe(NEEDS.length);
    // Kendi boyutu hariç sayım: diğer odalar görünür kalır.
    expect(result.current.counts.room.unknown).toBe(4);
  });

  it('metin araması ve sıralama uygulanır; aynı içerikli yeni AST nesnesi yeniden hesaplatmaz', async () => {
    const { result, rerender } = renderHook(({ text }: { text: string }) => useQuery('purchase_need', { facets: {}, text, sort: { field: 'label', dir: 'asc' } }), {
      wrapper: wrapperWith(),
      initialProps: { text: 'lambader' },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect([...result.current.ids]).toEqual([LAMBADER.id]);
    const rows = result.current.rows;
    rerender({ text: 'lambader' });
    expect(result.current.rows).toBe(rows);
    rerender({ text: '' });
    expect(result.current.rows).toHaveLength(NEEDS.length);
    const labels = result.current.rows.map((row) => row.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'tr')));
  });
});

// --- Değişiklik kümesi -------------------------------------------------------------------------------------
describe('useChangeSet', () => {
  it('ChangeSet.load çağrılır; add pending\'i artırır ve satırlara yansır; undo geri alır', async () => {
    vi.mocked(ChangeSet.load).mockClear();
    const { result } = renderHook(() => ({ change: useChangeSet(), rows: useRows('purchase_need') }), { wrapper: wrapperWith() });
    await waitFor(() => expect(result.current.change.ready).toBe(true));
    await waitFor(() => expect(result.current.rows).toHaveLength(NEEDS.length));
    expect(ChangeSet.load).toHaveBeenCalledTimes(1);
    expect(result.current.change.pending).toBe(0);

    let opId = '';
    await act(async () => {
      const op = await result.current.change.add({ recordId: LAMBADER.id, kind: 'note', before: { note: 'Sentetik kayıt' }, after: { note: 'Ölçü alındı' } });
      opId = op.opId;
    });
    expect(result.current.change.pending).toBe(1);
    expect(result.current.change.pendingFor(LAMBADER.id)).toHaveLength(1);
    expect(result.current.rows.find((row) => row.id === LAMBADER.id)!.label).toBe('Ölçü alındı');

    await act(async () => {
      const undone = await result.current.change.undo(opId);
      expect(undone.ok).toBe(true);
    });
    expect(result.current.change.pending).toBe(0);
    expect(result.current.rows.find((row) => row.id === LAMBADER.id)!.label).toBe('Örnek lambader');
  });

  it('changeSet={null}: değişiklik kümesi kapalı; add "Hata: " ile reddedilir', async () => {
    const { result } = renderHook(() => useChangeSet(), { wrapper: wrapperWith({ changeSet: null }) });
    expect(result.current.ready).toBe(false);
    expect(result.current.pending).toBe(0);
    await expect(result.current.add({ recordId: LAMBADER.id, kind: 'note', before: { note: null }, after: { note: 'x' } })).rejects.toThrow(/^Hata: /);
  });
});
