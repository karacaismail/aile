import { test, expect, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN, adminNotReadyReasons, enterKeyboardMode, horizontalOverflow, openAdmin } from './admin-helpers';

// aile yönetim paneli tipografi kapısı (tasarim-sistemi/README.md › Tipografi, İçerik ilkeleri; tokens.json › type):
//   - Outfit web fontu gerçekten yüklenir (document.fonts: @font-face tanımı + yüklü yüz + check) ve kabuğun ilk ailesidir;
//     Türkçe harfler (İ ı Ğ ğ Ş ş Ç Ö Ü) Outfit glifinden çizilir, yedek fonta düşmez.
//   - Outfit @font-face yalnız src/admin/fonts.css'te (E03): mevcut public/fonts dosyaları, font-display: swap, yalnız ilk
//     ekranda kullanılan ağırlıklar (her kullanılan ağırlığı bir yüz karşılar, kullanılmayan yüz yok, her dosya bir kez
//     indirilir), unicode-range Türkçe harfleri kapsar ve ₺'yi (U+20BA) dışarıda bırakır: Outfit'te ₺ glifi yok.
//   - ₺ yığındaki sistem yedeğinden (system-ui) çizilir; tablo tutarları sağa hizalı, aynı sağ kenarda, tabular-nums; ₺
//     yedeği satır kutusunu büyütmez.
//   - Font yüklemesi yerleşimi kaydırmaz (CLS): font içerik hazır olduktan sonra gelse bile yer değiştiren öğe yok.
//   - h1 1440 px'te 32/40, 600; 320 px'te en az 24 px, 600; kelime ortasından bölünmez, belgeyi yatay taşırmaz.
//   - Tablo başlıkları word-break: keep-all, overflow-wrap: normal; hiçbir kelime iki satıra bölünmez, hücreden taşmaz.
//   - Türkçe karakterli etiketler görünür: kesilmez (ellipsis/clip), 14 px altına inmez, büyük harf dönüşümü yalnız lang=tr.
//   - Para ₺8.500,00 (tr-TR, iki ondalık, ₺ önde), tabular-nums; tablo hücresinde sağa hizalı.
// Dedektörler sayfaya tek betik olarak kurulur (window.__aileTypography) ve "dedektör öz denetimi" bloğu, ihlal enjekte
// edilmiş sayfada her birinin gerçekten yakaladığını, uygun sayfada sessiz kaldığını kanıtlar. Ortak admin-detectors.ts
// tipografi dedektörü (Outfit, @font-face, ₺ yedeği, keep-all, Türkçe glif, para biçimi, font kayması) sunmadığı için bu
// dosyada yerel tanımlıdır.
// Hazır sinyali: admin-helpers openAdmin (sabit bekleme yok). Veri: sentetik nesil (fixtures/generation-synthetic);
// /__aile/generation/* istekleri ayrıca route ile sentetik nesle bağlanır; gerçek veri ve Google ağı yok.

interface OutfitReport {
  /** document.fonts içindeki Outfit @font-face sayısı (sistem fontu sayılmaz). */
  declared: number;
  /** status === 'loaded' olan Outfit yüzlerinin ağırlıkları. */
  loaded: string[];
  /** document.fonts.load(...) ile eşleşen yüz sayısı; sıra: 400 16px, 600 32px. */
  matched: number[];
  /** document.fonts.check(...) sonucu; sıra aynı. */
  check: boolean[];
}
interface Findings { count: number; issues: string[] }
interface TurkishReport extends Findings { chars: string }
interface MoneyReport { values: string[]; issues: string[] }
/** Belgedeki bir @font-face kuralı (CSSOM tanımlayıcıları olduğu gibi). */
interface FaceRule { owner: string; weight: string; style: string; display: string; unicodeRange: string; src: string }
/** Bir tutar font yığını: her aile ₺ çiziyor mu, web fontu mu; DOM'daki ₺ genişliği ile ilk ₺ çizen ailenin tuval ölçümü. */
interface LiraStack {
  stack: string;
  count: number;
  families: { family: string; hasLira: boolean; webFont: boolean; canvas: boolean }[];
  domWidth: number;
  fallbackWidth: number | null;
}
interface LiraReport { elements: number; stacks: LiraStack[] }
interface AlignmentReport { columns: number; amounts: number; issues: string[] }
interface ShiftReport { elements: number; score: number; moved: string[] }
interface TypographyDetectors {
  outfit(sample: string): Promise<OutfitReport>;
  glyphGaps(chars: string, family: string): Promise<string[]>;
  wordBreaks(selector: string, requireKeepAll: boolean): Findings;
  turkishLabels(root: string): TurkishReport;
  money(root: string, cellAlign: boolean): MoneyReport;
  faceRules(family: string): FaceRule[];
  usedWeights(family: string): number[];
  lira(root: string): Promise<LiraReport>;
  moneyAlignment(root: string): AlignmentReport;
  layoutSnapshot(): number;
  layoutShift(): ShiftReport;
}

declare global {
  interface Window { __aileTypography?: TypographyDetectors }
}

