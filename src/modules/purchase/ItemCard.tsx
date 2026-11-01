import { Card, Checkbox, Text, Box } from '@mantine/core';
import { ClockCountdownIcon } from '@phosphor-icons/react/dist/csr/ClockCountdown';
import { QuestionIcon } from '@phosphor-icons/react/dist/csr/Question';
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House';
import { Link, useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { DurumBadge, WarnBadge } from '@/components/badges';
import { formatTl, formatTlRange } from '@/lib/price';
import { FactList } from '@/components/Info';
import { daysUntil, formatTr } from '@/lib/dates';
import { DONE_DURUM, estimateOf } from '@/data/selectors';
import classes from './ItemCard.module.css';

/**
 * One record, one reading order: identity (name) → status and scope → what needs attention →
 * amount with its qualification and the payment distinction in the same group → completion.
 * Status is the only coloured tag; phase, room and quantity are plain scope text.
 */
export function ItemCard({ item, onToggleDone }: { item: Item; onToggleDone: (item: Item, done: boolean) => void }) {
  const [, navigate] = useLocation();
  const done = !!item.durum && DONE_DURUM.has(item.durum);
  const est = estimateOf(item);
  const due = item.siparis_son_tarih ? daysUntil(item.siparis_son_tarih) : null;
  const dueSoon = due !== null && due <= 7 && !done && item.durum !== 'siparis' && item.durum !== 'iptal';
  const priceText = item.gercek_tl != null ? formatTl(est) : est == null ? 'Fiyat girilmedi' : formatTlRange(item.tahmini_tl_min, item.tahmini_tl_max);
  const priceLabel = item.gercek_tl != null ? 'Kayıtlı bedel' : 'Tahmini bedel';
  const confidence = item.fiyat_guven === 'dogrulandi' ? 'Fiyat doğrulandı' : item.fiyat_guven === 'varsayim' ? 'Fiyat varsayımı' : item.fiyat_guven === 'tahmini' ? 'Fiyat tahmini' : 'Fiyat teyidi girilmedi';
  const quantity = item.adet && (item.adet > 1 || (item.birim && item.birim !== 'adet')) ? `${item.adet} ${item.birim ?? 'adet'}` : null;
  const scope = [label('faz', item.faz), label('oda', item.oda), quantity].filter(Boolean);
  const attention = item.mevcut || item.karar_bekliyor || dueSoon;
  const open = () => navigate(`~/satinalma/${item.id}`);
  return (
    <Card radius="md" p="sm" className={classes.card} data-testid="item-card" data-item-id={item.id} data-done={done || undefined} data-cancelled={item.durum === 'iptal' || undefined}>
      <div className={classes.identity}>
        {/* Completion keeps its place beside the name, with a visible caption instead of an unnamed circle. */}
        <label className={classes.complete} onClick={(e) => e.stopPropagation()}>
          <Checkbox size="md" radius="xl" checked={done} aria-label={`${item.ad} alındı`} disabled={item.durum === 'iptal'}
            onChange={(e) => onToggleDone(item, e.currentTarget.checked)} />
          <span aria-hidden="true">Alındı</span>
        </label>
        <Box className={classes.linkArea} onClick={open} role="link" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') open(); }} aria-label={`${item.ad} detayı`}>
          <Text component="h3" className={classes.title}>{item.ad}</Text>
        </Box>
      </div>
      <div className={classes.meta}>
      <div className={classes.status} role="group" aria-label="Durum ve kapsam">
        <DurumBadge value={item.durum} />
        {scope.map((part, index) => <span key={index} className={classes.scope}>{part}</span>)}
      </div>
      {attention && <div className={classes.attention} role="group" aria-label="Dikkat">
        {item.mevcut && <WarnBadge tone="ok" leftSection={<HouseIcon size={10} aria-hidden />}>Elimizde</WarnBadge>}
        {item.karar_bekliyor && <WarnBadge tone="warn" leftSection={<QuestionIcon size={10} aria-hidden />}>Karar bekliyor</WarnBadge>}
        {dueSoon && <WarnBadge tone={due! < 0 ? 'danger' : 'warn'} leftSection={<ClockCountdownIcon size={10} aria-hidden />}>
          {due! < 0 ? `Sipariş günü ${-due!} gün geçti` : due === 0 ? 'Sipariş günü bugün' : `Siparişe ${due} gün`}
        </WarnBadge>}
      </div>}
      </div>
      <div className={classes.facts} role="group" aria-label={`${item.ad} alım bilgileri`}>
        <FactList label="Bedel ve tarihler" items={[
          { label: item.mevcut ? 'Alım durumu' : priceLabel, value: item.mevcut ? 'mevcut' : priceText, detail: item.mevcut ? 'Yeniden satın alınmayacak' : est != null ? confidence : undefined, emphasis: !item.mevcut && est != null },
          ...(item.siparis_son_tarih ? [{ label: 'Sipariş son günü', value: formatTr(item.siparis_son_tarih) }] : []),
          ...(item.teslim_tarihi ? [{ label: 'Teslim tarihi', value: formatTr(item.teslim_tarihi) }] : []),
        ]} />
        {!item.mevcut && est == null && <Link href={`~/satinalma/${item.id}/fiyat`} className={classes.recordLink}>Fiyat ekle</Link>}
        {!item.mevcut && <p className={classes.payment}>
          {done ? 'Teslim durumu ödeme kaydı değildir.' : 'Ödeme kaydı değildir.'}
          {done && <> <Link href="~/butce" className={classes.recordLink}>Harcama kayıtlarına git</Link></>}
        </p>}
      </div>
    </Card>
  );
}
