'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';

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
  recentPayments: Array<{
    id: string;
    externalId: string;
    status: string;
    amountBrlCents: string;
    commissionUsdt: string | null;
    merchantNetUsdt: string | null;
    createdAt: string;
    transfers: Array<{ kind: string; status: string; amountUsdt: string; txHash: string | null }>;
  }>;
}

export default function MerchantDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    apiRequest<DashboardData>('/v1/dashboard', {}, token)
      .then(setData)
      .catch((err) => setError(err.message ?? 'Falha ao carregar dashboard'));
  }, []);

  if (error) {
    return <div className="text-red-400 p-8">{error}</div>;
  }

  if (!data) {
    return <div className="text-cyan-400 p-8">Carregando dashboard...</div>;
  }

  const formatBrl = (cents: string) => {
    const value = Number(cents) / 100;
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const formatUsdt = (val: string | null) => val ? `${Number(val).toFixed(4)} USDT` : '—';

  const statusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'PENDING': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'FAILED': return 'text-red-400 bg-red-500/10 border-red-500/20';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Dashboard</h2>
        <p className="text-sm text-slate-500 mt-1">Visão geral da sua operação PixSplit</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Recebido (Líquido)</p>
          <p className="text-2xl font-bold text-cyan-400">{formatUsdt(data.stats.merchantNetUsdt)}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Comissão Plataforma</p>
          <p className="text-2xl font-bold text-slate-300">{formatUsdt(data.stats.commissionUsdt)}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Pagamentos Totais</p>
          <p className="text-2xl font-bold text-slate-100">{data.stats.totalPayments}</p>
          <p className="text-xs text-slate-500 mt-1">{data.stats.pending} pendentes · {data.stats.completed} concluídos</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Carteiras Ativas</p>
          <p className="text-2xl font-bold text-slate-100">{data.stats.wallets}</p>
          {data.stats.pendingKyc && <p className="text-xs text-amber-400 mt-1">KYC pendente</p>}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Pagamentos Recentes</h3>
        {data.recentPayments.length === 0 ? (
          <div className="bg-slate-900/30 border border-slate-800 rounded-xl p-8 text-center text-slate-500">
            Nenhum pagamento registrado ainda.
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900/80 text-slate-400 uppercase text-xs tracking-wider">
                  <tr>
                    <th className="px-6 py-4">ID Externo</th>
                    <th className="px-6 py-4">Valor (BRL)</th>
                    <th className="px-6 py-4">Líquido Merchant</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {data.recentPayments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-slate-300">{payment.externalId.slice(0, 12)}…</td>
                      <td className="px-6 py-4 text-slate-200">{formatBrl(payment.amountBrlCents)}</td>
                      <td className="px-6 py-4 text-cyan-400 font-medium">{formatUsdt(payment.merchantNetUsdt)}</td>
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
  );
}