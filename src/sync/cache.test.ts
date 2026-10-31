import { describe, it, expect, vi, beforeEach } from 'vitest';
import { del, get, set } from 'idb-keyval';
import { clearCache, loadCache, loadOutbox, saveOutbox } from './cache';

// IndexedDB jsdom'da yok; idb-keyval sahte. Sözleşme: clearCache silmenin gerçekten olup olmadığını söyler, hata yutmaz.
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));

beforeEach(() => { vi.mocked(del).mockReset(); vi.mocked(get).mockReset(); vi.mocked(set).mockReset(); });

describe('clearCache', () => {
  it('silme başarılıysa true döner ve yalnız veri anahtarını siler', async () => {
    vi.mocked(del).mockResolvedValue(undefined);
    await expect(clearCache()).resolves.toBe(true);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('aile:data:v1');
  });

  it('IndexedDB silmeyi reddederse false döner; fırlatmaz', async () => {
    vi.mocked(del).mockRejectedValue(new DOMException('QuotaExceededError', 'QuotaExceededError'));
    await expect(clearCache()).resolves.toBe(false);
  });

  it('kuyruk anahtarına dokunmaz; kuyruk okuma/yazma bağımsız kalır', async () => {
    vi.mocked(del).mockResolvedValue(undefined);
    vi.mocked(get).mockResolvedValue([{ op: { op: 'delete', table: 'kalemler', id: 'A', opId: 'x' }, ts: 't', attempts: 0 }]);
    vi.mocked(set).mockResolvedValue(undefined);
    await clearCache();
    expect(del).not.toHaveBeenCalledWith('aile:outbox:v1');
    await expect(loadOutbox()).resolves.toHaveLength(1);
    await saveOutbox([]);
    expect(set).toHaveBeenCalledWith('aile:outbox:v1', []);
  });

  it('okuma hatası eskisi gibi sessizce undefined/boş döner (mevcut sözleşme korunur)', async () => {
    vi.mocked(get).mockRejectedValue(new Error('kapalı'));
    await expect(loadCache()).resolves.toBeUndefined();
    await expect(loadOutbox()).resolves.toEqual([]);
  });
});
