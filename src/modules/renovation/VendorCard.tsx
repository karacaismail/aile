import { ActionIcon, Anchor, Badge, Card, Group, Progress, Stack, Text } from '@mantine/core';
import { PhoneIcon } from '@phosphor-icons/react/dist/csr/Phone';
import { WhatsappLogoIcon } from '@phosphor-icons/react/dist/csr/WhatsappLogo';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { WarnBadge } from '@/components/badges';
import { formatTl } from '@/lib/price';
import { normalizePhone, whatsappHref } from './rules';
import classes from './renovation.module.css';

export function VendorCard({ vendor }: { vendor: Item }) {
  const [, navigate] = useLocation();
  const wa = whatsappHref(vendor.telefon);
  const tel = normalizePhone(vendor.telefon);
  const go = () => navigate(`~/tadilat/ustalar/${vendor.id}`);
  return (
    <Card withBorder radius="md" p="sm" className={classes.card} data-testid="vendor-card">
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Stack gap={4} className={classes.linkArea} role="link" tabIndex={0} aria-label={`${vendor.ad} detayı`} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
          <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
            <Text fw={600} className={classes.title}>{vendor.ad}</Text>
            <Text fw={700} className="tabular" style={{ whiteSpace: 'nowrap', flexShrink: 0 }} c={vendor.teklif_tl == null ? 'dimmed' : undefined}>
              {vendor.teklif_tl != null ? formatTl(vendor.teklif_tl) : 'teklif yok'}
            </Text>
          </Group>
          <Group gap={4} wrap="wrap">
            {vendor.meslek && <Badge size="xs" variant="outline" color="gray">{label('meslek', vendor.meslek)}</Badge>}
            <WarnBadge tone={vendor.myk_dogrulandi ? 'ok' : 'warn'}>{vendor.myk_dogrulandi ? 'MYK doğrulandı' : 'MYK doğrulanmadı'}</WarnBadge>
            {vendor.teklif_sure_gun != null && <Badge size="xs" variant="default">{vendor.teklif_sure_gun} gün</Badge>}
            {vendor.garanti_ay != null && <Badge size="xs" variant="default">{vendor.garanti_ay} ay garanti</Badge>}
          </Group>
        </Stack>
        {wa && (
          <ActionIcon component="a" href={wa} target="_blank" rel="noreferrer" aria-label={`WhatsApp: ${vendor.ad}`} color="teal" variant="light" style={{ flexShrink: 0 }}>
            <WhatsappLogoIcon size={26} aria-hidden />
          </ActionIcon>
        )}
      </Group>
      <Group justify="space-between" wrap="nowrap" gap="xs" mt={2}>
        {tel ? (
          <Anchor href={`tel:+${tel}`} size="sm" className={classes.telLink}>
            <PhoneIcon size={18} aria-hidden />
            {vendor.telefon}
          </Anchor>
        ) : <Text size="sm" c="dimmed" style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>Telefon yok</Text>}
        {vendor.uyum_pct != null && (
          <Group gap={6} wrap="nowrap" style={{ flex: 1, maxWidth: 140 }}>
            <Progress value={vendor.uyum_pct} size="sm" color="teal.8" style={{ flex: 1 }} aria-label={`Şartname uyumu %${vendor.uyum_pct}`} />
            <Text size="xs" c="dimmed" className="tabular" style={{ whiteSpace: 'nowrap' }}>%{vendor.uyum_pct}</Text>
          </Group>
        )}
      </Group>
    </Card>
  );
}
