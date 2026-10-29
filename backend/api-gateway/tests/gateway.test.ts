import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import http, { type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';

type Handler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => void;
type Capture = { service: string; path: string; method: string; headers: http.IncomingHttpHeaders; body: Buffer };
const servers: Server[] = []; const urls: Record<string, string> = {}; const captures: Capture[] = [];
const handlers: Record<string, Handler | undefined> = {};
const origin = 'http://localhost:8880';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function respond(res: ServerResponse, body: unknown, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
function app() { return createApp({ appOrigin: origin, authServiceUrl: urls['auth-service'], habitsServiceUrl: urls['habits-service'] }); }

beforeAll(async () => {
  for (const service of ['auth-service', 'habits-service']) {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks); captures.push({ service, path: req.url!, method: req.method!, headers: req.headers, body });
        const handler = handlers[service];
        if (handler) handler(req, res, body);
        else if (req.url === '/health') respond(res, { status: 'ok', service });
        else if (req.method === 'DELETE' || req.url === '/api/auth/logout') { res.writeHead(204); res.end(); }
        else respond(res, { path: req.url, method: req.method }, req.method === 'POST' && ['/api/habits', '/api/auth/register'].includes(req.url!) ? 201 : 200);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    urls[service] = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
});
beforeEach(() => { captures.length = 0; delete handlers['auth-service']; delete handlers['habits-service']; });
afterAll(async () => { for (const server of servers) { server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); } });

describe('Gateway readiness and route boundary', () => {
  it('checks both exact upstream services before readiness succeeds', async () => {
    const res = await request(app()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'api-gateway', upstreams: { 'auth-service': 'ok', 'habits-service': 'ok' } });
    expect(captures.map(c => c.service).sort()).toEqual(['auth-service', 'habits-service']);
    expect(res.headers['x-request-id']).toMatch(uuid);
  });
  it('fails readiness when an upstream reports the wrong service', async () => {
    handlers['auth-service'] = (_req, res) => respond(res, { status: 'ok', service: 'another-service' });
    const res = await request(app()).get('/health').expect(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
  it.each(['/internal/sessions/verify', '/api/auth/me', '/api/habitsx', '/api/auth/session/extra', '/api/unknown'])('never proxies nonpublic path %s', async path => {
    const res = await request(app()).get(path).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND'); expect(captures).toHaveLength(0);
  });
  it('unknown method is a JSON 404 without contacting upstream', async () => {
    await request(app()).patch('/api/auth/login').set('Origin', origin).send({}).expect(404);
    expect(captures).toHaveLength(0);
  });
  it.each([
    ['post', '/api/auth/register', 201], ['post', '/api/auth/login', 200], ['post', '/api/auth/logout', 204], ['get', '/api/auth/session', 200],
    ['get', '/api/habits', 200], ['post', '/api/habits', 201], ['get', '/api/habits/id', 200], ['patch', '/api/habits/id', 200],
    ['delete', '/api/habits/id', 204], ['get', '/api/habits/id/calendar?month=2026-09', 200], ['put', '/api/habits/id/completions/2026-10-29', 200],
  ] as const)('routes %s %s to its service', async (method, path, expected) => {
    const client = request(app()); const call = client[method](path).set('Origin', origin);
    const res = await call.expect(expected);
    const captured = captures[0]; expect(captured.path).toBe(path);
    expect(captured.service).toBe(path.startsWith('/api/auth/') ? 'auth-service' : 'habits-service');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
describe('Gateway browser request contract', () => {
  it.each([undefined, 'null', 'http://evil.example'])('rejects missing/foreign Origin %s before proxy', async value => {
    const call = request(app()).post('/api/auth/login'); if (value) call.set('Origin', value);
    const res = await call.send({ email: 'a@example.com' }).expect(403);
    expect(res.body.error.code).toBe('ORIGIN_FORBIDDEN'); expect(captures).toHaveLength(0);
  });
  it('preserves UTF-8 JSON bytes and query, replaces request ID and strips identity headers', async () => {
    const raw = '  {"name" : "Привычка"}\n';
    const res = await request(app()).post('/api/habits?test=a%2Bb').set('Origin', origin).set('Content-Type', 'application/json')
      .set('Cookie', 'ritm_session=fake-cookie').set('X-Request-Id', 'client-supplied').set('X-User-Id', 'attacker')
      .set('X-Service-Key', 'attacker').set('Authorization', 'Bearer attacker').send(raw).expect(200);
    const received = captures[0]; expect(received.body.toString('utf8')).toBe(raw); expect(received.path).toBe('/api/habits?test=a%2Bb');
    expect(Number(received.headers['content-length'])).toBe(Buffer.byteLength(raw));
    expect(received.headers.cookie).toBe('ritm_session=fake-cookie'); expect(received.headers.origin).toBe(origin);
    expect(received.headers['x-request-id']).toBe(res.headers['x-request-id']); expect(received.headers['x-request-id']).toMatch(uuid);
    for (const header of ['authorization', 'x-user-id', 'x-service-key', 'transfer-encoding']) expect(received.headers[header]).toBeUndefined();
  });
  it('rejects malformed JSON without forwarding it', async () => {
    const res = await request(app()).post('/api/habits').set('Origin', origin).set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR'); expect(captures).toHaveLength(0);
  });
  it('limits decoded JSON body to 16 KiB', async () => {
    const res = await request(app()).post('/api/habits').set('Origin', origin).send({ name: 'x'.repeat(17000) }).expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE'); expect(captures).toHaveLength(0);
  });
  it('rejects a non-JSON body', async () => {
    await request(app()).post('/api/habits').set('Origin', origin).set('Content-Type', 'text/plain').send('hello').expect(415);
    expect(captures).toHaveLength(0);
  });
});
describe('Gateway upstream behavior', () => {
  it('preserves separate Set-Cookie values and body', async () => {
    handlers['auth-service'] = (_req, res) => { res.setHeader('Set-Cookie', ['ritm_session=first; HttpOnly; Path=/; SameSite=Lax', 'other=second; Path=/']); respond(res, { user: { id: 'fixture' } }); };
    const res = await request(app()).post('/api/auth/login').set('Origin', origin).send({}).expect(200);
    expect(res.headers['set-cookie']).toEqual(['ritm_session=first; HttpOnly; Path=/; SameSite=Lax', 'other=second; Path=/']);
    expect(res.body).toEqual({ user: { id: 'fixture' } });
  });
  it('preserves authorization failure and normalizes its request ID', async () => {
    handlers['habits-service'] = (_req, res) => respond(res, { error: { code: 'UNAUTHENTICATED', message: 'Войдите' }, requestId: 'untrusted' }, 401);
    const res = await request(app()).get('/api/habits').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED'); expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
  it.each(['html', 'invalid-json', 'invalid-error', 'redirect'])('rejects malformed upstream response %s', async mode => {
    handlers['habits-service'] = (_req, res) => {
      if (mode === 'redirect') { res.writeHead(302, { Location: 'http://evil.example' }); res.end(); }
      else if (mode === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html/>'); }
      else if (mode === 'invalid-json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{bad'); }
      else respond(res, { unexpected: true }, 401);
    };
    const res = await request(app()).get('/api/habits').expect(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE'); expect(captures).toHaveLength(1);
  });
  it('fails closed when upstream cannot be reached', async () => {
    const unavailableApp = createApp({ appOrigin: origin, authServiceUrl: 'http://127.0.0.1:1', habitsServiceUrl: 'http://127.0.0.1:1' });
    const res = await request(unavailableApp).get('/api/habits').expect(503);
    expect(res.body.requestId).toMatch(uuid);
  });
  it('applies readiness deadline to an unresponsive upstream', async () => {
    handlers['auth-service'] = () => {};
    await request(app()).get('/health').expect(503);
  });
  it('applies public upstream deadline without a retry', async () => {
    handlers['habits-service'] = () => {};
    await request(app()).get('/api/habits').expect(503);
    expect(captures).toHaveLength(1);
  });
  it('requires explicit trusted origin configuration', () => {
    expect(() => loadConfig({})).toThrow();
    expect(() => loadConfig({ APP_ORIGIN: origin, AUTH_SERVICE_URL: 'http://user:pass@host', HABITS_SERVICE_URL: urls['habits-service'] })).toThrow();
    expect(loadConfig({ APP_ORIGIN: origin, AUTH_SERVICE_URL: urls['auth-service'], HABITS_SERVICE_URL: urls['habits-service'] }).port).toBe(8080);
  });
});
