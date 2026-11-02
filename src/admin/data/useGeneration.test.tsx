// React bağlamı ve hook'lar: GenerationProvider → useGeneration / useCollection / useRows / useQuery / useChangeSet.
// Depo, kaynak, indeks ve sorgu katmanları gerçektir (komşu dosyalar); nesil sentetik fixture'dan belleğe okunur.
// changeSet.ts komşu agent'ta yazılıyor: burada sahte ChangeSet ile yalnız hook'un bağlama mantığı sınanır.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CollectionName, PurchaseNeedRecord } from './types';
import { FixtureGenerationSource, HttpGenerationSource, SourceUnavailableError } from './sources';

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
  useGenerationImport,
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
    // Pasif efekt DOM işlemesinden sonra koşar; dizi tam olarak bu üç durumla dolmalı (fazlası ya da eksiği hata).
    await waitFor(() => expect(states).toEqual(['idle', 'checking', 'ready']));
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

// --- Tembel yükleme, iptal, tekilleştirme ------------------------------------------------------------------
const MANIFEST_FILES = (JSON.parse(FILES['manifest.json']!) as { files: { path: string; kind: string; collection?: string }[] }).files;
const EVENT_PATHS = MANIFEST_FILES.filter((file) => file.kind === 'partition' && file.collection === 'forecast_events').map((file) => file.path);

function countingSource(overrides: Record<string, string | null> = {}) {
  const source = fixtureSource(overrides);
  const reads: string[] = [];
  const original = source.readText.bind(source);
  source.readText = (path: string) => {
    reads.push(path);
    return original(path);
  };
  return { source, reads };
}

/** /__aile/generation/** isteklerini sentetik nesilden yanıtlar; data/forecast_events/** iptal edilene dek bekler. */
function hangingFetch() {
  const signals: { path: string; signal: AbortSignal | null }[] = [];
  const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/__aile\/generation\//, '').split('?')[0]!;
    signals.push({ path, signal: init?.signal ?? null });
    if (path.startsWith('data/forecast_events/')) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      });
    }
    const text = FILES[path];
    return Promise.resolve(text === undefined ? new Response('{"error":"Dosya yok"}', { status: 404 }) : new Response(text, { status: 200 }));
  });
  return { fetchImpl, signals };
}

