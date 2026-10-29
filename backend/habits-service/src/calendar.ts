import { validation } from './errors';
export const DATE_PATTERN = /^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
export const MONTH_PATTERN = /^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/;
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 100 || /^[+-]/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date()); return true; } catch { return false; }
}
export function todayInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year')!.value.padStart(4, '0')}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}
export function parseDate(value: string): Date { return new Date(`${value}T12:00:00.000Z`); }
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = parseDate(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function readDate(value: unknown): string { if (!isCalendarDate(value)) throw validation('Некорректная календарная дата'); return value; }
export function readMonth(value: unknown): string { if (typeof value !== 'string' || !MONTH_PATTERN.test(value)) throw validation('Некорректный месяц'); return value; }
export function shiftDay(value: string, amount: number): string { const date = parseDate(value); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
export function daysInMonth(month: string): number { const date = parseDate(`${month}-01`); date.setUTCMonth(date.getUTCMonth() + 1, 0); return date.getUTCDate(); }
export function currentStreak(completed: string[], startDate: string, today: string): number {
  const done = new Set(completed); let day = done.has(today) ? today : shiftDay(today, -1); let count = 0;
  while (day >= startDate && done.has(day)) { count++; day = shiftDay(day, -1); }
  return count;
}
