'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiRequest } from '../../lib/api';

interface MerchantUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  merchant: { id: string; legalName: string; kycStatus: string; isEnabled: boolean } | null;
}

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<MerchantUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.replace('/login');
      return;
    }
    apiRequest<MerchantUser>('/v1/me', {}, token)
      .then((data: MerchantUser) => {
        if (data.role !== 'MERCHANT' || !data.merchant) {
          router.replace('/');
          return;
        }
        setUser(data);
      })
      .catch(() => {
        localStorage.removeItem('token');
        router.replace('/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.replace('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-cyan-400">
        Carregando painel...
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      <aside className="w-64 border-r border-slate-800 bg-slate-900/50 hidden md:flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold text-cyan-400 tracking-tight">PixSplit</h1>
          <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider">Painel do Comerciante</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <Link href="/merchant" className="block px-4 py-3 rounded-lg bg-cyan-500/10 text-cyan-400 font-medium border border-cyan-500/20">
            Dashboard
          </Link>
          <Link href="/merchant/wallets" className="block px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors">
            Carteiras
          </Link>
          <Link href="/merchant/api-keys" className="block px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors">
            API Keys
          </Link>
          <Link href="/merchant/payments" className="block px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors">
            Pagamentos
          </Link>
        </nav>
        <div className="p-4 border-t border-slate-800">
          <div className="mb-3 px-2">
            <p className="text-sm font-medium text-slate-200 truncate">{user.merchant?.legalName}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
            <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded border ${
              user.merchant?.kycStatus === 'APPROVED' 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}>
              KYC: {user.merchant?.kycStatus ?? 'N/A'}
            </span>
          </div>
          <button onClick={handleLogout} className="w-full px-4 py-2 text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors border border-transparent hover:border-red-500/20">
            Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <header className="md:hidden h-14 border-b border-slate-800 bg-slate-900/80 backdrop-blur flex items-center justify-between px-4 sticky top-0 z-10">
          <span className="font-bold text-cyan-400">PixSplit</span>
          <button onClick={handleLogout} className="text-xs text-slate-400">Sair</button>
        </header>
        <div className="p-6 md:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}