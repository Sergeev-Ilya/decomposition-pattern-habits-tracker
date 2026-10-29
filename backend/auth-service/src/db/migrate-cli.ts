import 'dotenv/config';
import { createPool } from './pool';
import { migrate } from './migrate';
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = createPool(process.env.DATABASE_URL);
  try { await migrate(pool); console.log('auth-service migrations ready'); } finally { await pool.end(); }
}
void main().catch(() => { console.error('auth-service migration failed'); process.exitCode = 1; });
