import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { migrate } from '../src/db/migrate';
import type { HabitsConfig } from '../src/config';
import { loadConfig } from '../src/config';
import { daysInMonth, isCalendarDate, shiftDay, todayInZone } from '../src/calendar';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required; use a disposable ritm_habits_test database');
const databaseUrl = new URL(connectionString);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.pathname !== '/ritm_habits_test') throw new Error('Refusing to run destructive fixtures outside local ritm_habits_test');
const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000 });
const userA = randomUUID(); const userB = randomUUID(); const sessionA = randomUUID(); const sessionB = randomUUID();
const jwtSecret = 'habits-tests-signing-secret-at-least-32-bytes';
const serviceKey = 'habits-tests-service-key-distinct-and-32-bytes';
const origin = 'http://localhost:8880';
let now = new Date('2026-10-29T12:00:00Z'); let timeZone = 'Europe/Moscow';
let authServer: Server; let config: HabitsConfig; let app: ReturnType<typeof createApp>;
let mode = 'ok'; let verificationCalls = 0; let serviceKeySeen = '';

function cookie(userId = userA, sessionId = userId === userA ? sessionA : sessionB) {
  const issuedAt = Math.floor(now.getTime() / 1000) - 10;
  const token = jwt.sign({ sub: userId, sid: sessionId, iat: issuedAt, exp: issuedAt + 604800 }, jwtSecret, { algorithm: 'HS256', issuer: 'ritm-auth', audience: 'ritm-app' });
  return `ritm_session=${token}`;
}
function client(userId = userA) { return request(app).get('/api/habits').set('Cookie', cookie(userId)); }
async function createHabit(name = 'Читать', userId = userA) {
  return request(app).post('/api/habits').set('Origin', origin).set('Cookie', cookie(userId)).send({ name, description: 'Описание' });
}
async function seedHabit(startDate: string, dates: string[] = [], userId = userA) {
  await pool.query('INSERT INTO habit_owners(id) VALUES($1) ON CONFLICT DO NOTHING', [userId]);
  const row = (await pool.query('INSERT INTO habits(user_id,name,description,start_date,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5) RETURNING id', [userId, 'История', 'Сохранённые данные', startDate, new Date(`${startDate}T10:00:00Z`)])).rows[0];
  for (const date of dates) await pool.query('INSERT INTO completions(habit_id,completed_on) VALUES($1,$2)', [row.id, date]);
  return row.id as string;
}
function setCompletion(id: string, date: string, completed: boolean, userId = userA) {
  return request(app).put(`/api/habits/${id}/completions/${date}`).set('Origin', origin).set('Cookie', cookie(userId)).send({ completed });
}
function getCalendar(id: string, month?: string) { return request(app).get(`/api/habits/${id}/calendar${month === undefined ? '' : `?month=${encodeURIComponent(month)}`}`).set('Cookie', cookie()); }

beforeAll(async () => {
  await migrate(pool); await migrate(pool);
  authServer = createServer(async (req, res) => {
    verificationCalls++; serviceKeySeen = String(req.headers['x-service-key'] || '');
    if (req.url !== '/internal/sessions/verify' || req.method !== 'POST' || serviceKeySeen !== serviceKey) { res.writeHead(403).end(); return; }
    let body = ''; for await (const chunk of req) body += String(chunk);
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'revoked') { res.writeHead(401).end('{}'); return; }
    if (mode === 'unavailable') { res.writeHead(503).end('{}'); return; }
    if (mode === 'forbidden') { res.writeHead(403).end('{}'); return; }
    if (mode === 'malformed') { res.end('{not json'); return; }
    try {
      const token = JSON.parse(body).token;
      const claims = jwt.verify(token, jwtSecret, { algorithms: ['HS256'], issuer: 'ritm-auth', audience: 'ritm-app', clockTimestamp: Math.floor(now.getTime() / 1000) }) as jwt.JwtPayload;
      res.end(JSON.stringify({ userId: mode === 'wrong-user' ? userB : claims.sub, sessionId: mode === 'wrong-session' ? randomUUID() : claims.sid,
        timeZone: mode === 'bad-zone' ? 'not/a-zone' : timeZone, expiresAt: new Date(now.getTime() + (mode === 'expired' ? -1000 : 604800000)).toISOString() }));
    } catch { res.writeHead(401).end('{}'); }
  });
  await new Promise<void>(resolve => authServer.listen(0, '127.0.0.1', resolve));
  const address = authServer.address(); if (!address || typeof address === 'string') throw new Error('Test auth server did not bind');
  config = { appOrigin: origin, jwtSecret, internalServiceKey: serviceKey, authServiceUrl: `http://127.0.0.1:${address.port}` };
  app = createApp({ pool, config, clock: () => new Date(now) });
});
beforeEach(async () => {
  await pool.query('TRUNCATE completions,habits,habit_owners');
  now = new Date('2026-10-29T12:00:00Z'); timeZone = 'Europe/Moscow'; mode = 'ok'; verificationCalls = 0;
});
afterAll(async () => { await pool.end(); if (authServer) { authServer.closeAllConnections(); await new Promise<void>(resolve => authServer.close(() => resolve())); } });

