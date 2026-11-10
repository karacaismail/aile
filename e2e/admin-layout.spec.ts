import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { enterKeyboardMode, openAdmin, tabKey } from './admin-helpers';
import { accentEdges, motion, overflow, runDetector, selfCheckDetectors } from './admin-detectors';
import { densityFor, densityVarNames, designTokens, targetTokens, type DensityProfile } from '../src/design/tokens';

// Yönetim paneli yerleşim kapısı (f03-layout). Kaynaklar: aile-tasarim/tasarim-sistemi/README.md › Ölçü, köşe, hareket ·
// Kabuk · Uyarlanır teslim; W0 sözleşmesi (src/admin/adaptive/profile.ts: telefon = genişlik < 600 ya da kısa kenar < 480).
//
// Sıra telefon önce: 320×568 ve 320×480 → (matris) 360/375/390 ve yatay telefon 568×320 → tablet ve masaüstü en son.
// "@matrix" etiketli testler proje görünümünde koşar (görev koşusunda chromium 320×568 ve webkit 390×844; entegrasyonda
// chromium-360/375/short/landscape ve webkit-tablet/desktop da). Etiketsiz testler görünümü kendisi kurar.
//
// Her sayfada denetlenen kurallar (kategori başına ayrı yumuşak iddia, sahibi rapordan okunur):
//  1. belge düzeyinde yatay taşma yok; görünüm dışına taşan öğe yok (paylaşılan overflowViolations)
//  2. yatay kayan kapsayıcı yalnız tablo (table/grid) ya da tasarımın izin verdiği adlı pano bölgesi (Kanban, Gantt:
//     role="region" + ad + sekme durağı); başka şerit yana kaymaz
//  3. kesilen görünür etiket yok: üç nokta/satır sınırı (paylaşılan) ve taşması gizli atada kırpılan metin (yerel)
//  4. kavisli vurgu kenarı yok (paylaşılan accentEdgeViolations)
//  5. dokunma hedefi ≥ 44 × 44; html[data-input-coarse] varken ≥ 48 × 48; hedefler örtüşmez
//  6. hareket: süresi > 0 olan her geçiş/animasyon 240 ms ve cubic-bezier(.65,0,.35,1), gecikme 0, `transition: all` yok;
//     reduced-motion'da süre 0 ve çalışan animasyon yok; durum (görünürlük, aria-expanded, odak) anında
//  7. yapışkan/sabit katmanlar: güvenli alan payı bildirilir ve (Chromium, CDP inset öykünmesi) içerik çentik ve ev
//     çubuğu alanına girmez; katmanlar birbirini ve odaklanan öğeyi örtmez
//
// Seçiciler role/ad ve sözleşme kökleri (main#admin-content); antd iç sınıfı yok. Sabit bekleme yok: hazır sinyali
// openAdmin, hareket bitişi transitionend/animationend sayacı ve document.getAnimations(), kare sınırı rAF.
// Dedektörlerin kör olmadığı en alttaki öz denetimde kanıtlanır (bilinçli ihlal enjekte edilir, yakalanmazsa FAIL).

const ROUTES = ['/genel', '/butce', '/odemeler', '/hesaplar', '/emeklilik', '/alimlar', '/ev', '/projeler', '/taraflar', '/raporlar', '/sozlukler', '/veri', '/ayarlar'] as const;
const MATRIX = { tag: '@matrix' };

const PHONE = { width: 320, height: 568 };
const PHONE_SHORT = { width: 320, height: 480 };
const TABLET = { width: 820, height: 1180 };
const DESKTOP = { width: 1440, height: 900 };

const TARGET_MIN = 44;
const TARGET_COARSE = 48;
/** Üst bar: b01 kabuk sözleşmesi 56 = hedef-asgari 44 + bosluk-3 12 (shell.css --aile-shell-ust-bar); kısa ad tek satırda tam bu. */
const TOPBAR = designTokens.hedefAsgari + designTokens.bosluk3;
const NAV_WIDTH = 272;
const CONTENT_MAX = 1480;
const MOTION_MS = 240;
const MOTION_EASE = 'cubic-bezier(.65,0,.35,1)';
const MOTION_CURVE = [0.65, 0, 0.35, 1] as const;

/** Dokunma hedefi sayılan öğeler (native denetimler + ARIA etkileşim rolleri). */
const TARGET_SELECTOR = [
  'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="tab"]',
  '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]', '[role="option"]', '[role="combobox"]',
  '[role="slider"]', '[role="spinbutton"]', '[role="treeitem"]',
].join(', ');
/** Sekme sırasındaki odaklanabilirler (odak örtülmesi taraması). */
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

type Size = { width: number; height: number };
type Insets = { top: number; right: number; bottom: number; left: number };
const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
/** iPhone çentik/ev çubuğu ölçüleri (dikey: üst 47, alt 34; yatay: yanlar 47, alt 21). */
const insetsFor = (size: Size): Insets => (size.width > size.height ? { top: 0, right: 47, bottom: 21, left: 47 } : { top: 47, right: 0, bottom: 34, left: 0 });

/** W0 profil sözleşmesi (src/admin/adaptive/profile.ts classifyProfile ile aynı eşikler). */
function expectedProfile({ width, height }: Size): 'phone' | 'tablet' | 'desktop' {
  if (width < 600 || Math.min(width, height) < 480) return 'phone';
  return width < 1024 ? 'tablet' : 'desktop';
}

// --- Sayfa bağlamı dedektörleri (yerel) ------------------------------------------------------------------------------
// Her fonksiyon page.evaluate ile kaynak metin olarak aktarılır: dış kapsamdaki hiçbir değere başvurmaz, bağımsız
// değişkenleri JSON ile alır. Paylaşılan dedektörlerde (e2e/admin-detectors.ts, sahibi f09) olmayan kurallar burada.

/** Yatay kayan, tablo ya da adlı pano bölgesi olmayan kapsayıcılar. */
function scrollerViolations(): string[] {
  const TABLE = 'table, [role="table"], [role="grid"], [role="treegrid"]';
  const describe = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    const name = (el.getAttribute('aria-label') || '').trim().slice(0, 24);
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}${name ? `[${name}]` : ''}`;
  };
  const out: string[] = [];
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[data-allow-overflow]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const table = el.matches(TABLE) || !!el.querySelector(TABLE);
    const board = el.getAttribute('role') === 'region' && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) && el.tabIndex >= 0;
    if (table || board) continue;
    out.push(`${describe(el)}: tablo dışı yatay kaydırma (${el.scrollWidth}px > ${el.clientWidth}px)`);
  }
  return out.slice(0, 20);
}

/**
 * Görünür metin, taşması gizli (hidden/clip) bir atanın iç kutusunu kısmen aşıyorsa kırpılmıştır. Kaydırılabilir ata
 * (auto/scroll) o eksende aramayı bitirir (metin kaydırarak görülür). Ekran okuyucuya özel (sr-only) metin ve
 * [data-allow-truncate] hariç. Dikey eşik yarım em: yazı içerik alanı satır yüksekliğini birkaç px aşabilir, gizlenen
 * satır ise en az bir satır yüksekliğidir.
 */
function clippedTextViolations(opts: { root?: string } = {}): string[] {
  const root = opts.root ? document.querySelector(opts.root) : document.body;
  if (!root) return [`kök bulunamadı: ${opts.root}`];
  const describe = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`;
  };
  const visible = (el: Element) => {
    const probe = el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
    return typeof probe.checkVisibility === 'function' ? probe.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0;
  };
  const srCache = new Map<Element, boolean>();
  const srOnly = (el: Element | null): boolean => {
    if (!el || el === document.body || el === document.documentElement) return false;
    const cached = srCache.get(el);
    if (cached !== undefined) return cached;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const own = (r.width <= 2 && r.height <= 2 && cs.display !== 'inline' && cs.display !== 'contents')
      || /^inset\(50%\)$/.test(cs.clipPath.replace(/\s+/g, ''))
      || /^rect\(0(px)?,?0(px)?,?0(px)?,?0(px)?\)$/.test(cs.clip.replace(/\s+/g, ''));
    const result = own || srOnly(el.parentElement);
    srCache.set(el, result);
    return result;
  };
  const out: string[] = [];
  const reported = new Set<Element>();
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || el.closest('script, style, noscript, template, [data-allow-truncate]')) continue;
    if (!visible(el) || srOnly(el)) continue;
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) continue;
    const box = {
      left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)),
    };
    const yTol = Math.max(2, parseFloat(getComputedStyle(el).fontSize) / 2);
    let xDone = false;
    let yDone = false;
    for (let a: Element | null = el; a && a !== document.documentElement && !(xDone && yDone); a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'inline' || cs.display === 'contents') continue;
      const clipX = !xDone && (cs.overflowX === 'hidden' || cs.overflowX === 'clip');
      const clipY = !yDone && (cs.overflowY === 'hidden' || cs.overflowY === 'clip');
      if (clipX || clipY) {
        const ar = a.getBoundingClientRect();
        const left = ar.left + a.clientLeft;
        const top = ar.top + a.clientTop;
        const right = left + a.clientWidth;
        const bottom = top + a.clientHeight;
        const meets = box.right > left && box.left < right && box.bottom > top && box.top < bottom;
        const cutX = clipX && (box.left < left - 1.5 || box.right > right + 1.5);
        const cutY = clipY && (box.top < top - yTol || box.bottom > bottom + yTol);
        if (meets && (cutX || cutY) && !reported.has(el)) {
          reported.add(el);
          out.push(`${describe(el)} "${text.slice(0, 40)}": ${describe(a)} içinde ${cutX ? 'yatay' : 'dikey'} kırpılıyor`);
          break;
        }
      }
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') xDone = true;
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') yDone = true;
    }
  }
  return out.slice(0, 20);
}

/**
 * Dokunma hedefleri: görünür her hedefin kutusu min × min; hedefler örtüşmez. Görsel olarak gizli native onay
 * kutusu/radyo dokunulan etiketle, kenarlıklı sarmalayıcıdaki giriş (imleci text/pointer olan, başka hedef içermeyen
 * en çok iki ata ya da label) sarmalayıcıyla ölçülür. Cümle içi bağlantı (display inline, çevresinde metin) WCAG 2.5.8
 * satır içi istisnasıdır. Ekran okuyucuya özel (sr-only) ve odakta değilken gizli olanlar sayılmaz.
 */
