import { useId, type ChangeEvent } from 'react';
import { AntInput } from './antd';
import { Icon, type IconName } from './icons';
import './TextField.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/TextField/README.md + bundle.js › TextField/FieldNote.
// Tek satırlık metin, sayı ya da tarih girişi (tarih için DatePicker yok: inputMode="numeric", 28.10.2026).
// Etiket her zaman üstte ve htmlFor ile bağlı (hideLabel yalnız görsel gizler); yardım ya da hata altta 14 px,
// kesilmez; hata iletisi "Hata: …" ile başlar, kenar `hata` + zemin `hata-yuzey`, input aria-invalid.
// Odak çizgisini admin.css çizer (.ant-input-affix-wrapper-focused / :has(> .ant-input:focus) ::after).
export type TextFieldInputMode = 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url' | 'search';
export type TextFieldType = 'text' | 'search' | 'email' | 'tel' | 'url' | 'password';

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
  /** Sağda kısa birim/ek metin (ör. "₺"). */
  suffix?: string;
  /** Sayısal alanlar doğru klavyeyi açar: numeric / decimal. */
  inputMode?: TextFieldInputMode;
  type?: TextFieldType;
  /** Yalnız bağlamın açık olduğu yerde (arama kutusu gibi). */
  hideLabel?: boolean;
  name?: string;
  autoComplete?: string;
  maxLength?: number;
  id?: string;
  className?: string;
}

const HATA_ONEKI = /^hata:/i;
/** "Hata: …" sözleşmesi: ileti önekle gelmemişse ekler, gelmişse olduğu gibi bırakır. */
export function hataMetni(error: string): string {
  const metin = error.trim();
  return HATA_ONEKI.test(metin) ? metin : `Hata: ${metin}`;
}

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

export function TextField({
  label, value, defaultValue, onChange, onBlur, placeholder, help, error, disabled, required, icon, suffix,
  inputMode, type = 'text', hideLabel, name, autoComplete, maxLength, id: idProp, className,
}: TextFieldProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const noteId = `${id}-not`;
  const invalid = Boolean(error);
  const note = error ? hataMetni(error) : help;

  const handleChange = onChange ? (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value) : undefined;

  return (
    <div className={cx('aile-textfield', className)} data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
      <label htmlFor={id} className={cx('aile-textfield-label', hideLabel && 'aile-gorsel-gizli')}>{label}</label>
      <AntInput
        id={id}
        name={name}
        type={type}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        status={invalid ? 'error' : undefined}
        prefix={icon ? <Icon name={icon} /> : undefined}
        suffix={suffix ? <span className="aile-textfield-suffix">{suffix}</span> : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={note ? noteId : undefined}
        className="aile-textfield-control"
      />
      {note && (
        <p id={noteId} className={cx('aile-textfield-note', 'aile-kucuk', invalid ? 'aile-textfield-note--hata' : 'aile-ikincil')}>
          {invalid && <Icon name="alert" size={18} className="aile-textfield-note-icon" />}
          <span>{note}</span>
        </p>
      )}
    </div>
  );
}
