import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single-screen static app. No server runtime, no database, no secrets.
export default defineConfig({
  plugins: [react()],
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
});
