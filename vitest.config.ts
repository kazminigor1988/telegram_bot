import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['**/*.spec.ts', '**/main.ts', '**/*.module.ts'],
    },
  },
});
