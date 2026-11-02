import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { designTokens } from '../../design/tokens.ts';
import { Icon, type IconName } from './icons';
import { formatMoney, parseMoneyInput } from './Money';
import './TextField.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/TextField/README.md + bundle.js › TextField/FieldNote.
// Yerel <input>/<textarea>; antd yok, tek uygulama bütün profillere hizmet eder (geniş dosya yok). Tek satırlık metin,
// çok satırlı metin (multiline), para (format="money") ya da tarih (format="date"; DatePicker yok, tasarım kararı).
// Etiket her zaman üstte ve htmlFor ile bağlı (hideLabel yalnız görsel gizler); yardım ya da hata altta 14 px, kesilmez;
// hata iletisi "Hata: …" ile başlar, kenar `hata` + zemin `hata-yuzey`, girdi aria-invalid + aria-describedby.
// Odak çizgisini admin.css çizer: kutu [data-focus-line] yalnız girdiyi taşır (girdi klavye odağındayken kutunun altında
// tek çizgi); temizle düğmesi kutunun kardeşidir ve kendi [data-focus-line] çizgisini alır. Halka yok.
// Sanal klavye: odaktayken visualViewport küçülürse alan görünür alana kaydırılır (revealInVisualViewport).
export type TextFieldInputMode = 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url' | 'search';
export type TextFieldType = 'text' | 'search' | 'email' | 'tel' | 'url' | 'password';
/** money: decimal klavye, odak dışında ₺8.500,00; date: numeric klavye, gg.aa.yyyy, rakam yazarken nokta eklenir. */
export type TextFieldFormat = 'money' | 'date';

export interface TextFieldProps {
  /** Görünür etiket; hideLabel ile yalnız görsel olarak gizlenir, erişilebilir ad kalır. */
  label: string;
  /** Kontrollü değer; verilmezse alan kontrolsüz çalışır (defaultValue). */
  value?: string;
  defaultValue?: string;
  /** Her tuş vuruşunda yeni metin (string); olay nesnesi değil. */
  onChange?(value: string): void;
  onBlur?(): void;
  /** Etiket yerine geçmez; örnek biçim gösterir ("8.500,00", "28.10.2026"). */
  placeholder?: string;
  /** Alanın altında 14 px yardım metni; hata varken gösterilmez. */
  help?: string;
  /** Hata iletisi; "Hata:" ile başlamıyorsa önüne eklenir. */
  error?: string;
  disabled?: boolean;
  required?: boolean;
  /** Solda süsleyici Phosphor simgesi (ör. arama için "search"). */
  icon?: IconName;
  /** Sağda kısa birim/ek metin (ör. "₺"). format="money" zaten ₺ yazar; ikisini birlikte kullanma. */
  suffix?: string;
  /** Sayısal alanlar doğru klavyeyi açar: numeric / decimal. Verilmezse format'tan gelir. */
  inputMode?: TextFieldInputMode;
  type?: TextFieldType;
  /** Yalnız bağlamın açık olduğu yerde (arama kutusu gibi). */
  hideLabel?: boolean;
  name?: string;
  autoComplete?: string;
  maxLength?: number;
  id?: string;
  className?: string;
  /** Çok satırlı metin: <textarea>. */
  multiline?: boolean;
  /** multiline satır sayısı; varsayılan 3. */
  rows?: number;
  /**
   * money: inputMode decimal; odak dışında ₺8.500,00 gösterilir. Değer modeli değişmez: onChange yazılan metni bildirir,
   * biçim yalnız görünümdür; ortak ayrıştırıcının (Money.parseMoneyInput) kabul etmediği metin olduğu gibi kalır.
   * date: inputMode numeric, type text, placeholder "gg.aa.yyyy", en çok 10 karakter; sonda rakam yazılırken noktalar eklenir.
   */
  format?: TextFieldFormat;
  /** Metin varken temizle düğmesi (44 px, kaba girişte 48 px). Varsayılan: type="search" için açık. */
  clearable?: boolean;
  /** Temizle düğmesinin erişilebilir adı. Varsayılan: aramada "Aramayı temizle", diğerlerinde "<etiket> alanını temizle". */
  clearLabel?: string;
}

const HATA_ONEKI = /^hata:/i;
/** "Hata: …" sözleşmesi: ileti önekle gelmemişse ekler, gelmişse olduğu gibi bırakır. */
export function hataMetni(error: string): string {
  const metin = error.trim();
  return HATA_ONEKI.test(metin) ? metin : `Hata: ${metin}`;
}

