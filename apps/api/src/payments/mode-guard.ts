/**
 * Mock settlement may exercise the local ledger only in development/test.
 * Production never accepts simulated PIX confirmations or runs mock payout workers.
 */
export function canRunMockFinancialExecution(nodeEnv: string, paymentsMode: string): boolean {
  return nodeEnv !== 'production' && paymentsMode === 'mock';
}
