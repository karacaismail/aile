/**
 * Yönetim paneli e2e kural dedektörleri (tarayıcıda çalışır).
 *
 * Her dedektör ihlalleri okunur Türkçe metin listesi olarak döndürür; boş liste = temiz. Kurallar:
 *  - focusRingViolations: çevreleyen odak halkası yasak (outline, halka box-shadow, sözde öğe çerçevesi); klavye modunda
 *    kontrolün 4 px altında, kontrol genişliğinde tek 3 px ::after çizgisi zorunlu (satırda alt kenar); işaretçi modunda
 *    gösterge görünmez. Tek istisna forced-colors + klavye modunda 2px solid outline.
 *  - smallTextViolations: görünür metin (metin düğümü, form değeri, sözde öğe metni) en az 14 CSS px.
 *  - accentEdgeViolations: radiuslu kutuda, değdiği köşelerden en az biri radiuslu tek kenar şeridi yasak
 *    (kenarlık, inset box-shadow, sözde öğe).
 *  - overflowViolations: sayfa düzeyinde yatay taşma ve görünüm alanından taşan öğe (kaydırma kapsayıcısı içindekiler hariç);
 *    kesilen etiket/eylem metni (ellipsis, nowrap+hidden, line-clamp).
 *  - motionViolations: sıfırdan büyük her transition/animation tek süre ve tek eğride; reduced-motion açıkken süre 0.
 *  - touchTargetViolations: etkin dokunma alanı en az 44×44 (kaba işaretçide 48×48), aynı katmanda örtüşme yok, hedef
 *    başka bir öğenin altında değil.
 *  - safeAreaViolations: metin, hedef ve medya güvenli alan bantlarına (env(safe-area-inset-*)) girmez; emulateSafeAreaInsets
 *    Playwright'ta sıfır olan bu değerleri benzetir.
 *  - virtualKeyboardViolations: odaktaki düzenlenebilir alan sanal klavye açıkken görünür banda getirilebilir ve orada
 *    sabit/yapışkan bir öğenin altında kalmaz.
 *  - clippedTextViolations: görünür metin kırpan bir ata ya da görünüm alanı tarafından kesilmez.
 *  - Ağ isteği → teslim sınıfı (Node tarafı, dosyanın sonunda): manifestClassifier, classifyRequests, classifyDevRequest,
 *    deliveryViolations, readBuildManifest.
 *
 * ÖNEMLİ: Dedektörler page.evaluate'e kaynak metin olarak verilir (detectorScript/runDetector). Bu yüzden her biri kendi
 * içinde tamamdır: modül kapsamındaki hiçbir değere, yardımcıya veya sabite başvurmaz (yalnız tipler). Ortak yardımcılar
 * bilerek her fonksiyonun içinde tekrar tanımlanır. `env` yalnız birim testleri içindir (jsdom yerleşim hesaplamaz);
 * tarayıcıda verilmez ve gerçek getComputedStyle/getBoundingClientRect kullanılır.
 *
 * Muafiyet öznitelikleri (bilinçli, gerekçeli kullanım için): data-allow-overflow (taşma), data-allow-truncate (metin
 * kesme; tam metin başka yolla erişilebilir olmalı), data-allow-motion (hareket), data-allow-touch-target (dokunma alanı),
 * data-allow-safe-area (güvenli alana bilerek taşan zemin).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export interface DetectorRect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface DetectorEnv {
  style(el: Element, pseudo?: string): { getPropertyValue(name: string): string };
  rect(el: Element): DetectorRect;
  viewport(): { width: number; height: number };
  media(query: string): boolean;
  scroll(el: Element): { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number; scrollTop?: number; scrollLeft?: number };
  /** Noktadaki en üst öğe (document.elementFromPoint); yoksa örtülme denetimleri yalnız geometriyle yapılır. */
  hit?(x: number, y: number): Element | null;
  /** Metin düğümünün satır kutuları (Range.getClientRects); yoksa üst öğenin kutusu kullanılır. */
  textRects?(node: Text): DetectorRect[];
  /** Görsel görünüm alanı (window.visualViewport); yoksa null. */
  visualViewport?(): { offsetTop: number; offsetLeft: number; width: number; height: number } | null;
}
/** Kök: öğe ya da CSS seçicisi (tarayıcıya aktarımda yalnız seçici serileştirilebilir). Varsayılan document.body. */
export type DetectorRoot = Element | string | null;
export interface FocusRingOptions {
  /** Denetlenecek odaklı öğe; varsayılan document.activeElement. */
  target?: Element | string | null;
  /** Klavye modu; varsayılan html[data-keyboard='true']. */
  keyboard?: boolean;
  /** Çizgi kalınlığı (odakKalinlik), varsayılan 3. */
  thickness?: number;
  /** Kontrol ile çizgi arası (odakAralik), varsayılan 4. */
  gap?: number;
  /** Halka/çizgi taşıyıcısı sayılacak en çok ata sayısı (affix, select seçici), varsayılan 3. */
  depth?: number;
  env?: DetectorEnv;
}
export interface RootOptions { root?: DetectorRoot; max?: number; env?: DetectorEnv }
export interface SmallTextOptions extends RootOptions { min?: number }
export interface OverflowOptions extends RootOptions { tolerance?: number; truncation?: boolean }
export interface MotionOptions extends RootOptions { reduced?: boolean }
export interface TouchTargetOptions extends RootOptions {
  /** Asgari kenar (px); varsayılan kaba işaretçide 48, değilse 44 (hedefAsgari). */
  min?: number;
  /** Kaba işaretçi katmanı; varsayılan html[data-input-coarse] (AdaptiveRoot) ya da (any-pointer: coarse). */
  coarse?: boolean;
  /** Aynı katmandaki hedeflerin etkin alanları örtüşmesin (varsayılan true). */
  overlap?: boolean;
  /** Hedefin görünür merkezi sabit olmayan başka bir öğeyle örtülmesin (varsayılan true; tarayıcıda elementFromPoint). */
  occlusion?: boolean;
}
export interface SafeAreaInsets { top?: number; right?: number; bottom?: number; left?: number }
export interface SafeAreaOptions extends RootOptions {
  /** Güvenli alan bantları (px); varsayılan html[data-detector-safe-area], o da yoksa gerçek env() ölçümü. */
  insets?: SafeAreaInsets;
  tolerance?: number;
}
export interface VirtualKeyboardOptions {
  /** Denetlenecek alan; varsayılan document.activeElement. Düzenlenebilir değilse sonuç boştur. */
  target?: Element | string | null;
  /** Benzetilen klavye yüksekliği (px). Verilmezse küçülmüş visualViewport kullanılır; o da yoksa klavye yok sayılır. */
  keyboard?: number;
  tolerance?: number;
  max?: number;
  env?: DetectorEnv;
}
export interface ClippedTextOptions extends RootOptions {
  tolerance?: number;
  /** Görünüm alanının kenarı da kırpar (varsayılan true). */
  viewport?: boolean;
}

export function focusRingViolations(opts: FocusRingOptions = {}): string[] {
  const env: DetectorEnv = opts.env || {
    style: (el, pseudo) => window.getComputedStyle(el, pseudo || null),
    rect: (el) => el.getBoundingClientRect(),
    viewport: () => ({ width: document.documentElement.clientWidth, height: window.innerHeight }),
    media: (q) => window.matchMedia(q).matches,
    scroll: (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }),
  };
  const label = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + (text ? '[' + text + ']' : '');
  };
  const px = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const visibleColor = (c: string) => {
    if (!c) return true;
    if (c === 'transparent') return false;
    const m = c.match(/rgba?\(([^)]*)\)/);
    if (!m) return true;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length < 4 || parseFloat(parts[3]) > 0;
  };
  const shadows = (v: string) => {
    if (!v || v === 'none') return [];
    const raw: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of v) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { raw.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) raw.push(cur.trim());
    return raw.map((layer) => {
      const color = (layer.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)|#[0-9a-f]{3,8}\b/i) || [''])[0];
      const rest = layer.replace(color, ' ').replace(/\binset\b/, ' ');
      const nums = (rest.match(/-?\d*\.?\d+(?:px)?/g) || []).map((n) => parseFloat(n));
      return { inset: /\binset\b/.test(layer), color, x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0 };
    });
  };
  const isRing = (s: { x: number; y: number; blur: number; spread: number; color: string }) =>
    s.x === 0 && s.y === 0 && (s.blur > 0 || s.spread !== 0) && visibleColor(s.color);
  const hasContent = (c: string) => Boolean(c) && c !== 'none' && c !== 'normal';

  const target = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target === undefined ? document.activeElement : opts.target;
  if (!target || target === document.body || target === document.documentElement) return [];
  const keyboard = opts.keyboard !== undefined ? opts.keyboard : document.documentElement.getAttribute('data-keyboard') === 'true';
  const thickness = opts.thickness ?? 3;
  const gap = opts.gap ?? 4;
  const maxDepth = opts.depth ?? 3;
  const forced = env.media('(forced-colors: active)');

  // Taşıyıcılar: hedef + yalnız bu kontrolü saran atalar (birden çok odaklanabilir içeren kapsayıcıda durulur).
  const FOCUSABLE = 'a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const carriers: Element[] = [target];
  let parent = target.parentElement;
  while (parent && carriers.length <= maxDepth && parent !== document.body && parent !== document.documentElement) {
    if (parent.querySelectorAll(FOCUSABLE).length > 1) break;
    if (/^(dialog|alertdialog|main|navigation|region|form|banner|complementary)$/.test(parent.getAttribute('role') || '')) break;
    carriers.push(parent);
    parent = parent.parentElement;
  }

  const out: string[] = [];
  let forcedIndicator = false;
  for (const c of carriers) {
    const s = env.style(c);
    const os = s.getPropertyValue('outline-style');
    const ow = px(s.getPropertyValue('outline-width'));
    const forcedException = forced && keyboard && c === target && os === 'solid' && Math.abs(ow - 2) < 0.5;
    if (forcedException) forcedIndicator = true;
    if (os && os !== 'none' && ow > 0 && !forcedException) out.push(`${label(c)}: outline ${ow}px ${os} (çevreleyen halka)`);
    if (shadows(s.getPropertyValue('box-shadow')).some(isRing)) out.push(`${label(c)}: box-shadow halkası (${s.getPropertyValue('box-shadow')})`);
    for (const pseudo of ['::before', '::after']) {
      const ps = env.style(c, pseudo);
      if (!hasContent(ps.getPropertyValue('content'))) continue;
      const pos = ps.getPropertyValue('outline-style');
      if (pos && pos !== 'none' && px(ps.getPropertyValue('outline-width')) > 0) out.push(`${label(c)}${pseudo}: outline (çevreleyen halka)`);
      if (shadows(ps.getPropertyValue('box-shadow')).some(isRing)) out.push(`${label(c)}${pseudo}: box-shadow halkası`);
      const framed = ['top', 'right', 'bottom', 'left'].every((side) => {
        const st = ps.getPropertyValue(`border-${side}-style`);
        return px(ps.getPropertyValue(`border-${side}-width`)) > 0 && st !== '' && st !== 'none' && st !== 'hidden';
      });
      if (framed) out.push(`${label(c)}${pseudo}: dört kenarlı çevreleyen çerçeve`);
    }
  }

  // Gösterge: taşıyıcılardan birinde kalınlıkta, saydam olmayan ::after çizgisi.
  let found: Element | null = null;
  let anyLine = false;
  let problem = '';
  for (const c of carriers) {
    const ps = env.style(c, '::after');
    if (!hasContent(ps.getPropertyValue('content'))) continue;
    if (ps.getPropertyValue('display') === 'none' || ps.getPropertyValue('visibility') === 'hidden') continue;
    if (Math.abs(px(ps.getPropertyValue('height')) - thickness) > 0.5) continue;
    if (!visibleColor(ps.getPropertyValue('background-color'))) continue;
    anyLine = true;
    const s = env.style(c);
    const r = env.rect(c);
    const inner = r.width - px(s.getPropertyValue('border-left-width')) - px(s.getPropertyValue('border-right-width'));
    const wRaw = ps.getPropertyValue('width');
    const w = /px$/.test(wRaw) ? px(wRaw) : px(ps.getPropertyValue('left')) === 0 && px(ps.getPropertyValue('right')) === 0 ? inner : NaN;
    const row = c.tagName === 'TR' || c.getAttribute('role') === 'row' || c.classList.contains('ant-list-item');
    const expectedBottom = row ? 0 : -(gap + thickness);
    const bRaw = ps.getPropertyValue('bottom');
    if (!(Math.abs(w - r.width) <= 1 || Math.abs(w - inner) <= 1)) {
      problem = `${label(c)}::after genişlik ${wRaw || 'yok'} (kontrol ${Math.round(r.width)}px)`;
      continue;
    }
    if (!/px$/.test(bRaw) || Math.abs(px(bRaw) - expectedBottom) > 0.5) {
      problem = `${label(c)}::after konum bottom ${bRaw || 'yok'} (beklenen ${expectedBottom}px)`;
      continue;
    }
    found = c;
    break;
  }
  // forced-colors istisnasında izinli 2px outline'ın kendisi görünür göstergedir.
  if (keyboard && !found && !forcedIndicator) out.push(problem || `${label(target)}: klavye odağı görünmez, gösterge yok`);
  if (!keyboard && anyLine) out.push(`${label(target)}: odak göstergesi klavye modu dışında görünür`);
  return out;
}

