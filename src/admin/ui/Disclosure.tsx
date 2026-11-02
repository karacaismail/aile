import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';
import './Disclosure.css';

// Tasarım › components/Disclosure/README.md: başlıkla açılıp kapanan bölüm; filtre panelinin her boyutu birer
// Disclosure'dır. Başlık 44 px / 600, sayım (meta) kapalıyken de görünür, ok ve içerik 240 ms tek eğriyle.
// Kendi düğme + bölge işaretlemesi (APG disclosure); antd Collapse kullanılmaz. Odak çizgisini admin.css
// [data-focus-line] ile çizer. Kapalı bölge hidden + inert; yükseklik geçişi Disclosure.css'te.
export interface DisclosureProps {
  title: string;
  children?: ReactNode;
  /** Sayım gibi kısa bilgi ("2 seçili", "Henüz yok"); kapalıyken de görünür. */
  meta?: string;
  /** Kontrolsüz başlangıç durumu; `open` verilince yoksayılır. */
  defaultOpen?: boolean;
  /** Kontrollü durum; değişiklik isteği `onToggle` ile dışarıya gider. */
  open?: boolean;
  onToggle?(open: boolean): void;
  disabled?: boolean;
  className?: string;
}

export function Disclosure({ title, children, meta, defaultOpen = false, open, onToggle, disabled = false, className }: DisclosureProps) {
  const id = useId();
  const buttonId = `${id}-baslik`;
  const panelId = `${id}-icerik`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const isOpen = open ?? innerOpen;

  // Kapanırken odak içerideyse başlığa taşı: içerik inert olunca odak sessizce body'ye düşmesin.
  useLayoutEffect(() => {
    if (isOpen) return;
    const panel = panelRef.current;
    if (panel && document.activeElement && panel.contains(document.activeElement)) buttonRef.current?.focus();
  }, [isOpen]);

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setInnerOpen(next);
    onToggle?.(next);
  };

  return (
    <div className={['aile-disc', className].filter(Boolean).join(' ')}>
      <button
        ref={buttonRef}
        type="button"
        id={buttonId}
        className="aile-disc-btn"
        aria-expanded={isOpen}
        aria-controls={panelId}
        disabled={disabled}
        data-focus-line=""
        onClick={toggle}
      >
        <span className="aile-disc-title">{title}</span>
        {meta ? <span className="aile-disc-meta aile-kucuk">{meta}</span> : null}
        <Icon name="chevronDown" className="aile-disc-chev" />
      </button>
      <div ref={panelRef} id={panelId} role="region" aria-labelledby={buttonId} className="aile-disc-panel" hidden={!isOpen} inert={!isOpen}>
        <div className="aile-disc-inner">
          <div className="aile-disc-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
