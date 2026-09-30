import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Static-host SPA fallback: copy the built index.html to /suggest-music and
 * /admin so both deep links (and their ?request= shares) survive a plain file
 * server or GitHub Pages, which would otherwise 404 on unknown paths.
 * Dev and `vite preview` already fall back to index.html on their own.
 */
const spaFallback = (): Plugin => ({
  name: 'spa-fallback',
  closeBundle() {
    const dist = fileURLToPath(new URL('./dist', import.meta.url));
    for (const route of ['suggest-music', 'admin']) {
      mkdirSync(`${dist}/${route}`, { recursive: true });
      copyFileSync(`${dist}/index.html`, `${dist}/${route}/index.html`);
    }
  },
});

// Static app, two views + the private control room. No server runtime, no
// database, no secrets in the bundle.
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
