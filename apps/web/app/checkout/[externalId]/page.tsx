'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Copy, CheckCircle2, XCircle, Clock, ShieldCheck, Loader2, AlertTriangle } from 'lucide-react';

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

const POLL_INTERVAL_MS = 3000;
const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED'];

export default function CheckoutPage() {
  const params = useParams();
  const externalId = params.externalId as string;
  const [data, setData] = useState<CheckoutData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!externalId) return;
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
      const res = await fetch(`${baseUrl}/v1/checkout/${externalId}`);
      if (!res.ok) throw new Error('Pagamento não encontrado');
      const json = await res.json();
      setData(json);

      if (TERMINAL_STATUSES.includes(json.status) || json.expired) {
        setPolling(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
      setPolling(false);
    }
  }, [externalId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!polling) return;
    timerRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [polling, fetchStatus]);

  useEffect(() => {
    if (!data?.expiresAt) {
      setTimeLeft(null);
      return;
    }
    const updateCountdown = () => {
      const diff = new Date(data.expiresAt!).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft('Expirado');
        setPolling(false);
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
    };
    updateCountdown();
    const countdownTimer = setInterval(updateCountdown, 1000);
    return () => clearInterval(countdownTimer);
  }, [data?.expiresAt]);

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

  const getStatusVisual = (status: string, expired: boolean) => {
    if (expired) return { icon: AlertTriangle, label: 'EXPIRADO', className: 'expired' };
    switch (status) {
      case 'COMPLETED':
        return { icon: CheckCircle2, label: 'PAGAMENTO CONFIRMADO', className: 'completed' };
      case 'FAILED':
      case 'CANCELED':
        return { icon: XCircle, label: status.replace(/_/g, ' '), className: 'failed' };
      case 'PIX_PENDING':
      case 'PENDING':
        return { icon: Loader2, label: 'AGUARDANDO PAGAMENTO', className: 'pending', spin: true };
      default:
        return { icon: Clock, label: status.replace(/_/g, ' '), className: 'default' };
    }
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
          <Loader2 size={32} className="spin" />
          <p>Carregando pagamento...</p>
        </div>
      </div>
    );
  }

  const visual = getStatusVisual(data.status, data.expired);
  const StatusIcon = visual.icon;
  const isTerminal = TERMINAL_STATUSES.includes(data.status) || data.expired;

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

        {!isTerminal && (
          <div className="pix-section">
            <div className="label-row">
              <span className="label">PIX Copia e Cola</span>
              {timeLeft && <span className={`countdown ${timeLeft === 'Expirado' ? 'expired-text' : ''}`}>{timeLeft}</span>}
            </div>
            <div className="pix-box">
              <code>{data.pixCopyPaste}</code>
              <button onClick={handleCopy} className="copy-btn" aria-label="Copiar PIX">
                {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>
        )}

        <div className={`status-feedback ${visual.className}`}>
          <StatusIcon size={24} className={visual.spin ? 'spin' : ''} />
          <span className="status-label">{visual.label}</span>
          {polling && !isTerminal && <span className="polling-indicator">Atualizando automaticamente...</span>}
        </div>

        {isTerminal && data.status === 'COMPLETED' && (
          <div className="success-details">
            <p>Seu pagamento foi confirmado e o merchant já foi notificado.</p>
          </div>
        )}

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
        .label-row { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 0.25rem; }
        .countdown { font-size: 0.8rem; font-weight: 600; color: #fbbf24; font-variant-numeric: tabular-nums; }
        .expired-text { color: #f87171; }
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
        .status-feedback {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 1.5rem;
          text-align: center;
        }
        .status-feedback.pending { background: rgba(251, 191, 36, 0.1); color: #fbbf24; }
        .status-feedback.completed { background: rgba(34, 197, 94, 0.1); color: #4ade80; }
        .status-feedback.failed, .status-feedback.expired { background: rgba(248, 113, 113, 0.1); color: #f87171; }
        .status-feedback.default { background: rgba(148, 163, 184, 0.1); color: #94a3b8; }
        .status-label { font-size: 0.9rem; font-weight: 700; letter-spacing: 0.03em; }
        .polling-indicator { font-size: 0.7rem; opacity: 0.7; animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        .success-details { text-align: center; margin-bottom: 1.5rem; }
        .success-details p { margin: 0; color: #4ade80; font-size: 0.85rem; }
        .checkout-footer { border-top: 1px solid #334155; padding-top: 1rem; }
        .disclaimer { font-size: 0.75rem; color: #fbbf24; margin: 0 0 0.5rem; line-height: 1.4; }
        .network-info { font-size: 0.7rem; color: #64748b; margin: 0; }
      `}</style>
    </div>
  );
}