// Uyarlamalı teslimin kaynak düzeyi kuralları (saf; dosya sistemi erişimi testte). source-rules.test.ts depo
// taramasında kullanır; ihlalli örneklerle FAIL verdiği de orada sınanır.

export interface ImportRef { specifier: string; kind: 'static' | 'dynamic'; typeOnly: boolean }

/** Blok ve satır yorumlarını atar (dizge içindeki "//" korunur: yalnız satır başı ya da boşluktan sonraki yorumlar). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const STATIC_RE = /(^|[^\w$.])(import|export)\s+(type\s+)?(?:[^'"`;]*?\bfrom\s*)?(['"])([^'"\n]+)\4/g;
const DYNAMIC_RE = /(^|[^\w$.])import\s*\(\s*(['"])([^'"\n]+)\2\s*\)/g;

/** Statik (import/export … from, yan etki importu), tür-yalnız ve dinamik import() belirteçleri, kaynak sırasıyla. */
export function importsOf(source: string): ImportRef[] {
  const code = stripComments(source);
  const found: (ImportRef & { at: number })[] = [];
  for (const match of code.matchAll(STATIC_RE)) {
    found.push({ specifier: match[5]!, kind: 'static', typeOnly: Boolean(match[3]), at: match.index ?? 0 });
  }
  for (const match of code.matchAll(DYNAMIC_RE)) {
    found.push({ specifier: match[3]!, kind: 'dynamic', typeOnly: false, at: match.index ?? 0 });
  }
  return found.sort((a, b) => a.at - b.at).map(({ specifier, kind, typeOnly }) => ({ specifier, kind, typeOnly }));
}

/** antd yüzeyi: ham paketler, ui/antd, antd teması ve antd'yi statik bağlayan ui sarmalayıcıları (barrel dahil). */
export function isAntdSurface(specifier: string): boolean {
  if (/^(antd|@ant-design)(\/|$)/.test(specifier)) return true;
  if (/(^|\/)ui\/antd(\.ts)?$/.test(specifier) || /(^|\/)theme\/antdTheme(\.ts)?$/.test(specifier)) return true;
  return /^(\.{1,2}\/|@\/)/.test(specifier) && /(^|\/)ui(\/|$)/.test(specifier);
}

const WIDE_PROVIDERS_RE = /(^|\/)WideProviders(\.tsx)?$/;
export const WIDE_MODULE_RE = /\.wide(\.tsx?)?$/;

/** Korunan dosyada (App/main/adaptive) statik, tür-yalnız olmayan antd yüzeyi ya da WideProviders importu. */
export function antdSurfaceViolations(path: string, source: string): string[] {
  return importsOf(source)
    .filter(ref => ref.kind === 'static' && !ref.typeOnly && (isAntdSurface(ref.specifier) || WIDE_PROVIDERS_RE.test(ref.specifier)))
    .map(ref => `${path}: statik antd yüzeyi ${ref.specifier}`);
}

const CALL_RE = /\b(lazyWide|wideResource)\s*\(/g;
const LITERAL_CALL_RE = /\b(?:lazyWide|wideResource)\s*\(\s*(['"`])[^'"`]+\1\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*import\(\s*(['"])([^'"\n]+)\2\s*\)/g;

/** *.wide kuralı: statik içe aktarılmaz; lazyWide/wideResource açık () => import('…*.wide') ile; *.wide default export verir. */
export function wideRuleViolations(path: string, source: string): string[] {
  const code = stripComments(source);
  const out: string[] = [];
  for (const ref of importsOf(code)) {
    if (ref.kind === 'static' && !ref.typeOnly && WIDE_MODULE_RE.test(ref.specifier)) out.push(`${path}: geniş modül statik içe aktarılmış ${ref.specifier}`);
  }
  const calls = [...code.matchAll(CALL_RE)].length;
  const literal = [...code.matchAll(LITERAL_CALL_RE)];
  if (literal.length < calls) out.push(`${path}: lazyWide/wideResource açık () => import('…') ile çağrılmalı`);
  for (const match of literal) {
    const specifier = match[3]!;
    if (!WIDE_MODULE_RE.test(specifier) && !WIDE_PROVIDERS_RE.test(specifier)) out.push(`${path}: geniş modül adı *.wide olmalı: ${specifier}`);
  }
  if (/\.wide\.tsx?$/.test(path) && !/\bexport\s+default\b|\bexport\s*\{[^}]*\bas\s+default\b/.test(code)) out.push(`${path}: *.wide modülü default export vermeli`);
  return out;
}
