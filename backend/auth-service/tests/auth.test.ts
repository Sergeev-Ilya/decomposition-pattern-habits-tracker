import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app';
import { createPool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { loadConfig } from '../src/config';
import { SESSION_SECONDS } from '../src/security';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a separate disposable *_test database');
const pool = createPool(databaseUrl);
const config = { appOrigin: 'http://localhost:8880', jwtSecret: 'test-signing-key-'.repeat(4), internalServiceKey: 'test-internal-key-'.repeat(4), cookieSecure: false };
let instant = new Date('2026-10-29T10:00:00.000Z');
const app = createApp({ pool, config, clock: () => instant });
const registration = { email: 'Reader@Example.com', password: ' test passphrase ', timeZone: 'Europe/Moscow' };
const post = (path: string) => request(app).post(path).set('Origin', config.appOrigin);
async function register() { return post('/api/auth/register').send(registration).expect(201); }
async function login() { return post('/api/auth/login').send({ email: registration.email, password: registration.password }).expect(200); }
const cookie = (response: { headers: Record<string, any> }): string => response.headers['set-cookie'][0].split(';')[0];

beforeAll(async () => { await migrate(pool); });
beforeEach(async () => { instant = new Date('2026-10-29T10:00:00.000Z'); await pool.query('TRUNCATE users CASCADE'); });
afterAll(async () => { await pool.end(); });

describe('auth-service HTTP and PostgreSQL integration', () => {
  it('checks real database readiness and request ID', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', service: 'auth-service' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const supplied = '5744398b-ee4e-401a-a9fd-3c60cfe3bb4f';
    expect((await request(app).get('/health').set('X-Request-Id', supplied)).headers['x-request-id']).toBe(supplied);
  });
  it('registers normalized email with salted scrypt, without logging in', async () => {
    const response = await register();
    expect(response.body.user.email).toBe('reader@example.com');
    expect(response.body.user.timeZone).toBe('Europe/Moscow');
    expect(response.body.user).not.toHaveProperty('password');
    expect(response.headers['set-cookie']).toBeUndefined();
    const stored = (await pool.query('SELECT password_hash FROM users')).rows[0].password_hash;
    expect(stored).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect(stored).not.toContain(registration.password);
    await request(app).get('/api/auth/session').expect(401);
  });
  it('rejects duplicate normalized email through its SQL uniqueness constraint', async () => {
    await register();
    const result = await post('/api/auth/register').send({ ...registration, email: ' reader@example.com ' }).expect(409);
    expect(result.body.error.code).toBe('EMAIL_TAKEN');
    expect(Number((await pool.query('SELECT count(*) FROM users')).rows[0].count)).toBe(1);
  });
  it('rejects invalid fields, time zones, and too-short registration passwords', async () => {
    for (const data of [{ ...registration, timeZone: 'Imaginary/Zone' }, { ...registration, timeZone: '+03:00' }, { ...registration, extra: true }, { ...registration, password: '1234567' }]) {
      expect((await post('/api/auth/register').send(data).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await pool.query('SELECT * FROM users')).rowCount).toBe(0);
  });
  it('rejects control characters in email before database access for registration and login', async () => {
    for (const character of ['\u0000', '\u0001', '\u007f']) {
      const email = `reader${character}@example.com`;
      const created = await post('/api/auth/register').send({ ...registration, email }).expect(400);
      expect(created.body.error.code).toBe('VALIDATION_ERROR');
      const entered = await post('/api/auth/login').send({ email, password: registration.password }).expect(400);
      expect(entered.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await pool.query('SELECT count(*) FROM users')).rows[0].count).toBe('0');
  });
  it('enforces Origin, JSON content type, valid JSON and size limits', async () => {
    await request(app).post('/api/auth/register').send(registration).expect(403);
    await request(app).post('/api/auth/register').set('Origin', 'https://other.test').send(registration).expect(403);
    await post('/api/auth/register').type('text').send('hello').expect(415);
    await post('/api/auth/register').type('json').send('{bad').expect(400);
    await post('/api/auth/register').send({ ...registration, password: 'x'.repeat(17000) }).expect(413);
  });
  it('issues a seven-day HttpOnly session cookie and verifies its persisted session', async () => {
    await register(); const response = await login();
    const header = response.headers['set-cookie'][0];
    expect(header).toContain('HttpOnly'); expect(header).toContain('SameSite=Lax'); expect(header).toContain('Path=/');
    expect(header).toContain(`Max-Age=${SESSION_SECONDS}`); expect(header).not.toContain('Domain='); expect(header).not.toContain('Secure');
    expect(response.body).not.toHaveProperty('token');
    expect(new Date(response.body.expiresAt).getTime() - instant.getTime()).toBe(SESSION_SECONDS * 1000);
    const profile = await request(app).get('/api/auth/session').set('Cookie', cookie(response)).expect(200);
    expect(profile.body.user.id).toBe(response.body.user.id);
    expect(profile.headers['cache-control']).toBe('no-store');
  });
  it('uses the same error for unknown email and wrong password without trimming password', async () => {
    await register();
    const wrong = await post('/api/auth/login').send({ email: registration.email, password: registration.password.trim() }).expect(401);
    const unknown = await post('/api/auth/login').send({ email: 'unknown@example.com', password: 'anything' }).expect(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });
  it('rejects tampered and duplicate session cookies', async () => {
    await register(); const response = await login(); const value = cookie(response);
    await request(app).get('/api/auth/session').set('Cookie', value.slice(0, -2) + 'xx').expect(401);
    await request(app).get('/api/auth/session').set('Cookie', `${value}; ${value}`).expect(401);
    await post('/api/auth/logout').set('Cookie', `${value}; ${value}`).expect(400);
  });
  it('requires service key before internally verifying a token', async () => {
    await register(); const response = await login(); const token = cookie(response).slice('ritm_session='.length);
    await request(app).post('/internal/sessions/verify').send({ token }).expect(403);
    const verified = await request(app).post('/internal/sessions/verify').set('X-Service-Key', config.internalServiceKey).send({ token }).expect(200);
    expect(verified.body.userId).toBe(response.body.user.id); expect(verified.body.timeZone).toBe('Europe/Moscow');
    expect(verified.body).not.toHaveProperty('email');
    await request(app).post('/internal/sessions/verify').set('X-Service-Key', config.internalServiceKey).send({ token: 'bad' }).expect(401);
  });
  it('revokes the current session before logout, rejecting replay while preserving another session', async () => {
    await register(); const first = await login(); const second = await login();
    const result = await post('/api/auth/logout').set('Cookie', cookie(first)).expect(204);
    expect(result.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
    await request(app).get('/api/auth/session').set('Cookie', cookie(first)).expect(401);
    await request(app).get('/api/auth/session').set('Cookie', cookie(second)).expect(200);
    await post('/api/auth/logout').set('Cookie', cookie(first)).expect(204);
    await post('/api/auth/logout').expect(204);
  });
  it('expires sessions according to injected server time', async () => {
    await register(); const response = await login();
    instant = new Date(instant.getTime() + SESSION_SECONDS * 1000);
    await request(app).get('/api/auth/session').set('Cookie', cookie(response)).expect(401);
  });
  it('returns 503 for database failure, including logout instead of false success', async () => {
    await register(); const response = await login();
    const brokenPool = { query: async () => { throw new Error('private database details'); } } as unknown as Pool;
    const broken = createApp({ pool: brokenPool, config, clock: () => instant });
    await request(broken).get('/health').expect(503);
    const failed = await request(broken).post('/api/auth/logout').set('Origin', config.appOrigin).set('Cookie', cookie(response)).expect(503);
    expect(JSON.stringify(failed.body)).not.toContain('private database details');
    expect(failed.headers['set-cookie']).toBeUndefined();
  });
  it('reapplies migrations without dropping existing accounts', async () => {
    const response = await register(); await migrate(pool);
    expect((await pool.query('SELECT id FROM users')).rows[0].id).toBe(response.body.user.id);
  });
  it('refuses missing secrets and insecure cookies for a nonlocal origin', () => {
    expect(() => loadConfig({})).toThrow();
    expect(() => loadConfig({ APP_ORIGIN: config.appOrigin, JWT_SECRET: 'REPLACE_WITH_RANDOM_SECRET_AT_LEAST_32_BYTES', INTERNAL_SERVICE_KEY: config.internalServiceKey, COOKIE_SECURE: 'false', DATABASE_URL: databaseUrl })).toThrow();
    expect(() => loadConfig({ APP_ORIGIN: 'http://example.com', JWT_SECRET: config.jwtSecret, INTERNAL_SERVICE_KEY: config.internalServiceKey, COOKIE_SECURE: 'false', DATABASE_URL: databaseUrl })).toThrow();
  });
});