export function smallTextViolations(opts: SmallTextOptions = {}): string[] {
  const env: DetectorEnv = opts.env || {
    style: (el, pseudo) => window.getComputedStyle(el, pseudo || null),
    rect: (el) => el.getBoundingClientRect(),
    viewport: () => ({ width: document.documentElement.clientWidth, height: window.innerHeight }),
    media: (q) => window.matchMedia(q).matches,
    scroll: (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }),
  };
  const label = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    const text = (el.getAttribute('aria-label') || '').trim().slice(0, 24);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + (text ? '[' + text + ']' : '');
  };
  const px = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const root = typeof opts.root === 'string' ? document.querySelector(opts.root) : opts.root || document.body;
  if (!root) return [`kök bulunamadı: ${String(opts.root)}`];
  const min = opts.min ?? 14;
  const max = opts.max ?? 40;

  const hiddenCache = new Map<Element, boolean>();
  const hidden = (el: Element): boolean => {
    const cached = hiddenCache.get(el);
    if (cached !== undefined) return cached;
    const s = env.style(el);
    let result = s.getPropertyValue('display') === 'none' || s.getPropertyValue('opacity') === '0';
    if (!result && el.parentElement && el !== document.documentElement) result = hidden(el.parentElement);
    hiddenCache.set(el, result);
    return result;
  };
  const invisible = (el: Element) => {
    const s = env.style(el);
    if (s.getPropertyValue('visibility') === 'hidden' || s.getPropertyValue('visibility') === 'collapse') return true;
    if (hidden(el)) return true;
    const r = env.rect(el);
    if (r.width === 0 || r.height === 0) return true;
    if (r.width <= 1 && r.height <= 1) return true; // görsel olarak gizli (sr-only)
    if (/rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(s.getPropertyValue('clip')) || s.getPropertyValue('clip-path') === 'inset(50%)') return true;
    return false;
  };

  const out: string[] = [];
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('script, style, noscript, template')) continue;
    if (invisible(el)) continue;
    const size = px(env.style(el).getPropertyValue('font-size'));
    if (size < min - 0.01) out.push(`${label(el)} ${size}px < ${min}px: "${text.slice(0, 40)}"`);
  }
  const controls = root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), textarea, select');
  for (const el of Array.from(controls)) {
    const field = el as HTMLInputElement;
    const text = (field.value || field.getAttribute('placeholder') || '').trim();
    if (!text || invisible(el)) continue;
    const size = px(env.style(el).getPropertyValue('font-size'));
    if (size < min - 0.01) out.push(`${label(el)} ${size}px < ${min}px: "${text.slice(0, 40)}"`);
  }
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    for (const pseudo of ['::before', '::after']) {
      const ps = env.style(el, pseudo);
      const m = ps.getPropertyValue('content').match(/^"(.*)"$/);
      if (!m || !m[1].trim()) continue;
      if (ps.getPropertyValue('display') === 'none' || ps.getPropertyValue('visibility') === 'hidden' || invisible(el)) continue;
      const size = px(ps.getPropertyValue('font-size'));
      if (size < min - 0.01) out.push(`${label(el)}${pseudo} ${size}px < ${min}px: "${m[1].trim().slice(0, 40)}"`);
    }
  }
  return out.slice(0, max);
}

export function accentEdgeViolations(opts: RootOptions = {}): string[] {
  const env: DetectorEnv = opts.env || {
    style: (el, pseudo) => window.getComputedStyle(el, pseudo || null),
    rect: (el) => el.getBoundingClientRect(),
    viewport: () => ({ width: document.documentElement.clientWidth, height: window.innerHeight }),
    media: (q) => window.matchMedia(q).matches,
    scroll: (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }),
  };
  const label = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + (text ? '[' + text + ']' : '');
  };
  const px = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const isPx = (v: string) => /^-?\d*\.?\d+px$/.test(v.trim());
  const visibleColor = (c: string) => {
    if (!c) return true;
    if (c === 'transparent') return false;
    const m = c.match(/rgba?\(([^)]*)\)/);
    if (!m) return true;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length < 4 || parseFloat(parts[3]) > 0;
  };
  const root = typeof opts.root === 'string' ? document.querySelector(opts.root) : opts.root || document.body;
  if (!root) return [`kök bulunamadı: ${String(opts.root)}`];
  const max = opts.max ?? 40;
  const SIDES = ['top', 'right', 'bottom', 'left'] as const;
  const NAMES: Record<string, string> = { top: 'üst', right: 'sağ', bottom: 'alt', left: 'sol' };
  const CORNERS: Record<string, [string, string]> = {
    top: ['top-left', 'top-right'],
    right: ['top-right', 'bottom-right'],
    bottom: ['bottom-left', 'bottom-right'],
    left: ['top-left', 'bottom-left'],
  };

  const out: string[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const s = env.style(el);
    if (s.getPropertyValue('display') === 'none' || s.getPropertyValue('visibility') === 'hidden') continue;
    const r = env.rect(el);
    if (r.width === 0 || r.height === 0) continue;
    const radius: Record<string, number> = {};
    for (const corner of ['top-left', 'top-right', 'bottom-right', 'bottom-left']) radius[corner] = px(s.getPropertyValue(`border-${corner}-radius`));
    const touchesRadius = (side: string) => CORNERS[side].some((corner) => radius[corner] > 0);
    if (!Object.values(radius).some((v) => v > 0)) continue;

    // 1) Kenarlık: çoğunluktan farklı her mevcut kenar şerittir.
    const specs = SIDES.map((side) => {
      const w = px(s.getPropertyValue(`border-${side}-width`));
      const st = s.getPropertyValue(`border-${side}-style`);
      const color = s.getPropertyValue(`border-${side}-color`);
      const present = w > 0 && st !== '' && st !== 'none' && st !== 'hidden' && visibleColor(color);
      return present ? `${w}px ${st} ${color}` : '';
    });
    const counts = new Map<string, number>();
    for (const spec of specs) counts.set(spec, (counts.get(spec) || 0) + 1);
    let mode = '';
    let best = -1;
    for (const [spec, n] of counts) if (n > best || (n === best && spec === '')) { mode = spec; best = n; }
    SIDES.forEach((side, i) => {
      if (specs[i] && specs[i] !== mode && touchesRadius(side)) out.push(`${label(el)}: radiuslu kutuda tek kenar şeridi (${NAMES[side]} ${specs[i]})`);
    });

    // 2) inset box-shadow şeridi: tek eksende kaydırılmış, bulanıksız iç gölge.
    const raw = s.getPropertyValue('box-shadow');
    if (raw && raw !== 'none') {
      const layers: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of raw) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { layers.push(cur.trim()); cur = ''; } else cur += ch;
      }
      if (cur.trim()) layers.push(cur.trim());
      for (const layer of layers) {
        if (!/\binset\b/.test(layer)) continue;
        const color = (layer.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)|#[0-9a-f]{3,8}\b/i) || [''])[0];
        if (!visibleColor(color)) continue;
        const nums = (layer.replace(color, ' ').replace(/\binset\b/, ' ').match(/-?\d*\.?\d+(?:px)?/g) || []).map((n) => parseFloat(n));
        const [x = 0, y = 0, blur = 0, spread = 0] = nums;
        if (blur !== 0 || spread !== 0 || (x !== 0) === (y !== 0)) continue;
        const side = x > 0 ? 'left' : x < 0 ? 'right' : y > 0 ? 'top' : 'bottom';
        if (touchesRadius(side)) out.push(`${label(el)}: radiuslu kutuda inset box-shadow şeridi (${NAMES[side]})`);
      }
    }

    // 3) Sözde öğe şeridi: kutunun kenarına yapışık, ince ve kenar boyunca uzanan konumlu çizgi.
    for (const pseudo of ['::before', '::after']) {
      const ps = env.style(el, pseudo);
      const content = ps.getPropertyValue('content');
      if (!content || content === 'none' || content === 'normal') continue;
      if (!/^(absolute|fixed)$/.test(ps.getPropertyValue('position'))) continue;
      if (ps.getPropertyValue('display') === 'none' || ps.getPropertyValue('visibility') === 'hidden') continue;
      const painted = visibleColor(ps.getPropertyValue('background-color')) && ps.getPropertyValue('background-color') !== '';
      if (!painted) continue;
      const w = px(ps.getPropertyValue('width'));
      const h = px(ps.getPropertyValue('height'));
      const at = (prop: string) => { const v = ps.getPropertyValue(prop); return isPx(v) && Math.abs(px(v)) <= 0.5; };
      let side = '';
      if (w > 0 && w <= 8 && h >= r.height * 0.5) side = at('left') ? 'left' : at('right') ? 'right' : '';
      else if (h > 0 && h <= 8 && w >= r.width * 0.5) side = at('top') ? 'top' : at('bottom') ? 'bottom' : '';
      if (side && touchesRadius(side)) out.push(`${label(el)}${pseudo}: radiuslu kutuda sözde öğe şeridi (${NAMES[side]})`);
    }
  }
  return out.slice(0, max);
}

