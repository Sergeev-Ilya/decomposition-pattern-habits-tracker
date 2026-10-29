import express, { type Request, type Response, type NextFunction, type CookieOptions } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AuthConfig } from './config';
import { HttpError, database, unauthenticated } from './errors';
import { equalServiceKey, hashPassword, hasDuplicateSessionCookie, readSessionCookie, SESSION_SECONDS, signToken, UUID_PATTERN, verifyPassword, verifyToken, type Claims } from './security';

export interface AppOptions { pool: Pool; config: AuthConfig; clock?: () => Date }
interface UserRow { id: string; email: string; password_hash: string; time_zone: string; created_at: Date }
interface SessionRow extends UserRow { session_id: string; expires_at: Date }
const publicUser = (row: UserRow) => ({ id: row.id, email: row.email, timeZone: row.time_zone, createdAt: row.created_at.toISOString() });
function objectBody(value: unknown, allowed: string[], required: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'VALIDATION_ERROR', 'Ожидается JSON-объект');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(body, key))) throw new HttpError(400, 'VALIDATION_ERROR', 'Проверьте поля запроса');
  return body;
}
function readEmail(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'VALIDATION_ERROR', 'Укажите корректный email', { email: 'Укажите корректный email' });
  const email = value.trim().toLowerCase();
  if ([...email].length > 254 || /[\u0000-\u001f\u007f]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'VALIDATION_ERROR', 'Укажите корректный email', { email: 'Укажите корректный email' });
  return email;
}
function readPassword(value: unknown, minimum: number): string {
  if (typeof value !== 'string' || [...value].length < minimum || [...value].length > 128) throw new HttpError(400, 'VALIDATION_ERROR', `Пароль должен содержать от ${minimum} до 128 символов`, { password: `От ${minimum} до 128 символов` });
  return value;
}
function readTimeZone(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 100 || /^[+-]/.test(value)) throw new HttpError(400, 'VALIDATION_ERROR', 'Некорректный часовой пояс', { timeZone: 'Нужен часовой пояс IANA' });
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date()); } catch { throw new HttpError(400, 'VALIDATION_ERROR', 'Некорректный часовой пояс', { timeZone: 'Нужен часовой пояс IANA' }); }
  return value;
}

