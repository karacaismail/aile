// Parça (dinamik import) yükleme hatası: sınıflama, yeniden deneme beklemesi ve kurtarma için tek kaynak. React'siz ve
// yan etkisiz; yükleyici (loader.ts), rota sınırı (routes.tsx), veri katmanı (data/store.ts sözleşme parçası) ve çekirdek
// dışı simgeler (ui/icons.tsx) aynı kararı verir. ui/icons yalnız bu küçük modülü alır: yükleyiciyi ya da adaptive
// barrel'ını içe aktarması derleyicinin (rolldown) adaptive modüllerini ve ui/icons'u ayrı parçalara bölmesine yol açıp
// telefon ilk rota JS'ini ~200–500 B gzip büyütüyordu (p-fix ölçümü, 2 Kasım 2026).
// Tarayıcı iletileri: Chromium, WebKit, Gecko; Vite CSS ön yüklemesi; eksik parça yerine HTML dönen sunucu; webpack tarzı
// ChunkLoadError. Hepsi "parça artık yok ya da alınamadı" demektir. Saran hata (ör. ContractLoadError) nedeniyle
// (cause, en çok 3 düzey) sınıflanır.
/** Tembel parça ilk kez düşünce tek otomatik yeniden denemeden önceki bekleme (ms): geniş adalar, rotalar, simgeler. */
export const CHUNK_RETRY_DELAY_MS = 800;

const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script|Loading (?:CSS )?chunk [\w-]+ failed/i;

export function isChunkLoadError(error: unknown): boolean {
  for (let depth = 0; depth < 4 && error && typeof error === 'object'; depth += 1) {
    const { name, message, cause } = error as { name?: unknown; message?: unknown; cause?: unknown };
    if (name === 'ChunkLoadError' || (typeof message === 'string' && CHUNK_ERROR.test(message))) return true;
    error = cause === error ? null : cause;
  }
  return false;
}

/** Yeniden deneme de başarısızsa: çevrim içiyken parça hatası sürüm kayması sayılır; çevrim dışı ya da başka hata → error. */
export function chunkFailureStatus(error: unknown): 'error' | 'stale-build' {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return !offline && isChunkLoadError(error) ? 'stale-build' : 'error';
}

const RECOVERY_EVENTS = ['online', 'pointerdown', 'keydown'] as const;
const armed = new WeakSet<object>();
const ignore = () => {};

/**
 * Düşmüş tembel yüklemeyi bağlantı gelince ('online') ya da kullanıcının bir sonraki etkileşiminde (pointerdown,
 * keydown) bir kez yeniden dener; döngü yok, hedef başına tek kurulum. Hedef retry() verir (lazyResource ya da eşdeğeri).
 */
export function retryOnRecovery(target: { retry(): Promise<unknown> }): void {
  if (armed.has(target) || typeof window === 'undefined') return;
  armed.add(target);
  const fire = () => {
    for (const type of RECOVERY_EVENTS) window.removeEventListener(type, fire, true);
    armed.delete(target);
    target.retry().catch(ignore);
  };
  for (const type of RECOVERY_EVENTS) window.addEventListener(type, fire, true);
}