export function overflowViolations(opts: OverflowOptions = {}): string[] {
  const env: DetectorEnv = opts.env || {
    style: (el, pseudo) => window.getComputedStyle(el, pseudo || null),
    rect: (el) => el.getBoundingClientRect(),
    viewport: () => ({ width: document.documentElement.clientWidth, height: window.innerHeight }),
    media: (q) => window.matchMedia(q).matches,
    scroll: (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }),
  };
  const label = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + (text ? '[' + text + ']' : '');
  };
  const root = typeof opts.root === 'string' ? document.querySelector(opts.root) : opts.root || document.body;
  if (!root) return [`kök bulunamadı: ${String(opts.root)}`];
  const tol = opts.tolerance ?? 1;
  const max = opts.max ?? 20;
  const out: string[] = [];

  const page = env.scroll(document.scrollingElement || document.documentElement);
  if (page.scrollWidth > page.clientWidth + tol) out.push(`sayfa yatay taşıyor: ${page.scrollWidth}px > ${page.clientWidth}px`);

  const clips = (v: string) => v === 'auto' || v === 'scroll' || v === 'hidden' || v === 'clip';
  const contained = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      if (clips(env.style(p).getPropertyValue('overflow-x'))) return true;
    }
    return false;
  };
  const vw = env.viewport().width;
  const reported: Element[] = [];
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    if (el.closest('[data-allow-overflow]')) continue;
    if (reported.some((r) => r.contains(el))) continue;
    const s = env.style(el);
    if (s.getPropertyValue('display') === 'none' || s.getPropertyValue('visibility') === 'hidden') continue;
    const r = env.rect(el);
    if (r.width === 0 || r.height === 0 || (r.width <= 1 && r.height <= 1)) continue;
    if (r.right > vw + tol || r.left < -tol) {
      if (contained(el)) continue;
      out.push(`${label(el)}: görünüm alanından taşıyor (sol ${Math.round(r.left)}px, sağ ${Math.round(r.right)}px, genişlik ${vw}px)`);
      reported.push(el);
    }
  }

  if (opts.truncation !== false) {
    for (const el of all) {
      if (el.closest('[data-allow-truncate]')) continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim());
      if (!own) continue;
      const s = env.style(el);
      if (s.getPropertyValue('display') === 'none' || s.getPropertyValue('visibility') === 'hidden') continue;
      // Görsel olarak gizli metin (sr-only: ≤ 2 px kutu, sıfır clip ya da inset(50%) clip-path) görünür etiket değildir;
      // ekran okuyucu tam metni okur, kesme kuralı ona uygulanmaz.
      const box = env.rect(el);
      const clipValue = s.getPropertyValue('clip').replace(/\s+/g, '');
      if ((box.width <= 2 && box.height <= 2) || /^rect\(0(px)?,?0(px)?,?0(px)?,?0(px)?\)$/.test(clipValue) || /^inset\(50%\)$/.test(s.getPropertyValue('clip-path').replace(/\s+/g, ''))) continue;
      const ox = s.getPropertyValue('overflow-x');
      const oneLine = s.getPropertyValue('text-overflow') === 'ellipsis' || ((ox === 'hidden' || ox === 'clip') && s.getPropertyValue('white-space') === 'nowrap');
      const clamp = s.getPropertyValue('-webkit-line-clamp');
      const clamped = Boolean(clamp) && clamp !== 'none';
      if (!oneLine && !clamped) continue;
      const m = env.scroll(el);
      if (oneLine && m.scrollWidth > m.clientWidth + 1) out.push(`${label(el)}: metin kesiliyor (${m.scrollWidth}px > ${m.clientWidth}px)`);
      else if (clamped && m.scrollHeight > m.clientHeight + 1) out.push(`${label(el)}: metin satır sınırında kesiliyor (${m.scrollHeight}px > ${m.clientHeight}px)`);
    }
  }
  return out.slice(0, max);
}

export function motionViolations(expectedEase?: string | null, expectedMs?: number | null, opts: MotionOptions = {}): string[] {
  const env: DetectorEnv = opts.env || {
    style: (el, pseudo) => window.getComputedStyle(el, pseudo || null),
    rect: (el) => el.getBoundingClientRect(),
    viewport: () => ({ width: document.documentElement.clientWidth, height: window.innerHeight }),
    media: (q) => window.matchMedia(q).matches,
    scroll: (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }),
  };
  const label = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
  };
  const ease = expectedEase == null ? 'cubic-bezier(.65,0,.35,1)' : expectedEase;
  const target = expectedMs == null ? 240 : expectedMs;
  const root = typeof opts.root === 'string' ? document.querySelector(opts.root) : opts.root || document.body;
  if (!root) return [`kök bulunamadı: ${String(opts.root)}`];
  const max = opts.max ?? 30;
  const reduced = opts.reduced !== undefined ? opts.reduced : env.media('(prefers-reduced-motion: reduce)');

  const list = (v: string) => {
    const items: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of v || '') {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { items.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) items.push(cur.trim());
    return items;
  };
  const ms = (v: string) => { const n = parseFloat(v); if (!Number.isFinite(n)) return 0; return /ms$/.test(v.trim()) ? n : n * 1000; };
  const KEYWORDS: Record<string, number[]> = { ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1], linear: [0, 0, 1, 1] };
  const curve = (v: string) => {
    const t = v.trim().toLowerCase();
    if (KEYWORDS[t]) return KEYWORDS[t];
    const m = t.match(/^cubic-bezier\(([^)]*)\)$/);
    return m ? m[1].split(',').map((n) => parseFloat(n)) : null;
  };
  const sameEase = (a: string) => {
    const x = curve(a);
    const y = curve(ease);
    if (!x || !y || x.length !== 4 || y.length !== 4) return a.replace(/\s/g, '') === ease.replace(/\s/g, '');
    return x.every((n, i) => Math.abs(n - y[i]) < 0.001);
  };

  const out = new Map<string, string>();
  const check = (where: string, kind: string, what: string, duration: number, timing: string) => {
    if (!(duration > 0)) return;
    const issues: string[] = [];
    if (reduced) issues.push(`reduced-motion açıkken ${duration}ms (beklenen 0)`);
    else {
      if (Math.abs(duration - target) > 1) issues.push(`${duration}ms (beklenen ${target}ms)`);
      if (!sameEase(timing)) issues.push(`eğri ${timing} (beklenen ${ease})`);
    }
    if (!issues.length) return;
    const key = `${where}|${kind}|${what}|${issues.join()}`;
    if (!out.has(key)) out.set(key, `${where}: ${kind} ${what} ${issues.join(', ')}`);
  };

  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (el.closest('[data-allow-motion]')) continue;
    if (env.style(el).getPropertyValue('display') === 'none') continue;
    for (const pseudo of ['', '::before', '::after']) {
      const s = env.style(el, pseudo || undefined);
      if (pseudo) {
        const content = s.getPropertyValue('content');
        if (!content || content === 'none' || content === 'normal') continue;
      }
      const where = label(el) + pseudo;
      const props = list(s.getPropertyValue('transition-property'));
      const durations = list(s.getPropertyValue('transition-duration'));
      const timings = list(s.getPropertyValue('transition-timing-function'));
      if (durations.length) {
        props.forEach((prop, i) => {
          if (prop === 'none') return;
          check(where, 'transition', prop, ms(durations[i % durations.length]), timings.length ? timings[i % timings.length] : 'ease');
        });
      }
      const names = list(s.getPropertyValue('animation-name'));
      const aDurations = list(s.getPropertyValue('animation-duration'));
      const aTimings = list(s.getPropertyValue('animation-timing-function'));
      if (aDurations.length) {
        names.forEach((name, i) => {
          if (name === 'none') return;
          check(where, 'animation', name, ms(aDurations[i % aDurations.length]), aTimings.length ? aTimings[i % aTimings.length] : 'ease');
        });
      }
    }
  }
  return Array.from(out.values()).slice(0, max);
}

/**
 * Etkin dokunma alanı: her görünür, etkin hedef en az `min` × `min` px (ince işaretçide 44, kaba işaretçide 48). Etkin
 * alan = hedefin kutusu + konumlu hedefteki mutlak ::before/::after genişletmesi + ilişkili <label> + yalnız bu hedefi
 * saran ve imleci kendisi bildiren (pointer; metin alanında text) ya da tıklamayı ileten (rc-input affix) en çok 3 ata;
 * parçalar birbirine değdikçe birleşir.
 * Muaf: gizli, devre dışı, inert/aria-hidden altı, pointer-events:none, metin içi satır bağlantısı (WCAG 2.5.8),
 * data-allow-touch-target. Örtüşme: aynı katmandaki (sabit/yapışkan/dialog/menü/liste) iki hedefin etkin alanı 1 px'ten
 * fazla kesişirse; kesişimi üçüncü bir öğe örtüyorsa sayılmaz. Örtülme (env.hit gerekir): hedefin görünür merkezindeki en
 * üst öğe hedefin parçası değilse; sabit/yapışkan örtü (alt çubuk, perde) sayılmaz.
 */
