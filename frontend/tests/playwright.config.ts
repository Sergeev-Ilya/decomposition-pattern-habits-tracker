import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
const state = JSON.parse(readFileSync(new URL('../../.project/state.json', import.meta.url), 'utf8'));
const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL || baseURL !== state.baseUrl) throw new Error('PLAYWRIGHT_BASE_URL must equal the full state.baseUrl');
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, retries: 0,
  timeout: 40_000, expect: { timeout: 8_000 },
  reporter: [['list'], ['json', { outputFile: new URL('../test-results/e2e-results.json', import.meta.url).pathname }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', timezoneId: 'Europe/Moscow' },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
