import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
export async function migrate(pool: Pool, directory = path.resolve(__dirname, '../../migrations')): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ritm-habits-migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())');
    for (const file of (await fs.readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file])).rowCount) continue;
      await client.query(await fs.readFile(path.join(directory, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
    }
    await client.query('COMMIT');
  } catch (error) { try { await client.query('ROLLBACK'); } catch { /* Preserve original failure. */ } throw error; }
  finally { client.release(); }
}