export function touchTargetViolations(opts: TouchTargetOptions = {}): string[] {
  const env: DetectorEnv = opts.env || {
    style: (el, pseudo) => window.getComputedStyle(el, pseudo || null),
    rect: (el) => el.getBoundingClientRect(),
    viewport: () => ({ width: document.documentElement.clientWidth, height: window.innerHeight }),
    media: (q) => window.matchMedia(q).matches,
    scroll: (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft }),
    hit: typeof document.elementFromPoint === 'function' ? (x, y) => document.elementFromPoint(x, y) : undefined,
  };
  const label = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + (text ? '[' + text + ']' : '');
  };
  const px = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const isPx = (v: string) => /^-?\d*\.?\d+px$/.test((v || '').trim());
  const r1 = (n: number) => Math.round(n * 10) / 10;
  type Box = { left: number; top: number; right: number; bottom: number };
  const inter = (a: Box, b: Box): Box => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const unite = (a: Box, b: Box): Box => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) });
  const wOf = (b: Box) => Math.max(0, b.right - b.left);
  const hOf = (b: Box) => Math.max(0, b.bottom - b.top);
  const near = (a: Box, b: Box) => a.left <= b.right + 1 && b.left <= a.right + 1 && a.top <= b.bottom + 1 && b.top <= a.bottom + 1;

  const root = typeof opts.root === 'string' ? document.querySelector(opts.root) : opts.root || document.body;
  if (!root) return [`kök bulunamadı: ${String(opts.root)}`];
  const max = opts.max ?? 40;
  const html = document.documentElement;
  const coarse = opts.coarse !== undefined ? opts.coarse : html.hasAttribute('data-input-coarse') || env.media('(any-pointer: coarse)');
  const min = opts.min ?? (coarse ? 48 : 44);
  const TARGET = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"]), '
    + '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], '
    + '[role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="treeitem"]';

  const styles = new Map<Element, { getPropertyValue(name: string): string }>();
  const st = (el: Element) => { let s = styles.get(el); if (!s) { s = env.style(el); styles.set(el, s); } return s; };
  const shown = new Map<Element, boolean>();
  const displayed = (el: Element): boolean => {
    const cached = shown.get(el);
    if (cached !== undefined) return cached;
    let ok = st(el).getPropertyValue('display') !== 'none';
    if (ok && el.parentElement && el.parentElement !== html) ok = displayed(el.parentElement);
    shown.set(el, ok);
    return ok;
  };
  const visuallyHidden = (el: Element, r: DetectorRect) => {
    const s = st(el);
    return (r.width <= 2 && r.height <= 2)
      || /^rect\(0(px)?,?0(px)?,?0(px)?,?0(px)?\)$/.test(s.getPropertyValue('clip').replace(/\s+/g, ''))
      || /^inset\(50%\)$/.test(s.getPropertyValue('clip-path').replace(/\s+/g, ''));
  };
  const paddingBox = (el: Element): Box => {
    const s = st(el);
    const r = env.rect(el);
    return {
      left: r.left + px(s.getPropertyValue('border-left-width')),
      top: r.top + px(s.getPropertyValue('border-top-width')),
      right: r.right - px(s.getPropertyValue('border-right-width')),
      bottom: r.bottom - px(s.getPropertyValue('border-bottom-width')),
    };
  };
  const pinned = (el: Element) => {
    for (let a: Element | null = el; a && a !== html; a = a.parentElement) {
      const p = st(a).getPropertyValue('position');
      if (p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  };
  const layerOf = (el: Element): Element | null => {
    for (let a: Element | null = el; a && a !== html; a = a.parentElement) {
      const p = st(a).getPropertyValue('position');
      if (p === 'fixed' || p === 'sticky' || a.tagName === 'DIALOG' || a.hasAttribute('popover')) return a;
      if (/^(dialog|alertdialog|menu|listbox)$/.test(a.getAttribute('role') || '')) return a;
    }
    return null;
  };
  // Hedefi kırpan atalar (overflow ≠ visible); sabit konumlu atada durulur (üstündekiler onu kırpmaz).
  const clipOf = (el: Element, b: Box): Box => {
    let out = b;
    if (st(el).getPropertyValue('position') === 'fixed') return out;
    for (let a = el.parentElement; a && a !== html && a !== document.body; a = a.parentElement) {
      const s = st(a);
      if (s.getPropertyValue('display') !== 'contents') {
        const ox = s.getPropertyValue('overflow-x');
        const oy = s.getPropertyValue('overflow-y');
        if ((ox && ox !== 'visible') || (oy && oy !== 'visible')) {
          const pb = paddingBox(a);
          if (ox && ox !== 'visible') out = { left: Math.max(out.left, pb.left), top: out.top, right: Math.min(out.right, pb.right), bottom: out.bottom };
          if (oy && oy !== 'visible') out = { left: out.left, top: Math.max(out.top, pb.top), right: out.right, bottom: Math.min(out.bottom, pb.bottom) };
        }
      }
      if (s.getPropertyValue('position') === 'fixed') break;
    }
    return out;
  };

  type Entry = { el: Element; parts: Element[]; clip: Box; layer: Element | null };
  const entries: Entry[] = [];
  const out: string[] = [];
  const candidates = [root, ...Array.from(root.querySelectorAll(TARGET))].filter((el) => el.matches(TARGET));
  for (const el of candidates) {
    if (el.closest('[data-allow-touch-target], [inert], [aria-hidden="true"]')) continue;
    if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') continue;
    if (!displayed(el)) continue;
    const s = st(el);
    if (/^(hidden|collapse)$/.test(s.getPropertyValue('visibility'))) continue;
    if (s.getPropertyValue('pointer-events') === 'none') continue;
    // Cümle içindeki satır bağlantısı: boyutu çevre metnin satır yüksekliğiyle sınırlı (WCAG 2.5.8 satır içi istisnası).
    if (el.tagName === 'A' && s.getPropertyValue('display') === 'inline' && el.parentElement
      && Array.from(el.parentElement.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim())) continue;
    const r = env.rect(el);
    const parts: Element[] = [];
    const boxes: Box[] = [];
    if (s.getPropertyValue('position') !== 'static') {
      for (const pseudo of ['::before', '::after']) {
        const ps = env.style(el, pseudo);
        const content = ps.getPropertyValue('content');
        if (!content || content === 'none' || content === 'normal') continue;
        if (ps.getPropertyValue('position') !== 'absolute') continue;
        if (ps.getPropertyValue('display') === 'none' || ps.getPropertyValue('visibility') === 'hidden' || ps.getPropertyValue('pointer-events') === 'none') continue;
        const pb = paddingBox(el);
        const span = (start: number, end: number, a: string, b: string, size: string): [number, number] | null => {
          const va = ps.getPropertyValue(a);
          const vb = ps.getPropertyValue(b);
          const vs = ps.getPropertyValue(size);
          if (isPx(va) && isPx(vb)) return [start + px(va), end - px(vb)];
          if (isPx(va) && isPx(vs)) return [start + px(va), start + px(va) + px(vs)];
          if (isPx(vb) && isPx(vs)) return [end - px(vb) - px(vs), end - px(vb)];
          return null;
        };
        const xs = span(pb.left, pb.right, 'left', 'right', 'width');
        const ys = span(pb.top, pb.bottom, 'top', 'bottom', 'height');
        if (xs && ys && xs[1] > xs[0] && ys[1] > ys[0]) boxes.push({ left: xs[0], right: xs[1], top: ys[0], bottom: ys[1] });
      }
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels) {
      for (const lab of Array.from(labels)) {
        if (!displayed(lab) || /^(hidden|collapse)$/.test(st(lab).getPropertyValue('visibility'))) continue;
        const lr = env.rect(lab);
        if (lr.width > 0 && lr.height > 0) { parts.push(lab); boxes.push(lr); }
      }
    }
    const textEntry = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.getAttribute('contenteditable') === 'true';
    let depth = 0;
    for (let a = el.parentElement; a && depth < 3 && a !== document.body && a !== html; a = a.parentElement, depth++) {
      if (/^(dialog|alertdialog|main|navigation|region|form|banner|complementary|list|listbox|menu|grid|table|row)$/.test(a.getAttribute('role') || '')) break;
      if (a.querySelectorAll(TARGET).length > 1) break;
      const cursor = st(a).getPropertyValue('cursor');
      const declared = cursor !== (a.parentElement ? st(a.parentElement).getPropertyValue('cursor') : '');
      // rc-input (antd Input/InputNumber) affix sarmalayıcısı tıklamayı içindeki alana iletir; imleç bildirmez.
      const forwards = a.matches('.ant-input-affix-wrapper, .ant-input-number-affix-wrapper');
      if (a.tagName === 'LABEL' || forwards || (declared && (cursor === 'pointer' || (textEntry && cursor === 'text')))) {
        const ar = env.rect(a);
        if (ar.width > 0 && ar.height > 0) { parts.push(a); boxes.push(ar); }
      }
    }
    let start: Box | null = r.width > 0 && r.height > 0 && !visuallyHidden(el, r) ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    const pool = boxes.slice().sort((x, y) => wOf(y) * hOf(y) - wOf(x) * hOf(x));
    if (!start) start = pool.shift() || null;
    if (!start) continue;
    let eff: Box = start;
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = pool.length - 1; i >= 0; i--) {
        if (near(eff, pool[i])) { eff = unite(eff, pool[i]); pool.splice(i, 1); grew = true; }
      }
    }
    if (wOf(eff) + 0.5 < min || hOf(eff) + 0.5 < min) out.push(`${label(el)}: dokunma alanı ${r1(wOf(eff))}×${r1(hOf(eff))}px < ${min}×${min}px`);
    entries.push({ el, parts, clip: clipOf(el, eff), layer: layerOf(el) });
  }

  const belongs = (e: Entry, node: Element) => e.el === node || e.el.contains(node) || e.parts.some((p) => p === node || p.contains(node));
  if (opts.overlap !== false) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const x = inter(a.clip, b.clip);
        if (wOf(x) <= 1 || hOf(x) <= 1) continue;
        if (env.hit) {
          const top = env.hit((x.left + x.right) / 2, (x.top + x.bottom) / 2);
          if (top && !belongs(a, top) && !belongs(b, top)) continue;
        }
        out.push(`${label(a.el)} ile ${label(b.el)}: dokunma alanları ${r1(wOf(x))}×${r1(hOf(x))}px örtüşüyor`);
      }
    }
  }
  if (opts.occlusion !== false && env.hit) {
    const vp = env.viewport();
    for (const e of entries) {
      const v = inter(e.clip, { left: 0, top: 0, right: vp.width, bottom: vp.height });
      if (wOf(v) <= 1 || hOf(v) <= 1) continue;
      const top = env.hit((v.left + v.right) / 2, (v.top + v.bottom) / 2);
      if (!top || belongs(e, top) || top.contains(e.el) || pinned(top)) continue;
      out.push(`${label(e.el)}: dokunma alanı ${label(top)} tarafından örtülüyor`);
    }
  }
  return out.slice(0, max);
}

/**
 * Güvenli alan çakışması: görünür metin (metin satırı kutusuyla), dokunma hedefi ve anlamlı medya (img, svg, video,
 * canvas, role=img; aria-hidden hariç) görünüm alanının güvenli alan bantlarına (env(safe-area-inset-*)) girmez.
 * Bantlar: `insets` → html[data-detector-safe-area] (emulateSafeAreaInsets yazar) → gerçek env() ölçümü. Sabit/yapışkan
 * katmandaki içerik bantta her zaman ihlaldir; akış içi içerik yalnız kaydırılarak bandın dışına çıkarılamıyorsa (sayfa
 * en üstte/en altta, yatay kaydırma kapsayıcısı başta/sonda) ihlaldir. Muaf: data-allow-safe-area (bilinçli taşan zemin).
 */
