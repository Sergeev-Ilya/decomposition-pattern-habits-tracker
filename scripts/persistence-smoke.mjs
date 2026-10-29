// Destructive only to its own synthetic fixture. Restarts the existing local stack;
// never removes containers/volumes or writes credentials, cookies, or secrets.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(root, 'backend');
const base = 'http://localhost:8880';
const services = ['auth-db', 'habits-db', 'auth-service', 'habits-service', 'api-gateway', 'frontend'];
let checks = 0;
function check(condition, message) { assert(condition, message); checks++; }
async function docker(...args) {
  try { return (await run('docker', args, { cwd: backend, timeout: 180_000, maxBuffer: 1024 * 1024 })).stdout.trim(); }
  catch { throw new Error(`Docker command failed: ${args[0]} ${args[1] ?? ''}`); }
}
async function containers() {
  const output = await docker('compose', 'ps', '--format', 'json');
  return output.startsWith('[') ? JSON.parse(output) : output.split('\n').filter(Boolean).map(line => JSON.parse(line));
}
async function assertHealthy() {
  const rows = await containers();
  check(rows.length === 6 && services.every(service => rows.some(row => row.Service === service && row.Health === 'healthy' && row.State === 'running')), 'All six Compose services must be running and healthy');
  const published = rows.flatMap(row => (row.Publishers ?? []).filter(port => port.PublishedPort > 0).map(port => ({ service: row.Service, ...port })));
  check(published.length === 1 && published[0].service === 'frontend' && published[0].URL === '127.0.0.1' && published[0].PublishedPort === 8880 && published[0].TargetPort === 80, 'Only frontend loopback port 8880 may be published');
  return rows;
}
async function volumeSnapshot(rows) {
  const volumes = [];
  for (const service of ['auth-db', 'habits-db']) {
    const row = rows.find(item => item.Service === service);
    const mounts = JSON.parse(await docker('inspect', '--format', '{{json .Mounts}}', row.ID));
    const expectedName = service === 'auth-db' ? 'ritm_auth_data' : 'ritm_habits_data';
    check(mounts.some(mount => mount.Type === 'volume' && mount.Name === expectedName && mount.Destination === '/var/lib/postgresql'), 'PostgreSQL 18 named data mount must be preserved');
    volumes.push(expectedName);
  }
  return volumes;
}
async function envSnapshot() {
  const envPath = resolve(backend, '.env');
  check(((await stat(envPath)).mode & 0o777) === 0o600, 'Local environment file must retain permissions 0600');
  await run('git', ['check-ignore', '--quiet', 'backend/.env'], { cwd: root });
  checks++;
  return createHash('sha256').update(await readFile(envPath)).digest('hex');
}
async function request(path, expected, { method = 'GET', body, cookie = '', json = true } = {}) {
  const headers = {};
  if (method !== 'GET') headers.Origin = base;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  check(response.status === expected, `${method} ${path.split('?')[0]} must return ${expected}`);
  let data;
  if (json && expected !== 204) {
    check(response.headers.get('content-type')?.includes('application/json'), 'API must return JSON rather than SPA HTML');
    data = await response.json();
    if (expected >= 400) check(typeof data.error?.code === 'string' && typeof data.requestId === 'string', 'Errors must use the public JSON envelope');
  }
  return { response, data };
}
function sessionCookie(response) {
  const cookies = response.headers.getSetCookie();
  const value = cookies.find(item => item.startsWith('ritm_session='));
  check(Boolean(value), 'Login must set the session cookie');
  check(/;\s*HttpOnly(?:;|$)/i.test(value) && /;\s*SameSite=Lax(?:;|$)/i.test(value) && /;\s*Path=\/(?:;|$)/i.test(value) && /;\s*Max-Age=604800(?:;|$)/i.test(value), 'Session cookie must retain HttpOnly, SameSite=Lax, Path=/ and seven-day lifetime');
  check(!/;\s*Secure(?:;|$)/i.test(value) && !/;\s*Domain=/i.test(value), 'Local HTTP cookie must be host-only and compatible with HTTP');
  return value.split(';')[0];
}
async function readiness() {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    try {
      const rows = await containers();
      if (rows.length === 6 && rows.every(row => row.Health === 'healthy')) {
        const response = await fetch(base + '/health', { signal: AbortSignal.timeout(5_000) });
        if (response.status === 200) return;
      }
    } catch { /* Retry while the authorized restart is recovering. */ }
    await delay(2_000);
  }
  throw new Error('Stack did not recover healthy readiness within 150 seconds');
}

