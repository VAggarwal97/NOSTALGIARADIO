import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Static-host SPA fallback: copy the built index.html to /suggest-music/index.html
 * so the community page's deep link (and its ?request= shares) survive a plain
 * file server or GitHub Pages, which would otherwise 404 on unknown paths.
 * Dev and `vite preview` already fall back to index.html on their own.
 */
const spaFallback = (): Plugin => ({
  name: 'spa-fallback',
  closeBundle() {
    const dist = fileURLToPath(new URL('./dist', import.meta.url));
    mkdirSync(`${dist}/suggest-music`, { recursive: true });
    copyFileSync(`${dist}/index.html`, `${dist}/suggest-music/index.html`);
  },
});

// Static app, two views. No server runtime, no database, no secrets.
export default defineConfig({
  plugins: [react(), spaFallback()],
  build: {
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 4096,
    reportCompressedSize: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
});
