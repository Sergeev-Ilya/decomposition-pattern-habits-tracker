import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { AppProvider, useApp } from '../../src/store';
const user = { id: 'u', email: 'qa@example.test', timeZone: 'UTC', createdAt: '2026-10-29T00:00:00Z' };
const today = '2026-10-29';
const habit = { id: 'h', name: 'Читать', description: '', startDate: today, createdAt: today, updatedAt: today, currentStreak: 0, todayCompleted: false, recentCompletedDates: [] };
const reply = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
const failure = (status: number, message: string) => reply({ error: { code: 'TEST', message } }, status);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mockApi(handler: (path: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.stubGlobal('fetch', vi.fn((path: string, init: RequestInit) => handler(path.replace('/api', ''), init)));
}
function mount(route = '/') { return render(<MemoryRouter initialEntries={[route]}><App/></MemoryRouter>); }
const list = () => reply({ habits: [habit], today, timeZone: 'UTC', limit: 25 });
async function credentials(password = 'valid password') { const ui = userEvent.setup(); await ui.type(screen.getByLabelText('Email'), user.email); await ui.type(screen.getByLabelText('Пароль'), password); return ui; }

describe('session boundary and authentication forms', () => {
  it('keeps private data hidden while session is pending, then redirects a guest', async () => {
    const pending = deferred<Response>(); mockApi(() => pending.promise); mount('/habits/h?month=2026-10');
    expect(screen.getByRole('status')).toHaveTextContent('Проверяем сессию');
    expect(screen.queryByText('Читать')).not.toBeInTheDocument();
    await act(async () => pending.resolve(failure(401, 'Нет сессии')));
    expect(await screen.findByRole('heading', { name: 'С возвращением' })).toBeVisible();
  });
  it('shows startup 503 with retry instead of login or a false empty list', async () => {
    let available = false; mockApi(path => path === '/auth/session' ? available ? reply({ user }) : failure(503, 'Сервис недоступен') : list()); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервис недоступен');
    expect(screen.queryByText('Пока нет привычек')).not.toBeInTheDocument();
    available = true; await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('link', { name: 'Читать', exact: true })).toBeVisible();
  });
  it('retains a verified session and private list on refresh 503', async () => {
    let unavailable = false; mockApi(path => path === '/auth/session' ? reply({ user }) : unavailable ? failure(503, 'Временный сбой') : list()); mount();
    await screen.findByRole('link', { name: 'Читать', exact: true }); unavailable = true;
    act(() => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Временный сбой');
    expect(screen.getByRole('link', { name: 'Читать', exact: true })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'С возвращением' })).not.toBeInTheDocument();
  });
  it('blocks duplicate login while pending and retains credentials after API rejection', async () => {
    const pending = deferred<Response>(); let submissions = 0;
    mockApi(path => { if (path === '/auth/login') { submissions++; return pending.promise; } return failure(401, 'Нет сессии'); }); mount('/login');
    await screen.findByRole('heading', { name: 'С возвращением' }); const ui = await credentials();
    await ui.click(screen.getByRole('button', { name: 'Войти' })); expect(screen.getByRole('button', { name: 'Входим…' })).toBeDisabled();
    await ui.click(screen.getByRole('button', { name: 'Входим…' })); expect(submissions).toBe(1);
    await act(async () => pending.resolve(failure(401, 'Неверный email или пароль')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный email или пароль');
    expect(screen.getByLabelText('Email')).toHaveValue(user.email); expect(screen.getByLabelText('Пароль')).toHaveValue('valid password');
  });
  it('validates registration password before network and shows timezone/recovery terms', async () => {
    let registrations = 0; mockApi(path => { if (path === '/auth/register') registrations++; return failure(401, 'Нет сессии'); }); mount('/register');
    await screen.findByRole('heading', { name: 'Начните свой ритм' }); const ui = await credentials('short');
    expect(screen.getByText(/Восстановление пароля в этой версии недоступно/)).toBeVisible();
    await ui.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('от 8 до 128'); expect(registrations).toBe(0);
  });
  it('successful registration keeps account separate from login and preserves a safe return URL', async () => {
    let body: any; mockApi((path, init) => { if (path === '/auth/register') { body = JSON.parse(init.body as string); return reply({ user }, 201); } return failure(401, 'Нет сессии'); });
    render(<MemoryRouter initialEntries={[{ pathname: '/register', state: { from: '/habits/h?month=2026-10' } }]}><App/></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Начните свой ритм' }); const ui = await credentials(); await ui.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Аккаунт создан'); expect(body).toMatchObject({ email: user.email, password: 'valid password', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    expect(screen.getByRole('heading', { name: 'С возвращением' })).toBeVisible();
  });
  it('late initial session response cannot overwrite a newer explicit login', async () => {
    const pending = deferred<Response>(); mockApi(path => path === '/auth/session' ? pending.promise : path === '/auth/login' ? reply({ user }) : list());
    function Probe() { const s = useApp(); return <><span data-testid="user">{s.user?.email || 'guest'}</span><button onClick={() => void s.login(user.email, 'password')}>Sign in</button></>; }
    render(<AppProvider><Probe/></AppProvider>); await userEvent.click(screen.getByText('Sign in')); await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent(user.email));
    await act(async () => pending.resolve(reply({ user: { ...user, email: 'stale@example.test' } })));
    expect(screen.getByTestId('user')).toHaveTextContent(user.email);
  });
  it('protected 401 clears private data, modal and notice; late list cannot restore them', async () => {
    const pending = deferred<Response>(); let calls = 0;
    mockApi(path => path === '/auth/session' ? reply({ user }) : path === '/expired' ? failure(401, 'Истекла') : ++calls === 1 ? list() : pending.promise);
    let store: ReturnType<typeof useApp>;
    function Probe() { store = useApp(); return <div>{store.user?.email}{store.habits.map(h => h.name)}{store.notice}{store.modal?.type}</div>; }
    render(<AppProvider><Probe/></AppProvider>); await screen.findByText(/Читать/);
    act(() => { store.notify('private notice'); store.setModal({ type: 'create' }); void store.refreshHabits(); });
    await act(async () => { await store.request('/expired').catch(() => {}); });
    await act(async () => pending.resolve(list()));
    expect(store!.user).toBeNull(); expect(store!.habits).toEqual([]); expect(store!.modal).toBeNull(); expect(store!.notice).toBe(''); expect(store!.expired).toBe(true);
  });
});

describe('habit form uses real provider validation and API state', () => {
  it('restores focus to the invoking control after the native cancel (Escape) event', async () => {
    mockApi(path => path === '/auth/session' ? reply({ user }) : list()); mount();
    const opener = await screen.findByRole('button', { name: 'Редактировать: Читать' }); await userEvent.click(opener);
    const dialog = screen.getByRole('dialog'); screen.getByLabelText('Название привычки').focus();
    // jsdom does not synthesize native dialog cancel from a physical Escape key.
    fireEvent(dialog, new Event('cancel', { cancelable: true, bubbles: false })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(opener).toHaveFocus();
  });
  it('wraps Tab and Shift+Tab inside the modal instead of leaving to browser chrome', async () => {
    mockApi(path => path === '/auth/session' ? reply({ user }) : list()); mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Редактировать: Читать' }));
    const first = screen.getByRole('button', { name: 'Закрыть' }), last = screen.getByRole('button', { name: 'Сохранить', exact: true });
    first.focus(); fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Tab' }); expect(first).toHaveFocus();
  });
  it('rejects whitespace names, blocks duplicate saves, retains form on failure and closes after retry', async () => {
    const pending = deferred<Response>(); let saves = 0;
    mockApi(path => { if (path === '/auth/session') return reply({ user }); if (path === '/habits') return list(); if (path === '/habits/h') { saves++; return saves === 1 ? pending.promise : reply({ habit, today, timeZone: 'UTC' }); } throw Error(path); }); mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Редактировать: Читать' })); const ui = userEvent.setup();
    const name = screen.getByLabelText('Название привычки'); await ui.clear(name); await ui.type(name, '   '); await ui.click(screen.getByRole('button', { name: 'Сохранить', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Название должно'); expect(saves).toBe(0);
    await ui.clear(name); await ui.type(name, 'Новое имя'); await ui.click(screen.getByRole('button', { name: 'Сохранить', exact: true }));
    expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled();
    await act(async () => pending.resolve(failure(503, 'Сохранение недоступно')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Сохранение недоступно'); expect(name).toHaveValue('Новое имя');
    await ui.click(screen.getByRole('button', { name: 'Сохранить', exact: true })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(saves).toBe(2);
  });
});
