import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const localEnvPath = resolve(repositoryRoot, 'backend', '.env');
export async function initializeLocalEnv(destination = localEnvPath) {
  const random = () => randomBytes(32).toString('hex');
  const content = [
    '# Local Ritm configuration. Keep this ignored file and database volumes between restarts.',
    'FRONTEND_PORT=8880', 'APP_ORIGIN=http://localhost:8880', 'COOKIE_SECURE=false',
    `AUTH_DB_PASSWORD=${random()}`, `HABITS_DB_PASSWORD=${random()}`,
    `JWT_SECRET=${random()}`, `INTERNAL_SERVICE_KEY=${random()}`, '',
  ].join('\n');
  await mkdir(dirname(destination), { recursive: true });
  try { await writeFile(destination, content, { flag: 'wx', mode: 0o600 }); return true; }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  initializeLocalEnv().then(created => console.log(created ? 'Локальная конфигурация создана. Секреты не выводятся.' : 'Существующая локальная конфигурация сохранена.'))
    .catch(() => { console.error('Не удалось подготовить локальную конфигурацию.'); process.exitCode = 1; });
}
