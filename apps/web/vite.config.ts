import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * `base` sale del entorno para que el mismo build sirva en local y bajo la ruta
 * de proyecto de GitHub Pages (`/momentum/`).
 */
export default defineConfig({
  base: process.env['SITE_BASE'] ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@momentum/exporter': fileURLToPath(new URL('../exporter/src/index.ts', import.meta.url)),
      '@momentum/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
});
