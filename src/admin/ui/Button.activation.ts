import { useId, useRef, useState, type MouseEvent } from 'react';

// Button ve IconButton'ın ortak etkinleştirme davranışı (yerel <button>, antd yok).
//  - Meşgul: `loading` ya da onClick'in döndürdüğü söz (Promise) bekliyorsa. Meşgul düğme aria-busy + aria-disabled taşır,
//    odaklanabilir kalır (yerel disabled odağı body'ye düşürürdü), etiketi ve erişilebilir adı değişmez; tıklama,
//    Enter/Space ve form gönderimi yok sayılır (çift tıklama engeli). Aynı görevdeki ikinci tıklamayı React yeniden
//    çizmeden önce de kilit (ref) durdurur.
//  - Söz reddedilirse meşguliyet biter ve hata yutulmaz: olay işleyicisinde yakalanmamış hata gibi bildirilir
//    (reportError → window 'error' + konsol; reportError olmayan ortamda aynısı ErrorEvent ile).
//  - Devre dışı nedeni: `disabledReason` yalnız düğme devre dışıyken görünür metin olarak yazılır ve aria-describedby
//    ile bağlanır; çağıranın aria-describedby kimliği önde korunur.

export type ActivationHandler = (event: MouseEvent<HTMLButtonElement>) => unknown;

interface ActivationOptions {
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  describedBy?: string;
  onClick?: ActivationHandler;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';

/**
 * Olay işleyicisinde yakalanmamış hata gibi bildirir: reportError (window 'error' olayı + konsol). reportError olmayan
 * ortamda aynı sözleşme elle uygulanır: iptal edilebilir ErrorEvent, iptal edilmezse konsola yazılır.
 */
function report(error: unknown) {
  if (typeof globalThis.reportError === 'function') {
    globalThis.reportError(error);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (window.dispatchEvent(new ErrorEvent('error', { error, message, cancelable: true }))) console.error(error);
}

export function useButtonActivation({ loading, disabled, disabledReason, describedBy, onClick }: ActivationOptions) {
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const reasonId = useId();
  const busy = Boolean(loading) || pending;
  const showReason = Boolean(disabled && disabledReason);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy || locked.current) {
      // aria-disabled düğme yerel olarak etkin kalır: submit düğmesinin formu göndermesini de burada durdururuz.
      event.preventDefault();
      return;
    }
    const result = onClick?.(event);
    if (!isThenable(result)) return;
    locked.current = true;
    setPending(true);
    const settle = () => {
      locked.current = false;
      setPending(false);
    };
    result.then(settle, error => {
      settle();
      report(error);
    });
  };

  const describedByIds = [describedBy, showReason ? reasonId : undefined].filter(Boolean).join(' ') || undefined;

  return {
    busy,
    handleClick,
    /** Düğmeye yazılacak durum öznitelikleri; boşta hiçbiri yazılmaz. */
    stateProps: {
      'aria-busy': busy || undefined,
      'aria-disabled': busy || undefined,
      'aria-describedby': describedByIds,
    },
    /** Devre dışı nedeni (görünür metin) ya da null. */
    reason: showReason ? { id: reasonId, text: disabledReason! } : null,
  };
}