/** Para alanının odak dışı görünümü: "8500" → "₺8.500,00". Ayrıştırılamayan ya da belirsiz metin aynen döner. */
export function moneyDisplay(text: string): string {
  const amount = parseMoneyInput(text);
  return amount === null ? text : formatMoney({ amount, currency: 'TRY' });
}

const ISO_DATE = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/;
const DATE_SEPARATOR = /[.,/\-\s]/;
const DIGIT = /\d/;
/** Tarih maskesi (gg.aa.yyyy): gün ve ay 2 rakamda kapanır, yazılan ayırıcı erken kapatır (1.1.2026), yıl en çok 4 rakam.
 *  Rakam ve ayırıcı dışındaki karakterler düşer; yapıştırılan ISO tarihi (2026-10-28) çevrilir. */
export function maskDateInput(text: string): string {
  const iso = ISO_DATE.exec(text);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const parts = [''];
  for (const char of text) {
    const index = parts.length - 1;
    if (DIGIT.test(char)) {
      if (index === 2) {
        if (parts[2].length < 4) parts[2] += char;
        continue;
      }
      parts[index] += char;
      if (parts[index].length === 2) parts.push('');
    } else if (DATE_SEPARATOR.test(char) && index < 2 && parts[index].length > 0) {
      parts.push('');
    }
  }
  return parts.join('.');
}

export interface VisualViewportLike {
  height: number;
  offsetTop: number;
}

const SCROLLABLE = /(auto|scroll|overlay)/;
/** Sanal klavyeyi kendisi yöneten katman kökü (BottomSheet.layer fitVisualViewport, Dialog: klavye açıkken data-klavye). */
const KEYBOARD_MANAGED_LAYER = '[data-aile-katman][data-klavye]';

/**
 * Öğeyi görsel görünüm alanının (sanal klavyenin üstünde kalan bölge) içine, `margin` boşlukla getirir. Önce en yakın
 * kaydırılabilir atalar, kalan için belge kaydırılır (öğe sabit bir katmanda değilse); anında (hareket yok). Kaydırılan
 * toplam piksel döner (0 = zaten görünür).
 * getBoundingClientRect yerleşim görünüm alanına görelidir; görünür bant [offsetTop, offsetTop + height] aralığıdır.
 * Klavyeyi kendisi yöneten modal katmanda (kök [data-aile-katman][data-klavye]: alt sayfa, diyalog) hiçbir şey yapmaz
 * (0): katman kökü görünür alana oturur ve odaklı alanı yapışık altlığın üstüne kendisi getirir; buradaki kaydırma
 * altlığı bilmez ve katmanın son sözünü bozardı.
 */
export function revealInVisualViewport(target: Element, viewport: VisualViewportLike, margin: number): number {
  if (target.closest(KEYBOARD_MANAGED_LAYER)) return 0;
  const rect = target.getBoundingClientRect();
  const top = viewport.offsetTop + margin;
  const bottom = viewport.offsetTop + viewport.height - margin;
  let delta = 0;
  if (rect.bottom > bottom) delta = rect.bottom - bottom;
  if (rect.top - delta < top) delta = rect.top - top;
  if (Math.abs(delta) < 1) return 0;
  let remaining = delta;
  // Sabit katman (diyalog, alt sayfa) içindeyse yalnız katmanın kendi kaydırıcıları kayar; arkadaki sayfa kaydırılmaz.
  let fixedLayer = false;
  for (let node = target.parentElement; node; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) break;
    const style = getComputedStyle(node);
    if (style.position === 'fixed') fixedLayer = true;
    if (Math.abs(remaining) < 1 || !SCROLLABLE.test(style.overflowY) || node.scrollHeight <= node.clientHeight) continue;
    const before = node.scrollTop;
    node.scrollTop = before + remaining;
    remaining -= node.scrollTop - before;
  }
  if (Math.abs(remaining) >= 1 && !fixedLayer) {
    const page = document.scrollingElement ?? document.documentElement;
    const before = page.scrollTop;
    page.scrollTop = before + remaining;
    remaining -= page.scrollTop - before;
  }
  return delta - remaining;
}

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

type Control = HTMLInputElement | HTMLTextAreaElement;

