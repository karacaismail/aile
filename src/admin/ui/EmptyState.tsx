import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ActiveFilter } from '../shell/contracts';
import { Icon } from './icons';
import './EmptyState.css';

// Tasarım: components/Empty/README.md + bundle.js Empty. Sonuç yokken neden yok olduğunu söyler: etkin filtre varsa
// filtreler kaldırılabilir etiket olarak yazılır ve "Filtreleri temizle" sunulur; filtre yoksa "Henüz kayıt yok" +
// isteğe bağlı neden ve eylem. Büyük çizim ya da renkli şerit yok. Yerel HTML, antd yok: tek uygulama tüm profillere
// hizmet eder. Düğmeler yerel <button>: 44 px, coarse girişte 48 px. Kaldır düğmeleri "Filtreyi kaldır: …" diye okunur
// (sorgu şeridindeki Tag'in "… filtresini kaldır" adından ayrı: aynı sayfada iki liste birden durur).
// Odak dönüşü: buradan bir filtre kaldırılınca düğme kaybolur; odak sıradaki (yoksa önceki) kaldır düğmesine, o da yoksa
// "Filtreleri temizle"ye, o da yoksa neden boş olduğunu söyleyen başlığa geçer. Başka yerden yapılan kaldırma odağı oynatmaz.
/** Etkin filtre: QueryBarProps.activeFilters ile aynı nesne (kaldır düğmesi onRemove'u çağırır) ya da yalnız etiket metni. */
export type EmptyStateFilter = string | ActiveFilter;

export interface EmptyStateProps {
  /** Etkin filtreler; boş dizi filtre yok demektir. */
  filters?: readonly EmptyStateFilter[];
  /** "Filtreleri temizle" düğmesi; yalnız filtre varken ve işleyici verilince çizilir. */
  onClear?: () => void;
  /** Başlık; verilmezse filtre varken "Bu filtrelerle kayıt yok", yoksa "Henüz kayıt yok". */
  title?: string;
  /** Neden boş olduğu, bir cümle. Yalnız filtresiz boşlukta gösterilir. */
  message?: string;
  /** Filtresiz boşlukta eylem (ör. <Button>Alım ekle</Button>). Filtre varken "Filtreleri temizle" onun yerini alır. */
  action?: ReactNode;
}

const FILTRELI_BASLIK = 'Bu filtrelerle kayıt yok';
const FILTRESIZ_BASLIK = 'Henüz kayıt yok';
const FILTRE_LISTESI = 'Etkin filtreler:';
const TEMIZLE = 'Filtreleri temizle';

/** Metin filtresi kaldır düğmesi almaz; ActiveFilter onRemove'u taşır. */
interface FilterChip { id: string; label: string; onRemove?: () => void }
const normalize = (filter: EmptyStateFilter): FilterChip => (typeof filter === 'string' ? { id: filter, label: filter } : filter);

/** Bekleyen odak dönüşü: kaldırılan düğmenin sırası (temizlemede -1) ve o anki filtre kimlikleri. */
interface PendingFocus { index: number; ids: string }

export function EmptyState({ filters = [], onClear, title, message, action }: EmptyStateProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const pending = useRef<PendingFocus | null>(null);
  const active = filters.map(normalize);
  const ids = active.map(filter => filter.id).join('\u0000');
  const filtered = active.length > 0;
  const heading = title ?? (filtered ? FILTRELI_BASLIK : FILTRESIZ_BASLIK);

  useLayoutEffect(() => {
    const want = pending.current;
    const root = rootRef.current;
    if (!want || !root || want.ids === ids) return;
    pending.current = null;
    const focused = document.activeElement;
    // Odak hâlâ gerçek bir öğedeyse (kullanıcı başka yere geçti) dokunulmaz; yalnız kaybolan düğmenin odağı devralınır.
    if (focused && focused !== document.body && focused.isConnected) return;
    const removes = want.index >= 0 ? [...root.querySelectorAll<HTMLElement>('.aile-empty-state__remove')] : [];
    const target =
      removes[Math.min(want.index, removes.length - 1)] ??
      root.querySelector<HTMLElement>('.aile-empty-state__clear') ??
      root.querySelector<HTMLElement>('.aile-empty-state__title');
    target?.focus();
  });

  let removableIndex = 0;
  return (
    <div ref={rootRef} role="status" className="aile-empty-state">
      <h2 className="aile-empty-state__title" tabIndex={-1} data-focus-line="">{heading}</h2>
      {filtered ? (
        <>
          <p id={listId} className="aile-ikincil aile-empty-state__lead">{FILTRE_LISTESI}</p>
          <ul className="aile-empty-state__filters" aria-labelledby={listId}>
            {active.map(filter => {
              const index = filter.onRemove ? removableIndex++ : -1;
              const remove = filter.onRemove;
              return (
                <li key={filter.id} className="aile-empty-state__filter">
                  <span className="aile-empty-state__filter-label">{filter.label}</span>
                  {remove ? (
                    <button
                      type="button"
                      className="aile-empty-state__remove"
                      data-focus-line=""
                      aria-label={`Filtreyi kaldır: ${filter.label}`}
                      onClick={() => {
                        pending.current = { index, ids };
                        remove();
                      }}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {onClear ? (
            <button
              type="button"
              className="aile-empty-state__clear"
              data-focus-line=""
              onClick={() => {
                pending.current = { index: -1, ids };
                onClear();
              }}
            >
              {TEMIZLE}
            </button>
          ) : null}
        </>
      ) : (
        <>
          {message ? <p className="aile-ikincil aile-empty-state__message">{message}</p> : null}
          {action ? <div className="aile-empty-state__action">{action}</div> : null}
        </>
      )}
    </div>
  );
}
