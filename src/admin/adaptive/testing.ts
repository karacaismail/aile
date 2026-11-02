import { vi } from 'vitest';

// Yalnız testler içe aktarır (uygulama kodu değil). Görünüm alanını ve giriş yeteneklerini taklit eden matchMedia:
// min/max-width, min/max-height, orientation, (any-)pointer, (any-)hover ve prefers-reduced-motion sorgularını
// verilen değerlere göre çözer; set() değişen sorgular için 'change', pencere için 'resize' yayar.
// Emülasyon gerçek cihaz değildir: yalnız profil/katman mantığını sınar.
export interface ViewportSpec {
  width: number;
  height: number;
  /** (any-pointer: coarse) — dokunmatik. */
  coarse?: boolean;
  /** (any-pointer: fine) — fare/iz dörtgeni/kalem. */
  fine?: boolean;
  /** (any-hover: hover). */
  hover?: boolean;
  reducedMotion?: boolean;
}

type Spec = Required<ViewportSpec>;
type Listener = (event: { matches: boolean; media: string }) => void;
interface FakeQuery { media: string; matches: boolean; listeners: Set<Listener> }

const withDefaults = (spec: ViewportSpec): Spec => ({ coarse: false, fine: false, hover: false, reducedMotion: false, ...spec });

function evaluateFeature(feature: string, spec: Spec): boolean {
  const match = feature.match(/^\(\s*([a-z-]+)\s*(?::\s*([^)]+?))?\s*\)$/);
  if (!match) return false;
  const name = match[1];
  const raw = (match[2] ?? '').trim();
  const px = Number.parseFloat(raw);
  const primaryPointer = spec.fine ? 'fine' : spec.coarse ? 'coarse' : 'none';
  switch (name) {
    case 'min-width': return spec.width >= px;
    case 'max-width': return spec.width <= px;
    case 'min-height': return spec.height >= px;
    case 'max-height': return spec.height <= px;
    case 'orientation': return raw === (spec.width > spec.height ? 'landscape' : 'portrait');
    case 'any-pointer': return raw === 'coarse' ? spec.coarse : raw === 'fine' ? spec.fine : raw === 'none' ? !spec.coarse && !spec.fine : false;
    case 'pointer': return raw === primaryPointer;
    case 'any-hover':
    case 'hover': return raw === 'hover' ? spec.hover : raw === 'none' ? !spec.hover : false;
    case 'prefers-reduced-motion': return raw === 'reduce' ? spec.reducedMotion : raw === 'no-preference' ? !spec.reducedMotion : false;
    default: return false;
  }
}

/** "a, b" → herhangi biri; "x and y" → hepsi. Bilinmeyen özellik false döner. */
export function evaluateMedia(media: string, spec: ViewportSpec): boolean {
  const full = withDefaults(spec);
  return media.split(',').some(part => part.trim().split(/\s+and\s+/).every(feature => evaluateFeature(feature.trim(), full)));
}

function setInnerSize(spec: Spec) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: spec.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: spec.height });
}

/** window.matchMedia'yı verilen görünüm alanına göre kurar. set() içinde act() çağıran taraftadır. */
export function installViewport(initial: ViewportSpec) {
  let spec = withDefaults(initial);
  const queries: FakeQuery[] = [];
  setInnerSize(spec);
  window.matchMedia = vi.fn().mockImplementation((media: string) => {
    const query: FakeQuery = { media, matches: evaluateMedia(media, spec), listeners: new Set() };
    queries.push(query);
    const add = (_type: string, listener: Listener) => { query.listeners.add(listener); };
    const remove = (_type: string, listener: Listener) => { query.listeners.delete(listener); };
    return {
      get matches() { return query.matches; },
      media,
      onchange: null,
      addEventListener: add,
      removeEventListener: remove,
      addListener: (listener: Listener) => add('change', listener),
      removeListener: (listener: Listener) => remove('change', listener),
      dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
  return {
    get spec(): Spec { return spec; },
    /** Görünüm/giriş değişir: önce 'resize' (tarayıcı sırası), sonra eşiği geçen sorgular için 'change'. */
    set(next: Partial<ViewportSpec>) {
      spec = withDefaults({ ...spec, ...next });
      setInnerSize(spec);
      window.dispatchEvent(new Event('resize'));
      for (const query of queries) {
        const matches = evaluateMedia(query.media, spec);
        if (matches === query.matches) continue;
        query.matches = matches;
        for (const listener of [...query.listeners]) listener({ matches, media: query.media });
      }
    },
    /** Açık matchMedia 'change' dinleyicisi sayısı (sızıntı denetimi). */
    listenerCount: () => queries.reduce((sum, query) => sum + query.listeners.size, 0),
  };
}
