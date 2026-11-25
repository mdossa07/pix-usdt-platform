'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';
import WorkspaceShell from '../../components/workspace-shell';
import { buildCsv } from '../../lib/csv';
import { calculateSettledCommissionUnits, formatUsdtUnits, getActionablePayments } from '../../lib/admin-metrics';

interface PaymentRecord {
  id: string;
  externalId: string;
  status: string;
  amountBrlCents: string;
  commissionUsdt: string | null;
  merchantNetUsdt: string | null;
  merchantTransferStatus: string | null;
  platformTransferStatus: string | null;
  createdAt: string;
  wallet: { label: string; exchangeName: string | null; networkCode: string; addressLast8: string };
  transfers: Array<{ kind: string; status: string; amountUsdt: string; txHash: string | null }>;
}

interface MerchantRecord {
  id: string;
  legalName: string;
  email: string;
  isEnabled: boolean;
  kycStatus: string;
  paymentsCount: number;
  totalVolumeBrlCents: string;
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorEmail: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface ProviderStatus {
  provider: string;
  enabled: boolean;
  adapterReady: boolean;
  credentialsConfigured: boolean;
  connection: string;
  paymentsMode: string;
  liveOperationsEnabled: boolean;
  pendingApprovals: string[];
}

interface AdminTwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  setupPending: boolean;
  recoveryCodesRemaining: number;
}

interface AdminTwoFactorSetup {
  secret: string;
  provisioningUri: string;
}

interface WalletReviewRecord {
  id: string;
  label: string;
  exchangeName: string;
  networkCode: string;
  addressLast8: string;
  walletType: string;
  holderName: string;
  holderCountry: string;
  vaspEntityCountry: string | null;
  status: string;
  isDefault: boolean;
  createdAt: string;
  merchant: {
    id: string;
    legalName: string;
    email: string;
    kycStatus: string;
    isEnabled: boolean;
  };
}

