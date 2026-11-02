import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { importsOf } from './adaptive/sourceRules';

vi.mock('./adaptive/reload', () => ({ reloadPage: vi.fn() }));

import { reloadPage } from './adaptive/reload';
import { PRELOAD_RELOAD_GUARD_MS, PRELOAD_RELOAD_KEY, installPreloadRecovery } from './preloadRecovery';

// Sürüm kayması kurtarması: Vite'ın ön yükleme yardımcısı (__vitePreload) dinamik import ya da CSS ön yüklemesi
// başarısız olunca iptal edilebilir `vite:preloadError` olayı yayar; dinleyici preventDefault demezse hatayı yeniden
// fırlatır ve hata rota hata sınırına düşer. Kurtarma, parça hatasında sayfayı bir kez yeniler; döngüye karşı
// sessionStorage zaman damgası tutar; depolama yoksa yenilemez ve hatayı yüzeye bırakır.

const CHUNK_ERROR = () => new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/aile/assets/AlimlarPage-OLD.js');

function preloadError(payload: unknown = CHUNK_ERROR(), target: EventTarget = window) {
  const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload });
  target.dispatchEvent(event);
  return event;
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  vi.mocked(reloadPage).mockClear();
  window.sessionStorage.clear();
});

describe('installPreloadRecovery', () => {
  let storage: Storage;
  let reload: Mock<() => void>;
  let now: number;
  const install = (overrides: Parameters<typeof installPreloadRecovery>[0] = {}) => {
    uninstall = installPreloadRecovery({ storage: () => storage, reload, now: () => now, online: () => true, ...overrides });
  };
  beforeEach(() => {
    storage = memoryStorage();
    reload = vi.fn<() => void>();
    now = 1_000_000;
  });

  it('parça hatasında sayfayı bir kez yeniler, yalnız o zaman preventDefault der ve zaman damgasını yazar', () => {
    install();
    const event = preloadError();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(storage.getItem(PRELOAD_RELOAD_KEY)).toBe(String(now));
  });

  it('CSS ön yükleme hatası ve WebKit iletisi de parça hatasıdır', () => {
    install();
    expect(preloadError(new Error('Unable to preload CSS for /aile/assets/AlimlarPage-OLD.css')).defaultPrevented).toBe(true);
    uninstall!();
    storage = memoryStorage();
    const reloadAgain = vi.fn<() => void>();
    install({ reload: reloadAgain });
    expect(preloadError(new TypeError('Importing a module script failed.')).defaultPrevented).toBe(true);
    expect(reloadAgain).toHaveBeenCalledTimes(1);
  });

  it('yenileme sürerken aynı sayfadaki sonraki parça hataları da sessiz kalır (tek yenileme)', () => {
    install();
    preloadError();
    const second = preloadError(new Error('Unable to preload CSS for /aile/assets/x.css'));
    expect(second.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('koruma süresi içinde (yenilemeden sonra yeni sayfa) ikinci kez yenilemez; hata yüzeye çıkar', () => {
    storage.setItem(PRELOAD_RELOAD_KEY, String(now - 5_000));
    install();
    const event = preloadError();
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(storage.getItem(PRELOAD_RELOAD_KEY)).toBe(String(now - 5_000));
  });

  it('koruma süresi geçince yeniden bir kez yeniler', () => {
    storage.setItem(PRELOAD_RELOAD_KEY, String(now - PRELOAD_RELOAD_GUARD_MS));
    install();
    expect(preloadError().defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(PRELOAD_RELOAD_KEY)).toBe(String(now));
  });

  it('bozuk ya da gelecekteki zaman damgası yenilemeyi engellemez', () => {
    storage.setItem(PRELOAD_RELOAD_KEY, 'bozuk');
    install();
    expect(preloadError().defaultPrevented).toBe(true);
    uninstall!();
    storage.setItem(PRELOAD_RELOAD_KEY, String(now + 3_600_000));
    const reloadAgain = vi.fn<() => void>();
    install({ reload: reloadAgain });
    expect(preloadError().defaultPrevented).toBe(true);
    expect(reloadAgain).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['depolama erişimi hata atar', () => { throw new DOMException('denied', 'SecurityError'); }],
    ['depolama yok', () => null],
  ])('%s → yenilemez, preventDefault demez (hata yüzeye çıkar)', (_label, storageAccess) => {
    install({ storage: storageAccess as () => Storage | null });
    const event = preloadError();
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('zaman damgası yazılamazsa (kota) yenilemez: döngü koruması olmadan yenileme yok', () => {
    storage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    install();
    const event = preloadError();
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('parça hatası olmayan yük (modülün kendi çalışma hatası) yenileme yapmaz', () => {
    install();
    for (const payload of [new Error('boom'), new TypeError('x is not a function'), 'metin', null]) {
      const event = preloadError(payload);
      expect(event.defaultPrevented, String(payload)).toBe(false);
    }
    const withoutPayload = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(withoutPayload);
    expect(withoutPayload.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem(PRELOAD_RELOAD_KEY)).toBeNull();
  });

  it('çevrim dışıyken yenilemez (admin.html ön bellekte değil; yenileme tarayıcı hata sayfası açardı)', () => {
    install({ online: () => false });
    expect(preloadError().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('kaldırma fonksiyonu dinleyiciyi söker', () => {
    install();
    uninstall!();
    uninstall = undefined;
    expect(preloadError().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('varsayılanlar: window, sessionStorage, reloadPage ve navigator.onLine', () => {
    uninstall = installPreloadRecovery();
    const event = preloadError();
    expect(event.defaultPrevented).toBe(true);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(Number(window.sessionStorage.getItem(PRELOAD_RELOAD_KEY))).toBeGreaterThan(0);
  });
});

describe('main.tsx bağlantısı', () => {
  it('main.tsx kurtarmayı içe aktarır ve React kökünü kurmadan önce kurar', () => {
    const main = readFileSync(resolve(__dirname, 'main.tsx'), 'utf8');
    expect(importsOf(main).map((ref) => ref.specifier)).toContain('./preloadRecovery');
    const install = main.indexOf('installPreloadRecovery();');
    expect(install, 'installPreloadRecovery() çağrısı').toBeGreaterThan(-1);
    expect(install).toBeLessThan(main.indexOf('createRoot('));
  });
});
