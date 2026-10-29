import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initializeLocalEnv, localEnvPath, repositoryRoot } from './init-local-env.mjs';

async function main() {
  const created = await initializeLocalEnv();
  console.log(created ? 'Локальная конфигурация создана.' : 'Используется существующая локальная конфигурация.');
  const values = {};
  for (const line of (await readFile(localEnvPath, 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  const port = Number(process.env.FRONTEND_PORT || values.FRONTEND_PORT || 8880);
  const originText = process.env.APP_ORIGIN || values.APP_ORIGIN;
  const origin = new URL(originText);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || origin.origin !== originText || origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || Number(origin.port || 80) !== port) throw new Error('Конфигурация локального адреса некорректна: согласуйте FRONTEND_PORT и APP_ORIGIN.');
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) throw new Error('Запустите Docker Desktop и повторите команду.');
  const result = spawnSync('docker', ['compose', 'up', '-d', '--build', '--wait', '--wait-timeout', '120'], { cwd: resolve(repositoryRoot, 'backend'), stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('Локальный запуск не завершён. Проверьте сообщения Docker; данные и конфигурация сохранены.');
  console.log(`Ритм запущен: ${origin.origin}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Не удалось запустить Ритм.'); process.exitCode = 1; });
