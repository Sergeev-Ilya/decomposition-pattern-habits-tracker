import { Link, Routes, Route } from 'react-router-dom';
import { AppProvider, useApp } from './store';
import { AppLayout } from './components/AppLayout';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { HabitPage } from './pages/HabitPage';
import { HabitDialog } from './components/HabitDialog';
import { primaryButton } from './components/ui';
function AppContent() {
  const { user, notice, authStatus, authError, checkSession } = useApp();
  if (authStatus === 'loading') return <div className="flex min-h-dvh items-center justify-center" role="status">Проверяем сессию…</div>;
  if (authStatus === 'error') return <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6"><p role="alert">{authError}</p><button className={primaryButton} onClick={() => void checkSession()}>Повторить</button></div>;
  return <><Routes><Route path="/login" element={<LoginPage/>}/><Route path="/register" element={<RegisterPage/>}/><Route element={<AppLayout/>}><Route path="/" element={<HomePage/>}/><Route path="/habits/:habitId" element={<HabitPage/>}/></Route><Route path="*" element={<div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-[#f7f8f2] p-6 text-[#314e39]"><p className="text-xs tracking-widest text-[#8e9e7f]">404</p><h1 className="text-center font-serif text-4xl">Страница не найдена</h1><Link to={user ? '/' : '/login'} className={primaryButton}>{user ? 'Мои привычки' : 'Войти'}</Link></div>}/></Routes><HabitDialog/>{notice && <div role="status" className="fixed bottom-6 left-1/2 z-50 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl bg-[#244e40] px-5 py-3 text-center text-sm text-white shadow-lg">{notice}</div>}</>;
}
export default function App() { return <AppProvider><AppContent/></AppProvider>; }
