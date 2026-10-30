import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: '/aile/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'aile — bütçe ve araç planı',
        short_name: 'aile',
        description: 'Canlı aile bütçesi, araç ve finansman simülasyonu',
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
        globIgnores: ['**/Charts-*', '**/PaymentChart-*', '**/VehiclePage-*', '**/TimelinePage-*', '**/timelineStore-*', '**/LegacyApp-*', '**/NumberInput-*', '**/Collapse-*', '**/Tabs-*'],
        navigateFallback: '/aile/index.html',
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
  build: { sourcemap: false },
});