// --- Sayfa içi dedektörler (kendi kendine yeter; dış kapsamdan değişken kullanmaz, toString ile sayfaya kurulur) ------
function typographyDetectors(): TypographyDetectors {
  const TURKISH = /[İıĞğŞşÇçÖöÜü]/u;
  const MONEY_OK = /^-?₺(?:0|[1-9]\d{0,2}(?:\.\d{3})*),\d{2}$/u;
  const MONEY_TOKEN = /-?₺\s*\d[\d.,]*|\d[\d.,]*\s*(?:₺|TL)(?![\p{L}\p{N}])/gu;
  const WORD = /[\p{L}\p{N}]+(?:[.,'’][\p{L}\p{N}]+)*/gu;
  const MIN_TEXT = 14;
  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system']);
  /** Layout Instability API eşiği: başlangıç noktası 3 CSS px'ten az oynayan öğe kaymış sayılmaz. */
  const SHIFT_THRESHOLD = 3;

  const describe = (el: Element) => {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48);
    return `${el.tagName.toLowerCase()} "${text}"`;
  };
  const firstFamily = (el: Element) => (getComputedStyle(el).fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim().toLowerCase();
  const round = (value: number) => Math.round(value * 100) / 100;

  /** Görünür mü: gizli ata, display/visibility/opacity, görsel gizli (clip/clip-path, ≤1 px) ve ekran dışı elenir. */
  const visible = (el: Element) => {
    if (el.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    const own = getComputedStyle(el);
    if (own.visibility !== 'visible' || own.display === 'none') return false;
    for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.opacity === '0') return false;
      if (cs.clipPath !== 'none' && cs.clipPath !== '') return false;
      if (cs.clip !== 'auto' && cs.clip !== '' && cs.position === 'absolute') return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    return r.right > 0 && r.bottom > 0;
  };

  /** Kesilme: kendisi ya da yakın atası ellipsis/hidden/clip/line-clamp ile içeriği gizliyor. */
  const truncated = (el: Element): string | null => {
    let node: Element | null = el;
    for (let depth = 0; node && depth < 4 && node !== document.body; depth += 1, node = node.parentElement) {
      const cs = getComputedStyle(node);
      const clipsX = cs.textOverflow === 'ellipsis' || ['hidden', 'clip'].includes(cs.overflowX);
      if (clipsX && node.scrollWidth > node.clientWidth + 1) return `${describe(node)} yatayda kesildi (${node.scrollWidth}>${node.clientWidth})`;
      const clamp = cs.getPropertyValue('-webkit-line-clamp');
      if (clamp && clamp !== 'none' && node.scrollHeight > node.clientHeight + 1) return `${describe(node)} satır sınırıyla kesildi`;
    }
    return null;
  };

  const textNodes = (root: Element) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
    return nodes;
  };

  /**
   * Öğenin içine gizli, mutlak konumlu yoklama koyup ölçer (stilini tümüyle miras alır, yerleşimi etkilemez). WebKit
   * Range dikdörtgenlerini tam piksele genişletir (9,99 px'lik ₺ 11 px görünür); öğe kutuları kesirlidir.
   */
  const probeBox = (host: Element, text: string, display: 'inline' | 'block') => {
    const probe = document.createElement(display === 'block' ? 'div' : 'span');
    probe.style.cssText = `position:absolute;left:0;top:0;display:${display};visibility:hidden;white-space:nowrap`;
    probe.textContent = text;
    host.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    probe.remove();
    return rect;
  };

  const rangeRect = (node: Text, start: number, end: number) => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range.getBoundingClientRect();
  };

  /** Bir kelimenin kaç ayrı satıra yayıldığı (Range.getClientRects, 2 px tolerans). */
  const wordLines = (node: Text, start: number, end: number) => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const tops: number[] = [];
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0) continue;
      if (!tops.some(top => Math.abs(top - rect.top) <= 2)) tops.push(rect.top);
    }
    return tops.length;
  };

  /**
   * Metnin kutudan taşması: görünür metin düğümlerinin satır kutuları elemanın dolgu kutusu (clientLeft/clientWidth)
   * dışına çıkıyor mu. scrollWidth kullanılmaz; o, metin olmayan mutlak süsleri de sayar (ör. antd yapışkan sütun
   * gölgesi ::after, hücrenin 30 px sağına uzanır) ve metin taşmasını onlardan ayıramaz.
   */
  const textOverflow = (el: Element): string | null => {
    const box = el.getBoundingClientRect();
    const left = box.left + el.clientLeft;
    const right = left + el.clientWidth;
    let minLeft = Infinity;
    let maxRight = -Infinity;
    for (const node of textNodes(el)) {
      if (!node.data.trim() || (node.parentElement && !visible(node.parentElement))) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width <= 0) continue;
        minLeft = Math.min(minLeft, rect.left);
        maxRight = Math.max(maxRight, rect.right);
      }
    }
    if (maxRight === -Infinity || (maxRight <= right + 1 && minLeft >= left - 1)) return null;
    return `${Math.round(Math.max(maxRight, right) - Math.min(minLeft, left))}>${el.clientWidth}`;
  };

  async function outfit(sample: string): Promise<OutfitReport> {
    await document.fonts.ready;
    const requests = ['400 16px Outfit', '600 32px Outfit'];
    const matched: number[] = [];
    for (const request of requests) {
      try {
        matched.push((await document.fonts.load(request, sample)).length);
      } catch {
        matched.push(0);
      }
    }
    const faces: FontFace[] = [];
    document.fonts.forEach(face => {
      if (face.family.replace(/["']/g, '').trim().toLowerCase() === 'outfit') faces.push(face);
    });
    return {
      declared: faces.length,
      loaded: faces.filter(face => face.status === 'loaded').map(face => face.weight),
      matched,
      check: requests.map(request => document.fonts.check(request, sample)),
    };
  }

  /** Aile glifi yoksa tarayıcı yedeğe düşer: iki farklı yedekle ölçülen genişlik yedeğin kendisiyle aynı çıkar. */
  async function glyphGaps(chars: string, family: string): Promise<string[]> {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return ['canvas 2d bağlamı yok'];
    const gaps: string[] = [];
    for (const weight of ['400', '600']) {
      try {
        await document.fonts.load(`${weight} 48px ${family}`, chars);
      } catch {
        // Yüklenemeyen yüz aşağıdaki ölçümde yedek olarak görünür.
      }
      const width = (stack: string, ch: string) => {
        ctx.font = `${weight} 48px ${stack}`;
        return ctx.measureText(ch).width;
      };
      for (const ch of Array.from(chars)) {
        const fellBackMono = Math.abs(width(`${family}, monospace`, ch) - width('monospace', ch)) < 0.01;
        const fellBackSerif = Math.abs(width(`${family}, serif`, ch) - width('serif', ch)) < 0.01;
        if (fellBackMono && fellBackSerif) gaps.push(`${weight} "${ch}" ${family} glifi yok, yedek fonta düştü`);
      }
    }
    return gaps;
  }

  function wordBreaks(selector: string, requireKeepAll: boolean): Findings {
    const issues: string[] = [];
    let count = 0;
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (!visible(el)) continue;
      count += 1;
      const cs = getComputedStyle(el);
      if (requireKeepAll && cs.wordBreak !== 'keep-all') issues.push(`${describe(el)}: word-break ${cs.wordBreak} (keep-all bekleniyor)`);
      if (cs.wordBreak === 'break-all' || cs.overflowWrap === 'anywhere' || (requireKeepAll && cs.overflowWrap !== 'normal')) {
        issues.push(`${describe(el)}: zorlayıcı kırma (word-break ${cs.wordBreak}, overflow-wrap ${cs.overflowWrap})`);
      }
      const overflow = textOverflow(el);
      if (overflow) issues.push(`${describe(el)}: metin kutusundan taşıyor (${overflow})`);
      const cut = truncated(el);
      if (cut) issues.push(cut);
      for (const node of textNodes(el)) {
        if (node.parentElement && !visible(node.parentElement)) continue;
        for (const match of node.data.matchAll(WORD)) {
          const start = match.index ?? 0;
          const lines = wordLines(node, start, start + match[0].length);
          if (lines > 1) issues.push(`${describe(el)}: "${match[0]}" ${lines} satıra bölündü`);
        }
      }
    }
    return { count, issues };
  }

  function turkishLabels(root: string): TurkishReport {
    const rootEl = document.querySelector(root);
    if (!rootEl) return { count: 0, chars: '', issues: [`kök bulunamadı: ${root}`] };
    const issues: string[] = [];
    const lang = document.documentElement.lang;
    if (!/^tr\b/i.test(lang)) issues.push(`html lang "${lang}" (tr bekleniyor)`);
    const seen = new Set<Element>();
    const chars = new Set<string>();
    for (const node of textNodes(rootEl)) {
      const parent = node.parentElement;
      if (!parent || seen.has(parent) || !TURKISH.test(node.data) || !visible(parent)) continue;
      seen.add(parent);
      for (const ch of Array.from(node.data)) if (TURKISH.test(ch)) chars.add(ch);
      const cs = getComputedStyle(parent);
      if (parseFloat(cs.fontSize) < MIN_TEXT) issues.push(`${describe(parent)}: ${cs.fontSize} (${MIN_TEXT} px altında)`);
      if (!parent.closest('code, pre, kbd, samp') && firstFamily(parent) !== 'outfit') issues.push(`${describe(parent)}: ilk aile Outfit değil (${cs.fontFamily})`);
      if (cs.textTransform !== 'none') {
        const own = parent.closest('[lang]')?.getAttribute('lang') ?? '';
        if (!/^tr\b/i.test(own)) issues.push(`${describe(parent)}: text-transform ${cs.textTransform} lang "${own}" altında (İ/ı bozulur)`);
      }
      const cut = truncated(parent);
      if (cut) issues.push(cut);
    }
    return { count: seen.size, chars: Array.from(chars).join(''), issues };
  }

  function money(root: string, cellAlign: boolean): MoneyReport {
    const rootEl = document.querySelector(root);
    if (!rootEl) return { values: [], issues: [`kök bulunamadı: ${root}`] };
    const values: string[] = [];
    const issues: string[] = [];
    for (const node of textNodes(rootEl)) {
      const parent = node.parentElement;
      if (!parent || !/\d/.test(node.data) || !visible(parent)) continue;
      const tokens = node.data.match(MONEY_TOKEN);
      if (!tokens) continue;
      const cs = getComputedStyle(parent);
      const tabular = cs.fontVariantNumeric.includes('tabular-nums') || /["']tnum["']/.test(cs.fontFeatureSettings);
      for (const raw of tokens) {
        const token = raw.trim().replace(/[.,]+$/, '');
        if (MONEY_OK.test(token)) values.push(token);
        else issues.push(`${describe(parent)}: "${token}" ₺8.500,00 biçiminde değil`);
        if (!tabular) issues.push(`${describe(parent)}: "${token}" tabular-nums değil (${cs.fontVariantNumeric})`);
        if (cellAlign) {
          const cell = parent.closest('td, th, [role=cell], [role=gridcell]');
          const align = cell ? getComputedStyle(cell).textAlign : null;
          if (cell && align !== 'right' && align !== 'end') issues.push(`${describe(parent)}: "${token}" hücrede sağa hizalı değil (${align})`);
        }
      }
    }
    return { values, issues };
  }

  /** Belgedeki (iç içe @media/@supports/@import dahil) @font-face kuralları; owner: Vite geliştirme kimliği ya da href. */
  function faceRules(family: string): FaceRule[] {
    const rules: FaceRule[] = [];
    const visit = (list: CSSRuleList, owner: string) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSFontFaceRule) {
          const style = rule.style;
          if (style.getPropertyValue('font-family').replace(/["']/g, '').trim().toLowerCase() !== family.toLowerCase()) continue;
          rules.push({
            owner,
            weight: style.getPropertyValue('font-weight').trim(),
            style: style.getPropertyValue('font-style').trim(),
            display: style.getPropertyValue('font-display').trim(),
            unicodeRange: style.getPropertyValue('unicode-range').trim(),
            src: style.getPropertyValue('src').trim(),
          });
        } else if (rule instanceof CSSImportRule) {
          if (rule.styleSheet) visit(rule.styleSheet.cssRules, rule.href);
        } else if ('cssRules' in rule) {
          visit((rule as CSSGroupingRule).cssRules, owner);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      const node = sheet.ownerNode instanceof Element ? sheet.ownerNode : null;
      visit(list, node?.getAttribute('data-vite-dev-id') ?? sheet.href ?? 'satır içi <style>');
    }
    return rules;
  }

  /** İlk ekranda (görünüm alanı içinde) görünür metni olan ve ilk ailesi `family` olan öğelerin hesaplanmış ağırlıkları. */
  function usedWeights(family: string): number[] {
    const weights = new Set<number>();
    for (const node of textNodes(document.body)) {
      const parent = node.parentElement;
      if (!parent || !node.data.trim() || !visible(parent)) continue;
      const r = parent.getBoundingClientRect();
      if (r.top >= innerHeight || r.left >= innerWidth) continue;
      if (firstFamily(parent) !== family.toLowerCase()) continue;
      weights.add(Number(getComputedStyle(parent).fontWeight));
    }
    return Array.from(weights).sort((a, b) => a - b);
  }

  /**
   * Görünür ₺ tutarlarının font yığınları. Her aile için tuvalde ₺ çizip çizmediği (glyphGaps ile aynı yöntem: glifi
   * olmayan aile iki farklı yedekte yedeğin kendisiyle aynı genişliği verir) ve document.fonts'ta web fontu olup olmadığı.
   * domWidth: ilk tutardaki ₺'nin DOM genişliği; fallbackWidth: yığında ₺ çizen ilk ailenin aynı boyut/ağırlıkta tuval
   * ölçümü. İkisi eşitse DOM'daki ₺ gerçekten o aileden çizilmiştir.
   */
  async function lira(root: string): Promise<LiraReport> {
    const rootEl = document.querySelector(root);
    if (!rootEl) return { elements: 0, stacks: [] };
    const hosts: Element[] = [];
    for (const node of textNodes(rootEl)) {
      if (node.parentElement && /₺\s*\d/.test(node.data) && visible(node.parentElement)) hosts.push(node.parentElement);
    }
    const ctx = document.createElement('canvas').getContext('2d');
    const webFonts = new Set<string>();
    document.fonts.forEach(face => webFonts.add(face.family.replace(/["']/g, '').trim().toLowerCase()));
    const quote = (family: string) => (GENERIC.has(family.toLowerCase()) ? family : `"${family}"`);
    const byStack = new Map<string, Element[]>();
    for (const host of hosts) {
      const stack = getComputedStyle(host).fontFamily;
      byStack.set(stack, [...(byStack.get(stack) ?? []), host]);
    }
    const stacks: LiraStack[] = [];
    for (const [stack, members] of byStack) {
      const el = members[0]!;
      const cs = getComputedStyle(el);
      const font = (families: string) => `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${families}`;
      const list = stack.split(',').map(family => family.replace(/["']/g, '').trim()).filter(Boolean);
      try {
        await document.fonts.load(font(list.map(quote).join(', ')), '₺8');
      } catch {
        // Yüklenemeyen yüz ölçümde yedek olarak görünür.
      }
      const measure = (families: string): { width: number; accepted: boolean } => {
        if (!ctx) return { width: NaN, accepted: false };
        ctx.font = '10px serif';
        ctx.font = font(families);
        return { width: ctx.measureText('₺').width, accepted: ctx.font !== '10px serif' };
      };
      const families = list.map(family => {
        const own = measure(quote(family));
        const mono = Math.abs(measure(`${quote(family)}, monospace`).width - measure('monospace').width) < 0.01;
        const serif = Math.abs(measure(`${quote(family)}, serif`).width - measure('serif').width) < 0.01;
        return { family, hasLira: !(mono && serif), webFont: webFonts.has(family.toLowerCase()), canvas: own.accepted };
      });
      const fallback = families.find(family => family.hasLira);
      stacks.push({
        stack,
        count: members.length,
        families,
        domWidth: round(probeBox(el, '₺', 'inline').width),
        fallbackWidth: fallback ? round(measure(quote(fallback.family)).width) : null,
      });
    }
    return { elements: hosts.length, stacks };
  }

  /**
   * Tablo sütunlarındaki ₺ tutarları: sağ kenarlar aynı x'te ve hücre içeriğinin sağ kenarında, her satırda aynı font
   * (₺ her satırda aynı yedekten), aynı biçimli tutarlar aynı genişlikte (tabular-nums), ₺ rakamlarla aynı satır
   * kutusunda ve ₺'li metin ₺'siz eşinden yüksek değil (yedek fontun ölçüleri satır yüksekliğini büyütmez).
   */
  function moneyAlignment(root: string): AlignmentReport {
    const rootEl = document.querySelector(root);
    if (!rootEl) return { columns: 0, amounts: 0, issues: [`kök bulunamadı: ${root}`] };
    interface Item { text: string; host: Element; cell: Element; font: string; right: number; contentRight: number; width: number; lira: DOMRect; digits: DOMRect }
    const groups = new Map<string, Item[]>();
    const tables = Array.from(rootEl.querySelectorAll('table, [role=table], [role=grid]'));
    for (const cell of Array.from(rootEl.querySelectorAll('td, [role=cell], [role=gridcell]'))) {
      const row = cell.parentElement;
      const table = cell.closest('table, [role=table], [role=grid]');
      if (!row || !table) continue;
      const key = `${tables.indexOf(table)}:${Array.from(row.children).indexOf(cell)}`;
      const cs = getComputedStyle(cell);
      const box = cell.getBoundingClientRect();
      for (const node of textNodes(cell)) {
        const text = node.data.trim();
        if (!MONEY_OK.test(text) || !node.parentElement || !visible(node.parentElement)) continue;
        const start = node.data.indexOf(text);
        const lira = start + text.indexOf('₺');
        const host = node.parentElement;
        // Tutar kendi öğesindeyse (Money: <span class="aile-tutar">) kesirli öğe kutusu; değilse metin aralığı.
        const whole = host !== cell && (host.textContent ?? '').trim() === text ? host.getBoundingClientRect() : rangeRect(node, start, start + text.length);
        const hs = getComputedStyle(host);
        groups.set(key, [...(groups.get(key) ?? []), {
          text,
          host,
          cell,
          font: `${hs.fontStyle} ${hs.fontWeight} ${hs.fontSize}/${hs.lineHeight} ${hs.fontFamily} ${hs.fontVariantNumeric}`,
          right: whole.right,
          contentRight: box.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
          width: whole.width,
          lira: rangeRect(node, lira, lira + 1),
          digits: rangeRect(node, lira + 1, start + text.length),
        }]);
      }
    }
    const issues: string[] = [];
    let columns = 0;
    let amounts = 0;
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    for (const [key, items] of groups) {
      amounts += items.length;
      if (items.length < 2) continue;
      columns += 1;
      const label = `sütun ${key}`;
      const rights = items.map(item => item.right);
      if (spread(rights) > 1) issues.push(`${label}: tutarların sağ kenarı hizalı değil (${round(Math.min(...rights))}–${round(Math.max(...rights))})`);
      for (const item of items) {
        if (Math.abs(item.right - item.contentRight) > 1.5) issues.push(`${label}: "${item.text}" hücrenin sağ kenarına yaslı değil (${round(item.right)} / ${round(item.contentRight)})`);
        if (Math.abs(item.lira.top - item.digits.top) > 0.5 || Math.abs(item.lira.bottom - item.digits.bottom) > 0.5) {
          issues.push(`${label}: "${item.text}" ₺ rakamlarla aynı satır kutusunda değil (${round(item.lira.top)}/${round(item.lira.bottom)} ≠ ${round(item.digits.top)}/${round(item.digits.bottom)})`);
        }
      }
      const fonts = Array.from(new Set(items.map(item => item.font)));
      if (fonts.length > 1) issues.push(`${label}: tutarlar satırdan satıra farklı fontla (${fonts.join(' | ')})`);
      const shapes = new Map<string, Item[]>();
      for (const item of items) {
        const shape = item.text.replace(/\d/g, '0');
        shapes.set(shape, [...(shapes.get(shape) ?? []), item]);
      }
      for (const [shape, same] of shapes) {
        if (same.length > 1 && spread(same.map(item => item.width)) > 0.5) {
          issues.push(`${label}: aynı biçimli (${shape}) tutarlar farklı genişlikte, rakamlar tabular değil (${same.map(item => `${item.text} ${round(item.width)}`).join(', ')})`);
        }
      }
      const first = items[0]!;
      const withLira = probeBox(first.host, first.text, 'block').height;
      const withoutLira = probeBox(first.host, first.text.replace('₺', ''), 'block').height;
      if (Math.abs(withLira - withoutLira) > 0.5) issues.push(`${label}: ₺ yedek fontu satır kutusunu değiştiriyor (${round(withLira)} px ≠ ₺'siz ${round(withoutLira)} px)`);
    }
    return { columns, amounts, issues };
  }

  // Yerleşim kayması: Layout Instability API'nin puanı (etki oranı × uzaklık oranı) iki an arasında, görünür her öğenin
  // kutusu üzerinden hesaplanır. WebKit layout-shift girdisi üretmediği için iki motorda aynı ölçü kullanılır. API gibi
  // transform kaymayı saymaz: süren CSS animasyonu/geçişi olan öğe ve altı (yükleme iskeleti, çekmece) ölçüme girmez.
  let snapshot: { el: Element; rect: DOMRect }[] = [];
  const animatedTargets = () => document.getAnimations()
    .map(animation => (animation.effect as KeyframeEffect | null)?.target)
    .filter((target): target is Element => target instanceof Element);
  function layoutSnapshot(): number {
    if (!document.body) return 0;
    const animated = animatedTargets();
    snapshot = Array.from(document.body.querySelectorAll('*'))
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
          && getComputedStyle(el).visibility === 'visible' && !animated.some(target => target.contains(el));
      })
      .map(el => ({ el, rect: el.getBoundingClientRect() }));
    return snapshot.length;
  }
  function layoutShift(): ShiftReport {
    const animated = animatedTargets();
    const cell = 4;
    const cols = Math.ceil(innerWidth / cell);
    const rows = Math.ceil(innerHeight / cell);
    const grid = new Uint8Array(cols * rows);
    const paint = (r: DOMRect) => {
      const x0 = Math.max(0, Math.floor(r.left / cell));
      const x1 = Math.min(cols, Math.ceil(r.right / cell));
      const y0 = Math.max(0, Math.floor(r.top / cell));
      const y1 = Math.min(rows, Math.ceil(r.bottom / cell));
      for (let y = y0; y < y1; y += 1) grid.fill(1, y * cols + x0, y * cols + Math.max(x0, x1));
    };
    let distance = 0;
    const moved: string[] = [];
    for (const { el, rect } of snapshot) {
      if (!el.isConnected || animated.some(target => target.contains(el))) continue;
      const now = el.getBoundingClientRect();
      const dx = now.left - rect.left;
      const dy = now.top - rect.top;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d < SHIFT_THRESHOLD) continue;
      paint(rect);
      paint(now);
      distance = Math.max(distance, d);
      moved.push(`${describe(el)} dx ${round(dx)} dy ${round(dy)}`);
    }
    let impacted = 0;
    for (const value of grid) impacted += value;
    const score = (impacted / grid.length) * (distance / Math.max(innerWidth, innerHeight));
    return { elements: snapshot.length, score: Math.round(score * 100000) / 100000, moved: moved.slice(0, 12) };
  }

  return { outfit, glyphGaps, wordBreaks, turkishLabels, money, faceRules, usedWeights, lira, moneyAlignment, layoutSnapshot, layoutShift };
}

async function installDetectors(page: Page) {
  await page.addScriptTag({ content: `window.__aileTypography = (${typographyDetectors.toString()})();` });
}

/** Outfit raporundan kural ihlalleri (gerçek sayfa ve öz denetim aynı yargıyı kullanır). */
function outfitProblems(report: OutfitReport): string[] {
  const problems: string[] = [];
  if (report.declared === 0) problems.push('Outfit @font-face tanımı yok (sistem fontu sayılmaz)');
  if (report.loaded.length === 0) problems.push('yüklü Outfit yüzü yok');
  report.matched.forEach((n, i) => { if (n === 0) problems.push(`${i === 0 ? '400' : '600'} ağırlığa Outfit yüzü eşleşmedi`); });
  report.check.forEach((ok, i) => { if (!ok) problems.push(`document.fonts.check ${i === 0 ? '400 16px' : '600 32px'} Outfit false`); });
  return problems;
}

// --- @font-face yargısı (Node tarafı; gerçek sayfa ve öz denetim aynı fonksiyonu kullanır) ---------------------------
const LIRA = 0x20ba;
/** unicode-range'in kapsaması gereken harfler: Türkçe alfabe, rakamlar ve tutar/tarih noktalaması. */
const UNICODE_REQUIRED = 'AaÂâÇçĞğIıİiÎîÖöŞşÜüÛûZz0123456789.,-:%·…–’';
/** Mevcut public/fonts dosyaları ve dosyanın gerçek ağırlığı (OS/2 usWeightClass): Regular 400, Bold 700. */
const FONT_FILES: Record<string, number> = { 'outfit-regular.ttf': 400, 'outfit-bold.ttf': 700 };

function parseUnicodeRange(value: string): [number, number][] {
  if (!value.trim()) return [[0, 0x10ffff]];
  return value.split(',').map(part => {
    const token = part.trim().toUpperCase().replace(/^U\+/, '');
    if (token.includes('?')) return [parseInt(token.replace(/\?/g, '0'), 16), parseInt(token.replace(/\?/g, 'F'), 16)];
    const [from, to = from] = token.split('-');
    return [parseInt(from!, 16), parseInt(to!, 16)];
  });
}

function parseWeight(value: string): [number, number] {
  const words: Record<string, number> = { normal: 400, bold: 700, '': 400 };
  const [from, to = from] = value.trim().split(/\s+/).map(part => words[part] ?? Number(part));
  return [from!, to!];
}

const weightLabel = (rule: FaceRule) => `${rule.weight || 'normal'} ${rule.src.match(/outfit-[a-z]+\.ttf/)?.[0] ?? rule.src}`;

/**
 * @font-face kuralları: en az bir yüz; her yüz font-display: swap, normal stil, mevcut public/fonts dosyası, dosyanın
 * gerçek ağırlığı tanımlı aralıkta (yanlış dosya/sentetik kalınlık yok), aralıklar çakışmıyor (aynı ağırlık iki kez
 * tanımlı değil), unicode-range Türkçe harfleri kapsıyor ve ₺'yi dışarıda bırakıyor.
 */
function fontFaceProblems(rules: FaceRule[]): string[] {
  if (rules.length === 0) return ['Outfit @font-face tanımı yok'];
  const problems: string[] = [];
  rules.forEach((rule, index) => {
    const label = weightLabel(rule);
    if (rule.display !== 'swap') problems.push(`${label}: font-display ${rule.display || 'auto'} (swap bekleniyor)`);
    if (rule.style && rule.style !== 'normal') problems.push(`${label}: font-style ${rule.style}`);
    const file = rule.src.match(/\/fonts\/(outfit-[a-z]+\.ttf)["']?\)/)?.[1];
    const [from, to] = parseWeight(rule.weight);
    if (!file || !(file in FONT_FILES)) problems.push(`${label}: kaynak mevcut public/fonts Outfit dosyası değil (${rule.src})`);
    else if (FONT_FILES[file]! < from || FONT_FILES[file]! > to) problems.push(`${label}: dosyanın ağırlığı ${FONT_FILES[file]} tanımlı aralıkta değil (yanlış dosya ya da sentetik kalınlık)`);
    const ranges = parseUnicodeRange(rule.unicodeRange);
    const covers = (code: number) => ranges.some(([a, b]) => code >= a && code <= b);
    const missing = Array.from(UNICODE_REQUIRED).filter(ch => !covers(ch.codePointAt(0)!));
    if (missing.length) problems.push(`${label}: unicode-range şunları kapsamıyor: ${missing.join(' ')}`);
    if (covers(LIRA)) problems.push(`${label}: unicode-range ₺ (U+20BA) içeriyor; Outfit'te ₺ glifi yok (${rule.unicodeRange || 'tanımsız = tümü'})`);
    rules.slice(index + 1).forEach(other => {
      const [a, b] = parseWeight(other.weight);
      if ((other.style || 'normal') === (rule.style || 'normal') && a <= to && from <= b) problems.push(`${label}: ${weightLabel(other)} ile ağırlık aralığı çakışıyor (iki kez tanım)`);
    });
  });
  return problems;
}

/** fonts.css dışındaki tanımlar (ör. admin.css'te kalan eski kopya): tek kaynak ilkesi ihlali, kaynak dosyasıyla. */
function foreignFaces(rules: FaceRule[], owner: RegExp): string[] {
  return rules.filter(rule => !owner.test(rule.owner)).map(rule => `${weightLabel(rule)}: ${rule.owner} içinde tanımlı (yalnız src/admin/fonts.css)`);
}

/** İlk ekranda kullanılan her ağırlığı bir yüz karşılar; her yüz en az bir kullanılan ağırlığı karşılar (fazla dosya yok). */
function weightProblems(rules: FaceRule[], used: number[]): string[] {
  const problems: string[] = [];
  if (used.length === 0) problems.push('ilk ekranda Outfit ile yazılmış görünür metin yok');
  const ranges = rules.map(rule => ({ rule, range: parseWeight(rule.weight) }));
  for (const weight of used) {
    if (!ranges.some(({ range: [a, b] }) => weight >= a && weight <= b)) problems.push(`${weight} ağırlığını karşılayan Outfit yüzü yok (yakın yüz/sentetik kalınlık)`);
  }
  for (const { rule, range: [a, b] } of ranges) {
    if (!used.some(weight => weight >= a && weight <= b)) problems.push(`${weightLabel(rule)}: ilk ekranda kullanılmıyor (kullanılanlar: ${used.join(', ')})`);
  }
  return problems;
}

/** ₺ yığını: ilk aile Outfit ve ₺ çizmez; yığında ₺ çizen bir sistem (web fontu olmayan) yedeği var; DOM'daki ₺ ondan. */
function liraProblems(report: LiraReport): string[] {
  if (report.elements === 0) return ['görünür ₺ tutarı yok'];
  const problems: string[] = [];
  for (const stack of report.stacks) {
    const label = `"${stack.stack}" (${stack.count} tutar)`;
    const rejected = stack.families.filter(family => !family.canvas).map(family => family.family);
    if (rejected.length) problems.push(`${label}: tuval şu aileleri ölçemedi: ${rejected.join(', ')}`);
    const [first, ...rest] = stack.families;
    if (first?.family.toLowerCase() !== 'outfit') problems.push(`${label}: ilk aile Outfit değil`);
    else if (first.hasLira) problems.push(`${label}: Outfit ₺ çiziyor; unicode-range dışlaması ve sistem yedeği gereksiz mi?`);
    const fallback = rest.find(family => family.hasLira);
    if (!fallback) problems.push(`${label}: yığında ₺ çizen yedek yok`);
    else if (fallback.webFont) problems.push(`${label}: ₺ yedeği ${fallback.family} web fontu (sistem fontu bekleniyor)`);
    else if (stack.fallbackWidth === null || Math.abs(stack.domWidth - stack.fallbackWidth) > 0.25) {
      problems.push(`${label}: DOM'daki ₺ (${stack.domWidth} px) ${fallback.family} ile çizilmemiş (${stack.fallbackWidth} px)`);
    }
  }
  return problems;
}

// --- Sentetik nesil (route; gerçek veri ve sunucu ortamı kullanılmaz) --------------------------------------------
const GENERATION_PREFIX = '/__aile/generation/';
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const FONT_ROOT = fileURLToPath(new URL('../public/fonts/', import.meta.url));

async function syntheticRoot() {
  const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true });
  const generation = entries.find(entry => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name));
  if (!generation) throw new Error('Sentetik nesil bulunamadı (fixtures/generation-synthetic)');
  return path.join(FIXTURE_ROOT, generation.name);
}

async function serveSyntheticGeneration(page: Page) {
  const root = await syntheticRoot();
  await page.route(`**${GENERATION_PREFIX}**`, async route => {
    const { pathname } = new URL(route.request().url());
    const relative = decodeURIComponent(pathname.slice(pathname.indexOf(GENERATION_PREFIX) + GENERATION_PREFIX.length));
    const segments = relative.split('/');
    const safe = segments.every(segment => segment !== '' && segment !== '.' && segment !== '..');
    const readable = relative === 'manifest.json' || (segments[0] === 'data' && segments.length >= 3 && relative.endsWith('.json'));
    if (!safe || !readable) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Sentetik nesilde yok' }) });
      return;
    }
    try {
      await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: await readFile(path.join(root, ...segments)) });
    } catch {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Sentetik nesilde yok' }) });
    }
  });
}

const VIEWS_PATH = 'data/view_definitions/global/00000.json';

/**
 * Sentetik nesilde pivot tanımı purchase_need türünü desteklemez (AlimlarPage pivotu uydurmaz, Liste açar). Alımlar pivot
 * tablosunun başlıklarını sınamak için birim testteki PIVOT_ACIK ile aynı sentetik değişiklik: pivot.supported_kinds'a
 * purchase_need eklenir; depo bütünlüğü doğruladığı için manifestteki sha256/bytes/count da güncellenir. Sonradan kurulan
 * route öncekinden önce çalışır; diğer yollar route.fallback ile ortak sentetik servise düşer.
 */
async function enablePurchasePivot(page: Page) {
  const root = await syntheticRoot();
  const envelope = JSON.parse(await readFile(path.join(root, ...VIEWS_PATH.split('/')), 'utf8')) as { collection: string; records: Record<string, unknown>[] };
  const records = envelope.records.map(record =>
    record['key'] === 'pivot' ? { ...record, supported_kinds: [...(record['supported_kinds'] as string[]), 'purchase_need'] } : record);
  const views = JSON.stringify({ ...envelope, records });
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) as {
    files: { path: string; sha256: string; bytes: number; count?: number }[];
    counts: Record<string, number>;
  };
  manifest.files = manifest.files.map(file => (file.path === VIEWS_PATH
    ? { ...file, sha256: createHash('sha256').update(views, 'utf8').digest('hex'), bytes: Buffer.byteLength(views, 'utf8'), count: records.length }
    : file));
  manifest.counts = { ...manifest.counts, [envelope.collection]: records.length };
  const bodies: Record<string, string> = { 'manifest.json': JSON.stringify(manifest), [VIEWS_PATH]: views };
  await page.route(`**${GENERATION_PREFIX}**`, async route => {
    const { pathname } = new URL(route.request().url());
    const body = bodies[decodeURIComponent(pathname.slice(pathname.indexOf(GENERATION_PREFIX) + GENERATION_PREFIX.length))];
    if (body === undefined) await route.fallback();
    else await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body });
  });
}

/**
 * Öğenin kendisinde, atalarında ya da içinde süren sonlu CSS geçişleri/animasyonları bitene kadar bekler (Animation.finished).
 * Çekmece 240 ms içinde soldan kayarak ve opaklığı artarak gelir; ölçüm ara karede yapılırsa etiketler ekran dışında
 * (left < 0) ya da yarı saydam sayılır. Süre tahmini yok: tarayıcının kendi animasyon nesneleri beklenir.
 */
async function settleMotion(locator: Locator) {
  await locator.evaluate(async el => {
    const running = document.getAnimations().filter(animation => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      const finite = animation.effect?.getComputedTiming().iterations !== Infinity;
      return finite && target instanceof Element && (target.contains(el) || el.contains(target));
    });
    await Promise.all(running.map(animation => animation.finished.catch(() => undefined)));
  });
}

