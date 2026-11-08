import { Fragment, useId } from 'react';
import { useDevice } from '../device';
import { Button } from './Button';
import './ConflictView.css';

// Tasarım: components/ConflictView/README.md + index.d.ts ConflictViewProps; referans davranış bundle.js ConflictView.
// Aynı kaydın iki sürümü. Geniş alanda (tablet, masaüstü) yan yana iki sütun: her sütun sürüm adıyla bir grup,
// bütün alanlar dt/dd olarak, karar düğmesi kendi sütununun altında (sol birincil, sağ ikincil). Telefonda alan alan:
// üstte "N alan farklı · M alan aynı", yalnız farklı alanlar listelenir, karar düğmeleri en altta tam genişlik alt alta.
// Farklı alanın değeri uyari-yuzey ile işaretlenir; renk tek işaret değildir: değerin önünde gizli "Farklı: " metni
// vardır ve özet satırı sayıyı söyler. Boş değer saklanmaz, "Henüz yok" yazılır (README › İçerik ilkeleri).
// Referansın sütun ve alan kartları yerine tek yuzey alanı kullanılır; ayrım yalnız cizgi ayırıcı (kart yağmuru yok).
// Renk ve ölçüler ConflictView.css'te --aile-* tokenlarıyla; odak çizgisini admin.css çizer.

export interface ConflictField {
  label: string;
  /** Sol sürümün değeri (leftLabel). Boş metin "Henüz yok" olarak yazılır. */
  a: string;
  /** Sağ sürümün değeri (rightLabel). */
  b: string;
}

export interface ConflictViewProps {
  fields: readonly ConflictField[];
  /** Sol sürümün adı ("Bu cihazdaki sürüm"). */
  leftLabel: string;
  /** Sağ sürümün adı ("Kaynaktaki sürüm"). */
  rightLabel: string;
  /** Sol kararın etiketi; varsayılan "Bunu tut". */
  leftAction?: string;
  /** Sağ kararın etiketi; varsayılan "Diğerini al". */
  rightAction?: string;
  onLeftAction?(): void;
  onRightAction?(): void;
  className?: string;
}

const HENUZ_YOK = 'Henüz yok';
const FARKLI_ONEK = 'Farklı: ';
export const SOL_VARSAYILAN = 'Bunu tut';
export const SAG_VARSAYILAN = 'Diğerini al';

function isDifferent(field: ConflictField): boolean {
  return field.a !== field.b;
}

/** Özet: "2 alan farklı · 1 alan aynı". */
export function summarize(fields: readonly ConflictField[]): string {
  const different = fields.filter(isDifferent).length;
  return `${different} alan farklı · ${fields.length - different} alan aynı`;
}

/** Değer hücresi: boş metin "Henüz yok"; farklı alanda uyari-yuzey + gizli "Farklı: " öneki. */
function Value({ value, different }: { value: string; different: boolean }) {
  const empty = value.trim().length === 0;
  return (
    <dd className="aile-cf-deger" data-fark={different || undefined} data-yok={empty || undefined}>
      {different && <span className="aile-cf-gizli">{FARKLI_ONEK}</span>}
      {empty ? HENUZ_YOK : value}
    </dd>
  );
}

interface ColumnProps {
  id: string;
  label: string;
  side: 'a' | 'b';
  fields: readonly ConflictField[];
  action: string;
  primary: boolean;
  onAction?(): void;
}

function Column({ id, label, side, fields, action, primary, onAction }: ColumnProps) {
  return (
    <div className="aile-cf-sutun" role="group" aria-labelledby={id}>
      <p id={id} className="aile-cf-surum">{label}</p>
      <dl className="aile-cf-alanlar">
        {fields.map(field => (
          <Fragment key={field.label}>
            <dt className="aile-cf-etiket">{field.label}</dt>
            <Value value={field[side]} different={isDifferent(field)} />
          </Fragment>
        ))}
      </dl>
      <div className="aile-cf-eylem">
        <Button variant={primary ? 'primary' : 'secondary'} onClick={onAction}>{action}</Button>
      </div>
    </div>
  );
}

export function ConflictView({
  fields, leftLabel, rightLabel, leftAction = SOL_VARSAYILAN, rightAction = SAG_VARSAYILAN, onLeftAction, onRightAction, className,
}: ConflictViewProps) {
  const device = useDevice();
  const baseId = useId();
  const narrow = device === 'phone';
  const summary = <p className="aile-cf-ozet">{summarize(fields)}</p>;
  const classes = ['aile-cf', narrow && 'aile-cf--dar', className].filter(Boolean).join(' ');

  if (narrow) {
    const different = fields.filter(isDifferent);
    return (
      <div className={classes} data-device={device}>
        {summary}
        <ul className="aile-cf-liste">
          {different.map(field => (
            <li key={field.label} className="aile-cf-alan">
              <p className="aile-cf-alan-adi">{field.label}</p>
              <dl className="aile-cf-cift">
                <dt className="aile-cf-etiket">{leftLabel}</dt>
                <Value value={field.a} different />
                <dt className="aile-cf-etiket">{rightLabel}</dt>
                <Value value={field.b} different />
              </dl>
            </li>
          ))}
        </ul>
        <div className="aile-cf-eylem aile-cf-eylem--dar">
          <Button variant="primary" block onClick={onLeftAction}>{leftAction}</Button>
          <Button variant="secondary" block onClick={onRightAction}>{rightAction}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={classes} data-device={device}>
      {summary}
      <div className="aile-cf-yanyana">
        <Column id={`${baseId}-sol`} label={leftLabel} side="a" fields={fields} action={leftAction} primary onAction={onLeftAction} />
        <Column id={`${baseId}-sag`} label={rightLabel} side="b" fields={fields} action={rightAction} primary={false} onAction={onRightAction} />
      </div>
    </div>
  );
}