export function safeAreaViolations(opts: SafeAreaOptions = {}): string[] {
  const env: DetectorEnv = opts.env || {
    style: (el, pseudo) => window.getComputedStyle(el, pseudo || null),
    rect: (el) => el.getBoundingClientRect(),
    viewport: () => ({ width: document.documentElement.clientWidth, height: window.innerHeight }),
    media: (q) => window.matchMedia(q).matches,
    scroll: (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft }),
    textRects: (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
    },
  };
  const label = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + (text ? '[' + text + ']' : '');
  };
  const px = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const r1 = (n: number) => Math.round(n * 10) / 10;
  type Box = { left: number; top: number; right: number; bottom: number };
  const inter = (a: Box, b: Box): Box => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });

  const root = typeof opts.root === 'string' ? document.querySelector(opts.root) : opts.root || document.body;
  if (!root) return [`kök bulunamadı: ${String(opts.root)}`];
  const max = opts.max ?? 40;
  const tol = opts.tolerance ?? 0.5;
  const html = document.documentElement;
  let ins = { top: 0, right: 0, bottom: 0, left: 0 };
  if (opts.insets) {
    ins = { top: opts.insets.top || 0, right: opts.insets.right || 0, bottom: opts.insets.bottom || 0, left: opts.insets.left || 0 };
  } else if ((html.getAttribute('data-detector-safe-area') || '').trim()) {
    const [t, r, b, l] = (html.getAttribute('data-detector-safe-area') || '').trim().split(/\s+/).map((n) => parseFloat(n));
    ins = { top: t || 0, right: r || 0, bottom: b || 0, left: l || 0 };
  } else {
    const probe = document.createElement('div');
    try {
      probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
        + 'padding:env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)';
      html.appendChild(probe);
      const s = env.style(probe);
      ins = { top: px(s.getPropertyValue('padding-top')), right: px(s.getPropertyValue('padding-right')), bottom: px(s.getPropertyValue('padding-bottom')), left: px(s.getPropertyValue('padding-left')) };
    } finally {
      probe.remove();
    }
  }
  const vp = env.viewport();
  const NAMES: Record<string, string> = { top: 'üst', right: 'sağ', bottom: 'alt', left: 'sol' };
  const bands = [
    { side: 'top', size: ins.top, box: { left: 0, top: 0, right: vp.width, bottom: ins.top } },
    { side: 'bottom', size: ins.bottom, box: { left: 0, top: vp.height - ins.bottom, right: vp.width, bottom: vp.height } },
    { side: 'left', size: ins.left, box: { left: 0, top: 0, right: ins.left, bottom: vp.height } },
    { side: 'right', size: ins.right, box: { left: vp.width - ins.right, top: 0, right: vp.width, bottom: vp.height } },
  ].filter((band) => band.size > tol);
  if (!bands.length) return [];

  const TARGET = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"]), '
    + '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"]';
  const MEDIA = 'img, svg, video, canvas, [role="img"]';
  const styles = new Map<Element, { getPropertyValue(name: string): string }>();
  const st = (el: Element) => { let s = styles.get(el); if (!s) { s = env.style(el); styles.set(el, s); } return s; };
  const hiddenCache = new Map<Element, boolean>();
  const hidden = (el: Element): boolean => {
    const cached = hiddenCache.get(el);
    if (cached !== undefined) return cached;
    const s = st(el);
    let result = s.getPropertyValue('display') === 'none' || s.getPropertyValue('opacity') === '0';
    if (!result && el.parentElement && el.parentElement !== html) result = hidden(el.parentElement);
    hiddenCache.set(el, result);
    return result;
  };
  const invisible = (el: Element, r: DetectorRect) => {
    const s = st(el);
    if (/^(hidden|collapse)$/.test(s.getPropertyValue('visibility')) || hidden(el)) return true;
    if (r.width === 0 || r.height === 0 || (r.width <= 2 && r.height <= 2)) return true;
    return /^rect\(0(px)?,?0(px)?,?0(px)?,?0(px)?\)$/.test(s.getPropertyValue('clip').replace(/\s+/g, ''))
      || /^inset\(50%\)$/.test(s.getPropertyValue('clip-path').replace(/\s+/g, ''));
  };
  const layerOf = (el: Element): Element | null => {
    for (let a: Element | null = el; a && a !== html; a = a.parentElement) {
      const p = st(a).getPropertyValue('position');
      if (p === 'fixed' || p === 'sticky') return a;
    }
    return null;
  };
  const clipOf = (el: Element): Box => {
    let out: Box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    if (st(el).getPropertyValue('position') === 'fixed') return out;
    for (let a = el.parentElement; a && a !== html && a !== document.body; a = a.parentElement) {
      const s = st(a);
      const ox = s.getPropertyValue('overflow-x');
      const oy = s.getPropertyValue('overflow-y');
      if (s.getPropertyValue('display') !== 'contents' && ((ox && ox !== 'visible') || (oy && oy !== 'visible'))) {
        const r = env.rect(a);
        const pb = { left: r.left + px(s.getPropertyValue('border-left-width')), top: r.top + px(s.getPropertyValue('border-top-width')), right: r.right - px(s.getPropertyValue('border-right-width')), bottom: r.bottom - px(s.getPropertyValue('border-bottom-width')) };
        if (ox && ox !== 'visible') out = { left: Math.max(out.left, pb.left), top: out.top, right: Math.min(out.right, pb.right), bottom: out.bottom };
        if (oy && oy !== 'visible') out = { left: out.left, top: Math.max(out.top, pb.top), right: out.right, bottom: Math.min(out.bottom, pb.bottom) };
      }
      if (s.getPropertyValue('position') === 'fixed') break;
    }
    return out;
  };
  // Bandın içindeki içerik, aradaki bir kaydırma kapsayıcısı (ya da katman yoksa sayfa) o yönde kayabiliyorsa açılabilir.
  const canReveal = (el: Element, side: string, layer: Element | null) => {
    const vertical = side === 'top' || side === 'bottom';
    const movable = (m: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number; scrollTop?: number; scrollLeft?: number }) => {
      const top = m.scrollTop || 0;
      const left = m.scrollLeft || 0;
      if (side === 'top') return top > 0.5;
      if (side === 'bottom') return top + m.clientHeight < m.scrollHeight - 1;
      if (side === 'left') return left > 0.5;
      return left + m.clientWidth < m.scrollWidth - 1;
    };
    for (let a: Element | null = el; a && a !== html && a !== document.body; a = a.parentElement) {
      const o = st(a).getPropertyValue(vertical ? 'overflow-y' : 'overflow-x');
      if ((o === 'auto' || o === 'scroll') && movable(env.scroll(a))) return true;
      if (a === layer) return false;
    }
    if (layer) return false;
    const prop = vertical ? 'overflow-y' : 'overflow-x';
    if (/^(hidden|clip)$/.test(st(html).getPropertyValue(prop)) || /^(hidden|clip)$/.test(st(document.body).getPropertyValue(prop))) return false;
    return movable(env.scroll(document.scrollingElement || html));
  };

  const out: string[] = [];
  const reported: Element[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (out.length >= max) break;
    if (el.closest('[data-allow-safe-area], script, style, noscript, template')) continue;
    if (reported.some((p) => p.contains(el))) continue;
    const target = el.matches(TARGET);
    const media = el.matches(MEDIA) && !el.closest('[aria-hidden="true"]');
    const texts = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && (n.textContent || '').trim()) as Text[];
    if (!target && !media && !texts.length) continue;
    const r = env.rect(el);
    if (invisible(el, r)) continue;
    let rects: Box[] = [];
    if (!target && !media && env.textRects) {
      for (const t of texts) for (const tr of env.textRects(t)) if (tr.width > 0 && tr.height > 0) rects.push(tr);
    }
    if (!rects.length) rects = [r];
    const clip = clipOf(el);
    const layer = layerOf(el);
    for (const band of bands) {
      const inside = rects.some((x) => { const v = inter(inter(x, clip), band.box); return v.right - v.left > tol && v.bottom - v.top > tol; });
      if (!inside || canReveal(el, band.side, layer)) continue;
      reported.push(el);
      out.push(`${label(el)}: güvenli alana giriyor (${NAMES[band.side]} ${r1(band.size)}px bandı${layer ? ', sabit/yapışkan katman' : ''})`);
      break;
    }
  }
  return out.slice(0, max);
}

/**
 * Sanal klavye örtmesi: odaktaki düzenlenebilir alan (metin girişi, textarea, contenteditable) klavye açıkken görünür
 * banda getirilebilmeli ve orada içerikli bir sabit/yapışkan öğenin altında kalmamalı. Bant: `keyboard` (px, benzetilen
 * klavye yüksekliği) → [0, yükseklik − keyboard]; verilmezse küçülmüş visualViewport; ikisi de yoksa klavye yok sayılır.
 * Kaydırma payı: alan ile ilk sabit atası arasındaki kaydırma kapsayıcıları (+ sabit ata yoksa sayfa; html/body overflow
 * hidden ise sayfa kaymaz). Örtü: alan kaydırılmış konumunda, görünür banttaki içerikli sabit/yapışkan öğe (boş perde
 * sayılmaz); alan sabit bir katmandaysa yalnız o katmanın içindekiler ve belgede ondan sonra gelen sabit öğeler.
 */
export function virtualKeyboardViolations(opts: VirtualKeyboardOptions = {}): string[] {
  const env: DetectorEnv = opts.env || {
    style: (el, pseudo) => window.getComputedStyle(el, pseudo || null),
    rect: (el) => el.getBoundingClientRect(),
    viewport: () => ({ width: document.documentElement.clientWidth, height: window.innerHeight }),
    media: (q) => window.matchMedia(q).matches,
    scroll: (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft }),
    visualViewport: () => (window.visualViewport ? { offsetTop: window.visualViewport.offsetTop, offsetLeft: window.visualViewport.offsetLeft, width: window.visualViewport.width, height: window.visualViewport.height } : null),
  };
  const label = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + (text ? '[' + text + ']' : '');
  };
  const round = (n: number) => Math.round(n);
  const tol = opts.tolerance ?? 1;
  const max = opts.max ?? 10;
  const html = document.documentElement;
  const target = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target === undefined ? document.activeElement : opts.target;
  if (!target || target === document.body || target === html) return [];
  const NON_TEXT = ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color', 'image', 'hidden'];
  const field = target as HTMLInputElement;
  const editable = target.getAttribute('contenteditable') === 'true'
    || (target.tagName === 'TEXTAREA' && !field.readOnly && !field.disabled)
    || (target.tagName === 'INPUT' && !NON_TEXT.includes((target.getAttribute('type') || 'text').toLowerCase()) && !field.readOnly && !field.disabled);
  if (!editable) return [];

  const vp = env.viewport();
  let bandTop = 0;
  let bandBottom = vp.height;
  let source = '';
  if (opts.keyboard !== undefined) {
    bandBottom = vp.height - opts.keyboard;
    source = `klavye ${round(opts.keyboard)}px`;
  } else {
    const vv = env.visualViewport ? env.visualViewport() : null;
    if (!vv || vv.height >= vp.height - 1) return [];
    bandTop = vv.offsetTop;
    bandBottom = vv.offsetTop + vv.height;
    source = `görsel görünüm ${round(vv.height)}px`;
  }

  const st = (el: Element) => env.style(el);
  let layer: Element | null = st(target).getPropertyValue('position') === 'fixed' ? target : null;
  let roomDown = 0;
  let roomUp = 0;
  for (let a = target.parentElement; a && !layer && a !== html; a = a.parentElement) {
    const s = st(a);
    const oy = s.getPropertyValue('overflow-y');
    if (a !== document.body && (oy === 'auto' || oy === 'scroll')) {
      const m = env.scroll(a);
      roomDown += Math.max(0, m.scrollHeight - m.clientHeight - (m.scrollTop || 0));
      roomUp += Math.max(0, m.scrollTop || 0);
    }
    if (s.getPropertyValue('position') === 'fixed') layer = a;
  }
  if (!layer && !/^(hidden|clip)$/.test(st(html).getPropertyValue('overflow-y')) && !/^(hidden|clip)$/.test(st(document.body).getPropertyValue('overflow-y'))) {
    const d = env.scroll(document.scrollingElement || html);
    roomDown += Math.max(0, d.scrollHeight - d.clientHeight - (d.scrollTop || 0));
    roomUp += Math.max(0, d.scrollTop || 0);
  }

  const out: string[] = [];
  const r = env.rect(target);
  let shift = 0;
  if (r.bottom > bandBottom + tol) {
    const need = r.height > bandBottom - bandTop ? r.top - bandTop : r.bottom - bandBottom;
    if (need > roomDown + tol) out.push(`${label(target)}: odaktaki alan ${source} altında kalıyor (alt ${round(r.bottom)}px > görünür ${round(bandBottom)}px; kaydırma payı ${round(roomDown)}px, gereken ${round(need)}px)`);
    shift = Math.min(need, roomDown);
  } else if (r.top < bandTop - tol) {
    const need = bandTop - r.top;
    if (need > roomUp + tol) out.push(`${label(target)}: odaktaki alan görünür alanın üstünde kalıyor (üst ${round(r.top)}px < ${round(bandTop)}px; kaydırma payı ${round(roomUp)}px)`);
    shift = -Math.min(need, roomUp);
  }
  if (out.length) return out.slice(0, max);

  const moved = { left: r.left, right: r.right, top: r.top - shift, bottom: r.bottom - shift };
  const band = { left: 0, right: vp.width, top: bandTop, bottom: bandBottom };
  const MEANING = 'a[href], button, input, select, textarea, img, svg, video, canvas, [role]';
  const all = Array.from(document.body.querySelectorAll('*'));
  const layerIndex = layer ? all.indexOf(layer) : -1;
  for (let i = 0; i < all.length && out.length < max; i++) {
    const el = all[i];
    if (el === target || el.contains(target) || target.contains(el)) continue;
    const s = st(el);
    const pos = s.getPropertyValue('position');
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    if (layer && !layer.contains(el) && i < layerIndex) continue;
    if (s.getPropertyValue('display') === 'none' || /^(hidden|collapse)$/.test(s.getPropertyValue('visibility')) || s.getPropertyValue('opacity') === '0') continue;
    if (!(el.textContent || '').trim() && !el.querySelector(MEANING)) continue;
    const b = env.rect(el);
    const o = {
      left: Math.max(b.left, band.left, moved.left), right: Math.min(b.right, band.right, moved.right),
      top: Math.max(b.top, band.top, moved.top), bottom: Math.min(b.bottom, band.bottom, moved.bottom),
    };
    if (o.right - o.left > tol && o.bottom - o.top > tol) out.push(`${label(target)}: odaktaki alan ${label(el)} tarafından örtülüyor (${round(o.bottom - o.top)}px)`);
  }
  return out.slice(0, max);
}

