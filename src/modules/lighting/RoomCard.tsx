import { Badge, Box, Card, Group, RingProgress, Stack, Text } from '@mantine/core';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { MoonIcon } from '@phosphor-icons/react/dist/csr/Moon';
import { useLocation } from 'wouter';
import type { Item, Oda } from '@shared/schema';
import { label } from '@shared/schema';
import { WarnBadge } from '@/components/badges';
import { cctGradient } from '@/lib/cct';
import { cctRange, completion, roomBadges } from './rules';
import classes from './lighting.module.css';

export function RoomCard({ oda, layers }: { oda: Oda; layers: Item[] }) {
  const [, navigate] = useLocation();
  const c = completion(layers);
  const range = cctRange(layers);
  const b = roomBadges(layers);
  const name = label('oda', oda);
  const go = () => navigate(`~/aydinlatma/${oda}`);
  return (
    <Card withBorder radius="md" p="sm" className={classes.card} data-testid="room-card" data-oda={oda} role="link" tabIndex={0}
      aria-label={`${name} aydınlatma`} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
      <Box className={classes.strip} data-testid="cct-strip" data-cct={range ? `${range.min}-${range.max}` : 'none'} aria-hidden
        style={{ background: range ? cctGradient(range.min, range.max) : 'var(--mantine-color-default-border)' }} />
      <Group gap="sm" wrap="nowrap" align="center" mt={8}>
        <RingProgress size={48} thickness={5} roundCaps sections={[{ value: c.pct, color: c.pct === 100 ? 'teal.7' : 'ember.7' }]}
          label={<Text size="xs" ta="center" fw={600} className="tabular">{c.done}/{c.total}</Text>} />
        <Stack gap={4} className={classes.grow}>
          <Text fw={600} lineClamp={1} data-allow-clamp>{name}</Text>
          <Group gap={4} wrap="wrap">
            <Badge size="xs" variant="default">{b.count} katman</Badge>
            {b.gece && <WarnBadge tone="ok" leftSection={<MoonIcon size={10} aria-hidden />}>gece</WarnBadge>}
            {b.gorevCri90 && <WarnBadge tone="ok">görev CRI≥90</WarnBadge>}
            {b.missing.map((m) => <WarnBadge key={m} tone="warn">{label('katman_tur', m).toLocaleLowerCase('tr')} yok</WarnBadge>)}
          </Group>
        </Stack>
        <CaretRightIcon size={18} aria-hidden />
      </Group>
    </Card>
  );
}
