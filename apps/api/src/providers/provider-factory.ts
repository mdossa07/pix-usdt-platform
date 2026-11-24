import { config } from '../config.js';
import type { PaymentProvider } from './provider-contract.js';
import { FoxbitAdapter } from './foxbit/foxbit-adapter.js';
import { TransFiAdapter } from './transfi/transfi-adapter.js';

export function createPaymentProvider(): PaymentProvider {
  const provider = config.PAYMENT_PROVIDER;

  if (provider === 'transfi') {
    return new TransFiAdapter();
  }

  // Default to Foxbit (mock, sandbox or live depending on PAYMENTS_MODE)
  return new FoxbitAdapter(config.PAYMENTS_MODE);
}