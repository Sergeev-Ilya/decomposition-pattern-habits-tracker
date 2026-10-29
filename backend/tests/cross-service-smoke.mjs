import { randomUUID } from 'node:crypto';

const baseUrl = process.env.SMOKE_BASE_URL || 'http://api-gateway:8080';
const appOrigin = process.env.SMOKE_APP_ORIGIN || 'http://localhost:8880';
let assertions = 0;
function check(condition, label) {
  if (!condition) throw new Error(`FAIL ${label}`);
  assertions += 1;
  console.log(`PASS ${label}`);
}
async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const requestHeaders = { Accept: 'application/json', ...headers };
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) requestHeaders.Origin = appOrigin;
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (cookie) requestHeaders.Cookie = cookie;
  const response = await fetch(new URL(path, baseUrl), {
    method, headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  const text = await response.text();
  return {
    status: response.status,
    data: text ? JSON.parse(text) : null,
    setCookie: response.headers.getSetCookie(),
    requestId: response.headers.get('X-Request-Id'),
  };
}
function status(response, expected, label) { check(response.status === expected, `${label}: HTTP ${expected}`); }
const sessionCookie = response => response.setCookie.find(value => value.startsWith('ritm_session='))?.split(';')[0];
async function account() {
  const credentials = { email: `smoke-${randomUUID()}@example.test`, password: randomUUID(), timeZone: 'Europe/Moscow' };
  const registered = await call('/api/auth/register', { method: 'POST', body: credentials });
  status(registered, 201, 'register account');
  check(registered.setCookie.length === 0, 'registration does not create a session');
  const loggedIn = await call('/api/auth/login', { method: 'POST', body: { email: credentials.email, password: credentials.password } });
  status(loggedIn, 200, 'login account');
  const cookie = sessionCookie(loggedIn);
  check(Boolean(cookie) && loggedIn.setCookie.some(value => value.includes('HttpOnly') && value.includes('SameSite=Lax') && value.includes('Path=/')), 'login issues an HttpOnly session cookie');
  check(!Object.hasOwn(loggedIn.data, 'token'), 'JWT is absent from JSON');
  return { cookie, user: loggedIn.data.user };
}

async function main() {
  const health = await call('/health');
  status(health, 200, 'gateway readiness');
  check(health.data.upstreams?.['auth-service'] === 'ok' && health.data.upstreams?.['habits-service'] === 'ok', 'both domain services are ready');
  status(await call('/api/auth/session'), 401, 'anonymous session');
  status(await call('/api/habits'), 401, 'anonymous habits');
  status(await call('/internal/sessions/verify', { method: 'POST', body: {} }), 404, 'internal verifier is not public');

  const owner = await account();
  const profile = await call('/api/auth/session', { cookie: owner.cookie });
  status(profile, 200, 'restore persisted session');
  check(profile.data.user.id === owner.user.id && profile.data.user.timeZone === 'Europe/Moscow', 'restored profile belongs to the signed-in owner');
  const empty = await call('/api/habits', { cookie: owner.cookie });
  status(empty, 200, 'list new account habits');
  check(empty.data.habits.length === 0 && empty.data.limit === 25, 'new account starts empty with the agreed limit');

  const created = await call('/api/habits', { method: 'POST', cookie: owner.cookie, body: { name: 'Smoke: ежедневное чтение', description: 'Изолированный сценарий проверки API' } });
  status(created, 201, 'create habit');
  const id = created.data.habit.id;
  const date = created.data.today;
  check(created.data.habit.startDate === date && created.data.habit.currentStreak === 0, 'creation uses server date and an empty history');
  const set = await call(`/api/habits/${id}/completions/${date}`, { method: 'PUT', cookie: owner.cookie, body: { completed: true } });
  status(set, 200, 'set completion');
  check(set.data.completed === true && set.data.habit.currentStreak === 1, 'completion updates authoritative streak');
  const repeated = await call(`/api/habits/${id}/completions/${date}`, { method: 'PUT', cookie: owner.cookie, body: { completed: true } });
  status(repeated, 200, 'repeat desired completion');
  check(repeated.data.habit.currentStreak === 1 && repeated.data.habit.updatedAt === set.data.habit.updatedAt, 'repeated completion is an unchanged idempotent write');

  const calendarPath = `/api/habits/${id}/calendar?month=${date.slice(0, 7)}`;
  const calendar = await call(calendarPath, { cookie: owner.cookie });
  status(calendar, 200, 'read calendar');
  check(calendar.data.completedCount === 1 && calendar.data.completedDates.includes(date), 'calendar contains exactly the saved completion');
  check(Math.abs(calendar.data.completionPercent - 100 / calendar.data.daysInMonth) < 1e-9, 'monthly percentage uses every calendar day');
  const updated = await call(`/api/habits/${id}`, { method: 'PATCH', cookie: owner.cookie, body: { name: 'Smoke: обновлённое чтение', description: 'Описание изменено' } });
  status(updated, 200, 'edit habit');
  check(updated.data.habit.startDate === created.data.habit.startDate && updated.data.habit.currentStreak === 1, 'editing preserves start date and streak');
  const afterEdit = await call(calendarPath, { cookie: owner.cookie });
  check(afterEdit.data.completedCount === 1 && afterEdit.data.completedDates.includes(date), 'editing preserves history');

  const stranger = await account();
  status(await call(`/api/habits/${id}`, { cookie: stranger.cookie, headers: { 'X-User-Id': owner.user.id } }), 404, 'foreign habit stays private despite spoofed owner header');
  status(await call(calendarPath, { cookie: stranger.cookie }), 404, 'foreign history stays private');
  status(await call(`/api/habits/${id}`, { method: 'DELETE', cookie: owner.cookie }), 204, 'delete own habit');
  status(await call(`/api/habits/${id}`, { cookie: owner.cookie }), 404, 'deleted habit is unavailable');
  status(await call(calendarPath, { cookie: owner.cookie }), 404, 'deleted history is unavailable');
  const afterDelete = await call('/api/habits', { cookie: owner.cookie });
  check(afterDelete.data.habits.length === 0, 'deletion frees the habit slot');

  const logout = await call('/api/auth/logout', { method: 'POST', cookie: owner.cookie });
  status(logout, 204, 'logout owner');
  check(logout.setCookie.some(value => value.startsWith('ritm_session=;')), 'logout clears browser cookie');
  status(await call('/api/auth/session', { cookie: owner.cookie }), 401, 'copied token cannot restore revoked session');
  status(await call('/api/habits', { cookie: owner.cookie }), 401, 'habits service rejects revoked token through real auth verification');
  status(await call('/api/auth/logout', { method: 'POST', cookie: stranger.cookie }), 204, 'logout second fixture account');
  console.log(`Cross-service smoke: ${assertions} assertions passed. No tokens, passwords or fixture emails were logged.`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Cross-service smoke failed'); process.exitCode = 1; });
