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
            {data.mode === 'mock'
              ? 'Ambiente de demonstração: este código PIX não aceita pagamentos reais.'
              : 'Confira o valor e o beneficiário no aplicativo do seu banco antes de confirmar.'}
          </p>
          <p className="network-info">Pagamento protegido · A confirmação é atualizada automaticamente nesta página.</p>
        </footer>
      </div>

      <style jsx global>{`

.checkout-page{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px 16px;background:#f6f8fb;color:#1b2f4b;font-family:Inter,'DM Sans',Arial,sans-serif}
.checkout-card{width:100%;max-width:440px;padding:28px;background:#fff;border:1px solid #e2e8ef;border-radius:14px;color:#1b2f4b;box-shadow:0 2px 8px rgba(30,54,85,.045)}
.checkout-card.error,.checkout-card.loading{text-align:center;color:#61738b}.checkout-card.error svg{color:#b93838}.checkout-card.loading svg{color:#087f5b}
.spin{animation:pixsplit-spin 1s linear infinite}@keyframes pixsplit-spin{to{transform:rotate(360deg)}}
.checkout-header{display:flex;align-items:center;gap:10px;margin-bottom:22px;padding-bottom:16px;border-bottom:1px solid #edf1f5}
.brand-icon{color:#087f5b;width:30px;height:30px;padding:6px;border-radius:8px;background:#edf7f2}
.brand-name{font-size:15px;font-weight:750;letter-spacing:-.3px;color:#1b2f4b}
.merchant-info{margin-bottom:18px}.label{display:block;margin-bottom:6px;color:#75859a;font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.075em}
.merchant-info strong{color:#263d59;font-size:15px;font-weight:700}
.amount-display{padding:15px 17px;margin-bottom:18px;border:1px solid #dfeae4;border-radius:9px;background:#f7fbf8}
.amount{display:block;color:#087653;font:750 32px/1.2 Inter,sans-serif;letter-spacing:-.75px;font-variant-numeric:tabular-nums}
.description{margin-bottom:17px}.description p{margin:0;color:#526781;font-size:13px}
.pix-section{margin-bottom:18px}.label-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.countdown{color:#946a23;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}.expired-text{color:#b42318}
.pix-box{display:flex;align-items:center;gap:9px;padding:11px;border:1px solid #dfe6ee;border-radius:8px;background:#fafbfd}
.pix-box code{flex:1;min-width:0;max-height:76px;overflow:auto;color:#526781;font:11px/1.55 ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere}
.copy-btn{display:flex;align-items:center;justify-content:center;gap:7px;flex-shrink:0;padding:9px 12px;border:1px solid #087f5b;border-radius:7px;background:#087f5b;color:#fff;font-size:12px;font-weight:650;white-space:nowrap}
.copy-btn:hover{background:#076b4d}
.status-feedback{display:flex;flex-direction:column;align-items:center;gap:7px;padding:15px 12px;margin-bottom:18px;border:1px solid transparent;border-radius:8px;text-align:center}
.status-feedback.pending{color:#946a23;background:#fffaf0;border-color:#efe2c7}
.status-feedback.completed{color:#087653;background:#f0f8f3;border-color:#d5eade}
.status-feedback.failed,.status-feedback.expired{color:#b42318;background:#fff5f4;border-color:#f0d3d0}
.status-feedback.default{color:#63758b;background:#f6f8fa;border-color:#e3e9ef}
.status-label{font-size:12px;font-weight:750;letter-spacing:.035em}.polling-indicator{color:#8291a2;font-size:10px}
.success-details{margin-bottom:16px;text-align:center}.success-details p{margin:0;color:#087653;font-size:12px;line-height:1.55}
.checkout-footer{padding-top:14px;border-top:1px solid #edf1f5}
.disclaimer{margin:0 0 7px;color:#75859a;font-size:10px;line-height:1.55}
.network-info{margin:0;color:#8793a3;font-size:10px;line-height:1.5}
@media(max-width:520px){.checkout-card{padding:21px 17px;border-radius:12px}.amount{font-size:29px}.copy-btn{padding:9px 10px}}

      `}</style>
    </div>
  );
}