export function TextField({
  label, value, defaultValue, onChange, onBlur, placeholder, help, error, disabled, required, icon, suffix,
  inputMode, type = 'text', hideLabel, name, autoComplete, maxLength, id: idProp, className,
  multiline, rows, format, clearable, clearLabel,
}: TextFieldProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const noteId = `${id}-not`;
  const invalid = Boolean(error);
  const note = error ? hataMetni(error) : help;

  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = controlled ? value : inner;
  const [focused, setFocused] = useState(false);

  const fieldRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<Control | null>(null);
  const setControl = useCallback((node: Control | null) => { controlRef.current = node; }, []);

  const commit = (next: string) => {
    if (!controlled) setInner(next);
    onChange?.(next);
  };

  const handleChange = (event: ChangeEvent<Control>) => {
    let next = event.target.value;
    if (format === 'date') {
      const caret = event.target.selectionStart;
      if (next.length > current.length && (caret === null || caret === next.length)) next = maskDateInput(next);
    }
    commit(next);
  };

  const handleBlur = () => {
    setFocused(false);
    onBlur?.();
  };

  // Sanal klavye açılınca (visualViewport küçülür) odaklı alan görünür kalır. Odak değişip klavye açık kalırsa
  // resize gelmez; bu yüzden odak anında da bir kez bakılır. Alan (etiket + kutu + not) sığmıyorsa yalnız kutu.
  useEffect(() => {
    if (!focused || typeof window === 'undefined') return undefined;
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const margin = designTokens.bosluk4;
    const reveal = () => {
      const field = fieldRef.current;
      const box = boxRef.current;
      if (!field || !box) return;
      const fits = field.getBoundingClientRect().height <= viewport.height - 2 * margin;
      revealInVisualViewport(fits ? field : box, viewport, margin);
    };
    reveal();
    viewport.addEventListener('resize', reveal);
    return () => viewport.removeEventListener('resize', reveal);
  }, [focused]);

  const showClear = (clearable ?? type === 'search') && !disabled && current !== '';
  const clearName = clearLabel ?? (type === 'search' ? 'Aramayı temizle' : `${label} alanını temizle`);
  const clear = () => {
    commit('');
    controlRef.current?.focus();
  };

  // Kutunun boşluğuna, simgeye ya da eke dokunmak girdiye odaklanır (44/48 px alanın tamamı girdiye çıkar).
  const focusFromBox = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled || event.target === controlRef.current) return;
    controlRef.current?.focus();
  };

  const display = format === 'money' && !focused ? moneyDisplay(current) : current;
  const mode = inputMode ?? (format === 'money' ? 'decimal' : format === 'date' ? 'numeric' : undefined);
  const common = {
    id,
    name,
    value: display,
    onChange: handleChange,
    onFocus: () => setFocused(true),
    onBlur: handleBlur,
    placeholder: placeholder ?? (format === 'date' ? 'gg.aa.yyyy' : undefined),
    disabled,
    required,
    autoComplete,
    maxLength: maxLength ?? (format === 'date' ? 10 : undefined),
    inputMode: mode,
    'aria-invalid': invalid || undefined,
    'aria-describedby': note ? noteId : undefined,
    className: cx('aile-textfield-girdi', format === 'money' && 'aile-textfield-girdi--tutar'),
  };

  return (
    <div
      ref={fieldRef}
      className={cx('aile-textfield', className)}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      data-multiline={multiline || undefined}
      data-format={format}
    >
      <label htmlFor={id} className={cx('aile-textfield-label', hideLabel && 'aile-gorsel-gizli')}>{label}</label>
      <div className="aile-textfield-alan" data-temizle={showClear || undefined}>
        <div ref={boxRef} className="aile-textfield-kutu" data-focus-line="" onClick={focusFromBox}>
          {icon && <Icon name={icon} />}
          {multiline
            ? <textarea {...common} ref={setControl} rows={rows ?? 3} />
            : <input {...common} ref={setControl} type={format ? 'text' : type} />}
          {suffix && <span className="aile-textfield-suffix">{suffix}</span>}
        </div>
        {showClear && (
          <button type="button" className="aile-textfield-temizle" aria-label={clearName} aria-controls={id} data-focus-line="" onClick={clear}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {note && (
        <p id={noteId} className={cx('aile-textfield-note', 'aile-kucuk', invalid ? 'aile-textfield-note--hata' : 'aile-ikincil')}>
          {invalid && <Icon name="alert" size={18} className="aile-textfield-note-icon" />}
          <span>{note}</span>
        </p>
      )}
    </div>
  );
}
