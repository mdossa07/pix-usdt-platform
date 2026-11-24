'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiRequest } from '../../lib/api';

interface Wallet {
  id: string;
  label: string;
  networkCode: string;
  addressLast8: string;
  status: string;
  isDefault: boolean;
  createdAt: string;
}

interface WebhookEvent {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastTriggeredAt: string | null;
}

interface Payment {
  id: string;
  externalId: string;
  status: string;
  amountBrlCents: string;
  commissionUsdt: string | null;
  merchantNetUsdt: string | null;
  createdAt: string;
  transfers: Array<{ kind: string; status: string; amountUsdt: string; txHash: string | null }>;
}

interface DashboardData {
  merchant: { id: string; legalName: string; kycStatus: string };
  stats: {
    totalPayments: number;
    pending: number;
    completed: number;
    commissionUsdt: string;
    merchantNetUsdt: string;
    wallets: number;
    pendingKyc: boolean;
  };
  recentPayments: Payment[];
}

type Tab = 'dashboard' | 'wallets' | 'webhooks' | 'history';

export default function MerchantDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [data, setData] = useState<DashboardData | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const fetchDashboard = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest<DashboardData>('/v1/dashboard', {}, token);
      setData(res);
    } catch (err: any) {
      setError(err.message ?? 'Falha ao carregar dashboard');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchWallets = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest<Wallet[]>('/v1/merchant/wallets', {}, token);
      setWallets(res);
    } catch (err: any) {
      console.error('Failed to fetch wallets:', err);
    }
  }, [token]);

  const fetchWebhooks = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest<WebhookEvent[]>('/v1/merchant/webhooks', {}, token);
      setWebhooks(res);
    } catch (err: any) {
      console.error('Failed to fetch webhooks:', err);
    }
  }, [token]);

  const fetchHistory = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest<Payment[]>('/v1/merchant/payments?limit=100', {}, token);
      setPayments(res);
    } catch (err: any) {
      console.error('Failed to fetch history:', err);
    }
  }, [token]);

  useEffect(() => {
    fetchDashboard();
    fetchWallets();
    fetchWebhooks();
    fetchHistory();
  }, [fetchDashboard, fetchWallets, fetchWebhooks, fetchHistory]);

  const exportCsv = () => {
    if (!payments.length) return;
    const headers = ['ID Externo', 'Valor (BRL)', 'Líquido USDT', 'Comissão USDT', 'Status', 'Data'];
    const rows = payments.map(p => [
      p.externalId,
      (Number(p.amountBrlCents) / 100).toFixed(2),
      p.merchantNetUsdt ?? '',
      p.commissionUsdt ?? '',
      p.status,
      new Date(p.createdAt).toISOString()
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pixsplit_export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const formatBrl = (cents: string) => {
    const value = Number(cents) / 100;
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const formatUsdt = (val: string | null) => val ? `${Number(val).toFixed(4)} USDT` : '—';

  const statusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'text-emerald-700 bg-emerald-50 border-emerald-200';
      case 'PENDING': return 'text-amber-700 bg-amber-50 border-amber-200';
      case 'FAILED': return 'text-red-700 bg-red-50 border-red-200';
      default: return 'text-slate-500 bg-slate-100 border-slate-200';
    }
  };

  if (error) return <div className="text-red-700 p-8">{error}</div>;
  if (loading && !data) return <div className="text-emerald-700 p-8">Carregando...</div>;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'wallets', label: 'Carteiras' },
    { id: 'webhooks', label: 'Webhooks' },
    { id: 'history', label: 'Histórico' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Painel do Merchant</h2>
          <p className="text-sm text-slate-500 mt-1">{data?.merchant.legalName} · KYC: {data?.merchant.kycStatus}</p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === t.id
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'dashboard' && data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Recebido (Líquido)</p>
              <p className="text-2xl font-bold text-emerald-700">{formatUsdt(data.stats.merchantNetUsdt)}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Comissão Plataforma</p>
              <p className="text-2xl font-bold text-slate-700">{formatUsdt(data.stats.commissionUsdt)}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Pagamentos Totais</p>
              <p className="text-2xl font-bold text-slate-900">{data.stats.totalPayments}</p>
              <p className="text-xs text-slate-500 mt-1">{data.stats.pending} pendentes · {data.stats.completed} concluídos</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Carteiras Ativas</p>
              <p className="text-2xl font-bold text-slate-900">{data.stats.wallets}</p>
              {data.stats.pendingKyc && <p className="text-xs text-amber-700 mt-1">KYC pendente</p>}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Pagamentos Recentes</h3>
            {data.recentPayments.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-slate-500">
                Nenhum pagamento registrado ainda.
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wider">
                      <tr>
                        <th className="px-6 py-4">ID Externo</th>
                        <th className="px-6 py-4">Valor (BRL)</th>
                        <th className="px-6 py-4">Líquido Merchant</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Data</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.recentPayments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-mono text-xs text-slate-700">{payment.externalId.slice(0, 12)}…</td>
                          <td className="px-6 py-4 text-slate-800">{formatBrl(payment.amountBrlCents)}</td>
                          <td className="px-6 py-4 text-emerald-700 font-medium">{formatUsdt(payment.merchantNetUsdt)}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-block px-2.5 py-1 rounded border text-xs font-medium ${statusColor(payment.status)}`}>
                              {payment.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-500 text-xs">
                            {new Date(payment.createdAt).toLocaleString('pt-BR')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'wallets' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-800">Carteiras de Destino</h3>
            <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors">
              + Nova Carteira
            </button>
          </div>
          {wallets.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-slate-500">
              Nenhuma carteira cadastrada. Adicione uma para receber liquidações.
            </div>
          ) : (
            <div className="grid gap-4">
              {wallets.map(w => (
                <div key={w.id} className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm text-emerald-700">{w.networkCode}</span>
                      {w.isDefault && <span className="text-[10px] uppercase bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">Padrão</span>}
                      <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${w.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-700' : 'bg-slate-500/20 text-slate-500'}`}>{w.status}</span>
                    </div>
                    <p className="font-mono text-xs text-slate-500 truncate max-w-md">...{w.addressLast8}</p>
                  </div>
                  <button className="text-slate-500 hover:text-slate-700 text-sm">Editar</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'webhooks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-800">Webhooks Configurados</h3>
            <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors">
              + Novo Webhook
            </button>
          </div>
          {webhooks.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-slate-500">
              Nenhum webhook configurado.
            </div>
          ) : (
            <div className="grid gap-4">
              {webhooks.map(w => (
                <div key={w.id} className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm text-slate-800 truncate">{w.url}</span>
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${w.isActive ? 'bg-emerald-500/20 text-emerald-700' : 'bg-slate-500/20 text-slate-500'}`}>
                      {w.isActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {w.events.map(e => (
                      <span key={e} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{e}</span>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">Último disparo: {w.lastTriggeredAt ? new Date(w.lastTriggeredAt).toLocaleString('pt-BR') : 'Nunca'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-800">Histórico Completo</h3>
            <button
              onClick={exportCsv}
              disabled={payments.length === 0}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 text-sm font-medium rounded-lg transition-colors"
            >
              Exportar CSV
            </button>
          </div>
          {payments.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-slate-500">
              Nenhum pagamento encontrado.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wider">
                    <tr>
                      <th className="px-6 py-4">ID Externo</th>
                      <th className="px-6 py-4">Valor (BRL)</th>
                      <th className="px-6 py-4">Líquido USDT</th>
                      <th className="px-6 py-4">Comissão</th>
                      <th className="px-6 py-4">Merchant Transfer</th>
                      <th className="px-6 py-4">Platform Transfer</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map((p) => {
                      const merchantT = p.transfers.find(t => t.kind === 'MERCHANT');
                      const platformT = p.transfers.find(t => t.kind === 'PLATFORM_COMMISSION');
                      return (
                        <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-mono text-xs text-slate-700">{p.externalId.slice(0, 12)}…</td>
                          <td className="px-6 py-4 text-slate-800">{formatBrl(p.amountBrlCents)}</td>
                          <td className="px-6 py-4 text-emerald-700 font-medium">{formatUsdt(p.merchantNetUsdt)}</td>
                          <td className="px-6 py-4 text-slate-500">{formatUsdt(p.commissionUsdt)}</td>
                          <td className="px-6 py-4">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(merchantT?.status ?? 'PENDING')}`}>
                              {merchantT?.status ?? '—'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(platformT?.status ?? 'PENDING')}`}>
                              {platformT?.status ?? '—'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-block px-2.5 py-1 rounded border text-xs font-medium ${statusColor(p.status)}`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-500 text-xs">
                            {new Date(p.createdAt).toLocaleString('pt-BR')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}