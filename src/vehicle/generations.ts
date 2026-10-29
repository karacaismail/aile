import data from './generations.json';

export type PhotoView = 'front' | 'rear' | 'interior';
export interface VehiclePhoto {
  src: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  source: string;
}
export interface VehicleGeneration {
  id: string;
  fromYear: number;
  toYear: number;
  label: string;
  sources: { label: string; url: string }[];
  photos: Record<PhotoView, VehiclePhoto | null>;
}
const generations: Record<string, VehicleGeneration[]> = data;

/** Model years can overlap at a launch. Never fall back to another year/market. */
export function generationsFor(model: string, year: number): VehicleGeneration[] {
  if (!Number.isInteger(year)) return [];
  return (generations[model] ?? []).filter(g => year >= g.fromYear && year <= g.toYear);
}

export function resolveGeneration(model: string, year: number, selected?: string): VehicleGeneration | null {
  const options = generationsFor(model, year);
  if (options.length === 1) return options[0];
  return options.find(g => g.id === selected) ?? null;
}
