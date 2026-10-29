import 'dotenv/config';
import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import { migrate } from './db/migrate';
async function main() {
  const config = loadConfig(); const pool = createPool(config.databaseUrl);
  pool.on('error', () => console.error('habits-service database connection unavailable'));
  try { await migrate(pool); } catch { await pool.end(); throw new Error('Migration failed'); }
  const server = createApp({ pool, config }).listen(config.port, '0.0.0.0', () => console.log(`habits-service listening on ${config.port}`));
  const shutdown = () => { server.close(() => { void pool.end().finally(() => process.exit(0)); }); setTimeout(() => process.exit(1), 10000).unref(); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}
void main().catch(() => { console.error('habits-service startup failed; check configuration and database availability'); process.exitCode = 1; });