/**
 * Görünür ama kesilmiş metin: metin düğümünün satır kutuları (Range.getClientRects; ölçülemezse üst öğe kutusu)
 * kırpan atalarının (overflow hidden/clip; inline ve display:contents hariç) iç kutusuna ve yatayda görünüm alanına sığmalı.
 * Kaydırılabilir eksen (overflow auto/scroll) o eksende kesme sayılmaz; sabit katmanda dikey görünüm alanı da kırpar.
 * Tamamen gizli (kapalı akordeon), görsel olarak gizli (sr-only) ve data-allow-truncate altındaki metin sayılmaz. Satır
 * yüksekliği font kutusundan küçükse (yarım satır aralığı) dikeyde o kadar pay verilir. Kendisinde ya da bir atasında
 * hareket süren (açılıp kapanan panel; document.getAnimations) metin ölçülmez: ara kare kesme değildir.
 */
export function clippedTextViolations(opts: ClippedTextOptions = {}): string[] {
  const env: DetectorEnv = opts.env || {
    style: (el, pseudo) => window.getComputedStyle(el, pseudo || null),
    rect: (el) => el.getBoundingClientRect(),
    viewport: () => ({ width: document.documentElement.clientWidth, height: window.innerHeight }),
    media: (q) => window.matchMedia(q).matches,
    scroll: (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft }),
    textRects: (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
    },
  };
  const label = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    const text = (el.getAttribute('aria-label') || '').trim().slice(0, 24);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + (text ? '[' + text + ']' : '');
  };
  const px = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const round = (n: number) => Math.round(n);
  const root = typeof opts.root === 'string' ? document.querySelector(opts.root) : opts.root || document.body;
  if (!root) return [`kök bulunamadı: ${String(opts.root)}`];
  const tol = opts.tolerance ?? 1;
  const max = opts.max ?? 40;
  const html = document.documentElement;
  const vp = env.viewport();
  const styles = new Map<Element, { getPropertyValue(name: string): string }>();
  const st = (el: Element) => { let s = styles.get(el); if (!s) { s = env.style(el); styles.set(el, s); } return s; };
  const hiddenCache = new Map<Element, boolean>();
  const hidden = (el: Element): boolean => {
    const cached = hiddenCache.get(el);
    if (cached !== undefined) return cached;
    const s = st(el);
    let result = s.getPropertyValue('display') === 'none' || s.getPropertyValue('opacity') === '0';
    if (!result && el.parentElement && el.parentElement !== html) result = hidden(el.parentElement);
    hiddenCache.set(el, result);
    return result;
  };
  const invisible = (el: Element) => {
    const s = st(el);
    if (/^(hidden|collapse)$/.test(s.getPropertyValue('visibility')) || hidden(el)) return true;
    const r = env.rect(el);
    if (r.width <= 2 && r.height <= 2) return true;
    return /^rect\(0(px)?,?0(px)?,?0(px)?,?0(px)?\)$/.test(s.getPropertyValue('clip').replace(/\s+/g, ''))
      || /^inset\(50%\)$/.test(s.getPropertyValue('clip-path').replace(/\s+/g, ''));
  };

  // Süren hareketlerin hedefleri: bunların altındaki metin ara karede ölçülmez.
  const moving = new Set<Element>();
  const doc = document as Document & { getAnimations?: () => Array<{ playState: string; effect: unknown }> };
  if (typeof doc.getAnimations === 'function') {
    for (const animation of doc.getAnimations()) {
      const target = animation.effect && (animation.effect as { target?: Element | null }).target;
      if (animation.playState === 'running' && target) moving.add(target);
    }
  }
  const movingCache = new Map<Element, boolean>();
  const inMotion = (el: Element): boolean => {
    const cached = movingCache.get(el);
    if (cached !== undefined) return cached;
    const result = moving.has(el) || Boolean(el.parentElement && el.parentElement !== html && inMotion(el.parentElement));
    movingCache.set(el, result);
    return result;
  };

  const out: string[] = [];
  const reported = new Set<Element>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode()) && out.length < max) {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || reported.has(el)) continue;
    if (el.closest('script, style, noscript, template, select, option, datalist, textarea, [data-allow-truncate]')) continue;
    if (invisible(el) || (moving.size && inMotion(el))) continue;
    let rects: DetectorRect[] = env.textRects ? env.textRects(node as Text).filter((x) => x.width > 0 && x.height > 0) : [];
    if (!rects.length) rects = [env.rect(el)];
    const box = {
      left: Math.min(...rects.map((x) => x.left)), top: Math.min(...rects.map((x) => x.top)),
      right: Math.max(...rects.map((x) => x.right)), bottom: Math.max(...rects.map((x) => x.bottom)),
    };
    const lineHeight = px(st(el).getPropertyValue('line-height'));
    const glyph = Math.max(...rects.map((x) => x.height));
    const slack = lineHeight > 0 && glyph > lineHeight ? (glyph - lineHeight) / 2 : 0;
    const clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    let freeX = false;
    let freeY = false;
    let fixed = false;
    for (let a: Element | null = el; a && a !== html && a !== document.body; a = a.parentElement) {
      const s = st(a);
      const display = s.getPropertyValue('display');
      if (display !== 'contents' && display !== 'inline') {
        const ox = s.getPropertyValue('overflow-x');
        const oy = s.getPropertyValue('overflow-y');
        const cuts = (o: string) => o === 'hidden' || o === 'clip';
        if ((cuts(ox) && !freeX) || (cuts(oy) && !freeY)) {
          const r = env.rect(a);
          if (cuts(ox) && !freeX) { clip.left = Math.max(clip.left, r.left + px(s.getPropertyValue('border-left-width'))); clip.right = Math.min(clip.right, r.right - px(s.getPropertyValue('border-right-width'))); }
          if (cuts(oy) && !freeY) { clip.top = Math.max(clip.top, r.top + px(s.getPropertyValue('border-top-width'))); clip.bottom = Math.min(clip.bottom, r.bottom - px(s.getPropertyValue('border-bottom-width'))); }
        }
        if (ox === 'auto' || ox === 'scroll') freeX = true;
        if (oy === 'auto' || oy === 'scroll') freeY = true;
      }
      if (s.getPropertyValue('position') === 'fixed') { fixed = true; break; }
    }
    if (opts.viewport !== false) {
      if (!freeX) { clip.left = Math.max(clip.left, 0); clip.right = Math.min(clip.right, vp.width); }
      if (fixed && !freeY) { clip.top = Math.max(clip.top, 0); clip.bottom = Math.min(clip.bottom, vp.height); }
    }
    const visibleW = Math.min(box.right, clip.right) - Math.max(box.left, clip.left);
    const visibleH = Math.min(box.bottom, clip.bottom) - Math.max(box.top, clip.top);
    if (visibleW <= 0 || visibleH <= 0 || (visibleW <= 2 && visibleH <= 2)) continue;
    const parts: string[] = [];
    if (clip.left - box.left > tol) parts.push(`sol ${round(clip.left - box.left)}px`);
    if (box.right - clip.right > tol) parts.push(`sağ ${round(box.right - clip.right)}px`);
    if (clip.top - box.top > tol + slack) parts.push(`üst ${round(clip.top - box.top)}px`);
    if (box.bottom - clip.bottom > tol + slack) parts.push(`alt ${round(box.bottom - clip.bottom)}px`);
    if (!parts.length) continue;
    reported.add(el);
    out.push(`${label(el)}: görünür metin kesiliyor (${parts.join(', ')}): "${text.slice(0, 40)}"`);
  }
  return out.slice(0, max);
}

/**
 * Güvenli alan benzetimi (test yardımcısı; dedektör değildir): Playwright Chromium/WebKit env(safe-area-inset-*) için 0
 * verir. Bu işlev erişilebilir tüm stil sayfalarındaki (gruplu kurallar dahil) ve style özniteliklerindeki
 * env(safe-area-inset-*) ifadelerini verilen px değerine çevirir, sonradan eklenen <style>/<link> sayfalarını da
 * MutationObserver ile çevirir ve html[data-detector-safe-area="üst sağ alt sol"] yazar (safeAreaViolations okur).
 * Döner: çevrilen ifade sayısı (0 = uygulama env() kullanmıyor). Sayfa yeniden yüklenince etkisi kalkar.
 */
