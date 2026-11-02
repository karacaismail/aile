import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { InputLayers, Profile } from '../shell/contracts';
import { BASELINE_SNAPSHOT, readAdaptive, sameSnapshot, watchAdaptive, type AdaptiveSnapshot } from './profile';

// React yüzü. ProfileContext eski DeviceContext ile aynı nesnedir (device.ts onu yeniden adlandırır): testlerde
// <DeviceContext.Provider value="phone"> hem useDevice hem useProfile'ı zorlar.
export const ProfileContext = createContext<Profile | null>(null);
ProfileContext.displayName = 'ProfileContext';
export const InputLayersContext = createContext<InputLayers | null>(null);
InputLayersContext.displayName = 'InputLayersContext';

/**
 * Profil + katman anlık görüntüsü. İlk değer useState başlatıcısında eşzamanlı okunur (ilk render doğru profille,
 * zıplama yok); sonra watchAdaptive ile izlenir. enabled=false iken hiç abone olmaz (üstte sağlayıcı varken).
 */
export function useAdaptiveWatcher(enabled = true): AdaptiveSnapshot {
  const [snapshot, setSnapshot] = useState<AdaptiveSnapshot>(() => (enabled ? readAdaptive() : BASELINE_SNAPSHOT));
  useEffect(() => {
    if (!enabled) return;
    // Render ile effect arasında kaçan değişikliği yakala; aynıysa durum nesnesi korunur.
    let current = readAdaptive();
    setSnapshot(previous => (sameSnapshot(previous, current) ? previous : current));
    return watchAdaptive(next => {
      if (sameSnapshot(current, next)) return;
      current = next;
      setSnapshot(next);
    });
  }, [enabled]);
  return snapshot;
}

/** Tek abonelik; altındaki useProfile/useInputLayers/useDevice çağrıları ek dinleyici açmaz. */
export function AdaptiveProvider({ children }: { children: ReactNode }) {
  const snapshot = useAdaptiveWatcher();
  return (
    <ProfileContext.Provider value={snapshot.profile}>
      <InputLayersContext.Provider value={snapshot.input}>{children}</InputLayersContext.Provider>
    </ProfileContext.Provider>
  );
}

/** Üst düzey yerleşim profili: 'phone' | 'tablet' | 'desktop'. Sağlayıcı yoksa kendisi izler. */
export function useProfile(): Profile {
  const fromContext = useContext(ProfileContext);
  const own = useAdaptiveWatcher(fromContext === null);
  return fromContext ?? own.profile;
}

/** Eklemeli giriş katmanları { coarse, fine, hover }; değişmedikçe aynı nesne. Sağlayıcı yoksa kendisi izler. */
export function useInputLayers(): InputLayers {
  const fromContext = useContext(InputLayersContext);
  const own = useAdaptiveWatcher(fromContext === null);
  return fromContext ?? own.input;
}
