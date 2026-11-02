// Derleme eklentisi (yalnız vite build): ui/icons.tsx ve ui/icons.extra.tsx'in simge başına Phosphor importları (dist/csr/<Ad>) yalnız
// regular ağırlığını taşıyan bir modüle çözülür. Phosphor'un her simge tanımı (dist/defs/<Ad>.es.js) altı ağırlığı
// (thin, light, regular, bold, fill, duotone) tek bir Map'te taşır ve ağaç sarsması Map girdisini atamaz; Icon her zaman
// weight="regular" çizer (tasarım README › İkonografi). Üretilen modül Phosphor'un kendi csr sarmalayıcısıyla aynıdır
// (forwardRef → IconBase, aynı weights anahtarı): çizilen SVG birebir aynıdır (icons.build.test.ts her simgeyi paketin
// kendi bileşeniyle karşılaştırır). Yol tanımın kendisinden okunur; elle kopyalanmış yol verisi yok, paket güncellenince
// yeni tanım okunur. Kapsam: yalnız src/admin/ui/icons(.extra).tsx içe aktaranı; ana uygulamanın Phosphor importları (bold/fill
// ağırlıkları kullanır) dokunulmaz. Geliştirme sunucusu ve Vitest paketin kendisini kullanır (Vite ön paketlemesi
// csr modülünü başka yola taşır; çıktı aynı olduğu için fark yok).
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const CSR_SPECIFIER = /^@phosphor-icons\/react\/dist\/csr\/([A-Z][A-Za-z0-9]*)$/;
const ICONS_MODULE = /[\\/]src[\\/]admin[\\/]ui[\\/]icons(?:\.extra)?\.tsx$/;
/** Çözülen csr modülünün kimliğine eklenen sorgu: ana uygulamanın aynı dosyadan yaptığı importtan ayrı modüldür. */
export const REGULAR_QUERY = '?aile-phosphor-regular';

/** Dizge sonunu bulur (kaçışlar dahil); dönüş kapanış tırnağının indeksi. */
function stringEnd(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === '\\') i += 1;
    else if (source[i] === quote) return i;
  }
  throw new Error('Phosphor tanımı: kapanmayan dizge');
}

/**
 * Phosphor tanım modülünden React ad alanı adını ve `["regular", <ifade>]` girdisinin ifadesini çıkarır. İfade kaynak
 * metinden olduğu gibi alınır (dizge, yorum ve parantez dengesi izlenir); başka ağırlığa dokunulmaz.
 */
export function regularWeight(source: string): { react: string; expression: string } {
  const namespace = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']react["']/.exec(source);
  if (!namespace) throw new Error('Phosphor tanımı: react ad alanı importu yok');
  const key = /\[\s*["']regular["']\s*,/.exec(source);
  if (!key) throw new Error('Phosphor tanımı: regular ağırlığı yok');
  const start = key.index + key[0].length;
  let depth = 0;
  let i = start;
  for (; i < source.length; i += 1) {
    const char = source[i]!;
    if (char === '"' || char === "'" || char === '`') i = stringEnd(source, i);
    else if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Phosphor tanımı: kapanmayan yorum');
      i = end + 1;
    }
    else if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  if (source[i] !== ']') throw new Error('Phosphor tanımı: regular girdisi kapanmıyor');
  const expression = source.slice(start, i).trim();
  if (!expression) throw new Error('Phosphor tanımı: regular ifadesi boş');
  return { react: namespace[1]!, expression };
}

/** Simge modülü: Phosphor csr sarmalayıcısıyla aynı yapı, weights Map'i yalnız regular girdisini taşır. */
export function regularIconModule(name: string, defsSource: string, iconBaseId: string): string {
  const { react, expression } = regularWeight(defsSource);
  return [
    `import * as ${react} from "react";`,
    `import __aileIconBase from ${JSON.stringify(iconBaseId)};`,
    `const __aileWeights = /* @__PURE__ */ new Map([["regular", ${expression}]]);`,
    `const __aileIcon = ${react}.forwardRef((props, ref) => /* @__PURE__ */ ${react}.createElement(__aileIconBase, { ref, ...props, weights: __aileWeights }));`,
    `__aileIcon.displayName = ${JSON.stringify(`${name}Icon`)};`,
    `export { __aileIcon as ${name}, __aileIcon as ${name}Icon };`,
  ].join('\n');
}

/** Vite eklentisi: yalnız derlemede, yalnız src/admin/ui/icons(.extra).tsx'ten gelen dist/csr/<Ad> importları için. */
export function phosphorRegularOnly(): Plugin {
  return {
    name: 'aile-phosphor-regular',
    apply: 'build',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !ICONS_MODULE.test(importer.replace(/[?#].*$/, ''))) return null;
      if (!CSR_SPECIFIER.test(source)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      // Kapsamdaki import beklenen csr modülüne çözülmezse derleme durur: null dönmek altı ağırlıklı modülü sessizce
      // paketlerdi (ör. paket .mjs'e geçerse). Paket biçimi değişince eklenti açıkça güncellenmelidir.
      if (!resolved) return this.error(`aile-phosphor-regular: ${source} çözülemedi (${importer})`);
      if (resolved.external || !/[\\/]dist[\\/]csr[\\/][A-Za-z0-9]+\.es\.js$/.test(resolved.id)) {
        return this.error(`aile-phosphor-regular: ${source} beklenmeyen yola çözüldü: ${resolved.id}${resolved.external ? ' (external)' : ''}`);
      }
      return `${resolved.id}${REGULAR_QUERY}`;
    },
    load(id) {
      if (!id.endsWith(REGULAR_QUERY)) return null;
      const csr = id.slice(0, -REGULAR_QUERY.length);
      const match = /^(.*[\\/])csr([\\/])([A-Za-z0-9]+)\.es\.js$/.exec(csr);
      if (!match) throw new Error(`Phosphor csr yolu beklenmeyen biçimde: ${csr}`);
      const [, dist, sep, name] = match;
      const defs = readFileSync(`${dist}defs${sep}${name}.es.js`, 'utf8');
      return regularIconModule(name!, defs, `${dist}lib${sep}IconBase.es.js`);
    },
  };
}
