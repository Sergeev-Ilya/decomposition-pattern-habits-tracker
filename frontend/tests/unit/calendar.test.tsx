import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { HabitPage } from '../../src/pages/HabitPage';
import type { CalendarResponse, HabitResponse } from '../../src/api/types';
const { useApp } = vi.hoisted(() => ({ useApp: vi.fn() }));
vi.mock('../../src/store', () => ({ useApp }));
const habit = { id: 'h', name: 'История', description: '', startDate: '2026-09-01', createdAt: '', updatedAt: '', currentStreak: 9, todayCompleted: false, recentCompletedDates: [] };
const detail: HabitResponse = { habit, today: '2026-10-29', timeZone: 'UTC' };
const calendar = (month = '2026-10', done = false): CalendarResponse => ({ ...detail, month, completedDates: done ? ['2026-10-29'] : [], completedCount: done ? 1 : 0, daysInMonth: month === '2026-10' ? 31 : 30, completionPercent: done ? 3.2 : 0, editableFrom: '2026-10-22', editableTo: '2026-10-29' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let state: any;
beforeEach(() => { state = { request: vi.fn(async (path: string) => path.includes('/calendar') ? calendar() : detail), setCompletion: vi.fn(async () => {}), setModal: vi.fn(), notify: vi.fn(), revision: 0 }; useApp.mockImplementation(() => state); });
function Shell() { const navigate = useNavigate(); return <><button onClick={() => navigate('/habits/h?month=2026-09')}>September</button><Routes><Route path="/habits/:habitId" element={<HabitPage/>}/></Routes></>; }
function tree() { return <MemoryRouter initialEntries={['/habits/h?month=2026-10']}><Shell/></MemoryRouter>; }
it('blocks a second calendar write until the confirmed month snapshot arrives', async () => {
  const refreshed = deferred<CalendarResponse>(); let calls = 0;
  state.request.mockImplementation(async (path: string) => path.includes('/calendar') ? ++calls === 1 ? calendar() : refreshed.promise : detail);
  const view = render(tree()); const today = await screen.findByRole('button', { name: /29 октября 2026.*сегодня/ });
  await userEvent.click(today); expect(state.setCompletion).toHaveBeenCalledWith('h', '2026-10-29', true);
  state = { ...state, revision: 1 }; view.rerender(tree());
  expect(await screen.findByText('Обновляем календарь…')).toBeVisible();
  expect(today).toBeDisabled();
  await act(async () => refreshed.resolve(calendar('2026-10', true)));
  await waitFor(() => expect(today).toBeEnabled()); expect(today).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(today); expect(state.setCompletion).toHaveBeenLastCalledWith('h', '2026-10-29', false);
});
it('ignores late prior-month response after navigating to a different month', async () => {
  const prior = deferred<CalendarResponse>(); let signal: AbortSignal | undefined;
  state.request.mockImplementation(async (path: string, init: RequestInit) => { if (!path.includes('/calendar')) return detail; if (path.includes('2026-10')) { signal = init.signal as AbortSignal; return prior.promise; } return calendar('2026-09'); });
  render(tree()); await waitFor(() => expect(signal).toBeDefined()); await userEvent.click(screen.getByText('September'));
  expect(await screen.findByRole('heading', { name: /сентябрь 2026/ })).toBeVisible(); expect(signal!.aborted).toBe(true);
  await act(async () => prior.resolve(calendar('2026-10', true)));
  expect(screen.getByRole('heading', { name: /сентябрь 2026/ })).toBeVisible(); expect(screen.getByText('Выполнено 0 из 30 дней')).toBeVisible();
  expect(screen.queryByRole('heading', { name: /октябрь 2026/ })).not.toBeInTheDocument();
});
it('renders server streak independently of past-month statistics and disables historic dates', async () => {
  state.request.mockImplementation(async (path: string) => path.includes('/calendar') ? calendar('2026-09') : detail);
  render(<MemoryRouter initialEntries={['/habits/h?month=2026-09']}><Routes><Route path="/habits/:habitId" element={<HabitPage/>}/></Routes></MemoryRouter>);
  expect(await screen.findByText('Выполнено 0 из 30 дней')).toBeVisible();
  expect(screen.getByText('ТЕКУЩАЯ СЕРИЯ').parentElement).toHaveTextContent('9 дней'); expect(screen.getByRole('button', { name: /^1 сентября 2026.*последние 7 дней/ })).toBeDisabled();
});
