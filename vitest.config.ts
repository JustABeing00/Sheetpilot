import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@sheetpilot/core': pkg('core'),
      '@sheetpilot/config': pkg('config'),
      '@sheetpilot/file-processing': pkg('file-processing'),
      '@sheetpilot/rule-engine': pkg('rule-engine'),
      '@sheetpilot/ai': pkg('ai'),
      '@sheetpilot/matching-engine': pkg('matching-engine'),
      '@sheetpilot/workflow-engine': pkg('workflow-engine'),
      '@sheetpilot/db': pkg('db'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
    reporters: ['default'],
    testTimeout: 20000,
  },
});
