import type { Grid } from '../dashboard/data';

export const TIMELINE_HEADERS = ['ID', 'Tarih', 'Sıra', 'Tür', 'Adım', 'Kaynak', 'Nakit değişimi', 'Denizbank değişimi', 'İşbank değişimi', 'Kalan nakit', 'Denizbank borcu', 'İşbank borcu', 'Toplam kart borcu', 'Tarih niteliği', 'Açıklama', 'Mutabakat farkı', 'Dönem'] as const;
export type TimelineTable = { labels: string[]; rows: Grid };
