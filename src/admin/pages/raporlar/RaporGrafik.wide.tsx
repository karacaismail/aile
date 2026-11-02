import type { ComponentProps } from 'react';
import { designTokens } from '../../../design/tokens.ts';
import { Chart } from '../../ui/Chart';

// Raporlar grafiği — yalnız geniş profil (tablet/masaüstü). lazyWide('raporlar-grafik') ile tembel gelir; telefon bu
// modülü ve ECharts'ı hiç indirmez, aynı değerleri akordeon tablodan okur (grafik tek bilgi kaynağı değildir).
// Tasarım: plan acik-mavi, gerçek eylem çubukları; değerler grafiğin altındaki tabloda. Plan ve gerçek ayrı seridir.
// Eksik değer (Henüz yok, Bilinmiyor, birden çok para birimi) null'dur: sıfır çizilmez, boşluk kalır.

type ChartOption = ComponentProps<typeof Chart>['option'];

export type RaporGrafikTone = 'plan' | 'gercek' | 'sayim';
export interface RaporGrafikSeries {
  name: string;
  tone: RaporGrafikTone;
  /** Ondalık metin ("8500.00") ya da sayım; null = değer yok (çizilmez). */
  values: readonly (string | number | null)[];
}
export interface RaporGrafikProps {
  categories: readonly string[];
  series: readonly RaporGrafikSeries[];
  /** Grafiğin ne gösterdiği ve değerlerin nerede olduğu. */
  ariaLabel: string;
  /** Görünür kısa açıklama; değerler aşağıdaki tablodadır. */
  description: string;
}

const RENK: Record<RaporGrafikTone, string> = {
  plan: designTokens.acikMavi,
  gercek: designTokens.eylem,
  sayim: designTokens.eylem,
};

/** Yalnız çizim için sayıya çevrilir; hesap ve toplam modelde kesin ondalıkla yapılmıştır. */
const sayi = (value: string | number | null) => (value === null ? null : Number(value));

export default function RaporGrafik({ categories, series, ariaLabel, description }: RaporGrafikProps) {
  const option: ChartOption = {
    xAxis: { type: 'category', data: [...categories] },
    yAxis: { type: 'value' },
    legend: { data: series.map((item) => item.name) },
    series: series.map((item) => ({ name: item.name, type: 'bar', color: RENK[item.tone], data: item.values.map(sayi) })),
  };
  return <Chart option={option} ariaLabel={ariaLabel} description={description} className="aile-raporlar__grafik" />;
}
