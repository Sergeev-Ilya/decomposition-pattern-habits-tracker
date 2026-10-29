import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeLocalEnv } from '../../../scripts/init-local-env.mjs';
describe('Local configuration persistence', () => {
  it('creates private independent keys once and preserves them on repeated initialization', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ritm-config-test-')); const file = join(directory, '.env');
    try {
      expect(await initializeLocalEnv(file)).toBe(true);
      const original = await readFile(file, 'utf8');
      const fields = Object.fromEntries(original.split('\n').filter(line => line.includes('=')).map(line => line.split('=')));
      expect(fields.APP_ORIGIN).toBe('http://localhost:8880');
      const keys = ['JWT_SECRET', 'INTERNAL_SERVICE_KEY', 'AUTH_DB_PASSWORD', 'HABITS_DB_PASSWORD'].map(key => fields[key]);
      expect(keys.every(key => /^[a-f0-9]{64}$/.test(key))).toBe(true); expect(new Set(keys).size).toBe(4);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await initializeLocalEnv(file)).toBe(false); expect((await readFile(file, 'utf8')) === original).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
