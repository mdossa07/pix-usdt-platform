import type {
  PaymentProvider,
  CreatePixChargeInput,
  PixCharge,
  SettlementLeg,
  TransferStatusResult,
} from '../provider-contract.js';
import { config } from '../../config.js';
import { createHash } from 'node:crypto';

/**
 * TransFi v3 adapter.
 *
 * The real flows must not be enabled until sender/recipient onboarding,
 * corridor-specific mandatory fields, PIX payment method discovery, MID
 * ownership, KYB/KYC, and two independent payout rails have been certified.
 */
export function mapTransFiChargeStatus(status: string): 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELED' {
  switch (status) {
    case 'fund_settled':
    case 'asset_settled':
    case 'completed':
      return 'PAID';
    case 'fund_failed':
    case 'fund_deposit_failed':
    case 'asset_settle_failed':
    case 'rejected':
    case 'failed':
    case 'cancelled':
      return 'CANCELED';
    case 'expired':
      return 'EXPIRED';
    default:
      return 'PENDING';
  }
}

export function mapTransFiTransferStatus(status: string): 'PENDING' | 'COMPLETED' | 'FAILED' {
  switch (status) {
    case 'asset_settled':
    case 'fund_settled':
    case 'completed':
      return 'COMPLETED';
    case 'asset_settle_failed':
    case 'fund_failed':
    case 'fund_deposit_failed':
    case 'rejected':
    case 'failed':
    case 'cancelled':
    case 'expired':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

export class TransFiAdapter implements PaymentProvider {
  constructor(mode: 'mock' | 'sandbox' | 'live' = config.PAYMENTS_MODE) {
    // Fail closed: the available implementation is not the complete v3 flow.
    // In particular, no customer sender/recipient registration or BRL PIX
    // payment-code discovery is wired into the current provider contract.
    if (mode !== 'mock') {
      throw new Error(
        'TRANSFI_ADAPTER_NOT_HOMOLOGATED: complete v3 sender/recipient onboarding, BRL PIX payment-method discovery and both payout legs before sandbox/live execution.',
      );
    }
  }

  async createPixCharge(input: CreatePixChargeInput, idempotencyKey: string): Promise<PixCharge> {
    return this.mockCreatePixCharge(input, idempotencyKey);
  }

  async getChargeStatus(_providerChargeId: string): Promise<'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELED'> {
    return 'PENDING';
  }

  async settleMerchantUsdt(
    _input: { merchantWallet: string; network: string; amountUsdt: string; beneficiary: CreatePixChargeInput['beneficiary'] },
    idempotencyKey: string,
  ): Promise<SettlementLeg> {
    return this.mockSettlement('merchant', idempotencyKey);
  }

  async settlePlatformCommission(
    _input: { platformWallet: string; network: string; amountUsdt: string },
    idempotencyKey: string,
  ): Promise<SettlementLeg> {
    return this.mockSettlement('platform', idempotencyKey);
  }

  async getTransferStatus(providerTransferId: string | null, idempotencyKey: string): Promise<TransferStatusResult | null> {
    if (!providerTransferId?.startsWith('tf-mock-')) return null;
    return {
      status: 'COMPLETED',
      providerReference: providerTransferId,
    };
  }

  private mockCreatePixCharge(input: CreatePixChargeInput, idempotencyKey: string): PixCharge {
    const reference = createHash('sha256').update(idempotencyKey || input.merchantReference).digest('hex').slice(0, 24);
    return {
      providerChargeId: `tf-mock-${reference}`,
      copyPaste: `MOCK-PIX-NOT-PAYABLE-transfi-${reference}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  private mockSettlement(leg: 'merchant' | 'platform', idempotencyKey: string): SettlementLeg {
    const reference = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24);
    return {
      providerTransferId: `tf-mock-settle-${leg}-${reference}`,
      status: 'COMPLETED',
    };
  }
}
