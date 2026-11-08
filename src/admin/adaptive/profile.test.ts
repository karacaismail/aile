import {
  BASELINE_SNAPSHOT, INPUT_QUERIES, PROFILE_QUERIES, PROFILE_THRESHOLDS, adaptiveAttributes, applyAdaptiveAttributes,
  classifyProfile, readAdaptive, sameSnapshot, watchAdaptive,
} from './profile';
import { installViewport } from './testing';

// Tek üst düzey yerleşim profili: genişlik, yükseklik ve kısa kenar birlikte. Yatay telefon telefon kalır;
// dar masaüstü penceresi (fine pointer) telefon yerleşimi alır. Giriş katmanları profili değiştirmez.
const TABLE: readonly (readonly [number, number, 'phone' | 'tablet' | 'desktop'])[] = [
  [320, 480, 'phone'], [320, 568, 'phone'], [360, 640, 'phone'], [375, 667, 'phone'], [390, 844, 'phone'],
  [568, 320, 'phone'], [667, 375, 'phone'], [844, 390, 'phone'], [932, 430, 'phone'],
  [820, 1180, 'tablet'], [1180, 820, 'desktop'], [1024, 600, 'desktop'], [1440, 900, 'desktop'],
  [500, 900, 'phone'],
  // Eşik kenarları: genişlik 600/1024, kısa kenar 480.
  [599, 900, 'phone'], [600, 900, 'tablet'], [1023, 768, 'tablet'], [1024, 768, 'desktop'],
  [700, 479, 'phone'], [700, 480, 'tablet'], [1280, 479, 'phone'], [1280, 480, 'desktop'],
];

describe('classifyProfile (saf)', () => {
  it.each(TABLE)('%i×%i → %s', (width, height, profile) => {
    expect(classifyProfile({ width, height })).toBe(profile);
  });

  it('takes its thresholds from tokens (kirilimTablet, kirilimGenis, kirilimKisaKenar)', () => {
    expect(PROFILE_THRESHOLDS).toEqual({ tablet: 600, desktop: 1024, shortEdge: 480 });
    expect(PROFILE_QUERIES).toEqual({ tablet: '(min-width: 600px)', desktop: '(min-width: 1024px)', short: '(max-height: 479.98px)' });
    expect(INPUT_QUERIES).toEqual({ coarse: '(any-pointer: coarse)', fine: '(any-pointer: fine)', hover: '(any-hover: hover)' });
  });
});

describe('readAdaptive (matchMedia yolu saf sınıflayıcıyla aynı karar)', () => {
  it.each(TABLE)('%i×%i → %s', (width, height, profile) => {
    installViewport({ width, height });
    expect(readAdaptive().profile).toBe(profile);
    expect(readAdaptive().profile).toBe(classifyProfile({ width, height }));
  });

  it('a 500×900 desktop window with a fine pointer gets the phone layout and keeps its fine/hover layers', () => {
    installViewport({ width: 500, height: 900, fine: true, hover: true });
    expect(readAdaptive()).toEqual({ profile: 'phone', input: { coarse: false, fine: true, hover: true } });
  });

  it('without matchMedia falls back to the phone baseline with no input layers', () => {
    expect(readAdaptive(null)).toBe(BASELINE_SNAPSHOT);
    expect(BASELINE_SNAPSHOT).toEqual({ profile: 'phone', input: { coarse: false, fine: false, hover: false } });
  });
});

describe('input layers (eklemeli, profilden bağımsız)', () => {
  it.each([
    ['touch phone', { coarse: true, fine: false, hover: false }],
    ['mouse desktop', { coarse: false, fine: true, hover: true }],
    ['hybrid touch laptop', { coarse: true, fine: true, hover: true }],
    ['tablet with stylus', { coarse: true, fine: true, hover: false }],
    ['no pointer (keyboard/remote only)', { coarse: false, fine: false, hover: false }],
  ] as const)('%s → every matching layer at once', (_name, input) => {
    installViewport({ width: 1440, height: 900, ...input });
    expect(readAdaptive().input).toEqual(input);
  });

  it('the same viewport keeps the same profile whatever the input', () => {
    for (const input of [{ coarse: true }, { fine: true, hover: true }, { coarse: true, fine: true, hover: true }, {}]) {
      installViewport({ width: 844, height: 390, ...input });
      expect(readAdaptive().profile).toBe('phone');
      installViewport({ width: 820, height: 1180, ...input });
      expect(readAdaptive().profile).toBe('tablet');
    }
  });
});