/** Belgede süren sonlu animasyon/geçiş kalmayana dek bekler (kayma ölçümü yalnız fontun etkisini görsün). */
async function settlePage(page: Page) {
  await page.evaluate(async () => {
    const finite = () => document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity);
    for (let pass = 0; pass < 5 && finite().length; pass += 1) await Promise.all(finite().map(animation => animation.finished.catch(() => undefined)));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/**
 * Outfit dosyalarının yanıtını bir kapıda tutar: sayfa fontsuz (system-ui yedeğiyle) hazır olur, kapı açılınca font gelir.
 * En kötü durum budur: font, içerik çizildikten sonra değişir. Dönen fonksiyon kapıyı açar.
 */
async function holdOutfit(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/fonts\/outfit-(regular|bold)\.ttf(\?.*)?$/, async route => {
    await gate;
    await route.fallback();
  });
  return release;
}

/** Outfit yüzlerinin durumları ('loading' | 'loaded' | 'unloaded' | 'error'). */
const outfitStatus = (page: Page) => page.evaluate(() => {
  const states: string[] = [];
  document.fonts.forEach(face => { if (/outfit/i.test(face.family)) states.push(`${face.weight}:${face.status}`); });
  return states;
});

/**
 * openAdmin'in hazır sinyali, 'load' olayı beklenmeden. Font yanıtı kapıda tutulurken WebKit 'load' olayını fontu
 * bekleterek geciktirir; openAdmin'in page.goto'su (waitUntil: 'load') bu yüzden yalnız kapılı testte kullanılamaz.
 * Hazır koşulu aynıdır (admin-helpers adminNotReadyReasons, iki ardışık animasyon karesi); sabit bekleme yok.
 */
async function openAdminWithoutLoad(page: Page, route: string, timeout = 20_000) {
  await page.goto(ADMIN + route, { waitUntil: 'commit' });
  const reasons = `(${adminNotReadyReasons.toString()})()`;
  await page.waitForFunction(`(() => { const w = window; w.__tipografiHazir = ${reasons}.length ? 0 : (w.__tipografiHazir || 0) + 1; return w.__tipografiHazir >= 2; })()`,
    undefined, { timeout, polling: 'raf' });
}

/** Normal yüklemede font değişiminin izi (fontSwapProbe sayfa başında kurulur, her animasyon karesinde çalışır). */
interface SwapProbe {
  frames: number;
  /** Outfit henüz yüklü değilken metnin yedek fontla çizildiği kare sayısı. */
  fallbackFrames: number;
  /** Outfit yüzlerinin yüklendiği ilk kare (-1: gözlenmedi). */
  swapFrame: number;
  /** Değişim anında sayfa hazır mıydı (içerik çizilmiş, iskelet yok)? */
  readyAtSwap: boolean | null;
  /** Sayfanın hazır olduğu ilk karede Outfit yüklü müydü? */
  loadedWhenReady: boolean | null;
  /** Değişimden hemen önceki kare ile değişim karesi (ve bir sonraki) arasındaki kayma; en büyüğü. */
  shift: ShiftReport | null;
}

declare global {
  interface Window { __aileFontSwap?: SwapProbe }
}

/**
 * Sayfa başında çalışır: her karede Outfit yüzlerinin durumunu okur; yükleme bitmeden önce (metin yedek fontla) görünür
 * öğelerin yerleşimini kaydeder, yüklendiği karede ve bir sonrakinde kaymayı ölçer. notReady: adminNotReadyReasons.
 */
function fontSwapProbe(notReady: () => string[]) {
  const probe: SwapProbe = { frames: 0, fallbackFrames: 0, swapFrame: -1, readyAtSwap: null, loadedWhenReady: null, shift: null };
  window.__aileFontSwap = probe;
  let snapshotTaken = false;
  const tick = () => {
    probe.frames += 1;
    const faces: FontFace[] = [];
    document.fonts.forEach(face => { if (/outfit/i.test(face.family)) faces.push(face); });
    const detectors = window.__aileTypography;
    const hasText = !!document.body && (document.body.innerText ?? '').trim().length > 0;
    if (detectors && hasText && faces.length > 0) {
      // WebKit, swap döneminde yüklenmekte olan CSS yüzünü 'error' gösterir; 'loading' ya da 'error' kalan yüz varken
      // metin hâlâ yedek fontla çizilir.
      const loaded = !faces.some(face => face.status === 'loading' || face.status === 'error') && faces.some(face => face.status === 'loaded');
      const ready = notReady().length === 0;
      if (ready && probe.loadedWhenReady === null) probe.loadedWhenReady = loaded;
      if (!loaded && probe.swapFrame < 0) {
        probe.fallbackFrames += 1;
        detectors.layoutSnapshot();
        snapshotTaken = true;
      } else if (loaded && probe.swapFrame < 0 && snapshotTaken) {
        probe.swapFrame = probe.frames;
        probe.readyAtSwap = ready;
        probe.shift = detectors.layoutShift();
      } else if (probe.swapFrame > 0 && probe.frames === probe.swapFrame + 1) {
        const next = detectors.layoutShift();
        if (next.score > (probe.shift?.score ?? 0)) probe.shift = next;
      }
    }
    const done = probe.loadedWhenReady !== null && (probe.swapFrame < 0 ? probe.loadedWhenReady : probe.frames > probe.swapFrame + 1);
    if (!done && probe.frames < 5000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function installSwapProbe(page: Page) {
  await page.addInitScript({
    content: `window.__aileTypography = (${typographyDetectors.toString()})(); (${fontSwapProbe.toString()})(${adminNotReadyReasons.toString()});`,
  });
}

const DESKTOP = { width: 1440, height: 900 };
const LAPTOP = { width: 1024, height: 768 };
const PHONE = { width: 320, height: 740 };
const TURKISH_GLYPHS = 'İıĞğŞşÇçÖöÜü';
const NAV_LABELS = ['Alımlar ve eşyalar', 'Bütçe ve nakit', 'Ödemeler', 'Projeler ve görevler', 'Sözlükler ve iş akışları'];
const H1_ROUTES = ['/alimlar', '/sozlukler', '/veri', '/hesaplar'];
const PIVOT_TABLE = 'Oda ve duruma göre planlanan ve gerçekleşen tutar';
const THOUSANDS = /^-?₺\d{1,3}(?:\.\d{3})+,\d{2}$/;
/** Geliştirme sunucusunda fonts.css'in <style> kimliği (data-vite-dev-id, mutlak yol). */
const FONTS_CSS = /[\\/]src[\\/]admin[\\/]fonts\.css$/;
/**
 * En kötü durum bütçesi (font, içerik hazır olduktan sonra gelir): kayma puanı ≤ 0,005, yani "iyi" CLS sınırı 0,1'in
 * %5'i. swap ile sistem yedeğinden Outfit'e geçiş metin genişliğini değiştirir; metnin ardından akan satır içi öğeler
 * (ayraç, sayım, düğme) birkaç piksel oynar. Ölçü uyumlu yerel yedek (size-adjust) bunu sıfırlamaz: Arial/Helvetica Neue
 * ile Outfit arasındaki dize genişliği farkı en iyi size-adjust ile bile 16 px'te 9–11 px'e çıkar. Normal yüklemede ise
 * değişim içerik hazır olmadan biter ve sıfır kayma beklenir (ayrı test).
 */
const FONT_SWAP_BUDGET = 0.005;

const detect = {
  outfit: (page: Page, sample: string) => page.evaluate(s => window.__aileTypography!.outfit(s), sample),
  glyphGaps: (page: Page, chars: string, family: string) => page.evaluate(([c, f]) => window.__aileTypography!.glyphGaps(c, f), [chars, family] as const),
  wordBreaks: (page: Page, selector: string, keepAll: boolean) =>
    page.evaluate(([s, k]) => window.__aileTypography!.wordBreaks(s, k), [selector, keepAll] as const),
  turkishLabels: (page: Page, root: string) => page.evaluate(r => window.__aileTypography!.turkishLabels(r), root),
  money: (page: Page, root: string, cellAlign: boolean) => page.evaluate(([r, a]) => window.__aileTypography!.money(r, a), [root, cellAlign] as const),
  faceRules: (page: Page, family: string) => page.evaluate(f => window.__aileTypography!.faceRules(f), family),
  usedWeights: (page: Page, family: string) => page.evaluate(f => window.__aileTypography!.usedWeights(f), family),
  lira: (page: Page, root: string) => page.evaluate(r => window.__aileTypography!.lira(r), root),
  moneyAlignment: (page: Page, root: string) => page.evaluate(r => window.__aileTypography!.moneyAlignment(r), root),
  layoutSnapshot: (page: Page) => page.evaluate(() => window.__aileTypography!.layoutSnapshot()),
  layoutShift: (page: Page) => page.evaluate(() => window.__aileTypography!.layoutShift()),
};

/** Chromium: DevTools'un "Rendered Fonts" bilgisi (CSS.getPlatformFontsForNode): düğüm metnini hangi platform fontları çizdi. */
async function platformFonts(page: Page, locator: Locator) {
  await locator.evaluate(el => el.setAttribute('data-tipografi-yoklama', ''));
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-tipografi-yoklama]' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.map(font => ({ family: font.familyName, custom: font.isCustomFont, glyphs: font.glyphCount }));
  } finally {
    await cdp.detach();
    await locator.evaluate(el => el.removeAttribute('data-tipografi-yoklama'));
  }
}

const HEADER_CELLS = 'th, [role=columnheader]';

/**
 * Tek h1'in hesaplanmış stili, tek sayfa içi görevde okunur. Lazy sayfa yüklenince yedek başlığın h1'i (RouteFallback,
 * aynı PageHeader) gerçek sayfanınkiyle değişir; locator.evaluate çözümleme ile çağrı arasında ayrılan öğeyi okursa
 * WebKit boş stil (NaN) döndürür. Burada sorgu ve ölçüm aynı görevdedir; birden fazla h1 ya da hiç h1 hata sayılır.
 */
async function h1Style(page: Page) {
  return page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h1'));
    if (headings.length !== 1) return { size: NaN, weight: `h1 sayısı ${headings.length}`, lineHeight: NaN };
    const cs = getComputedStyle(headings[0]!);
    return { size: parseFloat(cs.fontSize), weight: cs.fontWeight, lineHeight: parseFloat(cs.lineHeight) };
  });
}
// AlimlarPage hash sözleşmesi (buildAlimlarHash): seçim yokken sorgu "#/alimlar/?…" biçimindedir; rota deseni
// "/alimlar/:id?" eğik çizgisiz "#/alimlar?mod=…" konumunu eşlemez ve varsayılan sayfaya yönlendirir.
const ALIMLAR_TABLO = '/alimlar/?mod=table';
const ALIMLAR_PIVOT = '/alimlar/?mod=pivot';