function targetViolations(opts: { min: number; selector: string; root?: string }): { small: string[]; overlap: string[]; count: number } {
  const visible = (el: Element) => {
    const probe = el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
    return typeof probe.checkVisibility === 'function' ? probe.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0;
  };
  // Açık modal katman varsa (aria-modal) yalnız en üstteki modalın hedefleri dokunulabilir; arkadaki sayfa ölçülmez.
  const modals = Array.from(document.querySelectorAll('[aria-modal="true"]')).filter(visible);
  const root = opts.root ? document.querySelector(opts.root) : modals[modals.length - 1] || document.body;
  if (!root) return { small: [`kök bulunamadı: ${opts.root}`], overlap: [], count: 0 };
  const label = (el: Element) => {
    const name = (el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 28);
    const role = el.getAttribute('role');
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    return `${el.tagName.toLowerCase()}${cls}${role ? `[role=${role}]` : ''}${name ? ` "${name}"` : ''}`;
  };
  const hiddenVisually = (el: Element, r: DOMRect) => {
    const cs = getComputedStyle(el);
    return (r.width <= 2 && r.height <= 2) || /^inset\(50%\)$/.test(cs.clipPath.replace(/\s+/g, '')) || /^rect\(0(px)?,?0(px)?,?0(px)?,?0(px)?\)$/.test(cs.clip.replace(/\s+/g, ''));
  };
  // İğnelenmiş katman (fixed ya da belge düzeyi sticky): arkasından kayan içerikle örtüşmesi tasarımdır; o çakışmayı
  // odak örtülmesi taraması ölçer. Örtüşme yalnız aynı katmandaki hedefler arasında aranır.
  const layerOf = (el: Element): Element | null => {
    let found: Element | null = null;
    for (let p: Element | null = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === 'fixed') return p;
      if (pos === 'sticky' && !found) found = p;
      if (found) {
        const cs = getComputedStyle(p);
        if (p !== found && /(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) found = null;
      }
    }
    return found;
  };
  const all = Array.from(root.querySelectorAll(opts.selector));
  const items: Array<{ el: Element; box: { left: number; top: number; right: number; bottom: number }; name: string; layer: Element | null }> = [];
  for (const el of all) {
    if (el.closest('[aria-hidden="true"], [inert]')) continue;
    let target: Element = el;
    const input = el as HTMLInputElement;
    const toggle = el.tagName === 'INPUT' && (input.type === 'checkbox' || input.type === 'radio');
    const r0 = el.getBoundingClientRect();
    if (toggle && (!visible(el) || hiddenVisually(el, r0))) {
      const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
      target = el.closest('label') || byFor || el.parentElement || el;
      if (!visible(target)) continue;
    } else {
      if (!visible(el)) continue;
      if (hiddenVisually(el, r0) && document.activeElement !== el) continue;
    }
    const tr = target.getBoundingClientRect();
    if (tr.width === 0 || tr.height === 0) continue;
    const cs = getComputedStyle(el);
    if (el.tagName === 'A' && cs.display === 'inline' && el.parentElement) {
      const own = (el.textContent || '').trim().length;
      const around = (el.parentElement.textContent || '').trim().length;
      if (around > own) continue;
    }
    let box = { left: tr.left, top: tr.top, right: tr.right, bottom: tr.bottom };
    let p = target.parentElement;
    for (let depth = 0; depth < 2 && p && p !== root; depth++, p = p.parentElement) {
      // Sarmalayıcı yalnız bu hedefi taşıyorsa (görünmeyen temizle simgesi vb. sayılmaz) dokunulan kutudur.
      if (Array.from(p.querySelectorAll(opts.selector)).some((other) => other !== el && !other.contains(el) && !el.contains(other) && visible(other))) break;
      const pcs = getComputedStyle(p);
      const pr = p.getBoundingClientRect();
      // Görünür alan çerçevesi: dört kenarı çizili, en çok iki hedef yüksekliğinde kutu (ör. önek simgeli giriş).
      const framed = ['top', 'right', 'bottom', 'left'].every((side) => parseFloat(pcs.getPropertyValue(`border-${side}-width`)) > 0
        && !/^(none|hidden)$/.test(pcs.getPropertyValue(`border-${side}-style`))) && pr.height < opts.min * 2;
      if (p.tagName !== 'LABEL' && pcs.cursor !== 'pointer' && pcs.cursor !== 'text' && !framed) continue;
      box = { left: Math.min(box.left, pr.left), top: Math.min(box.top, pr.top), right: Math.max(box.right, pr.right), bottom: Math.max(box.bottom, pr.bottom) };
    }
    items.push({ el, box, name: label(el), layer: layerOf(el) });
  }
  const small: string[] = [];
  for (const it of items) {
    const w = it.box.right - it.box.left;
    const h = it.box.bottom - it.box.top;
    if (w < opts.min - 0.5 || h < opts.min - 0.5) small.push(`${it.name} ${Math.round(w)}×${Math.round(h)} < ${opts.min}`);
  }
  const overlap: string[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.el.contains(b.el) || b.el.contains(a.el) || a.layer !== b.layer) continue;
      const w = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const h = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (w > 1 && h > 1) overlap.push(`${a.name} ↔ ${b.name} ${Math.round(w)}×${Math.round(h)} px örtüşüyor`);
    }
  }
  return { small: small.slice(0, 25), overlap: overlap.slice(0, 15), count: items.length };
}

/** Paylaşılan motionViolations'ı tamamlar: süreli geçişte `all` özelliği ve sıfırdan farklı gecikme yasak. */
function motionExtraViolations(opts: { root?: string } = {}): string[] {
  const root = opts.root ? document.querySelector(opts.root) : document.body;
  if (!root) return [`kök bulunamadı: ${opts.root}`];
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
  const describe = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`;
  };
  const out = new Set<string>();
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (el.closest('[data-allow-motion]') || getComputedStyle(el).display === 'none') continue;
    for (const pseudo of ['', '::before', '::after']) {
      const s = getComputedStyle(el, pseudo || null);
      if (pseudo && (!s.content || s.content === 'none' || s.content === 'normal')) continue;
      const where = describe(el) + pseudo;
      const props = list(s.transitionProperty);
      const durations = list(s.transitionDuration);
      const delays = list(s.transitionDelay);
      props.forEach((prop, i) => {
        if (prop === 'none' || !durations.length || !(ms(durations[i % durations.length]) > 0)) return;
        if (prop === 'all') out.add(`${where}: transition-property all (özellikler açıkça listelenmeli)`);
        const delay = delays.length ? ms(delays[i % delays.length]) : 0;
        if (delay !== 0) out.add(`${where}: transition ${prop} gecikme ${delay}ms (beklenen 0)`);
      });
      const names = list(s.animationName);
      const aDurations = list(s.animationDuration);
      const aDelays = list(s.animationDelay);
      names.forEach((name, i) => {
        if (name === 'none' || !aDurations.length || !(ms(aDurations[i % aDurations.length]) > 0)) return;
        const delay = aDelays.length ? ms(aDelays[i % aDelays.length]) : 0;
        if (delay !== 0) out.add(`${where}: animation ${name} gecikme ${delay}ms (beklenen 0)`);
      });
    }
  }
  return Array.from(out).slice(0, 30);
}

/** Kapsamda çalışan (süresi > 0) Web Animations: CSS geçişleri dahil. reduced-motion'da boş olmalı. */
function runningAnimations(opts: { root?: string } = {}): string[] {
  return document.getAnimations()
    .filter((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target;
      const duration = Number(a.effect?.getComputedTiming().duration ?? 0);
      return a.playState === 'running' && duration > 0 && target instanceof Element && (!opts.root || !!target.closest(opts.root));
    })
    .map((a) => {
      const target = (a.effect as KeyframeEffect).target as Element;
      const name = (a as Animation & { transitionProperty?: string; animationName?: string });
      return `${target.tagName.toLowerCase()} ${a.constructor.name} ${name.transitionProperty ?? name.animationName ?? ''} ${String(a.effect?.getComputedTiming().duration)}ms`;
    })
    .slice(0, 20);
}

/**
 * Yapışkan/sabit katmanlar ve güvenli alan (verilen inset değerlerine göre geometri):
 *  - kaydırma başındayken hiçbir görünür içerik (hedef, metin) üst inset alanında başlamaz;
 *  - alt kenara yapışmış katmanın görünür içeriği alt inset alanına girmez; katman içindeki dikey kaydırıcılar önce
 *    sona kaydırılır (son öğe ev çubuğunun üstünde kalmalı), ölçümden sonra geri alınır;
 *  - her görünür içerik yatayda sol/sağ inset bandının içinde kalır.
 * İçerik kutusu, taşmayı kırpan/kaydıran atalarının kutusuyla kesilir (görünen kısım ölçülür; tamamen kırpılan sayılmaz).
 * Katman: position fixed ya da belge düzeyinde (kaydırma kapsayıcısı atası olmayan) sticky.
 */
function safeAreaViolations(opts: { insets: { top: number; right: number; bottom: number; left: number }; selector: string; atTop: boolean }): string[] {
  const { insets } = opts;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  type Box = { left: number; top: number; right: number; bottom: number };
  const describe = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ''}`;
  };
  const visible = (el: Element) => {
    const probe = el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
    return typeof probe.checkVisibility === 'function' ? probe.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0;
  };
  const pinned = (el: Element) => {
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed') return true;
    if (pos !== 'sticky') return false;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) return false;
    }
    return true;
  };
  const srOnly = (el: Element, r: Box) => {
    const cs = getComputedStyle(el);
    return (r.right - r.left <= 2 && r.bottom - r.top <= 2) || /^inset\(50%\)$/.test(cs.clipPath.replace(/\s+/g, ''));
  };
  /** Kırpan atalarla kesişim (eksen başına overflow hidden/clip/auto/scroll); boşsa null. */
  const clipped = (el: Element, box: Box): Box | null => {
    let b = { ...box };
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.display === 'inline' || cs.display === 'contents') continue;
      const cx = cs.overflowX !== 'visible';
      const cy = cs.overflowY !== 'visible';
      if (!cx && !cy) continue;
      const r = p.getBoundingClientRect();
      if (cx) b = { ...b, left: Math.max(b.left, r.left), right: Math.min(b.right, r.right) };
      if (cy) b = { ...b, top: Math.max(b.top, r.top), bottom: Math.min(b.bottom, r.bottom) };
      if (b.right - b.left <= 0.5 || b.bottom - b.top <= 0.5) return null;
    }
    return b;
  };

  const layers = Array.from(document.body.querySelectorAll('*')).filter((el) => pinned(el) && visible(el));
  const bottomLayers = layers.filter((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.bottom >= vh - 1 && r.top < vh; });
  const restore: Array<[Element, number]> = [];
  for (const layer of bottomLayers) {
    for (const s of [layer, ...Array.from(layer.querySelectorAll('*'))]) {
      const oy = getComputedStyle(s).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && s.scrollHeight > s.clientHeight + 1) { restore.push([s, s.scrollTop]); s.scrollTop = s.scrollHeight; }
    }
  }

  // İçerik kutuları: hedefler ve metin düğümleri (görünür, sr-only değil), kırpan atalarla kesilmiş.
  const contents: Array<{ el: Element; box: Box }> = [];
  const push = (el: Element, raw: Box) => { const box = clipped(el, raw); if (box) contents.push({ el, box }); };
  for (const el of Array.from(document.body.querySelectorAll(opts.selector))) {
    if (!visible(el) || el.closest('[aria-hidden="true"], [inert]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || (srOnly(el, r) && document.activeElement !== el)) continue;
    push(el, r);
  }
  const range = document.createRange();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!(node.textContent || '').trim()) continue;
    const el = node.parentElement;
    if (!el || el.closest('script, style, noscript, template, [aria-hidden="true"]') || !visible(el)) continue;
    if (srOnly(el, el.getBoundingClientRect())) continue;
    let hiddenAncestor = false;
    for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
      if (/^inset\(50%\)$/.test(getComputedStyle(p).clipPath.replace(/\s+/g, ''))) { hiddenAncestor = true; break; }
    }
    if (hiddenAncestor) continue;
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) continue;
    push(el, { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)), top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) });
  }

  const out = new Set<string>();
  for (const { el, box } of contents) {
    const where = describe(el);
    if (opts.atTop && insets.top > 0 && box.bottom > 0 && box.top < insets.top - 0.5) out.add(`${where}: üst güvenli alanda (üst ${Math.round(box.top)}px < ${insets.top}px)`);
    if (bottomLayers.some((layer) => layer.contains(el)) && box.bottom > vh - insets.bottom + 0.5 && box.top < vh) {
      out.add(`${where}: alt yapışkan katmanda ev çubuğu alanına giriyor (alt ${Math.round(box.bottom)}px > ${vh - insets.bottom}px)`);
    }
    if (box.right <= 0 || box.left >= vw) continue;
    if (box.left < insets.left - 0.5) out.add(`${where}: sol güvenli alanda (sol ${Math.round(box.left)}px < ${insets.left}px)`);
    if (box.right > vw - insets.right + 0.5) out.add(`${where}: sağ güvenli alanda (sağ ${Math.round(box.right)}px > ${vw - insets.right}px)`);
  }
  for (const [s, top] of restore) s.scrollTop = top;
  return Array.from(out).slice(0, 25);
}

