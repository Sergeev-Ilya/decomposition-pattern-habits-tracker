import { Pool } from 'pg';
export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000 });
}
