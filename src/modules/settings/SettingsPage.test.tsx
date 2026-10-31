import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import type { BatchRequest, ReadRequest } from '@shared/api';
import type { Item } from '@shared/schema';
import type { QueuedOp } from '@/sync/queue';
import { configureController, refresh, upsert } from '@/sync/controller';
import { setApiUrl } from '@/sync/config';
import { applyRead, getState, resetStore, setState, type SyncStatus } from '@/sync/store';
import * as cache from '@/sync/cache';
import { SettingsPage } from './SettingsPage';

// IndexedDB jsdom'da yok; önbellek katmanı sahte, kuyruk/okuma gerçek controller + sahte fetch ile çalışır.
vi.mock('@/sync/cache', () => ({
  loadCache: vi.fn(async () => undefined),
  saveCache: vi.fn(async () => undefined),
  clearCache: vi.fn(async () => undefined),
  loadOutbox: vi.fn(async () => []),
  saveOutbox: vi.fn(async () => undefined),
}));

const API = 'https://script.google.com/macros/s/test/exec';
const serverA: Item = { id: 'A', tip: 'satinalma', ad: 'Sunucu adı', version: 3 };
const pendingA: QueuedOp = { op: { op: 'upsert', table: 'kalemler', id: 'A', opId: 'op-a', baseVersion: 3, patch: { ad: 'Çevrimdışı düzenleme' } }, ts: '2099-01-01T00:00:00Z', attempts: 0 };

type Req = ReadRequest | BatchRequest;
type ReadMode = 'ok' | 'network' | 'server-error';
/**
 * Sahte API: okuma `mode`'a göre yanıtlar (sunucu A satırı / ağ hatası / sunucu hatası); batch gönderimi her zaman ağ hatası
 * (yazım henüz ulaşamıyor). `holdFirstRead` ilk okumayı `release()`e kadar bekletir ve ona `notModified` döndürür.
 */
function fakeApi(opts: { read?: ReadMode; holdFirstRead?: boolean } = {}) {
  const state = { read: opts.read ?? 'ok' as ReadMode };
  const reads: Array<{ fingerprint?: string }> = [];
  const batches: BatchRequest[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as Req;
    if (req.action === 'read') {
      reads.push({ fingerprint: req.fingerprint });
      if (opts.holdFirstRead && reads.length === 1) {
        await held;
        return new Response(JSON.stringify({ ok: true, notModified: true, fingerprint: req.fingerprint, serverTime: '2099-01-02T00:00:00Z', schemaVersion: 2 }), { status: 200 });
      }
      if (state.read === 'network') throw new TypeError('Failed to fetch');
      if (state.read === 'server-error') return new Response(JSON.stringify({ ok: false, error: 'internal', message: 'Sunucu meşgul' }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, fingerprint: 'srv-2', serverTime: '2099-01-02T00:00:00Z', schemaVersion: 2, items: [serverA], settings: [], cash: [] }), { status: 200 });
    }
    batches.push(req as BatchRequest);
    throw new TypeError('Failed to fetch');
  });
  return { state, reads, batches, release: () => release(), fetchImpl: fetchImpl as unknown as typeof fetch };
}

function mount(outbox: QueuedOp[] = [pendingA], status: SyncStatus = 'offline') {
  applyRead({ ok: true, fingerprint: 'srv-1', serverTime: '2099-01-01T00:00:00Z', schemaVersion: 2, items: [serverA], settings: [], cash: [] });
  setState({ status, outbox });
  render(<SettingsPage />);
}

const clearButton = () => screen.getByRole('button', { name: 'Önbelleği temizle' });
const resultLine = () => screen.findByRole('status', { name: 'Önbellek sonucu' });

beforeEach(() => {
  localStorage.clear();
  resetStore();
  setApiUrl(API);
  vi.mocked(cache.clearCache).mockReset().mockResolvedValue(undefined);
  vi.mocked(cache.saveCache).mockClear();
});
afterEach(() => { resetStore(); vi.restoreAllMocks(); });

