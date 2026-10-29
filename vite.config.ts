import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'PDF FAST',
        short_name: 'PDF FAST',
        description: 'Leitor e editor de PDF que roda no seu aparelho, no computador e no celular.',
        lang: 'pt-BR',
        theme_color: '#c2410c',
        background_color: '#f6f5f3',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        file_handlers: [{ action: './', accept: { 'application/pdf': ['.pdf'] } }],
      },
      workbox: {
        // pdf.js fonts, cmaps and colour profiles are fetched on demand; precache them so the app works offline.
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,mjs,bcmap,pfb,ttf,icc}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
    }),
  ],
  worker: { format: 'es' },
});