/**
 * Bildirim denetimi (her iki motor): içerik taşıyan, üst ya da alt kenara iğnelenmiş (top/bottom ≈ 0) her
 * fixed/belge düzeyi sticky katmanın kendisi ya da alt ağacı o kenar için güvenli alan payı okuyan bir stil kuralı ya da
 * satır içi stil taşımalı. Geometri öykünemeyen motorda (WebKit) güvenli alanın tek kanıtıdır.
 * Pay doğrudan env(safe-area-inset-<kenar>) ya da merkezi token üzerinden okunabilir (b04: admin.css
 * `:root { --aile-safe-top: env(safe-area-inset-top, 0px) }`, bileşen `var(--aile-safe-top)`): değeri env() ya da böyle
 * bir özelliğe var() olan özel özellikler (zincir dahil) o kenarın taşıyıcısıdır. Taşıyıcı, okuyan öğede tanımlı olmalı
 * (hesaplanmış değeri boş değil); tanımsız bir var() bildirim sayılmaz.
 */
function safeAreaDeclarationViolations(): string[] {
  const rules: CSSStyleRule[] = [];
  const collect = (list: CSSRuleList) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) rules.push(rule);
      const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
      if (nested) collect(nested);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try { collect(sheet.cssRules); } catch { /* başka kökenden stil sayfası okunamaz */ }
  }
  const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reads = (text: string, name: string) => new RegExp(`var\\(\\s*${escape(name)}\\s*[,)]`).test(text);
  const carriers: Record<string, string[]> = {};
  for (const edge of ['top', 'bottom']) {
    const needle = `safe-area-inset-${edge}`;
    const names = new Set<string>();
    for (let grew = true; grew;) {
      grew = false;
      for (const rule of rules) {
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style[i];
          if (!prop.startsWith('--') || names.has(prop)) continue;
          const value = rule.style.getPropertyValue(prop);
          if (value.includes(needle) || Array.from(names).some((name) => reads(value, name))) { names.add(prop); grew = true; }
        }
      }
    }
    carriers[edge] = Array.from(names);
  }
  const declares = (el: Element, edge: string) => {
    const needle = `safe-area-inset-${edge}`;
    const defined = carriers[edge].filter((name) => getComputedStyle(el).getPropertyValue(name).trim() !== '');
    const hit = (text: string) => text.includes(needle) || defined.some((name) => reads(text, name));
    if (hit(el.getAttribute('style') || '')) return true;
    return rules.some((rule) => {
      if (!hit(rule.style.cssText)) return false;
      try { return el.matches(rule.selectorText); } catch { return false; }
    });
  };
  const visible = (el: Element) => {
    const probe = el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
    return typeof probe.checkVisibility === 'function' ? probe.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0;
  };
  const pinned = (el: Element) => {
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed') return true;
    if (pos !== 'sticky') return false;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) return false;
    }
    return true;
  };
  const describe = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`;
  };
  const out: string[] = [];
  const layers = Array.from(document.body.querySelectorAll('*')).filter((el) => pinned(el) && visible(el) && !!(el.textContent || '').trim());
  for (const layer of layers) {
    if (layers.some((other) => other !== layer && other.contains(layer))) continue;
    const cs = getComputedStyle(layer);
    const edges: string[] = [];
    if (cs.top !== 'auto' && Math.abs(parseFloat(cs.top)) <= 1) edges.push('top');
    if (cs.bottom !== 'auto' && Math.abs(parseFloat(cs.bottom)) <= 1) edges.push('bottom');
    const tree = [layer, ...Array.from(layer.querySelectorAll('*')).slice(0, 300)];
    for (const edge of edges) {
      if (!tree.some((el) => declares(el, edge))) out.push(`${describe(layer)}: ${edge === 'top' ? 'üst' : 'alt'} kenara yapışık, env(safe-area-inset-${edge}) payı yok`);
    }
  }
  return out;
}

/** İğnelenmiş katmanlar birbirini örtmez (biri ötekini içermiyorsa). */
function pinnedOverlapViolations(): string[] {
  const visible = (el: Element) => {
    const probe = el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
    return typeof probe.checkVisibility === 'function' ? probe.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0;
  };
  const pinned = (el: Element) => {
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed') return true;
    if (pos !== 'sticky') return false;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) return false;
    }
    return true;
  };
  const describe = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    return `${el.tagName.toLowerCase()}${cls}`;
  };
  const layers = Array.from(document.body.querySelectorAll('*'))
    .filter((el) => pinned(el) && visible(el) && !!(el.textContent || '').trim());
  const top = layers.filter((el) => !layers.some((o) => o !== el && o.contains(el)));
  const out: string[] = [];
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i].getBoundingClientRect();
      const b = top[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) out.push(`${describe(top[i])} ↔ ${describe(top[j])} ${Math.round(w)}×${Math.round(h)} px örtüşüyor`);
    }
  }
  return out;
}

/**
 * Odak örtülmesi: main içindeki her odaklanabilir öğe sırayla odaklanır (tarayıcı görünür alana kaydırır); odaktaki
 * öğenin kutusu herhangi bir iğnelenmiş katmanla (üst bar, yapışkan form altlığı) kesişmemeli. Ters sıra (sondan başa)
 * üst katmanı, düz sıra alt katmanı sınar. Kapsam kökü verilebilir (öz denetim).
 * emulateReveal: Playwright WebKit programatik focus()'ta görünür alana hiç kaydırmaz (ölçüldü: görünüm dışındaki ve
 * üst barın altında kısmen kalan düğme, bağlantı ve girişte scrollY değişmez); klavyeyle (Alt+Tab) gezinmede ise kaydırır
 * ve scroll-padding'e uyar. Bu motorda kullanıcı yolunun karşılığı odaktan sonra scrollIntoView({ block: 'nearest' })
 * çağrısıdır (scroll-padding/scroll-margin'e uyar, öğe dolgulu görünür alandaysa kaydırmaz). Chromium focus()'ta kendisi
 * kaydırır; orada öykünme yok, tarayıcının gerçek davranışı ölçülür.
 */
function obscuredFocusViolations(opts: { reverse: boolean; max: number; selector: string; root?: string; emulateReveal?: boolean }): string[] {
  const root = document.querySelector(opts.root || 'main#admin-content');
  if (!root) return ['odak kökü yok'];
  const visible = (el: Element) => {
    const probe = el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
    return typeof probe.checkVisibility === 'function' ? probe.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0;
  };
  const pinned = (el: Element) => {
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed') return true;
    if (pos !== 'sticky') return false;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) return false;
    }
    return true;
  };
  const describe = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ''}`;
  };
  const layers = Array.from(document.body.querySelectorAll('*')).filter((el) => pinned(el) && visible(el) && !!(el.textContent || '').trim());
  const items = Array.from(root.querySelectorAll<HTMLElement>(opts.selector))
    .filter((el) => el.tabIndex >= 0 && visible(el) && !el.closest('[inert], [aria-hidden="true"]') && !layers.some((l) => l.contains(el)));
  const scroller = document.scrollingElement || document.documentElement;
  if (opts.reverse) { items.reverse(); window.scrollTo(0, scroller.scrollHeight); } else window.scrollTo(0, 0);
  const out: string[] = [];
  for (const el of items.slice(0, opts.max)) {
    el.focus();
    if (document.activeElement !== el) continue;
    if (opts.emulateReveal) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    for (const layer of layers) {
      if (layer.contains(el)) continue;
      const lr = layer.getBoundingClientRect();
      const w = Math.min(r.right, lr.right) - Math.max(r.left, lr.left);
      const h = Math.min(r.bottom, lr.bottom) - Math.max(r.top, lr.top);
      if (w > 1 && h > 1) { out.push(`${describe(el)} odakta ${describe(layer)} altında (${Math.round(h)} px örtülü)`); break; }
    }
  }
  (document.activeElement as HTMLElement | null)?.blur?.();
  window.scrollTo(0, 0);
  return out.slice(0, 15);
}

// --- Ortak adımlar ---------------------------------------------------------------------------------------------------

/** Sonlu animasyonlar bitene kadar (sonsuz döngüler hariç) rAF ile bekler; sabit süre yok. */
async function settle(page: Page) {
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity),
    undefined,
    { polling: 'raf', timeout: 5_000 },
  );
}

const nextFrames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

async function open(page: Page, route: string, size?: Size) {
  if (size) await page.setViewportSize(size);
  const main = await openAdmin(page, route);
  await settle(page);
  return main;
}

const isCoarse = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'));

/**
 * Yerleşim denetimi üç kümeye ayrılır; her küme ayrı test olur ki sistem çapındaki bir kusur (coarse 48, kütüphane
 * hareketi) yeşil kalan kuralları kırmızıya boyamasın ve sahibi test adından okunabilsin. Boş kategori = temiz.
 */
async function auditLayout(page: Page): Promise<Record<string, string[]>> {
  const targets = await page.evaluate(targetViolations, { min: TARGET_MIN, selector: TARGET_SELECTOR });
  return {
    'belge/görünüm taşması ve kesilen etiket': await overflow(page),
    'yalnız tablo kapsayıcısı yana kayar': await page.evaluate(scrollerViolations),
    'gizli taşmada kırpılan metin': await page.evaluate(clippedTextViolations, {}),
    'kavisli vurgu kenarı': await accentEdges(page),
    [`dokunma hedefi ≥ ${TARGET_MIN}`]: targets.small,
    'dokunma hedefleri örtüşmez': targets.overlap,
  };
}

/** html[data-input-coarse] varken her hedef ≥ 48. Coarse giriş yoksa kural uygulanmaz ve test bunu not eder. */
async function auditCoarse(page: Page, info: TestInfo): Promise<Record<string, string[]>> {
  if (!(await isCoarse(page))) {
    info.annotations.push({ type: 'not_applicable', description: 'coarse giriş katmanı yok (html[data-input-coarse] yok); 48 px kuralı uygulanmaz' });
    return {};
  }
  const targets = await page.evaluate(targetViolations, { min: TARGET_COARSE, selector: TARGET_SELECTOR });
  return { [`coarse girişte dokunma hedefi ≥ ${TARGET_COARSE}`]: targets.small };
}

async function auditMotion(page: Page, root?: string): Promise<Record<string, string[]>> {
  return {
    'hareket tokenı (süre, eğri)': await motion(page, MOTION_EASE, MOTION_MS, root ? { root } : {}),
    'hareket (gecikme yok, transition all yok)': await page.evaluate(motionExtraViolations, root ? { root } : {}),
  };
}

const AUDITS = [
  { title: 'taşma yok, yalnız tablo kayar, etiket kesilmez, kavisli vurgu kenarı yok, hedefler ≥ 44 ve örtüşmez', run: (page: Page) => auditLayout(page) },
  { title: 'coarse girişte hedefler ≥ 48', run: (page: Page, info: TestInfo) => auditCoarse(page, info) },
  { title: 'hareket tokenı: 240 ms, onaylı eğri, gecikme 0, transition all yok', run: (page: Page, _info: TestInfo, root?: string) => auditMotion(page, root) },
] as const;

function expectClean(results: Record<string, string[]>, where: string) {
  for (const [category, list] of Object.entries(results)) expect.soft(list, `${where} · ${category}`).toEqual([]);
}

async function expectProfile(page: Page, size: Size, where: string) {
  await expect.soft(page.locator('html'), `${where} · profil`).toHaveAttribute('data-profile', expectedProfile(size));
}

const pagesButton = (page: Page) => page.getByRole('button', { name: 'Sayfalar', exact: true });
const navDialog = (page: Page) => page.getByRole('dialog', { name: 'Sayfalar' });
const topBar = (page: Page) => page.locator('header').filter({ has: pagesButton(page) });
const desktopNav = (page: Page) => page.locator('aside').filter({ has: page.getByRole('navigation', { name: 'Sayfalar' }) });
const contentInner = (page: Page) => page.locator('main#admin-content > *').first();

/** Öğenin body altındaki portal atasını test özniteliğiyle işaretler; dönen seçici dedektör köküdür. */
async function markPortalRoot(locator: Locator, name: string): Promise<string> {
  await locator.evaluate((el, value) => {
    let top: Element = el;
    while (top.parentElement && top.parentElement !== document.body) top = top.parentElement;
    top.setAttribute('data-f03-kok', value);
  }, name);
  return `[data-f03-kok="${name}"]`;
}

async function activeInside(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => !!document.activeElement && el.contains(document.activeElement));
}

