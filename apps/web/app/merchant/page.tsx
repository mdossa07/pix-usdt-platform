'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/api';
import WorkspaceShell from '../../components/workspace-shell';
import { buildCsv } from '../../lib/csv';

interface Wallet {
  id: string;
  label: string;
  exchangeName: string;
  networkCode: string;
  address: string;
  status: string;
  isVerified: boolean;
  isDefault: boolean;
  walletType: 'HOSTED' | 'SELF_HOSTED';
  holderName: string;
  createdAt: string;
}

interface Transfer {
  kind: string;
  status: string;
  amountUsdt: string;
  txHash: string | null;
}

interface Payment {
  id: string;
  externalId: string;
  status: string;
  amountBrlCents: string;
  commissionUsdt: string | null;
  merchantNetUsdt: string | null;
  createdAt: string;
  expiresAt: string | null;
  transfers: Transfer[];
}

interface DashboardData {
  mode: string;
  merchant: {
    legalName: string;
    kycStatus: string;
    isEnabled: boolean;
  };
  totals: {
    paymentsTotal: number;
    completed: number;
    volumeBrlCents: string;
    commissionUsdt: string;
    merchantNetUsdt: string;
    wallets: number;
  };
  statusCounts: Array<{ status: string; count: number; volumeBrlCents: string }>;
  recentPayments: Payment[];
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface WalletForm {
  label: string;
  exchangeName: string;
  networkCode: 'tron' | 'polygon';
  address: string;
  tag: string;
  walletType: 'HOSTED' | 'SELF_HOSTED';
  holderName: string;
  holderTaxId: string;
  vaspEntityCountry: string;
  makeDefault: boolean;
}

type Tab = 'overview' | 'operations' | 'wallets' | 'integration';

const initialWalletForm: WalletForm = {
  label: '',
  exchangeName: 'Binance',
  networkCode: 'tron',
  address: '',
  tag: '',
  walletType: 'HOSTED',
  holderName: '',
  holderTaxId: '',
  vaspEntityCountry: 'BR',
  makeDefault: false,
};

const statusLabels: Record<string, string> = {
  CREATED: 'Criada',
  PIX_PENDING: 'Aguardando PIX',
  PIX_CONFIRMED: 'PIX confirmado',
  CONVERSION_PENDING: 'Conversão pendente',
  CRYPTO_CREDITED: 'USDT creditado',
  COMMISSION_TRANSFER_PENDING: 'Taxa em transferência',
  MERCHANT_PAYOUT_PENDING: 'Repasse pendente',
  PLATFORM_PAYOUT_PENDING: 'Taxa pendente',
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  CANCELED: 'Cancelada',
  EXPIRED: 'Expirada',
  UNDER_REVIEW: 'Em análise',
  PENDING_VERIFICATION: 'Aguardando validação',
  VERIFIED: 'Verificada',
  REJECTED: 'Rejeitada',
  DISABLED: 'Desativada',
  CREATED_TRANSFER: 'Criada',
  SUBMITTED: 'Enviada',
  PENDING_TRAVEL_RULE: 'Aguardando Travel Rule',
  PROCESSING: 'Processando',
};

function formatBrl(cents: string | number): string {
  const value = Number(cents) / 100;
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatUsdt(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(number) + ' USDT'
    : '—';
}

function statusClass(status: string): string {
  if (status === 'COMPLETED' || status === 'VERIFIED') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'FAILED' || status === 'REJECTED') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'PIX_PENDING' || status.includes('PENDING') || status === 'UNDER_REVIEW') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function displayStatus(status: string): string {
  return statusLabels[status] ?? status.replaceAll('_', ' ').toLowerCase();
}

async function fingerprintPaymentIntent(payload: {
  amountBrlCents: number;
  walletId: string;
  description?: string;
}): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({
    amountBrlCents: payload.amountBrlCents,
    walletId: payload.walletId,
    description: payload.description?.trim() || null,
  }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function maskedAddress(address: string): string {
  if (!address) return '—';
  return address.length <= 12 ? address : address.slice(0, 6) + '…' + address.slice(-8);
}

export default function MerchantDashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showWalletForm, setShowWalletForm] = useState(false);
  const [walletForm, setWalletForm] = useState<WalletForm>(initialWalletForm);
  const [walletSubmitting, setWalletSubmitting] = useState(false);
  const [keyName, setKeyName] = useState('Integração principal');
  const [keySubmitting, setKeySubmitting] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentWalletId, setPaymentWalletId] = useState('');
  const [paymentDescription, setPaymentDescription] = useState('');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [createdCheckout, setCreatedCheckout] = useState<string | null>(null);
  const pendingPaymentIdempotency = useRef<{ fingerprint: string; key: string } | null>(null);

  const loadData = useCallback(async (authToken: string) => {
    setLoading(true);
    setPageError(null);
    try {
      const [dashboardResponse, walletResponse, paymentResponse, keyResponse] = await Promise.all([
        apiRequest<DashboardData>('/v1/dashboard', {}, authToken),
        apiRequest<Wallet[]>('/v1/wallets', {}, authToken),
        apiRequest<Payment[]>('/v1/payments', {}, authToken),
        apiRequest<{ keys: ApiKey[] }>('/v1/merchant/api-keys', {}, authToken),
      ]);
      setDashboard(dashboardResponse);
      setWallets(walletResponse);
      setPayments(paymentResponse);
      setApiKeys(keyResponse.keys);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível carregar os dados.';
      if (message === 'unauthorized') {
        localStorage.removeItem('pixsplit_token');
        window.location.assign('/login');
        return;
      }
      setPageError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem('pixsplit_token');
    if (!storedToken) {
      window.location.replace('/login');
      return;
    }
    setToken(storedToken);
    void loadData(storedToken);
  }, [loadData]);

  const pendingPayments = useMemo(() => {
    if (!dashboard) return 0;
    return dashboard.statusCounts
      .filter(item => !['COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED'].includes(item.status))
      .reduce((total, item) => total + item.count, 0);
  }, [dashboard]);

  const updateWalletForm = (field: keyof WalletForm, value: string | boolean) => {
    setWalletForm(current => ({ ...current, [field]: value }));
  };

  const refresh = async () => {
    if (token) await loadData(token);
  };

  const createWallet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setWalletSubmitting(true);
    setNotice(null);
    try {
      await apiRequest('/v1/wallets', {
        method: 'POST',
        body: JSON.stringify({
          label: walletForm.label.trim(),
          exchangeName: walletForm.walletType === 'SELF_HOSTED' ? 'Carteira própria' : walletForm.exchangeName,
          networkCode: walletForm.networkCode,
          address: walletForm.address.trim(),
          tag: walletForm.tag.trim() || undefined,
          walletType: walletForm.walletType,
          holderName: walletForm.holderName.trim(),
          holderTaxId: walletForm.walletType === 'HOSTED' ? walletForm.holderTaxId.replace(/\D/g, '') : undefined,
          holderCountry: 'BR',
          vaspEntityCountry: walletForm.walletType === 'HOSTED' ? walletForm.vaspEntityCountry : undefined,
          makeDefault: walletForm.makeDefault || wallets.length === 0,
        }),
      }, token);
      setWalletForm(initialWalletForm);
      setShowWalletForm(false);
      setNotice('Carteira cadastrada. O status ficará pendente até a validação exigida pelo provedor.');
      await loadData(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível cadastrar a carteira.');
    } finally {
      setWalletSubmitting(false);
    }
  };

  const setDefaultWallet = async (walletId: string) => {
    if (!token) return;
    setNotice(null);
    try {
      await apiRequest('/v1/wallets/' + walletId + '/default', { method: 'POST' }, token);
      setNotice('Carteira padrão atualizada.');
      await loadData(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível atualizar a carteira padrão.');
    }
  };

  const disableWallet = async (walletId: string) => {
    if (!token) return;
    const confirmed = window.confirm('Desativar esta carteira? Ela não ficará disponível para novas operações.');
    if (!confirmed) return;
    setNotice(null);
    try {
      await apiRequest('/v1/merchant/wallets/' + walletId, { method: 'DELETE' }, token);
      setNotice('Carteira desativada.');
      await loadData(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível desativar a carteira.');
    }
  };

  const createPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    const amount = Number(paymentAmount.replace(',', '.'));
    const wallet = wallets.find(item => item.id === paymentWalletId);
    if (!Number.isFinite(amount) || amount < 5 || amount > 100000 || !wallet || wallet.status !== 'VERIFIED' || !wallet.isVerified) {
      setNotice('Informe um valor entre R$ 5,00 e R$ 100.000,00 e selecione uma carteira verificada.');
      return;
    }

    const payload = {
      amountBrlCents: Math.round(amount * 100),
      walletId: paymentWalletId,
      description: paymentDescription.trim() || undefined,
    };

    setPaymentSubmitting(true);
    setNotice(null);
    setCreatedCheckout(null);

    try {
      const fingerprint = await fingerprintPaymentIntent(payload);
      const storageKey = 'pixsplit_pending_payment_create';
      let pending = pendingPaymentIdempotency.current;

      if (!pending || pending.fingerprint !== fingerprint) {
        try {
          const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as
            | { fingerprint: string; key: string }
            | null;
          pending = stored?.fingerprint === fingerprint && typeof stored.key === 'string'
            ? stored
            : null;
        } catch {
          pending = null;
        }
      }

      if (!pending) {
        pending = { fingerprint, key: crypto.randomUUID() };
      }

      pendingPaymentIdempotency.current = pending;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(pending));
      } catch {
        // The in-memory ref still preserves the key while the page stays open.
      }

      const result = await apiRequest<{
        id: string;
        externalId: string;
        mode: string;
        warning?: string;
      }>(
        '/v1/payments',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': pending.key },
          body: JSON.stringify(payload),
        },
        token,
      );

      pendingPaymentIdempotency.current = null;
      try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as
          | { fingerprint: string; key: string }
          | null;
        if (stored?.key === pending.key) sessionStorage.removeItem(storageKey);
      } catch {
        // Ignore storage cleanup failures after a successful API response.
      }

      setCreatedCheckout(result.externalId);
      setPaymentAmount('');
      setPaymentDescription('');
      setShowPaymentForm(false);
      setNotice(result.warning ?? 'Cobrança criada.');
      await loadData(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível criar a cobrança.');
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const createApiKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setKeySubmitting(true);
    setNotice(null);
    setNewSecret(null);
    try {
      const result = await apiRequest<{ keyId: string; prefix: string; secret: string; warning: string }>(
        '/v1/merchant/api-keys',
        { method: 'POST', body: JSON.stringify({ name: keyName.trim() || 'Integração' }) },
        token,
      );
      setNewSecret(result.secret);
      setKeyName('');
      setNotice('Chave criada. Copie o segredo agora: ele não será exibido novamente.');
      await loadData(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível criar a chave.');
    } finally {
      setKeySubmitting(false);
    }
  };

  const revokeApiKey = async (keyId: string) => {
    if (!token) return;
    const confirmed = window.confirm('Revogar esta chave? As integrações que a utilizam deixarão de autenticar.');
    if (!confirmed) return;
    setNotice(null);
    try {
      await apiRequest('/v1/merchant/api-keys/' + keyId, { method: 'DELETE' }, token);
      setNotice('Chave revogada.');
      await loadData(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível revogar a chave.');
    }
  };

  const copySecret = async () => {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret);
      setNotice('Segredo copiado.');
    } catch {
      setNotice('Não foi possível copiar automaticamente. Selecione e copie o segredo exibido.');
    }
  };

  const exportCsv = () => {
    if (!payments.length) return;
    const headers = ['ID externo', 'Valor PIX (BRL)', 'Repasse comerciante (USDT)', 'Taxa PixSplit (USDT)', 'Status', 'Data'];
    const rows = payments.map(payment => [
      payment.externalId,
      (Number(payment.amountBrlCents) / 100).toFixed(2),
      payment.merchantNetUsdt ?? '',
      payment.commissionUsdt ?? '',
      payment.status,
      new Date(payment.createdAt).toISOString(),
    ]);
    const blob = new Blob([buildCsv([headers, ...rows])], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pixsplit_operacoes_' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <WorkspaceShell area="Área do comerciante"><div className="py-16 text-center text-sm text-slate-500">Carregando dados da conta…</div></WorkspaceShell>;
  }

  if (pageError) {
    return <WorkspaceShell area="Área do comerciante"><div className="mx-auto max-w-3xl rounded-lg border border-red-200 bg-white p-6"><h2 className="font-semibold text-slate-900">Não foi possível carregar sua conta</h2><p className="mt-2 text-sm text-slate-600">{pageError}</p><button onClick={refresh} className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Tentar novamente</button></div></WorkspaceShell>;
  }

  if (!dashboard) {
    return <WorkspaceShell area="Área do comerciante"><div className="py-16 text-center text-sm text-slate-500">Não encontramos os dados da conta.</div></WorkspaceShell>;
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Visão geral' },
    { id: 'operations', label: 'Operações' },
    { id: 'wallets', label: 'Carteiras' },
    { id: 'integration', label: 'Integração API' },
  ];

  return (
    <WorkspaceShell area="Área do comerciante">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Conta do comerciante</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{dashboard.merchant.legalName}</h1>
            <p className="mt-1 text-sm text-slate-500">KYC: {displayStatus(dashboard.merchant.kycStatus)} · {dashboard.merchant.isEnabled ? 'Conta habilitada' : 'Ativação operacional pendente'}</p>
          </div>
          <button onClick={refresh} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Atualizar dados</button>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Navegação do comerciante">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={'whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ' + (activeTab === tab.id ? 'border-slate-900 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-900')}>
              {tab.label}
            </button>
          ))}
        </nav>

        {dashboard.mode === 'mock' && <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><strong>Ambiente de demonstração:</strong> os códigos PIX gerados não recebem pagamentos reais. Conversão e repasses USDT estão bloqueados até a homologação do provedor.</div>}
        {notice && <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{notice}</div>}
        {createdCheckout && <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm text-slate-700">Checkout criado: <code className="font-mono text-xs">{createdCheckout}</code></span><a className="text-sm font-medium text-slate-900 underline" href={`/checkout/${encodeURIComponent(createdCheckout)}`}>Abrir checkout</a></div>}

        {activeTab === 'overview' && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-5"><p className="text-xs text-slate-500">Volume PIX registrado</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{formatBrl(dashboard.totals.volumeBrlCents)}</p></div>
              <div className="rounded-lg border border-slate-200 bg-white p-5"><p className="text-xs text-slate-500">Seu repasse (98%)</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{formatUsdt(dashboard.totals.merchantNetUsdt)}</p></div>
              <div className="rounded-lg border border-slate-200 bg-white p-5"><p className="text-xs text-slate-500">Taxa PixSplit (2%)</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{formatUsdt(dashboard.totals.commissionUsdt)}</p></div>
              <div className="rounded-lg border border-slate-200 bg-white p-5"><p className="text-xs text-slate-500">Operações / pendentes</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{dashboard.totals.paymentsTotal} <span className="text-sm font-normal text-slate-500">/ {pendingPayments} pendentes</span></p></div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-semibold text-slate-900">Operações recentes</h2><p className="mt-1 text-xs text-slate-500">Dados retornados pela API da sua conta</p></div><button onClick={() => setActiveTab('operations')} className="text-sm font-medium text-slate-700 hover:text-slate-950">Ver todas</button></div>
              {dashboard.recentPayments.length === 0 ? <div className="px-5 py-12 text-center text-sm text-slate-500">Nenhuma operação registrada até o momento.</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3 font-medium">Referência</th><th className="px-5 py-3 font-medium">Valor PIX</th><th className="px-5 py-3 font-medium">Seu repasse</th><th className="px-5 py-3 font-medium">Taxa</th><th className="px-5 py-3 font-medium">Status</th><th className="px-5 py-3 font-medium">Data</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {dashboard.recentPayments.map(payment => <tr key={payment.id}><td className="px-5 py-3 font-mono text-xs text-slate-700">{payment.externalId}</td><td className="px-5 py-3 tabular-nums text-slate-800">{formatBrl(payment.amountBrlCents)}</td><td className="px-5 py-3 tabular-nums text-slate-800">{formatUsdt(payment.merchantNetUsdt)}</td><td className="px-5 py-3 tabular-nums text-slate-600">{formatUsdt(payment.commissionUsdt)}</td><td className="px-5 py-3"><span className={'inline-flex rounded border px-2 py-1 text-xs ' + statusClass(payment.status)}>{displayStatus(payment.status)}</span></td><td className="px-5 py-3 text-xs text-slate-500">{new Date(payment.createdAt).toLocaleString('pt-BR')}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'operations' && (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-slate-900">Histórico de operações</h2><p className="mt-1 text-sm text-slate-500">Acompanhe separadamente o repasse de 98% e a taxa de 2%.</p></div><div className="flex gap-2"><button onClick={() => { setShowPaymentForm(value => !value); setCreatedCheckout(null); }} disabled={!dashboard.merchant.isEnabled || dashboard.merchant.kycStatus !== 'APPROVED' || !wallets.some(wallet => wallet.status === 'VERIFIED')} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">{showPaymentForm ? 'Fechar' : 'Nova cobrança PIX'}</button><button onClick={exportCsv} disabled={payments.length === 0} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Exportar CSV</button></div></div>
            {showPaymentForm && <form onSubmit={createPayment} className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-2">
              <label className="text-sm text-slate-700">Valor da cobrança (BRL)<input required type="number" min="5" max="100000" step="0.01" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="150,00" /></label>
              <label className="text-sm text-slate-700">Carteira de recebimento<select required value={paymentWalletId} onChange={event => setPaymentWalletId(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Selecione uma carteira verificada</option>{wallets.filter(wallet => wallet.status === 'VERIFIED').map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.label} · {wallet.networkCode.toUpperCase()}</option>)}</select></label>
              <label className="text-sm text-slate-700 md:col-span-2">Descrição (opcional)<input maxLength={120} value={paymentDescription} onChange={event => setPaymentDescription(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Pedido ou referência" /></label>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 md:col-span-2">Esta cobrança será criada em modo de demonstração. O código PIX não é pagável e não deve ser enviado a clientes para cobrança real.</div>
              <div className="flex justify-end md:col-span-2"><button disabled={paymentSubmitting} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{paymentSubmitting ? 'Criando…' : 'Criar cobrança de demonstração'}</button></div>
            </form>}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              {payments.length === 0 ? <div className="px-5 py-12 text-center text-sm text-slate-500">Nenhuma operação encontrada.</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3 font-medium">Referência</th><th className="px-5 py-3 font-medium">Valor PIX</th><th className="px-5 py-3 font-medium">Repasse 98%</th><th className="px-5 py-3 font-medium">Taxa 2%</th><th className="px-5 py-3 font-medium">Repasse comerciante</th><th className="px-5 py-3 font-medium">Taxa plataforma</th><th className="px-5 py-3 font-medium">Status geral</th><th className="px-5 py-3 font-medium">Data</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {payments.map(payment => {
                        const merchantTransfer = payment.transfers.find(transfer => transfer.kind === 'MERCHANT_PAYOUT');
                        const platformTransfer = payment.transfers.find(transfer => transfer.kind === 'PLATFORM_COMMISSION');
                        return <tr key={payment.id}>
                          <td className="px-5 py-3 font-mono text-xs text-slate-700">{payment.externalId}</td>
                          <td className="px-5 py-3 tabular-nums">{formatBrl(payment.amountBrlCents)}</td>
                          <td className="px-5 py-3 tabular-nums">{formatUsdt(payment.merchantNetUsdt)}</td>
                          <td className="px-5 py-3 tabular-nums">{formatUsdt(payment.commissionUsdt)}</td>
                          <td className="px-5 py-3"><span className={'rounded border px-2 py-1 text-xs ' + statusClass(merchantTransfer?.status ?? 'PENDING')}>{displayStatus(merchantTransfer?.status ?? 'PENDING')}</span>{merchantTransfer?.txHash && <p className="mt-1 font-mono text-[10px] text-slate-500">{merchantTransfer.txHash.slice(0, 14)}…</p>}</td>
                          <td className="px-5 py-3"><span className={'rounded border px-2 py-1 text-xs ' + statusClass(platformTransfer?.status ?? 'PENDING')}>{displayStatus(platformTransfer?.status ?? 'PENDING')}</span>{platformTransfer?.txHash && <p className="mt-1 font-mono text-[10px] text-slate-500">{platformTransfer.txHash.slice(0, 14)}…</p>}</td>
                          <td className="px-5 py-3"><span className={'rounded border px-2 py-1 text-xs ' + statusClass(payment.status)}>{displayStatus(payment.status)}</span></td>
                          <td className="px-5 py-3 text-xs text-slate-500">{new Date(payment.createdAt).toLocaleString('pt-BR')}</td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'wallets' && (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-slate-900">Carteiras de destino</h2><p className="mt-1 text-sm text-slate-500">Endereços externos para recebimento de USDT. Não informe senhas ou chaves privadas.</p></div><button onClick={() => setShowWalletForm(value => !value)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">{showWalletForm ? 'Fechar formulário' : 'Adicionar carteira'}</button></div>

            {showWalletForm && (
              <form onSubmit={createWallet} className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-2">
                <label className="text-sm text-slate-700">Identificação da carteira<input required maxLength={60} value={walletForm.label} onChange={event => updateWalletForm('label', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Ex.: Binance principal" /></label>
                <label className="text-sm text-slate-700">Tipo de carteira<select value={walletForm.walletType} onChange={event => updateWalletForm('walletType', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"><option value="HOSTED">Corretora / VASP (custodial)</option><option value="SELF_HOSTED">Carteira própria (self-hosted)</option></select></label>
                {walletForm.walletType === 'HOSTED' && <label className="text-sm text-slate-700">Corretora / VASP<input required maxLength={80} value={walletForm.exchangeName} onChange={event => updateWalletForm('exchangeName', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Binance, Bybit, OKX..." /></label>}
                <label className="text-sm text-slate-700">Rede USDT<select value={walletForm.networkCode} onChange={event => updateWalletForm('networkCode', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"><option value="tron">TRON (TRC-20)</option><option value="polygon">Polygon</option></select></label>
                <label className="text-sm text-slate-700 md:col-span-2">Endereço público de depósito USDT<input required minLength={20} maxLength={128} value={walletForm.address} onChange={event => updateWalletForm('address', event.target.value.trim())} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm" placeholder={walletForm.networkCode === 'tron' ? 'Endereço iniciado por T…' : '0x…'} /></label>
                <label className="text-sm text-slate-700">Memo / Tag (opcional)<input maxLength={128} value={walletForm.tag} onChange={event => updateWalletForm('tag', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Se a corretora exigir" /></label>
                <label className="text-sm text-slate-700">Nome do titular<input required minLength={3} maxLength={120} value={walletForm.holderName} onChange={event => updateWalletForm('holderName', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></label>
                {walletForm.walletType === 'HOSTED' && <><label className="text-sm text-slate-700">CPF/CNPJ do titular (somente números)<input required minLength={11} maxLength={14} inputMode="numeric" value={walletForm.holderTaxId} onChange={event => updateWalletForm('holderTaxId', event.target.value.replace(/\D/g, ''))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-sm text-slate-700">País da entidade VASP<select value={walletForm.vaspEntityCountry} onChange={event => updateWalletForm('vaspEntityCountry', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"><option value="BR">Brasil</option><option value="US">Estados Unidos</option><option value="GB">Reino Unido</option><option value="AE">Emirados Árabes Unidos</option><option value="SG">Singapura</option><option value="OTHER">Outro país</option></select></label></>}
                <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2"><input type="checkbox" checked={walletForm.makeDefault} onChange={event => updateWalletForm('makeDefault', event.target.checked)} className="rounded border-slate-300" /> Definir como carteira padrão</label>
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 md:col-span-2">Apenas o endereço público e os dados de titularidade são necessários. Nunca informe senha da corretora, chave privada ou frase-semente. O cadastro não significa aprovação para liquidação; a validação do provedor ainda é necessária.</div>
                <div className="flex justify-end gap-2 md:col-span-2"><button type="button" onClick={() => setShowWalletForm(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700">Cancelar</button><button disabled={walletSubmitting} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{walletSubmitting ? 'Salvando…' : 'Salvar carteira'}</button></div>
              </form>
            )}

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              {wallets.length === 0 ? <div className="px-5 py-12 text-center text-sm text-slate-500">Nenhuma carteira cadastrada.</div> : (
                <div className="divide-y divide-slate-100">
                  {wallets.map(wallet => <div key={wallet.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-900">{wallet.label}</span><span className="text-xs text-slate-500">{wallet.exchangeName}</span>{wallet.isDefault && <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">Padrão</span>}<span className={'rounded border px-2 py-0.5 text-[11px] ' + statusClass(wallet.status)}>{displayStatus(wallet.status)}</span></div>
                      <p className="mt-1 font-mono text-xs text-slate-500">{wallet.networkCode.toUpperCase()} · {maskedAddress(wallet.address)}</p>
                      <p className="mt-1 text-xs text-slate-500">Titular: {wallet.holderName} · {wallet.walletType === 'HOSTED' ? 'Corretora / VASP' : 'Self-hosted'}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">{!wallet.isDefault && wallet.status === 'VERIFIED' && wallet.isVerified && <button onClick={() => setDefaultWallet(wallet.id)} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Tornar padrão</button>}{wallet.status !== 'DISABLED' && <button onClick={() => disableWallet(wallet.id)} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:border-red-200 hover:text-red-700">Desativar</button>}</div>
                  </div>)}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'integration' && (
          <section className="space-y-5">
            <div><h2 className="font-semibold text-slate-900">Chaves de API</h2><p className="mt-1 text-sm text-slate-500">Use uma chave para autenticar requisições do seu servidor à API PixSplit. O segredo é exibido apenas uma vez.</p></div>
            <form onSubmit={createApiKey} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row">
              <label className="flex-1 text-sm text-slate-700">Nome da integração<input required maxLength={80} value={keyName} onChange={event => setKeyName(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Ex.: Loja virtual" /></label>
              <button disabled={keySubmitting} className="self-end rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{keySubmitting ? 'Gerando…' : 'Gerar chave API'}</button>
            </form>
            {newSecret && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-950">Copie e guarde este segredo agora</p><p className="mt-1 text-xs text-amber-900">Por segurança, o segredo completo não será mostrado novamente após sair desta tela.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><code className="min-w-0 flex-1 break-all rounded border border-amber-200 bg-white p-3 text-xs text-slate-800">{newSecret}</code><button onClick={copySecret} className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-950">Copiar segredo</button></div></div>}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4"><h3 className="text-sm font-semibold text-slate-900">Chaves cadastradas</h3></div>
              {apiKeys.length === 0 ? <div className="px-5 py-10 text-center text-sm text-slate-500">Nenhuma chave criada.</div> : <div className="divide-y divide-slate-100">{apiKeys.map(key => <div key={key.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-slate-900">{key.name}</p><p className="mt-1 font-mono text-xs text-slate-500">{key.prefix}••••••••</p><p className="mt-1 text-xs text-slate-500">Criada em {new Date(key.createdAt).toLocaleString('pt-BR')} · Último uso: {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString('pt-BR') : 'Ainda não utilizada'}</p></div><div className="flex items-center gap-2"><span className={'rounded border px-2 py-1 text-xs ' + (key.revokedAt ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>{key.revokedAt ? 'Revogada' : 'Ativa'}</span>{!key.revokedAt && <button onClick={() => revokeApiKey(key.id)} className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:border-red-200 hover:text-red-700">Revogar</button>}</div></div>)}</div>}
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">Nunca coloque o segredo da API em código executado no navegador ou em repositórios públicos. Guarde-o somente no backend do seu sistema e assine as requisições conforme a documentação de integração.</div>
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
