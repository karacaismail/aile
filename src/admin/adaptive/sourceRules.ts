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

// İsteğe bağlı tür argümanı: lazyWide<P>(…), wideResource<{ default: M<T> }>(…) (bir düzey iç içe <> dahil).
const TYPE_ARGS = String.raw`(?:<(?:[^<>]|<[^<>]*>)*>\s*)?`;
const CALL_RE = new RegExp(String.raw`\b(lazyWide|wideResource)\s*${TYPE_ARGS}\(`, 'g');
const LITERAL_CALL_RE = new RegExp(String.raw`\b(?:lazyWide|wideResource)\s*${TYPE_ARGS}\(\s*(['"\x60])[^'"\x60]+\1\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*import\(\s*(['"])([^'"\n]+)\2\s*\)`, 'g');

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

// antd içe aktarma kuralı: ham paket (antd, @ant-design/*) ya da ui/antd yüzeyi yalnız bu dosyalarda. Sayfa, kabuk, ui
// ve *.wide modülleri antd'yi içe aktarmaz (telefon sayfa parçasını her rotada indirir; check-delivery --strict).
const ANTD_ALLOWED = new Set(['src/admin/ui/antd.ts', 'src/admin/adaptive/WideProviders.tsx', 'src/admin/theme/antdTheme.ts']);
const RAW_ANTD_RE = /^(antd|@ant-design)(\/|$)/;

/** Göreli ya da @/ belirteci src/admin/ui/antd(.ts) modülüne çözülüyor mu (dosya sistemi erişimi yok). */
function resolvesToUiAntd(fromPath: string, specifier: string): boolean {
  let target: string;
  if (specifier.startsWith('@/')) target = `src/${specifier.slice(2)}`;
  else if (/^\.{1,2}\//.test(specifier)) {
    const parts = fromPath.split('/').slice(0, -1);
    for (const part of specifier.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    target = parts.join('/');
  } else return false;
  return /^src\/admin\/ui\/antd(\.ts)?$/.test(target);
}

/** antd (ham paket ya da ui/antd) statik, tür-yalnız olmayan importu izinli dosyalar dışında. */
export function antdImportViolations(path: string, source: string): string[] {
  if (ANTD_ALLOWED.has(path)) return [];
  return importsOf(source)
    .filter(ref => ref.kind === 'static' && !ref.typeOnly && (RAW_ANTD_RE.test(ref.specifier) || resolvesToUiAntd(path, ref.specifier)))
    .map(ref => `${path}: antd yalnız ui/antd.ts, adaptive/WideProviders.tsx ve theme/antdTheme.ts içinde: ${ref.specifier}`);
}

/**
 * Vite ön yükleme hatası olayı uygulama kodunda dinlenmez. Olayı iptal etmek başarısız dinamik importu `undefined` ile
 * çözer (lazyWide ve Chart kurtarması bozulur); kendiliğinden yenileme içe aktarılan nesli ve taslakları siler. Parça
 * hatası yükleyicilere (rota sınırı, lazyWide) düşer ve "Yeni sürüm var · Yenile" kullanıcının seçimidir.
 */
export function preloadErrorViolations(path: string, source: string): string[] {
  return /vite:preloadError/.test(stripComments(source)) ? [`${path}: vite:preloadError dinlenmez (parça hatası rota sınırına ve lazyWide kurtarmasına düşer)`] : [];
}
