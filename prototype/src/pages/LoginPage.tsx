import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../store';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../data/mock';
import { AuthLayout } from '../components/AuthLayout';
import { inputClass, primaryButton, secondaryButton } from '../components/ui';
import { Icon } from '../components/Icon';
export function LoginPage() {
  const { user, login } = useApp(); const location = useLocation();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const from: unknown = location.state?.from;
  const next = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !/[\\\u0000-\u0020\u007f]/.test(from) && !/%5c/i.test(from) && !/^\/(?:login|register)(?:[?#]|$)/.test(from) ? from : '/';
  // Only this render-driven redirect handles successful login, so it cannot race a second navigation to '/'.
  if (user) return <Navigate to={next} replace/>;
  async function enter(demo = false) { setBusy(true); setError(''); try { await login(demo ? DEMO_EMAIL : email, demo ? DEMO_PASSWORD : password); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  function submit(event: FormEvent) { event.preventDefault(); void enter(); }
  return <AuthLayout><p className="mb-3 text-xs font-semibold tracking-[0.18em] text-[#8a9d79]">РАДЫ ВАС ВИДЕТЬ</p><h2 className="font-serif text-[40px] leading-tight tracking-[-1px]">С возвращением</h2><p className="mt-3 text-sm leading-6 text-[#7a8578]">Ваши привычки ждут. Продолжим?</p>{location.state?.registered && <p role="status" className="mt-5 rounded-xl bg-[#e5eddf] p-3 text-sm text-[#385b3f]">Аккаунт создан. Войдите по email и паролю.</p>}
    <form onSubmit={submit} className="mt-9 space-y-5"><label className="block text-sm font-medium">Email<input autoComplete="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputClass} placeholder="you@example.com"/></label><label className="block text-sm font-medium">Пароль<input autoComplete="current-password" type="password" required value={password} onChange={e => setPassword(e.target.value)} className={inputClass} placeholder="Ваш пароль"/></label>{error && <p role="alert" className="rounded-xl bg-[#faeae3] p-3 text-sm text-[#a14c35]">{error}</p>}<button disabled={busy} className={`${primaryButton} w-full py-3.5`}>{busy ? 'Входим…' : 'Войти'}<Icon name="arrow" className="h-4 w-4"/></button></form>
    <p className="mt-6 text-center text-sm text-[#7a8578]">Ещё нет аккаунта? <Link className="font-semibold text-[#385c43] underline decoration-[#b6c6ad] underline-offset-4" to="/register">Зарегистрироваться</Link></p><div className="mt-9 border-t border-[#e0e5da] pt-7"><button onClick={() => void enter(true)} disabled={busy} className={`${secondaryButton} w-full`}><Icon name="leaf" className="h-4 w-4"/>Посмотреть демо</button><p className="mt-3 text-center text-xs leading-5 text-[#8a9387]">Можно просто попробовать, без регистрации.<br/><span className="text-[#6b7b69]">{DEMO_EMAIL} · {DEMO_PASSWORD}</span></p></div>
  </AuthLayout>;
}
