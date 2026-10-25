import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // PC・スマホにインストールできるアプリ（PWA）にする。オフラインでも起動可能
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        id: './',
        name: '家計簿',
        short_name: '家計簿',
        description: '支出・貸し借り・競馬・固定費・税金の概算を管理する家計簿',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f4f5f2',
        theme_color: '#2f7d6d',
        categories: ['finance'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: '明細を追加', url: './?add=manual', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: '音声で入力', url: './?add=voice', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'レシートを撮影', url: './?add=receipt', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // OCRエンジン(約4MB)と日本語データもキャッシュしてオフラインで使えるようにする
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,gz}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  // GitHub Pages などサブパスでも動くよう相対パスで出力
  base: './',
});