describe('Ayarlar · Önbelleği temizle', () => {
  it('bekleyen çevrimdışı kayıt korunur; yeniden okumada sunucu verisinin üstüne biner', async () => {
    const api = fakeApi();
    configureController({ fetchImpl: api.fetchImpl });
    mount();
    await userEvent.click(clearButton());
    await vi.waitFor(() => expect(api.reads).toHaveLength(1));
    // Önbellek gerçekten silindi ve tam okuma istendi (parmak izi gönderilmedi).
    expect(cache.clearCache).toHaveBeenCalledTimes(1);
    expect(api.reads[0].fingerprint).toBeUndefined();
    await vi.waitFor(() => expect(api.batches).toHaveLength(1));
    await vi.waitFor(() => expect(getState().status).toBe('offline'));
    // Kuyruk düşmedi: aynı işlem, yeniden deneme sayacı artmış hâlde bekliyor.
    expect(getState().outbox.map((q) => q.op.opId)).toEqual(['op-a']);
    expect(getState().items.find((i) => i.id === 'A')).toMatchObject({ ad: 'Çevrimdışı düzenleme', version: 3 });
    expect(getState().fingerprint).toBe('srv-2');
  });

  it('temizleme beklerken gerçek enqueue ile kuyruğa giren kayıt da korunur (async aralık)', async () => {
    const api = fakeApi();
    configureController({ fetchImpl: api.fetchImpl });
    let release!: () => void;
    vi.mocked(cache.clearCache).mockImplementation(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    mount();
    await userEvent.click(clearButton());
    await vi.waitFor(() => expect(cache.clearCache).toHaveBeenCalledTimes(1));
    // Silme sürerken başka bir ekran gerçek yazım yolunu kullanır: applyLocalOp + outbox + persist + flush.
    upsert('kalemler', 'B', { tip: 'satinalma', ad: 'Aralıkta eklenen' });
    release();
    await vi.waitFor(() => expect(api.reads).toHaveLength(1));
    await vi.waitFor(() => expect(getState().status).toBe('offline'));
    expect(getState().outbox.map((q) => q.op.id)).toEqual(['A', 'B']);
    expect(getState().items.map((i) => i.id).sort()).toEqual(['A', 'B']);
    expect(getState().items.find((i) => i.id === 'B')).toMatchObject({ ad: 'Aralıkta eklenen' });
  });

  it('uçuştaki eski parmak izli okuma notModified dönerse bir kez daha tam okuma ister ve kopyayı yeniden yazar', async () => {
    const api = fakeApi({ holdFirstRead: true });
    configureController({ fetchImpl: api.fetchImpl });
    mount([], 'synced');
    const inflight = refresh(); // periyodik/görünürlük yenilemesi, eski parmak iziyle yolda
    await vi.waitFor(() => expect(api.reads).toEqual([{ fingerprint: 'srv-1' }]));
    await userEvent.click(clearButton());
    await vi.waitFor(() => expect(cache.clearCache).toHaveBeenCalledTimes(1));
    expect(cache.saveCache).not.toHaveBeenCalled();
    api.release();
    await inflight;
    await vi.waitFor(() => expect(api.reads).toEqual([{ fingerprint: 'srv-1' }, { fingerprint: undefined }]));
    const status = await resultLine();
    await vi.waitFor(() => expect(status).toHaveTextContent(/yeniden yüklendi/i));
    expect(getState().fingerprint).toBe('srv-2');
    expect(cache.saveCache).toHaveBeenCalledTimes(1);
    expect(status).toHaveTextContent('Bekleyen değişiklik yok');
  });

  it('yeniden okuma ağ hatasıyla başarısızsa durum satırı bunu söyler; sahte başarı yok', async () => {
    const api = fakeApi({ read: 'network' });
    configureController({ fetchImpl: api.fetchImpl });
    mount();
    await userEvent.click(clearButton());
    const status = await resultLine();
    await vi.waitFor(() => expect(status).toHaveTextContent(/çevrimdışı olduğundan yeniden yüklenemedi/i));
    expect(status).not.toHaveTextContent(/yeniden yüklendi/i);
    expect(status).toHaveTextContent('1 bekleyen değişiklik korundu');
    expect(getState().outbox).toHaveLength(1);
  });

  it('sunucu hata dönerse mesajı ile birlikte yüklenemediğini söyler', async () => {
    const api = fakeApi({ read: 'server-error' });
    configureController({ fetchImpl: api.fetchImpl });
    mount();
    await userEvent.click(clearButton());
    const status = await resultLine();
    await vi.waitFor(() => expect(status).toHaveTextContent(/yeniden yüklenemedi \(Sunucu meşgul\)/));
    expect(getState().status).toBe('error');
    expect(getState().outbox).toHaveLength(1);
  });

  it('Sheets bağlantısı ayarlı değilse bunu söyler; kuyruk yine korunur', async () => {
    const api = fakeApi();
    configureController({ fetchImpl: api.fetchImpl });
    setApiUrl('');
    mount();
    await userEvent.click(clearButton());
    const status = await resultLine();
    await vi.waitFor(() => expect(status).toHaveTextContent(/Sheets bağlantısı ayarlanmadığından yeniden yüklenemedi/));
    expect(api.reads).toHaveLength(0);
    expect(getState().outbox).toHaveLength(1);
  });

  it('okuma başarılıysa durum satırı yenilendiğini ve korunan bekleyen sayısını söyler', async () => {
    const api = fakeApi();
    configureController({ fetchImpl: api.fetchImpl });
    mount();
    await userEvent.click(clearButton());
    const status = await resultLine();
    await vi.waitFor(() => expect(status).toHaveTextContent(/yeniden yüklendi/i));
    expect(status).toHaveTextContent('1 bekleyen değişiklik korundu');
  });

  it('başarısız temizlemeden sonra bağlantı dönüp tam okuma gelince durum satırı güncellenir', async () => {
    const api = fakeApi({ read: 'network' });
    configureController({ fetchImpl: api.fetchImpl });
    mount();
    await userEvent.click(clearButton());
    const status = await resultLine();
    await vi.waitFor(() => expect(status).toHaveTextContent(/yeniden yüklenemedi/i));
    api.state.read = 'ok';
    await refresh(); // online/visibility olayının yaptığı yenileme
    await vi.waitFor(() => expect(status).toHaveTextContent(/yeniden yüklendi/i));
    expect(status).not.toHaveTextContent(/yüklenemedi/i);
    expect(status).toHaveTextContent('1 bekleyen değişiklik korundu');
  });

  it('düğmeye basmadan önce neyin korunacağı bölümde görünür', () => {
    configureController({ fetchImpl: fakeApi().fetchImpl });
    mount();
    const section = screen.getByRole('heading', { name: 'Önbellek' }).parentElement!;
    expect(within(section).getByText(/1 bekleyen değişiklik/)).toBeInTheDocument();
    expect(within(section).getByText(/çevrimdışı/i)).toBeInTheDocument();
  });

  it('bu sayfadaki kaydedilmemiş girdi temizleme sonrası durur (regresyon kalkanı)', async () => {
    const api = fakeApi();
    configureController({ fetchImpl: api.fetchImpl });
    mount([]);
    const urlInput = screen.getByLabelText('API adresi');
    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, 'https://script.google.com/macros/s/yeni/exec');
    await userEvent.click(clearButton());
    await vi.waitFor(() => expect(api.reads).toHaveLength(1));
    expect(screen.getByLabelText('API adresi')).toHaveValue('https://script.google.com/macros/s/yeni/exec');
    expect(localStorage.getItem('aile:apiUrl')).toBe(API);
  });
});
