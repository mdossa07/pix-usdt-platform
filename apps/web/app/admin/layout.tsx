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

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.replace('/login');
      return;
    }
    apiRequest<AdminUser>('/v1/me', {}, token)
      .then((data: AdminUser) => {
        if (data.role !== 'SUPER_ADMIN') {
          router.replace('/merchant');
          return;
        }
        setUser(data);
        setLoading(false);
      })
      .catch(() => {
        localStorage.removeItem('token');
        router.replace('/login');
      });
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.replace('/login');
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
            <button onClick={handleLogout} className="w-full text-left px-4 py-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm">
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
          <button onClick={handleLogout} className="text-xs text-slate-400">Sair</button>
        </header>
        <div className="p-6 md:p-10 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}