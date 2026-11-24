'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';

interface PaymentRecord {
  id: string;
  externalId: string;
  status: string;
  amountBrlCents: string;
  commissionUsdt: string | null;
  merchantNetUsdt: string | null;
  createdAt: string;
  wallet: { label: string; exchangeName: string | null; networkCode: string; addressLast8: string };
  transfers: Array<{ kind: string; status: string; amountUsdt: string; txHash: string | null }>;
}

export default function AdminDashboard() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    apiRequest<PaymentRecord[]>('/v1/payments', {}, token)
      .then(setPayments)
      .catch((err) => setError(err.message ?? 'Falha ao carregar dados'));
  }, []);

  if (error) return <div className="text-red-400 p-8">{error}</div>;

  const formatBrl = (cents: string) => {
    const value = Number(cents) / 100;
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const formatUsdt = (val: string | null) => val ? `${Number(val).toFixed(4)} USDT` : '—';

  const statusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'PIX_PENDING': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'FAILED': return 'text-red-400 bg-red-500/10 border-red-500/20';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
    }
  };

  const totalCommission = payments.reduce((acc, p) => acc + Number(p.commissionUsdt ?? 0), 0);
  const completedCount = payments.filter(p => p.status === 'COMPLETED').length;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Painel Administrativo</h2>
        <p className="text-sm text-slate-500 mt-1">Visão global da plataforma PixSplit</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Comissão Acumulada</p>
          <p className="text-2xl font-bold text-cyan-400">{totalCommission.toFixed(4)} USDT</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Transações Totais</p>
          <p className="text-2xl font-bold text-slate-100">{payments.length}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Taxa de Sucesso</p>
          <p className="text-2xl font-bold text-emerald-400">
            {payments.length > 0 ? Math.round((completedCount / payments.length) * 100) : 0}%
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Todas as Transações</h3>
        {payments.length === 0 ? (
          <div className="bg-slate-900/30 border border-slate-800 rounded-xl p-8 text-center text-slate-500">
            Nenhuma transação registrada na plataforma.
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900/80 text-slate-400 uppercase text-xs tracking-wider">
                  <tr>
                    <th className="px-6 py-4">ID Externo</th>
                    <th className="px-6 py-4">Merchant Wallet</th>
                    <th className="px-6 py-4">Valor PIX</th>
                    <th className="px-6 py-4">Comissão (2%)</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Liquidações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {payments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-slate-300">{payment.externalId.slice(0, 12)}…</td>
                      <td className="px-6 py-4 text-slate-300 text-xs">
                        <span className="block text-slate-200">{payment.wallet.label}</span>
                        <span className="text-slate-500">{payment.wallet.networkCode.toUpperCase()} ···{payment.wallet.addressLast8}</span>
                      </td>
                      <td className="px-6 py-4 text-slate-200">{formatBrl(payment.amountBrlCents)}</td>
                      <td className="px-6 py-4 text-cyan-400 font-medium">{formatUsdt(payment.commissionUsdt)}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-block px-2.5 py-1 rounded border text-xs font-medium ${statusColor(payment.status)}`}>
                          {payment.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs space-y-1">
                        {payment.transfers.length === 0 ? (
                          <span className="text-slate-600">Pendentes</span>
                        ) : (
                          payment.transfers.map((t, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full ${t.status === 'COMPLETED' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                              <span className="text-slate-400 uppercase">{t.kind.slice(0, 3)}</span>
                              <span className="text-slate-300">{Number(t.amountUsdt).toFixed(4)}</span>
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
    </div>
  );
}