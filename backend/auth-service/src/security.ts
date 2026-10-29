import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface Claims { sub: string; sid: string; iat: number; exp: number }
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result));
});
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$131072$8$1$${salt.toString('base64')}$${(await derive(password, salt)).toString('base64')}`;
}
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = stored?.split('$');
  const validFormat = parts?.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$131072$8$1';
  const salt = validFormat ? Buffer.from(parts![4], 'base64') : Buffer.alloc(16);
  const expected = validFormat ? Buffer.from(parts![5], 'base64') : Buffer.alloc(64);
  const valid = !!validFormat && salt.length === 16 && expected.length === 64 && salt.toString('base64') === parts![4] && expected.toString('base64') === parts![5];
  const actual = await derive(password, valid ? salt : Buffer.alloc(16));
  return timingSafeEqual(actual, valid ? expected : Buffer.alloc(64)) && valid;
}
export function signToken(claims: Claims, secret: string): string {
  return jwt.sign(claims, secret, { algorithm: 'HS256', issuer: 'ritm-auth', audience: 'ritm-app' });
}
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
  try {
    const token = decodeURIComponent(values[0].slice(values[0].indexOf('=') + 1));
    return token.length > 0 && token.length <= 4096 ? token : null;
  } catch { return null; }
}
export function hasDuplicateSessionCookie(req: Request): boolean {
  return (req.headers.cookie || '').split(';').filter(part => part.trim().split('=', 1)[0] === 'ritm_session').length > 1;
}
export function equalServiceKey(value: string | undefined, expected: string): boolean {
  const actual = Buffer.from(value || ''); const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}
