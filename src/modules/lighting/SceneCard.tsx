import { Badge, Card, Group, Stack, Text } from '@mantine/core';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { LightningIcon } from '@phosphor-icons/react/dist/csr/Lightning';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { OdaBadge } from '@/components/badges';
import { layerTitle, parseLevel, type SceneLevel } from './rules';
import classes from './lighting.module.css';

export function levelText(lv: SceneLevel, layers: Map<string, Item>): string {
  const l = layers.get(lv.layerId);
  const name = l ? `${label('oda', l.oda)} · ${layerTitle(l)}` : 'bilinmeyen katman';
  return `${name} · ${lv.pct != null ? `%${lv.pct}` : '—'} · ${lv.cct != null ? `${lv.cct} K` : '—'}`;
}

export function SceneCard({ scene, layers }: { scene: Item; layers: Map<string, Item> }) {
  const [, navigate] = useLocation();
  const levels = (scene.seviyeler ?? []).map(parseLevel).filter((x): x is SceneLevel => !!x);
  const go = () => navigate(`~/aydinlatma/sahne/${scene.id}`);
  return (
    <Card withBorder radius="md" p="sm" className={classes.card} data-testid="scene-card" role="link" tabIndex={0}
      aria-label={`${scene.ad} sahnesi`} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text fw={600} lineClamp={1} data-allow-clamp>{scene.ad}</Text>
          <CaretRightIcon size={18} aria-hidden />
        </Group>
        <Group gap={4} wrap="wrap">
          <OdaBadge value={scene.oda} />
          {scene.tetik && <Badge size="xs" variant="default" leftSection={<LightningIcon size={10} aria-hidden />}>{label('tetik', scene.tetik)}</Badge>}
          <Badge size="xs" variant="default">{levels.length} katman</Badge>
        </Group>
        {levels.length > 0 && (
          <Stack gap={2}>
            {levels.map((lv, i) => <Text key={`${lv.layerId}-${i}`} size="xs" data-testid="scene-level">{levelText(lv, layers)}</Text>)}
          </Stack>
        )}
        {scene.not && <Text size="xs" c="dimmed" lineClamp={2} data-allow-clamp>{scene.not}</Text>}
      </Stack>
    </Card>
  );
}