type Tab = 'overview' | 'merchants' | 'wallets' | 'reconciliation' | 'audit';

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('overview');
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [merchants, setMerchants] = useState<MerchantRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [wallets, setWallets] = useState<WalletReviewRecord[]>([]);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [twoFactorStatus, setTwoFactorStatus] = useState<AdminTwoFactorStatus | null>(null);
  const [twoFactorSetup, setTwoFactorSetup] = useState<AdminTwoFactorSetup | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorRecoveryCodes, setTwoFactorRecoveryCodes] = useState<string[] | null>(null);
  const [twoFactorRegenerateOpen, setTwoFactorRegenerateOpen] = useState(false);
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorNotice, setTwoFactorNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminDataRefresh, setAdminDataRefresh] = useState(0);

  const token = typeof window !== 'undefined' ? localStorage.getItem('pixsplit_authenticated') : null;

  useEffect(() => {
    if (!token) {
      window.location.replace('/login');
      return;
    }
    setLoading(true);
    apiRequest<AdminTwoFactorStatus>('/v1/admin/2fa/status', {}, token)
      .then(async (twoFactor) => {
        setTwoFactorStatus(twoFactor);
        if (!twoFactor.enabled) {
          setTab('overview');
          return null;
        }
        const [p, m, a, w, provider] = await Promise.all([
          apiRequest<PaymentRecord[]>('/v1/admin/payments', {}, token),
          apiRequest<MerchantRecord[]>('/v1/admin/merchants', {}, token),
          apiRequest<AuditEntry[]>('/v1/admin/audit', {}, token),
          apiRequest<WalletReviewRecord[]>('/v1/admin/wallets', {}, token),
          apiRequest<ProviderStatus>('/v1/admin/provider-status', {}, token),
        ]);
        return { p, m, a, w, provider };
      })
      .then((data) => {
        if (!data) return;
        setPayments(data.p);
        setMerchants(data.m);
        setAuditLogs(data.a);
        setWallets(data.w);
        setProviderStatus(data.provider);
      })
      .catch((err) => {
        if (err instanceof Error && ['unauthorized', 'two_factor_required'].includes(err.message)) {
          localStorage.removeItem('pixsplit_authenticated');
          localStorage.removeItem('pixsplit_token');
          sessionStorage.removeItem('pixsplit_csrf');
          window.location.assign('/login');
          return;
        }
        setError(err instanceof Error ? err.message : 'Falha ao carregar dados');
      })
      .finally(() => setLoading(false));
  }, [token, adminDataRefresh]);

  if (!token) return <div className="text-slate-500 p-8">Redirecionando para o acesso seguro…</div>;
  if (error) return <div className="text-red-700 p-8">{error}</div>;
  if (loading) return <div className="text-slate-500 p-8">Carregando painel administrativo...</div>;

  const formatBrl = (cents: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents) / 100);
  const formatUsdt = (val: string | null) => val ? `${Number(val).toFixed(4)} USDT` : '—';

  const statusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'text-emerald-700 bg-emerald-50 border-emerald-200';
      case 'PIX_PENDING': return 'text-amber-700 bg-amber-50 border-amber-200';
      case 'FAILED': return 'text-red-700 bg-red-50 border-red-200';
      default: return 'text-slate-500 bg-slate-100 border-slate-200';
    }
  };

  const totalCommission = calculateSettledCommissionUnits(payments);
  const completedCount = payments.filter(p => p.status === 'COMPLETED').length;
  const stuckPayments = getActionablePayments(payments);

  const handleRetrySettlement = async (paymentId: string) => {
    try {
      await apiRequest(`/v1/admin/payments/${paymentId}/retry`, { method: 'POST' }, token!);
      alert('Retentativa de liquidação enfileirada com sucesso.');
    } catch (err) {
      alert(`Erro: ${(err as Error).message}`);
    }
  };

  const handleToggleMerchant = async (merchantId: string, current: boolean) => {
    try {
      await apiRequest(`/v1/admin/merchants/${merchantId}`, { method: 'PATCH', body: JSON.stringify({ isEnabled: !current }) }, token!);
      setMerchants(prev => prev.map(m => m.id === merchantId ? { ...m, isEnabled: !current } : m));
    } catch (err) {
      alert(`Erro: ${(err as Error).message}`);
    }
  };

  const handleMerchantKyc = async (merchantId: string, kycStatus: 'APPROVED' | 'REJECTED') => {
    const message = kycStatus === 'APPROVED'
      ? 'Confirma que concluiu a análise documental e verificou a identidade e a titularidade deste comerciante?'
      : 'Confirma que a análise documental foi concluída e o cadastro deve ser rejeitado?';
    if (!window.confirm(message)) return;
    try {
      await apiRequest(`/v1/admin/merchants/${merchantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ kycStatus }),
      }, token!);
      setMerchants(prev => prev.map(merchant => merchant.id === merchantId
        ? { ...merchant, kycStatus, isEnabled: kycStatus === 'REJECTED' ? false : merchant.isEnabled }
        : merchant));
      setAuditLogs(await apiRequest<AuditEntry[]>('/v1/admin/audit', {}, token!));
    } catch (err) {
      alert(`Erro ao atualizar KYC: ${(err as Error).message}`);
    }
  };

  const handleWalletReview = async (walletId: string, status: 'VERIFIED' | 'REJECTED') => {
    const message = status === 'VERIFIED'
      ? 'Confirma que verificou a titularidade, a rede e os dados da carteira fora do sistema?'
      : 'Confirma a rejeição desta carteira após a análise?';
    if (!window.confirm(message)) return;
    try {
      await apiRequest(`/v1/admin/wallets/${walletId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }, token!);
      setWallets(prev => prev.map(wallet => wallet.id === walletId ? { ...wallet, status } : wallet));
      setAuditLogs(await apiRequest<AuditEntry[]>('/v1/admin/audit', {}, token!));
    } catch (err) {
      alert(`Erro ao revisar carteira: ${(err as Error).message}`);
    }
  };

  const exportCsv = () => {
    const header = ['ID Externo', 'Status', 'Valor PIX', 'Comissão USDT', 'Merchant Net', 'Transfer Merchant', 'Transfer Platform', 'Criado Em'];
    const rows = payments.map(p => [
      p.externalId,
      p.status,
      Number(p.amountBrlCents) / 100,
      p.commissionUsdt ?? '',
      p.merchantNetUsdt ?? '',
      p.merchantTransferStatus ?? '',
      p.platformTransferStatus ?? '',
      p.createdAt,
    ]);
    const blob = new Blob([buildCsv([header, ...rows])], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pixsplit_admin_export_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const beginTwoFactorSetup = async () => {
    if (!token) return;
    if (!twoFactorPassword) {
      setTwoFactorNotice('Informe sua senha atual para iniciar a configuração.');
      return;
    }
    setTwoFactorBusy(true);
    setTwoFactorNotice(null);
    try {
      const result = await apiRequest<AdminTwoFactorSetup>('/v1/admin/2fa/setup', {
        method: 'POST',
        body: JSON.stringify({ password: twoFactorPassword }),
      }, token);
      setTwoFactorSetup(result);
      setTwoFactorPassword('');
      setTwoFactorCode('');
      setTwoFactorNotice('Adicione esta chave ao aplicativo autenticador e confirme com o código de seis dígitos.');
    } catch (err) {
      setTwoFactorNotice(err instanceof Error ? err.message : 'Não foi possível iniciar a configuração.');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const enableTwoFactor = async () => {
    if (!token || twoFactorCode.length !== 6) return;
    setTwoFactorBusy(true);
    setTwoFactorNotice(null);
    try {
      const enabled = await apiRequest<{ enabledAt: string; recoveryCodes: string[]; csrfToken: string }>('/v1/admin/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ code: twoFactorCode }),
      }, token);
      sessionStorage.setItem('pixsplit_csrf', enabled.csrfToken);
      setTwoFactorRecoveryCodes(enabled.recoveryCodes);
      setTwoFactorStatus({
        enabled: true,
        enabledAt: enabled.enabledAt,
        setupPending: false,
        recoveryCodesRemaining: enabled.recoveryCodes.length,
      });
      setAdminDataRefresh(value => value + 1);
      setTwoFactorSetup(null);
      setTwoFactorCode('');
      setTwoFactorNotice('Autenticação de dois fatores ativada. No próximo acesso será solicitado o código do aplicativo.');
    } catch (err) {
      setTwoFactorNotice(err instanceof Error ? err.message : 'Não foi possível ativar o segundo fator.');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const regenerateTwoFactorRecoveryCodes = async () => {
    if (!token || !twoFactorPassword || twoFactorCode.length !== 6) return;
    setTwoFactorBusy(true);
    setTwoFactorNotice(null);
    try {
      const result = await apiRequest<{ recoveryCodes: string[] }>('/v1/admin/2fa/recovery-codes/regenerate', {
        method: 'POST',
        body: JSON.stringify({ password: twoFactorPassword, code: twoFactorCode }),
      }, token);
      const status = await apiRequest<AdminTwoFactorStatus>('/v1/admin/2fa/status', {}, token);
      setTwoFactorStatus(status);
      setTwoFactorRecoveryCodes(result.recoveryCodes);
      setTwoFactorPassword('');
      setTwoFactorCode('');
      setTwoFactorRegenerateOpen(false);
      setTwoFactorNotice('Novos códigos gerados. Os códigos anteriores não utilizados foram invalidados.');
    } catch (err) {
      setTwoFactorNotice(err instanceof Error ? err.message : 'Não foi possível regenerar os códigos.');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = twoFactorStatus?.enabled
    ? [
      { id: 'overview', label: 'Visão Geral' },
      { id: 'merchants', label: 'Comerciantes' },
      { id: 'wallets', label: 'Carteiras' },
      { id: 'reconciliation', label: 'Conciliação' },
      { id: 'audit', label: 'Auditoria' },
    ]
    : [{ id: 'overview', label: 'Segurança' }];

  return (
    <WorkspaceShell area="Administração">
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Painel Administrativo</h2>
          <p className="text-sm text-slate-500 mt-1">Gestão completa da plataforma PixSplit</p>
        </div>
        {twoFactorStatus?.enabled && (
          <button onClick={exportCsv} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg transition-colors">
            Exportar CSV
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-200 pb-px">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t.id ? 'bg-slate-100 text-emerald-700 border-b-2 border-emerald-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          {twoFactorStatus && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4" aria-label="Autenticação de dois fatores do administrador">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Segurança da conta administrativa</p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900">Autenticação de dois fatores (TOTP)</h3>
                  <p className="mt-1 text-sm text-slate-600">Use um aplicativo autenticador para proteger o acesso de superadministrador.</p>
                </div>
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${twoFactorStatus.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                  {twoFactorStatus.enabled ? 'Ativada' : 'Não ativada'}
                </span>
              </div>
              {twoFactorStatus.enabled ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">Segundo fator ativo desde {twoFactorStatus.enabledAt ? new Date(twoFactorStatus.enabledAt).toLocaleString('pt-BR') : 'a confirmação'}. O próximo login administrativo exigirá senha e código temporário.</p>
                  <p className="text-xs font-medium text-slate-500">Códigos de recuperação restantes: {twoFactorStatus.recoveryCodesRemaining}</p>
                  {twoFactorStatus.recoveryCodesRemaining <= 2 && <p className="text-sm font-medium text-amber-800">Restam poucos códigos de recuperação. Gere uma nova leva para manter opções de acesso.</p>}
                  {twoFactorRecoveryCodes && (
                    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
                      <div>
                        <p className="font-semibold text-amber-900">Guarde estes códigos agora</p>
                        <p className="mt-1 text-sm text-amber-800">Cada código de 128 bits só pode ser usado uma vez. Eles não serão exibidos novamente; guarde-os fora deste dispositivo.</p>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {twoFactorRecoveryCodes.map(code => <code key={code} className="rounded bg-white px-3 py-2 font-mono text-sm text-slate-900">{code}</code>)}
                      </div>
                      <button type="button" onClick={() => setTwoFactorRecoveryCodes(null)} className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100">Já guardei os códigos</button>
                    </div>
                  )}
                  {!twoFactorRecoveryCodes && (
                    <div className="space-y-3">
                      <button type="button" onClick={() => setTwoFactorRegenerateOpen(value => !value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                        {twoFactorRegenerateOpen ? 'Cancelar regeneração' : 'Gerar novos códigos de recuperação'}
                      </button>
                      {twoFactorRegenerateOpen && (
                        <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
                          <label className="text-sm font-medium text-slate-700">Senha atual
                            <input type="password" autoComplete="current-password" value={twoFactorPassword} onChange={e => setTwoFactorPassword(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2"/>
                          </label>
                          <label className="text-sm font-medium text-slate-700">Código TOTP
                            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={twoFactorCode} onChange={e => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono tracking-widest"/>
                          </label>
                          <button type="button" onClick={regenerateTwoFactorRecoveryCodes} disabled={twoFactorBusy || !twoFactorPassword || twoFactorCode.length !== 6} className="self-end rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                            {twoFactorBusy ? 'Validando...' : 'Regenerar códigos'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">A configuração é feita com um segredo exclusivo, cifrado no banco. O código de confirmação é necessário para ativar o segundo fator.</p>
                  {!twoFactorSetup ? (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label className="flex-1 text-sm font-medium text-slate-700">Confirme sua senha atual
                        <input type="password" autoComplete="current-password" value={twoFactorPassword} onChange={e => setTwoFactorPassword(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" placeholder="Senha da conta administrativa"/>
                      </label>
                      <button type="button" onClick={beginTwoFactorSetup} disabled={twoFactorBusy || !twoFactorPassword} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                        {twoFactorBusy ? 'Preparando...' : (twoFactorStatus.setupPending ? 'Gerar nova chave de configuração' : 'Configurar autenticador')}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chave secreta para cadastro manual</p>
                        <p className="mt-1 break-all rounded bg-white p-3 font-mono text-sm text-slate-900">{twoFactorSetup.secret}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">URI do aplicativo autenticador</p>
                        <textarea readOnly rows={3} value={twoFactorSetup.provisioningUri} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs text-slate-700"/>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <label className="flex-1 text-sm font-medium text-slate-700">Código de seis dígitos
                          <input value={twoFactorCode} onChange={e => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono tracking-widest" placeholder="000000"/>
                        </label>
                        <button type="button" onClick={enableTwoFactor} disabled={twoFactorBusy || twoFactorCode.length !== 6} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                          {twoFactorBusy ? 'Validando...' : 'Confirmar e ativar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {twoFactorNotice && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{twoFactorNotice}</p>}
            </section>
          )}
          {twoFactorStatus && !twoFactorStatus.enabled && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
              A autenticação de dois fatores é obrigatória para acessar dados e operações administrativas. Conclua a configuração do autenticador e guarde os códigos de recuperação para liberar o painel.
            </div>
          )}
          {twoFactorStatus?.enabled && (
            <>
          {twoFactorStatus?.enabled && providerStatus && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-4" aria-label="Situação da integração financeira">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">Integração financeira</p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900">{providerStatus.provider} · modo {providerStatus.paymentsMode.toUpperCase()}</h3>
                  <p className="mt-1 text-sm text-slate-600">Credenciais configuradas não significam que o provedor esteja homologado ou autorizado a movimentar fundos.</p>
                </div>
                <span className="inline-flex rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-800">
                  Pagamentos reais bloqueados
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-lg border border-amber-100 bg-white p-3">
                  <p className="text-slate-500">Credenciais</p>
                  <p className="mt-1 font-semibold text-slate-900">{providerStatus.credentialsConfigured ? 'Configuradas' : 'Ausentes'}</p>
                </div>
                <div className="rounded-lg border border-amber-100 bg-white p-3">
                  <p className="text-slate-500">Adaptador homologado</p>
                  <p className="mt-1 font-semibold text-slate-900">{providerStatus.adapterReady ? 'Sim' : 'Não'}</p>
                </div>
                <div className="rounded-lg border border-amber-100 bg-white p-3">
                  <p className="text-slate-500">Operação real habilitada</p>
                  <p className="mt-1 font-semibold text-slate-900">{providerStatus.liveOperationsEnabled ? 'Sim' : 'Não'}</p>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-800">Homologações pendentes</p>
                <ul className="grid list-disc gap-x-6 gap-y-1 pl-5 text-sm text-slate-700 md:grid-cols-2">
                  {providerStatus.pendingApprovals.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            </section>
          )}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Comissão liquidada</p>
              <p className="text-2xl font-bold text-emerald-700">{formatUsdtUnits(totalCommission)} USDT</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Transações Totais</p>
              <p className="text-2xl font-bold text-slate-900">{payments.length}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Taxa de Sucesso</p>
              <p className="text-2xl font-bold text-emerald-700">
                {payments.length > 0 ? Math.round((completedCount / payments.length) * 100) : 0}%
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Operações Pendentes</p>
              <p className={`text-2xl font-bold ${stuckPayments.length > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {stuckPayments.length}
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Últimas Transações</h3>
            {payments.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-slate-500">Nenhuma transação registrada.</div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wider">
                      <tr>
                        <th className="px-6 py-4">ID Externo</th>
                        <th className="px-6 py-4">Wallet</th>
                        <th className="px-6 py-4">Valor PIX</th>
                        <th className="px-6 py-4">Comissão</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Liquidações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payments.slice(0, 20).map((payment) => (
                        <tr key={payment.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-mono text-xs text-slate-700">{payment.externalId.slice(0, 12)}…</td>
                          <td className="px-6 py-4 text-slate-700 text-xs">
                            <span className="block text-slate-800">{payment.wallet.label}</span>
                            <span className="text-slate-500">{payment.wallet.networkCode.toUpperCase()} ···{payment.wallet.addressLast8}</span>
                          </td>
                          <td className="px-6 py-4 text-slate-800">{formatBrl(payment.amountBrlCents)}</td>
                          <td className="px-6 py-4 text-emerald-700 font-medium">{formatUsdt(payment.commissionUsdt)}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-block px-2.5 py-1 rounded border text-xs font-medium ${statusColor(payment.status)}`}>
                              {payment.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-xs space-y-1">
                            {payment.transfers.length === 0 ? (
                              <span className="text-slate-500">Pendentes</span>
                            ) : (
                              payment.transfers.map((t, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <span className={`w-1.5 h-1.5 rounded-full ${t.status === 'COMPLETED' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                  <span className="text-slate-500 uppercase">{t.kind.slice(0, 3)}</span>
                                  <span className="text-slate-700">{Number(t.amountUsdt).toFixed(4)}</span>
                                </div>
                              ))
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
            </>
          )}
        </div>
      )}

      {tab === 'merchants' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wider">
                <tr>
                  <th className="px-6 py-4">Nome Legal</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">KYC</th>
                  <th className="px-6 py-4">Pagamentos</th>
                  <th className="px-6 py-4">Volume Total</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {merchants.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-slate-800 font-medium">{m.legalName}</td>
                    <td className="px-6 py-4 text-slate-700">{m.email}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        m.kycStatus === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}>{m.kycStatus}</span>
                    </td>
                    <td className="px-6 py-4 text-slate-700">{m.paymentsCount}</td>
                    <td className="px-6 py-4 text-slate-800">{formatBrl(m.totalVolumeBrlCents)}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        m.isEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                      }`}>{m.isEnabled ? 'Ativo' : 'Inativo'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          disabled={!m.isEnabled && m.kycStatus !== 'APPROVED'}
                          onClick={() => handleToggleMerchant(m.id, m.isEnabled)}
                          title={!m.isEnabled && m.kycStatus !== 'APPROVED' ? 'Aprovação KYC necessária' : undefined}
                          className={`rounded border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            m.isEnabled ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {m.isEnabled ? 'Desativar' : 'Ativar'}
                        </button>
                        {m.kycStatus !== 'APPROVED' && m.kycStatus !== 'REJECTED' && (
                          <>
                            <button onClick={() => handleMerchantKyc(m.id, 'APPROVED')} className="rounded border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">Aprovar KYC</button>
                            <button onClick={() => handleMerchantKyc(m.id, 'REJECTED')} className="rounded border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50">Rejeitar</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

{tab === 'wallets' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            A aprovação aqui registra uma decisão administrativa. Antes de aprovar, confirme fora do PixSplit a titularidade, o endereço completo, a rede, o memo/tag quando aplicável e os requisitos do provedor/Travel Rule.
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {wallets.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-slate-500">Nenhuma carteira cadastrada.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-4">Comerciante</th>
                      <th className="px-5 py-4">Carteira</th>
                      <th className="px-5 py-4">Rede / destino</th>
                      <th className="px-5 py-4">Titular</th>
                      <th className="px-5 py-4">KYC / status</th>
                      <th className="px-5 py-4">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {wallets.map(wallet => (
                      <tr key={wallet.id}>
                        <td className="px-5 py-4">
                          <p className="font-medium text-slate-900">{wallet.merchant.legalName}</p>
                          <p className="mt-1 text-xs text-slate-500">{wallet.merchant.email}</p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-medium text-slate-800">{wallet.label}</p>
                          <p className="mt-1 text-xs text-slate-500">{wallet.exchangeName} · {wallet.walletType}</p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-medium text-slate-800">{wallet.networkCode.toUpperCase()}</p>
                          <p className="font-mono text-xs text-slate-500">••••{wallet.addressLast8}</p>
                        </td>
                        <td className="px-5 py-4 text-slate-700">{wallet.holderName}</td>
                        <td className="px-5 py-4">
                          <p className="text-xs text-slate-600">KYC {wallet.merchant.kycStatus}</p>
                          <span className={`mt-1 inline-flex rounded border px-2 py-1 text-xs ${wallet.status === 'VERIFIED' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : wallet.status === 'REJECTED' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{wallet.status}</span>
                        </td>
                        <td className="px-5 py-4">
                          {wallet.status !== 'DISABLED' && wallet.status !== 'VERIFIED' && (
                            <div className="flex gap-2">
                              <button onClick={() => handleWalletReview(wallet.id, 'VERIFIED')} disabled={wallet.merchant.kycStatus !== 'APPROVED' || !wallet.merchant.isEnabled} className="rounded border border-emerald-200 bg-white px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40">Verificar</button>
                              <button onClick={() => handleWalletReview(wallet.id, 'REJECTED')} className="rounded border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50">Rejeitar</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

            {tab === 'reconciliation' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-amber-700 text-sm font-medium">
              ⚠ {stuckPayments.length} operação(ões) em estado não-terminal detectada(s). Use "Reprocessar" para enfileirar nova tentativa de liquidação.
            </p>
          </div>
          {stuckPayments.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-emerald-700">
              ✓ Nenhuma operação pendente de conciliação. Todas as transações estão em estado terminal.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wider">
                  <tr>
                    <th className="px-6 py-4">ID Externo</th>
                    <th className="px-6 py-4">Status Atual</th>
                    <th className="px-6 py-4">Merchant Transfer</th>
                    <th className="px-6 py-4">Platform Transfer</th>
                    <th className="px-6 py-4">Valor</th>
                    <th className="px-6 py-4">Criado Em</th>
                    <th className="px-6 py-4">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stuckPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-mono text-xs text-slate-700">{p.externalId.slice(0, 16)}…</td>
                      <td className="px-6 py-4"><span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColor(p.status)}`}>{p.status}</span></td>
                      <td className="px-6 py-4 text-xs text-slate-500">{p.merchantTransferStatus ?? '—'}</td>
                      <td className="px-6 py-4 text-xs text-slate-500">{p.platformTransferStatus ?? '—'}</td>
                      <td className="px-6 py-4 text-slate-800">{formatBrl(p.amountBrlCents)}</td>
                      <td className="px-6 py-4 text-slate-500 text-xs">{new Date(p.createdAt).toLocaleString('pt-BR')}</td>
                      <td className="px-6 py-4">
                        <button onClick={() => handleRetrySettlement(p.id)} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded transition-colors">
                          Reprocessar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wider">
                <tr>
                  <th className="px-6 py-4">Data/Hora</th>
                  <th className="px-6 py-4">Ação</th>
                  <th className="px-6 py-4">Entidade</th>
                  <th className="px-6 py-4">ID Entidade</th>
                  <th className="px-6 py-4">Ator</th>
                  <th className="px-6 py-4">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.slice(0, 100).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-slate-500 text-xs whitespace-nowrap">{new Date(log.createdAt).toLocaleString('pt-BR')}</td>
                    <td className="px-6 py-4 text-emerald-700 font-medium text-xs">{log.action}</td>
                    <td className="px-6 py-4 text-slate-700 text-xs">{log.entityType}</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">{log.entityId.slice(0, 12)}…</td>
                    <td className="px-6 py-4 text-slate-700 text-xs">{log.actorEmail ?? 'system'}</td>
                    <td className="px-6 py-4 text-slate-500 text-xs max-w-xs truncate">{JSON.stringify(log.metadata ?? {})}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
    </WorkspaceShell>
  );
}