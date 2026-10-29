export interface GatewayConfig { appOrigin: string; authServiceUrl: string; habitsServiceUrl: string }
export interface ServerConfig extends GatewayConfig { port: number }
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  function origin(key: string): string {
    const value = env[key];
    if (!value) throw new Error(`Missing required configuration: ${key}`);
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value || parsed.username || parsed.password) throw new Error(`Invalid ${key}`);
    return parsed.origin;
  }
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return { appOrigin: origin('APP_ORIGIN'), authServiceUrl: origin('AUTH_SERVICE_URL'), habitsServiceUrl: origin('HABITS_SERVICE_URL'), port };
}
