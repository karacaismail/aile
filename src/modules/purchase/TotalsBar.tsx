import { Group, Paper, SegmentedControl, Text } from '@mantine/core';
import type { Faz } from '@shared/schema';
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
}

/**
 * Faz seçici + tek satır toplam. Toplam GÖRÜNEN kümeyi toplar; daraltma, para aralığını kırpmamak için
 * önekle değil sayımla anlatılır ("3 / 7 kalem"). Uyarı sayımları (fiyatsız / karar / son tarih) hızlı çiplerde.
 */
export function TotalsBar({ faz, onFaz, totals, count, total, filtered = false }: TotalsBarProps) {
  const range = totals.priced === 0 ? 'fiyat yok' : totals.sumMin === totals.sumMax ? formatTl(totals.sumMin) : `${formatTl(totals.sumMin)}–${formatTl(totals.sumMax).replace('₺', '')}`;
  const shown = count ?? totals.count;
  const countText = filtered && total != null ? `${shown} / ${total} kalem` : `${shown} kalem`;
  return (
    <Paper className={classes.bar} px="sm" py="xs" radius={0} data-testid="totals-bar">
      <SegmentedControl
        fullWidth size="xs" value={faz} onChange={(v) => onFaz(v as Faz | 'hepsi')} aria-label="Faz"
        data={[{ value: 'hepsi', label: 'Hepsi' }, { value: '1', label: 'Önce' }, { value: '2', label: 'Yerleşme' }, { value: '3', label: 'Bebek' }]}
      />
      <Group gap="xs" wrap="wrap" align="baseline" mt="xs">
        <Text fw={700} className="tabular" size="lg" style={{ whiteSpace: 'nowrap' }} data-testid="totals-sum" data-filtered={filtered || undefined}>{range}</Text>
        {/* Ayraç sayımla aynı satırda kalır: uzun aralıkta yalnız "· N kalem" alt satıra iner */}
        <Text component="span" className="tabular" style={{ whiteSpace: 'nowrap' }}>
          <span aria-hidden>· </span>
          <span data-testid="totals-count" aria-label={filtered && total != null ? `Görünen ${shown} kalem, kapsamda ${total}` : undefined}>{countText}</span>
        </Text>
      </Group>
    </Paper>
  );
}
