import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Holds the bundle back until the page has decided this is a phone.
 *
 * Vite injects the entry as a plain <script type="module" src=…>, which the
 * browser fetches before any of our code runs — so a desktop visitor would
 * download the whole game to be told they cannot play it. This lifts the src
 * out of the tag and hands it to the gate script in index.html, which appends
 * it only after the device check passes. The tag is removed, not deferred:
 * `defer` still downloads.
 */
function gateEntry(): Plugin {
  return {
    name: 'dovefall-gate-entry',
    enforce: 'post',
    transformIndexHtml(html) {
      const m = /<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/.exec(html);
      if (!m) return html;
      return {
        html: html.replace(m[0], ''),
        tags: [{
          tag: 'script',
          injectTo: 'body-prepend',
          children: `window.__DOVEFALL_ENTRY=${JSON.stringify(m[1])};`,
        }],
      };
    },
  };
}

export default defineConfig({
  base: './',            // works under /dovefallgame/ or at a root, unchanged
  plugins: [
    react(),
    tailwind(),
    gateEntry(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered by hand in main.tsx, which only runs on a handheld — a
      // desktop visitor should not be given a service worker for a game they
      // are not allowed to play.
      injectRegister: false,
      includeAssets: ['icon-192.png', 'icon-512.png', 'share.png'],
      manifest: {
        name: 'Dovefall',
        short_name: 'Dovefall',
        description: 'One touch. Storm, deep and sky.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0D1420',
        theme_color: '#0D1420',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // The API is never cached: a leaderboard from yesterday is worse than
        // no leaderboard, and the game already works with neither.
        navigateFallbackDenylist: [/^\/v1\//],
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
