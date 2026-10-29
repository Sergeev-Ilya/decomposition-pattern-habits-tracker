import { defineConfig } from 'vitest/config';
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { environment: 'jsdom', setupFiles: ['./tests/vitest.setup.ts'], include: ['tests/unit/**/*.test.{ts,tsx}'], maxWorkers: 2 },
});
