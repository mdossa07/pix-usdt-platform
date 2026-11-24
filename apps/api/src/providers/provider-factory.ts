import { config } from '../config.js';
import type { PaymentProvider } from './provider-contract.js';
import { FoxbitAdapter } from './foxbit/foxbit-adapter.js';
import { TransFiAdapter } from './transfi/transfi-adapter.js';

/**
 * Real-money adapters remain disabled until PIX collection, FX conversion,
 * recipient onboarding and both independent crypto payouts pass certification.
 * This central guard prevents workers and HTTP routes from sending real orders.
 */
export function createPaymentProvider(): PaymentProvider {
  if (config.PAYMENTS_MODE !== 'mock') {
    throw new Error('PROVIDER_HOMOLOGATION_REQUIRED: sandbox/live execution is disabled until the complete two-recipient flow is certified.');
  }

  return config.PAYMENT_PROVIDER === 'transfi'
    ? new TransFiAdapter()
    : new FoxbitAdapter('mock');
}
