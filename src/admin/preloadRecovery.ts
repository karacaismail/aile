import { isChunkLoadError } from './adaptive';
import { reloadPage } from './adaptive/reload';

// Sürüm kayması kurtarması (docs/ADMIN-DEPLOY-PROPOSAL.md §5). Pages yayını eski karma adlı parçaları siler; açık bir
// sekme sonradan yüklemek istediği sayfa ya da CSS parçasını bulamaz. Vite'ın ön yükleme yardımcısı bu durumda
// iptal edilebilir `vite:preloadError` olayı yayar; dinleyici preventDefault demezse hatayı yeniden fırlatır ve hata
// rota hata sınırına ("Yeni sürüm var · Yenile") düşer.
// Kural: parça hatasında, çevrim içiyken sayfa bir kez yenilenir (yeni admin.html → yeni parça adları). Döngüye karşı
// sessionStorage'a zaman damgası yazılır; koruma süresi içinde ikinci hata yüzeye bırakılır. Depolama okunamaz ya da
// yazılamazsa yenilenmez (koruma olmadan yenileme sonsuz döngü olabilir). preventDefault yalnız yenilerken çağrılır.

export const PRELOAD_RELOAD_KEY = 'aile:admin:preload-reload-at';
/** Son yenilemeden sonra bu süre içinde gelen parça hatası yenileme yapmaz (yeni sürüm de parçayı bulamıyor demektir). */
export const PRELOAD_RELOAD_GUARD_MS = 60_000;

export interface PreloadRecoveryOptions {
  /** Olayın dinlendiği hedef. Varsayılan window. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** Varsayılan reloadPage (window.location.reload). */
  reload?: () => void;
  now?: () => number;
  /** Erişimi hata atabilen depolama (Safari gizli kip, engellenmiş site verisi): her olayda yeniden istenir. */
  storage?: () => Storage | null;
  online?: () => boolean;
}

type PreloadErrorEvent = Event & { payload?: unknown };

/** Zaman damgası koruması geçerse damgayı yazar ve true döner; depolama yoksa ya da hata atarsa false. */
function claimReload(storage: () => Storage | null, at: number): boolean {
  try {
    const store = storage();
    if (!store) return false;
    const last = Number(store.getItem(PRELOAD_RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && at >= last && at - last < PRELOAD_RELOAD_GUARD_MS) return false;
    store.setItem(PRELOAD_RELOAD_KEY, String(at));
    return store.getItem(PRELOAD_RELOAD_KEY) === String(at);
  } catch {
    return false;
  }
}

/** main.tsx React kökünü kurmadan önce çağırır. Dönen fonksiyon dinleyiciyi söker (testler). */
export function installPreloadRecovery(options: PreloadRecoveryOptions = {}): () => void {
  const target = options.target ?? window;
  const reload = options.reload ?? reloadPage;
  const now = options.now ?? Date.now;
  const storage = options.storage ?? (() => window.sessionStorage);
  const online = options.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  let reloading = false;
  const onPreloadError = (event: Event) => {
    // Yenileme başladıysa aynı sayfadaki diğer parça hataları da hata sınırına düşmesin.
    if (reloading) { event.preventDefault(); return; }
    if (!isChunkLoadError((event as PreloadErrorEvent).payload) || !online()) return;
    if (!claimReload(storage, now())) return;
    reloading = true;
    event.preventDefault();
    reload();
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => target.removeEventListener('vite:preloadError', onPreloadError);
}
