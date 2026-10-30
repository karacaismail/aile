import { Badge, type BadgeProps } from '@mantine/core';
import { DogIcon } from '@phosphor-icons/react/dist/csr/Dog';
import { label } from '@shared/schema';
import { WarnBadge } from './badges';

/** Köpek erişimi rozet tonu, tüm modüllerde aynı: serbest → uyarı (şerit/kablo kuralı), gece kapalı → bilgi, kapalı → sorun yok. */
export const DOG_ACCESS_TONE: Record<string, 'warn' | 'info' | 'ok'> = { serbest: 'warn', gece_kapali: 'info', kapali: 'ok' };

export function DogAccessBadge({ value, prefix, unsetLabel, ...rest }: { value?: string; prefix?: boolean; unsetLabel?: string } & BadgeProps) {
  if (!value) {
    return unsetLabel ? <Badge size="xs" variant="default" leftSection={<DogIcon size={10} aria-hidden />} {...rest}>{unsetLabel}</Badge> : null;
  }
  const text = label('kopek_erisim', value);
  return (
    <WarnBadge tone={DOG_ACCESS_TONE[value] ?? 'info'} leftSection={<DogIcon size={10} aria-hidden />} {...rest}>
      {prefix ? `köpek ${text.toLocaleLowerCase('tr')}` : text}
    </WarnBadge>
  );
}
