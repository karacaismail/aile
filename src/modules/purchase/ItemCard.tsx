import { Card, Checkbox, Group, Stack, Text, Badge, Box } from '@mantine/core';
import { ClockCountdownIcon } from '@phosphor-icons/react/dist/csr/ClockCountdown';
import { QuestionIcon } from '@phosphor-icons/react/dist/csr/Question';
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House';
import { Link, useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { DurumBadge, FazBadge, OdaBadge, WarnBadge } from '@/components/badges';
import { formatTl, formatTlRange } from '@/lib/price';
import { FactList, SourceNote } from '@/components/Info';
import { daysUntil, formatTr } from '@/lib/dates';
import { DONE_DURUM, estimateOf } from '@/data/selectors';
import classes from './ItemCard.module.css';

export function ItemCard({ item, onToggleDone }: { item: Item; onToggleDone: (item: Item, done: boolean) => void }) {
  const [, navigate] = useLocation();
  const done = !!item.durum && DONE_DURUM.has(item.durum);
  const est = estimateOf(item);
  const due = item.siparis_son_tarih ? daysUntil(item.siparis_son_tarih) : null;
  const dueSoon = due !== null && due <= 7 && !done && item.durum !== 'siparis' && item.durum !== 'iptal';
  const priceText = item.gercek_tl != null ? formatTl(est) : est == null ? 'Fiyat girilmedi' : formatTlRange(item.tahmini_tl_min, item.tahmini_tl_max);
  const priceLabel = item.gercek_tl != null ? 'Kayıtlı bedel' : 'Tahmini bedel';
  const confidence = item.fiyat_guven === 'dogrulandi' ? 'Fiyat doğrulandı' : item.fiyat_guven === 'varsayim' ? 'Fiyat varsayımı' : item.fiyat_guven === 'tahmini' ? 'Fiyat tahmini' : 'Fiyat teyidi girilmedi';
  return (
    <Card radius="md" p="md" className={classes.card} data-testid="item-card" data-item-id={item.id} data-done={done || undefined} data-cancelled={item.durum === 'iptal' || undefined}>
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
          <Text component="h3" className={classes.title}>{item.ad}</Text>
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
      <FactList label={`${item.ad} alım bilgileri`} tone="subtle" items={[
        { label: item.mevcut ? 'Alım durumu' : priceLabel, value: item.mevcut ? 'mevcut' : priceText, detail: item.mevcut ? 'Yeniden satın alınmayacak' : est != null ? confidence : undefined, emphasis: !item.mevcut && est != null },
        ...(item.siparis_son_tarih ? [{ label: 'Sipariş son günü', value: formatTr(item.siparis_son_tarih) }] : []),
        ...(item.teslim_tarihi ? [{ label: 'Teslim tarihi', value: formatTr(item.teslim_tarihi) }] : []),
      ]} />
      {!item.mevcut && <SourceNote label="">
        {done ? 'Teslim durumu ödeme kaydı değildir.' : 'Ödeme kaydı değildir.'}
        {done && <> <Link href="~/butce" className={classes.recordLink}>Harcama kayıtlarına git</Link></>}
      </SourceNote>}
    </Card>
  );
}
