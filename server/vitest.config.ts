import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    // Les tests tapent directement dans les sources partagées : pas de build
    // intermédiaire à maintenir pendant le développement.
    alias: { '@nadhef/shared': new URL('../shared/src/index.ts', import.meta.url).pathname },
  },
});