async function main() {
  const beforeRows = await assertHealthy();
  const beforeVolumes = await volumeSnapshot(beforeRows);
  const beforeEnv = await envSnapshot();
  const startedBefore = new Map();
  for (const row of beforeRows) startedBefore.set(row.Service, await docker('inspect', '--format', '{{.State.StartedAt}}', row.ID));
  await request('/', 200, { json: false });
  await request('/health', 200);
  await request('/api/auth/session', 401);
  await request('/api/habits', 401);
  await request('/internal/sessions/verify', 404, { method: 'POST', body: {} });
  await request('/api/unknown-deploy-smoke', 404);
  for (const [service, port] of [['auth-service', 3000], ['habits-service', 3000], ['api-gateway', 8080]]) {
    const output = await docker('compose', 'exec', '-T', service, 'node', '-e', `fetch('http://127.0.0.1:${port}/health').then(r=>{console.log(r.status);if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))`);
    check(output === '200', `${service} internal readiness must return 200`);
  }
  console.log('PASS preflight: 6 healthy, frontend-only loopback port, named PG18 mounts, ignored env 0600, SPA/API/internal routing, internal readiness');

  const email = `deploy-${randomBytes(12).toString('hex')}@example.test`;
  const password = randomBytes(24).toString('base64url');
  const timeZone = 'Europe/Moscow';
  const registered = (await request('/api/auth/register', 201, { method: 'POST', body: { email, password, timeZone } })).data;
  const login = await request('/api/auth/login', 200, { method: 'POST', body: { email, password } });
  const oldCookie = sessionCookie(login.response);
  check(login.data.user.id === registered.user.id, 'Login must identify the registered user');
  const sessionBefore = (await request('/api/auth/session', 200, { cookie: oldCookie })).data;
  const created = (await request('/api/habits', 201, { method: 'POST', cookie: oldCookie, body: { name: 'Deploy retention fixture', description: 'Synthetic persistence check' } })).data;
  const habitPath = `/api/habits/${created.habit.id}`;
  const today = created.today;
  check(/^\d{4}-\d{2}-\d{2}$/.test(today) && created.timeZone === timeZone && created.habit.startDate === today, 'Habit must use the server calendar date and account timezone');
  const completed = (await request(`${habitPath}/completions/${today}`, 200, { method: 'PUT', cookie: oldCookie, body: { completed: true } })).data;
  check(completed.completed === true && completed.date === today && completed.habit.todayCompleted === true && completed.habit.currentStreak === 1, 'Completion must persist the server date and current streak');
  const patched = (await request(habitPath, 200, { method: 'PATCH', cookie: oldCookie, body: { name: 'Deploy retention fixture updated', description: 'Updated before restart' } })).data;
  check(patched.habit.todayCompleted === true && patched.habit.startDate === today, 'Editing must preserve habit history and start date');
  const month = today.slice(0, 7);
  const calendarPath = `${habitPath}/calendar?month=${month}`;
  const beforeCalendar = (await request(calendarPath, 200, { cookie: oldCookie })).data;
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  check(beforeCalendar.daysInMonth === daysInMonth && beforeCalendar.completedCount === 1 && beforeCalendar.completedDates.length === 1 && beforeCalendar.completedDates[0] === today && Math.abs(beforeCalendar.completionPercent - 100 / daysInMonth) < 1e-10, 'Calendar percentage must divide by the complete month');
  check(beforeCalendar.editableFrom === today && beforeCalendar.editableTo === today, 'New habit editing window must use server today');
  const habitsBefore = (await request('/api/habits', 200, { cookie: oldCookie })).data;
  check(habitsBefore.habits.length === 1 && habitsBefore.habits[0].id === created.habit.id, 'Synthetic account must own its new habit');
  console.log(`PASS authenticated public API: register/login/session/create/completion/patch/calendar; server today ${today}; full-month denominator ${daysInMonth}; cookie attributes verified`);

  console.log('Restarting all six existing Compose containers without removing volumes or rewriting configuration...');
  await docker('compose', 'restart');
  await readiness();
  const afterRows = await assertHealthy();
  for (const row of afterRows) check(await docker('inspect', '--format', '{{.State.StartedAt}}', row.ID) !== startedBefore.get(row.Service), 'Every Compose container must have restarted');
  check(JSON.stringify(await volumeSnapshot(afterRows)) === JSON.stringify(beforeVolumes), 'Database volume identities must be unchanged after restart');
  check(await envSnapshot() === beforeEnv, 'Environment configuration must be byte-for-byte unchanged after restart');
  const sessionAfter = (await request('/api/auth/session', 200, { cookie: oldCookie })).data;
  check(JSON.stringify(sessionAfter) === JSON.stringify(sessionBefore), 'Pre-restart cookie and persisted session must remain valid unchanged');
  const habitAfter = (await request(habitPath, 200, { cookie: oldCookie })).data;
  const calendarAfter = (await request(calendarPath, 200, { cookie: oldCookie })).data;
  check(JSON.stringify(habitAfter.habit) === JSON.stringify(patched.habit), 'Habit details and summary must survive restart unchanged');
  check(JSON.stringify(calendarAfter) === JSON.stringify(beforeCalendar), 'Completion history and complete calendar must survive restart unchanged');
  const freshLogin = await request('/api/auth/login', 200, { method: 'POST', body: { email, password } });
  const newCookie = sessionCookie(freshLogin.response);
  check(freshLogin.data.user.id === registered.user.id, 'Fresh login after restart must identify the original account');
  const freshCalendar = (await request(calendarPath, 200, { cookie: newCookie })).data;
  check(JSON.stringify(freshCalendar) === JSON.stringify(beforeCalendar), 'Fresh login must read unchanged persisted habit history');
  console.log('PASS retention: all six restarted, same named volumes, unchanged env 0600; old cookie/session/habit/calendar retained; fresh login with original credentials reads the same data');

  await request(habitPath, 204, { method: 'DELETE', cookie: newCookie });
  await request(habitPath, 404, { cookie: newCookie });
  for (const cookie of [oldCookie, newCookie]) {
    const logout = await request('/api/auth/logout', 204, { method: 'POST', cookie });
    check(logout.response.headers.getSetCookie().some(value => {
      const expires = value.match(/;\s*Expires=([^;]+)/i)?.[1];
      return value.startsWith('ritm_session=;') && (/Max-Age=0/i.test(value) || (expires && Date.parse(expires) < Date.now())) && /HttpOnly/i.test(value) && /SameSite=Lax/i.test(value) && /Path=\//i.test(value);
    }), 'Logout must expire the session cookie with its original attributes');
    await request('/api/auth/session', 401, { cookie });
    await request('/api/habits', 401, { cookie });
  }
  await assertHealthy();
  await request('/health', 200);
  console.log(`PASS cleanup: only this fixture habit deleted; both fixture sessions revoked; stack remains healthy. ${checks} assertions passed. Synthetic credentials and cookies stayed only in process memory.`);
}

main().catch(error => {
  console.error(error instanceof assert.AssertionError ? `FAIL: ${error.message}` : 'FAIL: local persistence smoke did not complete; inspect readiness and rerun. Credentials and cookie values are intentionally omitted.');
  process.exitCode = 1;
});
