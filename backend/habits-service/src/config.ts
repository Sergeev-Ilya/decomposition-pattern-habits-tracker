export interface HabitsConfig {
  appOrigin: string;
  jwtSecret: string;
  internalServiceKey: string;
  authServiceUrl: string;
}
export interface ServerConfig extends HabitsConfig { databaseUrl: string; port: number }
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const required = (name: string) => { const value = env[name]; if (!value) throw new Error(`Missing required configuration: ${name}`); return value; };
  const appOrigin = required('APP_ORIGIN');
  const origin = new URL(appOrigin);
  if (origin.origin !== appOrigin || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol)) throw new Error('APP_ORIGIN must be an exact HTTP(S) origin');
  const jwtSecret = required('JWT_SECRET'); const internalServiceKey = required('INTERNAL_SERVICE_KEY');
  if ([jwtSecret, internalServiceKey].some(value => /^REPLACE_WITH_|^CHANGE_ME/i.test(value))) throw new Error('Replace example secrets with random values');
  if (Buffer.byteLength(jwtSecret) < 32 || Buffer.byteLength(internalServiceKey) < 32 || jwtSecret === internalServiceKey) throw new Error('Independent signing and service secrets must be at least 32 bytes');
  const authServiceUrl = required('AUTH_SERVICE_URL'); const authUrl = new URL(authServiceUrl);
  if (!['http:', 'https:'].includes(authUrl.protocol) || authUrl.username || authUrl.password || authUrl.pathname !== '/' || authUrl.search || authUrl.hash) throw new Error('AUTH_SERVICE_URL must be a trusted HTTP(S) origin');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return { appOrigin, jwtSecret, internalServiceKey, authServiceUrl: authUrl.origin, databaseUrl: required('DATABASE_URL'), port };
}
