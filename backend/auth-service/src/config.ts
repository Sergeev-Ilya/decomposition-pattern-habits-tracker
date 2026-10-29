export interface AuthConfig {
  appOrigin: string;
  jwtSecret: string;
  internalServiceKey: string;
  cookieSecure: boolean;
}
export interface ServerConfig extends AuthConfig { databaseUrl: string; port: number }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const required = (key: string) => {
    const value = env[key];
    if (!value) throw new Error(`Missing required configuration: ${key}`);
    return value;
  };
  const appOrigin = required('APP_ORIGIN');
  const origin = new URL(appOrigin);
  if (origin.origin !== appOrigin || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol)) throw new Error('APP_ORIGIN must be an exact HTTP(S) origin');
  const jwtSecret = required('JWT_SECRET');
  const internalServiceKey = required('INTERNAL_SERVICE_KEY');
  if ([jwtSecret, internalServiceKey].some(value => /^REPLACE_WITH_|^CHANGE_ME/i.test(value))) throw new Error('Replace example secrets with random values');
  if (Buffer.byteLength(jwtSecret) < 32 || Buffer.byteLength(internalServiceKey) < 32 || jwtSecret === internalServiceKey) throw new Error('Independent signing and service secrets must be at least 32 bytes');
  if (env.COOKIE_SECURE !== 'true' && env.COOKIE_SECURE !== 'false') throw new Error('COOKIE_SECURE must explicitly be true or false');
  const cookieSecure = env.COOKIE_SECURE === 'true';
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (!cookieSecure && !(origin.protocol === 'http:' && isLoopback)) throw new Error('Insecure cookies are only allowed for local loopback HTTP');
  if (cookieSecure && origin.protocol !== 'https:') throw new Error('Secure cookies require HTTPS');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return { appOrigin, jwtSecret, internalServiceKey, cookieSecure, databaseUrl: required('DATABASE_URL'), port };
}
