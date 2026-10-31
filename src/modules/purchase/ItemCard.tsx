import { Card, Checkbox, Group, Stack, Text, Badge, Box } from '@mantine/core';
// Group is still used for the checkbox row and the badge row.
import { ClockCountdownIcon } from '@phosphor-icons/react/dist/csr/ClockCountdown';
import { QuestionIcon } from '@phosphor-icons/react/dist/csr/Question';
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House';
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
          {/* The item name is the identifier: it wraps fully and is never clamped; the price follows it in the same text flow. */}
          <Text component="p" className={classes.heading}>
            <span className={classes.title}>{item.ad}</span>{' '}
            <Text component="span" fw={700} className={`tabular ${classes.price}`} c={est == null ? 'dimmed' : undefined}>{item.mevcut ? 'mevcut' : priceText}</Text>
          </Text>
          <Group gap={4} wrap="wrap">
            <FazBadge value={item.faz} />
            <DurumBadge value={item.durum} />
            <OdaBadge value={item.oda} />
            {item.adet && (item.adet > 1 || (item.birim && item.birim !== 'adet')) ? <Badge size="xs" variant="default" className="tabular">{item.adet} {item.birim ?? 'adet'}</Badge> : null}
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
