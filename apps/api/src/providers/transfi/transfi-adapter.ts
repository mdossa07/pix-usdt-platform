import type {
  PaymentProvider,
  CreatePixChargeInput,
  PixCharge,
  SettlementLeg,
  TransferStatusResult,
} from '../provider-contract.js';
import { TransFiClient } from './transfi-client.js';
import { config } from '../../config.js';
import { createHash } from 'node:crypto';

/**
 * TransFi v3 Adapter — COBO/POBO model.
 *
 * Fluxo: pay-in PIX (BRL) → saldo MCA → dois payouts independentes (USDT).
 * Cada payout é uma ordem separada com idempotencyKey própria.
 *
 * Pendências externas (não bloqueiam implementação):
 * - Credenciais sandbox para testes reais
 * - Confirmação comercial COBO/POBO para comissão cross-MID
 * - KYC/KYB requirements por MID
 */
export class TransFiAdapter implements PaymentProvider {
  private readonly client: TransFiClient;
  private readonly mode: 'mock' | 'sandbox' | 'live';

  constructor() {
    this.client = new TransFiClient();
    this.mode = config.PAYMENTS_MODE as 'mock' | 'sandbox' | 'live';
  }

  async createPixCharge(input: CreatePixChargeInput, idempotencyKey: string): Promise<PixCharge> {
    if (this.mode === 'mock') {
      return this.mockCreatePixCharge(input, idempotencyKey);
    }

    const amountBrl = Number(input.amountBrlCents) / 100;

    const body = {
      type: 'payin',
      partnerId: input.merchantReference,
      purposeCode: 'PIX_PAYMENT',
      sourceCurrency: 'BRL',
      targetCurrency: 'USDT',
      amount: amountBrl.toFixed(2),
      paymentMethod: 'PIX',
      sender: {
        name: input.payer.name || 'Unknown',
        taxId: input.payer.taxId,
        email: input.payer.email,
      },
      beneficiary: {
        walletAddress: input.beneficiary.walletAddress,
        network: input.beneficiary.network,
        exchangeName: input.beneficiary.exchangeName,
        holderName: input.beneficiary.holderName,
        memo: input.beneficiary.memo,
      },
    };

    const response = await this.client.request<{
      id: string;
      status: string;
      pixQrCode?: string;
      pixCopyPaste?: string;
      expiresAt?: string;
    }>({
      method: 'POST',
      path: '/v3/orders',
      body,
      idempotencyKey,
    });

    return {
      providerChargeId: response.data.id,
      copyPaste: response.data.pixCopyPaste || '',
      qrCodeBase64: response.data.pixQrCode,
      expiresAt: response.data.expiresAt ? new Date(response.data.expiresAt) : new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  async getChargeStatus(providerChargeId: string): Promise<'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELED'> {
    if (this.mode === 'mock') {
      return 'PENDING';
    }

    const response = await this.client.request<{ status: string }>({
      method: 'GET',
      path: `/v3/orders/${providerChargeId}`,
    });

    switch (response.data.status) {
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
      // fund_processing, fund_deposited, asset_processing and manual_review
      // are deliberately non-final and must never trigger fulfillment.
      default:
        return 'PENDING';
    }
  }

  async settleMerchantUsdt(
    input: { merchantWallet: string; network: string; amountUsdt: string; beneficiary: CreatePixChargeInput['beneficiary'] },
    idempotencyKey: string,
  ): Promise<SettlementLeg> {
    if (this.mode === 'mock') {
      return this.mockSettlement('merchant', idempotencyKey);
    }

    const body = {
      type: 'payout',
      partnerId: idempotencyKey,
      purposeCode: 'MERCHANT_SETTLEMENT',
      sourceCurrency: 'USDT',
      targetCurrency: 'USDT',
      amount: input.amountUsdt,
      paymentMethod: 'CRYPTO_TRANSFER',
      beneficiary: {
        walletAddress: input.merchantWallet,
        network: input.network,
        exchangeName: input.beneficiary.exchangeName,
        holderName: input.beneficiary.holderName,
        memo: input.beneficiary.memo,
      },
    };

    const response = await this.client.request<{ id: string; status: string; txHash?: string }>({
      method: 'POST',
      path: '/v3/orders',
      body,
      idempotencyKey,
    });

    return {
      providerTransferId: response.data.id,
      status: this.mapOrderStatus(response.data.status),
      txHash: response.data.txHash,
    };
  }

  async settlePlatformCommission(
    input: { platformWallet: string; network: string; amountUsdt: string },
    idempotencyKey: string,
  ): Promise<SettlementLeg> {
    if (this.mode === 'mock') {
      return this.mockSettlement('platform', idempotencyKey);
    }

    const body = {
      type: 'payout',
      partnerId: idempotencyKey,
      purposeCode: 'PLATFORM_COMMISSION',
      sourceCurrency: 'USDT',
      targetCurrency: 'USDT',
      amount: input.amountUsdt,
      paymentMethod: 'CRYPTO_TRANSFER',
      beneficiary: {
        walletAddress: input.platformWallet,
        network: input.network,
      },
    };

    const response = await this.client.request<{ id: string; status: string; txHash?: string }>({
      method: 'POST',
      path: '/v3/orders',
      body,
      idempotencyKey,
    });

    return {
      providerTransferId: response.data.id,
      status: this.mapOrderStatus(response.data.status),
      txHash: response.data.txHash,
    };
  }

  async getTransferStatus(providerTransferId: string, _idempotencyKey: string): Promise<TransferStatusResult | null> {
    if (this.mode === 'mock') {
      return { status: 'COMPLETED', providerReference: providerTransferId };
    }

    try {
      const response = await this.client.request<{ status: string; txHash?: string }>({
        method: 'GET',
        path: `/v3/orders/${providerTransferId}`,
      });

      return {
        status: this.mapOrderStatus(response.data.status),
        txHash: response.data.txHash,
        providerReference: providerTransferId,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 404) {
        return null;
      }
      throw error;
    }
  }

  private mapOrderStatus(status: string): 'PENDING' | 'COMPLETED' | 'FAILED' {
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
      // initiated, fund_processing, fund_deposited, asset_processing,
      // approval_pending and manual_review remain non-final.
      default:
        return 'PENDING';
    }
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