'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../../lib/api';

interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (challengeToken) {
        const result = await apiRequest<{ csrfToken: string; user: AuthUser }>('/v1/auth/2fa/verify', {
          method: 'POST',
          body: JSON.stringify({ challengeToken, code: twoFactorCode }),
        });
        sessionStorage.setItem('pixsplit_csrf', result.csrfToken);
        localStorage.setItem('pixsplit_authenticated', '1');
        window.location.replace(result.user.role === 'SUPER_ADMIN' || result.user.role === 'ADMIN' ? '/admin' : '/merchant');
        return;
      }

      const result = await apiRequest<{
        csrfToken?: string;
        requiresTwoFactor?: boolean;
        challengeToken?: string;
        user?: AuthUser;
      }>('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (result.requiresTwoFactor && result.challengeToken) {
        setChallengeToken(result.challengeToken);
        setTwoFactorCode('');
        setPassword('');
        return;
      }

      if (!result.csrfToken || !result.user) throw new Error('Resposta de autenticação inválida.');
      sessionStorage.setItem('pixsplit_csrf', result.csrfToken);
      localStorage.setItem('pixsplit_authenticated', '1');
      window.location.replace(result.user.role === 'SUPER_ADMIN' || result.user.role === 'ADMIN' ? '/admin' : '/merchant');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível entrar.';
      setError(message === 'invalid_or_replayed_two_factor_code'
        ? 'Código temporário ou de recuperação inválido/já utilizado. Tente outro código.'
        : message === 'invalid_two_factor_challenge'
          ? 'O desafio expirou. Entre novamente com sua senha.'
          : message);
    } finally {
      setLoading(false);
    }
  }

  function restartLogin() {
    setChallengeToken(null);
    setTwoFactorCode('');
    setError('');
    setPassword('');
  }

  return <main className="auth-shell"><section className="auth-card"><Link href="/" className="auth-brand"><span className="brand-mark">p</span><b>pixsplit</b></Link><div className="eyebrow">ÁREA DO CLIENTE</div><h1>{challengeToken ? 'Confirme sua identidade' : 'Acesse sua conta'}</h1><p className="auth-lead">{challengeToken ? 'Digite o TOTP de seis dígitos ou um código de recuperação de uso único.' : 'Entre para gerenciar suas carteiras e acompanhar as operações da sua plataforma.'}</p><form onSubmit={submit}>
    {!challengeToken ? <>
      <label>E-mail<input className="field" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="voce@empresa.com"/></label>
      <label>Senha<input className="field" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha"/></label>
    </> : <>
      <label>Código autenticador ou recuperação<input className="field" type="text" inputMode="text" autoComplete="one-time-code" pattern="([0-9]{6}|[A-Fa-f0-9]{32})" maxLength={32} required value={twoFactorCode} onChange={e=>setTwoFactorCode(e.target.value.replace(/[^A-Fa-f0-9]/g, '').slice(0, 32).toUpperCase())} placeholder="000000 ou código de recuperação"/></label>
    </>}
    {error && <div className="auth-error">{error}</div>}
    <button className="primary-btn auth-submit" disabled={loading || (Boolean(challengeToken) && twoFactorCode.length !== 6 && twoFactorCode.length !== 32)}>{loading ? (challengeToken ? 'Validando...' : 'Entrando...') : (challengeToken ? 'Verificar código' : 'Entrar')} <ArrowRight size={16}/></button>
    {challengeToken && <button type="button" className="auth-switch mt-3 w-full" onClick={restartLogin}>Voltar para o login</button>}
  </form><div className="auth-footer"><ShieldCheck size={16}/> {challengeToken ? 'Segundo fator · código temporário' : 'Conexão segura · autenticação protegida'}</div>{!challengeToken && <p className="auth-switch">Ainda não tem conta? <Link href="/register">Criar cadastro</Link></p>}</section><aside className="auth-aside"><div className="auth-aside-content"><div className="auth-orb"><KeyRound size={28}/></div><div className="eyebrow">PIX · USDT · SPLIT AUTOMÁTICO</div><h2>Seu fluxo financeiro, em um só lugar.</h2><p>Cadastre endereços de recebimento, gere cobranças e acompanhe a distribuição de cada operação.</p><div className="auth-feature"><span>01</span> Carteiras externas cadastradas por usuário</div><div className="auth-feature"><span>02</span> Conversão e liquidação acompanhadas</div><div className="auth-feature"><span>03</span> Comissão da plataforma registrada por operação</div></div></aside></main>;
}
