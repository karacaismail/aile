// Çalışma zamanı yapılandırması: API adresi (env ya da Ayarlar'dan), cihaz adı, opsiyonel anahtar.
const KEY_URL = 'aile:apiUrl';
const KEY_ACTOR = 'aile:actor';
const KEY_APPKEY = 'aile:appKey';

function ls(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function getApiUrl(): string {
  const stored = ls()?.getItem(KEY_URL)?.trim();
  if (stored) return stored;
  const env = (import.meta.env?.VITE_API_URL as string | undefined)?.trim();
  return env ?? '';
}
export function setApiUrl(url: string): void { try { ls()?.setItem(KEY_URL, url.trim()); } catch { /* yok say */ } }

export function getActor(): string {
  let a = ls()?.getItem(KEY_ACTOR)?.trim();
  if (!a) {
    a = `cihaz-${Math.random().toString(36).slice(2, 6)}`;
    try { ls()?.setItem(KEY_ACTOR, a); } catch { /* yok say */ }
  }
  return a;
}
export function setActor(name: string): void { try { ls()?.setItem(KEY_ACTOR, name.trim().slice(0, 60)); } catch { /* yok say */ } }

export function getAppKey(): string | undefined {
  const k = ls()?.getItem(KEY_APPKEY)?.trim();
  return k || undefined;
}
export function setAppKey(key: string): void { try { if (key.trim()) ls()?.setItem(KEY_APPKEY, key.trim()); else ls()?.removeItem(KEY_APPKEY); } catch { /* yok say */ } }

export function isApiConfigured(): boolean { return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(getApiUrl()); }
