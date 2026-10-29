import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import type { HabitsConfig } from './config';
import { isTimeZone } from './calendar';
import { HttpError, unauthenticated, unavailable } from './errors';
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface Claims { sub: string; sid: string; iat: number; exp: number }
export interface Identity { userId: string; sessionId: string; timeZone: string; expiresAt: string }
export type SessionVerifier = (token: string) => Promise<unknown>;
export function verifyToken(token: string, secret: string, now: Date): Claims | null {
  try {
    const value = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'ritm-auth', audience: 'ritm-app', clockTimestamp: Math.floor(now.getTime() / 1000) });
    if (typeof value !== 'object' || typeof value.sub !== 'string' || typeof value.sid !== 'string' || !UUID_PATTERN.test(value.sub) || !UUID_PATTERN.test(value.sid) || !Number.isInteger(value.iat) || !Number.isInteger(value.exp) || value.iat! < 0 || value.iat! > Math.floor(now.getTime() / 1000) || value.exp! <= value.iat!) return null;
    return { sub: value.sub, sid: value.sid, iat: value.iat!, exp: value.exp! };
  } catch { return null; }
}
export function readSessionCookie(req: Request): string | null {
  const values = (req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.split('=', 1)[0] === 'ritm_session');
  if (values.length !== 1) return null;
  try { const token = decodeURIComponent(values[0].slice(values[0].indexOf('=') + 1)); return token.length > 0 && token.length <= 4096 ? token : null; } catch { return null; }
}
export async function requestSession(token: string, config: HabitsConfig): Promise<unknown> {
  try {
    const response = await fetch(new URL('/internal/sessions/verify', config.authServiceUrl), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Service-Key': config.internalServiceKey },
      body: JSON.stringify({ token }), redirect: 'error', signal: AbortSignal.timeout(2000),
    });
    if (response.status === 401) throw unauthenticated();
    if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) throw unavailable();
    const text = await response.text();
    if (text.length > 16384) throw unavailable();
    return JSON.parse(text) as unknown;
  } catch (error) { if (error instanceof HttpError && error.status === 401) throw error; throw unavailable(); }
}
export function confirmedIdentity(value: unknown, claims: Claims, now: Date): Identity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  const candidate = value as Record<string, unknown>;
  if (candidate.userId !== claims.sub || candidate.sessionId !== claims.sid || !isTimeZone(candidate.timeZone) || typeof candidate.expiresAt !== 'string' || !Number.isFinite(Date.parse(candidate.expiresAt)) || Date.parse(candidate.expiresAt) <= now.getTime()) throw unavailable();
  return { userId: claims.sub, sessionId: claims.sid, timeZone: candidate.timeZone, expiresAt: candidate.expiresAt };
}
