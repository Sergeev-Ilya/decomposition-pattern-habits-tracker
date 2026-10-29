import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { HabitsConfig } from './config';
import { database, HttpError, unauthenticated, validation } from './errors';
import { HabitRepository } from './repository';
import { confirmedIdentity, readSessionCookie, requestSession, UUID_PATTERN, verifyToken, type Identity, type SessionVerifier } from './security';

export interface AppOptions { pool: Pool; config: HabitsConfig; clock?: () => Date; sessionVerifier?: SessionVerifier }
function objectBody(value: unknown, allowed: string[], required: string[], atLeastOne = false): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation('Ожидается JSON-объект');
  const body = value as Record<string, unknown>; const keys = Object.keys(body);
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(body, key)) || (atLeastOne && !keys.length)) throw validation();
  return body;
}
function readText(value: unknown, field: 'name' | 'description'): string {
  const maximum = field === 'name' ? 120 : 2000;
  if (typeof value !== 'string' || value.includes('\0')) throw validation('Проверьте текст привычки', { [field]: 'Ожидается текст' });
  const text = value.trim(); const length = [...text].length;
  if (length > maximum || (field === 'name' && length === 0)) throw validation('Проверьте текст привычки', { [field]: field === 'name' ? 'Название: от 1 до 120 символов' : 'Описание: до 2000 символов' });
  return text;
}
function readId(value: string): string { if (!UUID_PATTERN.test(value)) throw validation('Некорректный идентификатор привычки'); return value; }

export function createApp({ pool, config, clock = () => new Date(), sessionVerifier = token => requestSession(token, config) }: AppOptions): express.Application {
  const app = express(); const repository = new HabitRepository(pool, clock);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const supplied = req.get('X-Request-Id'); res.locals.requestId = supplied && UUID_PATTERN.test(supplied) ? supplied : randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId); res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.use(helmet());
  app.use((req, _res, next) => {
    try {
      if (/^\/api\/habits(?:\/|$)/.test(req.path) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('Origin') !== config.appOrigin) throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'Запрос с этого адреса запрещён');
      const hasBody = Number(req.get('Content-Length') || 0) > 0 || !!req.get('Transfer-Encoding');
      if (hasBody && !req.is('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Ожидается application/json');
      next();
    } catch (error) { next(error); }
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  const route = (handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { void handler(req, res, next).catch(next); };
  const identity = (res: Response) => res.locals.identity as Identity;
  app.get('/health', route(async (_req, res) => { await database(() => pool.query('SELECT 1')); res.json({ status: 'ok', service: 'habits-service' }); }));
  app.use('/api/habits', route(async (req, res, next) => {
    const token = readSessionCookie(req); const claims = token && verifyToken(token, config.jwtSecret, clock());
    if (!token || !claims) throw unauthenticated();
    const value = await sessionVerifier(token); const now = clock();
    if (!verifyToken(token, config.jwtSecret, now)) throw unauthenticated();
    res.locals.identity = confirmedIdentity(value, claims, now); next();
  }));
  app.get('/api/habits', route(async (_req, res) => { res.json(await repository.list(identity(res))); }));
  app.post('/api/habits', route(async (req, res) => {
    const body = objectBody(req.body, ['name', 'description'], ['name']);
    const result = await repository.create(identity(res), readText(body.name, 'name'), Object.hasOwn(body, 'description') ? readText(body.description, 'description') : '');
    res.location(`/api/habits/${result.habit.id}`).status(201).json(result);
  }));
  app.get('/api/habits/:habitId', route(async (req, res) => { res.json(await repository.get(readId(req.params.habitId), identity(res))); }));
  app.patch('/api/habits/:habitId', route(async (req, res) => {
    const id = readId(req.params.habitId); const body = objectBody(req.body, ['name', 'description'], [], true);
    const changes: { name?: string; description?: string } = {};
    if (Object.hasOwn(body, 'name')) changes.name = readText(body.name, 'name');
    if (Object.hasOwn(body, 'description')) changes.description = readText(body.description, 'description');
    res.json(await repository.update(id, identity(res), changes));
  }));
  app.delete('/api/habits/:habitId', route(async (req, res) => {
    const id = readId(req.params.habitId); if (req.body !== undefined) objectBody(req.body, [], []);
    await repository.delete(id, identity(res)); res.status(204).end();
  }));
  app.get('/api/habits/:habitId/calendar', route(async (req, res) => { res.json(await repository.calendar(readId(req.params.habitId), identity(res), req.query.month)); }));
  app.put('/api/habits/:habitId/completions/:date', route(async (req, res) => {
    const id = readId(req.params.habitId); const body = objectBody(req.body, ['completed'], ['completed']);
    if (typeof body.completed !== 'boolean') throw validation('Поле completed должно быть boolean', { completed: 'Выберите состояние выполнения' });
    res.json(await repository.setCompletion(id, identity(res), req.params.date, body.completed));
  }));
  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Маршрут не найден')));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let failure = error instanceof HttpError ? error : new HttpError(500, 'INTERNAL_ERROR', 'Не удалось выполнить запрос');
    const bodyError = error as { type?: string };
    if (bodyError?.type === 'entity.too.large') failure = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Запрос превышает 16 KiB');
    else if (bodyError?.type === 'entity.parse.failed' || bodyError?.type === 'request.aborted') failure = validation('Некорректный JSON');
    else if (bodyError?.type === 'charset.unsupported' || bodyError?.type === 'encoding.unsupported') failure = new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Неподдерживаемая кодировка');
    res.status(failure.status).json({ error: { code: failure.code, message: failure.message, ...(failure.details ? { details: failure.details } : {}) }, requestId: res.locals.requestId });
  });
  return app;
}
