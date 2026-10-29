import type { Pool, PoolClient } from 'pg';
import { currentStreak, daysInMonth, readDate, readMonth, shiftDay, todayInZone } from './calendar';
import { database, HttpError, notFound } from './errors';
import type { Identity } from './security';

interface HabitRow {
  id: string; user_id: string; name: string; description: string; start_date: string; created_at: Date; updated_at: Date;
}
interface MarkRow { habit_id: string; completed_on: string }
export interface HabitSummary {
  id: string; name: string; description: string; startDate: string; createdAt: string; updatedAt: string;
  currentStreak: number; todayCompleted: boolean; recentCompletedDates: string[];
}
const columns = 'id,user_id,name,description,start_date::text,created_at,updated_at';
function summary(row: HabitRow, completed: string[], today: string): HabitSummary {
  return { id: row.id, name: row.name, description: row.description, startDate: row.start_date,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    currentStreak: currentStreak(completed, row.start_date, today), todayCompleted: completed.includes(today),
    recentCompletedDates: completed.filter(date => date >= row.start_date && date >= shiftDay(today, -6) && date <= today).sort() };
}
export class HabitRepository {
  constructor(private readonly pool: Pool, private readonly clock: () => Date) {}
  private transaction<T>(readOnly: boolean, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    return database(async () => {
      const client = await this.pool.connect();
      try {
        await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) { try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ } throw error; }
      finally { client.release(); }
    });
  }
  private async habit(client: PoolClient, id: string, userId: string, lock = false): Promise<HabitRow> {
    const result = await client.query<HabitRow>(`SELECT ${columns} FROM habits WHERE id=$1 AND user_id=$2${lock ? ' FOR UPDATE' : ''}`, [id, userId]);
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }
  private async marks(client: PoolClient, habitId: string): Promise<string[]> {
    const result = await client.query<MarkRow>('SELECT habit_id,completed_on::text FROM completions WHERE habit_id=$1 ORDER BY completed_on', [habitId]);
    return result.rows.map(mark => mark.completed_on);
  }
  async list(identity: Identity) {
    return this.transaction(true, async client => {
      const today = todayInZone(this.clock(), identity.timeZone);
      const rows = (await client.query<HabitRow>(`SELECT ${columns} FROM habits WHERE user_id=$1 ORDER BY created_at,id`, [identity.userId])).rows;
      const marks = rows.length ? (await client.query<MarkRow>('SELECT habit_id,completed_on::text FROM completions WHERE habit_id=ANY($1::uuid[]) ORDER BY completed_on', [rows.map(row => row.id)])).rows : [];
      const byHabit = new Map<string, string[]>();
      for (const mark of marks) { const dates = byHabit.get(mark.habit_id) || []; dates.push(mark.completed_on); byHabit.set(mark.habit_id, dates); }
      return { habits: rows.map(row => summary(row, byHabit.get(row.id) || [], today)), today, timeZone: identity.timeZone, limit: 25 };
    });
  }
  async get(id: string, identity: Identity) {
    return this.transaction(true, async client => {
      const today = todayInZone(this.clock(), identity.timeZone); const row = await this.habit(client, id, identity.userId);
      return { habit: summary(row, await this.marks(client, id), today), today, timeZone: identity.timeZone };
    });
  }
  async calendar(id: string, identity: Identity, requestedMonth: unknown) {
    return this.transaction(true, async client => {
      const today = todayInZone(this.clock(), identity.timeZone); const row = await this.habit(client, id, identity.userId);
      const month = requestedMonth === undefined ? today.slice(0, 7) : readMonth(requestedMonth);
      if (month < row.start_date.slice(0, 7) || month > today.slice(0, 7)) throw new HttpError(400, 'MONTH_OUT_OF_RANGE', 'Этот месяц недоступен для привычки');
      const marks = await this.marks(client, id); const completedDates = marks.filter(date => date.startsWith(`${month}-`));
      const total = daysInMonth(month);
      return { habit: summary(row, marks, today), month, completedDates, completedCount: completedDates.length, daysInMonth: total,
        completionPercent: completedDates.length / total * 100, editableFrom: row.start_date > shiftDay(today, -7) ? row.start_date : shiftDay(today, -7),
        editableTo: today, today, timeZone: identity.timeZone };
    });
  }
  async create(identity: Identity, name: string, description: string) {
    return this.transaction(false, async client => {
      await client.query('INSERT INTO habit_owners(id) VALUES($1) ON CONFLICT(id) DO NOTHING', [identity.userId]);
      await client.query('SELECT id FROM habit_owners WHERE id=$1 FOR UPDATE', [identity.userId]);
      const count = (await client.query<{ count: string }>('SELECT count(*) FROM habits WHERE user_id=$1', [identity.userId])).rows[0].count;
      if (Number(count) >= 25) throw new HttpError(409, 'HABIT_LIMIT_REACHED', 'Можно добавить не больше 25 привычек');
      const now = this.clock(); const today = todayInZone(now, identity.timeZone);
      const row = (await client.query<HabitRow>(`INSERT INTO habits(user_id,name,description,start_date,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5) RETURNING ${columns}`, [identity.userId, name, description, today, now])).rows[0];
      return { habit: summary(row, [], today), today, timeZone: identity.timeZone };
    });
  }
  async update(id: string, identity: Identity, changes: { name?: string; description?: string }) {
    return this.transaction(false, async client => {
      let row = await this.habit(client, id, identity.userId, true);
      const now = this.clock(); const today = todayInZone(now, identity.timeZone);
      const name = changes.name ?? row.name; const description = changes.description ?? row.description;
      if (row.name !== name || row.description !== description) row = (await client.query<HabitRow>(`UPDATE habits SET name=$3,description=$4,updated_at=$5 WHERE id=$1 AND user_id=$2 RETURNING ${columns}`, [id, identity.userId, name, description, now])).rows[0];
      return { habit: summary(row, await this.marks(client, id), today), today, timeZone: identity.timeZone };
    });
  }
  async delete(id: string, identity: Identity): Promise<void> {
    return this.transaction(false, async client => {
      await client.query('SELECT id FROM habit_owners WHERE id=$1 FOR UPDATE', [identity.userId]);
      await this.habit(client, id, identity.userId, true);
      await client.query('DELETE FROM habits WHERE id=$1 AND user_id=$2', [id, identity.userId]);
    });
  }
  async setCompletion(id: string, identity: Identity, inputDate: string, completed: boolean) {
    return this.transaction(false, async client => {
      let row = await this.habit(client, id, identity.userId, true);
      const now = this.clock(); const today = todayInZone(now, identity.timeZone); const date = readDate(inputDate);
      if (date < row.start_date || date < shiftDay(today, -7) || date > today) throw new HttpError(400, 'DATE_NOT_EDITABLE', 'Отметки можно менять за сегодня и семь предыдущих дней, начиная с создания привычки');
      const result = completed
        ? await client.query('INSERT INTO completions(habit_id,completed_on,created_at,updated_at) VALUES($1,$2,$3,$3) ON CONFLICT(habit_id,completed_on) DO NOTHING', [id, date, now])
        : await client.query('DELETE FROM completions WHERE habit_id=$1 AND completed_on=$2', [id, date]);
      if (result.rowCount) row = (await client.query<HabitRow>(`UPDATE habits SET updated_at=$3 WHERE id=$1 AND user_id=$2 RETURNING ${columns}`, [id, identity.userId, now])).rows[0];
      return { habit: summary(row, await this.marks(client, id), today), date, completed, today, timeZone: identity.timeZone };
    });
  }
}
