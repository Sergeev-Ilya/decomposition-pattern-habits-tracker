import 'dotenv/config';
import { createApp } from './app';
import { loadConfig } from './config';
try {
  const config = loadConfig();
  const server = createApp(config).listen(config.port, '0.0.0.0', () => console.log(`api-gateway listening on ${config.port}`));
  const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch { console.error('api-gateway startup failed; check configuration'); process.exitCode = 1; }
