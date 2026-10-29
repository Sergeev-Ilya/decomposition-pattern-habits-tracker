import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', fileParallelism: false, maxWorkers: 1, testTimeout: 20000, hookTimeout: 20000 } });
