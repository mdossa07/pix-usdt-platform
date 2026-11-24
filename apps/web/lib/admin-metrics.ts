export interface AdminPaymentMetric {
  status: string;
  transfers: readonly {
    kind: string;
    status: string;
    amountUsdt: string;
  }[];
}

const USDT_SCALE = 100_000_000n;
const terminalPaymentStatuses = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED']);

function decimalUsdtToUnits(value: string): bigint | null {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? '').padEnd(8, '0') || '0');
  return whole * USDT_SCALE + fractional;
}

export function calculateSettledCommissionUnits(payments: readonly AdminPaymentMetric[]): bigint {
  return payments.reduce((paymentTotal, payment) => {
    const settledForPayment = payment.transfers.reduce((transferTotal, transfer) => {
      if (transfer.kind !== 'PLATFORM_COMMISSION' || transfer.status !== 'COMPLETED') return transferTotal;
      const amount = decimalUsdtToUnits(transfer.amountUsdt);
      return amount !== null && amount > 0n ? transferTotal + amount : transferTotal;
    }, 0n);
    return paymentTotal + settledForPayment;
  }, 0n);
}

export function formatUsdtUnits(units: bigint, fractionDigits = 4): string {
  const digits = Math.max(0, Math.min(8, Math.trunc(fractionDigits)));
  const divisor = 10n ** BigInt(8 - digits);
  const rounded = (units + divisor / 2n) / divisor;
  const displayScale = 10n ** BigInt(digits);
  const whole = rounded / displayScale;
  const fraction = digits > 0
    ? (rounded % displayScale).toString().padStart(digits, '0')
    : '';
  const formattedWhole = new Intl.NumberFormat('pt-BR').format(whole);
  return digits > 0 ? `${formattedWhole},${fraction}` : formattedWhole;
}

export function countActionablePayments(payments: readonly Pick<AdminPaymentMetric, 'status'>[]): number {
  return payments.filter(({ status }) => (
    !terminalPaymentStatuses.has(status) && status !== 'PIX_PENDING'
  )).length;
}
