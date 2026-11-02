import { useId, useRef, type CSSProperties } from 'react';
import { Button } from './Button';
import { useKeyboardOverlap, useStickyReserve } from './FormFooter.viewport';
import './FormFooter.css';

// Tasarım › components/FormFooter: formun altındaki durum metni ve eylemleri.
// Geniş: durum solda, eylemler sağda (ikincil, birincil). Dar: tam genişlik, birincil üstte — DOM sırası da
// görsel sırayla aynıdır (column-reverse yok; odak sırası okuma sırasına eşit). Telefonda yapışkan (safe area dahil).
// Sanal klavye: yapışkan altlık görsel görünüm alanının altına yapışır (FormFooter.viewport.ts ölçer, --aile-ff-klavye
// ve data-klavye ile uygulanır); klavye açıkken güvenli alan payı klavyenin altında kaldığından düşer.
// Odak: belgeye yapışan altlığın yüksekliği belge kaydırma payıdır (useStickyReserve → --aile-ff-yukseklik); odağa
// kaydırılan alan altlığın altında kalmaz.

export type FormFooterTone = 'uyari' | 'hata';

interface FormFooterBase {
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?(): void;
  onSecondary?(): void;
  /** `hata` tonunda metin "Hata: " ile başlar (renk tek işaret değildir); eksikse bileşen ekler. */
  statusTone?: FormFooterTone;
  /** Telefon: birincil üstte, iki düğme tam genişlik; `sticky` verilmezse yapışkan. */
  narrow?: boolean;
  /** Formun altına yapışır; `narrow` için varsayılan açık, `sticky={false}` kapatır (ör. alttan sayfa içinde). */
  sticky?: boolean;
}
/** Devre dışı birincil düğmenin nedeni durum metninde görünür olmalıdır; `primaryDisabled` yalnız `status` ile derlenir. */
export type FormFooterProps = FormFooterBase & (
  | { status: string; primaryDisabled?: boolean }
  | { status?: undefined; primaryDisabled?: false }
);

const ERROR_PREFIX = 'Hata:';

function statusText(status: string | undefined, tone: FormFooterTone | undefined) {
  if (!status) return '';
  if (tone === 'hata' && !status.trimStart().startsWith(ERROR_PREFIX)) return `${ERROR_PREFIX} ${status}`;
  return status;
}

export function FormFooter({ primaryLabel, secondaryLabel, onPrimary, onSecondary, status, statusTone, primaryDisabled, narrow = false, sticky }: FormFooterProps) {
  const isSticky = sticky ?? narrow;
  const text = statusText(status, statusTone);
  const statusId = useId();
  const root = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboardOverlap(root, isSticky);
  useStickyReserve(root, isSticky);
  const keyboardStyle = keyboard > 0 ? ({ '--aile-ff-klavye': `${keyboard}px` } as CSSProperties) : undefined;
  const primary = primaryLabel ? (
    // Devre dışı birincilin nedeni durum metnidir; aria-describedby ile düğmeye bağlanır (Button README).
    <Button key="primary" variant="primary" block={narrow} disabled={primaryDisabled} onClick={onPrimary} aria-describedby={primaryDisabled && text ? statusId : undefined}>
      {primaryLabel}
    </Button>
  ) : null;
  const secondary = secondaryLabel ? (
    <Button key="secondary" variant="secondary" block={narrow} onClick={onSecondary}>{secondaryLabel}</Button>
  ) : null;
  return (
    <div
      ref={root}
      className={['aile-ff', narrow && 'aile-ff--dar', isSticky && 'aile-ff--yapiskan'].filter(Boolean).join(' ')}
      data-narrow={narrow || undefined}
      data-sticky={isSticky || undefined}
      data-klavye={keyboard > 0 || undefined}
      style={keyboardStyle}
    >
      {/* Canlı bölge her zaman DOM'dadır: sonradan gelen "Hata: …" odak almadan duyurulur. */}
      <p id={statusId} className="aile-ff-status" role="status" data-tone={text ? statusTone : undefined}>{text}</p>
      <div className="aile-ff-actions">
        {narrow ? [primary, secondary] : [secondary, primary]}
      </div>
    </div>
  );
}