describe('habits-service contracts against PostgreSQL', () => {
  it('runs migrations idempotently, serves readiness and empty owner data', async () => {
    expect((await request(app).get('/health')).body).toEqual({ status: 'ok', service: 'habits-service' });
    const result = await client();
    expect(result.status).toBe(200); expect(result.body).toEqual({ habits: [], today: '2026-10-29', timeZone, limit: 25 });
    expect(serviceKeySeen).toBe(serviceKey); expect(verificationCalls).toBe(1);
    expect(result.headers['cache-control']).toBe('no-store'); expect(result.headers['access-control-allow-origin']).toBeUndefined();
    const created = await createHabit(); await migrate(pool);
    expect((await client()).body.habits[0].id).toBe(created.body.habit.id);
  });
  it('creates canonical data and gets/patches only editable text fields', async () => {
    const created = await request(app).post('/api/habits').set('Origin', origin).set('Cookie', cookie()).send({ name: '  Читать  ', description: '  Вечером  ' });
    expect(created.status).toBe(201); const id = created.body.habit.id;
    expect(created.headers.location).toBe(`/api/habits/${id}`);
    expect(created.body.habit).toMatchObject({ name: 'Читать', description: 'Вечером', startDate: '2026-10-29', currentStreak: 0, todayCompleted: false, recentCompletedDates: [] });
    const read = await request(app).get(`/api/habits/${id}`).set('Cookie', cookie()); expect(read.body.habit.id).toBe(id);
    const edited = await request(app).patch(`/api/habits/${id}`).set('Origin', origin).set('Cookie', cookie()).send({ name: 'Новое название', description: '' });
    expect(edited.status).toBe(200); expect(edited.body.habit).toMatchObject({ name: 'Новое название', description: '', startDate: '2026-10-29', createdAt: created.body.habit.createdAt });
    expect(Object.keys(edited.body.habit).sort()).toEqual(['id', 'name', 'description', 'startDate', 'createdAt', 'updatedAt', 'currentStreak', 'todayCompleted', 'recentCompletedDates'].sort());
  });
  it('creates the first owner safely under concurrent requests', async () => {
    const results = await Promise.all([createHabit('Первый'), createHabit('Второй')]);
    expect(results.map(result => result.status)).toEqual([201, 201]); expect((await client()).body.habits).toHaveLength(2);
  });
  it('serializes the 25-habit limit and frees the slot on deletion', async () => {
    await seedHabit('2026-10-01');
    await pool.query("INSERT INTO habits(user_id,name,start_date) SELECT $1,'Привычка '||n,'2026-10-01'::date FROM generate_series(1,23) n", [userA]);
    const results = await Promise.all([createHabit('Двадцать пятая'), createHabit('Конкурирующая')]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(results.find(result => result.status === 409)!.body.error.code).toBe('HABIT_LIMIT_REACHED');
    const habits = (await client()).body.habits; expect(habits).toHaveLength(25);
    expect((await createHabit('Другой владелец', userB)).status).toBe(201);
    expect((await request(app).delete(`/api/habits/${habits[0].id}`).set('Origin', origin).set('Cookie', cookie())).status).toBe(204);
    expect((await createHabit('Свободное место')).status).toBe(201);
  });
  it('sets desired completion state idempotently and does not update timestamps for no-ops', async () => {
    const id = await seedHabit('2026-10-01');
    const first = await setCompletion(id, '2026-10-29', true); expect(first.status).toBe(200); expect(first.body.habit.currentStreak).toBe(1);
    now = new Date('2026-10-29T12:01:00Z');
    const repeated = await setCompletion(id, '2026-10-29', true); expect(repeated.body.habit.updatedAt).toBe(first.body.habit.updatedAt);
    expect((await pool.query('SELECT count(*) FROM completions WHERE habit_id=$1', [id])).rows[0].count).toBe('1');
    const unset = await setCompletion(id, '2026-10-29', false); expect(unset.body.habit.todayCompleted).toBe(false);
    now = new Date('2026-10-29T12:02:00Z');
    expect((await setCompletion(id, '2026-10-29', false)).body.habit.updatedAt).toBe(unset.body.habit.updatedAt);
    expect((await pool.query('SELECT count(*) FROM completions WHERE habit_id=$1', [id])).rows[0].count).toBe('0');
  });
  it('allows D-7 and today but rejects D-8, future, creation-preceding and impossible dates', async () => {
    const id = await seedHabit('2026-10-01');
    expect((await setCompletion(id, '2026-10-22', true)).status).toBe(200);
    expect((await setCompletion(id, '2026-10-29', true)).status).toBe(200);
    for (const date of ['2026-10-21', '2026-10-30']) expect((await setCompletion(id, date, false)).body.error.code).toBe('DATE_NOT_EDITABLE');
    for (const date of ['2026-02-30', '2026-2-01', '0000-01-01']) expect((await setCompletion(id, date, true)).body.error.code).toBe('VALIDATION_ERROR');
    const fresh = (await createHabit()).body.habit.id;
    expect((await setCompletion(fresh, '2026-10-28', true)).body.error.code).toBe('DATE_NOT_EDITABLE');
  });
  it('calculates current streak from today or yesterday and repairs a gap', async () => {
    const id = await seedHabit('2026-10-01', ['2026-10-26', '2026-10-27', '2026-10-28']);
    expect((await getCalendar(id)).body.habit.currentStreak).toBe(3);
    expect((await setCompletion(id, '2026-10-29', true)).body.habit.currentStreak).toBe(4);
    expect((await setCompletion(id, '2026-10-28', false)).body.habit.currentStreak).toBe(1);
    expect((await setCompletion(id, '2026-10-28', true)).body.habit.currentStreak).toBe(4);
    await setCompletion(id, '2026-10-29', false); await setCompletion(id, '2026-10-28', false);
    expect((await getCalendar(id)).body.habit.currentStreak).toBe(0);
  });
  it('keeps full-month denominator and bounded recent dates, while retaining old history', async () => {
    const id = await seedHabit('2026-09-01', ['2026-09-01', '2026-09-30', '2026-10-01', '2026-10-27', '2026-10-28', '2026-10-29']);
    const calendar = (await getCalendar(id, '2026-10')).body;
    expect(calendar.completedDates).toEqual(['2026-10-01', '2026-10-27', '2026-10-28', '2026-10-29']);
    expect(calendar.daysInMonth).toBe(31); expect(calendar.completionPercent).toBeCloseTo(4 / 31 * 100, 12);
    expect(calendar.habit.recentCompletedDates).toEqual(['2026-10-27', '2026-10-28', '2026-10-29']);
    const old = (await getCalendar(id, '2026-09')).body;
    expect(old.completedDates).toEqual(['2026-09-01', '2026-09-30']); expect(old.daysInMonth).toBe(30); expect(old.habit.currentStreak).toBe(3);
    expect((await getCalendar(id, '2026-11')).body.error.code).toBe('MONTH_OUT_OF_RANGE');
    expect((await getCalendar(id, '2026-08')).body.error.code).toBe('MONTH_OUT_OF_RANGE');
    expect((await getCalendar(id, '2026-13')).body.error.code).toBe('VALIDATION_ERROR');
    const midMonth = await seedHabit('2026-10-20', ['2026-10-27', '2026-10-28', '2026-10-29']);
    expect((await getCalendar(midMonth)).body).toMatchObject({ completedCount: 3, daysInMonth: 31, completionPercent: 3 / 31 * 100 });
  });
  it('handles leap February and an editable date in the previous month', async () => {
    now = new Date('2024-03-01T12:00:00Z'); timeZone = 'UTC';
    const id = await seedHabit('2024-02-01', ['2024-02-27', '2024-02-28']);
    expect((await setCompletion(id, '2024-02-29', true)).body.habit.currentStreak).toBe(3);
    const february = (await getCalendar(id, '2024-02')).body;
    expect(february).toMatchObject({ completedCount: 3, daysInMonth: 29, completionPercent: 3 / 29 * 100, editableFrom: '2024-02-23', editableTo: '2024-03-01' });
    expect((await getCalendar(id)).body.daysInMonth).toBe(31);
    expect((await setCompletion(id, '2024-02-30', true)).body.error.code).toBe('VALIDATION_ERROR');
  });
  it('counts a streak across year boundaries', async () => {
    now = new Date('2026-01-02T12:00:00Z'); timeZone = 'UTC';
    const id = await seedHabit('2025-12-01', ['2025-12-30', '2025-12-31', '2026-01-01']);
    expect((await getCalendar(id, '2025-12')).body.habit.currentStreak).toBe(3);
    expect((await setCompletion(id, '2026-01-02', true)).body.habit.currentStreak).toBe(4);
  });
  it('uses the confirmed time zone and calendar dates through DST', async () => {
    now = new Date('2026-03-29T22:30:00Z'); timeZone = 'Europe/Berlin';
    const id = await seedHabit('2026-03-01');
    expect((await getCalendar(id)).body).toMatchObject({ today: '2026-03-30', editableFrom: '2026-03-23' });
    expect((await setCompletion(id, '2026-03-23', true)).status).toBe(200);
    expect((await setCompletion(id, '2026-03-22', true)).body.error.code).toBe('DATE_NOT_EDITABLE');
    expect(todayInZone(new Date('2026-03-29T00:30:00Z'), timeZone)).toBe('2026-03-29');
  });
  it('recomputes today after waiting for the habit row lock', async () => {
    now = new Date('2026-10-29T23:59:59Z'); timeZone = 'UTC'; const id = await seedHabit('2026-10-01');
    const blocker = await pool.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM habits WHERE id=$1 FOR UPDATE', [id]);
    const pending = setCompletion(id, '2026-10-22', true).then(result => result);
    try {
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const result = await pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id,user_id,name,description,start_date::text%'");
        if (Number(result.rows[0].count) > 0) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true); now = new Date('2026-10-30T00:00:00Z'); await blocker.query('COMMIT');
      const result = await pending; expect(result.status).toBe(400); expect(result.body.error.code).toBe('DATE_NOT_EDITABLE');
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });
  it('preserves history on editing and cascades it on deletion', async () => {
    const id = await seedHabit('2026-10-01', ['2026-10-27', '2026-10-28']);
    const edited = await request(app).patch(`/api/habits/${id}`).set('Origin', origin).set('Cookie', cookie()).send({ description: 'Изменено' });
    expect(edited.status).toBe(200); expect((await getCalendar(id)).body.completedCount).toBe(2);
    expect((await request(app).delete(`/api/habits/${id}`).set('Origin', origin).set('Cookie', cookie())).status).toBe(204);
    expect((await pool.query('SELECT count(*) FROM completions WHERE habit_id=$1', [id])).rows[0].count).toBe('0');
    expect((await getCalendar(id)).body.error.code).toBe('HABIT_NOT_FOUND');
    expect((await request(app).delete(`/api/habits/${id}`).set('Origin', origin).set('Cookie', cookie())).status).toBe(404);
  });
  it('does not reveal or mutate another owner data, including spoofed identity headers', async () => {
    const id = await seedHabit('2026-10-01', ['2026-10-29']);
    expect((await client(userB)).body.habits).toEqual([]);
    const foreign = await request(app).get(`/api/habits/${id}`).set('Cookie', cookie(userB)).set('X-User-Id', userA).set('X-User-TimeZone', 'UTC');
    const unknown = await request(app).get(`/api/habits/${randomUUID()}`).set('Cookie', cookie(userB));
    expect(foreign.status).toBe(404); expect(foreign.body.error).toEqual(unknown.body.error);
    expect((await setCompletion(id, '2026-10-29', false, userB)).status).toBe(404);
    expect((await request(app).patch(`/api/habits/${id}`).set('Origin', origin).set('Cookie', cookie(userB)).send({ name: 'Чужое' })).status).toBe(404);
    expect((await request(app).delete(`/api/habits/${id}`).set('Origin', origin).set('Cookie', cookie(userB))).status).toBe(404);
  });
  it('validates text, Unicode code points, immutable fields and completion body types', async () => {
    for (const body of [{ name: '' }, { name: ' ' }, { name: null }, { name: 'a\0b' }, { name: 'x'.repeat(121) }, { name: 'ok', description: null }, { name: 'ok', description: 'x'.repeat(2001) }, { name: 'ok', userId: userB }, { name: 'ok', startDate: '2020-01-01' }, { name: 'ok', today: '2020-01-01' }]) {
      const result = await request(app).post('/api/habits').set('Origin', origin).set('Cookie', cookie()).send(body); expect(result.status).toBe(400); expect(result.body.error.code).toBe('VALIDATION_ERROR');
    }
    const unicode = await createHabit('🫖'.repeat(120)); expect(unicode.status).toBe(201);
    const id = unicode.body.habit.id;
    expect((await request(app).patch(`/api/habits/${id}`).set('Origin', origin).set('Cookie', cookie()).send({})).status).toBe(400);
    expect((await request(app).put(`/api/habits/${id}/completions/2026-10-29`).set('Origin', origin).set('Cookie', cookie()).send({ completed: 'true' })).status).toBe(400);
    expect((await request(app).get('/api/habits/not-a-uuid').set('Cookie', cookie())).status).toBe(400);
  });
  it('rejects missing, duplicated, expired and forged JWT before consulting auth', async () => {
    const valid = cookie(); const calls = verificationCalls;
    for (const header of ['', `${valid}; ${valid}`, 'ritm_session=broken']) expect((await request(app).get('/api/habits').set('Cookie', header)).status).toBe(401);
    const expired = jwt.sign({ sub: userA, sid: sessionA, iat: 1, exp: 2 }, jwtSecret, { algorithm: 'HS256', issuer: 'ritm-auth', audience: 'ritm-app' });
    expect((await request(app).get('/api/habits').set('Cookie', `ritm_session=${expired}`)).status).toBe(401);
    expect(verificationCalls).toBe(calls);
  });
  it('checks active session on every request and propagates confirmed revocation', async () => {
    expect((await client()).status).toBe(200); expect((await client()).status).toBe(200); expect(verificationCalls).toBe(2);
    mode = 'revoked'; expect((await client()).status).toBe(401); expect(verificationCalls).toBe(3);
  });
  it.each(['unavailable', 'forbidden', 'malformed', 'wrong-user', 'wrong-session', 'bad-zone', 'expired'])('fails closed when internal verification is %s', async failure => {
    mode = failure; const result = await client(); expect(result.status).toBe(503); expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
  it('rejects wrong Origin, content type, oversized and malformed JSON and returns safe request IDs', async () => {
    expect((await request(app).post('/api/habits').set('Cookie', cookie()).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).post('/api/habits').set('Origin', 'http://other.test').set('Cookie', cookie()).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).post('/api/habits').set('Origin', origin).set('Cookie', cookie()).type('text').send('name=x')).status).toBe(415);
    expect((await request(app).post('/api/habits').set('Origin', origin).set('Cookie', cookie()).type('json').send('{bad')).status).toBe(400);
    expect((await request(app).post('/api/habits').set('Origin', origin).set('Cookie', cookie()).send({ name: 'x', description: 'a'.repeat(17000) })).status).toBe(413);
    const id = randomUUID(); const result = await request(app).get('/api/habits/bad').set('Cookie', cookie()).set('X-Request-Id', id);
    expect(result.body.requestId).toBe(id); expect(result.headers['x-request-id']).toBe(id);
  });
  it('returns 503 readiness when its database is unavailable', async () => {
    const unavailableApp = createApp({ pool: { query: async () => { throw new Error('private infrastructure detail'); } } as unknown as Pool, config });
    const result = await request(unavailableApp).get('/health'); expect(result.status).toBe(503); expect(JSON.stringify(result.body)).not.toContain('private infrastructure detail');
  });
  it('validates configuration and Gregorian dates without relying on host timezone', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true); expect(isCalendarDate('2026-02-29')).toBe(false); expect(isCalendarDate('0001-01-01')).toBe(true);
    expect(daysInMonth('2024-02')).toBe(29); expect(daysInMonth('2026-02')).toBe(28); expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    const valid = { DATABASE_URL: connectionString, APP_ORIGIN: origin, JWT_SECRET: jwtSecret, INTERNAL_SERVICE_KEY: serviceKey, AUTH_SERVICE_URL: config.authServiceUrl };
    expect(loadConfig(valid).port).toBe(3000); expect(() => loadConfig({ ...valid, JWT_SECRET: 'CHANGE_ME_long_placeholder_secret_123456789' })).toThrow();
    expect(() => loadConfig({ ...valid, INTERNAL_SERVICE_KEY: jwtSecret })).toThrow();
    expect(() => loadConfig({ ...valid, AUTH_SERVICE_URL: 'http://user:password@auth-service:3000/path' })).toThrow();
  });
});
