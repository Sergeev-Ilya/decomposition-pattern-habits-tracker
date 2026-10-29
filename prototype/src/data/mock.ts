export type HabitIcon = 'book' | 'water' | 'walk' | 'sun' | 'leaf' | 'moon';
export type Habit = { id: string; name: string; description: string; createdAt: string; completed: string[]; icon: HabitIcon; color: 'sage' | 'clay' | 'blue' | 'gold' };
export type MockAccount = { email: string; password: string; timeZone: string; habits: Habit[] };
export const DEMO_EMAIL = 'demo@ritm.app';
export const DEMO_PASSWORD = 'demo1234';
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
export function currentStreak(habit: Habit, today: string): number { const done = new Set(habit.completed); let date = done.has(today) ? today : shiftDay(today, -1); let count = 0; while (date >= habit.createdAt && done.has(date)) { count++; date = shiftDay(date, -1); } return count; }
export function canEditDate(habit: Habit, date: string, today: string) { return date >= habit.createdAt && date >= shiftDay(today, -7) && date <= today; }
export function dayWord(n: number) { return n % 10 === 1 && n % 100 !== 11 ? 'день' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'дня' : 'дней'; }
export function makeDemoAccount(): MockAccount {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const today = todayInZone(timeZone);
  const fixtures: Array<{ name: string; description: string; icon: HabitIcon; color: Habit['color']; recent: number[]; skip: number }> = [
    { name: 'Читать 20 минут', description: 'Несколько страниц для новых мыслей и идей', icon: 'book', color: 'sage', recent: [0, 1, 2, 3, 4, 5, 6], skip: 5 },
    { name: 'Пить достаточно воды', description: 'Стакан утром и вода в течение дня', icon: 'water', color: 'blue', recent: [0, 1, 2, 3], skip: 3 },
    { name: 'Прогулка на свежем воздухе', description: '30 минут без спешки и телефона', icon: 'walk', color: 'clay', recent: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], skip: 4 },
    { name: 'Утренняя зарядка', description: 'Разбудить тело и настроиться на день', icon: 'sun', color: 'gold', recent: [1, 2, 3], skip: 3 },
    { name: 'Пять минут тишины', description: 'Остановиться, выдохнуть, побыть здесь', icon: 'leaf', color: 'sage', recent: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], skip: 6 },
    { name: 'Ложиться спать до 23:00', description: 'Оставить время на полноценный отдых', icon: 'moon', color: 'blue', recent: [2, 4, 5, 6], skip: 2 },
  ];
  return { email: DEMO_EMAIL, password: DEMO_PASSWORD, timeZone, habits: fixtures.map((fixture, index) => ({ id: `habit-${index + 1}`, name: fixture.name, description: fixture.description, icon: fixture.icon, color: fixture.color, createdAt: shiftDay(today, -66), completed: Array.from(new Set([...Array.from({ length: 52 }, (_, i) => i + 15).filter(i => i % fixture.skip !== 0).map(i => shiftDay(today, -i)), ...fixture.recent.map(i => shiftDay(today, -i))])).sort() })) };
}
