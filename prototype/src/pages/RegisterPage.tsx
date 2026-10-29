import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useApp } from '../store';
import { AuthLayout } from '../components/AuthLayout';
import { inputClass, primaryButton } from '../components/ui';
import { Icon } from '../components/Icon';
export function RegisterPage() {
  const { user, register } = useApp(); const navigate = useNavigate();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace/>;
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await register(email, password); navigate('/login', { state: { registered: true }, replace: true }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <AuthLayout><p className="mb-3 text-xs font-semibold tracking-[0.18em] text-[#8a9d79]">ПЕРВЫЙ МАЛЕНЬКИЙ ШАГ</p><h2 className="font-serif text-[40px] leading-tight tracking-[-1px]">Начните свой ритм</h2><p className="mt-3 text-sm leading-6 text-[#7a8578]">Место для ваших привычек и ежедневных побед.</p><form onSubmit={submit} className="mt-9 space-y-5"><label className="block text-sm font-medium">Email<input autoComplete="email" required type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} placeholder="you@example.com"/></label><label className="block text-sm font-medium">Пароль<input autoComplete="new-password" required type="password" value={password} onChange={e => setPassword(e.target.value)} className={inputClass} placeholder="Придумайте пароль"/></label><div className="flex gap-2 rounded-xl bg-[#edf0e6] p-3 text-xs leading-5 text-[#6c7c66]"><Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0"/><p>Ваш часовой пояс: <span className="font-medium">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>.<br/>Восстановление пароля в этой версии недоступно.</p></div>{error && <p role="alert" className="rounded-xl bg-[#faeae3] p-3 text-sm text-[#a14c35]">{error}</p>}<button disabled={busy} className={`${primaryButton} w-full py-3.5`}>{busy ? 'Создаём аккаунт…' : 'Зарегистрироваться'}<Icon name="arrow" className="h-4 w-4"/></button></form><p className="mt-6 text-center text-sm text-[#7a8578]">Уже с нами? <Link className="font-semibold text-[#385c43] underline decoration-[#b6c6ad] underline-offset-4" to="/login">Войти</Link></p></AuthLayout>;
}
