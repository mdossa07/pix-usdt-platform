import type { PaymentProvider, CreatePixChargeInput, PixCharge, SettlementLeg } from '../provider-contract.js';
import { randomUUID } from 'node:crypto';

/**
 * Mock-safe Foxbit adapter. All methods return deterministic fake responses
 * when PAYMENTS_MODE === 'mock'. Real HTTP calls are gated behind an explicit
 * opt-in and never execute in this starter release.
 */
export class FoxbitAdapter implements PaymentProvider {
  constructor(private readonly mode: 'mock' | 'sandbox' | 'live') {}

  async createPixCharge(input: CreatePixChargeInput, idempotencyKey: string): Promise<PixCharge> {
    if (this.mode !== 'mock') {
      throw new Error('FoxbitAdapter live/sandbox flow is not approved yet. Keep PAYMENTS_MODE=mock.');
    }

    const providerChargeId = `foxbit-mock-${idempotencyKey.slice(-12)}`;
    return {
      providerChargeId,
      copyPaste: `00020126580014BR.GOV.BCB.PIX0136${randomUUID()}520400005303986540${(input.amountBrlCents / 100n).toString().padStart(4, '0')}5802BR5913PIX SPLIT LTDA6008SAO PAULO62070503***6304ABCD`,
      qrCodeBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jP0gAAAABJRU5ErkJggg==',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  async getChargeStatus(providerChargeId: string): Promise<'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELED'> {
    if (this.mode !== 'mock') {
      throw new Error('FoxbitAdapter live/sandbox status check is not approved yet.');
    }
    // In mock mode, charges are always considered PAID to allow orchestrator testing
    return 'PAID';
  }

  async settleMerchantUsdt(input: { merchantWallet: string; network: string; amountUsdt: string; beneficiary: CreatePixChargeInput['beneficiary']; }, idempotencyKey: string): Promise<SettlementLeg> {
    if (this.mode !== 'mock') {
      throw new Error('FoxbitAdapter live/sandbox settlement is not approved yet.');
    }

    return {
      providerTransferId: `mock-merchant-${idempotencyKey.slice(-12)}`,
      txHash: `0x${Buffer.from(idempotencyKey).toString('hex').slice(0, 64)}`,
      status: 'COMPLETED',
    };
  }

  async settlePlatformCommission(input: { platformWallet: string; network: string; amountUsdt: string; }, idempotencyKey: string): Promise<SettlementLeg> {
    if (this.mode !== 'mock') {
      throw new Error('FoxbitAdapter live/sandbox commission is not approved yet.');
    }

    return {
      providerTransferId: `mock-platform-${idempotencyKey.slice(-12)}`,
      txHash: `0x${Buffer.from(idempotencyKey + ':platform').toString('hex').slice(0, 64)}`,
      status: 'COMPLETED',
    };
  }
}