describe('sameSnapshot / adaptiveAttributes', () => {
  it('compares profile and every layer', () => {
    const a = { profile: 'phone', input: { coarse: true, fine: false, hover: false } } as const;
    expect(sameSnapshot(a, { profile: 'phone', input: { coarse: true, fine: false, hover: false } })).toBe(true);
    expect(sameSnapshot(a, { profile: 'tablet', input: a.input })).toBe(false);
    expect(sameSnapshot(a, { profile: 'phone', input: { ...a.input, hover: true } })).toBe(false);
  });

  it('maps a snapshot to data-profile plus presence-only data-input-* attributes', () => {
    expect(adaptiveAttributes({ profile: 'tablet', input: { coarse: true, fine: false, hover: true } })).toEqual({
      'data-profile': 'tablet', 'data-input-coarse': '', 'data-input-fine': undefined, 'data-input-hover': '',
    });
  });

  it('applies the attributes to an element and removes them on cleanup', () => {
    const element = document.createElement('div');
    const cleanup = applyAdaptiveAttributes(element, { profile: 'desktop', input: { coarse: false, fine: true, hover: true } });
    expect(element.getAttribute('data-profile')).toBe('desktop');
    expect(element.hasAttribute('data-input-coarse')).toBe(false);
    expect(element.getAttribute('data-input-fine')).toBe('');
    expect(element.getAttribute('data-input-hover')).toBe('');
    cleanup();
    for (const name of ['data-profile', 'data-input-coarse', 'data-input-fine', 'data-input-hover']) expect(element.hasAttribute(name)).toBe(false);
  });
});

describe('watchAdaptive', () => {
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames[id - 1] = () => {}; });
  });
  afterEach(() => vi.restoreAllMocks());
  const runFrames = () => { const pending = frames; frames = []; for (const frame of pending) frame(0); };

  it('re-evaluates on a matchMedia change right away (one discrete threshold crossing)', () => {
    const viewport = installViewport({ width: 1440, height: 900, fine: true, hover: true });
    const seen: string[] = [];
    const stop = watchAdaptive(snapshot => seen.push(snapshot.profile));
    viewport.set({ width: 820, height: 1180 });
    expect(seen.at(-1)).toBe('tablet');
    viewport.set({ width: 844, height: 390 });
    expect(seen.at(-1)).toBe('phone');
    stop();
  });

  it('coalesces resize and orientationchange bursts into one animation frame', () => {
    installViewport({ width: 1440, height: 900 });
    const onChange = vi.fn();
    const stop = watchAdaptive(onChange);
    for (let i = 0; i < 5; i += 1) window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('orientationchange'));
    expect(onChange).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    runFrames();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ profile: 'desktop', input: { coarse: false, fine: false, hover: false } });
    stop();
  });

  it('removes every listener and cancels the pending frame on cleanup', () => {
    const viewport = installViewport({ width: 1440, height: 900 });
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const onChange = vi.fn();
    const stop = watchAdaptive(onChange);
    expect(viewport.listenerCount()).toBe(Object.keys(PROFILE_QUERIES).length + Object.keys(INPUT_QUERIES).length);
    const windowEvents = add.mock.calls.map(([type]) => type).sort();
    expect(windowEvents).toEqual(['orientationchange', 'resize']);
    window.dispatchEvent(new Event('resize'));
    expect(frames).toHaveLength(1);
    stop();
    expect(viewport.listenerCount()).toBe(0);
    expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(['orientationchange', 'resize']);
    for (const [type, listener] of add.mock.calls) expect(remove).toHaveBeenCalledWith(type, listener);
    runFrames();
    viewport.set({ width: 320, height: 568 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
