export interface AdminPaymentMetric {
  status: string;
  transfers: readonly {
    kind: string;
    status: string;
    amountUsdt: string;
  }[];
}

const terminalPaymentStatuses = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED']);

export function calculateSettledCommission(payments: readonly AdminPaymentMetric[]): number {
  return payments.reduce((paymentTotal, payment) => {
    const settledForPayment = payment.transfers.reduce((transferTotal, transfer) => {
      if (transfer.kind !== 'PLATFORM_COMMISSION' || transfer.status !== 'COMPLETED') return transferTotal;
      const amount = Number(transfer.amountUsdt);
      return Number.isFinite(amount) && amount > 0 ? transferTotal + amount : transferTotal;
    }, 0);
    return paymentTotal + settledForPayment;
  }, 0);
}

export function countActionablePayments(payments: readonly Pick<AdminPaymentMetric, 'status'>[]): number {
  return payments.filter(({ status }) => (
    !terminalPaymentStatuses.has(status) && status !== 'PIX_PENDING'
  )).length;
}
