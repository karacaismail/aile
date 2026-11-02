/**
 * e2e/admin-detectors.ts birim testleri (jsdom). jsdom yerleşim ve sözde öğe stili hesaplamadığı için dedektörlere
 * sahte bir ortam (DetectorEnv) verilir: stil, kutu, görünüm alanı, media ve kaydırma ölçüleri test içinde tanımlanır.
 * Her kural için ihlal enjekte edilir (yakalanmalı) ve uyumlu örnek verilir (temiz kalmalı). Tarayıcı dedektörlerinden
 * sonra ağ isteği → derleme manifesti sınıflandırıcısı (Node tarafı, saf) gelir; son blok, dedektörlerin modül kapsamına
 * bağlı olmadığını (page.evaluate'e kaynak metin olarak verilebildiğini) doğrular.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeDelivery } from '../../scripts/check-delivery.mjs';
import { targetTokens } from '../design/tokens';
import {
  accentEdgeViolations,
  classifyDevRequest,
  classifyRequests,
  clippedTextViolations,
  deliveryViolations,
  detectors,
  detectorScript,
  emulateSafeAreaInsets,
  focusRingViolations,
  manifestClassifier,
  motionViolations,
  overflowViolations,
  PHONE_FORBIDDEN_CLASSES,
  readBuildManifest,
  safeAreaViolations,
  selfCheckScript,
  smallTextViolations,
  touchTargetViolations,
  virtualKeyboardViolations,
  type DeliveryGraphLike,
  type DetectorEnv,
  type ViteManifest,
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

type ScrollBox = { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number; scrollTop?: number; scrollLeft?: number };
type VisualViewport = { offsetTop: number; offsetLeft: number; width: number; height: number };
const toRect = (r: Rect) => ({ ...r, right: r.left + r.width, bottom: r.top + r.height });

/**
 * Sahte ortam: stil, kutu, metin satırı kutuları ve kaydırma ölçüleri öğe başına kaydedilir; sözde öğede varsayılan
 * content 'none'. `hit` verilirse örtülme denetimi (elementFromPoint) onu kullanır; `visual` görsel görünüm alanıdır.
 */
