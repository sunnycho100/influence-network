import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['shared/tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@alumni-graph/shared': path.resolve(__dirname, 'shared/src'),
    },
  },
});
