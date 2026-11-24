'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { apiRequest } from '../lib/api';

export default function WorkspaceShell({ children, area }: { children: ReactNode; area: string }) {
  const logout = async () => {
    try {
      await apiRequest('/v1/auth/logout', { method: 'POST' });
    } catch {
      // Clear local browser state even if the cookie has expired.
    } finally {
      localStorage.removeItem('pixsplit_authenticated');
      localStorage.removeItem('pixsplit_pending_payment_create');
      sessionStorage.removeItem('pixsplit_csrf');
      window.location.assign('/login');
    }
  };

  return (
    <div className="workspace-page-shell">
      <header className="workspace-topbar">
        <Link href="/" className="workspace-brand" aria-label="PixSplit — início">
          <span className="brand-mark">p</span>
          <span><span className="workspace-brand-name">pixsplit</span><span className="workspace-brand-caption">PAYMENTS PLATFORM</span></span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="workspace-area-label">{area}</span>
          <button
            type="button"
            onClick={logout}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
            aria-label="Sair da conta"
          >
            Sair
          </button>
        </div>
      </header>
      <main className="workspace-content">{children}</main>
    </div>
  );
}