describe('useCollection › dönem kapsamı', () => {
  it('periods verilince yalnız o dönemlerin parçaları okunur; satırlar o parçalardan gelir', async () => {
    const { source, reads } = countingSource();
    const { result } = renderHook(() => useCollection('forecast_events', { periods: ['2026-11'] }), { wrapper: wrapperWith({ source }) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.rows.length).toBeGreaterThan(0);
    expect(result.current.rows.every((row) => String(row.occurred_on).startsWith('2026-11'))).toBe(true);
    expect(reads.filter((path) => path.startsWith('data/forecast_events/'))).toEqual(EVENT_PATHS.filter((path) => path.includes('/2026-11/')));
  });

  it('her render yeni dizi verse de aynı dönem kümesi yeniden yükletmez', async () => {
    const { source, reads } = countingSource();
    const { result, rerender } = renderHook(() => useCollection('forecast_events', { periods: ['2026-12', '2026-11'] }), { wrapper: wrapperWith({ source }) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const rows = result.current.rows;
    rerender();
    expect(result.current.rows).toBe(rows);
    expect(reads.filter((path) => path.startsWith('data/forecast_events/'))).toHaveLength(2);
  });
});

describe('useCollection › iptal ve tekilleştirme', () => {
  it('rota değişiminde (bileşen kalkınca) bekleyen parça isteği AbortController ile iptal edilir; durum hata olmaz', async () => {
    const { fetchImpl, signals } = hangingFetch();
    const source = new HttpGenerationSource('/__aile/generation', fetchImpl);
    let setShow: (value: boolean) => void = () => undefined;
    function EventsPage() {
      const events = useCollection('forecast_events', { periods: ['2026-11'] });
      return <p>{events.loading ? 'Yükleniyor' : `${events.rows.length} olay`}</p>;
    }
    function StatusProbe() {
      const generation = useGeneration();
      return <output>{generation.state}</output>;
    }
    function Router() {
      const [show, set] = useState(true);
      setShow = set;
      return show ? <EventsPage /> : <p>Başka sayfa</p>;
    }
    const Wrapper = wrapperWith({ source });
    const view = render(
      <Wrapper>
        <StatusProbe />
        <Router />
      </Wrapper>,
    );
    await waitFor(() => expect(signals.some((entry) => entry.path.startsWith('data/forecast_events/'))).toBe(true));
    const pending = signals.find((entry) => entry.path.startsWith('data/forecast_events/'))!;
    expect(pending.signal?.aborted).toBe(false);
    act(() => setShow(false));
    await waitFor(() => expect(pending.signal?.aborted).toBe(true));
    await waitFor(() => expect(view.getByRole('status')).toHaveTextContent('ready'));
    expect(view.getByText('Başka sayfa')).toBeInTheDocument();
  });

  it('StrictMode çift efekti aynı parçayı iki kez istemez ve isteği iptal etmez', async () => {
    const { source, reads } = countingSource();
    function Probe() {
      const rooms = useCollection('rooms');
      return <p>{rooms.loading ? 'Yükleniyor' : `${rooms.rows.length} oda`}</p>;
    }
    const Wrapper = wrapperWith({ source });
    const view = render(
      <StrictMode>
        <Wrapper>
          <Probe />
        </Wrapper>
      </StrictMode>,
    );
    await waitFor(() => expect(view.getByText(`${MANIFEST.counts.rooms} oda`)).toBeInTheDocument());
    expect(reads.filter((path) => path === 'data/rooms/household/00000.json')).toHaveLength(1);
    expect(reads.filter((path) => path === 'manifest.json')).toHaveLength(1);
  });
});

describe('useGeneration › bozuk aday nesil', () => {
  it('yenilemede bozuk hash: durum stale, mesaj "Hata: ", satırlar son iyi nesilden kalır', async () => {
    const files = { ...FILES };
    const source = new FixtureGenerationSource(files, 'sentetik');
    const { result } = renderHook(() => ({ generation: useGeneration(), needs: useCollection('purchase_needs') }), { wrapper: wrapperWith({ source }) });
    await waitFor(() => expect(result.current.needs.loading).toBe(false));
    const good = result.current.needs.rows;
    expect(good).toHaveLength(NEEDS.length);
    // Yeni nesil kimliği + manifest hash'iyle uyuşmayan parça (e2e/admin-data-states.spec.ts ile aynı senaryo).
    const manifest = JSON.parse(FILES['manifest.json']!) as { generation_id: string };
    (files as Record<string, string>)['manifest.json'] = JSON.stringify({ ...manifest, generation_id: 'c'.repeat(64) });
    (files as Record<string, string>)['data/purchase_needs/household/00000.json'] = FILES['data/purchase_needs/household/00000.json']!.replace('Örnek lambader', 'Bozuk kayıt');
    const tampered = new FixtureGenerationSource(files, 'sentetik');
    source.readText = tampered.readText.bind(tampered);
    await act(async () => {
      await result.current.generation.refresh();
    });
    expect(result.current.generation.state).toBe('stale');
    expect(result.current.generation.message).toMatch(/^Hata: /);
    expect(result.current.generation.generationId).toBe(GENERATION_ID);
    expect(result.current.needs.rows).toBe(good);
    expect(result.current.needs.error).toBeNull();
  });
});

describe('useGenerationImport › FileList (Safari klasör yolu)', () => {
  function asFolder(root: string, overrides: Record<string, string | null> = {}): File[] {
    const entries = Object.entries({ ...FILES, ...overrides }).filter((entry): entry is [string, string] => entry[1] !== null);
    return entries.map(([rel, text]) => {
      const file = new File([text], rel.split('/').pop()!, { type: 'application/json' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `${root}/${rel}` });
      return file;
    });
  }

  it('importFiles kaynağı klasör dosya listesine geçirir; nesil yeniden okunur', async () => {
    const { result } = renderHook(() => ({ generation: useGeneration(), importer: useGenerationImport() }), { wrapper: wrapperWith() });
    await waitFor(() => expect(result.current.generation.state).toBe('ready'));
    expect(typeof result.current.importer.canImportFiles).toBe('boolean');
    expect(result.current.importer.canPickDirectory).toBe(false);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.importer.importFiles(asFolder('nesil-klasoru'));
    });
    expect(ok).toBe(true);
    expect(result.current.importer.sourceMessage).toBeNull();
    expect(result.current.importer.source).toEqual({ kind: 'directory', label: 'nesil-klasoru' });
    expect(result.current.generation.source).toEqual({ kind: 'directory', label: 'nesil-klasoru' });
    await waitFor(() => expect(result.current.generation.state).toBe('ready'));
    expect(result.current.generation.generationId).toBe(GENERATION_ID);
  });

  it('manifest.json taşımayan seçim reddedilir: false, "Hata: " mesajı, kaynak değişmez', async () => {
    const { result } = renderHook(() => useGenerationImport(), { wrapper: wrapperWith() });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.importFiles(asFolder('yanlis', { 'manifest.json': null }));
    });
    expect(ok).toBe(false);
    expect(result.current.sourceMessage).toMatch(/^Hata: .*manifest\.json/);
    expect(result.current.source.kind).toBe('fixture');
  });
});

