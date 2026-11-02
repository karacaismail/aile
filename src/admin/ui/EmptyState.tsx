import { useId, type ReactNode } from 'react';
import type { ActiveFilter } from '../shell/contracts';
import { AntButton } from './antd';
import { Icon } from './icons';
import './EmptyState.css';

// Tasarım: components/Empty/README.md + bundle.js Empty. Sonuç yokken neden yok olduğunu söyler: etkin filtre varsa
// filtreler kaldırılabilir etiket olarak yazılır ve "Filtreleri temizle" sunulur; filtre yoksa "Henüz kayıt yok" +
// isteğe bağlı neden ve eylem. Büyük çizim ya da renkli şerit yok; antd Empty görseli kullanılmaz. Ham antd yalnız
// ui/ içinde; Button/Tag sarmalayıcıları yerine AntButton + yerel etiket: bileşen tek başına çalışır.
/** Etkin filtre: QueryBarProps.activeFilters ile aynı nesne (kaldır düğmesi onRemove'u çağırır) ya da yalnız etiket metni. */
export type EmptyStateFilter = string | ActiveFilter;

export interface EmptyStateProps {
  /** Etkin filtreler; boş dizi filtre yok demektir. */
  filters?: readonly EmptyStateFilter[];
  /** "Filtreleri temizle" düğmesi; yalnız filtre varken çizilir. */
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

export function EmptyState({ filters = [], onClear, title, message, action }: EmptyStateProps) {
  const listId = useId();
  const active = filters.map(normalize);
  const filtered = active.length > 0;
  const heading = title ?? (filtered ? FILTRELI_BASLIK : FILTRESIZ_BASLIK);

  return (
    <div role="status" className="aile-empty-state">
      <h2 className="aile-empty-state__title">{heading}</h2>
      {filtered ? (
        <>
          <p id={listId} className="aile-ikincil aile-empty-state__lead">{FILTRE_LISTESI}</p>
          <ul className="aile-empty-state__filters" aria-labelledby={listId}>
            {active.map(filter => (
              <li key={filter.id} className="aile-empty-state__filter">
                <span className="aile-empty-state__filter-label">{filter.label}</span>
                {filter.onRemove ? (
                  <button
                    type="button"
                    className="aile-empty-state__remove"
                    data-focus-line=""
                    aria-label={`Filtreyi kaldır: ${filter.label}`}
                    onClick={filter.onRemove}
                  >
                    <Icon name="close" size={16} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <AntButton color="primary" variant="outlined" onClick={onClear}>{TEMIZLE}</AntButton>
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