/** Chromium: CDP ile güvenli alan öykünmesi. WebKit'te öykünme yok; inset 0 kalır ve test bunu not eder. */
async function emulateSafeArea(page: Page, browserName: string, insets: Insets, info: TestInfo): Promise<Insets> {
  if (browserName !== 'chromium') {
    info.annotations.push({ type: 'not_run', description: `${browserName}: safe-area inset öykünmesi yok; geometri 0 inset ile, güvenli alan yalnız stil bildirimiyle denetlendi` });
    return NO_INSETS;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
  return insets;
}

// --- 1. Telefon önce: tüm sayfalar proje görünümünde (@matrix) --------------------------------------------------------

test.describe('tüm sayfalar · proje görünümü', () => {
  for (const route of ROUTES) {
    for (const auditSet of AUDITS) {
      test(`${route}: ${auditSet.title}`, MATRIX, async ({ page }, info) => {
        const size = page.viewportSize()!;
        await open(page, route);
        await expectProfile(page, size, route);
        expectClean(await auditSet.run(page, info), `${route} @ ${size.width}×${size.height}`);
      });
    }
  }
});

// --- 2. Telefon 320×568 ve kısa telefon 320×480: tüm sayfalar, her motorda açık görünüm -----------------------------
// Proje görünümü zaten aynı boyutsa (chromium 320×568) aynı denetim 1. bölümde koşmuştur; yineleme yerine not düşülür.

test.describe('tüm sayfalar · telefon 320×568 ve kısa telefon 320×480', () => {
  for (const size of [PHONE, PHONE_SHORT]) {
    const label = `${size.width}×${size.height}`;
    for (const route of ROUTES) {
      for (const auditSet of AUDITS) {
        test(`${route} @ ${label}: ${auditSet.title}`, async ({ page }, info) => {
          const project = page.viewportSize()!;
          test.skip(project.width === size.width && project.height === size.height, `proje görünümü zaten ${label}: aynı denetim "proje görünümü" testinde koşar`);
          await open(page, route, size);
          await expectProfile(page, size, route);
          expectClean(await auditSet.run(page, info), `${route} @ ${label}`);
        });
      }
    }
  }
});

// --- 3. Reduced-motion: tüm sayfalarda hareket yok (@matrix) ---------------------------------------------------------

test.describe('tüm sayfalar · reduced-motion', () => {
  for (const route of ROUTES) {
    test(`${route}: reduced-motion'da süreli geçiş/animasyon yok, çalışan animasyon yok`, MATRIX, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, route);
      expect.soft(await motion(page, MOTION_EASE, MOTION_MS, { reduced: true }), `${route} bildirilen hareket`).toEqual([]);
      expect.soft(await page.evaluate(runningAnimations, {}), `${route} çalışan animasyon`).toEqual([]);
    });
  }
});

// --- 4. Yapışkan katmanlar ve güvenli alan (@matrix) ------------------------------------------------------------------

test.describe('tüm sayfalar · yapışkan katmanlar ve güvenli alan', () => {
  for (const route of ROUTES) {
    test(`${route}: güvenli alan payı bildirilir, içerik çentik/ev çubuğu alanına girmez, katmanlar örtüşmez`, MATRIX, async ({ page, browserName }, info) => {
      const size = page.viewportSize()!;
      const insets = await emulateSafeArea(page, browserName, insetsFor(size), info);
      await open(page, route);
      const where = `${route} @ ${size.width}×${size.height}`;

      expect.soft(await page.evaluate(safeAreaDeclarationViolations), `${where} · güvenli alan bildirimi`).toEqual([]);
      expect.soft(await page.evaluate(safeAreaViolations, { insets, selector: TARGET_SELECTOR, atTop: true }), `${where} · güvenli alan (kaydırma başı)`).toEqual([]);
      expect.soft(await page.evaluate(pinnedOverlapViolations), `${where} · katman örtüşmesi (kaydırma başı)`).toEqual([]);

      // Alt kenara yapışan her katman: kapsayıcısı görünüm üstüne hizalanır; katman takılı durumda ölçülür.
      const stickyBottoms = await page.evaluate(() => Array.from(document.querySelectorAll('main#admin-content *'))
        .filter((el) => { const cs = getComputedStyle(el); return cs.position === 'sticky' && cs.bottom !== 'auto'; }).length);
      for (let i = 0; i < stickyBottoms; i++) {
        await page.evaluate((index) => {
          const el = Array.from(document.querySelectorAll('main#admin-content *'))
            .filter((e) => { const cs = getComputedStyle(e); return cs.position === 'sticky' && cs.bottom !== 'auto'; })[index];
          el?.parentElement?.scrollIntoView({ block: 'start' });
        }, i);
        await nextFrames(page);
        expect.soft(await page.evaluate(safeAreaViolations, { insets, selector: TARGET_SELECTOR, atTop: false }), `${where} · alt yapışkan katman ${i + 1} güvenli alan`).toEqual([]);
        expect.soft(await page.evaluate(pinnedOverlapViolations), `${where} · alt yapışkan katman ${i + 1} örtüşme`).toEqual([]);
      }
    });

    test(`${route}: odaklanan öğe yapışkan üst bar ya da alt eylem katmanı altında kalmaz`, MATRIX, async ({ page, browserName }, info) => {
      const size = page.viewportSize()!;
      await emulateSafeArea(page, browserName, insetsFor(size), info);
      await open(page, route);
      const where = `${route} @ ${size.width}×${size.height}`;
      expect.soft(await page.evaluate(obscuredFocusViolations, { reverse: false, max: 60, selector: FOCUSABLE_SELECTOR, emulateReveal: browserName === 'webkit' }), `${where} · odak alt katmanla örtülü (ileri)`).toEqual([]);
      expect.soft(await page.evaluate(obscuredFocusViolations, { reverse: true, max: 60, selector: FOCUSABLE_SELECTOR, emulateReveal: browserName === 'webkit' }), `${where} · odak üst katmanla örtülü (geri)`).toEqual([]);
    });
  }
});

// Görev koşusunda kısa telefon ve yatay telefon için açık kanıt: yapışkan form altlığı olan sayfa (Ayarlar). Kaynak:
// tasarim-sistemi/README.md › Uyarlanır teslim ("Form altlığı (FormFooter) telefonda yapışkandır") ve tasarımın Ayarlar
// ekranı (bundle.js › Ayarlar: FormFooter sticky). Altlık yüksekliğini belge kaydırma payı olarak ayırır (FormFooter.css
// :root:has(.aile-ff--yapiskan)); odaklanan alan altlığın altında kalmaz.
test.describe('yapışkan form altlığı · kısa ve yatay telefon', () => {
  for (const size of [PHONE_SHORT, { width: 568, height: 320 }]) {
    test(`/ayarlar @ ${size.width}×${size.height}: altlık güvenli alanda, katmanlar örtüşmez, odak örtülmez`, async ({ page, browserName }, info) => {
      await page.setViewportSize(size);
      const insets = await emulateSafeArea(page, browserName, insetsFor(size), info);
      await open(page, '/ayarlar');
      await expectProfile(page, size, '/ayarlar');
      const where = `/ayarlar @ ${size.width}×${size.height}`;
      // Altlık hesaplanmış stilden bulunur (position sticky + bottom): sınıf adına bağlı değil.
      const stuck = await page.evaluate(() => {
        const footer = Array.from(document.querySelectorAll('main#admin-content *'))
          .find((el) => { const cs = getComputedStyle(el); return cs.position === 'sticky' && cs.bottom !== 'auto' && !!el.querySelector('button'); });
        footer?.parentElement?.scrollIntoView({ block: 'start' });
        return !!footer;
      });
      expect(stuck, 'telefonda yapışkan form altlığı var').toBe(true);
      await nextFrames(page);
      expect.soft(await page.evaluate(safeAreaDeclarationViolations), `${where} · güvenli alan bildirimi`).toEqual([]);
      expect.soft(await page.evaluate(safeAreaViolations, { insets, selector: TARGET_SELECTOR, atTop: false }), `${where} · altlık güvenli alanda`).toEqual([]);
      expect.soft(await page.evaluate(pinnedOverlapViolations), `${where} · üst bar ile altlık örtüşmez`).toEqual([]);
      expect.soft(await page.evaluate(obscuredFocusViolations, { reverse: false, max: 60, selector: FOCUSABLE_SELECTOR, emulateReveal: browserName === 'webkit' }), `${where} · odak altlık altında (ileri)`).toEqual([]);
      expect.soft(await page.evaluate(obscuredFocusViolations, { reverse: true, max: 60, selector: FOCUSABLE_SELECTOR, emulateReveal: browserName === 'webkit' }), `${where} · odak üst bar altında (geri)`).toEqual([]);
    });
  }
});

// --- 5. Kabuk: telefon üst barı, tablet ve masaüstü en son ------------------------------------------------------------

test.describe('kabuk geometrisi', () => {
  for (const size of [PHONE, PHONE_SHORT]) {
    test(`${size.width}×${size.height}: üst bar en üstte, ${TOPBAR} px, yapışkan; nav yan sütunu yok`, async ({ page }) => {
      // Kısa sayfa adı tek satıra sığar: ölçü sözleşmesi tam TOPBAR.
      await open(page, '/genel', size);
      const bar = topBar(page);
      await expect(bar).toBeVisible();
      await expect(desktopNav(page)).toHaveCount(0);
      const box = (await bar.boundingBox())!;
      expect(box.y).toBeCloseTo(0, 0);
      expect(box.height).toBeCloseTo(TOPBAR, 0);
      expect(box.width).toBeCloseTo(size.width, 0);

      // Kaydırılabilir içerik garanti: main içine yalnız bu sayfa örneğinde boşluk eklenir.
      await page.evaluate(() => {
        const spacer = document.createElement('div');
        spacer.style.height = '300vh';
        spacer.setAttribute('aria-hidden', 'true');
        document.querySelector('main#admin-content')?.appendChild(spacer);
      });
      await page.evaluate(() => window.scrollTo(0, 800));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
      const scrolled = (await bar.boundingBox())!;
      expect(scrolled.y).toBeCloseTo(0, 0);
      expect(scrolled.height).toBeCloseTo(TOPBAR, 0);
      await expect(pagesButton(page)).toBeInViewport();
    });
  }

  test(`320×568 uzun sayfa adında (/veri) üst bar ≥ ${TOPBAR} px ve sarılan adı kapsar, etiket kesilmez, taşma yok`, async ({ page }) => {
    await open(page, '/veri', PHONE);
    const bar = topBar(page);
    const barBox = (await bar.boundingBox())!;
    expect(barBox.height).toBeGreaterThanOrEqual(TOPBAR - 0.5);
    // Ad kelimeler arasından sarılır; bar büyür ve sarılan adın tamamı barın içinde kalır (bar taşmayı gizlemez, bu yüzden
    // kırpma denetimi taşan satırı görmez; kutu karşılaştırması görür).
    const title = (await bar.locator('p').first().boundingBox())!;
    expect(title.y).toBeGreaterThanOrEqual(barBox.y - 0.5);
    expect(title.y + title.height).toBeLessThanOrEqual(barBox.y + barBox.height + 0.5);
    expect(await page.evaluate(clippedTextViolations, { root: 'header' }), 'üst barda kırpılan metin').toEqual([]);
    expect(await runDetector(page, 'overflowViolations', { root: 'header' }), 'üst barda taşma ya da kesme').toEqual([]);
    await expect(pagesButton(page)).toBeVisible();
  });

  test('568×320 yatay telefon: telefon profili, üst bar ve Sayfalar; yan nav yok', async ({ page }) => {
    await open(page, '/alimlar', { width: 568, height: 320 });
    await expect(page.locator('html')).toHaveAttribute('data-profile', 'phone');
    await expect(pagesButton(page)).toBeVisible();
    await expect(desktopNav(page)).toHaveCount(0);
  });

  test('tablet 820×1180: üst bar ve Sayfalar; yan nav yok; içerik görünümde', async ({ page }) => {
    await open(page, '/alimlar', TABLET);
    await expect(page.locator('html')).toHaveAttribute('data-profile', 'tablet');
    await expect(topBar(page)).toBeVisible();
    await expect(desktopNav(page)).toHaveCount(0);
    const inner = (await contentInner(page).boundingBox())!;
    expect(inner.x).toBeGreaterThanOrEqual(0);
    expect(inner.x + inner.width).toBeLessThanOrEqual(TABLET.width + 0.5);
  });

  test('masaüstü 1440×900: solda 272 px nav, üst bar yok, içerik ≤ 1480 ve nav sağında', async ({ page }) => {
    await open(page, '/alimlar', DESKTOP);
    await expect(page.locator('html')).toHaveAttribute('data-profile', 'desktop');
    const nav = desktopNav(page);
    await expect(nav).toBeVisible();
    const navBox = (await nav.boundingBox())!;
    expect(navBox.x).toBeCloseTo(0, 0);
    expect(navBox.width).toBeCloseTo(NAV_WIDTH, 0);
    await expect(pagesButton(page)).toHaveCount(0);
    const inner = (await contentInner(page).boundingBox())!;
    expect(inner.width).toBeLessThanOrEqual(CONTENT_MAX);
    expect(inner.x).toBeGreaterThanOrEqual(NAV_WIDTH);
    expect(inner.x + inner.width).toBeLessThanOrEqual(DESKTOP.width);
  });

  test('geniş masaüstü 2200 px: içerik tam 1480 ve nav sağındaki alanda ortalı', async ({ page }) => {
    await open(page, '/alimlar', { width: 2200, height: 900 });
    const inner = (await contentInner(page).boundingBox())!;
    expect(inner.width).toBeCloseTo(CONTENT_MAX, 0);
    const main = (await page.locator('main#admin-content').boundingBox())!;
    expect(Math.abs((inner.x - main.x) - (main.x + main.width - (inner.x + inner.width)))).toBeLessThanOrEqual(1);
    expect(await overflow(page, { truncation: false })).toEqual([]);
  });
});

