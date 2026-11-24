export interface AdminPaymentMetric {
  status: string;
  commissionUsdt: string | null;
  platformTransferStatus: string | null;
}

const terminalPaymentStatuses = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED']);

export function calculateSettledCommission(payments: readonly AdminPaymentMetric[]): number {
  return payments.reduce((total, payment) => {
    if (payment.platformTransferStatus !== 'COMPLETED') return total;
    const amount = Number(payment.commissionUsdt ?? 0);
    return Number.isFinite(amount) && amount > 0 ? total + amount : total;
  }, 0);
}

export function countActionablePayments(payments: readonly Pick<AdminPaymentMetric, 'status'>[]): number {
  return payments.filter(({ status }) => (
    !terminalPaymentStatuses.has(status) && status !== 'PIX_PENDING'
  )).length;
}
