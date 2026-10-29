export const MAX_HABITS = 25;
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export function todayInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}
export function parseDate(key: string) { return new Date(`${key}T12:00:00Z`); }
export function shiftDay(key: string, amount: number): string { const date = parseDate(key); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
export function formatDay(key: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }): string { return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(parseDate(key)); }
export function shiftMonth(month: string, amount: number): string { const date = parseDate(`${month}-01`); date.setUTCMonth(date.getUTCMonth() + amount); return date.toISOString().slice(0, 7); }
export function daysInMonth(month: string) { const date = parseDate(`${month}-01`); date.setUTCMonth(date.getUTCMonth() + 1, 0); return date.getUTCDate(); }
export function dayWord(n: number) { return n % 10 === 1 && n % 100 !== 11 ? "день" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "дня" : "дней"; }
export function secureNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  let decoded = value;
  try { for (let i = 0; i < 3; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } } catch { return '/'; }
  if (decoded.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(decoded)) return '/';
  const target = new URL(decoded, 'http://internal.invalid');
  if (target.origin !== 'http://internal.invalid' || /^\/(?:login|register)(?:[/?#]|$)/i.test(target.pathname)) return '/';
  const original = new URL(value, 'http://internal.invalid');
  return original.pathname + original.search + original.hash;
}
export function validateHabit(name: string, description: string) {
  if (!name.trim() || [...name.trim()].length > 120 || name.includes('\0')) throw new Error('Название должно содержать от 1 до 120 символов, без NUL.');
  if ([...description.trim()].length > 2000 || description.includes('\0')) throw new Error('Описание — не больше 2000 символов, без NUL.');
}
export function validateCredentials(email: string, password: string, registering = false) {
  if (email.includes('\0') || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Введите корректный email.');
  if (password.includes('\0') || [...password].length > 128 || [...password].length < (registering ? 8 : 1)) throw new Error(registering ? 'Пароль должен содержать от 8 до 128 символов.' : 'Введите пароль до 128 символов.');
}
