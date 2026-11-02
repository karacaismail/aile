import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { startupFailureScript, startupMarkup, startupStyles } from './src/app/startup.ts';
import { adminStartupScript } from './src/admin/startup.ts';
import { privateDataPlugin } from './src/admin/devServer/privateData.ts';

// PWA ön belleğinin dışında kalan dosyalar. İlk 12 glob ana uygulamanın bilinçli tembel parçalarıdır (ana kabuk
// bunlara inmez); son 5'i yönetim girişi ve adıyla yönetime ait sağlayıcı parçalarıdır.
const PRECACHE_IGNORES = ['**/Charts-*', '**/PaymentChart-*', '**/VehiclePage-*', '**/TimelinePage-*', '**/FinancePage-*', '**/timelineStore-*', '**/financeStore-*', '**/LegacyApp-*', '**/HomePlanPage-*', '**/NumberInput-*', '**/Collapse-*', '**/Tabs-*', '**/admin.html', '**/admin-*', '**/antd-*', '**/pro-*', '**/icons-*'];

// Ad listesi tek başına yetmez: ikinci giriş (admin.html) eklenince rolldown, yönetim sayfalarını ve yönetimle tembel
// ana parçalar arasında paylaşılan modülleri (ECharts alt parçaları, Phosphor/idb-keyval, ortak kabuk) modül adından
// türeyen adlarla (VeriPage-*, graphic-*, X.es-* ...) ayrı parçalara böler. Bu eklenti son paket grafiğinden
// admin.html'in eriştiği ama ana girişin kabuğunun (tembel parçalarda durarak) erişmediği JS/CSS dosyalarını çıkarır;
// workbox manifestTransforms bunları ön bellekten atar. Ana kabuğa ait hiçbir dosya ad ne olursa olsun atılmaz.
function adminPrecacheScope(ignores: readonly string[]) {
  const lazy = ignores.map((glob) => new RegExp(`(?:^|/)${glob.replace(/^\*\*\//, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`));
  let adminOnly: Set<string> | undefined;
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
    },
  };
  const manifestTransform = <T extends { url: string }>(manifest: T[]) => {
    if (!adminOnly) throw new Error('aile-admin-precache-scope: paket grafiği hesaplanmadan ön bellek listesi istendi');
    const excluded = adminOnly;
    return { manifest: manifest.filter((entry) => !excluded.has(entry.url.replace(/^\.?\//, ''))), warnings: [] };
  };
  return { plugin, manifestTransform };
}

const precacheScope = adminPrecacheScope(PRECACHE_IGNORES);

// The main shell only needs wouter's hash-location hook (src/dashboard/Dashboard.tsx). wouter's router core
// (index/use-browser-location/paths + regexparam) belongs to the lazy LegacyApp and to admin, so it stays out of the
// precached `shared` chunk; the `router` group below keeps it out of the shell and away from an `index-*` name.
const WOUTER_BOOT = /node_modules[\\/]wouter[\\/]src[\\/](use-hash-location|react-deps|use-sync-external-store)\.js$/;

export default defineConfig({
  base: '/aile/',
  plugins: [
    {
      name: 'aile-startup-html',
      transformIndexHtml(html, ctx) {
        // Startup shell belongs to the main entry only; admin.html gets just the keyboard-mode installer.
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
    VitePWA({
      registerType: 'autoUpdate',
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
        navigateFallbackDenylist: [/\/admin\.html/],
        runtimeCaching: [{ urlPattern: ({url,request}) => url.origin === self.location.origin && url.pathname.includes('/assets/') && ['script','style'].includes(request.destination), handler: 'CacheFirst', options: { cacheName: 'aile-visited-modules', expiration: { maxEntries: 30, maxAgeSeconds: 604800 } } }],
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
    // Vite 8 bundles with rolldown; `rollupOptions`/`manualChunks` are deprecated aliases. The input key
    // `index` keeps the main entry's `index-*.js` basename.
    rolldownOptions: {
      input: { index: 'index.html', admin: 'admin.html' },
      output: {
        codeSplitting: {
          // Admin-only vendor code gets its own chunks (never precached). Dependencies are NOT pulled in
          // recursively: the default would drag React into the antd chunk and break the main entry offline.
          includeDependenciesRecursively: false,
          groups: [
            // Both token modules (source + legacy re-export) stay in one chunk, as before the second entry.
            { name: 'tokens', priority: 20, test: (id: string) => /src[\\/](design|dashboard)[\\/]tokens\.ts$/.test(id) },
            // icons/pro outrank the antd group so `@ant-design/*` below cannot swallow them.
            { name: 'pro', priority: 15, test: (id: string) => id.includes('@ant-design/pro-') },
            { name: 'icons', priority: 15, test: (id: string) => id.includes('@ant-design/icons') },
            // antd plus the helpers only antd/cssinjs consume (@babel/runtime, @ant-design/colors|fast-color,
            // stylis, @emotion/hash|unitless, is-mobile, react-is). Left ungrouped they land in the admin entry
            // chunk (not precached, but antd then imports back from the app chunk) or in an automatic common chunk
            // that the precache glob would pick up.
            { name: 'antd', priority: 10, test: (id: string) => /node_modules[\\/](antd|@ant-design|@rc-component|@babel[\\/]runtime|stylis|@emotion|is-mobile|react-is|classnames)[\\/]/.test(id) },
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
          ],
        },
      },
    },
  },
});
