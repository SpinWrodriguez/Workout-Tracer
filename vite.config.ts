import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

/*
 * GitHub Pages serves a project repo from a subpath, so every asset URL, the
 * service worker scope and the manifest have to agree on it.
 *
 * Applied in dev too, on purpose. Serving dev from the root and the build from
 * a subpath is how a base-path bug stays invisible until it is deployed — and
 * `vite preview` reports itself as `serve`, so keying off the command silently
 * broke preview as well. Dev now lives at /Workout-Tracer/ like everything
 * else. Set VITE_BASE=/ for a host that serves from the root.
 */
const BASE = process.env.VITE_BASE ?? '/Workout-Tracer/';

export default defineConfig(() => ({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Workout Tracer',
        short_name: 'Workout',
        description: 'Garage-gym hypertrophy and strength tracker.',
        // Installed to the iPhone home screen; no App Store, no dev account.
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0A0A0A',
        theme_color: '#0A0A0A',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Fonts are bundled rather than fetched, so everything the app needs
        // is precached: it has to work in a garage with no wifi.
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        // The UI is English; the Cyrillic/Greek/Vietnamese subsets would add
        // ~120 KiB to the precache that no browser here will ever request.
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
