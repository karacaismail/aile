import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';
import './update-notice.css';

let started = false;
let ready = false;
let registration: ServiceWorkerRegistration | undefined;
const listeners = new Set<() => void>();
const checkForUpdate = () => {
  if (document.visibilityState !== 'hidden' && navigator.onLine) void registration?.update().catch(() => {});
};
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener('focus', checkForUpdate);
    document.addEventListener('visibilitychange', checkForUpdate);
  }
  if (!started) {
    started = true;
    registerSW({
      immediate: true,
      onRegisteredSW: (_url, value) => { registration = value; },
      onNeedReload: () => { ready = true; listeners.forEach(notify => notify()); },
    });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener('focus', checkForUpdate);
      document.removeEventListener('visibilitychange', checkForUpdate);
    }
  };
}

export function UpdateNotice() {
  const available = useSyncExternalStore(subscribe, () => ready, () => false);
  if (!available) return null;
  return <div className="app-update">
    <p role="status"><strong>Yeni sürüm hazır.</strong> Kaydedilmemiş değişiklikleriniz varsa önce kaydedin.</p>
    <button type="button" className="family-nav-trigger" onClick={() => location.reload()}>Yeni sürümü aç</button>
  </div>;
}
