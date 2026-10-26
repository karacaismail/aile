import { useMemo } from 'react';
import { Switch, Text } from '@mantine/core';
import type { Item } from '@shared/schema';
import { DURUM_COLOR } from '@/components/badges';
import { FilterSection } from '@/components/filter/FilterSection';
import { FacetChips } from '@/components/filter/FacetChips';
import { FilterChip } from '@/components/filter/FilterChip';
import { DEFAULT_FILTERS, countWith, optionCounts, type PurchaseFilters, type QuickKey } from '@/data/selectors';

/** Şeritteki sabit hızlı çipler: kısa etiket, erişilebilir ad = görünen metin. Sıra sabit (kas hafızası). */
export const QUICK_CHIPS: ReadonlyArray<{ key: QuickKey; label: string }> = [
  { key: 'hideDone', label: 'Alınacaklar' },
  { key: 'fiyatsiz', label: 'Fiyatsız' },
  { key: 'kararBekliyor', label: 'Karar bekliyor' },
  { key: 'siparisYakin', label: 'Son tarih' },
];

export interface SectionsProps {
  items: readonly Item[];
  filters: PurchaseFilters;
  onChange: (next: PurchaseFilters) => void;
  now?: Date;
}

export function useQuickCounts(items: readonly Item[], f: PurchaseFilters, now: Date) {
  return useMemo(() => {
    const out = {} as Record<QuickKey, number>;
    for (const q of QUICK_CHIPS) out[q.key] = countWith(items, f, { [q.key]: true }, now);
    // "Sipariş": diğer filtreler altında sipariş durumundaki kalem sayısı (sayfadaki Durum › Sipariş ile aynı sayı)
    const siparis = countWith(items, f, { durum: ['siparis'] }, now);
    return { ...out, siparis };
  }, [items, f, now]);
}

/** Hızlı çipler (şeritte ve sayfanın "Hızlı" bölümünde aynı bileşen, aynı durum, aynı sayım). */
export function QuickChips({ items, filters, onChange, now = new Date(), testIdPrefix = 'quick-chip' }: SectionsProps & { testIdPrefix?: string }) {
  const counts = useQuickCounts(items, filters, now);
  const siparisOn = filters.durum.includes('siparis');
  const toggleSiparis = (on: boolean) => onChange({ ...filters, durum: on ? [...filters.durum.filter((d) => d !== 'siparis'), 'siparis'] : filters.durum.filter((d) => d !== 'siparis') });
  return (
    <>
      {QUICK_CHIPS.map((q) => (
        <FilterChip key={q.key} label={q.label} count={counts[q.key]} checked={filters[q.key]} disabled={!filters[q.key] && counts[q.key] === 0}
          onChange={(on) => onChange({ ...filters, [q.key]: on })} data-testid={`${testIdPrefix}-${q.key}`} />
      ))}
      <FilterChip label="Sipariş" count={counts.siparis} checked={siparisOn} disabled={!siparisOn && counts.siparis === 0} dot={DURUM_COLOR.siparis}
        onChange={toggleSiparis} data-testid={`${testIdPrefix}-siparis`} />
    </>
  );
}

/** Sayfa bölümleri: Hızlı → Oda → Kategori → Durum → Diğer (iş sıklığına göre). */
export function PurchaseFilterSections({ items, filters, onChange, now = new Date() }: SectionsProps) {
  const oda = useMemo(() => optionCounts(items, filters, 'oda', now), [items, filters, now]);
  const kategori = useMemo(() => optionCounts(items, filters, 'kategori', now), [items, filters, now]);
  // Durum: Alınacaklar açıkken de kapalı durumlar seçilebilsin (seçilince o durum görünür)
  const durum = useMemo(() => optionCounts(items, { ...filters, hideDone: false }, 'durum', now), [items, filters, now]);
  const set = <K extends keyof PurchaseFilters>(k: K, v: PurchaseFilters[K]) => onChange({ ...filters, [k]: v });
  const quickActive = QUICK_CHIPS.filter((q) => filters[q.key]).length + (filters.durum.includes('siparis') ? 1 : 0);
  return (
    <>
      <FilterSection title="Hızlı" selectedCount={quickActive}
        onClear={() => onChange({ ...filters, hideDone: false, fiyatsiz: false, kararBekliyor: false, siparisYakin: false, durum: filters.durum.filter((d) => d !== 'siparis') })}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <QuickChips items={items} filters={filters} onChange={onChange} now={now} testIdPrefix="sheet-chip" />
        </div>
      </FilterSection>
      <FilterSection title="Oda" selectedCount={filters.oda.length} onClear={() => set('oda', [])}>
        {oda.size === 0 && filters.oda.length === 0 ? <Text>Bu filtreyle seçenek kalmadı.</Text>
          : <FacetChips field="oda" options={oda} value={filters.oda} onChange={(v) => set('oda', v)} testIdPrefix="facet-oda" />}
      </FilterSection>
      <FilterSection title="Kategori" selectedCount={filters.kategori.length} onClear={() => set('kategori', [])}>
        {kategori.size === 0 && filters.kategori.length === 0 ? <Text>Bu filtreyle seçenek kalmadı.</Text>
          : <FacetChips field="kategori" options={kategori} value={filters.kategori} onChange={(v) => set('kategori', v)} testIdPrefix="facet-kategori" />}
      </FilterSection>
      <FilterSection title="Durum" selectedCount={filters.durum.length} onClear={() => set('durum', [])}>
        <FacetChips field="durum" options={durum} value={filters.durum} onChange={(v) => set('durum', v)} dotOf={(v) => DURUM_COLOR[v]} testIdPrefix="facet-durum" />
      </FilterSection>
      <FilterSection title="Diğer" selectedCount={filters.mevcutDahil ? 1 : 0} onClear={() => set('mevcutDahil', false)} hint="Mevcut eşyalar toplama girmez.">
        <Switch label="Mevcut eşyaları da göster" checked={filters.mevcutDahil} onChange={(e) => set('mevcutDahil', e.currentTarget.checked)} />
      </FilterSection>
    </>
  );
}

/** Faz ve arama dışındaki her şeyi varsayılana döndürür. */
export function clearedFilters(f: PurchaseFilters): PurchaseFilters {
  return { ...DEFAULT_FILTERS, faz: f.faz, q: f.q };
}
