import type { ReactNode } from 'react';
import { Group, Paper, SegmentedControl, Text } from '@mantine/core';
import { FAZ, label, type Faz } from '@shared/schema';
import type { Totals } from '@/data/selectors';
import { formatTl } from '@/lib/price';
import classes from './TotalsBar.module.css';

export interface TotalsBarProps {
  faz: Faz | 'hepsi';
  onFaz: (f: Faz | 'hepsi') => void;
  /** Görünen kümenin toplamı (faz + filtre + arama). */
  totals: Totals;
  /** Görünen kart sayısı (mevcut/iptal dahil; toplamla aynı küme). */
  count?: number;
  /** Filtre ya da arama kümeyi daralttıysa: fazdaki toplam kalem sayısı → "görünen / kapsam kalem". */
  total?: number;
  filtered?: boolean;
  /** Görünüm seçicisi: telefonda faz seçicisiyle aynı kaydırılabilir satırda durur. */
  views?: ReactNode;
}

/**
 * Faz seçici + tek satır toplam. Toplam GÖRÜNEN kümeyi toplar; daraltma, para aralığını kırpmamak için
 * önekle değil sayımla anlatılır ("3 / 7 kalem"). Uyarı sayımları (fiyatsız / karar / son tarih) hızlı çiplerde.
 */
export function TotalsBar({ faz, onFaz, totals, count, total, filtered = false, views }: TotalsBarProps) {
  const range = totals.priced === 0 ? 'fiyat yok' : totals.sumMin === totals.sumMax ? formatTl(totals.sumMin) : `${formatTl(totals.sumMin)}–${formatTl(totals.sumMax).replace('₺', '')}`;
  const shown = count ?? totals.count;
  const countText = filtered && total != null ? `${shown} / ${total} kalem` : `${shown} kalem`;
  return (
    <Paper className={classes.bar} radius={0} data-testid="totals-bar">
      {/* Klavyeyle gelen seçim kaydırılabilir satırda görünür kalır; radyo girdisi kapsayıcının köşesinde durur. */}
      <div className={classes.selectors} onFocusCapture={(event) => event.target.nextElementSibling?.scrollIntoView({ block: 'nearest', inline: 'nearest' })}>
        {views}
        <div className={classes.faz}>
          <SegmentedControl
            fullWidth size="xs" value={faz} onChange={(v) => onFaz(v as Faz | 'hepsi')} aria-label="Faz"
            data={[{ value: 'hepsi', label: 'Hepsi' }, ...FAZ.map(value => ({ value, label: label('faz', value) }))]}
          />
        </div>
      </div>
      <div className={classes.summary} aria-describedby="purchase-total-scope">
      <Text component="p" fw={500}>Görünen alım bedeli</Text>
      {faz !== 'hepsi' && <span className={classes.phase} data-testid="totals-phase"><span aria-hidden>· </span>{label('faz', faz)}</span>}
      <Group gap="xs" wrap="wrap" align="baseline">
        <Text fw={700} className="tabular" size="lg" style={{ whiteSpace: 'nowrap' }} data-testid="totals-sum" data-filtered={filtered || undefined}>{range}</Text>
        {/* Ayraç sayımla aynı satırda kalır: uzun aralıkta yalnız "· N kalem" alt satıra iner */}
        <Text component="span" className="tabular" style={{ whiteSpace: 'nowrap' }}>
          <span aria-hidden>· </span>
          <span data-testid="totals-count" aria-label={filtered && total != null ? `Görünen ${shown} kalem, kapsamda ${total}` : undefined}>{countText}</span>
        </Text>
      </Group>
      </div>
    </Paper>
  );
}
