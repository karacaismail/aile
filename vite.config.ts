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
        name: 'aile — taşınma planlayıcısı',
        short_name: 'aile',
        description: 'Satınalma, aydınlatma, tadilat, yerleşim ve bütçe planı',
        lang: 'tr',
        start_url: '/aile/',
        scope: '/aile/',
        display: 'standalone',
        background_color: '#faf7f2',
        theme_color: '#c65d3b',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
        // Ana ekran simgesine uzun basınca: tek dokunuşla harcama formu.
        shortcuts: [{ name: 'Harcama ekle', short_name: 'Harcama', url: '/aile/#/butce/yeni', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }] }],
      },
      workbox: {
        // Yalnız uygulama kabuğu önbelleğe alınır; veri (Apps Script) asla önbelleklenmez.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/aile/index.html',
        runtimeCaching: [],
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
