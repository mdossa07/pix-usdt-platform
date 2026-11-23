'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Copy, CheckCircle2, XCircle, Clock, ShieldCheck } from 'lucide-react';

type CheckoutData = {
  id: string;
  externalId: string;
  status: string;
  amountBrlCents: string;
  pixCopyPaste: string;
  expiresAt: string | null;
  expired: boolean;
  description: string | null;
  merchant: { name: string };
  wallet: { networkCode: string; addressLast8: string };
  mode: string;
};

export default function CheckoutPage() {
  const params = useParams();
  const externalId = params.externalId as string;
  const [data, setData] = useState<CheckoutData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!externalId) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}/v1/checkout/${externalId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Pagamento não encontrado');
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message));
  }, [externalId]);

  const handleCopy = async () => {
    if (!data?.pixCopyPaste) return;
    await navigator.clipboard.writeText(data.pixCopyPaste);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatBrl = (cents: string) => {
    const value = Number(cents) / 100;
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  if (error) {
    return (
      <div className="checkout-page">
        <div className="checkout-card error">
          <XCircle size={48} />
          <h1>Erro</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="checkout-page">
        <div className="checkout-card loading">
          <Clock size={32} className="spin" />
          <p>Carregando pagamento...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-page">
      <div className="checkout-card">
        <header className="checkout-header">
          <ShieldCheck size={28} className="brand-icon" />
          <span className="brand-name">PixSplit Secure Checkout</span>
        </header>

        <div className="merchant-info">
          <span className="label">Cobrança de</span>
          <strong>{data.merchant.name}</strong>
        </div>

        <div className="amount-display">
          <span className="label">Valor a pagar</span>
          <span className="amount">{formatBrl(data.amountBrlCents)}</span>
        </div>

        {data.description && (
          <div className="description">
            <span className="label">Descrição</span>
            <p>{data.description}</p>
          </div>
        )}

        <div className="pix-section">
          <span className="label">PIX Copia e Cola</span>
          <div className="pix-box">
            <code>{data.pixCopyPaste}</code>
            <button onClick={handleCopy} className="copy-btn" aria-label="Copiar PIX">
              {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>

        <div className="status-bar">
          <span className={`status-badge ${data.status.toLowerCase().replace('_', '-')}`}>
            {data.status.replace(/_/g, ' ')}
          </span>
          {data.expired && <span className="expired-badge">EXPIRADO</span>}
        </div>

        <footer className="checkout-footer">
          <p className="disclaimer">
            ⚠️ Modo demonstração: este código PIX é fictício e não aceita pagamento real.
            Integração com Foxbit aguarda homologação.
          </p>
          <p className="network-info">
            Rede: {data.wallet.networkCode.toUpperCase()} · Carteira: ...{data.wallet.addressLast8}
          </p>
        </footer>
      </div>

      <style jsx global>{`
        .checkout-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0f172a;
          padding: 1rem;
          font-family: system-ui, -apple-system, sans-serif;
        }
        .checkout-card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 16px;
          padding: 2rem;
          max-width: 480px;
          width: 100%;
          color: #e2e8f0;
        }
        .checkout-card.error { text-align: center; color: #fca5a5; }
        .checkout-card.loading { text-align: center; color: #94a3b8; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .checkout-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 1.5rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid #334155;
        }
        .brand-icon { color: #22d3ee; }
        .brand-name { font-weight: 600; font-size: 0.9rem; color: #94a3b8; }
        .label { display: block; font-size: 0.75rem; color: #94a3b8; margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .merchant-info { margin-bottom: 1.5rem; }
        .merchant-info strong { font-size: 1.1rem; color: #f1f5f9; }
        .amount-display { margin-bottom: 1.5rem; }
        .amount { font-size: 2rem; font-weight: 700; color: #22d3ee; }
        .description { margin-bottom: 1.5rem; }
        .description p { margin: 0; color: #cbd5e1; font-size: 0.9rem; }
        .pix-section { margin-bottom: 1.5rem; }
        .pix-box {
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 0.75rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .pix-box code {
          flex: 1;
          font-size: 0.75rem;
          word-break: break-all;
          color: #94a3b8;
          font-family: monospace;
        }
        .copy-btn {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          background: #22d3ee;
          color: #0f172a;
          border: none;
          border-radius: 6px;
          padding: 0.5rem 0.75rem;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.2s;
        }
        .copy-btn:hover { background: #06b6d4; }
        .status-bar { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
        .status-badge {
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.25rem 0.75rem;
          border-radius: 999px;
          text-transform: uppercase;
          background: #334155;
          color: #e2e8f0;
        }
        .status-badge.pix-pending { background: #854d0e; color: #fef3c7; }
        .status-badge.completed { background: #166534; color: #dcfce7; }
        .status-badge.failed, .status-badge.canceled { background: #991b1b; color: #fecaca; }
        .expired-badge { background: #991b1b; color: #fecaca; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.75rem; border-radius: 999px; }
        .checkout-footer { border-top: 1px solid #334155; padding-top: 1rem; }
        .disclaimer { font-size: 0.75rem; color: #fbbf24; margin: 0 0 0.5rem; line-height: 1.4; }
        .network-info { font-size: 0.7rem; color: #64748b; margin: 0; }
      `}</style>
    </div>
  );
}