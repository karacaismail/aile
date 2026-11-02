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
 *
 * ÖNEMLİ: Dedektörler page.evaluate'e kaynak metin olarak verilir (detectorScript/runDetector). Bu yüzden her biri kendi
 * içinde tamamdır: modül kapsamındaki hiçbir değere, yardımcıya veya sabite başvurmaz (yalnız tipler). Ortak yardımcılar
 * bilerek her fonksiyonun içinde tekrar tanımlanır. `env` yalnız birim testleri içindir (jsdom yerleşim hesaplamaz);
 * tarayıcıda verilmez ve gerçek getComputedStyle/getBoundingClientRect kullanılır.
 *
 * Muafiyet öznitelikleri (bilinçli, gerekçeli kullanım için): data-allow-overflow (taşma), data-allow-truncate (metin
 * kesme; tam metin başka yolla erişilebilir olmalı), data-allow-motion (hareket).
 */
import type { Page } from '@playwright/test';

export interface DetectorRect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface DetectorEnv {
  style(el: Element, pseudo?: string): { getPropertyValue(name: string): string };
  rect(el: Element): DetectorRect;
  viewport(): { width: number; height: number };
  media(query: string): boolean;
  scroll(el: Element): { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number };
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

export const detectors = { focusRingViolations, smallTextViolations, accentEdgeViolations, overflowViolations, motionViolations };
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

/**
 * Gerçek tarayıcıda öz denetim: body'ye her kurala aykırı bir parça enjekte eder (yalnız CSSOM; style özniteliği
 * kullanılmaz), her dedektörü bu parçaya karşı çalıştırır, parçayı kaldırır ve ihlali YAKALAMAYAN dedektörlerin
 * adlarını döndürür. Boş liste = dedektörler bu tarayıcı motorunda çalışıyor.
 */
export function selfCheckScript(): string {
  return `(() => {
    const d = { focus: (${focusRingViolations.toString()}), small: (${smallTextViolations.toString()}), accent: (${accentEdgeViolations.toString()}), overflow: (${overflowViolations.toString()}), motion: (${motionViolations.toString()}) };
    const host = document.createElement('div');
    host.setAttribute('data-detector-selfcheck', '');
    host.style.cssText = 'position:absolute;top:0;left:0;width:240px;';
    const add = (tag, css, text) => { const el = document.createElement(tag); el.style.cssText = css; if (text) el.textContent = text; host.appendChild(el); return el; };
    add('p', 'font-size:12px;margin:0', 'küçük metin');
    add('div', 'border-radius:12px;border-left:4px solid rgb(50, 107, 148);width:120px;height:40px', 'şerit');
    const button = add('button', 'outline:2px solid rgb(255, 0, 0);box-shadow:0 0 0 2px rgb(255, 0, 0);font-size:16px', 'halka');
    add('div', 'transition:opacity 300ms linear;width:20px;height:20px;font-size:16px', 'm');
    add('div', 'position:absolute;left:0;top:0;height:4px;font-size:16px;width:' + (window.innerWidth + 400) + 'px', '');
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
    } finally {
      host.remove();
    }
    return missed;
  })()`;
}

export async function selfCheckDetectors(page: Page): Promise<string[]> {
  return (await page.evaluate(selfCheckScript())) as string[];
}