// --- 5b. Uyarlamalı yoğunluk ve dokunma tokenları (b04 sözleşmesi) -------------------------------------------------------
// html üzerindeki hesaplanmış --aile-yogunluk-kenar/bosluk/yogun ve --aile-dokunma-hedefi, src/design/tokens.ts'deki
// densityFor(width, profile) ve targetTokens ile birebir eşleşmeli. Beklenen profil testin kendi W0 eşiklerinden
// (expectedProfile) gelir; sayfanın data-profile değeri ayrıca doğrulanır, böylece karşılaştırma totoloji değildir.

interface AdaptiveTokenReading { width: number; profile: string | null; coarse: boolean; kenar: string; bosluk: string; yogun: string; hedef: string }

async function readAdaptiveTokens(page: Page): Promise<AdaptiveTokenReading> {
  return page.evaluate((names) => {
    const html = document.documentElement;
    const cs = getComputedStyle(html);
    const read = (name: string) => cs.getPropertyValue(name).trim();
    return {
      width: window.innerWidth, profile: html.getAttribute('data-profile'), coarse: html.hasAttribute('data-input-coarse'),
      kenar: read(names.kenar), bosluk: read(names.bosluk), yogun: read(names.yogun), hedef: read('--aile-dokunma-hedefi'),
    };
  }, densityVarNames);
}

function expectedAdaptiveTokens(size: Size, coarse: boolean) {
  const band = densityFor(size.width, expectedProfile(size) as DensityProfile);
  return {
    profile: expectedProfile(size), kenar: `${band.kenar}px`, bosluk: `${band.bosluk}px`, yogun: `${band.yogun}px`,
    hedef: `${coarse ? targetTokens.dokunmaHedefiCoarse : targetTokens.dokunmaHedefi}px`,
  };
}

const actualAdaptiveTokens = (r: AdaptiveTokenReading) => ({ profile: r.profile, kenar: r.kenar, bosluk: r.bosluk, yogun: r.yogun, hedef: r.hedef });

test.describe('yoğunluk ve dokunma tokenları', () => {
  test('html üzerindeki --aile-yogunluk-* ve --aile-dokunma-hedefi densityFor(width, profile) ve targetTokens ile eşleşir', MATRIX, async ({ page }) => {
    const size = page.viewportSize()!;
    await open(page, '/genel');
    const reading = await readAdaptiveTokens(page);
    expect(reading.width, 'ölçülen genişlik proje görünümü').toBe(size.width);
    expect(actualAdaptiveTokens(reading), `${size.width}×${size.height} coarse=${reading.coarse}`).toEqual(expectedAdaptiveTokens(size, reading.coarse));
  });

  test('telefon önce sırayla tüm bantlar: 320 → 360 → 375 → 390 → yatay telefon → tablet → masaüstü; yeniden boyutlandırmada anında güncellenir', async ({ page }) => {
    const sizes: Size[] = [
      PHONE, PHONE_SHORT, { width: 360, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 844 },
      { width: 568, height: 320 }, { width: 844, height: 390 }, TABLET, { width: 1180, height: 820 }, DESKTOP,
    ];
    await open(page, '/genel', sizes[0]);
    for (const size of sizes) {
      await page.setViewportSize(size);
      const coarse = await isCoarse(page);
      const expected = expectedAdaptiveTokens(size, coarse);
      // Yeniden boyutlandırma tek rAF'te birleşir: sabit bekleme yerine değer gelene kadar yoklanır.
      await expect.poll(async () => actualAdaptiveTokens(await readAdaptiveTokens(page)), { message: `${size.width}×${size.height} coarse=${coarse}`, timeout: 2_000 })
        .toEqual(expected);
    }
  });
});

// --- 6. Büyütme: kullanıcı kök yazı boyutu 200% ve tarayıcı zoom'u 200% -----------------------------------------------

test.describe('büyütme', () => {
  for (const size of [PHONE, TABLET, DESKTOP]) {
    test(`${size.width}×${size.height} kök yazı boyutu 200%: taşma ve kesilen etiket yok, yalnız tablo kayar`, async ({ page }) => {
      test.slow();
      await page.setViewportSize(size);
      for (const route of ['/genel', '/alimlar', '/butce', '/veri']) {
        await openAdmin(page, route);
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await settle(page);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
        expect.soft(await overflow(page), `${route} kök 200% taşma/kesme`).toEqual([]);
        expect.soft(await page.evaluate(scrollerViolations), `${route} kök 200% kayan kapsayıcı`).toEqual([]);
      }
    });
  }

  for (const size of [DESKTOP, TABLET]) {
    const zoomed = { width: size.width / 2, height: size.height / 2 };
    test(`${size.width}×${size.height} @ 200% zoom (${zoomed.width}×${zoomed.height} CSS px): taşma yok, Sayfalar erişilir`, async ({ page }) => {
      await open(page, '/alimlar', zoomed);
      await expectProfile(page, zoomed, '/alimlar zoom');
      expect.soft(await overflow(page), 'zoom taşma/kesme').toEqual([]);
      await expect(pagesButton(page)).toBeVisible();
      await pagesButton(page).click();
      await expect(navDialog(page)).toBeVisible();
      await settle(page);
      expect.soft(await overflow(page), 'zoom + çekmece taşma/kesme').toEqual([]);
    });
  }
});

// --- 7. Sayfalar çekmecesi: modal, yerleşim, hareket ------------------------------------------------------------------