test.describe('yönetim tipografisi', () => {
  test.beforeEach(async ({ page }) => {
    await serveSyntheticGeneration(page);
  });

  test('Outfit web fontu yüklü, kabuğun ilk ailesi ve Türkçe glifleri kapsıyor', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openAdmin(page, '/alimlar');
    await installDetectors(page);
    const report = await detect.outfit(page, `aile ${TURKISH_GLYPHS} ₺8.500,00`);
    expect(outfitProblems(report), JSON.stringify(report)).toEqual([]);
    const families = {
      main: await page.getByRole('main').evaluate(el => getComputedStyle(el).fontFamily),
      h1: await page.getByRole('heading', { level: 1 }).evaluate(el => getComputedStyle(el).fontFamily),
      nav: await page.getByRole('navigation', { name: 'Sayfalar' }).evaluate(el => getComputedStyle(el).fontFamily),
    };
    for (const [where, family] of Object.entries(families)) {
      expect(family.split(',')[0]?.replace(/["']/g, '').trim(), `${where} ilk ailesi`).toBe('Outfit');
    }
    expect(await detect.glyphGaps(page, TURKISH_GLYPHS, 'Outfit')).toEqual([]);
  });

  test('fonts.css Outfit yüzleri: swap, mevcut dosyalar, ağırlık aralıkları, Türkçe unicode-range, ₺ hariç', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openAdmin(page, '/alimlar');
    await installDetectors(page);
    const rules = (await detect.faceRules(page, 'Outfit')).filter(rule => FONTS_CSS.test(rule.owner));
    expect(fontFaceProblems(rules), JSON.stringify(rules, null, 1)).toEqual([]);
  });

  test('Outfit @font-face tek kaynakta: fonts.css dışında (admin.css vb.) tanım yok', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openAdmin(page, '/alimlar');
    await installDetectors(page);
    const rules = await detect.faceRules(page, 'Outfit');
    expect(rules.length, 'Outfit @font-face sayısı').toBeGreaterThan(0);
    expect(foreignFaces(rules, FONTS_CSS)).toEqual([]);
  });

  /** İlk ekranın ağırlıkları ve indirilen font dosyaları; viewport null = projenin görünümü (matris projelerinde de koşar). */
  async function firstScreenFonts(page: Page, viewport: { width: number; height: number } | null) {
    const fonts: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.resourceType() === 'font' || /\.(?:ttf|otf|woff2?)$/i.test(url.pathname)) fonts.push(url.pathname.split('/').pop()!);
    });
    if (viewport) await page.setViewportSize(viewport);
    await openAdmin(page, '/alimlar');
    await page.evaluate(() => document.fonts.ready);
    await installDetectors(page);
    const rules = await detect.faceRules(page, 'Outfit');
    const used = await detect.usedWeights(page, 'Outfit');
    expect(weightProblems(rules, used), JSON.stringify({ used, rules: rules.map(weightLabel) })).toEqual([]);
    expect(fonts.sort(), 'indirilen font dosyaları (her biri bir kez)').toEqual(['outfit-bold.ttf', 'outfit-regular.ttf']);
  }

  test('ilk ekran yalnız kullandığı Outfit ağırlıklarını ve her dosyayı bir kez indirir (proje görünümü)', { tag: '@matrix' }, async ({ page }) => {
    await firstScreenFonts(page, null);
  });

  test('ilk ekran yalnız kullandığı Outfit ağırlıklarını ve her dosyayı bir kez indirir (1440 px)', async ({ page }) => {
    await firstScreenFonts(page, DESKTOP);
  });

  test('₺ sistem yedeğinden çizilir; tablo tutarları sağa hizalı, tabular ve satır kutusu bozulmaz (1440 px)', async ({ page, browserName }) => {
    await page.setViewportSize(DESKTOP);
    await openAdmin(page, ALIMLAR_TABLO);
    await expect(page.getByRole('columnheader', { name: 'Planlanan' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await installDetectors(page);
    const lira = await detect.lira(page, 'main');
    expect(liraProblems(lira), JSON.stringify(lira, null, 1)).toEqual([]);
    const alignment = await detect.moneyAlignment(page, 'main');
    expect(alignment.issues).toEqual([]);
    expect(alignment.columns, 'tutar sütunu').toBeGreaterThanOrEqual(1);
    expect(alignment.amounts, 'sütundaki tutar').toBeGreaterThanOrEqual(3);
    if (browserName === 'chromium') {
      // Chromium'un çizim kaydı: rakam ve noktalama Outfit'ten (web fontu), ₺ tek glif olarak web fontu olmayan bir sistem fontundan.
      const amount = page.getByRole('cell', { name: /^₺\d/ }).first().locator('.aile-tutar');
      const fonts = await platformFonts(page, amount);
      const text = (await amount.textContent()) ?? '';
      expect(fonts.filter(font => font.custom).map(font => font.family), JSON.stringify(fonts)).toEqual(['Outfit']);
      expect(fonts.filter(font => !font.custom).reduce((sum, font) => sum + font.glyphs, 0), JSON.stringify(fonts)).toBe(Array.from(text).filter(ch => ch === '₺').length);
    }
  });

  test('₺ sistem yedeğinden çizilir (telefon listesi, proje görünümü)', { tag: '@matrix' }, async ({ page }) => {
    await openAdmin(page, '/alimlar');
    await expect(page.getByText(/^-?₺\d/).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await installDetectors(page);
    const lira = await detect.lira(page, 'main');
    expect(liraProblems(lira), JSON.stringify(lira, null, 1)).toEqual([]);
  });

  /** Normal yükleme: font değişimi içerik hazır olmadan biter ve değiştiği karede hiçbir öğe 3 px ve üzeri kaymaz. */
  async function normalSwap(page: Page, viewport: { width: number; height: number } | null, route: string) {
    await installSwapProbe(page);
    if (viewport) await page.setViewportSize(viewport);
    await openAdmin(page, route);
    await page.waitForFunction(() => {
      const probe = window.__aileFontSwap;
      return !!probe && probe.loadedWhenReady !== null && (probe.swapFrame < 0 || probe.frames > probe.swapFrame + 1);
    }, undefined, { polling: 'raf' });
    const probe = (await page.evaluate(() => window.__aileFontSwap))!;
    const evidence = JSON.stringify(probe, null, 1);
    test.info().annotations.push({ type: 'font değişimi', description: `yedek fontla ${probe.fallbackFrames} kare, değişim karesi ${probe.swapFrame}, hazırken yüklü ${probe.loadedWhenReady}, kayma ${probe.shift?.score} (${probe.shift?.elements} öğe)` });
    expect(probe.swapFrame, `yedek fonttan Outfit'e geçiş gözlendi: ${evidence}`).toBeGreaterThan(0);
    expect(probe.readyAtSwap, `geçiş anında içerik hazırdı: ${evidence}`).toBe(false);
    expect(probe.loadedWhenReady, `içerik hazır olduğunda Outfit yüklü: ${evidence}`).toBe(true);
    expect(probe.shift?.score, evidence).toBe(0);
  }

  test('normal yüklemede font değişimi içerikten önce biter ve kaydırmaz (proje görünümü)', { tag: '@matrix' }, async ({ page }) => {
    await normalSwap(page, null, '/alimlar');
  });

  test('normal yüklemede font değişimi içerikten önce biter ve kaydırmaz (1440 px tablo)', async ({ page }) => {
    await normalSwap(page, DESKTOP, ALIMLAR_TABLO);
  });

  /** En kötü durum: Outfit kapıda tutulur, sayfa yedek fontla hazır olur, sonra font gelir; kayma bütçe içinde. */
  async function lateSwap(page: Page, viewport: { width: number; height: number } | null, route: string) {
    const release = await holdOutfit(page);
    if (viewport) await page.setViewportSize(viewport);
    await openAdminWithoutLoad(page, route);
    await settlePage(page);
    expect((await outfitStatus(page)).filter(state => state.endsWith(':loaded')), 'kapı açılmadan yüklü Outfit yüzü').toEqual([]);
    await installDetectors(page);
    expect(await detect.layoutSnapshot(page), 'ölçülen öğe').toBeGreaterThan(20);
    release();
    await page.evaluate(() => document.fonts.ready);
    await settlePage(page);
    const states = await outfitStatus(page);
    expect(states.some(state => state.endsWith(':loaded')) && !states.some(state => /:(loading|error)$/.test(state)), `kapıdan sonra yüzler: ${states.join(', ')}`).toBe(true);
    const shift = await detect.layoutShift(page);
    test.info().annotations.push({ type: 'geç font kayması', description: `puan ${shift.score} / bütçe ${FONT_SWAP_BUDGET}; ${shift.moved.length} öğe: ${shift.moved.slice(0, 4).join('; ')}` });
    expect(shift.score, JSON.stringify(shift, null, 1)).toBeLessThanOrEqual(FONT_SWAP_BUDGET);
  }

  test('Outfit içerikten sonra gelse de kayma bütçe içinde (proje görünümü)', { tag: '@matrix' }, async ({ page }) => {
    await lateSwap(page, null, '/alimlar');
  });

  test('Outfit içerikten sonra gelse de kayma bütçe içinde (1440 px tablo)', async ({ page }) => {
    await lateSwap(page, DESKTOP, ALIMLAR_TABLO);
  });

  test('h1 1440 px: 32/40, 600 ve kelime ortasından bölünmez', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    for (const route of H1_ROUTES) {
      await openAdmin(page, route);
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveCount(1);
      await expect(h1).toBeVisible();
      expect(await h1Style(page), `${route} h1`).toEqual({ size: 32, weight: '600', lineHeight: 40 });
      await installDetectors(page);
      expect((await detect.wordBreaks(page, 'h1', false)).issues, `${route} h1 kırılma`).toEqual([]);
    }
  });

  test('h1 320 px: en az 24 px, 600, bölünmez ve belgeyi taşırmaz', async ({ page, browserName }) => {
    await page.setViewportSize(PHONE);
    for (const route of H1_ROUTES) {
      await openAdmin(page, route);
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toBeVisible();
      const style = await h1Style(page);
      expect(style.size, `${route} h1 boyutu`).toBeGreaterThanOrEqual(24);
      expect(style.weight, `${route} h1 ağırlığı`).toBe('600');
      await installDetectors(page);
      expect((await detect.wordBreaks(page, 'h1', false)).issues, `${route} h1 kırılma`).toEqual([]);
      if (browserName === 'chromium') expect(await horizontalOverflow(page), `${route} yatay taşma`).toEqual([]);
    }
  });

  for (const viewport of [DESKTOP, LAPTOP]) {
    test(`tablo başlıkları keep-all, kelime ortasından bölünmez (${viewport.width} px)`, async ({ page }) => {
      await enablePurchasePivot(page);
      await page.setViewportSize(viewport);
      await openAdmin(page, ALIMLAR_TABLO);
      await expect(page.getByRole('columnheader', { name: 'Planlanan' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Ödeme durumu' })).toBeVisible();
      await installDetectors(page);
      const table = await detect.wordBreaks(page, HEADER_CELLS, true);
      expect(table.count, 'görünür tablo başlığı').toBeGreaterThanOrEqual(5);
      expect(table.issues).toEqual([]);

      await openAdmin(page, ALIMLAR_PIVOT);
      await expect(page.getByRole('table', { name: PIVOT_TABLE })).toBeVisible();
      await installDetectors(page);
      const pivot = await detect.wordBreaks(page, HEADER_CELLS, true);
      expect(pivot.count, 'görünür pivot başlığı').toBeGreaterThan(0);
      expect(pivot.issues).toEqual([]);
    });
  }

  test('Türkçe karakterli etiketler görünür ve kesilmez (masaüstü nav, atlama bağlantısı)', async ({ page, browserName }) => {
    await page.setViewportSize(DESKTOP);
    await openAdmin(page, '/alimlar');
    const nav = page.getByRole('navigation', { name: 'Sayfalar' });
    for (const label of NAV_LABELS) await expect(nav.getByText(label, { exact: true })).toBeVisible();
    await enterKeyboardMode(page, browserName);
    const skip = page.getByRole('link', { name: 'İçeriğe geç' });
    await skip.focus();
    await expect(skip).toBeFocused();
    await installDetectors(page);
    const report = await detect.turkishLabels(page, 'body');
    expect(report.issues).toEqual([]);
    for (const ch of ['İ', 'ı', 'ğ', 'ş', 'ö', 'ü']) expect(report.chars, `görünür etiketlerde "${ch}"`).toContain(ch);
  });

  test('Türkçe karakterli etiketler görünür ve kesilmez (320 px sayfa çekmecesi)', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openAdmin(page, '/alimlar');
    await page.getByRole('button', { name: 'Sayfalar' }).click();
    const drawer = page.getByRole('dialog', { name: 'Sayfalar' });
    await expect(drawer).toBeVisible();
    await settleMotion(drawer);
    for (const label of NAV_LABELS) await expect(drawer.getByText(label, { exact: true })).toBeVisible();
    await installDetectors(page);
    const report = await detect.turkishLabels(page, 'body');
    expect(report.issues).toEqual([]);
    for (const ch of ['ı', 'ş', 'ö', 'ü']) expect(report.chars, `görünür etiketlerde "${ch}"`).toContain(ch);
  });

  test('para ₺8.500,00 biçiminde, tabular-nums ve tabloda sağa hizalı (1440 px)', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openAdmin(page, ALIMLAR_TABLO);
    await expect(page.getByRole('columnheader', { name: 'Planlanan' })).toBeVisible();
    await expect(page.getByRole('cell', { name: /^-?₺\d/ }).first()).toBeVisible();
    await installDetectors(page);
    const report = await detect.money(page, 'body', true);
    expect(report.issues).toEqual([]);
    expect(report.values.length, 'görünür tutar').toBeGreaterThan(0);
    expect(report.values.some(value => THOUSANDS.test(value)), `binlik ayraçlı tutar: ${report.values.slice(0, 5).join(' ')}`).toBe(true);
  });

  test('para ₺8.500,00 biçiminde ve tabular-nums (320 px liste)', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openAdmin(page, '/alimlar');
    await expect(page.getByText(/^-?₺\d/).first()).toBeVisible();
    await installDetectors(page);
    const report = await detect.money(page, 'body', false);
    expect(report.issues).toEqual([]);
    expect(report.values.length, 'görünür tutar').toBeGreaterThan(0);
  });
});

// --- Dedektör öz denetimi: ihlal enjekte edilir → yakalanır; uygun sayfa → sessiz -----------------------------------
const SELF_CHECK_ORIGIN = 'https://aile-selfcheck.test';

const VIOLATIONS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  body { margin: 16px; font: 16px/24px Arial, sans-serif; }
  table { table-layout: fixed; width: 120px; border-collapse: collapse; }
  th { width: 60px; padding: 0; }
  #kirik { word-break: break-all; }
  #tasan { word-break: normal; overflow-wrap: normal; }
  .ust { text-transform: uppercase; }
  .dar { width: 48px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .kucuk { font-size: 12px; }
  .tutar { font-variant-numeric: tabular-nums; }
  td { text-align: left; }
</style></head><body>
  <h1 style="width:40px;word-break:break-all">Alımlar</h1>
  <table><thead><tr><th id="kirik">Proposal</th><th id="tasan">DocTypeTemplate</th></tr></thead>
  <tbody><tr><td><span class="tutar">₺8.500,00</span></td><td><span class="tutar">₺8500</span></td></tr></tbody></table>
  <p><span class="tutar">8.500 TL</span> <span>₺1.250,00</span></p>
  <p class="ust">ışık ve iş</p>
  <p class="dar">Sözlükler ve iş akışları</p>
  <p class="kucuk">Ödeme</p>
</body></html>`;

/** fonts.css ile aynı biçimde uygun Outfit yüzleri (öz denetim kökünde /fonts/… olarak sunulur). */
const CLEAN_FACES = `
  @font-face { font-family: Outfit; src: url('/fonts/outfit-regular.ttf') format('truetype'); font-style: normal; font-weight: 400 500; font-display: swap;
    unicode-range: U+0000-00FF, U+011E-011F, U+0130-0131, U+015E-015F, U+2013-2014, U+2018-201A, U+201C-201E, U+2026; }
  @font-face { font-family: Outfit; src: url('/fonts/outfit-bold.ttf') format('truetype'); font-style: normal; font-weight: 600 700; font-display: swap;
    unicode-range: U+0000-00FF, U+011E-011F, U+0130-0131, U+015E-015F, U+2013-2014, U+2018-201A, U+201C-201E, U+2026; }`;

const CLEAN_HTML = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><style>${CLEAN_FACES}
  body { margin: 16px; font: 16px/24px Outfit, system-ui, sans-serif; }
  h1 { font-size: 32px; line-height: 40px; font-weight: 600; }
  th { word-break: keep-all; overflow-wrap: normal; min-width: 160px; font-size: 14px; text-align: left; }
  /* antd yapışkan sütun gölgesi gibi metin dışı süs: hücrenin sağına taşan mutlak ::after metin taşması sayılmaz. */
  th:first-child { position: sticky; left: 0; }
  th:first-child::after { content: ''; position: absolute; top: 0; bottom: 0; right: -30px; width: 30px; }
  td.sayi { text-align: right; }
  .tutar { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ust { text-transform: uppercase; }
</style></head><body>
  <h1>Alımlar ve eşyalar</h1>
  <table><thead><tr><th>Planlanan tutar</th><th>Ödeme durumu</th></tr></thead>
  <tbody><tr><td class="sayi"><span class="tutar">₺8.500,00</span></td><td class="sayi"><span class="tutar">-₺1.250,50</span></td></tr></tbody></table>
  <p>İçeriğe geç · Ğ Ş ı ş ö ü ç · <span class="tutar">₺34.000,00</span> · 28.10.2026</p>
  <p class="ust">ışık ve iş</p>
</body></html>`;

/**
 * Font ihlalleri: satır içi (fonts.css dışı) tanım, block/auto görüntüleme, unicode-range yok (₺ dahil) ya da Türkçe
 * harfsiz, dosya ağırlığıyla uyuşmayan ve çakışan aralıklar, kullanılmayan 900 yüzü; sola hizalı orantılı rakamlar;
 * ascent-override %10 olan "Kisa" yüzünde line-height: normal → ₺'yi çizen yedek satır kutusunu büyütür; yalnız web
 * fontlarından oluşan, ₺ çizen sistem yedeği olmayan yığın.
 */
const FONT_VIOLATIONS_HTML = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><style>
  @font-face { font-family: Outfit; src: url('/fonts/outfit-regular.ttf') format('truetype'); font-weight: 300; font-display: block; }
  @font-face { font-family: Outfit; src: url('/fonts/outfit-bold.ttf') format('truetype'); font-weight: 300; font-display: auto; unicode-range: U+0000-007F; }
  @font-face { font-family: Outfit; src: url('/fonts/outfit-bold.ttf') format('truetype'); font-weight: 900; font-display: swap; unicode-range: U+0000-00FF, U+011E-011F, U+0130-0131, U+015E-015F; }
  @font-face { font-family: Kisa; src: url('/fonts/outfit-regular.ttf') format('truetype'); ascent-override: 10%; descent-override: 0%; line-gap-override: 0%; unicode-range: U+0000-00FF; }
  body { margin: 16px; font: 400 16px/24px Outfit, serif; }
  h1 { font-weight: 600; font-size: 32px; line-height: 40px; }
  table { border-collapse: collapse; }
  td { padding: 4px 8px; text-align: left; }
  .tutar { font-family: Kisa, sans-serif; line-height: normal; }
  .yigin { font-family: Outfit, Kisa; }
</style></head><body>
  <h1>Alımlar</h1>
  <table><tbody>
    <tr><td><span class="tutar">₺1.111,11</span></td></tr>
    <tr><td><span class="tutar">₺8.888,88</span></td></tr>
  </tbody></table>
  <p><span class="yigin">₺4.000,00</span></p>
</body></html>`;

const FONT_CLEAN_HTML = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><style>${CLEAN_FACES}
  body { margin: 16px; font: 400 16px/24px Outfit, system-ui, sans-serif; }
  h1 { font-weight: 600; font-size: 32px; line-height: 40px; }
  table { border-collapse: collapse; }
  td { padding: 4px 8px; text-align: right; }
  .tutar { font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }
</style></head><body>
  <h1>Alımlar ve eşyalar</h1>
  <table><tbody>
    <tr><td><span class="tutar">₺1.111,11</span></td></tr>
    <tr><td><span class="tutar">₺8.888,88</span></td></tr>
    <tr><td><span class="tutar">₺34.000,00</span></td></tr>
  </tbody></table>
</body></html>`;

/**
 * Kayma ölçüsünün öz denetimi: "Gec" web fontu geç gelir. Akışta metnin hemen ardından gelen düğme, metin monospace
 * yedeğinden daha dar Outfit'e geçince sola kayar (ihlal); sabit ızgara sütunundaki düğme yerinde kalır (uygun).
 */
const shiftHtml = (row: string) => `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><style>
  @font-face { font-family: Gec; src: url('/fonts/outfit-bold.ttf') format('truetype'); font-display: swap; }
  body { margin: 16px; font: 600 16px/24px Gec, monospace; }
  .satir { ${row} gap: 8px; }
  button { font: inherit; min-height: 44px; }
</style></head><body>
  <div class="satir"><span>Alımlar ve eşyalar</span><button type="button">Ekle</button></div>
  <p>Kayma ölçüsü öz denetimi</p>
</body></html>`;
const SHIFT_VIOLATION_HTML = shiftHtml('display: flex;');
const SHIFT_CLEAN_HTML = shiftHtml('display: grid; grid-template-columns: 240px max-content;');

/**
 * Öz denetim sayfası; fontGate verilirse font yanıtı kapıda bekler. fontRequested, font istendiğinde çözülür. Söz bir
 * nesne içinde döner: async fonksiyon sözü doğrudan döndürseydi çağıran onu benimser ve fontsuz sayfada sonsuza dek beklerdi.
 */
async function openSelfCheck(page: Page, html: string, fontGate?: Promise<void>): Promise<{ fontRequested: Promise<void> }> {
  let fontRequested!: () => void;
  const requested = new Promise<void>(resolve => { fontRequested = resolve; });
  await page.route(`${SELF_CHECK_ORIGIN}/**`, async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/fonts/outfit-regular.ttf' || pathname === '/fonts/outfit-bold.ttf') {
      fontRequested();
      if (fontGate) await fontGate;
      await route.fulfill({ status: 200, contentType: 'font/ttf', body: await readFile(path.join(FONT_ROOT, path.basename(pathname))) });
      return;
    }
    if (pathname === '/') {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      return;
    }
    await route.fulfill({ status: 404, body: '' });
  });
  // Kapılı fontu WebKit 'load' olayına bağlar; kapı açıkken yalnız DOM beklenir.
  await page.goto(`${SELF_CHECK_ORIGIN}/`, { waitUntil: fontGate ? 'domcontentloaded' : 'load' });
  await installDetectors(page);
  return { fontRequested: requested };
}

