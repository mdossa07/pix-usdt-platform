import type {
  PaymentProvider,
  CreatePixChargeInput,
  PixCharge,
  SettlementLeg,
  TransferStatusResult,
} from '../provider-contract.js';
import { createHash } from 'node:crypto';

/**
 * Foxbit remains mock-only until the Partner account has written approval for
 * Fiat Gateway, sub-member/withdrawal permissions, sandbox credentials and the
 * exact Travel Rule + two-recipient settlement arrangement.
 *
 * Keep this adapter fail-closed even when instantiated directly. The central
 * provider factory and config guard are additional layers, not the only ones.
 */
export class FoxbitAdapter implements PaymentProvider {
  constructor(mode: 'mock' | 'sandbox' | 'live') {
    if (mode !== 'mock') {
      throw new Error(
        'FOXBIT_ADAPTER_NOT_HOMOLOGATED: do not create partner orders or withdrawals before written product approval and end-to-end sandbox certification.',
      );
    }
  }

  async createPixCharge(input: CreatePixChargeInput, idempotencyKey: string): Promise<PixCharge> {
    const reference = createHash('sha256').update(idempotencyKey || input.merchantReference).digest('hex').slice(0, 24);
    return {
      providerChargeId: `foxbit-mock-${reference}`,
      copyPaste: `MOCK-PIX-NOT-PAYABLE-foxbit-${reference}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
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
    if (!providerTransferId?.startsWith('mock-')) return null;
    return {
      status: 'COMPLETED',
      providerReference: providerTransferId,
    };
  }

  private mockSettlement(leg: 'merchant' | 'platform', idempotencyKey: string): SettlementLeg {
    const reference = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24);
    return {
      providerTransferId: `mock-${leg}-${reference}`,
      status: 'COMPLETED',
    };
  }
}