test.describe('Sayfalar çekmecesi', () => {
  for (const size of [PHONE, TABLET]) {
    test(`${size.width}×${size.height}: modal, görünüm içinde; odak içeride; Escape kapatır ve odak döner`, async ({ page, browserName }) => {
      await open(page, '/alimlar', size);
      await enterKeyboardMode(page, browserName);
      const button = pagesButton(page);
      await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await button.focus();
      await page.keyboard.press('Enter');

      const dialog = navDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(dialog.getByRole('heading', { level: 2, name: 'Sayfalar' })).toBeVisible();
      await expect(dialog.getByRole('navigation', { name: 'Sayfalar' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Kapat' })).toBeVisible();
      await expect.poll(() => activeInside(dialog), 'açılınca odak çekmecede').toBe(true);
      await settle(page);

      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(-0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);

      // Odak tuzağı: bağlantı sayısından fazla Tab'da odak hep çekmecede kalır (modal).
      const stops = (await dialog.getByRole('link').count()) + 3;
      for (let i = 0; i < stops; i++) {
        await page.keyboard.press(tabKey(browserName));
        expect(await activeInside(dialog), `Tab ${i + 1}: odak çekmece dışına çıktı`).toBe(true);
      }

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(button).toBeFocused();
      await expect(button).toHaveAttribute('aria-expanded', 'false');
    });
  }

  for (const size of [PHONE, TABLET]) {
    for (const auditSet of AUDITS) {
      test(`${size.width}×${size.height} açık çekmece: ${auditSet.title}`, async ({ page }, info) => {
        await open(page, '/alimlar', size);
        await pagesButton(page).click();
        await expect(navDialog(page)).toBeVisible();
        await settle(page);
        // Hareket yalnız çekmece katmanında ölçülür (örtü + panel: diyaloğun body altındaki portal atası); arkadaki
        // sayfa modal açıkken hareket etmez ve kendi sayfa testinde ölçülür. Hedef ölçümü zaten en üstteki modalla sınırlı.
        const root = await markPortalRoot(navDialog(page), 'cekmece');
        expectClean(await auditSet.run(page, info, root), `çekmece açık @ ${size.width}×${size.height}`);
      });
    }
  }

  test('320×568: Kapat düğmesi kapatır ve odak döner; bağlantı seçimi gezinir, kapatır, odak main\'e geçer', async ({ page }) => {
    await open(page, '/alimlar', PHONE);
    const button = pagesButton(page);
    await button.click();
    const dialog = navDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Kapat' }).click();
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Alımlar ve eşyalar' })).toHaveAttribute('aria-current', 'page');
    await dialog.getByRole('link', { name: 'Genel durum' }).click();
    await expect(page).toHaveURL(/#\/genel$/);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Genel durum');
    await expect(page.locator('main#admin-content')).toBeFocused();
  });

  test('320×568 güvenli alan: açık çekmecenin içeriği çentik ve ev çubuğu alanına girmez', async ({ page, browserName }, info) => {
    await page.setViewportSize(PHONE);
    const insets = await emulateSafeArea(page, browserName, insetsFor(PHONE), info);
    await open(page, '/alimlar');
    await pagesButton(page).click();
    await expect(navDialog(page)).toBeVisible();
    await settle(page);
    expect.soft(await page.evaluate(safeAreaDeclarationViolations), 'çekmece güvenli alan bildirimi').toEqual([]);
    expect.soft(await page.evaluate(safeAreaViolations, { insets, selector: TARGET_SELECTOR, atTop: true }), 'çekmece güvenli alan geometrisi').toEqual([]);
  });

  test('320×568: açılış ve kapanış 240 ms, onaylı eğri, gecikmesiz, transition all yok; işlev anında', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page, '/alimlar', PHONE);
    // Yalnız çekmece katmanının (diyaloğu taşıyan portal) hareketi sayılır: odağın döndüğü düğmenin kendi geçişi
    // çekmecenin kapanış hareketi yerine geçmez.
    await installMotionProbe(page, DIALOG_PORTAL);
    await pagesButton(page).click();
    // İşlev anında: durum ve görünürlük hareket süresinden önce.
    await expect(pagesButton(page)).toHaveAttribute('aria-expanded', 'true', { timeout: MOTION_MS });
    await expect(navDialog(page)).toBeVisible({ timeout: MOTION_MS });
    await motionDone(page);
    expect.soft(judgeMotion(await readMotion(page), { reduced: false, label: 'açılış' })).toEqual([]);

    await installMotionProbe(page, DIALOG_PORTAL);
    await page.keyboard.press('Escape');
    await expect(pagesButton(page)).toBeFocused({ timeout: MOTION_MS });
    await expect(pagesButton(page)).toHaveAttribute('aria-expanded', 'false', { timeout: MOTION_MS });
    await motionDone(page);
    expect.soft(judgeMotion(await readMotion(page), { reduced: false, label: 'kapanış' })).toEqual([]);
    await expect(navDialog(page)).toBeHidden();
  });

  test('320×568 reduced-motion: çekmece aynı karede açılır ve kapanır, hareket yok', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '/alimlar', PHONE);
    // The drawer body is a lazy chunk. Load it once, so the timed open below measures motion, not the download.
    await pagesButton(page).click();
    await expect(navDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(navDialog(page)).toBeHidden();
    await installMotionProbe(page, 'body');
    await pagesButton(page).click();
    await expect(navDialog(page)).toBeVisible({ timeout: 100 });
    await nextFrames(page);
    expect.soft(await page.evaluate(runningAnimations, {}), 'açılışta çalışan animasyon').toEqual([]);
    expect.soft(await motion(page, MOTION_EASE, MOTION_MS, { reduced: true }), 'açıkken bildirilen hareket').toEqual([]);
    expect.soft(judgeMotion(await readMotion(page), { reduced: true, label: 'açılış' })).toEqual([]);

    await installMotionProbe(page, 'body');
    await page.keyboard.press('Escape');
    await expect(navDialog(page)).toBeHidden({ timeout: 100 });
    await expect(pagesButton(page)).toBeFocused();
    await nextFrames(page);
    expect.soft(judgeMotion(await readMotion(page), { reduced: true, label: 'kapanış' })).toEqual([]);
  });
});

// --- Hareket olay sondası --------------------------------------------------------------------------------------------
// transitionrun/animationstart olaylarını belge düzeyinde yakalar; her kayıt için o anki hesaplanmış süre, gecikme, eğri
// ve listelenen özellik okunur. Bitiş sinyali: başlayan her hareket için end/cancel olayı ve çalışan sonlu animasyon yok.

/** Diyaloğu taşıyan portal (body çocuğu): örtü ve panel birlikte; olay anında closest ile eşlenir. */
const DIALOG_PORTAL = 'body > [role="dialog"], body > :has([role="dialog"])';

interface MotionRecord {
  kind: 'transition' | 'animation';
  target: string;
  property: string;
  listed: string;
  durationMs: number;
  delayMs: number;
  easing: string;
}

async function installMotionProbe(page: Page, scope: string) {
  await page.evaluate((scopeSelector) => {
    type Store = { records: MotionRecord[]; scope: string; started: number; ended: number; installed?: boolean };
    const w = window as unknown as { __aileMotion?: Store };
    if (w.__aileMotion?.installed) {
      Object.assign(w.__aileMotion, { records: [], scope: scopeSelector, started: 0, ended: 0 });
      return;
    }
    const store: Store = { records: [], scope: scopeSelector, started: 0, ended: 0, installed: true };
    w.__aileMotion = store;
    const splitList = (value: string) => {
      const out: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of value) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    const ms = (v: string) => (v.trim().endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);
    const pick = (list: string[], i: number) => list[i % Math.max(list.length, 1)] ?? '';
    const describe = (el: Element) => {
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`;
    };
    const inScope = (e: Event) => e.target instanceof Element && !!e.target.closest(store.scope);
    const record = (e: TransitionEvent | AnimationEvent) => {
      if (!inScope(e)) return;
      store.started++;
      const target = e.target as Element;
      const cs = getComputedStyle(target, e.pseudoElement || null);
      if (e instanceof TransitionEvent) {
        const props = splitList(cs.transitionProperty);
        let i = props.indexOf(e.propertyName);
        if (i < 0) i = props.indexOf('all');
        if (i < 0) i = 0;
        store.records.push({
          kind: 'transition', target: describe(target) + (e.pseudoElement || ''), property: e.propertyName, listed: props[i] ?? '',
          durationMs: ms(pick(splitList(cs.transitionDuration), i)), delayMs: ms(pick(splitList(cs.transitionDelay), i)),
          easing: pick(splitList(cs.transitionTimingFunction), i),
        });
      } else {
        const names = splitList(cs.animationName);
        const i = Math.max(names.indexOf(e.animationName), 0);
        store.records.push({
          kind: 'animation', target: describe(target) + (e.pseudoElement || ''), property: e.animationName, listed: e.animationName,
          durationMs: ms(pick(splitList(cs.animationDuration), i)), delayMs: ms(pick(splitList(cs.animationDelay), i)),
          easing: pick(splitList(cs.animationTimingFunction), i),
        });
      }
    };
    const end = (e: Event) => { if (inScope(e)) store.ended++; };
    document.addEventListener('transitionrun', record, true);
    document.addEventListener('animationstart', record, true);
    for (const type of ['transitionend', 'transitioncancel', 'animationend', 'animationcancel']) document.addEventListener(type, end, true);
  }, scope);
}

/** Hareket bitti: en az bir hareket başladı, her biri bitti ya da iptal edildi, çalışan sonlu animasyon yok. Hareket hiç
 *  başlamazsa üst sınırda vazgeçilir; judgeMotion bunu "hareket kaydı yok" olarak raporlar. */
async function motionDone(page: Page) {
  await page.waitForFunction(() => {
    const store = (window as unknown as { __aileMotion?: { started: number; ended: number } }).__aileMotion;
    const running = document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity);
    return !!store && store.started > 0 && store.ended >= store.started && !running;
  }, undefined, { polling: 'raf', timeout: 3_000 }).catch(() => undefined);
}

async function readMotion(page: Page): Promise<MotionRecord[]> {
  return page.evaluate(() => (window as unknown as { __aileMotion?: { records: MotionRecord[] } }).__aileMotion?.records ?? []);
}

const CURVE_KEYWORDS: Record<string, readonly number[]> = {
  ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1], linear: [0, 0, 1, 1],
};

function curveOf(easing: string): readonly number[] | null {
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(easing.trim());
  if (m) return m[1].split(',').map((n) => Number(n.trim()));
  return CURVE_KEYWORDS[easing.trim()] ?? null;
}

/**
 * Saf değerlendirme. Normal: en az bir kayıt olmalı (boş geçiş = kanıtsız geçiş), her kayıt 240 ms, tek onaylı eğri,
 * gecikme 0 ve `transition: all` değil (UX hareket sözleşmesi). Reduced: süresi > 0 olan her kayıt ihlaldir.
 */
function judgeMotion(records: MotionRecord[], mode: { reduced: boolean; label: string }): string[] {
  const bad: string[] = [];
  if (mode.reduced) {
    for (const r of records) if (r.durationMs > 0) bad.push(`${mode.label}: reduced-motion'da ${r.kind} ${r.target} ${r.property} ${r.durationMs}ms`);
    return bad;
  }
  if (records.length === 0) bad.push(`${mode.label}: hareket kaydı yok (geçiş ölçülemedi)`);
  for (const r of records) {
    const where = `${mode.label}: ${r.kind} ${r.target} ${r.property}`;
    if (Math.abs(r.durationMs - MOTION_MS) > 0.5) bad.push(`${where} süre ${r.durationMs}ms ≠ ${MOTION_MS}ms`);
    if (r.delayMs !== 0) bad.push(`${where} gecikme ${r.delayMs}ms`);
    const curve = curveOf(r.easing);
    if (!curve || curve.length !== 4 || curve.some((v, i) => Math.abs(v - MOTION_CURVE[i]) > 1e-3)) bad.push(`${where} eğri ${r.easing}`);
    if (r.kind === 'transition' && r.listed === 'all') bad.push(`${where} transition-property all`);
  }
  return bad;
}

// --- 8. Dedektör öz denetimi: bilinçli ihlal yakalanmalı, uyumlu örnek temiz kalmalı ---------------------------------

/** Gerçek yönetim sayfasına (uygulama CSS'iyle birlikte) test parçası enjekte eder; dönen kök seçicisi. */
async function inject(page: Page, id: string, html: string, css = ''): Promise<string> {
  await page.evaluate(({ id: hostId, html: markup, css: style }) => {
    document.getElementById(hostId)?.remove();
    const host = document.createElement('section');
    host.id = hostId;
    host.setAttribute('aria-label', `öz denetim ${hostId}`);
    host.innerHTML = (style ? `<style>${style}</style>` : '') + markup;
    document.querySelector('main#admin-content')!.appendChild(host);
  }, { id, html, css });
  return `#${id}`;
}

test.describe('dedektör öz denetimi', () => {
  test('paylaşılan dedektörler bu motorda çalışır (enjekte ihlal yakalanır)', async ({ page }) => {
    await open(page, '/alimlar', PHONE);
    expect(await selfCheckDetectors(page)).toEqual([]);
  });

  test('dokunma hedefi: 30 px ve 46 px hedef, örtüşen çift yakalanır; 48 px, satır içi bağlantı ve etiketli gizli kutu temiz', async ({ page }) => {
    await open(page, '/alimlar', PHONE);
    const css = `#oz-hedef button { all: unset; display: inline-block; box-sizing: border-box; font: 16px/20px sans-serif; }
      #oz-hedef .k { width: 30px; height: 30px; } #oz-hedef .o { width: 46px; height: 46px; } #oz-hedef .b { width: 48px; height: 48px; }
      #oz-hedef .ust { position: relative; height: 60px; } #oz-hedef .ust button { position: absolute; top: 0; width: 48px; height: 48px; }
      #oz-hedef .ust .ikinci { left: 24px; } #oz-hedef label { display: inline-flex; width: 48px; height: 48px; cursor: pointer; }
      #oz-hedef label input { position: absolute; opacity: 0; width: 1px; height: 1px; }
      #oz-hedef .alan { display: flex; align-items: center; width: 240px; height: 48px; box-sizing: border-box; padding: 0 8px; }
      #oz-hedef .alan input { all: unset; display: block; flex: 1; height: 24px; font: 16px/24px sans-serif; }
      #oz-hedef #cerceve .alan { border: 1px solid rgb(82, 105, 124); } #oz-hedef #cercevesiz .alan { border: 0; }`;
    const root = await inject(page, 'oz-hedef', `
      <div id="kucuk"><button class="k">K</button></div>
      <div id="orta"><button class="o">O</button></div>
      <div id="ortusen" class="ust"><button class="birinci">1</button><button class="ikinci">2</button></div>
      <div id="temiz"><button class="b">B</button>
        <p>Ayrıntı için <a href="#/genel">genel duruma</a> bakın.</p>
        <label><input type="checkbox"><span>S</span></label></div>
      <div id="cerceve"><div class="alan"><input aria-label="Çerçeveli arama"></div></div>
      <div id="cercevesiz"><div class="alan"><input aria-label="Çıplak arama"></div></div>`, css);
    const at = (sub: string, min: number) => page.evaluate(targetViolations, { min, selector: TARGET_SELECTOR, root: `${root} ${sub}` });
    expect((await at('#kucuk', TARGET_MIN)).small).toHaveLength(1);
    expect((await at('#orta', TARGET_MIN)).small).toEqual([]);
    expect((await at('#orta', TARGET_COARSE)).small).toHaveLength(1);
    const overlap = await at('#ortusen', TARGET_MIN);
    expect(overlap.small).toEqual([]);
    expect(overlap.overlap).toHaveLength(1);
    const clean = await at('#temiz', TARGET_COARSE);
    expect(clean.count, 'temiz örnekte sayılan hedef: düğme + etiketli kutu (satır içi bağlantı istisna)').toBe(2);
    expect(clean.small).toEqual([]);
    expect(clean.overlap).toEqual([]);
    // Önek simgeli giriş: 24 px giriş, 48 px çizili alan çerçevesiyle ölçülür; çerçevesiz sarmalayıcı yardım etmez.
    expect((await at('#cerceve', TARGET_COARSE)).small).toEqual([]);
    expect((await at('#cercevesiz', TARGET_MIN)).small).toEqual([expect.stringContaining('Çıplak arama')]);
  });

  test('dokunma hedefi istisnaları kör değil: açık modalda yalnız modal ölçülür ama içindeki küçük hedef yakalanır; aynı sabit katmandaki örtüşme yakalanır', async ({ page }) => {
    await open(page, '/alimlar', PHONE);
    const css = `#oz-katmanli button { all: unset; display: block; box-sizing: border-box; width: 48px; height: 48px; font: 16px/20px sans-serif; }
      #oz-katmanli .alt { position: fixed; left: 0; right: 0; bottom: 0; height: 120px; z-index: 40; background: white; }
      #oz-katmanli .alt button { position: absolute; top: 8px; } #oz-katmanli .alt .iki { left: 24px; }`;
    await inject(page, 'oz-katmanli', '<div class="alt"><button class="bir">1</button><button class="iki">2</button></div>', css);
    const layered = await page.evaluate(targetViolations, { min: TARGET_MIN, selector: TARGET_SELECTOR });
    expect(layered.overlap.filter((m) => m.includes('"1"') && m.includes('"2"')), 'aynı sabit katmanda örtüşen iki düğme').toHaveLength(1);
    await page.evaluate(() => document.getElementById('oz-katmanli')?.remove());

    await page.evaluate(() => {
      const dialog = document.createElement('div');
      dialog.id = 'oz-modal';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', 'Öz denetim modalı');
      dialog.style.cssText = 'position:fixed;inset:0;z-index:70;background:white';
      dialog.innerHTML = '<button style="all:unset;display:block;width:30px;height:30px">K</button>';
      document.body.appendChild(dialog);
    });
    const modal = await page.evaluate(targetViolations, { min: TARGET_MIN, selector: TARGET_SELECTOR });
    expect(modal.count, 'modal açıkken yalnız modal içindeki hedef sayılır').toBe(1);
    expect(modal.small).toEqual([expect.stringContaining('"K" 30×30')]);
    await page.evaluate(() => document.getElementById('oz-modal')?.remove());
  });

  test('yatay kaydırma: tablo dışı kayan şerit yakalanır; tablo kapsayıcısı ve adlı pano bölgesi temiz', async ({ page }) => {
    await open(page, '/alimlar', PHONE);
    await inject(page, 'oz-kaydirma', `
      <div id="serit" style="overflow-x:auto;width:200px"><div style="width:600px;height:20px">geniş şerit</div></div>
      <div id="tablo" style="overflow-x:auto;width:200px"><table><tr><td style="min-width:600px">geniş tablo</td></tr></table></div>
      <div id="pano" role="region" aria-label="Pano" tabindex="0" style="overflow-x:auto;width:200px"><div style="width:600px;height:20px">pano</div></div>`);
    const found = await page.evaluate(scrollerViolations);
    expect(found.filter((m) => m.includes('#serit'))).toHaveLength(1);
    expect(found.filter((m) => m.includes('#tablo') || m.includes('Pano'))).toEqual([]);
    await page.evaluate(() => document.getElementById('oz-kaydirma')?.remove());
    expect(await page.evaluate(scrollerViolations)).not.toContainEqual(expect.stringContaining('#serit'));
  });

  test('kırpılan metin: sabit yükseklikte gizlenen ikinci satır ve dar kutuda gizlenen metin yakalanır; sığan metin temiz', async ({ page }) => {
    await open(page, '/alimlar', PHONE);
    const root = await inject(page, 'oz-kirpma', `
      <div id="dikey"><span style="display:block;width:90px;height:24px;overflow:hidden;font:16px/24px sans-serif">Çok uzun bir eylem etiketi burada</span></div>
      <div id="yatay"><div style="width:60px;overflow:hidden"><span style="display:inline-block;white-space:nowrap;font:16px/24px sans-serif">Uzun etiket metni</span></div></div>
      <div id="sigan"><span style="display:block;width:200px;overflow:hidden;font:16px/24px sans-serif">Kısa</span></div>`);
    expect(await page.evaluate(clippedTextViolations, { root: `${root} #dikey` })).toHaveLength(1);
    expect(await page.evaluate(clippedTextViolations, { root: `${root} #yatay` })).toHaveLength(1);
    expect(await page.evaluate(clippedTextViolations, { root: `${root} #sigan` })).toEqual([]);
  });

  test('hareket: transition all ve gecikme yakalanır (yerel), 300 ms linear (paylaşılan); reduced kipte 240 ms yakalanır; uyumlu temiz', async ({ page }) => {
    await open(page, '/alimlar', PHONE);
    const root = await inject(page, 'oz-hareket', `
      <div id="hepsi"><div style="transition: all 240ms cubic-bezier(.65,0,.35,1)">a</div></div>
      <div id="gecikme"><div style="transition: opacity 240ms cubic-bezier(.65,0,.35,1) 100ms">g</div></div>
      <div id="yavas"><div style="transition: opacity 300ms linear">y</div></div>
      <div id="uyumlu"><div style="transition: opacity 240ms cubic-bezier(.65,0,.35,1), transform 240ms cubic-bezier(.65,0,.35,1)">u</div></div>`);
    expect(await page.evaluate(motionExtraViolations, { root: `${root} #hepsi` })).toEqual([expect.stringContaining('transition-property all')]);
    expect(await page.evaluate(motionExtraViolations, { root: `${root} #gecikme` })).toEqual([expect.stringContaining('gecikme 100ms')]);
    expect((await motion(page, MOTION_EASE, MOTION_MS, { root: `${root} #yavas` })).length).toBeGreaterThan(0);
    expect(await motion(page, MOTION_EASE, MOTION_MS, { root: `${root} #uyumlu` })).toEqual([]);
    expect(await page.evaluate(motionExtraViolations, { root: `${root} #uyumlu` })).toEqual([]);
    expect((await motion(page, MOTION_EASE, MOTION_MS, { root: `${root} #uyumlu`, reduced: true })).length).toBeGreaterThan(0);
  });

  test('hareket sondası: 500 ms ease, gecikme ve all olayları yakalanır; 240 ms onaylı eğri temiz; reduced her süreyi yakalar', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <div id="kotu"><div class="m" style="width:40px;height:40px;transition: opacity 500ms ease 0s"></div></div>
      <div id="gecikme"><div class="m" style="width:40px;height:40px;transition: opacity 240ms cubic-bezier(.65,0,.35,1) 100ms"></div></div>
      <div id="hepsi"><div class="m" style="width:40px;height:40px;transition: all 240ms cubic-bezier(.65,0,.35,1)"></div></div>
      <div id="iyi"><div class="m" style="width:40px;height:40px;transition: opacity 240ms cubic-bezier(.65,0,.35,1)"></div></div>
    </body></html>`);
    const run = async (scope: string) => {
      await installMotionProbe(page, scope);
      await page.evaluate((s) => {
        const el = document.querySelector<HTMLElement>(`${s} .m`)!;
        void el.offsetWidth;
        el.style.opacity = el.style.opacity === '0' ? '1' : '0';
      }, scope);
      await motionDone(page);
      return readMotion(page);
    };
    const kotu = judgeMotion(await run('#kotu'), { reduced: false, label: 'kotu' });
    expect(kotu.some((m) => m.includes('500ms'))).toBe(true);
    expect(kotu.some((m) => m.includes('eğri ease'))).toBe(true);
    expect(judgeMotion(await run('#gecikme'), { reduced: false, label: 'gecikme' }).some((m) => m.includes('gecikme 100ms'))).toBe(true);
    expect(judgeMotion(await run('#hepsi'), { reduced: false, label: 'hepsi' }).some((m) => m.includes('transition-property all'))).toBe(true);
    const iyi = await run('#iyi');
    expect(iyi.length).toBeGreaterThan(0);
    expect(judgeMotion(iyi, { reduced: false, label: 'iyi' })).toEqual([]);
    expect(judgeMotion(iyi, { reduced: true, label: 'iyi-reduced' }).length).toBeGreaterThan(0);
    expect(judgeMotion([], { reduced: false, label: 'bos' })).toEqual(['bos: hareket kaydı yok (geçiş ölçülemedi)']);
    expect(judgeMotion([], { reduced: true, label: 'bos' })).toEqual([]);

    // Diyalog portalı kapsamı: portal içindeki geçiş sayılır, dışındaki (odak dönen düğme gibi) sayılmaz.
    await page.evaluate(() => {
      const portal = document.createElement('div');
      portal.innerHTML = '<div role="dialog" aria-label="Öz denetim"><div class="m" style="width:40px;height:40px;transition: opacity 240ms cubic-bezier(.65,0,.35,1)"></div></div>';
      document.body.appendChild(portal);
    });
    await installMotionProbe(page, DIALOG_PORTAL);
    await page.evaluate(() => {
      for (const el of [document.querySelector<HTMLElement>('#iyi .m')!, document.querySelector<HTMLElement>('[role="dialog"] .m')!]) {
        void el.offsetWidth;
        el.style.opacity = el.style.opacity === '0' ? '1' : '0';
      }
    });
    await motionDone(page);
    const portalRecords = await readMotion(page);
    expect(portalRecords.length, 'yalnız portal içindeki geçiş kaydedilir').toBe(1);
    expect(judgeMotion(portalRecords, { reduced: false, label: 'portal' })).toEqual([]);
  });

  test('çalışan animasyon: süreli geçiş ortasında yakalanır, bitince temiz', async ({ page }) => {
    await page.setContent('<!doctype html><html><body><div id="m" style="width:40px;height:40px;transition: opacity 240ms cubic-bezier(.65,0,.35,1)"></div></body></html>');
    await page.evaluate(() => { const el = document.getElementById('m')!; void el.offsetWidth; el.style.opacity = '0'; });
    await nextFrames(page);
    expect((await page.evaluate(runningAnimations, {})).length).toBeGreaterThan(0);
    await settle(page);
    expect(await page.evaluate(runningAnimations, {})).toEqual([]);
  });

  test('güvenli alan: paysız alt sabit katman ve üst inset alanındaki içerik yakalanır; env() paylı katman temiz', async ({ page, browserName }) => {
    await page.setViewportSize(PHONE);
    const insets = insetsFor(PHONE);
    if (browserName === 'chromium') await emulateSafeArea(page, browserName, insets, test.info());
    await open(page, '/alimlar');
    const css = `.oz-alt { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; background: white; }
      .oz-alt button { display: block; width: 100%; height: 48px; }
      .oz-alt--payli { padding-bottom: env(safe-area-inset-bottom, 0px); }`;
    await inject(page, 'oz-guvenli', '<div class="oz-alt"><button>Kaydet</button></div>', css);
    // Bildirim denetimi her motorda: env() payı yok.
    expect(await page.evaluate(safeAreaDeclarationViolations)).toContainEqual(expect.stringContaining('oz-alt'));
    // Geometri, verilen inset ölçüsüne göre her motorda yakalar (içerik ev çubuğu alanında).
    expect(await page.evaluate(safeAreaViolations, { insets, selector: TARGET_SELECTOR, atTop: false })).toContainEqual(expect.stringContaining('ev çubuğu'));
    // Üst inset: kaydırma başında üst kenara yerleştirilen içerik.
    await inject(page, 'oz-ust', '<p style="position:absolute;top:4px;left:120px;margin:0;font:16px/20px sans-serif">çentik altında</p>');
    expect(await page.evaluate(safeAreaViolations, { insets, selector: TARGET_SELECTOR, atTop: true })).toContainEqual(expect.stringContaining('üst güvenli alanda'));
    await page.evaluate(() => document.getElementById('oz-ust')?.remove());

    // Alttan sayfa içindeki kaydırıcı: sona kaydırılınca son öğe ev çubuğu alanında kalırsa yakalanır; ölçüm kaydırmayı geri alır.
    await inject(page, 'oz-sayfa', `<div class="oz-sayfa" role="dialog" aria-label="Alt sayfa"><div class="oz-govde">${
      Array.from({ length: 12 }, (_, i) => `<button>Seçenek ${i + 1}</button>`).join('')}</div></div>`,
    `.oz-sayfa { position: fixed; left: 0; right: 0; bottom: 0; height: 240px; z-index: 55; background: white; display: flex; }
     .oz-govde { overflow-y: auto; flex: 1; } .oz-govde button { display: block; width: 100%; height: 48px; }`);
    expect(await page.evaluate(safeAreaViolations, { insets, selector: TARGET_SELECTOR, atTop: false })).toContainEqual(expect.stringContaining('Seçenek 12'));
    expect(await page.evaluate(() => document.querySelector('#oz-sayfa .oz-govde')!.scrollTop), 'ölçüm kaydırmayı geri alır').toBe(0);
    await page.evaluate(() => document.getElementById('oz-sayfa')?.remove());

    // Merkezi token üzerinden bildirim (admin.css --aile-safe-* gibi): env()'e çözülen özel özellik zinciri sayılır; sıfıra
    // çözülen, okuyan öğede tanımsız (başka kökte) ya da env() taşımayan özellik sayılmaz.
    await inject(page, 'oz-token', '', `#oz-guvenli { --oz-pay-alt: env(safe-area-inset-bottom, 0px); --oz-pay-zincir: var(--oz-pay-alt); --oz-sifir: 0px; }
      #oz-baska-kok { --oz-kapsam-disi: env(safe-area-inset-bottom, 0px); }
      .oz-alt--token { padding-bottom: var(--oz-pay-zincir); } .oz-alt--sifir { padding-bottom: var(--oz-sifir); }
      .oz-alt--kapsam { padding-bottom: var(--oz-kapsam-disi, 0px); }`);
    const toggle = (cls: string, on: boolean) => page.evaluate(([c, add]) => document.querySelector('#oz-guvenli .oz-alt')!.classList.toggle(c, add), [cls, on] as const);
    const declarationWith = async (cls: string) => {
      await toggle(cls, true);
      const out = await page.evaluate(safeAreaDeclarationViolations);
      await toggle(cls, false);
      return out;
    };
    expect(await declarationWith('oz-alt--token'), 'env() zinciri taşıyan token').not.toContainEqual(expect.stringContaining('oz-alt'));
    expect(await declarationWith('oz-alt--sifir'), 'sıfır token').toContainEqual(expect.stringContaining('oz-alt'));
    expect(await declarationWith('oz-alt--kapsam'), 'okuyan öğede tanımsız token').toContainEqual(expect.stringContaining('oz-alt'));
    await page.evaluate(() => document.getElementById('oz-token')?.remove());

    await page.evaluate(() => document.querySelector('#oz-guvenli .oz-alt')?.classList.add('oz-alt--payli'));
    expect(await page.evaluate(safeAreaDeclarationViolations)).not.toContainEqual(expect.stringContaining('oz-alt'));
    if (browserName === 'chromium') {
      // Yalnız env() gerçekten 34 px'e çözüldüğünde geometri temizlenir (WebKit'te env() 0'dır).
      expect(await page.evaluate(safeAreaViolations, { insets, selector: TARGET_SELECTOR, atTop: false })).not.toContainEqual(expect.stringContaining('Kaydet'));
    }
  });

  test('odak örtülmesi (geri): yarısı üst barın altında kalan öğeye geri odak yakalanır; scroll-padding-top bar kadarken temiz', async ({ page, browserName }) => {
    await open(page, '/alimlar', PHONE);
    const emulateReveal = browserName === 'webkit';
    // Son odaklanabilir öğe: ardından gelen boşluk, belge sonuna kaydırılınca öğeyi görünüm üst kenarında yarıya böler.
    await page.evaluate(() => {
      const host = document.createElement('section');
      host.id = 'oz-odak-ust';
      host.setAttribute('aria-label', 'öz denetim üst odak');
      host.innerHTML = '<button type="button" style="display:block;width:200px;height:48px">Üstteki hedef</button><div aria-hidden="true"></div>';
      document.querySelector('main#admin-content')!.appendChild(host);
      const spacer = host.lastElementChild as HTMLElement;
      const after = document.documentElement.scrollHeight - (spacer.getBoundingClientRect().bottom + window.scrollY);
      spacer.style.height = `${window.innerHeight - after - 20}px`;
    });
    const bar = (await topBar(page).boundingBox())!;
    const padding = (value: string) => page.evaluate((v) => {
      let style = document.getElementById('oz-pad');
      if (!style) { style = document.createElement('style'); style.id = 'oz-pad'; document.head.appendChild(style); }
      style.textContent = `html:root { scroll-padding-top: ${v} !important; }`;
    }, value);
    const scan = () => page.evaluate(obscuredFocusViolations, { reverse: true, max: 1, selector: FOCUSABLE_SELECTOR, root: '#oz-odak-ust', emulateReveal });
    await padding('0px');
    expect(await scan(), 'pay yokken odak üst barın altında').toContainEqual(expect.stringContaining('Üstteki hedef'));
    await padding(`${Math.ceil(bar.height)}px`);
    expect(await scan(), 'pay üst bar kadarken odak görünür').toEqual([]);
    await page.evaluate(() => { document.getElementById('oz-pad')?.remove(); document.getElementById('oz-odak-ust')?.remove(); });
  });

  test('katman örtüşmesi ve odak örtülmesi: üst üste iki sabit katman ve sabit altlık altında kalan odak yakalanır', async ({ page }) => {
    await open(page, '/alimlar', PHONE);
    await inject(page, 'oz-katman', `
      <div style="position:fixed;left:0;right:0;bottom:0;height:120px;z-index:50;background:white">Alt katman</div>
      <div style="position:fixed;left:0;right:0;bottom:80px;height:60px;z-index:51;background:white">Üst üste</div>`);
    expect(await page.evaluate(pinnedOverlapViolations)).toContainEqual(expect.stringContaining('örtüşüyor'));
    await page.evaluate(() => document.getElementById('oz-katman')?.remove());
    expect(await page.evaluate(pinnedOverlapViolations), 'enjeksiyon kalkınca katmanlar örtüşmüyor').toEqual([]);

    // Görünümde, altlığın altında duran giriş: odaklanınca kaydırma gerekmez, altlık onu örter.
    await page.evaluate(() => {
      const host = document.createElement('section');
      host.id = 'oz-odak';
      const y = window.scrollY + window.innerHeight - 60;
      host.innerHTML = `<input aria-label="Örtülü alan" style="position:absolute;top:${y}px;left:16px;width:200px;height:44px">`
        + '<div style="position:fixed;left:0;right:0;bottom:0;height:100px;z-index:60;background:white">Yapışkan altlık</div>';
      document.querySelector('main#admin-content')!.appendChild(host);
    });
    expect(await page.evaluate(obscuredFocusViolations, { reverse: false, max: 5, selector: FOCUSABLE_SELECTOR, root: '#oz-odak' }))
      .toContainEqual(expect.stringContaining('Örtülü alan'));
    // Görünür alana getirme öykünmesi (WebKit yolu) görünüm içindeki örtülü odağı gizlemez: öğe zaten görünür alanda.
    expect(await page.evaluate(obscuredFocusViolations, { reverse: false, max: 5, selector: FOCUSABLE_SELECTOR, root: '#oz-odak', emulateReveal: true }))
      .toContainEqual(expect.stringContaining('Örtülü alan'));
  });

  test('kavisli vurgu kenarı: border, border-inline, üst kenar, iç gölge, pseudo şerit ve kırpan radiuslu atadaki son satır çizgisi yakalanır; düz/eşit/gölge/köşesiz temiz', async ({ page }) => {
    await page.setContent(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
      body { margin: 0; font: 16px/24px sans-serif; }
      .kutu { position: relative; width: 240px; height: 80px; margin: 8px; border-radius: 12px; background: rgb(255, 255, 255); }
      #v-border .kutu { border-left: 4px solid rgb(0, 80, 200); }
      #v-inline .kutu { border-inline-start: 3px solid rgb(0, 80, 200); }
      #v-top .kutu { border-top: 4px solid rgb(200, 40, 40); }
      #v-shadow .kutu { box-shadow: inset 4px 0 0 0 rgb(0, 80, 200); }
      #v-pseudo .kutu::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: rgb(0, 80, 200); }
      #ok-flat .kutu { border-left: 4px solid rgb(0, 80, 200); border-top-left-radius: 0; border-bottom-left-radius: 0; }
      #ok-uniform .kutu { border: 1px solid rgb(200, 200, 200); }
      #ok-plain .kutu { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); }
      .liste { list-style: none; width: 240px; margin: 8px; padding: 0; border-radius: 12px; overflow: hidden; background: rgb(255, 255, 255); }
      .liste a { position: relative; display: block; min-height: 44px; }
      .liste li:last-child a::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgb(0, 80, 200); }
      #ok-clip .liste { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
    </style></head><body>
      <section id="v-border"><div class="kutu">Sol şerit</div></section>
      <section id="v-inline"><div class="kutu">Mantıksal şerit</div></section>
      <section id="v-top"><div class="kutu">Üst şerit</div></section>
      <section id="v-shadow"><div class="kutu">İç gölge çubuğu</div></section>
      <section id="v-pseudo"><div class="kutu">Pseudo şerit</div></section>
      <section id="ok-flat"><div class="kutu">Düz çizgi, köşesiz kenar</div></section>
      <section id="ok-uniform"><div class="kutu">Eşit kenarlık</div></section>
      <section id="ok-plain"><div class="kutu">Yükselti gölgesi</div></section>
      <section id="v-clip"><ul class="liste"><li><a href="#a">İlk satır</a></li><li><a href="#b">Son satır</a></li></ul></section>
      <section id="ok-clip"><ul class="liste"><li><a href="#a">İlk satır</a></li><li><a href="#b">Son satır</a></li></ul></section>
    </body></html>`);
    for (const root of ['#v-border', '#v-inline', '#v-top', '#v-shadow', '#v-pseudo']) {
      expect((await accentEdges(page, { root })).length, `${root} ihlali yakalanmalı`).toBeGreaterThan(0);
    }
    // Son satırın alt kenar çizgisi radiuslu ve taşmayı kırpan listenin köşe eğrisiyle kesilir (ata kırpma radiusu).
    expect((await accentEdges(page, { root: '#v-clip' })).join('\n'), '#v-clip ihlali yakalanmalı').toMatch(/radiuslu ve kırpan ata kenarında şerit \(ul\.liste, alt\)/);
    for (const root of ['#ok-flat', '#ok-uniform', '#ok-plain', '#ok-clip']) {
      expect(await accentEdges(page, { root }), `${root} uyumlu`).toEqual([]);
    }
  });

  test('yoğunluk/dokunma token okuyucusu kör değil: html üzerinde ezilen değer beklenenden sapma olarak görülür', async ({ page }) => {
    await open(page, '/genel', PHONE);
    const coarse = await isCoarse(page);
    const expected = expectedAdaptiveTokens(PHONE, coarse);
    expect(actualAdaptiveTokens(await readAdaptiveTokens(page))).toEqual(expected);
    await page.addStyleTag({ content: 'html:root { --aile-yogunluk-kenar: 13px !important; --aile-dokunma-hedefi: 40px !important; }' });
    const injected = actualAdaptiveTokens(await readAdaptiveTokens(page));
    expect(injected.kenar).toBe('13px');
    expect(injected.hedef).toBe('40px');
    expect(injected).not.toEqual(expected);
    // Saf beklenen değerler bant tablosunu izler (360 bandı 320'den farklı; coarse 48).
    expect(expectedAdaptiveTokens({ width: 360, height: 640 }, false).kenar).not.toBe(expectedAdaptiveTokens(PHONE, false).kenar);
    expect(expectedAdaptiveTokens(PHONE, true).hedef).toBe('48px');
  });

  test('profil eşikleri: W0 sözleşmesindeki örnekler', () => {
    const cases: Array<[Size, string]> = [
      [{ width: 320, height: 568 }, 'phone'], [{ width: 320, height: 480 }, 'phone'], [{ width: 568, height: 320 }, 'phone'],
      [{ width: 667, height: 375 }, 'phone'], [{ width: 844, height: 390 }, 'phone'], [{ width: 932, height: 430 }, 'phone'],
      [{ width: 500, height: 900 }, 'phone'], [{ width: 820, height: 1180 }, 'tablet'], [{ width: 1180, height: 820 }, 'desktop'],
      [{ width: 1024, height: 600 }, 'desktop'], [{ width: 1440, height: 900 }, 'desktop'],
    ];
    for (const [size, profile] of cases) expect(expectedProfile(size), `${size.width}×${size.height}`).toBe(profile);
  });
});
