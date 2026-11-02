/**
 * e2e/admin-detectors.ts birim testleri (jsdom). jsdom yerleşim ve sözde öğe stili hesaplamadığı için dedektörlere
 * sahte bir ortam (DetectorEnv) verilir: stil, kutu, görünüm alanı, media ve kaydırma ölçüleri test içinde tanımlanır.
 * Her kural için ihlal enjekte edilir (yakalanmalı) ve uyumlu örnek verilir (temiz kalmalı). Son blok, dedektörlerin
 * modül kapsamına bağlı olmadığını (page.evaluate'e kaynak metin olarak verilebildiğini) doğrular.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accentEdgeViolations,
  detectorScript,
  focusRingViolations,
  motionViolations,
  overflowViolations,
  selfCheckScript,
  smallTextViolations,
  type DetectorEnv,
} from '../../e2e/admin-detectors';

type Rect = { left: number; top: number; width: number; height: number };
type Css = Record<string, string>;

const DEFAULTS: Css = {
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  position: 'static',
  'outline-style': 'none',
  'outline-width': '0px',
  'outline-color': 'rgb(0, 0, 0)',
  'box-shadow': 'none',
  'background-color': 'rgba(0, 0, 0, 0)',
  'font-size': '16px',
  'white-space': 'normal',
  'text-overflow': 'clip',
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  '-webkit-line-clamp': 'none',
  clip: 'auto',
  'clip-path': 'none',
  'transition-property': 'all',
  'transition-duration': '0s',
  'transition-timing-function': 'ease',
  'animation-name': 'none',
  'animation-duration': '0s',
  'animation-timing-function': 'ease',
  top: 'auto',
  right: 'auto',
  bottom: 'auto',
  left: 'auto',
  width: 'auto',
  height: 'auto',
};
for (const side of ['top', 'right', 'bottom', 'left']) {
  DEFAULTS[`border-${side}-width`] = '0px';
  DEFAULTS[`border-${side}-style`] = 'none';
  DEFAULTS[`border-${side}-color`] = 'rgb(32, 58, 81)';
}
for (const corner of ['top-left', 'top-right', 'bottom-right', 'bottom-left']) DEFAULTS[`border-${corner}-radius`] = '0px';

/** Sahte ortam: stil ve kutular öğe başına kaydedilir; sözde öğede varsayılan content 'none'. */
function makeEnv(init: { viewport?: { width: number; height: number }; media?: Record<string, boolean> } = {}) {
  const styles = new Map<Element, Map<string, Css>>();
  const rects = new Map<Element, Rect>();
  const scrolls = new Map<Element, { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number }>();
  const viewport = init.viewport ?? { width: 375, height: 800 };
  const media = init.media ?? {};
  const env: DetectorEnv = {
    style(el, pseudo) {
      const own = styles.get(el)?.get(pseudo ?? '') ?? {};
      const base: Css = pseudo ? { ...DEFAULTS, content: 'none' } : { ...DEFAULTS, content: 'normal' };
      const all = { ...base, ...own };
      return { getPropertyValue: (name: string) => all[name] ?? '' };
    },
    rect(el) {
      const r = rects.get(el) ?? { left: 0, top: 0, width: 100, height: 20 };
      return { ...r, right: r.left + r.width, bottom: r.top + r.height };
    },
    viewport: () => viewport,
    media: (q) => Boolean(media[q]),
    scroll(el) {
      const r = rects.get(el) ?? { left: 0, top: 0, width: 100, height: 20 };
      return scrolls.get(el) ?? { scrollWidth: r.width, clientWidth: r.width, scrollHeight: r.height, clientHeight: r.height };
    },
  };
  const css = (el: Element, values: Css, pseudo = '') => {
    const byPseudo = styles.get(el) ?? new Map<string, Css>();
    byPseudo.set(pseudo, { ...(byPseudo.get(pseudo) ?? {}), ...values });
    styles.set(el, byPseudo);
    return el;
  };
  const box = (el: Element, r: Rect) => (rects.set(el, r), el);
  const scroll = (el: Element, s: { scrollWidth: number; clientWidth: number; scrollHeight?: number; clientHeight?: number }) =>
    (scrolls.set(el, { scrollHeight: 20, clientHeight: 20, ...s }), el);
  return { env, css, box, scroll };
}

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="kok">${html}</div>`;
  return document.getElementById('kok')!;
}
const $ = (sel: string) => document.querySelector(sel)!;

afterEach(() => {
  document.body.innerHTML = '';
  delete document.documentElement.dataset.keyboard;
  vi.restoreAllMocks();
});

const LINE: Css = { content: '""', position: 'absolute', height: '3px', width: '120px', bottom: '-7px', left: '0px', right: '0px', 'background-color': 'rgb(50, 107, 148)' };

describe('focusRingViolations', () => {
  it('klavye modunda kontrol genişliğinde, 4 px altta tek 3 px çizgi temizdir', () => {
    mount('<button id="b">Alım ekle</button>');
    const { env, css, box } = makeEnv();
    box($('#b'), { left: 10, top: 10, width: 120, height: 44 });
    css($('#b'), LINE, '::after');
    expect(focusRingViolations({ target: '#b', keyboard: true, env })).toEqual([]);
  });

  it('outline halkasını yakalar', () => {
    mount('<button id="b">Alım ekle</button>');
    const { env, css, box } = makeEnv();
    box($('#b'), { left: 10, top: 10, width: 120, height: 44 });
    css($('#b'), { 'outline-style': 'solid', 'outline-width': '2px' });
    css($('#b'), LINE, '::after');
    const out = focusRingViolations({ target: '#b', keyboard: true, env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/outline/);
  });

  it('çevreleyen box-shadow halkasını yakalar, yükseltme gölgesini halka saymaz', () => {
    mount('<button id="b">Kaydet</button><button id="c">Vazgeç</button>');
    const { env, css, box } = makeEnv();
    for (const id of ['#b', '#c']) {
      box($(id), { left: 0, top: 0, width: 120, height: 44 });
      css($(id), LINE, '::after');
    }
    css($('#b'), { 'box-shadow': 'rgb(50, 107, 148) 0px 0px 0px 2px' });
    css($('#c'), { 'box-shadow': 'rgba(27, 62, 85, 0.18) 0px 2px 4px 0px, rgba(27, 62, 85, 0.14) 0px 8px 20px 0px' });
    expect(focusRingViolations({ target: '#b', keyboard: true, env })[0]).toMatch(/box-shadow/);
    expect(focusRingViolations({ target: '#c', keyboard: true, env })).toEqual([]);
  });

  it('kontrol sarmalayıcısındaki (affix) halkayı yakalar; birden çok odaklanabilir içeren kapsayıcıya bakmaz', () => {
    mount('<section id="kart"><span id="sar"><input id="i" aria-label="Ara"></span><button>Uygula</button></section>');
    const { env, css, box } = makeEnv();
    box($('#sar'), { left: 0, top: 0, width: 200, height: 44 });
    css($('#sar'), { ...LINE, width: '200px' }, '::after');
    css($('#kart'), { 'box-shadow': 'rgb(220, 228, 235) 0px 0px 0px 1px' });
    expect(focusRingViolations({ target: '#i', keyboard: true, env })).toEqual([]);
    css($('#sar'), { 'box-shadow': 'rgba(50, 107, 148, 0.2) 0px 0px 0px 2px' });
    expect(focusRingViolations({ target: '#i', keyboard: true, env }).join()).toMatch(/box-shadow/);
  });

  it('sözde öğe ile çizilen çevreleyen çerçeveyi yakalar', () => {
    mount('<a id="a" href="#/x">Ayrıntı</a>');
    const { env, css, box } = makeEnv();
    box($('#a'), { left: 0, top: 0, width: 120, height: 44 });
    css($('#a'), LINE, '::after');
    css($('#a'), { content: '""', position: 'absolute', 'border-top-width': '2px', 'border-right-width': '2px', 'border-bottom-width': '2px', 'border-left-width': '2px', 'border-top-style': 'solid', 'border-right-style': 'solid', 'border-bottom-style': 'solid', 'border-left-style': 'solid' }, '::before');
    expect(focusRingViolations({ target: '#a', keyboard: true, env }).join()).toMatch(/çerçeve/);
  });

  it('klavye modunda görünür gösterge yoksa (görünmez klavye odağı) FAIL verir', () => {
    mount('<button id="b">Kaydet</button>');
    const { env, box } = makeEnv();
    box($('#b'), { left: 0, top: 0, width: 120, height: 44 });
    expect(focusRingViolations({ target: '#b', keyboard: true, env }).join()).toMatch(/gösterge yok/);
  });

  it('yanlış konum veya genişlikteki çizgiyi yakalar; satırda alt kenar (bottom 0) kabul edilir', () => {
    mount('<button id="b">Kaydet</button><table><tbody><tr id="r" tabindex="0"><td>Koltuk</td></tr></tbody></table>');
    const { env, css, box } = makeEnv();
    box($('#b'), { left: 0, top: 0, width: 120, height: 44 });
    css($('#b'), { ...LINE, bottom: '0px' }, '::after');
    expect(focusRingViolations({ target: '#b', keyboard: true, env }).join()).toMatch(/konum/);
    css($('#b'), { ...LINE, width: '60px' }, '::after');
    expect(focusRingViolations({ target: '#b', keyboard: true, env }).join()).toMatch(/genişlik/);
    box($('#r'), { left: 0, top: 0, width: 600, height: 56 });
    css($('#r'), { ...LINE, width: '600px', bottom: '0px' }, '::after');
    expect(focusRingViolations({ target: '#r', keyboard: true, env })).toEqual([]);
  });

  it('klavye modu kapalıyken (işaretçi) gösterge görünürse yakalar', () => {
    mount('<button id="b">Kaydet</button>');
    const { env, css, box } = makeEnv();
    box($('#b'), { left: 0, top: 0, width: 120, height: 44 });
    css($('#b'), LINE, '::after');
    expect(focusRingViolations({ target: '#b', keyboard: false, env }).join()).toMatch(/klavye modu dışında/);
  });

  it('forced-colors istisnası: yalnız klavye modunda 2px solid CanvasText outline kabul edilir', () => {
    mount('<button id="b">Kaydet</button>');
    const forced = makeEnv({ media: { '(forced-colors: active)': true } });
    forced.box($('#b'), { left: 0, top: 0, width: 120, height: 44 });
    forced.css($('#b'), { 'outline-style': 'solid', 'outline-width': '2px', 'outline-color': 'canvastext' });
    expect(focusRingViolations({ target: '#b', keyboard: true, env: forced.env })).toEqual([]);
    const normal = makeEnv();
    normal.box($('#b'), { left: 0, top: 0, width: 120, height: 44 });
    normal.css($('#b'), { 'outline-style': 'solid', 'outline-width': '2px' });
    normal.css($('#b'), LINE, '::after');
    expect(focusRingViolations({ target: '#b', keyboard: true, env: normal.env }).join()).toMatch(/outline/);
  });

  it('hedef verilmezse document.activeElement ve html[data-keyboard] kullanılır', () => {
    mount('<button id="b">Kaydet</button>');
    const { env, box } = makeEnv();
    box($('#b'), { left: 0, top: 0, width: 120, height: 44 });
    (document.getElementById('b') as HTMLButtonElement).focus();
    document.documentElement.dataset.keyboard = 'true';
    expect(focusRingViolations({ env }).join()).toMatch(/gösterge yok/);
    document.documentElement.dataset.keyboard = 'false';
    expect(focusRingViolations({ env })).toEqual([]);
  });
});

describe('smallTextViolations', () => {
  it('14 px altındaki görünür metni yakalar, 14 px temizdir', () => {
    mount('<p id="k">Fiyat yok</p><p id="t">Henüz yok</p>');
    const { env, css } = makeEnv();
    css($('#k'), { 'font-size': '13px' });
    css($('#t'), { 'font-size': '14px' });
    const out = smallTextViolations({ root: '#kok', env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/Fiyat yok/);
    expect(out[0]).toMatch(/13/);
  });

  it('gizli ve görsel olarak gizli (sr-only) metni saymaz', () => {
    mount('<p id="g">Gizli</p><span id="sr">Ekran okuyucu</span>');
    const { env, css, box } = makeEnv();
    css($('#g'), { 'font-size': '10px', display: 'none' });
    css($('#sr'), { 'font-size': '10px', position: 'absolute' });
    box($('#sr'), { left: 0, top: 0, width: 1, height: 1 });
    expect(smallTextViolations({ root: '#kok', env })).toEqual([]);
  });

  it('form kontrolü değerini ve sözde öğe metnini de ölçer', () => {
    mount('<input id="i" value="8.500,00" aria-label="Tutar"><span id="r">Durum</span>');
    const { env, css } = makeEnv();
    css($('#i'), { 'font-size': '12px' });
    css($('#r'), { content: '"Yeni"', 'font-size': '12px' }, '::after');
    const out = smallTextViolations({ root: '#kok', env }).join('\n');
    expect(out).toMatch(/input/);
    expect(out).toMatch(/Yeni/);
  });

  it('min parametresine uyar', () => {
    mount('<p id="t">Metin</p>');
    const { env, css } = makeEnv();
    css($('#t'), { 'font-size': '14px' });
    expect(smallTextViolations({ root: '#kok', env, min: 16 })).toHaveLength(1);
  });
});

const solid = (side: string, width: string, color: string): Css => ({ [`border-${side}-width`]: width, [`border-${side}-style`]: 'solid', [`border-${side}-color`]: color });
const radius = (r: string): Css => ({ 'border-top-left-radius': r, 'border-top-right-radius': r, 'border-bottom-right-radius': r, 'border-bottom-left-radius': r });

describe('accentEdgeViolations', () => {
  it('radiuslu kutuda tek kenar renkli şeridi yakalar', () => {
    mount('<div id="k">Kart</div>');
    const { env, css } = makeEnv();
    css($('#k'), { ...radius('12px'), ...solid('left', '4px', 'rgb(50, 107, 148)') });
    const out = accentEdgeViolations({ root: '#kok', env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/sol/);
  });

  it('dört kenarı eşit kenarlık ve radiussuz şerit temizdir; şeridin değmediği köşelerde radius serbesttir', () => {
    mount('<div id="a">Alan</div><div id="b">Düz</div><div id="c">Üst</div>');
    const { env, css } = makeEnv();
    css($('#a'), { ...radius('8px'), ...solid('top', '1px', 'rgb(82, 105, 124)'), ...solid('right', '1px', 'rgb(82, 105, 124)'), ...solid('bottom', '1px', 'rgb(82, 105, 124)'), ...solid('left', '1px', 'rgb(82, 105, 124)') });
    css($('#b'), solid('left', '4px', 'rgb(50, 107, 148)'));
    css($('#c'), { 'border-top-left-radius': '12px', 'border-top-right-radius': '12px', ...solid('bottom', '1px', 'rgb(220, 228, 235)') });
    expect(accentEdgeViolations({ root: '#kok', env })).toEqual([]);
  });

  it('eşit kenarlıklı kutuda farklı tek kenarı yakalar, yalnız o kenarı bildirir', () => {
    mount('<div id="k">Kart</div>');
    const { env, css } = makeEnv();
    const gray = 'rgb(220, 228, 235)';
    css($('#k'), { ...radius('8px'), ...solid('top', '1px', gray), ...solid('right', '1px', gray), ...solid('bottom', '1px', gray), ...solid('left', '4px', 'rgb(50, 107, 148)') });
    const out = accentEdgeViolations({ root: '#kok', env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/sol/);
  });

  it('inset box-shadow şeridini ve sözde öğe şeridini yakalar', () => {
    mount('<div id="s">Gölge</div><div id="p">Sözde</div>');
    const { env, css, box } = makeEnv();
    css($('#s'), { ...radius('12px'), 'box-shadow': 'rgb(50, 107, 148) 4px 0px 0px 0px inset' });
    css($('#p'), radius('12px'));
    box($('#p'), { left: 0, top: 0, width: 300, height: 80 });
    css($('#p'), { content: '""', position: 'absolute', left: '0px', top: '0px', width: '4px', height: '80px', 'background-color': 'rgb(50, 107, 148)' }, '::before');
    const out = accentEdgeViolations({ root: '#kok', env }).join('\n');
    expect(out).toMatch(/inset/);
    expect(out).toMatch(/::before/);
  });

  it('kontrolün dışındaki odak çizgisini (bottom -7px) şerit saymaz', () => {
    mount('<button id="b">Kaydet</button>');
    const { env, css, box } = makeEnv();
    css($('#b'), radius('8px'));
    box($('#b'), { left: 0, top: 0, width: 120, height: 44 });
    css($('#b'), LINE, '::after');
    expect(accentEdgeViolations({ root: '#kok', env })).toEqual([]);
  });
});

describe('overflowViolations', () => {
  it('sayfa düzeyinde yatay taşmayı yakalar', () => {
    mount('<p>Metin</p>');
    const { env, scroll } = makeEnv({ viewport: { width: 320, height: 568 } });
    scroll(document.scrollingElement ?? document.documentElement, { scrollWidth: 400, clientWidth: 320 });
    expect(overflowViolations({ env }).join()).toMatch(/sayfa/);
  });

  it('görünüm alanından taşan öğeyi bir kez bildirir; kaydırma kapsayıcısındaki tabloyu ve izinli öğeyi saymaz', () => {
    mount('<div id="t"><span id="ic">uzun</span></div><div id="s"><table id="tab"><tbody><tr><td>Koltuk</td></tr></tbody></table></div><div id="z" data-allow-overflow>serbest</div>');
    const { env, css, box } = makeEnv({ viewport: { width: 320, height: 568 } });
    box($('#t'), { left: 0, top: 0, width: 500, height: 20 });
    box($('#ic'), { left: 0, top: 0, width: 480, height: 20 });
    css($('#s'), { 'overflow-x': 'auto' });
    box($('#s'), { left: 0, top: 30, width: 320, height: 100 });
    box($('#tab'), { left: 0, top: 30, width: 900, height: 100 });
    box($('#z'), { left: 0, top: 200, width: 900, height: 20 });
    const out = overflowViolations({ root: '#kok', env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/div#t/);
  });

  it('görsel olarak gizli öğeyi (sr-only) saymaz', () => {
    mount('<span id="sr">Ekran okuyucu</span>');
    const { env, css, box } = makeEnv({ viewport: { width: 320, height: 568 } });
    css($('#sr'), { position: 'absolute' });
    box($('#sr'), { left: -9999, top: 0, width: 1, height: 1 });
    expect(overflowViolations({ root: '#kok', env })).toEqual([]);
  });

  it('kesilen etiket/eylem metnini yakalar; truncation:false kapatır', () => {
    mount('<button id="b">Ödeme planını güncelle</button>');
    const { env, css, scroll } = makeEnv();
    css($('#b'), { 'text-overflow': 'ellipsis', 'overflow-x': 'hidden', 'white-space': 'nowrap' });
    scroll($('#b'), { scrollWidth: 210, clientWidth: 120 });
    expect(overflowViolations({ root: '#kok', env }).join()).toMatch(/kesiliyor/);
    expect(overflowViolations({ root: '#kok', env, truncation: false })).toEqual([]);
  });

  it('kesme denetimi görsel olarak gizli metni (sr-only: 1 px kutu ya da clip) saymaz; görünür kesilen metni yine yakalar', () => {
    mount('<label id="sr">Sıralama</label><span id="kirpik">Planlanan</span><button id="b">Alım ekle ve kaydet</button>');
    const { env, css, box, scroll } = makeEnv();
    const SR_ONLY = { position: 'absolute', 'overflow-x': 'hidden', 'white-space': 'nowrap' };
    css($('#sr'), SR_ONLY);
    box($('#sr'), { left: 0, top: 0, width: 1, height: 1 });
    scroll($('#sr'), { scrollWidth: 64, clientWidth: 1 });
    css($('#kirpik'), { ...SR_ONLY, clip: 'rect(0px, 0px, 0px, 0px)' });
    box($('#kirpik'), { left: 0, top: 0, width: 2, height: 2 });
    scroll($('#kirpik'), { scrollWidth: 71, clientWidth: 2 });
    expect(overflowViolations({ root: '#kok', env })).toEqual([]);
    css($('#b'), { 'text-overflow': 'ellipsis', 'overflow-x': 'hidden', 'white-space': 'nowrap' });
    scroll($('#b'), { scrollWidth: 151, clientWidth: 60 });
    const out = overflowViolations({ root: '#kok', env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/button#b.*kesiliyor/);
  });
});

describe('motionViolations', () => {
  const EASE = 'cubic-bezier(.65,0,.35,1)';

  it('240 ms ve tek eğri temizdir; değer biçimi farkı (0.24s, 0.65) önemsizdir', () => {
    mount('<div id="a">A</div><div id="b">B</div><div id="c">C</div>');
    const { env, css } = makeEnv();
    css($('#a'), { 'transition-property': 'background-color', 'transition-duration': '240ms', 'transition-timing-function': EASE });
    css($('#b'), { 'transition-property': 'opacity, transform', 'transition-duration': '0.24s', 'transition-timing-function': 'cubic-bezier(0.65, 0, 0.35, 1)' });
    css($('#c'), { 'transition-property': 'all', 'transition-duration': '0s', 'transition-timing-function': 'ease' });
    expect(motionViolations(EASE, 240, { root: '#kok', env })).toEqual([]);
  });

  it('yanlış süreyi, yanlış eğriyi ve liste içindeki yanlış öğeyi yakalar', () => {
    mount('<div id="a">A</div><div id="b">B</div><div id="c">C</div>');
    const { env, css } = makeEnv();
    css($('#a'), { 'transition-property': 'opacity', 'transition-duration': '300ms', 'transition-timing-function': EASE });
    css($('#b'), { 'transition-property': 'color', 'transition-duration': '240ms', 'transition-timing-function': 'ease' });
    css($('#c'), { 'transition-property': 'opacity, transform', 'transition-duration': '0.24s, 0.2s', 'transition-timing-function': EASE });
    const out = motionViolations(EASE, 240, { root: '#kok', env });
    expect(out).toHaveLength(3);
    expect(out.join('\n')).toMatch(/300ms/);
    expect(out.join('\n')).toMatch(/ease/);
    expect(out.join('\n')).toMatch(/transform/);
  });

  it('animasyonu ve sözde öğe geçişini de denetler', () => {
    mount('<div id="a">A</div><div id="b">B</div>');
    const { env, css } = makeEnv();
    css($('#a'), { 'animation-name': 'spin', 'animation-duration': '1s', 'animation-timing-function': 'linear' });
    css($('#b'), { content: '""', 'transition-property': 'opacity', 'transition-duration': '200ms', 'transition-timing-function': EASE }, '::after');
    const out = motionViolations(EASE, 240, { root: '#kok', env }).join('\n');
    expect(out).toMatch(/spin/);
    expect(out).toMatch(/::after/);
  });

  it('reduced-motion açıkken sıfırdan büyük her süre ihlaldir', () => {
    mount('<div id="a">A</div>');
    const viaMedia = makeEnv({ media: { '(prefers-reduced-motion: reduce)': true } });
    viaMedia.css($('#a'), { 'transition-property': 'opacity', 'transition-duration': '240ms', 'transition-timing-function': EASE });
    expect(motionViolations(EASE, 240, { root: '#kok', env: viaMedia.env }).join()).toMatch(/reduced/);
    const forced = makeEnv();
    forced.css($('#a'), { 'transition-property': 'opacity', 'transition-duration': '240ms', 'transition-timing-function': EASE });
    expect(motionViolations(EASE, 240, { root: '#kok', env: forced.env, reduced: true })).toHaveLength(1);
    forced.css($('#a'), { 'transition-duration': '0s' });
    expect(motionViolations(EASE, 240, { root: '#kok', env: forced.env, reduced: true })).toEqual([]);
  });
});

describe('tarayıcıya kaynak metin olarak aktarım', () => {
  it('her dedektör modül kapsamına bağlı değildir: toString() ile yeniden kurulup çalışır', () => {
    mount('<p id="k">Fiyat yok</p><div id="m">M</div>');
    const { env, css } = makeEnv();
    css($('#k'), { 'font-size': '12px' });
    css($('#m'), { 'transition-property': 'opacity', 'transition-duration': '1s', 'transition-timing-function': 'linear' });
    const rebuild = <F>(fn: F): F => new Function(`return (${String(fn)})`)() as F;
    expect(rebuild(smallTextViolations)({ root: '#kok', env })).toHaveLength(1);
    expect(rebuild(motionViolations)('cubic-bezier(.65,0,.35,1)', 240, { root: '#kok', env })).toHaveLength(1);
    expect(rebuild(focusRingViolations)({ target: '#k', keyboard: true, env }).join()).toMatch(/gösterge yok/);
    expect(rebuild(accentEdgeViolations)({ root: '#kok', env })).toEqual([]);
    expect(rebuild(overflowViolations)({ root: '#kok', env })).toEqual([]);
  });

  it('detectorScript gerçek tarayıcı API yolunu (getComputedStyle, getBoundingClientRect) kullanan ifade üretir', () => {
    mount('<p id="k">Fiyat yok</p>');
    const real = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      if (pseudo) return { getPropertyValue: (n: string) => (n === 'content' ? 'none' : '') } as unknown as CSSStyleDeclaration;
      const base = real(el);
      return { getPropertyValue: (n: string) => ((el as HTMLElement).id === 'k' && n === 'font-size' ? '12px' : base.getPropertyValue(n)) } as unknown as CSSStyleDeclaration;
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) });
    const script = detectorScript('smallTextViolations', { root: '#kok', min: 14 });
    expect(typeof script).toBe('string');
    const out = new Function(`return ${script}`)() as string[];
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/Fiyat yok/);
  });

  it('selfCheckScript tek ifade olarak ayrıştırılabilir ve tüm dedektör kaynaklarını içerir', () => {
    const script = selfCheckScript();
    expect(() => new Function(`return ${script}`)).not.toThrow();
    for (const name of ['focusRingViolations', 'smallTextViolations', 'accentEdgeViolations', 'overflowViolations', 'motionViolations']) expect(script).toContain(name);
  });
});
