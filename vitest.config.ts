import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Los helpers de prueba de la raíz no viven dentro de ningún paquete, así
    // que resuelven por alias en vez de por el enlace de pnpm.
    alias: {
      '@momentum/core': pkg('core'),
      '@momentum/db': pkg('db'),
      '@momentum/sources': pkg('sources'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // Las pruebas contra Postgres comparten esquema: en serie evitan pisarse
    // sin necesidad de una base por fichero.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
