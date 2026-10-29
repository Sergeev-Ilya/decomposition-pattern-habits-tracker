import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { canEditDate, makeDemoAccount, MAX_HABITS, todayInZone, type Habit, type MockAccount } from './data/mock';
type Modal = { type: 'create' } | { type: 'edit' | 'delete'; habitId: string } | null;
type Store = { user: MockAccount | null; today: string; modal: Modal; setModal: (modal: Modal) => void; login: (email: string, password: string) => Promise<void>; register: (email: string, password: string) => Promise<void>; logout: () => void; toggle: (id: string, date: string) => Promise<void>; saveHabit: (name: string, description: string, id?: string) => Promise<void>; deleteHabit: (id: string) => Promise<void>; notice: string; notify: (text: string) => void };
const Context = createContext<Store | null>(null);
const pause = () => new Promise(resolve => setTimeout(resolve, 180));
export function AppProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<MockAccount[]>(() => [makeDemoAccount()]);
  const [email, setEmail] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [notice, notify] = useState('');
  const [, setClock] = useState(0);
  const user = accounts.find(a => a.email === email) || null;
  const today = todayInZone(user?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  useEffect(() => { const timer = setInterval(() => setClock(c => c + 1), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => notify(''), 3500); return () => clearTimeout(timer); }, [notice]);
  const update = (fn: (account: MockAccount) => MockAccount) => setAccounts(all => all.map(a => a.email === email ? fn(a) : a));
  const value: Store = {
    user, today, modal, setModal, notice, notify,
    async login(inputEmail, password) { await pause(); const normalized = inputEmail.trim().toLowerCase(); if (!accounts.some(a => a.email === normalized && a.password === password)) throw new Error('Неверный email или пароль'); setEmail(normalized); },
    async register(inputEmail, password) { await pause(); const normalized = inputEmail.trim().toLowerCase(); if (accounts.some(a => a.email === normalized)) throw new Error('Аккаунт с таким email уже существует'); setAccounts(all => [...all, { email: normalized, password, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', habits: [] }]); },
    logout() { setEmail(null); setModal(null); notify(''); },
    async toggle(id, date) { await pause(); const habit = user?.habits.find(h => h.id === id); const now = todayInZone(user!.timeZone); if (!habit || !canEditDate(habit, date, now)) throw new Error('Эту дату уже нельзя изменить'); update(a => ({ ...a, habits: a.habits.map(h => h.id !== id ? h : { ...h, completed: h.completed.includes(date) ? h.completed.filter(d => d !== date) : [...h.completed, date].sort() }) })); },
    async saveHabit(name, description, id) { await pause(); if (!name.trim()) throw new Error('Введите название привычки'); if (!id && user!.habits.length >= MAX_HABITS) throw new Error('Можно добавить не больше 25 привычек'); update(a => ({ ...a, habits: id ? a.habits.map(h => h.id === id ? { ...h, name: name.trim(), description: description.trim() } : h) : [...a.habits, { id: crypto.randomUUID(), name: name.trim(), description: description.trim(), createdAt: todayInZone(a.timeZone), completed: [], icon: 'leaf', color: 'sage' } as Habit] })); notify(id ? 'Изменения сохранены' : 'Новая привычка добавлена'); },
    async deleteHabit(id) { await pause(); update(a => ({ ...a, habits: a.habits.filter(h => h.id !== id) })); notify('Привычка удалена'); },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useApp() { const context = useContext(Context); if (!context) throw new Error('AppProvider is required'); return context; }
