import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { designTokens } from '../../design/tokens.ts';
import { useDevice } from '../device';
import { AntInput, AntSelect } from './antd';
import { BottomSheet } from './BottomSheet';
import { Icon, type IconName } from './icons';
import './Select.css';

// Tasarım: components/Select/README.md + bundle.js › Select. Tek değer; native select görünümü yok (antd Select,
// combobox rolü). Tetik 44 px, sağda ok; açık listede seçili seçenek secili + 600 + onay. Devre dışı seçenek
// note ile nedenini söyler. "Bilinmiyor" bir seçenek olarak sunulur (includeUnknown). 8'den fazla seçenekte arama.
// Telefonda liste BottomSheet içinde açılır (antd popup kapalı tutulur, onOpenChange sayfayı açar).

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Seçeneğin yanında 14 px not; devre dışı seçenekte neden ("Önce teslim gerekir"). */
  note?: string;
}

export interface SelectProps {
  label: string;
  options: readonly SelectOption[];
  value?: string;
  onChange?(value: string): void;
  /** Varsayılan "Seçin". */
  placeholder?: string;
  help?: string;
  /** Alan hatası; "Hata: " önekini bileşen ekler. */
  error?: string;
  disabled?: boolean;
  icon?: IconName;
  /** Etiket görsel olarak gizli, erişilebilir ad korunur. */
  hideLabel?: boolean;
  /** Listenin sonuna "Bilinmiyor" ekler; boş bırakmanın yerine geçer. */
  includeUnknown?: boolean;
  /** Liste açık başlar (önizleme). */
  open?: boolean;
  id?: string;
  className?: string;
}

export const UNKNOWN_VALUE = 'bilinmiyor';
export const UNKNOWN_LABEL = 'Bilinmiyor';
/** Bu sayının üstünde arama açılır (tasarım README: "8'den fazla seçenekte"). */
export const SEARCH_THRESHOLD = 8;
const SEARCH_LABEL = 'Seçeneklerde ara';
const EMPTY_TEXT = 'Eşleşen seçenek yok';
const DEFAULT_PLACEHOLDER = 'Seçin';
const VISIBLE_ROWS = 6;

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');
const fold = (text: string) => text.toLocaleLowerCase('tr-TR');
const matches = (option: SelectOption, query: string) => fold(option.label).includes(fold(query.trim()));

/** antd seçeneği: erişilebilir ad etiket, not açıklama (aria-*, rc-select pickAttrs ile DOM'a geçer). */
interface AntOption extends SelectOption {
  'aria-label': string;
  'aria-describedby'?: string;
}

function OptionContent({ option }: { option: AntOption }) {
  return (
    <span className="aile-select-secenek">
      <span className="aile-select-secenek-etiket">{option.label}</span>
      {option.note && <span id={option['aria-describedby']} className="aile-select-secenek-not">{option.note}</span>}
    </span>
  );
}

export function Select({
  label, options, value, onChange, placeholder = DEFAULT_PLACEHOLDER, help, error, disabled, icon, hideLabel,
  includeUnknown, open = false, id: givenId, className,
}: SelectProps) {
  const autoId = useId();
  const id = givenId ?? `aile-select${autoId}`;
  const labelId = `${id}-etiket`;
  const noteId = `${id}-not`;
  const device = useDevice();
  const phone = device === 'phone';

  const [inner, setInner] = useState(value);
  const current = value !== undefined ? value : inner;
  const [sheetOpen, setSheetOpen] = useState(open);
  const [query, setQuery] = useState('');

  const allOptions = useMemo<readonly SelectOption[]>(() => {
    if (!includeUnknown || options.some(option => option.value === UNKNOWN_VALUE)) return options;
    return [...options, { value: UNKNOWN_VALUE, label: UNKNOWN_LABEL }];
  }, [options, includeUnknown]);
  const searchable = allOptions.length > SEARCH_THRESHOLD;
  const antOptions = useMemo<AntOption[]>(() => allOptions.map((option, index) => ({
    ...option,
    'aria-label': option.label,
    'aria-describedby': option.note ? `${id}-secenek-not-${index}` : undefined,
  })), [allOptions, id]);

  const pick = (option: SelectOption) => {
    if (option.disabled) return;
    setInner(option.value);
    onChange?.(option.value);
  };
  const closeSheet = () => { setSheetOpen(false); setQuery(''); };
  const describedBy = error || help ? noteId : undefined;

  return (
    <div className={cx('aile-select', className)}>
      <label id={labelId} htmlFor={id} className={cx('aile-select-etiket', hideLabel && 'aile-select-etiket--gizli')}>{label}</label>
      <AntSelect<string, AntOption>
        id={id}
        className="aile-select-kontrol"
        value={current ?? null}
        onChange={(_next, option) => { if (option && !Array.isArray(option)) pick(option); }}
        options={antOptions}
        optionRender={option => <OptionContent option={option.data} />}
        menuItemSelectedIcon={<Icon name="check" />}
        suffixIcon={<Icon name="chevronDown" />}
        prefix={icon ? <Icon name={icon} /> : undefined}
        placeholder={placeholder}
        disabled={disabled}
        status={error ? 'error' : undefined}
        showSearch={searchable && !phone ? { filterOption: (input, option) => (option ? matches(option, input) : false) } : false}
        notFoundContent={<span className="aile-select-bos">{EMPTY_TEXT}</span>}
        virtual={false}
        listHeight={designTokens.hedefAsgari * VISIBLE_ROWS}
        defaultOpen={!phone && open}
        open={phone ? false : undefined}
        onOpenChange={phone ? next => { if (next && !disabled) setSheetOpen(true); } : undefined}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <p id={noteId} className="aile-select-hata"><Icon name="alert" /><span>Hata: {error}</span></p>
      ) : help ? (
        <p id={noteId} className="aile-select-yardim">{help}</p>
      ) : null}
      {phone && (
        <BottomSheet title={label} open={sheetOpen} onClose={closeSheet}>
          <SheetList
            id={id}
            labelId={labelId}
            options={allOptions}
            current={current}
            searchable={searchable}
            query={query}
            onQuery={setQuery}
            onPick={option => { pick(option); closeSheet(); }}
          />
        </BottomSheet>
      )}
    </div>
  );
}

