import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'نظّف سكرة · Nadhef Soukra',
        short_name: 'نظّف سكرة',
        description: 'خريطة النقاط السوداء وحملات التنظيف في سكرة',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        display: 'standalone',
        background_color: '#f1f5f9',
        theme_color: '#0f172a',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Le shell doit rester disponible hors ligne : on signale dans la rue,
        // avec un réseau médiocre (règle #7).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api/, /^\/tiles/],
        runtimeCaching: [
          {
            // Le référentiel change rarement : le cache évite un écran blanc hors ligne.
            urlPattern: /\/api\/(config|quartiers|boundary)$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'nadhef-referentiel' },
          },
          {
            // Les spots doivent être frais quand le réseau est là, mais consultables sinon.
            urlPattern: /\/api\/spots/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nadhef-spots',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /\/tiles\/.*\.pmtiles$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'nadhef-tuiles',
              // Les requêtes Range renvoient 206 : sans cela rien n'est mis en cache.
              cacheableResponse: { statuses: [0, 200, 206] },
              rangeRequests: true,
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/tiles': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // MapLibre pèse lourd : l'isoler garde le shell applicatif léger au démarrage.
        manualChunks: { maplibre: ['maplibre-gl', 'pmtiles'] },
      },
    },
  },
});
