import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, isCancelled, json } from './api/client';
import type { User, Habit, HabitResponse, HabitsResponse, SessionResponse, CompletionResponse } from './api/types';
import { validateCredentials, validateHabit } from './lib/calendar';
type Modal = { type: 'create' } | { type: 'edit' | 'delete'; habitId: string } | null;
type Store = { user: User | null; habits: Habit[]; today: string; modal: Modal; setModal: (value: Modal) => void; authStatus: 'loading'|'ready'|'error'; authError: string; checkSession: () => Promise<void>; expired: boolean; loading: boolean; listError: string; refreshHabits: () => Promise<void>; request: <T>(path: string, init?: RequestInit) => Promise<T>; login: (email: string, password: string) => Promise<void>; register: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; setCompletion: (id: string, date: string, completed: boolean) => Promise<void>; saveHabit: (name: string, description: string, id?: string) => Promise<void>; deleteHabit: (id: string) => Promise<void>; notice: string; notify: (text: string) => void; revision: number };
const Context = createContext<Store | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User|null>(null), [habits, setHabits] = useState<Habit[]>([]), [today, setToday] = useState('');
  const [authStatus, setAuthStatus] = useState<Store['authStatus']>('loading'), [authError, setAuthError] = useState(''), [expired, setExpired] = useState(false);
  const [modal, setModal] = useState<Modal>(null), [notice, notify] = useState(''), [loading, setLoading] = useState(false), [listError, setListError] = useState(''), [revision, setRevision] = useState(0);
  const epoch = useRef(0), listSeq = useRef(0), sessionController = useRef<AbortController|null>(null);
  const clear = useCallback((sessionExpired = false) => { epoch.current++; listSeq.current++; setUser(null); setHabits([]); setToday(''); setModal(null); notify(''); setListError(''); setLoading(false); setExpired(sessionExpired); }, []);
  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const ticket = epoch.current;
    try { const result = await api<T>(path, init); if (ticket !== epoch.current) throw new DOMException('Cancelled', 'AbortError'); return result; }
    catch(error) { if (ticket !== epoch.current) throw new DOMException('Cancelled', 'AbortError'); if (error instanceof ApiError && error.status === 401) { clear(true); setAuthStatus('ready'); } throw error; }
  }, [clear]);
  const checkSession = useCallback(async () => {
    sessionController.current?.abort(); const controller = new AbortController(); sessionController.current = controller; const ticket = ++epoch.current; setAuthStatus('loading'); setAuthError('');
    try { const result = await api<SessionResponse>('/auth/session', { signal: controller.signal }); if (ticket !== epoch.current) return; setUser(result.user); setExpired(false); setAuthStatus('ready'); }
    catch(error) { if (isCancelled(error) || ticket !== epoch.current) return; if (error instanceof ApiError && error.status === 401) { clear(); setAuthStatus('ready'); } else { setAuthError((error as Error).message); setAuthStatus('error'); } }
  }, [clear]);
  useEffect(() => { void checkSession(); return () => sessionController.current?.abort(); }, [checkSession]);
  const refreshHabits = useCallback(async () => {
    const seq = ++listSeq.current; setLoading(true);
    try { const result = await request<HabitsResponse>('/habits'); if (seq !== listSeq.current) return; setHabits(result.habits); setToday(result.today); setListError(''); }
    catch(error) { if (!isCancelled(error) && seq === listSeq.current) setListError((error as Error).message); }
    finally { if (seq === listSeq.current) setLoading(false); }
  }, [request]);
  useEffect(() => { if (!user) return; void refreshHabits(); const refresh = () => { void refreshHabits(); setRevision(v => v+1); }; const timer = setInterval(refresh, 30000); window.addEventListener('focus', refresh); return () => { clearInterval(timer); window.removeEventListener('focus', refresh); }; }, [user, refreshHabits]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => notify(''), 5000); return () => clearTimeout(timer); }, [notice]);
  const applyHabit = (result: HabitResponse) => { listSeq.current++; setToday(result.today); setHabits(all => all.some(h => h.id === result.habit.id) ? all.map(h => h.id === result.habit.id ? result.habit : h) : [...all, result.habit]); setRevision(v => v+1); };
  const value: Store = { user, habits, today, modal, setModal, notice, notify, authStatus, authError, checkSession, expired, loading, listError, refreshHabits, request, revision,
    async login(email, password) { validateCredentials(email, password); sessionController.current?.abort(); const ticket = ++epoch.current; const result = await api<SessionResponse>('/auth/login', json('POST', { email: email.trim().toLowerCase(), password })); if (ticket !== epoch.current) return; setHabits([]); setToday(''); setLoading(true); setUser(result.user); setExpired(false); setAuthStatus('ready'); },
    async register(email, password) { validateCredentials(email, password, true); await api('/auth/register', json('POST', { email: email.trim().toLowerCase(), password, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' })); },
    async logout() { await request<void>('/auth/logout', json('POST')); clear(); setAuthStatus('ready'); },
    async setCompletion(id, date, completed) { const result = await request<CompletionResponse>(`/habits/${encodeURIComponent(id)}/completions/${date}`, json('PUT', { completed })); applyHabit(result); await refreshHabits(); },
    async saveHabit(name, description, id) { validateHabit(name, description); let result: HabitResponse; try { result = await request<HabitResponse>(id ? `/habits/${encodeURIComponent(id)}` : '/habits', json(id ? 'PATCH' : 'POST', { name: name.trim(), description: description.trim() })); } catch(error) { if (error instanceof ApiError && error.code === 'HABIT_LIMIT_REACHED') await refreshHabits(); throw error; } applyHabit(result); await refreshHabits(); notify(id ? 'Изменения сохранены' : 'Новая привычка добавлена'); },
    async deleteHabit(id) { await request<void>(`/habits/${encodeURIComponent(id)}`, json('DELETE')); listSeq.current++; setHabits(all => all.filter(h => h.id !== id)); setRevision(v => v+1); await refreshHabits(); notify('Привычка удалена'); },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useApp() { const context = useContext(Context); if (!context) throw new Error('AppProvider is required'); return context; }
