/** Exact token arithmetic. BigInt is used; Number/float arithmetic is never used for money. */
export function parseTokenUnits(amount: string, precision = 6): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(amount)) throw new Error('Invalid decimal amount');
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > precision) throw new Error('Amount exceeds token precision');
  return BigInt(whole!) * 10n ** BigInt(precision) + BigInt((fraction + '0'.repeat(precision)).slice(0, precision) || '0');
}

export function formatTokenUnits(units: bigint, precision = 6): string {
  if (units < 0n) throw new Error('Negative token amount');
  const scale = 10n ** BigInt(precision);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(precision, '0');
  return `${whole}.${fraction}`;
}

export function calculateUsdtSplit(netUsdt: string, commissionBps = 200, precision = 6) {
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) {
    throw new Error('commissionBps must be an integer between 0 and 10000');
  }
  const totalUnits = parseTokenUnits(netUsdt, precision);
  if (totalUnits <= 0n) throw new Error('netUsdt must be greater than zero');
  const commissionUnits = (totalUnits * BigInt(commissionBps)) / 10_000n;
  const merchantUnits = totalUnits - commissionUnits;
  return {
    totalUsdt: formatTokenUnits(totalUnits, precision),
    commissionUsdt: formatTokenUnits(commissionUnits, precision),
    merchantUsdt: formatTokenUnits(merchantUnits, precision),
    commissionBps,
    precision,
  };
}

/** Mock-only conversion: BRL cents × fixed USDT/BRL rate -> 6-decimal USDT units. */
export function mockBrlToUsdt(brlCents: bigint, rate: string): string {
  const rateUnits = parseTokenUnits(rate, 6);
  const usdtUnits = (brlCents * rateUnits) / 100n;
  return formatTokenUnits(usdtUnits, 6);
}
