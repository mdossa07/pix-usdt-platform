'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../../lib/api';

export default function RegisterPage() {
  const [form, setForm] = useState({ fullName:'', email:'', password:'', merchantType:'COMPANY', legalName:'', taxId:'' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const update = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const result = await apiRequest<{ csrfToken: string; user: { role: string } }>('/v1/auth/register', { method:'POST', body: JSON.stringify(form) });
      sessionStorage.setItem('pixsplit_csrf', result.csrfToken);
      localStorage.setItem('pixsplit_authenticated', '1');
      window.location.replace(result.user.role === 'SUPER_ADMIN' || result.user.role === 'ADMIN' ? '/admin' : '/merchant');
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível criar a conta.'); }
    finally { setLoading(false); }
  }
  return <main className="auth-shell auth-register"><section className="auth-card"><Link href="/" className="auth-brand"><span className="brand-mark">p</span><b>pixsplit</b></Link><div className="eyebrow">COMECE A UTILIZAR</div><h1>Crie sua conta</h1><p className="auth-lead">Cadastre sua operação. A ativação financeira depende de validação KYC e aprovação do provedor.</p><form onSubmit={submit}><label>Nome completo<input className="field" required minLength={3} value={form.fullName} onChange={e=>update('fullName',e.target.value)} placeholder="Seu nome"/></label><div className="form-row"><label>E-mail<input className="field" type="email" required value={form.email} onChange={e=>update('email',e.target.value)} placeholder="voce@empresa.com"/></label><label>Tipo de cadastro<select className="field" value={form.merchantType} onChange={e=>update('merchantType',e.target.value)}><option value="COMPANY">Empresa</option><option value="INDIVIDUAL">Pessoa física</option></select></label></div><label>Nome / razão social<input className="field" required value={form.legalName} onChange={e=>update('legalName',e.target.value)} placeholder="Nome cadastrado"/></label><label>CPF ou CNPJ (somente números)<input className="field" required inputMode="numeric" minLength={11} maxLength={14} value={form.taxId} onChange={e=>update('taxId',e.target.value.replace(/\D/g,''))} placeholder="00000000000"/></label><label>Senha (mínimo 12 caracteres)<input className="field" type="password" required minLength={12} value={form.password} onChange={e=>update('password',e.target.value)} placeholder="Crie uma senha forte"/></label>{error && <div className="auth-error">{error}</div>}<button className="primary-btn auth-submit" disabled={loading}>{loading ? 'Criando cadastro...' : 'Criar conta'} <ArrowRight size={16}/></button></form><div className="auth-footer"><ShieldCheck size={16}/> Seus dados sensíveis são criptografados no backend.</div><p className="auth-switch">Já possui uma conta? <Link href="/login">Entrar</Link></p></section><aside className="auth-aside"><div className="auth-aside-content"><div className="eyebrow">PLATAFORMA MULTIUSUÁRIO</div><h2>Receba em sua carteira. Acompanhe cada liquidação.</h2><p>O PixSplit foi projetado para atender diferentes usuários e empresas, com endereços de recebimento individualizados e histórico segregado.</p><div className="auth-feature"><span>✓</span> Carteiras de corretoras e VASPs</div><div className="auth-feature"><span>✓</span> Histórico individual por operação</div><div className="auth-feature"><span>✓</span> Comissão transparente de 2%</div></div></aside></main>;
}
