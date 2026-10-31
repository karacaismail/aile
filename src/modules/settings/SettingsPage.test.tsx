import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import type { BatchRequest, ReadRequest } from '@shared/api';
import type { Item } from '@shared/schema';
import type { QueuedOp } from '@/sync/queue';
import { configureController } from '@/sync/controller';
import { setApiUrl } from '@/sync/config';
import { applyRead, getState, resetStore, setState } from '@/sync/store';
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
const pendingB: QueuedOp = { op: { op: 'upsert', table: 'kalemler', id: 'B', opId: 'op-b', patch: { tip: 'satinalma', ad: 'Aralıkta eklenen' } }, ts: '2099-01-01T00:00:01Z', attempts: 0 };

type Req = ReadRequest | BatchRequest;
/** Sahte API: okuma başarılı (sunucu A satırı), batch gönderimi ağ hatası (yazım henüz ulaşamıyor). */
function fakeApi(opts: { readFails?: boolean } = {}) {
  const reads: Array<{ fingerprint?: string }> = [];
  const batches: BatchRequest[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as Req;
    if (req.action === 'read') {
      reads.push({ fingerprint: req.fingerprint });
      if (opts.readFails) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ ok: true, fingerprint: 'srv-2', serverTime: '2099-01-02T00:00:00Z', schemaVersion: 2, items: [serverA], settings: [], cash: [] }), { status: 200 });
    }
    batches.push(req as BatchRequest);
    throw new TypeError('Failed to fetch');
  });
  return { reads, batches, fetchImpl: fetchImpl as unknown as typeof fetch };
}

function mount(outbox: QueuedOp[] = [pendingA]) {
  applyRead({ ok: true, fingerprint: 'srv-1', serverTime: '2099-01-01T00:00:00Z', schemaVersion: 2, items: [serverA], settings: [], cash: [] });
  setState({ status: 'offline', outbox });
  render(<SettingsPage />);
}

const clearButton = () => screen.getByRole('button', { name: 'Önbelleği temizle' });

beforeEach(() => {
  localStorage.clear();
  resetStore();
  setApiUrl(API);
  vi.mocked(cache.clearCache).mockReset().mockResolvedValue(undefined);
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

  it('temizleme beklerken kuyruğa giren kayıt da korunur (async aralık)', async () => {
    const api = fakeApi();
    configureController({ fetchImpl: api.fetchImpl });
    let release!: () => void;
    vi.mocked(cache.clearCache).mockImplementation(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    mount();
    await userEvent.click(clearButton());
    await vi.waitFor(() => expect(cache.clearCache).toHaveBeenCalledTimes(1));
    // Silme sürerken başka bir ekrandan/arka plandan yeni işlem kuyruğa girer.
    setState((s) => ({ outbox: [...s.outbox, pendingB] }));
    release();
    await vi.waitFor(() => expect(api.reads).toHaveLength(1));
    await vi.waitFor(() => expect(getState().status).toBe('offline'));
    expect(getState().outbox.map((q) => q.op.opId)).toEqual(['op-a', 'op-b']);
    expect(getState().items.map((i) => i.id).sort()).toEqual(['A', 'B']);
  });

  it('yeniden okuma başarısızsa durum satırı bunu söyler; sahte başarı yok', async () => {
    const api = fakeApi({ readFails: true });
    configureController({ fetchImpl: api.fetchImpl });
    mount();
    await userEvent.click(clearButton());
    const status = await screen.findByRole('status', { name: 'Önbellek sonucu' });
    await vi.waitFor(() => expect(status).toHaveTextContent(/yeniden yüklenemedi/i));
    expect(status).not.toHaveTextContent(/yeniden yüklendi/i);
    expect(status).toHaveTextContent('1 bekleyen değişiklik korundu');
    expect(getState().outbox).toHaveLength(1);
  });

  it('okuma başarılıysa durum satırı yenilendiğini ve korunan bekleyen sayısını söyler', async () => {
    const api = fakeApi();
    configureController({ fetchImpl: api.fetchImpl });
    mount();
    await userEvent.click(clearButton());
    const status = await screen.findByRole('status', { name: 'Önbellek sonucu' });
    await vi.waitFor(() => expect(status).toHaveTextContent(/yeniden yüklendi/i));
    expect(status).toHaveTextContent('1 bekleyen değişiklik korundu');
  });

  it('düğmeye basmadan önce neyin korunacağı bölümde görünür', () => {
    configureController({ fetchImpl: fakeApi().fetchImpl });
    mount();
    const section = screen.getByRole('heading', { name: 'Önbellek' }).parentElement!;
    expect(within(section).getByText(/1 bekleyen değişiklik/)).toBeInTheDocument();
    expect(within(section).getByText(/çevrimdışı/i)).toBeInTheDocument();
  });

  it('bu sayfadaki kaydedilmemiş girdi temizleme sonrası durur', async () => {
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