describe('CollectionLoader › iptal', () => {
  function deferredStore() {
    const calls: { name: string; options?: { periods?: readonly string[]; signal?: AbortSignal } }[] = [];
    const store = {
      loadCollection: (name: string, options?: { periods?: readonly string[]; signal?: AbortSignal }) => {
        calls.push({ name, options });
        return new Promise<readonly { id: string; tenant_id: string }[]>((resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new DOMException('iptal', 'AbortError')));
          setTimeout(() => resolve([{ id: name, tenant_id: 't' }]), 20);
        });
      },
      getCollection: () => undefined,
    };
    return { store, calls };
  }

  it('tek bekleyen iptal edince depo yüklemesi iptal edilir; anlık görüntü hata değil, sonraki ensure yeniden başlatır', async () => {
    const { store, calls } = deferredStore();
    const loader = new CollectionLoader(store);
    const controller = new AbortController();
    const first = loader.ensure('rooms', { signal: controller.signal });
    controller.abort();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls[0]!.options?.signal?.aborted).toBe(true);
    expect(loader.snapshot('rooms')).toEqual({ rows: [], loading: true, error: null });
    await loader.ensure('rooms');
    expect(calls).toHaveLength(2);
    expect(loader.snapshot('rooms').rows).toHaveLength(1);
    expect(loader.snapshot('rooms').error).toBeNull();
  });

  it('iptal sonrası aynı mikro görevde yeniden isteyen varsa yükleme sürer (StrictMode/rota geçişi)', async () => {
    const { store, calls } = deferredStore();
    const loader = new CollectionLoader(store);
    const a = new AbortController();
    void loader.ensure('terms', { signal: a.signal });
    a.abort();
    const b = new AbortController();
    const second = loader.ensure('terms', { signal: b.signal });
    await second;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.options?.signal?.aborted).toBe(false);
    expect(loader.snapshot('terms').rows).toHaveLength(1);
  });

  it('dönem kapsamı anahtarı ayrıdır; dönemler depoya iletilir', async () => {
    const { store, calls } = deferredStore();
    const loader = new CollectionLoader(store);
    await loader.ensure('forecast_events', { periods: ['2026-12', '2026-11'] });
    expect(calls[0]!.options?.periods).toEqual(['2026-11', '2026-12']);
    expect(loader.snapshot('forecast_events', { periods: ['2026-11', '2026-12'] }).loading).toBe(false);
    expect(loader.snapshot('forecast_events').loading).toBe(true);
  });
});

describe('useCollection › yeniden dene', () => {
  it('manifest okunamadıktan sonra başarılı yenileme hata almış koleksiyonu yeniden yükler', async () => {
    const source = fixtureSource({ 'manifest.json': null });
    const { result } = renderHook(() => ({ generation: useGeneration(), rooms: useCollection('rooms') }), { wrapper: wrapperWith({ source }) });
    await waitFor(() => expect(result.current.rooms.loading).toBe(false));
    expect(result.current.generation.state).toBe('error');
    expect(result.current.rooms.error).toMatch(/^Hata: /);
    const healthy = fixtureSource();
    source.readText = healthy.readText.bind(healthy);
    await act(async () => {
      await result.current.generation.refresh();
    });
    await waitFor(() => expect(result.current.rooms.rows).toHaveLength(MANIFEST.counts.rooms!));
    expect(result.current.rooms.error).toBeNull();
    expect(result.current.generation.state).toBe('ready');
  });
});