export function createApp({ pool, config, clock = () => new Date() }: AppOptions): express.Application {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    const supplied = _req.get('X-Request-Id');
    res.locals.requestId = supplied && UUID_PATTERN.test(supplied) ? supplied : randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId);
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(helmet());
  app.use((req, _res, next) => {
    try {
      if (req.path.startsWith('/api/auth/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('Origin') !== config.appOrigin) throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'Запрос с этого адреса запрещён');
      if (req.path === '/internal/sessions/verify' && !equalServiceKey(req.get('X-Service-Key'), config.internalServiceKey)) throw new HttpError(403, 'INVALID_SERVICE_KEY', 'Доступ запрещён');
      const hasBody = Number(req.get('Content-Length') || 0) > 0 || !!req.get('Transfer-Encoding');
      if (hasBody && !req.is('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Ожидается application/json');
      next();
    } catch (error) { next(error); }
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  const route = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
  const cookieOptions: CookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' };
  async function activeSession(claims: Claims, now: Date): Promise<SessionRow | null> {
    const result = await database(() => pool.query<SessionRow>(
      'SELECT u.id,u.email,u.password_hash,u.time_zone,u.created_at,s.id AS session_id,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>$3',
      [claims.sid, claims.sub, now],
    ));
    return result.rows[0] || null;
  }
  async function verifySession(token: string | null): Promise<SessionRow> {
    const now = clock();
    const claims = token && verifyToken(token, config.jwtSecret, now);
    if (!claims) throw unauthenticated();
    const session = await activeSession(claims, now);
    if (!session) throw unauthenticated();
    return session;
  }
  app.get('/health', route(async (_req, res) => {
    await database(() => pool.query('SELECT 1'));
    res.json({ status: 'ok', service: 'auth-service' });
  }));
  app.post('/api/auth/register', route(async (req, res) => {
    const body = objectBody(req.body, ['email', 'password', 'timeZone'], ['email', 'password', 'timeZone']);
    const email = readEmail(body.email); const password = readPassword(body.password, 8); const timeZone = readTimeZone(body.timeZone);
    const passwordHash = await hashPassword(password);
    const user = await database(async () => {
      try { return (await pool.query<UserRow>('INSERT INTO users(email,password_hash,time_zone) VALUES($1,$2,$3) RETURNING *', [email, passwordHash, timeZone])).rows[0]; }
      catch (error) { if ((error as { code?: string; constraint?: string }).code === '23505' && (error as { constraint?: string }).constraint === 'users_email_key') throw new HttpError(409, 'EMAIL_TAKEN', 'Этот email уже зарегистрирован'); throw error; }
    });
    res.status(201).json({ user: publicUser(user) });
  }));
  app.post('/api/auth/login', route(async (req, res) => {
    const body = objectBody(req.body, ['email', 'password'], ['email', 'password']);
    const email = readEmail(body.email); const password = readPassword(body.password, 1);
    const user = (await database(() => pool.query<UserRow>('SELECT * FROM users WHERE email=$1', [email]))).rows[0];
    const valid = await verifyPassword(password, user?.password_hash || null);
    if (!valid || !user) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль');
    const issuedAt = Math.floor(clock().getTime() / 1000); const sid = randomUUID(); const expiresAt = new Date((issuedAt + SESSION_SECONDS) * 1000);
    const token = signToken({ sub: user.id, sid, iat: issuedAt, exp: issuedAt + SESSION_SECONDS }, config.jwtSecret);
    await database(() => pool.query('INSERT INTO sessions(id,user_id,created_at,updated_at,expires_at) VALUES($1,$2,$3,$3,$4)', [sid, user.id, new Date(issuedAt * 1000), expiresAt]));
    res.cookie('ritm_session', token, { ...cookieOptions, maxAge: SESSION_SECONDS * 1000, expires: expiresAt });
    res.json({ user: publicUser(user), expiresAt: expiresAt.toISOString() });
  }));
  app.get('/api/auth/session', route(async (req, res) => {
    const session = await verifySession(readSessionCookie(req));
    res.json({ user: publicUser(session), expiresAt: session.expires_at.toISOString() });
  }));
  app.post('/api/auth/logout', route(async (req, res) => {
    if (hasDuplicateSessionCookie(req)) throw new HttpError(400, 'VALIDATION_ERROR', 'Неоднозначная cookie сессии');
    if (req.body !== undefined) objectBody(req.body, [], []);
    const now = clock(); const token = readSessionCookie(req); const claims = token && verifyToken(token, config.jwtSecret, now);
    if (claims) {
      await database(() => pool.query('UPDATE sessions SET revoked_at=COALESCE(revoked_at,$3),updated_at=CASE WHEN revoked_at IS NULL THEN $3 ELSE updated_at END WHERE id=$1 AND user_id=$2', [claims.sid, claims.sub, now]));
    }
    res.clearCookie('ritm_session', cookieOptions).status(204).end();
  }));
  app.post('/internal/sessions/verify', route(async (req, res) => {
    const body = objectBody(req.body, ['token'], ['token']);
    if (typeof body.token !== 'string' || !body.token.length || body.token.length > 4096) throw new HttpError(400, 'VALIDATION_ERROR', 'Некорректный запрос проверки сессии');
    const session = await verifySession(body.token);
    res.json({ userId: session.id, sessionId: session.session_id, timeZone: session.time_zone, expiresAt: session.expires_at.toISOString() });
  }));
  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Маршрут не найден')));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let failure = error instanceof HttpError ? error : new HttpError(500, 'INTERNAL_ERROR', 'Не удалось выполнить запрос');
    const bodyError = error as { type?: string; status?: number };
    if (bodyError?.type === 'entity.too.large') failure = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Запрос превышает 16 KiB');
    else if (bodyError?.type === 'entity.parse.failed' || bodyError?.type === 'request.aborted') failure = new HttpError(400, 'VALIDATION_ERROR', 'Некорректный JSON');
    else if (bodyError?.type === 'charset.unsupported' || bodyError?.type === 'encoding.unsupported') failure = new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Неподдерживаемая кодировка');
    res.status(failure.status).json({ error: { code: failure.code, message: failure.message, ...(failure.details ? { details: failure.details } : {}) }, requestId: res.locals.requestId });
  });
  return app;
}
