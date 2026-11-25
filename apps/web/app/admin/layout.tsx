'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiRequest } from '../../lib/api';

interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

function clearBrowserAuthState(): void {
  localStorage.removeItem('pixsplit_authenticated');
  localStorage.removeItem('pixsplit_token');
  localStorage.removeItem('token');
  sessionStorage.removeItem('pixsplit_csrf');
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const hasBrowserSessionMarker = localStorage.getItem('pixsplit_authenticated') === '1';

    if (!hasBrowserSessionMarker) {
      clearBrowserAuthState();
      router.replace('/login');
      setLoading(false);
      return () => { active = false; };
    }

    // The marker only indicates that login completed. The actual identity and
    // authorization are always verified by the API through the HttpOnly cookie.
    apiRequest<AdminUser>('/v1/me')
      .then(data => {
        if (!active) return;
        if (data.role !== 'SUPER_ADMIN') {
          router.replace(data.role === 'MERCHANT' ? '/merchant' : '/');
          return;
        }
        setUser(data);
      })
      .catch(() => {
        if (!active) return;
        clearBrowserAuthState();
        router.replace('/login');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [router]);

  const handleLogout = async () => {
    setLogoutError(null);
    try {
      // Server-side revocation must succeed before local state is cleared.
      await apiRequest('/v1/auth/logout', { method: 'POST' });
      clearBrowserAuthState();
      router.replace('/login');
    } catch {
      setLogoutError('Não foi possível encerrar a sessão no servidor. Verifique a conexão e tente novamente.');
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">Verificando acesso administrativo...</div>;
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex">
      <aside className="w-64 border-r border-slate-800 bg-slate-950/80 backdrop-blur hidden md:flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold text-cyan-400 tracking-tight">PixSplit Admin</h1>
          <p className="text-xs text-slate-500 mt-1">Painel de Controle</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <Link href="/admin" className="block px-4 py-3 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-medium">
            Dashboard
          </Link>
          <div className="pt-4 mt-4 border-t border-slate-800">
            <p className="px-4 text-xs uppercase tracking-wider text-slate-600 mb-2">Sistema</p>
            <button onClick={handleLogout} aria-label="Sair da conta" className="w-full text-left px-4 py-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm">
              Sair
            </button>
          </div>
        </nav>
        <div className="p-4 border-t border-slate-800">
          <p className="text-xs text-slate-500 truncate">{user.email}</p>
          <p className="text-[10px] text-slate-600 uppercase tracking-wider mt-0.5">Super Admin</p>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <header className="md:hidden border-b border-slate-800 p-4 flex items-center justify-between bg-slate-950/90 backdrop-blur sticky top-0 z-10">
          <span className="font-bold text-cyan-400">PixSplit Admin</span>
          <button onClick={handleLogout} aria-label="Sair da conta" className="text-xs text-slate-400">Sair</button>
        </header>
        <div className="p-6 md:p-10 max-w-7xl mx-auto">
          {logoutError && <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{logoutError}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