function makeEnv(init: {
  viewport?: { width: number; height: number };
  media?: Record<string, boolean>;
  hit?: (x: number, y: number) => Element | null;
  visual?: VisualViewport | null;
} = {}) {
  const styles = new Map<Element, Map<string, Css>>();
  const rects = new Map<Element, Rect>();
  const texts = new Map<Element, Rect[]>();
  const scrolls = new Map<Element, ScrollBox>();
  const viewport = init.viewport ?? { width: 375, height: 800 };
  const media = init.media ?? {};
  const env: DetectorEnv = {
    hit: init.hit,
    textRects: (node) => (node.parentElement ? texts.get(node.parentElement) ?? [] : []).map(toRect),
    visualViewport: () => init.visual ?? null,
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
  const scroll = (el: Element, s: { scrollWidth: number; clientWidth: number; scrollHeight?: number; clientHeight?: number; scrollTop?: number; scrollLeft?: number }) =>
    (scrolls.set(el, { scrollHeight: 20, clientHeight: 20, ...s }), el);
  /** Öğenin doğrudan metin düğümlerinin satır kutuları (Range.getClientRects karşılığı). */
  const text = (el: Element, lines: Rect[]) => (texts.set(el, lines), el);
  return { env, css, box, scroll, text };
}

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="kok">${html}</div>`;
  return document.getElementById('kok')!;
}
const $ = (sel: string) => document.querySelector(sel)!;

afterEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style[data-test]').forEach((el) => el.remove());
  delete document.documentElement.dataset.keyboard;
  for (const name of ['data-input-coarse', 'data-detector-safe-area']) document.documentElement.removeAttribute(name);
  (window as unknown as { __aileSafeAreaObserver?: MutationObserver }).__aileSafeAreaObserver?.disconnect();
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

/**
 * Tek satır modeli: li (ya da role=listitem) içindeki tek odaklanabilir öğe olan ve satırın içerik genişliğini dolduran
 * A/BUTTON satırdır. Çizgi bağlantının/düğmenin ya da li'nin ::after'ıdır; çizilen alt kenarı (taşıyıcının dolgu kutusu
 * altı − bottom) li'nin alt kenarına 1 px içinde oturuyorsa kabul. Kontrol kalıbı (4 px altta) eskisi gibi geçerlidir.
 * Ayrıca açık satır işareti [data-focus-line='row'] taşıyıcısı tr / role=row gibi bottom 0 bekler.
 */
describe('focusRingViolations › tek satır modeli', () => {
  const ROW: Rect = { left: 0, top: 100, width: 320, height: 56 };
  const ROW_LINE: Css = { ...LINE, width: '320px', bottom: '0px' };
  const RELATIVE: Css = { position: 'relative' };

  /** ul > li > (a|button): satır ve kontrol aynı kutuda; li'nin ek alt boşluğu `padBottom`. */
  function row(control: 'a' | 'button', opts: { padBottom?: number; extra?: string; controlWidth?: number; nav?: boolean } = {}) {
    const tag = control === 'a' ? '<a id="h" href="#/alimlar">Alımlar ve eşyalar</a>' : '<button id="h" type="button">Koltuk takımı</button>';
    const list = `<ul><li id="li">${tag}${opts.extra ?? ''}</li><li><a href="#/ev">Ev ve odalar</a></li></ul>`;
    mount(opts.nav ? `<nav aria-label="Sayfalar" data-odak-zemin="nav">${list}</nav>` : list);
    const kit = makeEnv();
    const pad = opts.padBottom ?? 0;
    kit.box($('#li'), { ...ROW, height: ROW.height + pad });
    kit.css($('#li'), { ...RELATIVE, ...(pad ? { 'padding-bottom': `${pad}px` } : {}) });
    kit.box($('#h'), { ...ROW, width: opts.controlWidth ?? ROW.width });
    kit.css($('#h'), RELATIVE);
    return kit;
  }

  it('temiz: li\'yi dolduran bağlantının ::after\'ı bottom 0 ve li alt kenarında (gezinme satırı dahil)', () => {
    const { env, css } = row('a');
    css($('#h'), ROW_LINE, '::after');
    expect(focusRingViolations({ target: '#h', keyboard: true, env })).toEqual([]);
    // Lacivert gezinme yüzeyindeki aynı satır (Sayfalar çekmecesi / yan gezinme bağlantısı) da satırdır.
    const nav = row('a', { nav: true });
    nav.css($('#h'), ROW_LINE, '::after');
    expect(focusRingViolations({ target: '#h', keyboard: true, env: nav.env })).toEqual([]);
  });

  it('temiz: çizgi li\'nin ::after\'ında (düğme satırı); temiz: kontrol kalıbı (4 px altta) satırda da geçerli', () => {
    const li = row('button');
    li.css($('#li'), ROW_LINE, '::after');
    expect(focusRingViolations({ target: '#h', keyboard: true, env: li.env })).toEqual([]);
    // Satırın alt boşluğu li'de (GenelPage): kontrol çizgisi -7 px; eskisi gibi kabul.
    const below = row('a', { padBottom: 7 });
    below.css($('#h'), { ...LINE, width: '320px' }, '::after');
    expect(focusRingViolations({ target: '#h', keyboard: true, env: below.env })).toEqual([]);
  });

  it('ihlal: satır alt kenarında olmayan bottom 0 çizgisi (li\'de alt boşluk: çizgi satırın içinde kalır)', () => {
    const { env, css } = row('a', { padBottom: 12 });
    css($('#h'), ROW_LINE, '::after');
    const out = focusRingViolations({ target: '#h', keyboard: true, env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/konum bottom 0px \(beklenen -7px/);
    expect(out[0]).toMatch(/satır alt 168px/);
  });

  it('ihlal: satır değil — li\'de ikinci odaklanabilir var ya da hedef satırı doldurmuyor; bottom 0 kontrol konumu değildir', () => {
    const iki = row('a', { extra: '<button type="button">Diğer</button>' });
    iki.css($('#h'), ROW_LINE, '::after');
    expect(focusRingViolations({ target: '#h', keyboard: true, env: iki.env }).join()).toMatch(/konum bottom 0px \(beklenen -7px\)/);
    const dar = row('button', { controlWidth: 120 });
    dar.css($('#h'), { ...LINE, bottom: '0px' }, '::after');
    expect(focusRingViolations({ target: '#h', keyboard: true, env: dar.env }).join()).toMatch(/konum bottom 0px \(beklenen -7px\)/);
    // Düğme/bağlantı olmayan odak (li içinde tek girdi) satır modeline girmez.
    mount('<ul><li id="li"><input id="h" aria-label="Ara"></li></ul>');
    const girdi = makeEnv();
    girdi.box($('#li'), ROW);
    girdi.css($('#li'), RELATIVE);
    girdi.box($('#h'), ROW);
    girdi.css($('#h'), RELATIVE);
    girdi.css($('#li'), ROW_LINE, '::after');
    expect(focusRingViolations({ target: '#h', keyboard: true, env: girdi.env }).join()).toMatch(/konum bottom 0px \(beklenen -7px\)/);
  });

  it('ihlal: konumlanmamış li\'nin ::after\'ı li\'ye bağlı değildir (bottom başka kaba göredir)', () => {
    const { env, css } = row('button');
    css($('#li'), { position: 'static' });
    css($('#li'), ROW_LINE, '::after');
    expect(focusRingViolations({ target: '#h', keyboard: true, env }).join()).toMatch(/konum bottom 0px/);
  });

  it('li taşıyıcı derinliğinin ötesinde olsa da çizgi taşıyıcısıdır; işaretçi modunda görünürse yakalanır', () => {
    mount('<ul><li id="li"><div><div><div><a id="h" href="#/x">Ayrıntı</a></div></div></div></li></ul>');
    const { env, css, box } = makeEnv();
    box($('#li'), ROW);
    css($('#li'), RELATIVE);
    box($('#h'), ROW);
    css($('#h'), RELATIVE);
    css($('#li'), ROW_LINE, '::after');
    expect(focusRingViolations({ target: '#h', keyboard: true, env })).toEqual([]);
    expect(focusRingViolations({ target: '#h', keyboard: false, env }).join()).toMatch(/klavye modu dışında/);
  });

  it('halka yasağı satır modelinde de geçerli: li\'de çevreleyen box-shadow yakalanır', () => {
    const { env, css } = row('a');
    css($('#h'), ROW_LINE, '::after');
    css($('#li'), { 'box-shadow': 'rgb(50, 107, 148) 0px 0px 0px 2px' });
    expect(focusRingViolations({ target: '#h', keyboard: true, env }).join()).toMatch(/box-shadow halkası/);
  });

  it("açık satır işareti [data-focus-line='row']: satırı saran etiketin ::after'ı bottom 0 kabul; -7 px satır konumu değil", () => {
    mount('<ul><li><label id="sat" data-focus-line="row"><input id="k" type="checkbox"> Örnek iş</label></li></ul>');
    const { env, css, box } = makeEnv();
    box($('#sat'), ROW);
    css($('#sat'), RELATIVE);
    box($('#k'), { left: 16, top: 116, width: 24, height: 24 });
    css($('#sat'), ROW_LINE, '::after');
    expect(focusRingViolations({ target: '#k', keyboard: true, env })).toEqual([]);
    css($('#sat'), { ...ROW_LINE, bottom: '-7px' }, '::after');
    expect(focusRingViolations({ target: '#k', keyboard: true, env }).join()).toMatch(/konum bottom -7px \(beklenen 0px\)/);
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

describe('touchTargetViolations', () => {
  it('ince işaretçide 44×44 temizdir; 43 px kenarlı hedef yakalanır', () => {
    mount('<button id="a">Kaydet</button><button id="b">Sil</button>');
    const { env, box } = makeEnv();
    box($('#a'), { left: 0, top: 0, width: 44, height: 44 });
    box($('#b'), { left: 60, top: 0, width: 43, height: 44 });
    const out = touchTargetViolations({ root: '#kok', env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/button#b\[Sil\]: dokunma alanı 43×44px < 44×44px/);
  });

  it('kaba işaretçide asgari 48: html[data-input-coarse] ya da (any-pointer: coarse); min verilirse o geçerlidir', () => {
    mount('<button id="a">Kaydet</button>');
    const fine = makeEnv();
    fine.box($('#a'), { left: 0, top: 0, width: 44, height: 44 });
    expect(touchTargetViolations({ root: '#kok', env: fine.env })).toEqual([]);
    document.documentElement.setAttribute('data-input-coarse', '');
    expect(touchTargetViolations({ root: '#kok', env: fine.env }).join()).toMatch(/44×44px < 48×48px/);
    expect(touchTargetViolations({ root: '#kok', env: fine.env, coarse: false })).toEqual([]);
    document.documentElement.removeAttribute('data-input-coarse');
    const coarse = makeEnv({ media: { '(any-pointer: coarse)': true } });
    coarse.box($('#a'), { left: 0, top: 0, width: 44, height: 44 });
    expect(touchTargetViolations({ root: '#kok', env: coarse.env })).toHaveLength(1);
    expect(touchTargetViolations({ root: '#kok', env: coarse.env, min: 40 })).toEqual([]);
  });

  it('varsayılan asgari kenarlar tasarım tokenlarıyla aynıdır (targetTokens: ince işaretçi, kaba işaretçi)', () => {
    // Dedektör tarayıcıya kaynak metin olarak gittiği için tokenları içe aktaramaz; sayılar burada token kaynağına bağlanır.
    const { dokunmaHedefi, dokunmaHedefiCoarse } = targetTokens;
    mount('<button id="a">Kaydet</button>');
    const { env, box } = makeEnv();
    box($('#a'), { left: 0, top: 0, width: dokunmaHedefi - 1, height: dokunmaHedefi });
    expect(touchTargetViolations({ root: '#kok', env, coarse: false }).join()).toContain(`< ${dokunmaHedefi}×${dokunmaHedefi}px`);
    box($('#a'), { left: 0, top: 0, width: dokunmaHedefi, height: dokunmaHedefi });
    expect(touchTargetViolations({ root: '#kok', env, coarse: false })).toEqual([]);
    expect(touchTargetViolations({ root: '#kok', env, coarse: true }).join()).toContain(`< ${dokunmaHedefiCoarse}×${dokunmaHedefiCoarse}px`);
    box($('#a'), { left: 0, top: 0, width: dokunmaHedefiCoarse, height: dokunmaHedefiCoarse });
    expect(touchTargetViolations({ root: '#kok', env, coarse: true })).toEqual([]);
  });

  it('etkin alan: konumlu sözde öğe genişletmesi, ilişkili etiket ve imleç bildiren sarmalayıcı sayılır', () => {
    mount('<button id="ikon" aria-label="Kapat"></button><label id="et">Okundu <input id="c" type="checkbox"></label><span id="sar"><input id="ara" aria-label="Ara"></span>');
    const { env, css, box } = makeEnv();
    box($('#ikon'), { left: 0, top: 0, width: 24, height: 24 });
    css($('#ikon'), { position: 'relative' });
    css($('#ikon'), { content: '""', position: 'absolute', left: '-10px', right: '-10px', top: '-10px', bottom: '-10px' }, '::before');
    box($('#et'), { left: 0, top: 60, width: 200, height: 48 });
    box($('#c'), { left: 170, top: 74, width: 20, height: 20 });
    box($('#sar'), { left: 0, top: 120, width: 240, height: 48 });
    css($('#sar'), { cursor: 'text' });
    box($('#ara'), { left: 12, top: 132, width: 200, height: 24 });
    expect(touchTargetViolations({ root: '#kok', env })).toEqual([]);

    // Genişletme konumlu öğe olmadan ve imleç bildirmeyen sarmalayıcıyla sayılmaz: gerçek küçük hedefler görünür.
    css($('#ikon'), { position: 'static' });
    css($('#sar'), { cursor: 'auto' });
    const out = touchTargetViolations({ root: '#kok', env }).join('\n');
    expect(out).toMatch(/button#ikon\[Kapat\]: dokunma alanı 24×24px/);
    expect(out).toMatch(/input#ara\[Ara\]: dokunma alanı 200×24px/);
    expect(out).not.toMatch(/input#c/);
  });

  it('rc-input affix sarmalayıcısı (tıklamayı alana iletir) imleç bildirmese de etkin alana katılır', () => {
    mount('<span id="sar" class="ant-input-affix-wrapper"><input id="ara" class="ant-input" aria-label="Ara"></span>');
    const { env, box } = makeEnv();
    box($('#sar'), { left: 0, top: 0, width: 288, height: 44 });
    box($('#ara'), { left: 12, top: 10, width: 240, height: 24 });
    expect(touchTargetViolations({ root: '#kok', env })).toEqual([]);
    $('#sar').className = 'kutu';
    expect(touchTargetViolations({ root: '#kok', env }).join()).toMatch(/input#ara.*240×24px/);
  });

  it('kutuya değmeyen uzak etiket etkin alanı büyütmez', () => {
    mount('<input id="u" type="checkbox"><p>Ayraç</p><label for="u" id="ul">Uzak etiket</label>');
    const { env, box } = makeEnv();
    box($('#u'), { left: 0, top: 0, width: 20, height: 20 });
    box($('#ul'), { left: 0, top: 200, width: 200, height: 48 });
    expect(touchTargetViolations({ root: '#kok', env }).join()).toMatch(/input#u: dokunma alanı 20×20px/);
  });

  it('gizli, devre dışı, inert/aria-hidden, metin içi bağlantı, görsel olarak gizli ve data-allow-touch-target muaftır', () => {
    mount('<button id="g">Gizli</button><button id="d" disabled>Pasif</button><div aria-hidden="true"><button id="h">H</button></div>'
      + '<div inert><button id="i">I</button></div><p id="p">Ayrıntı için <a id="l" href="#/x">buraya</a> bakın.</p>'
      + '<div data-allow-touch-target><button id="m">M</button></div><span id="sr"><input id="s" type="checkbox" aria-label="Seç"></span>'
      + '<button id="n">Dokunulmaz</button>');
    const { env, css, box } = makeEnv();
    ['#g', '#d', '#h', '#i', '#l', '#m', '#n'].forEach((sel, i) => box($(sel), { left: i * 30, top: 0, width: 20, height: 20 }));
    box($('#s'), { left: 0, top: 100, width: 1, height: 1 });
    css($('#g'), { display: 'none' });
    css($('#l'), { display: 'inline' });
    css($('#n'), { 'pointer-events': 'none' });
    expect(touchTargetViolations({ root: '#kok', env })).toEqual([]);
    css($('#l'), { display: 'inline-block' });
    expect(touchTargetViolations({ root: '#kok', env }).join()).toMatch(/a#l\[buraya\]: dokunma alanı 20×20px/);
  });

  it('aynı katmanda örtüşen hedefleri yakalar; bitişik, iç içe ve farklı katmandaki hedefler temizdir', () => {
    mount('<button id="a">A</button><button id="b">B</button><button id="c">C</button>'
      + '<div id="satir" role="button" tabindex="0"><button id="ic">İç</button></div><div id="kat"><button id="u">Üst</button></div>');
    const { env, css, box } = makeEnv();
    box($('#a'), { left: 0, top: 0, width: 48, height: 48 });
    box($('#b'), { left: 40, top: 0, width: 48, height: 48 });
    box($('#c'), { left: 88, top: 0, width: 48, height: 48 });
    box($('#satir'), { left: 0, top: 100, width: 300, height: 56 });
    box($('#ic'), { left: 240, top: 104, width: 48, height: 48 });
    css($('#kat'), { position: 'fixed' });
    box($('#kat'), { left: 0, top: 0, width: 320, height: 48 });
    box($('#u'), { left: 0, top: 0, width: 48, height: 48 });
    const out = touchTargetViolations({ root: '#kok', env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/button#a\[A\] ile button#b\[B\]: dokunma alanları 8×48px örtüşüyor/);
    expect(touchTargetViolations({ root: '#kok', env, overlap: false })).toEqual([]);
  });

  it('hit testi: örtülen hedef yakalanır; sabit katman örtüsü sayılmaz; kesişimi üçüncü öğe örtüyorsa örtüşme sayılmaz', () => {
    mount('<button id="a">A</button><button id="b">B</button><div id="perde">Perde</div><button id="c">C</button><div id="sabit">Sabit</div>');
    const hit = (_x: number, y: number) => (y < 100 ? $('#perde') : $('#sabit'));
    const { env, css, box } = makeEnv({ hit });
    box($('#a'), { left: 0, top: 0, width: 48, height: 48 });
    box($('#b'), { left: 40, top: 0, width: 48, height: 48 });
    box($('#perde'), { left: 0, top: 0, width: 200, height: 100 });
    box($('#c'), { left: 0, top: 200, width: 48, height: 48 });
    css($('#sabit'), { position: 'fixed' });
    box($('#sabit'), { left: 0, top: 190, width: 320, height: 80 });
    const out = touchTargetViolations({ root: '#kok', env });
    expect(out).toEqual([
      'button#a[A]: dokunma alanı div#perde[Perde] tarafından örtülüyor',
      'button#b[B]: dokunma alanı div#perde[Perde] tarafından örtülüyor',
    ]);
    expect(touchTargetViolations({ root: '#kok', env, occlusion: false })).toEqual([]);
  });
});

describe('safeAreaViolations', () => {
  it('sabit alt çubukta güvenli alana giren düğme yakalanır; iç boşluklu çubuk temizdir', () => {
    mount('<div id="alt"><button id="b">Kaydet</button></div><div id="iyi"><button id="c">Gönder</button></div>');
    const { env, css, box } = makeEnv({ viewport: { width: 390, height: 844 } });
    css($('#alt'), { position: 'fixed' });
    box($('#alt'), { left: 0, top: 780, width: 390, height: 64 });
    box($('#b'), { left: 16, top: 790, width: 358, height: 48 });
    css($('#iyi'), { position: 'fixed' });
    box($('#iyi'), { left: 0, top: 700, width: 390, height: 144 });
    box($('#c'), { left: 16, top: 740, width: 358, height: 48 });
    const out = safeAreaViolations({ root: '#kok', env, insets: { bottom: 34 } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/button#b\[Kaydet\]: güvenli alana giriyor \(alt 34px bandı/);
  });

  it('yatay telefonda yan çentiğe giren akış içi metin metin kutusuyla yakalanır; kaydırılarak açılabilen içerik serbesttir', () => {
    mount('<p id="p">Alımlar</p><div id="tablo"><span id="h">Koltuk</span></div>');
    const { env, css, box, text, scroll } = makeEnv({ viewport: { width: 844, height: 390 } });
    box($('#p'), { left: 0, top: 100, width: 844, height: 24 });
    text($('#p'), [{ left: 16, top: 100, width: 60, height: 24 }]);
    css($('#tablo'), { 'overflow-x': 'auto' });
    box($('#tablo'), { left: 0, top: 200, width: 844, height: 40 });
    scroll($('#tablo'), { scrollWidth: 1600, clientWidth: 844, scrollLeft: 120 });
    box($('#h'), { left: 10, top: 210, width: 50, height: 20 });
    text($('#h'), [{ left: 10, top: 210, width: 50, height: 20 }]);
    const out = safeAreaViolations({ root: '#kok', env, insets: { left: 47, right: 47 } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/p#p\[Alımlar\]: güvenli alana giriyor \(sol 47px bandı/);
    text($('#p'), [{ left: 63, top: 100, width: 60, height: 24 }]);
    expect(safeAreaViolations({ root: '#kok', env, insets: { left: 47, right: 47 } })).toEqual([]);
    scroll($('#tablo'), { scrollWidth: 1600, clientWidth: 844, scrollLeft: 0 });
    expect(safeAreaViolations({ root: '#kok', env, insets: { left: 47, right: 47 } }).join()).toMatch(/span#h/);
  });

  it('akış içi içerik: sayfa en üstteyken üst bant ihlaldir; kaydırılabiliyorsa alt bant serbesttir, en alttayken ihlaldir', () => {
    mount('<h1 id="t">Başlık</h1><p id="s">Son satır</p>');
    const { env, box, scroll } = makeEnv({ viewport: { width: 390, height: 844 } });
    box($('#t'), { left: 16, top: 20, width: 200, height: 32 });
    box($('#s'), { left: 16, top: 820, width: 200, height: 24 });
    const doc = document.scrollingElement ?? document.documentElement;
    scroll(doc, { scrollWidth: 390, clientWidth: 390, scrollHeight: 2000, clientHeight: 844, scrollTop: 0 });
    let out = safeAreaViolations({ root: '#kok', env, insets: { top: 47, bottom: 34 } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/h1#t\[Başlık\]: güvenli alana giriyor \(üst 47px bandı/);
    scroll(doc, { scrollWidth: 390, clientWidth: 390, scrollHeight: 2000, clientHeight: 844, scrollTop: 1156 });
    out = safeAreaViolations({ root: '#kok', env, insets: { top: 47, bottom: 34 } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/p#s\[Son satır\]: güvenli alana giriyor \(alt 34px bandı/);
  });

  it('insets verilmezse html[data-detector-safe-area] okunur; sıfır güvenli alanda boştur; muafiyet ve gizli öğe sayılmaz', () => {
    mount('<div id="ust"><span id="x">Saat</span></div><div id="serbest" data-allow-safe-area><span>Arka plan</span></div><span id="gizli">Gizli</span>');
    const { env, css, box } = makeEnv({ viewport: { width: 390, height: 844 } });
    css($('#ust'), { position: 'fixed' });
    box($('#ust'), { left: 0, top: 0, width: 390, height: 60 });
    box($('#x'), { left: 16, top: 10, width: 50, height: 20 });
    css($('#gizli'), { display: 'none' });
    box($('#gizli'), { left: 16, top: 10, width: 50, height: 20 });
    expect(safeAreaViolations({ root: '#kok', env })).toEqual([]);
    document.documentElement.setAttribute('data-detector-safe-area', '47 0 34 0');
    const out = safeAreaViolations({ root: '#kok', env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/span#x\[Saat\]: güvenli alana giriyor \(üst 47px bandı, sabit\/yapışkan katman\)/);
  });

  it('emulateSafeAreaInsets env(safe-area-inset-*) bildirimlerini (gruplu kurallar ve style özniteliği dahil) px değerine çevirir', () => {
    // jsdom CSSOM'u yedeksiz tek env() bildirimini düşürür (tarayıcı tutar); bu yüzden kalıp calc içinde verilir.
    document.head.insertAdjacentHTML('beforeend', '<style data-test>.ust{padding-top:calc(8px + env(safe-area-inset-top, 0px))}@media (min-width: 1px){.alt{padding:calc(4px + env(safe-area-inset-bottom)) 0 0}}</style>');
    mount('<div id="i" style="padding-left: env(safe-area-inset-left, 0px)">x</div>');
    const count = emulateSafeAreaInsets({ top: 47, bottom: 34, left: 12 });
    expect(count).toBe(3);
    const sheet = (document.head.querySelector('style[data-test]') as HTMLStyleElement).sheet!;
    const css = Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n');
    expect(css).not.toMatch(/env\(/);
    expect(css).toMatch(/55px/);
    expect(css).toMatch(/38px/);
    expect($('#i').getAttribute('style')).toBe('padding-left: 12px');
    expect(document.documentElement.getAttribute('data-detector-safe-area')).toBe('47 0 34 12');
  });
});

describe('virtualKeyboardViolations', () => {
  it('sabit katmandaki alan klavye bandının altında kalır ve kaydırılamazsa yakalanır', () => {
    mount('<div id="sayfa"><label>Tutar <input id="t"></label></div>');
    const { env, css, box } = makeEnv({ viewport: { width: 390, height: 844 } });
    css($('#sayfa'), { position: 'fixed' });
    box($('#sayfa'), { left: 0, top: 600, width: 390, height: 244 });
    box($('#t'), { left: 16, top: 760, width: 358, height: 48 });
    const out = virtualKeyboardViolations({ target: '#t', keyboard: 300, env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/input#t: odaktaki alan klavye 300px altında kalıyor \(alt 808px > görünür 544px; kaydırma payı 0px, gereken 264px\)/);
  });

  it('belge ya da iç kaydırma kapsayıcısı alanı bandın üstüne taşıyabiliyorsa temizdir; pay yetmezse yakalanır', () => {
    mount('<input id="akis" aria-label="Not"><div id="sayfa"><div id="govde"><input id="ic" aria-label="Tutar"></div></div>');
    const { env, css, box, scroll } = makeEnv({ viewport: { width: 390, height: 844 } });
    const doc = document.scrollingElement ?? document.documentElement;
    scroll(doc, { scrollWidth: 390, clientWidth: 390, scrollHeight: 2000, clientHeight: 844, scrollTop: 0 });
    box($('#akis'), { left: 16, top: 700, width: 358, height: 48 });
    expect(virtualKeyboardViolations({ target: '#akis', keyboard: 300, env })).toEqual([]);
    css($('#sayfa'), { position: 'fixed' });
    box($('#sayfa'), { left: 0, top: 500, width: 390, height: 344 });
    css($('#govde'), { 'overflow-y': 'auto' });
    box($('#govde'), { left: 0, top: 540, width: 390, height: 300 });
    scroll($('#govde'), { scrollWidth: 390, clientWidth: 390, scrollHeight: 600, clientHeight: 300, scrollTop: 0 });
    box($('#ic'), { left: 16, top: 760, width: 358, height: 48 });
    expect(virtualKeyboardViolations({ target: '#ic', keyboard: 300, env })).toEqual([]);
    scroll($('#govde'), { scrollWidth: 390, clientWidth: 390, scrollHeight: 600, clientHeight: 300, scrollTop: 200 });
    expect(virtualKeyboardViolations({ target: '#ic', keyboard: 300, env }).join()).toMatch(/kaydırma payı 100px, gereken 264px/);
  });

  it('kaydırılmış konumda görünür banttaki içerikli sabit/yapışkan öğe alanı örterse yakalanır; boş örtü sayılmaz', () => {
    mount('<header id="ust">Alımlar</header><div id="ortu"></div><input id="a" aria-label="Ara">');
    const { env, css, box, scroll } = makeEnv({ viewport: { width: 844, height: 390 } });
    const doc = document.scrollingElement ?? document.documentElement;
    scroll(doc, { scrollWidth: 844, clientWidth: 844, scrollHeight: 1600, clientHeight: 390, scrollTop: 0 });
    css($('#ust'), { position: 'sticky' });
    box($('#ust'), { left: 0, top: 0, width: 844, height: 160 });
    css($('#ortu'), { position: 'fixed' });
    box($('#ortu'), { left: 0, top: 0, width: 844, height: 390 });
    box($('#a'), { left: 16, top: 300, width: 300, height: 44 });
    const out = virtualKeyboardViolations({ target: '#a', keyboard: 200, env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/input#a\[Ara\]: odaktaki alan header#ust\[Alımlar\] tarafından örtülüyor \(14px\)/);
    box($('#ust'), { left: 0, top: 0, width: 844, height: 120 });
    expect(virtualKeyboardViolations({ target: '#a', keyboard: 200, env })).toEqual([]);
  });

  it('klavye yoksa ve düzenlenemeyen hedefte boştur; visualViewport küçülmüşse bant ondan okunur; varsayılan hedef odaktaki öğedir', () => {
    mount('<button id="b">Kaydet</button><div id="sayfa"><input id="t" type="text" aria-label="Tutar"><input id="r" readonly aria-label="Kod"></div>');
    const plain = makeEnv({ viewport: { width: 390, height: 844 } });
    plain.css($('#sayfa'), { position: 'fixed' });
    plain.box($('#t'), { left: 16, top: 700, width: 358, height: 48 });
    expect(virtualKeyboardViolations({ target: '#b', keyboard: 300, env: plain.env })).toEqual([]);
    expect(virtualKeyboardViolations({ target: '#r', keyboard: 300, env: plain.env })).toEqual([]);
    expect(virtualKeyboardViolations({ target: '#t', env: plain.env })).toEqual([]);
    const visual = makeEnv({ viewport: { width: 390, height: 844 }, visual: { offsetTop: 0, offsetLeft: 0, width: 390, height: 500 } });
    visual.css($('#sayfa'), { position: 'fixed' });
    visual.box($('#t'), { left: 16, top: 700, width: 358, height: 48 });
    ($('#t') as HTMLInputElement).focus();
    expect(virtualKeyboardViolations({ env: visual.env }).join()).toMatch(/görsel görünüm 500px altında kalıyor/);
  });
});

describe('clippedTextViolations', () => {
  it('overflow:hidden kapsayıcıda yatay kesilen görünür metni yakalar; sığan metin temizdir', () => {
    mount('<div id="k"><span id="u">Ödeme planını güncelle</span></div><div id="s"><span id="v">Kısa</span></div>');
    const { env, css, box, text } = makeEnv({ viewport: { width: 320, height: 568 } });
    for (const [sel, top] of [['#k', 0], ['#s', 40]] as const) {
      css($(sel), { 'overflow-x': 'hidden', 'overflow-y': 'hidden' });
      box($(sel), { left: 0, top, width: 100, height: 24 });
    }
    box($('#u'), { left: 0, top: 0, width: 100, height: 24 });
    text($('#u'), [{ left: 0, top: 0, width: 180, height: 24 }]);
    box($('#v'), { left: 0, top: 40, width: 40, height: 24 });
    text($('#v'), [{ left: 0, top: 40, width: 40, height: 24 }]);
    const out = clippedTextViolations({ root: '#kok', env });
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('span#u: görünür metin kesiliyor (sağ 80px): "Ödeme planını güncelle"');
  });

  it('dikey kesmeyi (sabit yükseklik, satır sınırı) yakalar; satır yüksekliği payı yanlış alarm vermez', () => {
    mount('<div id="k"><p id="u">Uzun açıklama üç satıra yayılıyor</p></div><div id="s"><span id="v">Rozet</span></div>');
    const { env, css, box, text } = makeEnv({ viewport: { width: 320, height: 568 } });
    css($('#k'), { 'overflow-x': 'hidden', 'overflow-y': 'hidden' });
    box($('#k'), { left: 0, top: 0, width: 200, height: 48 });
    box($('#u'), { left: 0, top: 0, width: 200, height: 72 });
    text($('#u'), [
      { left: 0, top: 0, width: 190, height: 24 },
      { left: 0, top: 24, width: 190, height: 24 },
      { left: 0, top: 48, width: 120, height: 24 },
    ]);
    css($('#s'), { 'overflow-x': 'hidden', 'overflow-y': 'hidden' });
    box($('#s'), { left: 0, top: 100, width: 80, height: 16 });
    css($('#v'), { 'line-height': '16px' });
    box($('#v'), { left: 0, top: 100, width: 60, height: 16 });
    text($('#v'), [{ left: 0, top: 98.5, width: 60, height: 19 }]);
    const out = clippedTextViolations({ root: '#kok', env });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/p#u: görünür metin kesiliyor \(alt 24px\)/);
  });

  it('kaydırma kapsayıcısındaki, tamamen gizli, görsel olarak gizli ve data-allow-truncate altındaki metin sayılmaz', () => {
    mount('<div id="t"><span id="a">Çok geniş tablo hücresi metni</span></div><div id="c"><span id="b">Kapalı akordeon</span></div>'
      + '<span id="sr">Ekran okuyucu</span><div id="z" data-allow-truncate><span id="d">Bilerek kısaltılmış</span></div>');
    const { env, css, box, text } = makeEnv({ viewport: { width: 320, height: 568 } });
    css($('#t'), { 'overflow-x': 'auto', 'overflow-y': 'hidden' });
    box($('#t'), { left: 0, top: 0, width: 100, height: 24 });
    text($('#a'), [{ left: 0, top: 0, width: 300, height: 24 }]);
    css($('#c'), { 'overflow-x': 'hidden', 'overflow-y': 'hidden' });
    box($('#c'), { left: 0, top: 50, width: 200, height: 0 });
    text($('#b'), [{ left: 0, top: 50, width: 120, height: 24 }]);
    css($('#sr'), { position: 'absolute', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'white-space': 'nowrap' });
    box($('#sr'), { left: 0, top: 0, width: 1, height: 1 });
    text($('#sr'), [{ left: 0, top: 0, width: 90, height: 20 }]);
    css($('#z'), { 'overflow-x': 'hidden' });
    box($('#z'), { left: 0, top: 100, width: 60, height: 24 });
    text($('#d'), [{ left: 0, top: 100, width: 140, height: 24 }]);
    expect(clippedTextViolations({ root: '#kok', env })).toEqual([]);
  });

  it('görünüm alanından taşan metni yakalar (viewport:false kapatır); sabit katmanda dikey taşma da kesmedir', () => {
    mount('<p id="p">Görünüm alanını aşan uzun satır</p><div id="f"><span id="s">Sabit alt bilgi</span></div>');
    const { env, css, box, text } = makeEnv({ viewport: { width: 320, height: 568 } });
    box($('#p'), { left: 0, top: 0, width: 400, height: 24 });
    text($('#p'), [{ left: 0, top: 0, width: 400, height: 24 }]);
    css($('#f'), { position: 'fixed' });
    box($('#f'), { left: 0, top: 540, width: 320, height: 60 });
    text($('#s'), [{ left: 0, top: 560, width: 120, height: 24 }]);
    const out = clippedTextViolations({ root: '#kok', env });
    expect(out).toEqual([
      'p#p: görünür metin kesiliyor (sağ 80px): "Görünüm alanını aşan uzun satır"',
      'span#s: görünür metin kesiliyor (alt 16px): "Sabit alt bilgi"',
    ]);
    expect(clippedTextViolations({ root: '#kok', env, viewport: false })).toEqual([]);
  });

  it('hareketi süren (açılıp kapanan) kırpan atanın altındaki metin ölçülmez; hareket bitince ölçülür', () => {
    mount('<div id="panel"><div id="ic"><p id="u">Kapanan akordeon içeriği</p></div></div>');
    const { env, css, box, text } = makeEnv({ viewport: { width: 320, height: 568 } });
    css($('#ic'), { 'overflow-x': 'hidden', 'overflow-y': 'hidden' });
    box($('#ic'), { left: 0, top: 0, width: 200, height: 30 });
    text($('#u'), [{ left: 0, top: 0, width: 180, height: 24 }, { left: 0, top: 24, width: 90, height: 24 }]);
    const running = [{ playState: 'running', effect: { target: $('#panel') } }];
    // jsdom Web Animations sağlamaz: yalnız dedektörün okuduğu playState/effect.target taklit edilir (örnek düzeyinde).
    Object.defineProperty(document, 'getAnimations', { configurable: true, value: () => running });
    try {
      expect(clippedTextViolations({ root: '#kok', env })).toEqual([]);
      running[0].playState = 'finished';
      expect(clippedTextViolations({ root: '#kok', env }).join()).toMatch(/p#u: görünür metin kesiliyor \(alt 18px\)/);
    } finally {
      Reflect.deleteProperty(document, 'getAnimations');
    }
  });

  it('metin satırı kutusu ölçülemezse üst öğenin kutusuyla ölçer', () => {
    mount('<div id="k"><span id="u">Uzun etiket</span></div>');
    const { env, css, box } = makeEnv();
    css($('#k'), { 'overflow-x': 'hidden' });
    box($('#k'), { left: 0, top: 0, width: 50, height: 24 });
    box($('#u'), { left: 0, top: 0, width: 90, height: 24 });
    const bare: DetectorEnv = { ...env, textRects: undefined };
    expect(clippedTextViolations({ root: '#kok', env: bare }).join()).toMatch(/span#u: görünür metin kesiliyor \(sağ 40px\)/);
  });
});

// #region ağ isteği → derleme manifesti sınıflandırıcısı (Node tarafı, saf)
const ECHARTS_SRC = 'node_modules/.pnpm/echarts@6.0.0/node_modules/echarts/charts.js';
const MANIFEST: ViteManifest = {
  'admin.html': {
    file: 'assets/admin-A1.js', name: 'admin', src: 'admin.html', isEntry: true,
    imports: ['_shared-S1.js', '_tokens-T1.js', '_antd-N1.js', '_PageHeader-P1.js'],
    dynamicImports: ['src/admin/pages/AlimlarPage.tsx', 'src/admin/ui/wide/Table.wide.tsx', ECHARTS_SRC, '_core-C1.js'],
    css: ['assets/admin-A1.css'],
  },
  '_shared-S1.js': { file: 'assets/shared-S1.js', name: 'shared' },
  '_tokens-T1.js': { file: 'assets/tokens-T1.js', name: 'tokens' },
  '_antd-N1.js': { file: 'assets/antd-N1.js', name: 'antd', imports: ['_icons-I1.js', '_shared-S1.js'] },
  '_icons-I1.js': { file: 'assets/icons-I1.js', name: 'icons' },
  '_pro-R1.js': { file: 'assets/pro-R1.js', name: 'pro', imports: ['_antd-N1.js'] },
  '_router-W1.js': { file: 'assets/router-W1.js', name: 'router' },
  '_PageHeader-P1.js': { file: 'assets/PageHeader-P1.js', name: 'PageHeader', imports: ['_shared-S1.js'], css: ['assets/PageHeader-P1.css'] },
  'src/admin/pages/AlimlarPage.tsx': {
    file: 'assets/AlimlarPage-L1.js', name: 'AlimlarPage', src: 'src/admin/pages/AlimlarPage.tsx', isDynamicEntry: true,
    imports: ['_pro-R1.js', '_router-W1.js', 'admin.html'], css: ['assets/AlimlarPage-L1.css'],
  },
  'src/admin/ui/wide/Table.wide.tsx': {
    file: 'assets/Table.wide-D1.js', name: 'Table.wide', src: 'src/admin/ui/wide/Table.wide.tsx', isDynamicEntry: true, imports: ['_wide-G1.js'],
  },
  '_wide-G1.js': { file: 'assets/wide-G1.js', name: 'wide', css: ['assets/wide-G1.css'] },
  [ECHARTS_SRC]: { file: 'assets/charts-E1.js', name: 'charts', src: ECHARTS_SRC, isDynamicEntry: true, imports: ['_graphic-Z1.js'] },
  '_core-C1.js': { file: 'assets/core-C1.js', name: 'core', imports: ['_graphic-Z1.js'] },
  '_graphic-Z1.js': { file: 'assets/graphic-Z1.js', name: 'graphic' },
  'src/LegacyApp.tsx': { file: 'assets/LegacyApp-Y1.js', name: 'LegacyApp', src: 'src/LegacyApp.tsx', isDynamicEntry: true, assets: ['assets/outfit-F1.woff2'] },
};
const GRAPH: DeliveryGraphLike = {
  schema: 1,
  chunks: {
    'assets/admin-A1.js': { modules: 20, groups: {}, packages: { '.': 20 } },
    'assets/shared-S1.js': { modules: 19, groups: { shared: 19 }, packages: { react: 10, '.': 9 } },
    'assets/tokens-T1.js': { modules: 2, groups: { tokens: 2 }, packages: { '.': 2 } },
    'assets/antd-N1.js': { modules: 794, groups: { antd: 794 }, packages: { antd: 700, '@rc-component/util': 94 } },
    'assets/icons-I1.js': { modules: 61, groups: { icons: 61 }, packages: { '@ant-design/icons': 61 } },
    'assets/pro-R1.js': { modules: 300, groups: { pro: 300 }, packages: { '@ant-design/pro-components': 300 } },
    'assets/router-W1.js': { modules: 4, groups: { router: 4 }, packages: { wouter: 3, regexparam: 1 } },
    'assets/PageHeader-P1.js': { modules: 100, groups: {}, packages: { '.': 100 } },
    'assets/AlimlarPage-L1.js': { modules: 2, groups: {}, packages: { '.': 2 } },
    'assets/Table.wide-D1.js': { modules: 1, groups: { wide: 1 }, packages: { '.': 1 } },
    'assets/wide-G1.js': { modules: 12, groups: { wide: 12 }, packages: { '.': 12 } },
    'assets/charts-E1.js': { modules: 155, groups: {}, packages: { echarts: 155 } },
    'assets/core-C1.js': { modules: 9, groups: {}, packages: { echarts: 9 } },
    'assets/graphic-Z1.js': { modules: 57, groups: {}, packages: { zrender: 50, tslib: 7 } },
    'assets/LegacyApp-Y1.js': { modules: 482, groups: {}, packages: { '.': 482 } },
  },
};
const ORIGIN = 'http://127.0.0.1:5495/aile/';

describe('manifestClassifier (ağ isteği → teslim sınıfı)', () => {
  it('delivery-graph ile her isteği sınıfına ayırır: gruplar, echarts, wide, giriş, sayfa, tembel, uygulama, css, varlık', () => {
    const classify = manifestClassifier(MANIFEST, { graph: GRAPH });
    const cls = (path: string) => classify(ORIGIN + path).class;
    expect(cls('assets/admin-A1.js')).toBe('entry');
    expect(cls('assets/admin-A1.css')).toBe('entry');
    expect(cls('assets/shared-S1.js')).toBe('shared');
    expect(cls('assets/tokens-T1.js')).toBe('tokens');
    expect(cls('assets/antd-N1.js?v=3')).toBe('antd');
    expect(cls('assets/icons-I1.js#x')).toBe('icons');
    expect(cls('assets/pro-R1.js')).toBe('pro');
    expect(cls('assets/router-W1.js')).toBe('router');
    expect(cls('assets/PageHeader-P1.js')).toBe('app');
    expect(cls('assets/PageHeader-P1.css')).toBe('app');
    expect(cls('assets/AlimlarPage-L1.js')).toBe('page');
    expect(cls('assets/AlimlarPage-L1.css')).toBe('page');
    expect(cls('assets/Table.wide-D1.js')).toBe('wide');
    expect(cls('assets/wide-G1.js')).toBe('wide');
    expect(cls('assets/wide-G1.css')).toBe('wide');
    expect(cls('assets/charts-E1.js')).toBe('echarts');
    expect(cls('assets/core-C1.js')).toBe('echarts');
    expect(cls('assets/graphic-Z1.js')).toBe('echarts');
    expect(cls('assets/LegacyApp-Y1.js')).toBe('lazy');
    expect(cls('assets/outfit-F1.woff2')).toBe('asset');
    expect(cls('assets/eski-X9.js')).toBe('unknown');
    expect(cls('admin.html#/alimlar')).toBe('other');
    expect(classify('http://127.0.0.1:5495/__aile/generation/manifest.json').class).toBe('other');
    expect(classify(ORIGIN + 'assets/antd-N1.js')).toEqual({ url: ORIGIN + 'assets/antd-N1.js', file: 'assets/antd-N1.js', class: 'antd', label: 'chunk:antd', source: 'graph' });
    expect(classify(ORIGIN + 'assets/AlimlarPage-L1.js').label).toBe('src/admin/pages/AlimlarPage.tsx');
    expect(classify(ORIGIN + 'assets/charts-E1.js').label).toBe('node_modules/echarts/charts.js');
  });

  it('delivery-graph yoksa adlı grupları ve kaynak yolunu kullanır (adsız ECharts ortak parçası uygulama sayılır)', () => {
    const classify = manifestClassifier(MANIFEST);
    const cls = (path: string) => classify(ORIGIN + path).class;
    expect(cls('assets/antd-N1.js')).toBe('antd');
    expect(cls('assets/wide-G1.js')).toBe('wide');
    expect(cls('assets/Table.wide-D1.js')).toBe('wide');
    expect(cls('assets/charts-E1.js')).toBe('echarts');
    expect(cls('assets/core-C1.js')).toBe('app');
    expect(classify(ORIGIN + 'assets/antd-N1.js').source).toBe('manifest');
  });

  it('scripts/check-delivery.mjs birincil sınıflarıyla aynı sonucu verir (parite)', () => {
    const graph = { ...GRAPH, schema: 1, groups: ['wide', 'tokens', 'pro', 'icons', 'antd', 'router', 'shared'], edges: [] };
    const analysis = analyzeDelivery({ manifest: MANIFEST, graph, sizeOf: () => ({ raw: 1, gzip: 1 }), entry: 'admin.html' });
    const classify = manifestClassifier(MANIFEST, { graph: GRAPH });
    const pairs = Object.entries(analysis.groups as Record<string, { list: string[] }>).flatMap(([cls, group]) => group.list.map((file) => [file, cls]));
    expect(pairs.length).toBeGreaterThan(10);
    for (const [file, cls] of pairs) expect(`${file} → ${classify(ORIGIN + file).class}`).toBe(`${file} → ${cls}`);
  });

  it('classifyRequests ve deliveryViolations: telefon profilinde yasak sınıflar tekil ve sıralı bildirilir', () => {
    const urls = ['assets/admin-A1.js', 'assets/antd-N1.js', 'assets/antd-N1.js?v=2', 'assets/wide-G1.css', 'assets/core-C1.js', 'assets/AlimlarPage-L1.js'].map((p) => ORIGIN + p);
    const classified = classifyRequests(MANIFEST, urls, { graph: GRAPH });
    expect(classified.map((item) => item.class)).toEqual(['entry', 'antd', 'antd', 'wide', 'echarts', 'page']);
    expect([...PHONE_FORBIDDEN_CLASSES]).toEqual(['antd', 'pro', 'icons', 'echarts', 'wide']);
    expect(deliveryViolations(classified)).toEqual([
      'antd: assets/antd-N1.js (chunk:antd)',
      'echarts: assets/core-C1.js (chunk:core)',
      'wide: assets/wide-G1.css (chunk:wide)',
    ]);
    expect(deliveryViolations(classifyRequests(MANIFEST, [ORIGIN + 'assets/admin-A1.js', ORIGIN + 'assets/shared-S1.js'], { graph: GRAPH }))).toEqual([]);
    expect(deliveryViolations(classified, ['wide'])).toEqual(['wide: assets/wide-G1.css (chunk:wide)']);
  });

  it('readBuildManifest dist/.vite altındaki manifesti ve (varsa) delivery-graph dosyasını okur', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'aile-f09-'));
    try {
      await expect(readBuildManifest(dist)).rejects.toThrow(/manifest\.json okunamadı/);
      await mkdir(join(dist, '.vite'));
      await writeFile(join(dist, '.vite', 'manifest.json'), JSON.stringify(MANIFEST));
      expect(await readBuildManifest(dist)).toEqual({ manifest: MANIFEST, graph: null });
      await writeFile(join(dist, '.vite', 'delivery-graph.json'), JSON.stringify(GRAPH));
      expect((await readBuildManifest(dist)).graph).toEqual(GRAPH);
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });
});

describe('classifyDevRequest (Vite geliştirme sunucusu modül isteği → teslim sınıfı)', () => {
  it('ön paketlenmiş bağımlılıkları, node_modules yollarını ve kaynak modüllerini CHUNK_GROUPS kurallarıyla sınıflar', () => {
    const cls = (path: string) => classifyDevRequest('http://127.0.0.1:5494' + path).class;
    expect(cls('/aile/node_modules/.vite/deps/antd.js?v=1a2b')).toBe('antd');
    expect(cls('/aile/node_modules/.vite/deps/@ant-design_icons.js?v=1a2b')).toBe('icons');
    expect(cls('/aile/node_modules/.vite/deps/@ant-design_pro-components.js?v=1a2b')).toBe('pro');
    expect(cls('/aile/node_modules/.vite/deps/@rc-component_util.js')).toBe('antd');
    expect(cls('/aile/node_modules/.vite/deps/echarts_core.js?v=1')).toBe('echarts');
    expect(cls('/aile/node_modules/.vite/deps/zrender_lib_core_util.js')).toBe('echarts');
    expect(cls('/aile/node_modules/.vite/deps/react-dom_client.js')).toBe('shared');
    expect(cls('/aile/node_modules/.vite/deps/wouter.js')).toBe('router');
    expect(cls('/aile/node_modules/.vite/deps/chunk-ABCD1234.js?v=1')).toBe('unknown');
    expect(cls('/aile/node_modules/.vite/deps/zod.js')).toBe('app');
    expect(cls('/aile/@fs/Users/x/aile/node_modules/.pnpm/antd@6.0.0/node_modules/antd/es/button/index.js')).toBe('antd');
    expect(cls('/aile/node_modules/.pnpm/wouter@3.7.1/node_modules/wouter/src/use-hash-location.js')).toBe('shared');
    expect(cls('/aile/src/admin/ui/wide/Table.wide.tsx')).toBe('wide');
    expect(cls('/aile/src/admin/pages/AlimlarPage.wide.tsx?t=123')).toBe('wide');
    expect(cls('/aile/src/admin/ui/wide/helpers.ts')).toBe('wide');
    expect(cls('/aile/src/design/tokens.ts')).toBe('tokens');
    expect(cls('/aile/src/admin/pages/AlimlarPage.tsx')).toBe('page');
    expect(cls('/aile/src/admin/ui/Button.tsx')).toBe('app');
    expect(cls('/aile/src/admin/admin.css?direct')).toBe('app');
    expect(cls('/aile/@vite/client')).toBe('other');
    expect(cls('/aile/admin.html')).toBe('other');
    expect(classifyDevRequest('http://127.0.0.1:5494/aile/node_modules/.vite/deps/antd.js?v=1')).toEqual({
      url: 'http://127.0.0.1:5494/aile/node_modules/.vite/deps/antd.js?v=1', file: 'node_modules/.vite/deps/antd.js', class: 'antd', label: 'antd', source: 'dev',
    });
  });
});
// #endregion

describe('tarayıcıya kaynak metin olarak aktarım', () => {
  it('her dedektör modül kapsamına bağlı değildir: toString() ile yeniden kurulup çalışır', () => {
    mount('<p id="k">Fiyat yok</p><div id="m">M</div><button id="t">Ek</button>');
    const { env, css } = makeEnv();
    css($('#k'), { 'font-size': '12px' });
    css($('#m'), { 'transition-property': 'opacity', 'transition-duration': '1s', 'transition-timing-function': 'linear' });
    const rebuild = <F>(fn: F): F => new Function(`return (${String(fn)})`)() as F;
    expect(rebuild(smallTextViolations)({ root: '#kok', env })).toHaveLength(1);
    expect(rebuild(motionViolations)('cubic-bezier(.65,0,.35,1)', 240, { root: '#kok', env })).toHaveLength(1);
    expect(rebuild(focusRingViolations)({ target: '#k', keyboard: true, env }).join()).toMatch(/gösterge yok/);
    expect(rebuild(accentEdgeViolations)({ root: '#kok', env })).toEqual([]);
    expect(rebuild(overflowViolations)({ root: '#kok', env })).toEqual([]);
    expect(rebuild(touchTargetViolations)({ root: '#kok', env }).join()).toMatch(/dokunma alanı/);
    expect(rebuild(safeAreaViolations)({ root: '#kok', env, insets: { top: 47 } }).join()).toMatch(/güvenli alan/);
    expect(rebuild(virtualKeyboardViolations)({ target: '#k', keyboard: 300, env })).toEqual([]);
    expect(rebuild(clippedTextViolations)({ root: '#kok', env })).toEqual([]);
    expect(rebuild(emulateSafeAreaInsets)({ top: 47 })).toBe(0);
  });

  it('detectors kaydı tüm tarayıcı dedektörlerini içerir; detectorScript her biri için tek ifade üretir', () => {
    const names = ['focusRingViolations', 'smallTextViolations', 'accentEdgeViolations', 'overflowViolations', 'motionViolations', 'touchTargetViolations', 'safeAreaViolations', 'virtualKeyboardViolations', 'clippedTextViolations'];
    expect(Object.keys(detectors)).toEqual(names);
    expect(() => new Function(`return ${detectorScript('touchTargetViolations', { root: '#kok', coarse: true })}`)).not.toThrow();
    expect(() => new Function(`return ${detectorScript('safeAreaViolations', { insets: { bottom: 34 } })}`)).not.toThrow();
    expect(() => new Function(`return ${detectorScript('virtualKeyboardViolations', { target: '#t', keyboard: 300 })}`)).not.toThrow();
    expect(() => new Function(`return ${detectorScript('clippedTextViolations', { root: '#kok' })}`)).not.toThrow();
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
    for (const name of ['focusRingViolations', 'smallTextViolations', 'accentEdgeViolations', 'overflowViolations', 'motionViolations', 'touchTargetViolations', 'safeAreaViolations', 'virtualKeyboardViolations', 'clippedTextViolations']) expect(script).toContain(name);
  });
});
