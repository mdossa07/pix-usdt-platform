'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

export default function HomePage() {
  const [message, setMessage] = useState('Verificando acesso seguro…');

  useEffect(() => {
    let active = true;
    const token = localStorage.getItem('pixsplit_token');
    if (!token) {
      window.location.replace('/login');
      return () => { active = false; };
    }

    apiRequest<{ role: string }>('/v1/me', {}, token)
      .then(user => {
        if (!active) return;
        window.location.replace(
          user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' ? '/admin' : '/merchant',
        );
      })
      .catch(() => {
        if (!active) return;
        localStorage.removeItem('pixsplit_token');
        setMessage('Sua sessão expirou. Redirecionando para o acesso…');
        window.location.replace('/login');
      });

    return () => { active = false; };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-lg font-semibold text-white">p</div>
        <h1 className="mt-5 text-lg font-semibold text-slate-900">PixSplit</h1>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
      </div>
    </main>
  );
}