describe('useCollection › parça hatası sonrası yeniden dene', () => {
  it('purchase_needs 503 sonrası yenileme kaydı getirir; hata kalkar, durum ready', async () => {
    const NEEDS_PATH = 'data/purchase_needs/household/00000.json';
    const source = fixtureSource();
    const healthy = source.readText.bind(source);
    let down = true;
    const reads: string[] = [];
    source.readText = async (path: string) => {
      reads.push(path);
      if (down && path === NEEDS_PATH) {
        throw new SourceUnavailableError(`Nesil kaynağı yanıt vermedi (503): ${path}`, { source: 'fixture', path, status: 503 });
      }
      return healthy(path);
    };
    const { result } = renderHook(
      () => ({ generation: useGeneration(), needs: useCollection('purchase_needs'), rooms: useCollection('rooms') }),
      { wrapper: wrapperWith({ source }) },
    );
    await waitFor(() => expect(result.current.needs.loading).toBe(false));
    await waitFor(() => expect(result.current.rooms.loading).toBe(false));
    expect(result.current.needs.error).toMatch(/^Hata: .*503/);
    expect(result.current.needs.rows).toHaveLength(0);
    expect(result.current.rooms.rows).toHaveLength(MANIFEST.counts.rooms!);
    down = false;
    await act(async () => {
      await result.current.generation.refresh();
    });
    await waitFor(() => expect(result.current.needs.rows).toHaveLength(MANIFEST.counts.purchase_needs!));
    expect(result.current.needs.error).toBeNull();
    expect(result.current.needs.rows.some((record) => record.source_record_id === 'kalem-027')).toBe(true);
    expect(result.current.rooms.rows).toHaveLength(MANIFEST.counts.rooms!);
    await waitFor(() => expect(result.current.generation.state).toBe('ready'));
    expect(reads.filter((path) => path === NEEDS_PATH).length).toBeGreaterThanOrEqual(2);
  });
});

describe('GenerationProvider › kaynak seçilmemiş (üretim: Klasör içe aktar)', () => {
  function folderFiles(root: string): File[] {
    return Object.entries(FILES).map(([rel, text]) => {
      const file = new File([text], rel.split('/').pop()!, { type: 'application/json' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `${root}/${rel}` });
      return file;
    });
  }

  it('source={null}: ağ isteği yok, importRequired, durum error ve "Klasörden içe aktar" yönlendirmesi; aria-busy kalmaz', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const { result } = renderHook(
        () => ({ generation: useGeneration(), importer: useGenerationImport(), rooms: useCollection('rooms') }),
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <GenerationProvider source={null} cache={null} changeSet={null}>
              {children}
            </GenerationProvider>
          ),
        },
      );
      expect(result.current.generation.importRequired).toBe(true);
      expect(result.current.importer.importRequired).toBe(true);
      expect(result.current.generation.source).toEqual({ kind: 'directory', label: 'Klasör seçilmedi' });
      await waitFor(() => expect(result.current.generation.state).toBe('error'));
      expect(result.current.generation.message).toMatch(/^Hata: Nesil klasörü seçilmedi/);
      expect(result.current.generation.message).toContain('Klasörden içe aktar');
      await waitFor(() => expect(result.current.rooms.loading).toBe(false));
      expect(result.current.rooms.error).toMatch(/^Hata: Nesil klasörü seçilmedi/);
      expect(fetchSpy).not.toHaveBeenCalled();

      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.importer.importFiles(folderFiles('nesil'));
      });
      expect(ok).toBe(true);
      expect(result.current.generation.importRequired).toBe(false);
      expect(result.current.generation.source).toEqual({ kind: 'directory', label: 'nesil' });
      await waitFor(() => expect(result.current.generation.state).toBe('ready'));
      await waitFor(() => expect(result.current.rooms.rows).toHaveLength(MANIFEST.counts.rooms!));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('geliştirmede (vitest DEV) source verilmezse varsayılan HTTP kaynağıdır; importRequired false', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: 'yok' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const { result } = renderHook(() => useGeneration(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <GenerationProvider cache={null} changeSet={null}>
            {children}
          </GenerationProvider>
        ),
      });
      expect(result.current.source).toEqual({ kind: 'http', label: '/__aile/generation' });
      expect(result.current.importRequired).toBe(false);
      await waitFor(() => expect(result.current.state).toBe('error'));
      expect(fetchSpy).toHaveBeenCalledWith('/__aile/generation/manifest.json', expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
