import { Badge, Box, type BadgeProps } from '@mantine/core';
import { label } from '@shared/schema';

const DURUM_COLOR: Record<string, string> = { fikir: 'gray.5', arastirma: 'blue.6', karar: 'ember.6', siparis: 'yellow.6', teslim: 'teal.6', kuruldu: 'green.7', iptal: 'red.6' };
const FAZ_COLOR: Record<string, string> = { '1': 'ember.8', '2': 'sand.8', '3': 'teal.9' };

function Dot({ color }: { color: string }) {
  return <Box component="span" aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: `var(--mantine-color-${color.replace('.', '-')})` }} />;
}

/** Durum: nötr rozet + renkli nokta (metin kontrastı her zaman AA). */
export function DurumBadge({ value, ...rest }: { value?: string } & BadgeProps) {
  if (!value) return null;
  return <Badge size="xs" variant="default" leftSection={<Dot color={DURUM_COLOR[value] ?? 'gray.5'} />} {...rest}>{label('durum', value)}</Badge>;
}
export function FazBadge({ value, ...rest }: { value?: string } & BadgeProps) {
  if (!value) return null;
  return <Badge size="xs" variant="filled" color={FAZ_COLOR[value] ?? 'gray.7'} {...rest}>{label('faz', value)}</Badge>;
}
export function OdaBadge({ value, ...rest }: { value?: string } & BadgeProps) {
  if (!value) return null;
  return <Badge size="xs" variant="outline" color="gray.8" {...rest}>{label('oda', value)}</Badge>;
}
export function KategoriBadge({ value, ...rest }: { value?: string } & BadgeProps) {
  if (!value) return null;
  return <Badge size="xs" variant="default" {...rest}>{label('kategori', value)}</Badge>;
}
/** Uyarı rozetleri: koyu dolgu + beyaz metin. tone: info | warn | danger | ok */
export function WarnBadge({ tone = 'warn', ...rest }: { tone?: 'info' | 'warn' | 'danger' | 'ok' } & BadgeProps) {
  const color = tone === 'danger' ? 'red.8' : tone === 'ok' ? 'teal.9' : tone === 'info' ? 'gray.7' : 'ember.8';
  return <Badge size="xs" variant="filled" color={color} {...rest} />;
}
