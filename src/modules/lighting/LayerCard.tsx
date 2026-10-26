import { Badge, Box, Card, Group, Stack, Text } from '@mantine/core';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { WarnBadge } from '@/components/badges';
import { formatTlRange } from '@/lib/price';
import { cctGradient } from '@/lib/cct';
import { cctRange, driverLoad, layerIssues, layerTitle, type RoomSetting } from './rules';
import { layerIcon } from './layerIcons';
import classes from './lighting.module.css';

function rangeText(min?: number, max?: number): string {
  if (min != null && max != null) return min === max ? `${min}` : `${min}–${max}`;
  return `${min ?? max}`;
}

export function LayerCard({ layer, room, linkedCount = 0 }: { layer: Item; room?: RoomSetting | null; linkedCount?: number }) {
  const [, navigate] = useLocation();
  const Icon = layerIcon(layer.katman_tur);
  const title = layerTitle(layer);
  const issues = layerIssues(layer, room);
  const drv = driverLoad(layer);
  const cct = cctRange([layer]);
  const go = () => navigate(`~/aydinlatma/${layer.oda}/${layer.id}`);
  const hasLux = layer.lux_min != null || layer.lux_max != null;
  const warnings: Array<{ key: string; tone: 'warn' | 'danger' | 'info'; text: string }> = [];
  for (const e of issues.errors) {
    warnings.push({ key: `e-${e.field}`, tone: 'danger', text: e.field === 'cri_min' ? 'CRI < 90' : e.field === 'montaj_yukseklik_cm' ? 'köpek kuralı' : e.field === 'surucu_w' ? 'sürücü yetersiz' : e.field === 'cct_max' ? 'CCT aralığı' : e.message });
  }
  for (const w of issues.warnings) {
    warnings.push({ key: `w-${w.field}`, tone: w.field === 'uzunluk_m' ? 'warn' : 'info', text: w.field === 'uzunluk_m' ? 'iki uçtan besleme' : w.field === 'cri_min' ? 'CRI belirtilmedi' : w.message });
  }
  return (
    <Card withBorder radius="md" p="sm" className={classes.card} data-testid="layer-card" data-tur={layer.katman_tur} role="link" tabIndex={0}
      aria-label={`${title} katmanı`} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Box className={classes.iconBox} aria-hidden><Icon size={24} /></Box>
        <Stack gap={4} className={classes.grow}>
          <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
            <Text fw={600} lineClamp={2} data-allow-clamp>{title}</Text>
            {layer.katman_tur && <Badge size="xs" variant="default" style={{ flexShrink: 0 }}>{label('katman_tur', layer.katman_tur)}</Badge>}
          </Group>
          {layer.amac && <Text size="sm" c="dimmed" lineClamp={2} data-allow-clamp>{layer.amac}</Text>}
          <Stack gap={2}>
            {hasLux && (
              <Text size="xs">{rangeText(layer.lux_min, layer.lux_max)} lux{layer.lux_duzlem ? ` · ${label('lux_duzlem', layer.lux_duzlem).toLocaleLowerCase('tr')} düzlem` : ''}</Text>
            )}
            {cct && (
              <Text size="xs">
                {layer.cct_mod ? `${label('cct_mod', layer.cct_mod)} · ` : ''}{rangeText(cct.min, cct.max)} K
                <Box component="span" className={classes.miniStrip} aria-hidden style={{ background: cctGradient(cct.min, cct.max) }} />
              </Text>
            )}
            {(layer.cri_min != null || layer.r9_min != null) && (
              <Text size="xs">{[layer.cri_min != null ? `CRI ${layer.cri_min}` : null, layer.r9_min != null ? `R9 ${layer.r9_min}` : null].filter(Boolean).join(' · ')}</Text>
            )}
            {layer.urun_sinifi && <Text size="xs" c="dimmed">Ürün: <Text component="span" size="xs" c="var(--mantine-color-text)">{layer.urun_sinifi}</Text></Text>}
            {drv && drv.surucuW == null && <Text size="xs" c="dimmed">Şerit yükü {drv.loadW} W · sürücü en az {drv.needW} W</Text>}
          </Stack>
          <Group gap={4} wrap="wrap">
            {layer.flicker && <Badge size="xs" variant="default">{label('flicker', layer.flicker)}</Badge>}
            {layer.kontrol_cihaz && <Badge size="xs" variant="default">{label('kontrol_cihaz', layer.kontrol_cihaz)}</Badge>}
            {layer.adim && <Badge size="xs" variant="outline" color="gray.8">{label('adim', layer.adim)}</Badge>}
            {(layer.kim ?? []).map((k) => <Badge key={k} size="xs" variant="outline" color="gray.8">{label('kim', k)}</Badge>)}
            {linkedCount > 0 && <Badge size="xs" variant="default">{linkedCount} ürün</Badge>}
            {drv && drv.ok === true && drv.marginPct != null && <WarnBadge tone="ok">sürücü payı %{drv.marginPct}</WarnBadge>}
            {warnings.map((w) => <WarnBadge key={w.key} tone={w.tone}>{w.text}</WarnBadge>)}
          </Group>
          {(layer.tahmini_tl_min != null || layer.tahmini_tl_max != null) && (
            <Text fw={600} size="sm" className="tabular">{formatTlRange(layer.tahmini_tl_min, layer.tahmini_tl_max)}</Text>
          )}
        </Stack>
      </Group>
    </Card>
  );
}
