import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// Resolve the "@" alias to /src without depending on Node type definitions.
const srcDir = new URL('./src', import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  plugins: [
    svelte(),
    VitePWA({
      // "prompt" matches our update strategy: the app surfaces an "Update available"
      // action rather than silently reloading mid-match.
      registerType: 'prompt',
      injectRegister: 'auto',
      manifest: {
        name: 'HideOut',
        short_name: 'HideOut',
        description: 'Offline LAN multiplayer hide-and-seek prop-hunt.',
        lang: 'en',
        theme_color: '#0e1116',
        background_color: '#0e1116',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell + core assets so the game boots fully offline.
        globPatterns: ['**/*.{js,css,html,svg,woff2,ktx2,glb,gltf,json}'],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/game/**', 'src/net/**'],
    },
  },
});
