'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '../../lib/api';

interface MerchantUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  merchant: { id: string; legalName: string; kycStatus: string; isEnabled: boolean } | null;
}

function clearBrowserAuthState(): void {
  localStorage.removeItem('pixsplit_authenticated');
  localStorage.removeItem('pixsplit_token');
  localStorage.removeItem('token');
  sessionStorage.removeItem('pixsplit_csrf');
}

export default function MerchantLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const hasBrowserSessionMarker = localStorage.getItem('pixsplit_authenticated') === '1';
    const legacyToken = localStorage.getItem('pixsplit_token') ?? localStorage.getItem('token');

    if (!hasBrowserSessionMarker && !legacyToken) {
      router.replace('/login');
      setLoading(false);
      return () => { active = false; };
    }

    // New browser sessions authenticate with the HttpOnly cookie. The marker
    // only indicates that the browser has completed login; it is never a token.
    // A legacy JWT is passed only to support the existing gradual migration.
    apiRequest<MerchantUser>('/v1/me', {}, legacyToken ?? undefined)
      .then(data => {
        if (!active) return;
        if (data.role !== 'MERCHANT' || !data.merchant) {
          router.replace('/');
          return;
        }
        setAuthorized(true);
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Verificando sessão segura…
      </div>
    );
  }

  if (!authorized) return null;

  // Each merchant page owns its responsive WorkspaceShell. This layout is
  // deliberately only the server-session guard, avoiding a second legacy nav.
  return <>{children}</>;
}
