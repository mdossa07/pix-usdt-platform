'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../../lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const result = await apiRequest<{ token: string; user: { role: string } }>('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      localStorage.setItem('pixsplit_token', result.token);
      window.location.replace(result.user.role === 'SUPER_ADMIN' || result.user.role === 'ADMIN' ? '/admin' : '/merchant');
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível entrar.'); }
    finally { setLoading(false); }
  }

  return <main className="auth-shell"><section className="auth-card"><Link href="/" className="auth-brand"><span className="brand-mark">p</span><b>pixsplit</b></Link><div className="eyebrow">ÁREA DO CLIENTE</div><h1>Acesse sua conta</h1><p className="auth-lead">Entre para gerenciar suas carteiras e acompanhar as operações da sua plataforma.</p><form onSubmit={submit}><label>E-mail<input className="field" type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="voce@empresa.com"/></label><label>Senha<input className="field" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha"/></label>{error && <div className="auth-error">{error}</div>}<button className="primary-btn auth-submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'} <ArrowRight size={16}/></button></form><div className="auth-footer"><ShieldCheck size={16}/> Conexão segura · ambiente de desenvolvimento</div><p className="auth-switch">Ainda não tem conta? <Link href="/register">Criar cadastro</Link></p></section><aside className="auth-aside"><div className="auth-aside-content"><div className="auth-orb"><KeyRound size={28}/></div><div className="eyebrow">PIX · USDT · SPLIT AUTOMÁTICO</div><h2>Seu fluxo financeiro, em um só lugar.</h2><p>Cadastre endereços de recebimento, gere cobranças e acompanhe a distribuição de cada operação.</p><div className="auth-feature"><span>01</span> Carteiras externas cadastradas por usuário</div><div className="auth-feature"><span>02</span> Conversão e liquidação acompanhadas</div><div className="auth-feature"><span>03</span> Comissão da plataforma registrada por operação</div></div></aside></main>;
}