export function emulateSafeAreaInsets(insets: SafeAreaInsets = {}): number {
  const value: Record<string, number> = { top: insets.top || 0, right: insets.right || 0, bottom: insets.bottom || 0, left: insets.left || 0 };
  const PATTERN = /env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,(?:[^()]|\([^()]*\))*)?\)/g;
  let count = 0;
  const swap = (text: string) => text.replace(PATTERN, (_match: string, side: string) => { count++; return `${value[side]}px`; });
  const visit = (rules: CSSRuleList | null | undefined) => {
    if (!rules) return;
    for (const rule of Array.from(rules)) {
      const style = (rule as CSSStyleRule).style;
      if (style && /safe-area-inset/.test(style.cssText)) style.cssText = swap(style.cssText);
      const imported = (rule as CSSImportRule).styleSheet;
      if (imported) { try { visit(imported.cssRules); } catch { /* farklı köken */ } }
      const inner = (rule as CSSGroupingRule).cssRules;
      if (inner) visit(inner);
    }
  };
  const visitSheet = (sheet: CSSStyleSheet | null | undefined) => { if (!sheet) return; try { visit(sheet.cssRules); } catch { /* farklı köken */ } };
  const visitStyleAttr = (el: Element) => { const raw = el.getAttribute('style'); if (raw && /safe-area-inset/.test(raw)) el.setAttribute('style', swap(raw)); };
  for (const sheet of Array.from(document.styleSheets)) visitSheet(sheet);
  for (const el of Array.from(document.querySelectorAll('[style*="safe-area-inset"]'))) visitStyleAttr(el);
  const html = document.documentElement;
  html.setAttribute('data-detector-safe-area', `${value.top} ${value.right} ${value.bottom} ${value.left}`);
  const holder = window as unknown as { __aileSafeAreaObserver?: MutationObserver };
  if (holder.__aileSafeAreaObserver) holder.__aileSafeAreaObserver.disconnect();
  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof Element) { visitStyleAttr(record.target); continue; }
        for (const added of Array.from(record.addedNodes)) {
          if (!(added instanceof Element)) continue;
          if (added.tagName === 'STYLE') visitSheet((added as HTMLStyleElement).sheet);
          if (added.tagName === 'LINK') { const link = added as HTMLLinkElement; if (link.sheet) visitSheet(link.sheet); else link.addEventListener('load', () => visitSheet(link.sheet), { once: true }); }
          for (const el of [added, ...Array.from(added.querySelectorAll('[style*="safe-area-inset"]'))]) visitStyleAttr(el);
        }
      }
    });
    observer.observe(html, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    holder.__aileSafeAreaObserver = observer;
  }
  return count;
}

export const detectors = {
  focusRingViolations,
  smallTextViolations,
  accentEdgeViolations,
  overflowViolations,
  motionViolations,
  touchTargetViolations,
  safeAreaViolations,
  virtualKeyboardViolations,
  clippedTextViolations,
};
export type DetectorName = keyof typeof detectors;
type Serializable<T> = T extends (...args: infer A) => string[] ? { [I in keyof A]: A[I] extends infer O ? (O extends { env?: unknown } ? Omit<O, 'env'> : O) : never } : never;

/**
 * Dedektörü sayfada çalıştıracak ifade metni: `(function …)(…args)`. Bağımsız değişkenler JSON'a serileştirilir;
 * öğe yerine seçici verin. page.evaluate(string) CDP üzerinden çalıştığı için sayfa CSP'sinden etkilenmez.
 */
export function detectorScript<K extends DetectorName>(name: K, ...args: Serializable<(typeof detectors)[K]>): string {
  return `(${detectors[name].toString()})(...${JSON.stringify(args)})`;
}

export async function runDetector<K extends DetectorName>(page: Page, name: K, ...args: Serializable<(typeof detectors)[K]>): Promise<string[]> {
  return (await page.evaluate(detectorScript(name, ...args))) as string[];
}

export const focusRing = (page: Page, opts: Omit<FocusRingOptions, 'env' | 'target'> & { target?: string } = {}) => runDetector(page, 'focusRingViolations', opts);
export const smallText = (page: Page, opts: Omit<SmallTextOptions, 'env' | 'root'> & { root?: string } = {}) => runDetector(page, 'smallTextViolations', opts);
export const accentEdges = (page: Page, opts: Omit<RootOptions, 'env' | 'root'> & { root?: string } = {}) => runDetector(page, 'accentEdgeViolations', opts);
export const overflow = (page: Page, opts: Omit<OverflowOptions, 'env' | 'root'> & { root?: string } = {}) => runDetector(page, 'overflowViolations', opts);
export const motion = (page: Page, ease = 'cubic-bezier(.65,0,.35,1)', ms = 240, opts: Omit<MotionOptions, 'env' | 'root'> & { root?: string } = {}) =>
  runDetector(page, 'motionViolations', ease, ms, opts);
export const touchTargets = (page: Page, opts: Omit<TouchTargetOptions, 'env' | 'root'> & { root?: string } = {}) => runDetector(page, 'touchTargetViolations', opts);
export const safeArea = (page: Page, opts: Omit<SafeAreaOptions, 'env' | 'root'> & { root?: string } = {}) => runDetector(page, 'safeAreaViolations', opts);
export const virtualKeyboard = (page: Page, opts: Omit<VirtualKeyboardOptions, 'env' | 'target'> & { target?: string } = {}) => runDetector(page, 'virtualKeyboardViolations', opts);
export const clippedText = (page: Page, opts: Omit<ClippedTextOptions, 'env' | 'root'> & { root?: string } = {}) => runDetector(page, 'clippedTextViolations', opts);

/** Sayfada güvenli alanı benzetir (emulateSafeAreaInsets); çevrilen env() ifadesi sayısını döndürür. */
export async function emulateSafeArea(page: Page, insets: SafeAreaInsets): Promise<number> {
  return (await page.evaluate(`(${emulateSafeAreaInsets.toString()})(${JSON.stringify(insets)})`)) as number;
}

/**
 * Gerçek tarayıcıda öz denetim: body'ye her kurala aykırı bir parça enjekte eder (yalnız CSSOM; style özniteliği
 * kullanılmaz), her dedektörü bu parçaya karşı çalıştırır, parçayı kaldırır ve ihlali YAKALAMAYAN dedektörlerin
 * adlarını döndürür. Boş liste = dedektörler bu tarayıcı motorunda çalışıyor. Enjekte edilenler: küçük metin, kavisli
 * şerit, odak halkası, yanlış hareket, taşan öğe, 20×20 hedef, örtüşen iki hedef, alt güvenli banda giren sabit metin,
 * klavye bandının altında kalan sabit alan, kırpılan metin.
 */
export function selfCheckScript(): string {
  return `(() => {
    const d = { focus: (${focusRingViolations.toString()}), small: (${smallTextViolations.toString()}), accent: (${accentEdgeViolations.toString()}), overflow: (${overflowViolations.toString()}), motion: (${motionViolations.toString()}),
      touch: (${touchTargetViolations.toString()}), safe: (${safeAreaViolations.toString()}), keyboard: (${virtualKeyboardViolations.toString()}), clipped: (${clippedTextViolations.toString()}) };
    const before = { x: window.scrollX, y: window.scrollY, focus: document.activeElement };
    const host = document.createElement('div');
    host.setAttribute('data-detector-selfcheck', '');
    // En üst katman: uygulamanın sabit/yapışkan katmanları örtüşme ve örtülme ölçümünü (elementFromPoint) bozmasın.
    host.style.cssText = 'position:absolute;top:0;left:0;width:240px;z-index:2147483647;';
    const add = (tag, css, text) => { const el = document.createElement(tag); el.style.cssText = css; if (text) el.textContent = text; host.appendChild(el); return el; };
    add('p', 'font-size:12px;margin:0', 'küçük metin');
    add('div', 'border-radius:12px;border-left:4px solid rgb(50, 107, 148);width:120px;height:40px', 'şerit');
    const button = add('button', 'outline:2px solid rgb(255, 0, 0);box-shadow:0 0 0 2px rgb(255, 0, 0);font-size:16px', 'halka');
    add('div', 'transition:opacity 300ms linear;width:20px;height:20px;font-size:16px', 'm');
    add('div', 'position:absolute;left:0;top:0;height:4px;font-size:16px;width:' + (window.innerWidth + 400) + 'px', '');
    add('button', 'position:absolute;left:160px;top:120px;width:20px;height:20px;padding:0;font-size:16px', 'k');
    add('button', 'position:absolute;left:0;top:200px;width:48px;height:48px;padding:0;font-size:16px', 'a');
    add('button', 'position:absolute;left:24px;top:200px;width:48px;height:48px;padding:0;font-size:16px', 'b');
    add('div', 'position:fixed;left:0;bottom:0;width:200px;height:24px;line-height:24px;margin:0;font-size:16px', 'alt çubuk');
    const field = add('input', 'position:fixed;right:0;bottom:0;width:120px;height:48px;font-size:16px', '');
    field.setAttribute('aria-label', 'öz denetim alanı');
    add('div', 'position:absolute;left:0;top:300px;width:60px;overflow:hidden;white-space:nowrap;font-size:16px', 'kesilen uzun metin örneği burada');
    document.body.appendChild(host);
    button.focus();
    const root = '[data-detector-selfcheck]';
    const missed = [];
    try {
      if (!d.small({ root }).length) missed.push('smallTextViolations');
      if (!d.accent({ root }).length) missed.push('accentEdgeViolations');
      if (!d.focus({ target: button, keyboard: true }).some((m) => /outline/.test(m))) missed.push('focusRingViolations');
      if (!d.motion('cubic-bezier(.65,0,.35,1)', 240, { root }).length) missed.push('motionViolations');
      if (!d.overflow({ root, truncation: false }).length) missed.push('overflowViolations');
      const touch = d.touch({ root, coarse: false, occlusion: false });
      if (!touch.some((m) => /dokunma alanı 20×20px/.test(m))) missed.push('touchTargetViolations');
      if (!touch.some((m) => /örtüşüyor/.test(m))) missed.push('touchTargetViolations:örtüşme');
      if (!d.safe({ root, insets: { bottom: 34 } }).some((m) => /alt çubuk/.test(m))) missed.push('safeAreaViolations');
      field.focus();
      if (!d.keyboard({ target: field, keyboard: Math.round(window.innerHeight / 2) }).length) missed.push('virtualKeyboardViolations');
      if (!d.clipped({ root }).some((m) => /kesilen uzun metin/.test(m))) missed.push('clippedTextViolations');
    } finally {
      host.remove();
      // Odak ve kaydırma eski hâline döner: öz denetim sonraki ölçümleri (güvenli alan, klavye) etkilemez. Odaktaki
      // parça host ile kalktığından önceden odak yoksa odak kendiliğinden body'ye döner.
      if (before.focus && before.focus !== document.body && before.focus.isConnected && typeof before.focus.focus === 'function') before.focus.focus({ preventScroll: true });
      window.scrollTo(before.x, before.y);
    }
    return missed;
  })()`;
}

export async function selfCheckDetectors(page: Page): Promise<string[]> {
  return (await page.evaluate(selfCheckScript())) as string[];
}

// #region ağ isteği → teslim sınıfı (Node tarafı; tarayıcıya gönderilmez)
// Telefon profili antd, pro, icons, echarts ve geniş-özel (wide) kodu istemez (W0 teslim sözleşmesi). Bu bölüm bir ağ
// isteğinin hangi teslim sınıfına ait olduğunu söyler; e02 (üretim önizlemesi) ve f07 (yön değişimi) gibi spec'ler
// page.on('request') ile topladıkları URL'leri buradan geçirir.
//  - Üretim: manifestClassifier dist/.vite/manifest.json (+ varsa delivery-graph.json) okur. Sınıf kuralı
//    scripts/check-delivery.mjs chunkProfile ile aynıdır (birim testi paritesi denetler): modüllerin yarısından fazlasını
//    tutan codeSplitting grubu ya da echarts/zrender paketi; yoksa manifest rolü (entry, page = src/admin/pages/* dinamik
//    girişi, lazy = diğer dinamik giriş, app). Grafik yoksa adlı grup parçası (wide/tokens/pro/icons/antd/router/shared)
//    ve kaynak yolu (*.wide.*, wide/, echarts/zrender) kullanılır; adsız ECharts ortak parçaları o zaman 'app' kalır.
//  - Geliştirme sunucusu: classifyDevRequest Vite modül URL'sini vite.config.ts CHUNK_GROUPS kurallarıyla sınıflar.