test.describe('tipografi dedektörü öz denetimi', () => {
  test('enjekte edilen ihlalleri yakalar', async ({ page }) => {
    await openSelfCheck(page, VIOLATIONS_HTML);

    expect(outfitProblems(await detect.outfit(page, 'aile'))).toEqual(expect.arrayContaining([expect.stringContaining('@font-face tanımı yok')]));
    const gaps = await detect.glyphGaps(page, 'İĞŞ', 'AileYokFont');
    expect(gaps.length, 'olmayan ailenin glifleri yedeğe düşer').toBe(6);

    const headers = await detect.wordBreaks(page, 'th', true);
    expect(headers.count).toBe(2);
    expect(headers.issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/"Proposal".*word-break break-all \(keep-all bekleniyor\)/),
      expect.stringMatching(/"Proposal" \d satıra bölündü/),
      expect.stringMatching(/"DocTypeTemplate".*keep-all bekleniyor/),
      expect.stringMatching(/"DocTypeTemplate".*taşıyor/),
    ]));
    const h1 = await detect.wordBreaks(page, 'h1', false);
    expect(h1.issues).toEqual(expect.arrayContaining([expect.stringMatching(/"Alımlar" \d satıra bölündü/), expect.stringContaining('zorlayıcı kırma')]));

    const turkish = await detect.turkishLabels(page, 'body');
    expect(turkish.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('html lang "en"'),
      expect.stringMatching(/"ışık ve iş".*text-transform uppercase/),
      expect.stringMatching(/"Sözlükler ve iş akışları".*kesildi/),
      expect.stringMatching(/"Ödeme".*12px/),
      expect.stringMatching(/ilk aile Outfit değil/),
    ]));

    const money = await detect.money(page, 'body', true);
    // Biçimi doğru ama tabular olmayan ₺1.250,00 değer sayılır; ihlali ayrıca raporlanır.
    expect(money.values).toEqual(['₺8.500,00', '₺1.250,00']);
    expect(money.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('"₺8500" ₺8.500,00 biçiminde değil'),
      expect.stringContaining('"8.500 TL" ₺8.500,00 biçiminde değil'),
      expect.stringContaining('"₺1.250,00" tabular-nums değil'),
      expect.stringContaining('"₺8.500,00" hücrede sağa hizalı değil'),
    ]));
  });

  test('uygun sayfada sessiz kalır (yanlış pozitif yok)', async ({ page }) => {
    await openSelfCheck(page, CLEAN_HTML);

    expect(outfitProblems(await detect.outfit(page, `aile ${TURKISH_GLYPHS}`))).toEqual([]);
    expect(await detect.glyphGaps(page, TURKISH_GLYPHS, 'Outfit')).toEqual([]);

    const headers = await detect.wordBreaks(page, 'th', true);
    expect(headers.count).toBe(2);
    expect(headers.issues).toEqual([]);
    expect((await detect.wordBreaks(page, 'h1', false)).issues).toEqual([]);

    const turkish = await detect.turkishLabels(page, 'body');
    expect(turkish.issues).toEqual([]);
    for (const ch of ['İ', 'ı', 'Ğ', 'ğ', 'Ş', 'ş']) expect(turkish.chars).toContain(ch);

    const money = await detect.money(page, 'body', true);
    expect(money.issues).toEqual([]);
    expect(money.values).toEqual(['₺8.500,00', '-₺1.250,50', '₺34.000,00']);
  });

  test('font kuralları, ağırlıklar, ₺ yedeği ve tutar hizası ihlallerini yakalar', async ({ page }) => {
    await openSelfCheck(page, FONT_VIOLATIONS_HTML);
    await page.evaluate(() => document.fonts.ready);

    const rules = await detect.faceRules(page, 'Outfit');
    expect(rules).toHaveLength(3);
    expect(foreignFaces(rules, FONTS_CSS)).toEqual([
      '300 outfit-regular.ttf: satır içi <style> içinde tanımlı (yalnız src/admin/fonts.css)',
      '300 outfit-bold.ttf: satır içi <style> içinde tanımlı (yalnız src/admin/fonts.css)',
      '900 outfit-bold.ttf: satır içi <style> içinde tanımlı (yalnız src/admin/fonts.css)',
    ]);
    expect(fontFaceProblems(rules)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^300 outfit-regular\.ttf: font-display block/),
      expect.stringMatching(/^300 outfit-bold\.ttf: font-display auto/),
      expect.stringMatching(/^300 outfit-regular\.ttf: dosyanın ağırlığı 400 tanımlı aralıkta değil/),
      expect.stringMatching(/^900 outfit-bold\.ttf: dosyanın ağırlığı 700 tanımlı aralıkta değil/),
      expect.stringMatching(/^300 outfit-regular\.ttf: unicode-range ₺ \(U\+20BA\) içeriyor/),
      expect.stringMatching(/^300 outfit-bold\.ttf: unicode-range şunları kapsamıyor: Â â Ç ç Ğ ğ ı İ Î î Ö ö Ş ş Ü ü Û û · … – ’$/),
      expect.stringMatching(/^300 outfit-regular\.ttf: 300 outfit-bold\.ttf ile ağırlık aralığı çakışıyor/),
    ]));
    expect(fontFaceProblems([])).toEqual(['Outfit @font-face tanımı yok']);

    const used = await detect.usedWeights(page, 'Outfit');
    expect(used).toEqual([400, 600]);
    expect(weightProblems(rules, used)).toEqual(expect.arrayContaining([
      expect.stringContaining('400 ağırlığını karşılayan Outfit yüzü yok'),
      expect.stringContaining('600 ağırlığını karşılayan Outfit yüzü yok'),
      expect.stringMatching(/^900 outfit-bold\.ttf: ilk ekranda kullanılmıyor/),
    ]));

    const lira = await detect.lira(page, 'body');
    expect(lira.elements).toBe(3);
    expect(liraProblems(lira)).toEqual(expect.arrayContaining([
      expect.stringMatching(/"Kisa, sans-serif" \(2 tutar\): ilk aile Outfit değil/),
      expect.stringMatching(/"Outfit, Kisa" \(1 tutar\): yığında ₺ çizen yedek yok/),
    ]));

    const alignment = await detect.moneyAlignment(page, 'body');
    expect(alignment).toMatchObject({ columns: 1, amounts: 2 });
    expect(alignment.issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/tutarların sağ kenarı hizalı değil/),
      expect.stringMatching(/"₺1\.111,11" hücrenin sağ kenarına yaslı değil/),
      expect.stringMatching(/aynı biçimli \(₺0\.000,00\) tutarlar farklı genişlikte/),
      expect.stringMatching(/₺ yedek fontu satır kutusunu değiştiriyor/),
    ]));
  });

  test('uygun font sayfasında font dedektörleri sessiz kalır', async ({ page }) => {
    await openSelfCheck(page, FONT_CLEAN_HTML);
    await page.evaluate(() => document.fonts.ready);

    const rules = await detect.faceRules(page, 'Outfit');
    expect(rules).toHaveLength(2);
    expect(fontFaceProblems(rules)).toEqual([]);
    expect(weightProblems(rules, await detect.usedWeights(page, 'Outfit'))).toEqual([]);
    const lira = await detect.lira(page, 'body');
    expect(liraProblems(lira), JSON.stringify(lira, null, 1)).toEqual([]);
    expect(await detect.moneyAlignment(page, 'body')).toEqual({ columns: 1, amounts: 3, issues: [] });
  });

  for (const [name, html, expectShift] of [['akıştaki düğme kayar', SHIFT_VIOLATION_HTML, true], ['ızgaradaki düğme yerinde kalır', SHIFT_CLEAN_HTML, false]] as const) {
    test(`geç gelen font kayma ölçüsü: ${name}`, async ({ page }) => {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const { fontRequested } = await openSelfCheck(page, html, gate);
      await expect(page.getByRole('button', { name: 'Ekle' })).toBeVisible();
      expect(await outfitStatus(page)).toEqual([]);
      // Gec yüzü istendi ve yanıtı kapıda: metin yedek (monospace) ile çizili, hiçbir yüz yüklü değil.
      await fontRequested;
      expect(await page.evaluate(() => { const states: string[] = []; document.fonts.forEach(face => states.push(face.status)); return states; })).not.toContain('loaded');
      expect(await detect.layoutSnapshot(page)).toBeGreaterThan(2);
      release();
      await page.evaluate(() => document.fonts.ready);
      await settlePage(page);
      const shift = await detect.layoutShift(page);
      if (expectShift) {
        expect(shift.score, JSON.stringify(shift)).toBeGreaterThan(0);
        expect(shift.moved).toEqual(expect.arrayContaining([expect.stringMatching(/^button "Ekle" dx -\d/)]));
      } else {
        expect(shift, JSON.stringify(shift)).toMatchObject({ score: 0, moved: [] });
      }
    });
  }
});
