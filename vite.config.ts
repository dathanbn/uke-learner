import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project sites serve from /<repo>/. Getting this wrong 404s every asset.
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/uke-learner/' : '/',
  plugins: [
    react(),
    // Offline matters more here than for most apps: the whole product is "ten minutes a
    // day wherever your ukulele is", which is often a room with bad wifi. Nothing needs
    // the network anyway — there is no backend.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [],
      manifest: {
        name: 'uke-learner — chord practice',
        short_name: 'uke-learner',
        description: 'Spaced-repetition ukulele chord practice that listens while you play.',
        theme_color: '#fdf8f2',
        background_color: '#fdf8f2',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The AudioWorklet is a separate chunk and must be cached, or an offline session
        // starts, asks for the microphone, and then silently never produces a verdict.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
