import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import catalog from './catalog.json';
import { generationsFor, resolveGeneration } from './generations';

describe('model year / body gallery', () => {
  it('does not substitute another model year, market or an arbitrary transition body', () => {
    expect(resolveGeneration('unknown', 2026)).toBeNull();
    expect(resolveGeneration('toyota-corolla', 1900)).toBeNull();
    expect(resolveGeneration('toyota-corolla', NaN)).toBeNull();
    expect(resolveGeneration('toyota-rav4', 2015)).toBeNull(); // Not offered; never apply the later facelift.
    expect(resolveGeneration('toyota-corolla', 2016)).toBeNull();
    expect(resolveGeneration('toyota-corolla', 2016, 'e210')).toBeNull();
    expect(resolveGeneration('toyota-corolla', 2016, 'e180-fl')?.id).toBe('e180-fl');
  });
  it('keeps the same body within a period and changes on generation / facelift boundaries', () => {
    const models = [2015, 2017, 2020, 2026].map(y => resolveGeneration('toyota-corolla', y));
    expect(models.map(g => g?.id)).toEqual(['e180', 'e180-fl', 'e210', 'e210-fl']);
    expect(new Set(models.map(g => g?.photos.front?.src)).size).toBe(4);
    expect(resolveGeneration('toyota-corolla', 2025)?.photos.front?.src).toBe(models[3]?.photos.front?.src);
    expect(resolveGeneration('honda-accord', 2023)?.id).toBe('cv-fl'); // Turkey retained the 10th gen, not US 11th.
    expect(resolveGeneration('volkswagen-tiguan', 2023)?.id).toBe('ad1-fl'); // Not the 2024 third gen.
  });
  it('does not assign a pre-change Hilux price to the above-cap new generation', () => {
    expect(catalog.find(car => car.id === 'toyota-hilux')?.years.some(y => y.year === 2026)).toBe(false);
  });
  it.each(catalog)('$name covers every offered year with locally available, attributed images or explicit gaps', car => {
    for (const year of car.years) {
      const options = generationsFor(car.id, year.year);
      expect(options.length, `${car.id}/${year.year}`).toBeGreaterThan(0);
      for (const generation of options) {
        expect(generation.sources.length).toBeGreaterThan(0);
        expect(generation.photos.front, `${car.id}/${generation.id} front`).not.toBeNull();
        for (const photo of Object.values(generation.photos)) {
          if (!photo) continue; // Missing angle is explicit; no cross-generation fallback.
          expect(photo.author.length).toBeGreaterThan(0);
          expect(photo.license).toMatch(/CC|Public domain/);
          expect(new URL(photo.source).hostname).toBe('commons.wikimedia.org');
          expect(photo.src).toMatch(/^vehicles\/[a-zA-Z0-9/.-]+\.jpg$/);
          expect(existsSync(resolve('public', photo.src)), photo.src).toBe(true);
        }
      }
    }
  });
});
