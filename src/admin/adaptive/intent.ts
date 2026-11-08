import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useWideModule, type WideResource, type WideState } from './loader';

// Niyet / istek / iptal kalıbı (tembel katmanlar: kabuğun Sayfalar çekmecesi, menü gövdeleri …). WCAG 3.2.1: odak ya da
// işaretçi basma bağlam değiştirmez.
//  - preload(): niyet (pointerdown, focus). Modülü yalnız önyükler; düşmüş yüklemeyi yeniden kurmaz, hiçbir şey açmaz.
//  - request(): açık etkinleştirme (tıklama, Enter/Space, "Yeniden dene"). Hatayı sıfırlayıp yükler; phase 'requested'.
//    Çağıran "requested + ready" iken açar.
//  - Yükleme düşerse phase 'failed' (istek kapanır): sonradan başka yoldan gelen modül hiçbir şeyi kendiliğinden açmaz.
//  - Bekleme sırasında (requested + loading) Escape, çapa (açan denetim) dışında işaretçi basma ya da çapa dışına odak
//    isteği iptal eder: geç gelen modül o anda yapılanı kesmez. Hazır olduktan sonra açılan katman kendi kapanışını yönetir.
//  - cancel(): kapanış, rota değişimi.
// Düşmüş yüklemenin bağlantı ya da sonraki etkileşimle kurtarılması React'siz chunkError.ts'tedir (retryOnRecovery).

export type IntentPhase = 'idle' | 'requested' | 'failed';

export interface IntentLoad<M> {
  readonly state: WideState<M>;
  readonly phase: IntentPhase;
  preload(): void;
  request(): void;
  cancel(): void;
}

const ignore = () => {};
const failed = (status: string) => status === 'error' || status === 'stale-build';
const CANCEL_EVENTS = ['keydown', 'pointerdown', 'focusin'] as const;

export function useIntentLoad<M>(resource: WideResource<M>, anchor: RefObject<HTMLElement | null>): IntentLoad<M> {
  const state = useWideModule(resource, false);
  const [phase, setPhase] = useState<IntentPhase>('idle');
  // Düşen istek kapanır (çizim sırasında türetilir; ara kare yok).
  if (phase === 'requested' && failed(state.status)) setPhase('failed');
  const pending = phase === 'requested' && state.status === 'loading';

  useEffect(() => {
    if (!pending) return undefined;
    const elsewhere = (event: Event) => {
      // Modül hazırsa açılan katman (odak içine taşınırken) iptal sayılmaz.
      if (resource.getState().status !== 'loading') return;
      const outside = !(event.target instanceof Node && anchor.current?.contains(event.target));
      if (event.type === 'keydown' ? (event as KeyboardEvent).key === 'Escape' : outside) setPhase('idle');
    };
    for (const type of CANCEL_EVENTS) document.addEventListener(type, elsewhere, true);
    return () => { for (const type of CANCEL_EVENTS) document.removeEventListener(type, elsewhere, true); };
  }, [pending, resource, anchor]);

  const preload = useCallback(() => { resource.load().catch(ignore); }, [resource]);
  const request = useCallback(() => {
    setPhase('requested');
    resource.retry().catch(ignore);
  }, [resource]);
  const cancel = useCallback(() => setPhase('idle'), []);
  return { state, phase, preload, request, cancel };
}