export interface ViteManifestChunk {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}
export type ViteManifest = Record<string, ViteManifestChunk>;
export interface DeliveryGraphChunk { modules: number; groups?: Record<string, number>; packages?: Record<string, number> }
/** dist/.vite/delivery-graph.json'un sınıflandırma için gereken kısmı (schema 1). */
export interface DeliveryGraphLike { schema?: number; chunks: Record<string, DeliveryGraphChunk> }
export type DeliveryClass =
  | 'wide' | 'tokens' | 'pro' | 'icons' | 'antd' | 'router' | 'shared' | 'echarts'
  | 'entry' | 'page' | 'lazy' | 'app'
  /** manifestte listelenen font/görsel */ | 'asset'
  /** assets/ altında ama manifestte yok (eski derleme) ya da ayrıştırılamayan bağımlılık parçası */ | 'unknown'
  /** belge, veri, API, araç isteği */ | 'other';
export interface ClassifiedRequest {
  url: string;
  /** Dağıtım içindeki göreli yol (assets/x.js) ya da geliştirme modül yolu; sınıflanamayan istekte null. */
  file: string | null;
  class: DeliveryClass;
  /** Hash içermeyen etiket: giriş/dinamik giriş kaynağı, `chunk:<ad>`, paket adı ya da src yolu. */
  label: string | null;
  source: 'graph' | 'manifest' | 'dev' | null;
}
/** Telefon profilinin istememesi gereken sınıflar (scripts/check-delivery.mjs FORBIDDEN_PHONE_CLASSES ile aynı sıra). */
export const PHONE_FORBIDDEN_CLASSES: readonly DeliveryClass[] = Object.freeze(['antd', 'pro', 'icons', 'echarts', 'wide'] as DeliveryClass[]);

const CHUNK_GROUP_NAMES = ['wide', 'tokens', 'pro', 'icons', 'antd', 'router', 'shared'];
const WIDE_SOURCE = /(?:^|\/)src\/(?:[^?]*\/)?(?:wide\/[^?]+|[^/?]+\.wide\.(?:[cm]?[jt]sx?|css))$/;
const ECHARTS_SOURCE = /(?:^|\/)node_modules\/(?:echarts|zrender)\//;
const PAGE_SOURCE = /^src\/admin\/pages\//;
/** Birden çok parçanın paylaştığı CSS dosyasında hangi sınıfın geçerli olacağı (yasak sınıflar önce). */
const CLASS_PRECEDENCE: DeliveryClass[] = ['wide', 'echarts', 'pro', 'icons', 'antd', 'tokens', 'router', 'shared', 'page', 'lazy', 'entry', 'app'];

const normalizeSource = (src: string) => src.replace(/^(?:.*\/)?node_modules\/\.pnpm\/[^/]+\/node_modules\//, 'node_modules/');
/** URL'den kökeni, sorguyu ve parçayı atar; yüzde kodlamasını çözer. */
const urlPath = (url: string) => {
  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').replace(/[?#].*$/, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

/**
 * Derleme manifestinden saf sınıflandırıcı üretir: (istek URL'si) → sınıf. URL'nin yol sonekleri manifest dosyalarıyla
 * eşlenir (taban /aile/, köken, ?v= ve #… önemsizdir). graph verilirse sınıf modül üyeliğinden gelir (önerilen).
 */
export function manifestClassifier(manifest: ViteManifest, options: { graph?: DeliveryGraphLike | null } = {}): (url: string) => ClassifiedRequest {
  const graph = options.graph ?? null;
  const labelOf = (chunk: ViteManifestChunk) => (chunk.src && (chunk.isEntry || chunk.isDynamicEntry)
    ? normalizeSource(chunk.src)
    : `chunk:${chunk.name ?? (chunk.file.split('/').pop() ?? chunk.file).replace(/-[^-]+\.[a-z]+$/, '')}`);
  const role = (chunk: ViteManifestChunk): DeliveryClass => (chunk.isEntry
    ? 'entry'
    : chunk.isDynamicEntry ? (PAGE_SOURCE.test(normalizeSource(chunk.src ?? '')) ? 'page' : 'lazy') : 'app');
  const classOf = (chunk: ViteManifestChunk): { cls: DeliveryClass; source: 'graph' | 'manifest' } => {
    const info = graph?.chunks[chunk.file];
    if (info) {
      const counts: Record<string, number> = { ...(info.groups ?? {}) };
      const echarts = (info.packages?.echarts ?? 0) + (info.packages?.zrender ?? 0);
      if (echarts > 0) counts.echarts = Math.max(counts.echarts ?? 0, echarts);
      const [top] = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      return { cls: top && top[1] * 2 > info.modules ? (top[0] as DeliveryClass) : role(chunk), source: 'graph' };
    }
    const src = normalizeSource(chunk.src ?? '');
    if (chunk.name && CHUNK_GROUP_NAMES.includes(chunk.name)) return { cls: chunk.name as DeliveryClass, source: 'manifest' };
    if (WIDE_SOURCE.test(src) || /\.wide$/.test(chunk.name ?? '')) return { cls: 'wide', source: 'manifest' };
    if (ECHARTS_SOURCE.test(src)) return { cls: 'echarts', source: 'manifest' };
    return { cls: role(chunk), source: 'manifest' };
  };

  type Hit = { cls: DeliveryClass; label: string; source: 'graph' | 'manifest' };
  const index = new Map<string, Hit>();
  const rank = (cls: DeliveryClass) => { const at = CLASS_PRECEDENCE.indexOf(cls); return at < 0 ? CLASS_PRECEDENCE.length : at; };
  const put = (file: string, hit: Hit) => {
    const current = index.get(file);
    if (!current || current.cls === 'asset' || rank(hit.cls) < rank(current.cls)) index.set(file, hit);
  };
  for (const chunk of Object.values(manifest)) {
    const { cls, source } = classOf(chunk);
    const label = labelOf(chunk);
    put(chunk.file, { cls, label, source });
    for (const css of chunk.css ?? []) put(css, { cls, label, source });
  }
  for (const chunk of Object.values(manifest)) {
    for (const asset of chunk.assets ?? []) if (!index.has(asset)) index.set(asset, { cls: 'asset', label: labelOf(chunk), source: graph ? 'graph' : 'manifest' });
  }

  return (url: string): ClassifiedRequest => {
    const path = urlPath(url);
    const segments = path.split('/').filter(Boolean);
    for (let i = 0; i < segments.length; i++) {
      const file = segments.slice(i).join('/');
      const hit = index.get(file);
      if (hit) return { url, file, class: hit.cls, label: hit.label, source: hit.source };
    }
    const at = segments.lastIndexOf('assets');
    if (at >= 0 && at < segments.length - 1) return { url, file: segments.slice(at).join('/'), class: 'unknown', label: null, source: null };
    return { url, file: null, class: 'other', label: null, source: null };
  };
}

export function classifyRequests(manifest: ViteManifest, urls: Iterable<string>, options: { graph?: DeliveryGraphLike | null } = {}): ClassifiedRequest[] {
  const classify = manifestClassifier(manifest, options);
  return Array.from(urls, (url) => classify(url));
}

/** Vite geliştirme sunucusu modül isteği → sınıf (vite.config.ts CHUNK_GROUPS testlerinin kaynak yolu karşılığı). */
export function classifyDevRequest(url: string): ClassifiedRequest {
  const path = urlPath(url);
  const packageClass = (pkg: string, rest: string): DeliveryClass => {
    if (pkg.startsWith('@ant-design/pro-')) return 'pro';
    if (pkg.startsWith('@ant-design/icons')) return 'icons';
    if (/^(?:antd|@ant-design\/.+|@rc-component\/.+|@babel\/runtime|stylis|@emotion\/.+|is-mobile|react-is|classnames)$/.test(pkg)) return 'antd';
    if (pkg === 'echarts' || pkg === 'zrender') return 'echarts';
    if (pkg === 'wouter' && /^src\/(?:use-hash-location|react-deps|use-sync-external-store)\.js$/.test(rest)) return 'shared';
    if (pkg === 'wouter' || pkg === 'regexparam') return 'router';
    if (/^(?:react|react-dom|scheduler|use-sync-external-store|clsx)$/.test(pkg)) return 'shared';
    return 'app';
  };
  const dep = /(?:^|\/)node_modules\/\.vite\/deps\/([^/]+)\.js$/.exec(path);
  if (dep) {
    const id = dep[1];
    const file = `node_modules/.vite/deps/${id}.js`;
    if (/^chunk-/.test(id)) return { url, file, class: 'unknown', label: id, source: 'dev' };
    const [first, second] = id.split('_');
    const pkg = first.startsWith('@') && second ? `${first}/${second}` : first;
    return { url, file, class: packageClass(pkg, ''), label: pkg, source: 'dev' };
  }
  const nm = path.lastIndexOf('/node_modules/');
  if (nm >= 0) {
    const tail = path.slice(nm + '/node_modules/'.length);
    const parts = tail.split('/');
    const pkg = parts[0].startsWith('@') ? `${parts[0]}/${parts[1] ?? ''}` : parts[0];
    const rest = parts.slice(pkg.startsWith('@') ? 2 : 1).join('/');
    return { url, file: `node_modules/${tail}`, class: packageClass(pkg, rest), label: pkg, source: 'dev' };
  }
  const at = path.indexOf('/src/');
  if (at >= 0) {
    const file = path.slice(at + 1);
    const cls: DeliveryClass = WIDE_SOURCE.test(file) ? 'wide'
      : /^src\/(?:design|dashboard)\/tokens\.ts$/.test(file) ? 'tokens'
        : /^src\/dashboard\/keyboard\.ts$/.test(file) ? 'shared'
          : PAGE_SOURCE.test(file) ? 'page' : 'app';
    return { url, file, class: cls, label: file, source: 'dev' };
  }
  return { url, file: null, class: 'other', label: null, source: null };
}

/** Yasak sınıftaki istekler: "<sınıf>: <dosya> (<etiket>)", tekil ve sıralı. Boş liste = temiz. */
export function deliveryViolations(classified: Iterable<ClassifiedRequest>, forbidden: readonly DeliveryClass[] = PHONE_FORBIDDEN_CLASSES): string[] {
  const out = new Set<string>();
  for (const item of classified) if (forbidden.includes(item.class)) out.add(`${item.class}: ${item.file} (${item.label})`);
  return [...out].sort();
}

/** `<dist>/.vite/manifest.json` (zorunlu) ve `<dist>/.vite/delivery-graph.json` (varsa) okur. Önce `pnpm build`. */
export async function readBuildManifest(dist = 'dist'): Promise<{ manifest: ViteManifest; graph: DeliveryGraphLike | null }> {
  const manifestPath = join(dist, '.vite', 'manifest.json');
  let manifest: ViteManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ViteManifest;
  } catch (error) {
    throw new Error(`${manifestPath} okunamadı: önce pnpm build (build.manifest) — ${(error as Error).message}`);
  }
  let graph: DeliveryGraphLike | null = null;
  try {
    graph = JSON.parse(await readFile(join(dist, '.vite', 'delivery-graph.json'), 'utf8')) as DeliveryGraphLike;
  } catch {
    graph = null;
  }
  return { manifest, graph };
}
// #endregion
