import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../store';
import { secureNext } from '../lib/calendar';
import { AuthLayout } from '../components/AuthLayout';
import { inputClass, primaryButton } from '../components/ui';
import { Icon } from '../components/Icon';
export function LoginPage() {
  const { user, login, expired } = useApp(); const location = useLocation();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const from: unknown = location.state?.from;
  const next = secureNext(from);
  // Only this render-driven redirect handles successful login, so it cannot race a second navigation to '/'.
  if (user) return <Navigate to={next} replace/>;
  async function enter() { setBusy(true); setError(''); try { await login(email, password); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  function submit(event: FormEvent) { event.preventDefault(); void enter(); }
  return <AuthLayout><p className="mb-3 text-xs font-semibold tracking-[0.18em] text-[#8a9d79]">РАДЫ ВАС ВИДЕТЬ</p><h2 className="font-serif text-[40px] leading-tight tracking-[-1px]">С возвращением</h2><p className="mt-3 text-sm leading-6 text-[#7a8578]">Ваши привычки ждут. Продолжим?</p>{expired && <p role="alert" className="mt-5 rounded-xl bg-[#faeae3] p-3 text-sm">Сессия истекла. Войдите снова, чтобы продолжить.</p>}{location.state?.registered && <p role="status" className="mt-5 rounded-xl bg-[#e5eddf] p-3 text-sm text-[#385b3f]">Аккаунт создан. Войдите по email и паролю.</p>}
    <form onSubmit={submit} className="mt-9 space-y-5"><label className="block text-sm font-medium">Email<input autoComplete="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputClass} placeholder="you@example.com"/></label><label className="block text-sm font-medium">Пароль<input autoComplete="current-password" type="password" required value={password} onChange={e => setPassword(e.target.value)} className={inputClass} placeholder="Ваш пароль"/></label>{error && <p role="alert" className="rounded-xl bg-[#faeae3] p-3 text-sm text-[#a14c35]">{error}</p>}<button disabled={busy} className={`${primaryButton} w-full py-3.5`}>{busy ? 'Входим…' : 'Войти'}<Icon name="arrow" className="h-4 w-4"/></button></form>
    <p className="mt-6 text-center text-sm text-[#7a8578]">Ещё нет аккаунта? <Link className="font-semibold text-[#385c43] underline decoration-[#b6c6ad] underline-offset-4" to="/register" state={{ from: next }}>Зарегистрироваться</Link></p>
  </AuthLayout>;
}
