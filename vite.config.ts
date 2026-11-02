import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { realpathSync } from 'node:fs';
import { startupFailureScript, startupMarkup, startupStyles } from './src/app/startup.ts';
import { adminStartupScript } from './src/admin/startup.ts';
import { privateDataPlugin } from './src/admin/devServer/privateData.ts';

// PWA ön belleğinin dışında kalan dosyalar. İlk 12 glob ana uygulamanın bilinçli tembel parçalarıdır (ana kabuk
// bunlara inmez); son 6'sı yönetim girişi, adıyla yönetime ait sağlayıcı parçaları ve geniş-özel `wide-*` parçalarıdır.
const PRECACHE_IGNORES = ['**/Charts-*', '**/PaymentChart-*', '**/VehiclePage-*', '**/TimelinePage-*', '**/FinancePage-*', '**/timelineStore-*', '**/financeStore-*', '**/LegacyApp-*', '**/HomePlanPage-*', '**/NumberInput-*', '**/Collapse-*', '**/Tabs-*', '**/admin.html', '**/admin-*', '**/antd-*', '**/pro-*', '**/icons-*', '**/wide-*'];

// Ad listesi tek başına yetmez: ikinci giriş (admin.html) eklenince rolldown, yönetim sayfalarını ve yönetimle tembel
// ana parçalar arasında paylaşılan modülleri (ECharts alt parçaları, Phosphor/idb-keyval, ortak kabuk) modül adından
// türeyen adlarla (VeriPage-*, graphic-*, X.es-* ...) ayrı parçalara böler. Bu eklenti son paket grafiğinden
// admin.html'in eriştiği ama ana girişin kabuğunun (tembel parçalarda durarak) erişmediği JS/CSS dosyalarını çıkarır;
// workbox manifestTransforms bunları ön bellekten atar. Ana kabuğa ait hiçbir dosya ad ne olursa olsun atılmaz.
function adminPrecacheScope(ignores: readonly string[]) {
  const lazy = ignores.map((glob) => new RegExp(`(?:^|/)${glob.replace(/^\*\*\//, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`));
  let adminOnly: Set<string> | undefined;
  // Çalışma zamanı önbelleği için: admin grafiğinden erişilip ana uygulamanın TAM grafiğinden (tembel parçalar dahil)
  // erişilmeyen JS/CSS. Ana uygulamayla paylaşılan tembel parçalar (ECharts çekirdeği, babel-runtime) burada değildir.
  let adminRuntimeOnly: Set<string> | undefined;
  const plugin: Plugin = {
    name: 'aile-admin-precache-scope',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = new Map(Object.values(bundle).flatMap((output) => (output.type === 'chunk' ? [[output.fileName, output] as const] : [])));
      const entries = (name: string) => [...chunks.values()].filter((chunk) => chunk.isEntry && chunk.name === name).map((chunk) => chunk.fileName);
      const reach = (roots: string[], stop: (file: string) => boolean) => {
        const seen = new Set<string>();
        const queue = [...roots];
        while (queue.length) {
          const file = queue.shift()!;
          const chunk = chunks.get(file);
          if (!chunk || seen.has(file)) continue;
          seen.add(file);
          for (const next of [...chunk.imports, ...chunk.dynamicImports]) if (!seen.has(next) && !stop(next)) queue.push(next);
        }
        return seen;
      };
      // Girdi anahtarları (rolldownOptions.input): index = ana uygulama, admin = yönetim paneli.
      const main = reach(entries('index'), (file) => lazy.some((re) => re.test(file)));
      const admin = reach(entries('admin'), () => false);
      if (main.size === 0 || admin.size === 0) this.error('aile-admin-precache-scope: index/admin giriş parçaları bulunamadı');
      const css = (file: string) => [...(chunks.get(file)?.viteMetadata?.importedCss ?? [])];
      const mainFiles = new Set([...main].flatMap((file) => [file, ...css(file)]));
      adminOnly = new Set([...admin].flatMap((file) => [file, ...css(file)]).filter((file) => !mainFiles.has(file)));
      const mainAll = reach(entries('index'), () => false);
      const mainAllFiles = new Set([...mainAll].flatMap((file) => [file, ...css(file)]));
      adminRuntimeOnly = new Set([...admin].flatMap((file) => [file, ...css(file)]).filter((file) => !mainAllFiles.has(file)));
    },
  };
  const manifestTransform = <T extends { url: string }>(manifest: T[]) => {
    if (!adminOnly) throw new Error('aile-admin-precache-scope: paket grafiği hesaplanmadan ön bellek listesi istendi');
    const excluded = adminOnly;
    return { manifest: manifest.filter((entry) => !excluded.has(entry.url.replace(/^\.?\//, ''))), warnings: [] };
  };
  const runtimeExcluded = (): string[] => {
    if (!adminRuntimeOnly) throw new Error('aile-admin-precache-scope: paket grafiği hesaplanmadan çalışma zamanı dışlama listesi istendi');
    return [...adminRuntimeOnly].sort();
  };
  return { plugin, manifestTransform, runtimeExcluded };
}

type RuntimeCachingEntry = NonNullable<NonNullable<VitePWAOptions['workbox']>['runtimeCaching']>[number];

/**
 * Ana uygulamanın "ziyaret edilen modüller" önbelleği: aynı kökenden /assets/ altındaki script/style isteği CacheFirst
 * (30 giriş, 7 gün). Service worker kapsamı /aile/ olduğundan admin.html sekmesi de denetlenir; yönetime ait dosyalar
 * (adminPrecacheScope.runtimeExcluded) bu önbelleğe yazılmaz, yoksa 30 girişi doldurup ana uygulamanın çevrim dışı
 * tembel modüllerini çıkarırlar. workbox urlPattern işlevini Function.prototype.toString ile sw.js'e yazar; kapanış
 * değişkeni taşınmaz, bu yüzden dosya adı listesi gövdeye sabit olarak gömülür (hash'li adlar dist içinde tekildir).
 */
function visitedModulesRoute(excluded: readonly string[]): RuntimeCachingEntry {
  const names = JSON.stringify([...new Set(excluded.map((file) => file.slice(file.lastIndexOf('/') + 1)))].sort());
  const urlPattern = new Function('context', [
    'const url = context.url;',
    'const request = context.request;',
    `const admin = ${names};`,
    "return url.origin === self.location.origin && url.pathname.includes('/assets/') && ['script', 'style'].includes(request.destination)",
    "  && !admin.includes(url.pathname.slice(url.pathname.lastIndexOf('/') + 1));",
  ].join('\n')) as RuntimeCachingEntry['urlPattern'];
  return { urlPattern, handler: 'CacheFirst', options: { cacheName: 'aile-visited-modules', expiration: { maxEntries: 30, maxAgeSeconds: 604800 } } };
}

const precacheScope = adminPrecacheScope(PRECACHE_IGNORES);

// Giriş parçası (index-*, admin-*) her sayfada <script type="module"> ile zaten yüklenir. Tembel bir parça (sayfa, wide)
// giriş parçasını statik import edince Vite onu dinamik importun ön yükleme listesine (__vite__mapDeps) koyar; ön
// yükleme yardımcısı yinelemeyi yalnız link[href] ile denetler, giriş ise <script>'tir: <link rel="modulepreload">
// eklenir ve WebKit giriş parçasını ikinci kez ister. Bu eklenti son paket grafiğinden giriş parçalarını toplar
// (Vite'ın ön yükleme yazımından önce: order 'pre'); resolveDependencies onları listeden çıkarır. Yalnız ön yükleme
// ipucu değişir: import grafiği, parçalar ve giriş dışı ön yüklemeler aynı kalır (vite-config.test.ts).
function entryPreloadFilter() {
  let entries: Set<string> | undefined;
  const plugin: Plugin = {
    name: 'aile-entry-preload-filter',
    apply: 'build',
    generateBundle: {
      order: 'pre',
      handler(_options, bundle) {
        entries = new Set(Object.values(bundle).flatMap((output) => (output.type === 'chunk' && output.isEntry ? [output.fileName] : [])));
      },
    },
  };
  const resolveDependencies = (_file: string, deps: string[]) => {
    if (!entries) throw new Error('aile-entry-preload-filter: paket grafiği hesaplanmadan ön yükleme listesi istendi');
    const known = entries;
    return deps.filter((dep) => !known.has(dep));
  };
  return { plugin, resolveDependencies };
}

const entryPreload = entryPreloadFilter();

// The main shell only needs wouter's hash-location hook (src/dashboard/Dashboard.tsx). wouter's router core
// (index/use-browser-location/paths + regexparam) belongs to the lazy LegacyApp and to admin, so it stays out of the
// precached `shared` chunk; the `router` group below keeps it out of the shell and away from an `index-*` name.
const WOUTER_BOOT = /node_modules[\\/]wouter[\\/]src[\\/](use-hash-location|react-deps|use-sync-external-store)\.js$/;

/** name = sınıf (delivery-graph grubu); chunkName verilirse codeSplitting parça adı modüle göre ondan gelir. */
type ChunkGroup = { name: string; priority: number; test: (id: string) => boolean; chunkName?: (id: string) => string };

// Geniş-özel (tablet/masaüstü) modüller: src/ altında `*.wide.{ts,tsx,js,jsx,css}` adı veya `wide/` klasörü. Sınıfları
// `wide`dır (delivery-graph); telefon profili bunları statik olarak hiç istemez (kapı: scripts/check-delivery.mjs).
// Sorgu eki (?used, ?inline) kabul edilir; node_modules içindeki `src/wide` gibi yollar sayılmaz. Geniş-özel bir
// modülün yalnız onun kullandığı yardımcıları da `.wide.` adı veya `wide/` klasörüyle işaretlenir; işaretsiz ortak
// modüller bilerek wide parçasına alınmaz (includeDependenciesRecursively: false).
const WIDE_MODULE = /[\\/]src[\\/](?:[^?]*[\\/])?(?:wide[\\/][^?]+|[^\\/?]+\.wide\.(?:[cm]?[jt]sx?|css))(?:\?.*)?$/;
const isWideModule = (id: string) => !/[\\/]node_modules[\\/]/.test(id) && WIDE_MODULE.test(id);

// Geniş-özel modülün parçası birime göredir (tek `wide` parçası sayfa modüllerini statik çektiği için geniş ilk rota
// başka sayfaların JS/CSS'ini indiriyordu): rota sayfası klasörü (src/admin/pages/<ad>/…) ya da sayfa dosyası
// (pages/<Ad>Page.wide.*) → `wide-<ad>`; başka yerdeki modül (kabuk, ui, mini proje) klasör yolu + modül kökü →
// `wide-shell-workspacenav`, `wide-ui-kanban`. `wide` klasör segmenti ve `admin` öneki ada girmez; .tsx ile .css aynı
// kökü paylaşır. Ad yalnız parça dosya adını belirler; sınıf (check-delivery, check-budgets) delivery-graph'tan gelir.
// Gövde düz JavaScript'tir (tür ifadesi yok): vite-config.test.ts işlevi metinden çalıştırıp örnek yollarla sınar.
function wideChunkName(id: string): string {
  const path = id.replace(/\\/g, '/').replace(/\?.*$/, '');
  const rel = path.slice(path.lastIndexOf('/src/') + '/src/'.length);
  const page = /^admin\/pages\/(?:([^/]+)\/|([^/.]+?)Page\.wide\.)/.exec(rel);
  if (page) return `wide-${page[1] ?? page[2]}`.toLowerCase();
  const parts = rel.split('/').filter((part) => part !== 'wide');
  if (parts[0] === 'admin') parts.shift();
  const stem = (parts.pop() ?? '').split('.')[0];
  return ['wide', ...parts, stem].join('-').toLowerCase();
}

// codeSplitting grupları için tek liste; deliveryGraph aynı testlerle modül → grup üyeliğini yazar. Bir modül en yüksek
// öncelikli eşleşen gruba girer (rolldown kuralı).
const CHUNK_GROUPS: ChunkGroup[] = [
  // Geniş-özel modüller en yüksek öncelikte: shared/tokens dahil hiçbir grup onları alamaz.
  { name: 'wide', chunkName: wideChunkName, priority: 30, test: isWideModule },
  // Both token modules (source + legacy re-export) stay in one chunk, as before the second entry.
  { name: 'tokens', priority: 20, test: (id: string) => /src[\\/](design|dashboard)[\\/]tokens\.ts$/.test(id) },
  // icons/pro outrank the antd group so `@ant-design/*` below cannot swallow them.
  { name: 'pro', priority: 15, test: (id: string) => id.includes('@ant-design/pro-') },
  { name: 'icons', priority: 15, test: (id: string) => id.includes('@ant-design/icons') },
  // Babel helpers in their own small chunk, above antd and below pro/icons. In the antd group they made every
  // other consumer import the whole antd chunk: the main app's lazy LegacyApp (@mantine/notifications,
  // react-transition-group) and, once the phone profile drops antd, any phone module that needs a helper
  // (docs/ADMIN-DEPLOY-PROPOSAL.md §8). Not a forbidden phone class; never precached because the main shell never
  // reaches it and adminPrecacheScope drops it from the admin graph (vite-config.test pins both).
  { name: 'babel-runtime', priority: 11, test: (id: string) => /node_modules[\\/]@babel[\\/]runtime[\\/]/.test(id) },
  // antd plus the helpers only antd/cssinjs consume (@ant-design/colors|fast-color, stylis,
  // @emotion/hash|unitless, is-mobile, react-is). Left ungrouped they land in the admin entry
  // chunk (not precached, but antd then imports back from the app chunk) or in an automatic common chunk
  // that the precache glob would pick up.
  { name: 'antd', priority: 10, test: (id: string) => /node_modules[\\/](antd|@ant-design|@rc-component|stylis|@emotion|is-mobile|react-is|classnames)[\\/]/.test(id) },
  // wouter's router core: shared only by the lazy LegacyApp and admin, so never precached (see WOUTER_BOOT).
  { name: 'router', priority: 1, test: (id: string) => !WOUTER_BOOT.test(id) && /node_modules[\\/](wouter|regexparam)[\\/]/.test(id) },
  // Modules both entries import statically (React, wouter's hash-location hook and their deps, keyboard
  // mode): one precached chunk instead of several automatic common chunks. React cannot live in two chunks of one build, so
  // this chunk is the whole cost of the second entry to the main precache. An explicit test, not
  // `minShareCount: 2`: a share count also matches modules that two *lazy* chunks share (NumberInput,
  // Tabs, financeStore) and would pull those globIgnored chunks into the precache.
  // `clsx` (Mantine and antd) and Vite's modulepreload polyfill and preload helper (both entries) ride along
  // instead of becoming more sub-kilobyte precache entries. The rolldown runtime cannot be grouped.
  { name: 'shared', priority: 0, test: (id: string) => /node_modules[\\/](react|react-dom|scheduler|use-sync-external-store|clsx)[\\/]/.test(id) || WOUTER_BOOT.test(id) || /src[\\/]dashboard[\\/]keyboard\.ts$/.test(id) || /vite\/(modulepreload-polyfill|preload-helper)/.test(id) },
];

// rolldown codeSplitting grupları: ad işlevi her dönen adı ayrı grup sayar (wide birimleri); öncelik ve test aynı.
const SPLIT_GROUPS = CHUNK_GROUPS.map(({ name, chunkName, priority, test }) => ({ name: chunkName ?? name, priority, test }));

type DeliveryChunk = { modules: number; groups: Record<string, number>; packages: Record<string, number> };
type DeliveryEdge = { fromChunk: string; from: string; fromGroup: string | null; toChunk: string; to: string; toGroup: string | null };

// Uyarlamalı teslim kanıtı. Vite manifesti (build.manifest → .vite/manifest.json) parça grafiğini verir, parçanın hangi
// modüllerden oluştuğunu vermez; bu eklenti son paket grafiğinden .vite/delivery-graph.json yazar (schema 1):
//  - chunks[dosya] = { modules, groups: { codeSplitting grubu: modül sayısı }, packages: { paket | '.' | 'virtual': n } };
//    grup üyeliği CHUNK_GROUPS testleriyle, öncelik sırasıyla hesaplanır (parça adından tahmin edilmez).
//  - edges = tekilleştirilmiş statik import kenarları { fromChunk, from, fromGroup, toChunk, to, toGroup }: paket sınırını
//    ya da parça sınırını geçen her modül → modül kenarı. Yalnız yeniden dışa aktaran ya da ağaç sarsmayla düşen ara
//    modüllerin (barrel) içinden geçilerek çözülür; parça sınırını geçen kenar, kaynak parça hedef parçayı gerçekten
//    import ediyorsa yazılır.
// Anahtarlar köke görelidir; node_modules modülleri paket adına indirgenir. Mutlak yol ve .pnpm sürüm yolu yazılmaz.
// scripts/check-delivery.mjs telefon statik kapanışını manifestten, sınıfları ve içe aktaran modülleri buradan çıkarır.
function deliveryGraph(groups: readonly ChunkGroup[]): Plugin {
  const ordered = [...groups].sort((a, b) => b.priority - a.priority);
  const groupOf = (id: string) => ordered.find((group) => group.test(id))?.name ?? null;
  let roots: string[] = [];
  const normalize = (id: string) => id.replace(/^\0/, '').replace(/\\/g, '/').replace(/\?.*$/, '');
  const packageOf = (id: string) => {
    const at = id.lastIndexOf('/node_modules/');
    if (at < 0) return null;
    const [scope, name] = id.slice(at + '/node_modules/'.length).split('/');
    return scope.startsWith('@') ? `${scope}/${name}` : scope;
  };
  const keyOf = (raw: string) => {
    const id = normalize(raw);
    const pkg = packageOf(id);
    if (pkg) return pkg;
    const virtual = /^\/?(virtual:.*)$/.exec(id);
    if (virtual) return virtual[1];
    for (const base of roots) if (id.startsWith(`${base}/`)) return id.slice(base.length + 1);
    if (/^(?:[A-Za-z]:)?\//.test(id)) return `<outside>/${id.split('/').pop()}`;
    return `virtual:${id}`;
  };
  const packageKey = (raw: string) => {
    const id = normalize(raw);
    return packageOf(id) ?? (keyOf(raw).startsWith('virtual:') ? 'virtual' : '.');
  };
  return {
    name: 'aile-delivery-graph',
    apply: 'build',
    configResolved(config) {
      const base = config.root.replace(/\\/g, '/');
      let real = base;
      try { real = realpathSync(config.root).replace(/\\/g, '/'); } catch { /* kök yoksa yalnız verilen yol */ }
      roots = [...new Set([base, real])];
    },
    generateBundle(_options, bundle) {
      const owner = new Map<string, string>();
      const chunkImports = new Map<string, Set<string>>();
      const chunks: Record<string, DeliveryChunk> = {};
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        chunkImports.set(output.fileName, new Set(output.imports));
        const entry: DeliveryChunk = { modules: 0, groups: {}, packages: {} };
        for (const id of Object.keys(output.modules)) {
          owner.set(id, output.fileName);
          entry.modules += 1;
          const group = groupOf(id);
          if (group) entry.groups[group] = (entry.groups[group] ?? 0) + 1;
          const pkg = packageKey(id);
          entry.packages[pkg] = (entry.packages[pkg] ?? 0) + 1;
        }
        chunks[output.fileName] = entry;
      }
      // getModuleInfo modül başına bir kez: barrel modülleri birçok başlangıçtan geçilir.
      const importsCache = new Map<string, readonly string[]>();
      const importsOf = (id: string) => {
        let ids = importsCache.get(id);
        if (!ids) importsCache.set(id, (ids = [...(this.getModuleInfo(id)?.importedIds ?? [])]));
        return ids;
      };
      const edges = new Map<string, DeliveryEdge>();
      for (const [id, fromChunk] of owner) {
        const from = keyOf(id);
        const fromGroup = groupOf(id);
        const fromPackage = packageOf(normalize(id)) !== null;
        const seen = new Set([id]);
        const stack = [...importsOf(id)];
        while (stack.length) {
          const dep = stack.pop()!;
          if (seen.has(dep)) continue;
          seen.add(dep);
          const toChunk = owner.get(dep);
          if (!toChunk) { stack.push(...importsOf(dep)); continue; }
          if (toChunk !== fromChunk && !chunkImports.get(fromChunk)?.has(toChunk)) continue;
          const to = keyOf(dep);
          const toGroup = groupOf(dep);
          if (to === from && toGroup === fromGroup) continue;
          if (toChunk === fromChunk && !fromPackage && packageOf(normalize(dep)) === null) continue;
          const key = [fromChunk, from, fromGroup, toChunk, to, toGroup].join('\0');
          if (!edges.has(key)) edges.set(key, { fromChunk, from, fromGroup, toChunk, to, toGroup });
        }
      }
      const order = (edge: DeliveryEdge) => [edge.fromChunk, edge.from, edge.toChunk, edge.to, edge.fromGroup ?? '', edge.toGroup ?? ''].join('\0');
      const sorted = [...edges.values()].sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
      const sortedChunks = Object.fromEntries(Object.entries(chunks).sort(([a], [b]) => (a < b ? -1 : 1)));
      this.emitFile({ type: 'asset', fileName: '.vite/delivery-graph.json', source: `${JSON.stringify({ schema: 1, groups: ordered.map((group) => group.name), chunks: sortedChunks, edges: sorted })}\n` });
    },
  };
}

export default defineConfig({
  base: '/aile/',
  plugins: [
    {
      name: 'aile-startup-html',
      transformIndexHtml(html, ctx) {
        // Startup shell belongs to the main entry only; admin.html gets the keyboard-mode installer and its own plain-HTML
        // "Uygulama yüklenemedi · Yenile" screen for a failed entry module (src/admin/startup.ts).
        if (ctx.filename.endsWith('admin.html')) return html.replace('<!--admin-startup-->', `<script>${adminStartupScript}</script>`);
        if (!ctx.filename.endsWith('index.html')) return html;
        return { html: html.replace('<!--app-startup-failure-->', `<script>${startupFailureScript}</script>`).replace('<!--app-startup-->', startupMarkup), tags: [{ tag: 'style', attrs: { 'data-app-startup': '' }, children: startupStyles, injectTo: 'head' }] };
      },
    },
    react(),
    // Yalnız dev sunucusu: AILE_GENERATION_DIR altındaki özel nesli /__aile/generation/* yolundan salt okunur servis eder.
    // apply:'serve' olduğu için build çıktısına hiçbir şey eklemez.
    privateDataPlugin(),
    precacheScope.plugin,
    entryPreload.plugin,
    deliveryGraph(CHUNK_GROUPS),
    VitePWA({
      registerType: 'autoUpdate',
      // Çalışma zamanı önbellek kuralı derleme grafiğine göre yazılır (yönetim dosyaları dışlanır); workbox sw.js'i paket
      // grafiği hesaplandıktan sonra (closeBundle) üretir.
      integration: {
        beforeBuildServiceWorker(options) {
          options.workbox.runtimeCaching = [visitedModulesRoute(precacheScope.runtimeExcluded())];
        },
      },
      // public/icon.svg is copied to dist and precached by workbox.globPatterns. includeAssets and the default
      // manifest-icon injection both add the same file again as an additional manifest entry (precached twice).
      includeManifestIcons: false,
      manifest: {
        name: 'aile — birlikte planla',
        short_name: 'aile',
        description: 'Aile bütçesi, ödeme takvimi, ev hazırlıkları ve araç planı',
        lang: 'tr',
        start_url: '/aile/',
        scope: '/aile/',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#1B3E55',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
        // Ana ekran simgesine uzun basınca: tek dokunuşla harcama formu.
        shortcuts: [{ name: 'Harcama ekle', short_name: 'Harcama', url: '/aile/#/butce/yeni', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }] }],
      },
      workbox: {
        // Yalnız uygulama kabuğu önbelleğe alınır; veri (Apps Script) asla önbelleklenmez.
        globPatterns: ['**/*.{js,css,html,svg,woff2,ttf}'],
        globIgnores: PRECACHE_IGNORES,
        // Yönetime ait, adı yukarıdaki globlara uymayan parçalar (sayfalar, ortak kabuk, ECharts alt parçaları) grafikten atılır.
        manifestTransforms: [precacheScope.manifestTransform],
        navigateFallback: '/aile/index.html',
        // pathname + search üzerinde denenir: GitHub Pages uzantısız /aile/admin adresini de admin.html olarak çözer.
        navigateFallbackDenylist: [/\/admin(?:\.html)?(?:\?|$)/],
        // Ziyaret edilen ana uygulama modülleri: kural integration.beforeBuildServiceWorker'da (visitedModulesRoute).
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    sourcemap: false,
    manifest: true, // dist/.vite/manifest.json: parça grafiği (check-delivery, vite-config.test); json, ön belleğe girmez
    // Dinamik import ön yükleme listeleri giriş parçasını taşımaz (entryPreloadFilter; WebKit'te çift istek).
    modulePreload: { resolveDependencies: entryPreload.resolveDependencies },
    // Vite 8 bundles with rolldown; `rollupOptions`/`manualChunks` are deprecated aliases. The input key
    // `index` keeps the main entry's `index-*.js` basename.
    rolldownOptions: {
      input: { index: 'index.html', admin: 'admin.html' },
      output: {
        codeSplitting: {
          // Admin-only vendor code gets its own chunks (never precached). Dependencies are NOT pulled in
          // recursively: the default would drag React into the antd chunk and break the main entry offline.
          includeDependenciesRecursively: false,
          groups: SPLIT_GROUPS,
        },
      },
    },
  },
});
