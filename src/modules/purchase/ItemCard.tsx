import { Card, Checkbox, Group, Stack, Text, Badge, Box } from '@mantine/core';
import { ClockCountdownIcon, QuestionIcon, HouseIcon } from '@phosphor-icons/react';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { DurumBadge, FazBadge, OdaBadge, WarnBadge } from '@/components/badges';
import { formatTl, formatTlRange } from '@/lib/price';
import { daysUntil } from '@/lib/dates';
import { DONE_DURUM, estimateOf } from '@/data/selectors';
import classes from './ItemCard.module.css';

export function ItemCard({ item, onToggleDone }: { item: Item; onToggleDone: (item: Item, done: boolean) => void }) {
  const [, navigate] = useLocation();
  const done = !!item.durum && DONE_DURUM.has(item.durum);
  const est = estimateOf(item);
  const due = item.siparis_son_tarih ? daysUntil(item.siparis_son_tarih) : null;
  const dueSoon = due !== null && due <= 7 && !done && item.durum !== 'siparis' && item.durum !== 'iptal';
  const priceText = item.gercek_tl != null ? formatTl(est) : formatTlRange(item.tahmini_tl_min, item.tahmini_tl_max);
  return (
    <Card withBorder radius="md" p="sm" className={classes.card} data-testid="item-card" data-done={done || undefined} data-cancelled={item.durum === 'iptal' || undefined}>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Box component="label" className={classes.checkWrap} onClick={(e) => e.stopPropagation()}>
          <Checkbox
            size="md"
            radius="xl"
            checked={done}
            aria-label={`${item.ad} alındı`}
            onChange={(e) => onToggleDone(item, e.currentTarget.checked)}
            disabled={item.durum === 'iptal'}
          />
        </Box>
        <Stack gap={4} className={classes.linkArea} onClick={() => navigate(`~/satinalma/${item.id}`)} role="link" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(`~/satinalma/${item.id}`); }} aria-label={`${item.ad} detayı`}>
          <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
            <Text fw={600} lineClamp={2} className={classes.title} data-allow-clamp>{item.ad}</Text>
            <Text fw={700} className={`tabular ${classes.price}`} c={est == null ? 'dimmed' : undefined}>
              {item.mevcut ? 'mevcut' : priceText}
            </Text>
          </Group>
          <Group gap={4} wrap="wrap">
            <FazBadge value={item.faz} />
            <DurumBadge value={item.durum} />
            <OdaBadge value={item.oda} />
            {item.adet && item.adet > 1 ? <Badge size="xs" variant="default">{item.adet} {item.birim ?? 'adet'}</Badge> : null}
            {item.mevcut && <WarnBadge tone="ok" leftSection={<HouseIcon size={10} aria-hidden />}>elimizde</WarnBadge>}
            {item.karar_bekliyor && <WarnBadge tone="warn" leftSection={<QuestionIcon size={10} aria-hidden />}>karar</WarnBadge>}
            {dueSoon && <WarnBadge tone={due! < 0 ? 'danger' : 'warn'} leftSection={<ClockCountdownIcon size={10} aria-hidden />}>
              {due! < 0 ? `${-due!} gün geçti` : due === 0 ? 'bugün' : `${due} gün`}
            </WarnBadge>}
          </Group>
        </Stack>
      </Group>
    </Card>
  );
}
