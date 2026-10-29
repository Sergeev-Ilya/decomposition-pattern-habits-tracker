import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import type { GatewayConfig } from './config';

class Failure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const unavailable = () => new Failure(503, 'SERVICE_UNAVAILABLE', 'Сервис временно недоступен');
const allowed = [
  ['POST', /^\/api\/auth\/(register|login|logout)$/], ['GET', /^\/api\/auth\/session$/],
  ['GET|POST', /^\/api\/habits$/], ['GET|PATCH|DELETE', /^\/api\/habits\/[^/]+$/],
  ['GET', /^\/api\/habits\/[^/]+\/calendar$/], ['PUT', /^\/api\/habits\/[^/]+\/completions\/[^/]+$/],
] as const;
interface UpstreamResponse { status: number; headers: http.IncomingHttpHeaders; body: Buffer }

// Preserve path/query without URL dot-segment rewriting; the upstream origin is trusted config.
function send(upstream: string, path: string, method: string, headers: http.OutgoingHttpHeaders, body: Buffer, timeout: number): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(upstream); const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request({ protocol: target.protocol, hostname: target.hostname, port: target.port, path, method, headers }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) request.destroy(unavailable()); else chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode || 503, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    const deadline = setTimeout(() => request.destroy(unavailable()), timeout);
    deadline.unref();
    request.once('error', reject); request.once('close', () => clearTimeout(deadline));
    request.end(body);
  });
}
function json(response: UpstreamResponse): Record<string, unknown> {
  if (!response.headers['content-type']?.toLowerCase().includes('application/json')) throw unavailable();
  try {
    const parsed: unknown = JSON.parse(response.body.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw unavailable();
    return parsed as Record<string, unknown>;
  } catch { throw unavailable(); }
}
export function createApp(config: GatewayConfig): express.Application {
  const app = express(); app.disable('x-powered-by');
  app.use((_req, res, next) => { res.locals.requestId = randomUUID(); res.setHeader('X-Request-Id', res.locals.requestId); res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(helmet());
  app.use((req, _res, next) => {
    try {
      const health = req.method === 'GET' && req.path === '/health';
      if (!health && !allowed.some(([methods, path]) => methods.split('|').includes(req.method) && path.test(req.path))) throw new Failure(404, 'NOT_FOUND', 'Маршрут не найден');
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && req.get('Origin') !== config.appOrigin) throw new Failure(403, 'ORIGIN_FORBIDDEN', 'Запрос с этого адреса запрещён');
      const hasBody = Number(req.get('Content-Length') || 0) > 0 || !!req.get('Transfer-Encoding');
      if (hasBody && !req.is('application/json')) throw new Failure(415, 'UNSUPPORTED_MEDIA_TYPE', 'Ожидается application/json');
      const charset = req.get('Content-Type')?.match(/;\s*charset\s*=\s*"?([^;"\s]+)/i)?.[1]?.toLowerCase();
      if (hasBody && charset && !['utf-8', 'utf8'].includes(charset)) throw new Failure(415, 'UNSUPPORTED_MEDIA_TYPE', 'Неподдерживаемая кодировка');
      next();
    } catch (error) { next(error); }
  });
  app.use(express.raw({ type: () => true, limit: '16kb' }));
  const route = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
  app.get('/health', route(async (_req, res) => {
    try {
      await Promise.all(([['auth-service', config.authServiceUrl], ['habits-service', config.habitsServiceUrl]] as const).map(async ([service, url]) => {
        const response = await send(url, '/health', 'GET', { Accept: 'application/json', 'X-Request-Id': res.locals.requestId }, Buffer.alloc(0), 2000);
        const result = json(response);
        if (response.status !== 200 || result.status !== 'ok' || result.service !== service) throw unavailable();
      }));
      res.json({ status: 'ok', service: 'api-gateway', upstreams: { 'auth-service': 'ok', 'habits-service': 'ok' } });
    } catch { throw unavailable(); }
  }));
  app.use(route(async (req, res) => {
    const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (body.length) { try { JSON.parse(body.toString('utf8')); } catch { throw new Failure(400, 'VALIDATION_ERROR', 'Некорректный JSON'); } }
    const headers: http.OutgoingHttpHeaders = { Accept: 'application/json', 'X-Request-Id': res.locals.requestId };
    // Forward a small allow-list; never forward client identity or hop-by-hop headers.
    if (req.headers.cookie) headers.Cookie = req.headers.cookie;
    if (req.get('Origin')) headers.Origin = req.get('Origin');
    if (body.length) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = body.length; }
    let response: UpstreamResponse;
    try { response = await send(req.path.startsWith('/api/auth/') ? config.authServiceUrl : config.habitsServiceUrl, req.originalUrl, req.method, headers, body, 5000); } catch { throw unavailable(); }
    if (![200, 201, 204, 400, 401, 403, 404, 409, 413, 415, 500, 503].includes(response.status)) throw unavailable();
    let parsed: Record<string, unknown> | undefined;
    if (response.status !== 204) {
      parsed = json(response);
      if (response.status >= 400) {
        const error = parsed.error;
        if (!error || typeof error !== 'object' || typeof (error as Record<string, unknown>).code !== 'string' || typeof (error as Record<string, unknown>).message !== 'string') throw unavailable();
        parsed.requestId = res.locals.requestId;
      }
    }
    if (response.headers['set-cookie']) res.setHeader('Set-Cookie', response.headers['set-cookie']);
    const location = response.headers.location;
    if (location && location.startsWith('/api/habits/') && !/[\r\n]/.test(location)) res.setHeader('Location', location);
    if (response.status === 204) res.status(204).end();
    else if (response.status >= 400) res.status(response.status).json(parsed);
    else res.status(response.status).type('application/json').send(response.body);
  }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let failure = error instanceof Failure ? error : unavailable();
    const bodyError = error as { type?: string };
    if (bodyError?.type === 'entity.too.large') failure = new Failure(413, 'PAYLOAD_TOO_LARGE', 'Запрос превышает 16 KiB');
    if (bodyError?.type === 'encoding.unsupported' || bodyError?.type === 'charset.unsupported') failure = new Failure(415, 'UNSUPPORTED_MEDIA_TYPE', 'Неподдерживаемая кодировка');
    if (bodyError?.type === 'request.aborted' || bodyError?.type === 'request.size.invalid') failure = new Failure(400, 'VALIDATION_ERROR', 'Некорректный запрос');
    res.status(failure.status).json({ error: { code: failure.code, message: failure.message }, requestId: res.locals.requestId });
  });
  return app;
}