interface SheetListProps {
  id: string;
  labelId: string;
  options: readonly SelectOption[];
  current: string | undefined;
  searchable: boolean;
  query: string;
  onQuery(query: string): void;
  onPick(option: SelectOption): void;
}

// Telefon listesi: APG listbox, dolaşan tabindex (oklar, Home/End), Enter/Space seçer; Escape'i BottomSheet kapatır.
function SheetList({ id, labelId, options, current, searchable, query, onQuery, onPick }: SheetListProps) {
  const visible = useMemo(() => (query ? options.filter(option => matches(option, query)) : options), [options, query]);
  const selectedIndex = visible.findIndex(option => option.value === current);
  const [active, setActive] = useState(selectedIndex >= 0 ? selectedIndex : 0);
  const items = useRef<(HTMLLIElement | null)[]>([]);

  const focusAt = (index: number) => {
    const next = Math.max(0, Math.min(visible.length - 1, index));
    setActive(next);
    items.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = items.current.findIndex(item => item === document.activeElement);
    const from = index >= 0 ? index : active;
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusAt(from + 1); break;
      case 'ArrowUp': event.preventDefault(); focusAt(from - 1); break;
      case 'Home': event.preventDefault(); focusAt(0); break;
      case 'End': event.preventDefault(); focusAt(visible.length - 1); break;
      case 'Enter':
      case ' ': {
        const option = visible[from];
        if (option) { event.preventDefault(); onPick(option); }
        break;
      }
      default: break;
    }
  };

  return (
    <div className="aile-select-sayfa">
      {searchable && (
        <AntInput
          type="search"
          aria-label={SEARCH_LABEL}
          placeholder="Ara"
          prefix={<Icon name="search" />}
          value={query}
          onChange={event => { onQuery(event.target.value); setActive(0); }}
          allowClear
        />
      )}
      <ul role="listbox" aria-labelledby={labelId} className="aile-select-liste" onKeyDown={onKeyDown}>
        {visible.map((option, index) => {
          const selected = option.value === current;
          const optionId = `${id}-secenek-${index}`;
          return (
            <li
              key={option.value}
              ref={element => { items.current[index] = element; }}
              role="option"
              id={optionId}
              aria-selected={selected}
              aria-disabled={option.disabled || undefined}
              aria-labelledby={`${optionId}-etiket`}
              aria-describedby={option.note ? `${optionId}-not` : undefined}
              tabIndex={index === (active < visible.length ? active : 0) ? 0 : -1}
              data-focus-line
              className={cx('aile-select-liste-secenek', selected && 'is-secili', option.disabled && 'is-devre-disi')}
              onClick={() => { if (!option.disabled) onPick(option); }}
              onFocus={() => setActive(index)}
            >
              <span id={`${optionId}-etiket`} className="aile-select-secenek-etiket">{option.label}</span>
              {option.note && <span id={`${optionId}-not`} className="aile-select-secenek-not">{option.note}</span>}
              {selected && <Icon name="check" />}
            </li>
          );
        })}
        {visible.length === 0 && <li role="presentation" className="aile-select-bos">{EMPTY_TEXT}</li>}
      </ul>
    </div>
  );
}
