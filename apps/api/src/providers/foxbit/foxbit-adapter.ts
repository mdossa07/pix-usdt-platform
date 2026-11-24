import type { PaymentProvider, CreatePixChargeInput, PixCharge, SettlementLeg, TransferStatusResult } from '../provider-contract.js';
import { randomUUID } from 'node:crypto';
import { FoxbitClient } from './foxbit-client.js';
import { config } from '../../config.js';

// Response shapes from Foxbit Partner API v3
interface FiatGatewayOrderResponse {
  id: string;
  pix_copy_paste: string;
  pix_qr_code_base64: string;
  expires_at: string;
  status: string;
}

interface WithdrawalResponse {
  id: string;
  tx_hash: string | null;
  status: string;
}

/**
 * Foxbit Partner API v3 adapter.
 * - mock: deterministic fake responses for local dev/tests.
 * - sandbox/live: real HTTP calls via FoxbitClient (Fiat Gateway + Withdrawals).
 */
export class FoxbitAdapter implements PaymentProvider {
  private readonly client: FoxbitClient | null;

  constructor(private readonly mode: 'mock' | 'sandbox' | 'live') {
    if (mode !== 'mock') {
      this.client = new FoxbitClient({
        baseUrl: config.FOXBIT_API_BASE_URL,
        apiKey: config.FOXBIT_API_KEY,
        apiSecret: config.FOXBIT_API_SECRET,
      });
    } else {
      this.client = null;
    }
  }

  async createPixCharge(input: CreatePixChargeInput, idempotencyKey: string): Promise<PixCharge> {
    if (this.mode === 'mock') {
      const providerChargeId = `foxbit-mock-${idempotencyKey.slice(-12)}`;
      return {
        providerChargeId,
        copyPaste: `00020126580014BR.GOV.BCB.PIX0136${randomUUID()}520400005303986540${(input.amountBrlCents / 100n).toString().padStart(4, '0')}5802BR5913PIX SPLIT LTDA6008SAO PAULO62070503***6304ABCD`,
        qrCodeBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jP0gAAAABJRU5ErkJggg==',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      };
    }

    // Real flow: POST /v3/partners/fiat-gateway/orders
    const res = await this.client!.request<FiatGatewayOrderResponse>({
      method: 'POST',
      path: '/v3/partners/fiat-gateway/orders',
      body: {
        amount_brl_cents: Number(input.amountBrlCents),
        beneficiary: input.beneficiary,
      },
      idempotencyKey,
    });

    return {
      providerChargeId: res.id,
      copyPaste: res.pix_copy_paste,
      qrCodeBase64: res.pix_qr_code_base64,
      expiresAt: new Date(res.expires_at),
    };
  }

  async getChargeStatus(providerChargeId: string): Promise<'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELED'> {
    if (this.mode === 'mock') {
      return 'PAID';
    }

    // Real flow: GET /v3/partners/fiat-gateway/orders/:id
    const res = await this.client!.request<FiatGatewayOrderResponse>({
      method: 'GET',
      path: `/v3/partners/fiat-gateway/orders/${providerChargeId}`,
    });

    switch (res.status) {
      case 'COMPLETED':
      case 'SETTLED':
        return 'PAID';
      case 'EXPIRED':
        return 'EXPIRED';
      case 'CANCELED':
      case 'REFUNDED':
        return 'CANCELED';
      default:
        return 'PENDING';
    }
  }

  async settleMerchantUsdt(
    input: { merchantWallet: string; network: string; amountUsdt: string; beneficiary: CreatePixChargeInput['beneficiary'] },
    idempotencyKey: string,
  ): Promise<SettlementLeg> {
    if (this.mode === 'mock') {
      return {
        providerTransferId: `mock-merchant-${idempotencyKey.slice(-12)}`,
        txHash: `0x${Buffer.from(idempotencyKey).toString('hex').slice(0, 64)}`,
        status: 'COMPLETED',
      };
    }

    // Real flow: POST /v3/partners/withdrawals/crypto
    const res = await this.client!.request<WithdrawalResponse>({
      method: 'POST',
      path: '/v3/partners/withdrawals/crypto',
      body: {
        currency: 'USDT',
        network: input.network,
        amount: input.amountUsdt,
        destination_address: input.merchantWallet,
        beneficiary: input.beneficiary,
      },
      idempotencyKey,
    });

    return {
      providerTransferId: res.id,
      txHash: res.tx_hash ?? undefined,
      status: this.mapWithdrawalStatus(res.status),
    };
  }

  async settlePlatformCommission(
    input: { platformWallet: string; network: string; amountUsdt: string },
    idempotencyKey: string,
  ): Promise<SettlementLeg> {
    if (this.mode === 'mock') {
      return {
        providerTransferId: `mock-platform-${idempotencyKey.slice(-12)}`,
        txHash: `0x${Buffer.from(idempotencyKey + ':platform').toString('hex').slice(0, 64)}`,
        status: 'COMPLETED',
      };
    }

    // Real flow: POST /v3/partners/withdrawals/crypto (same endpoint, different wallet)
    const res = await this.client!.request<WithdrawalResponse>({
      method: 'POST',
      path: '/v3/partners/withdrawals/crypto',
      body: {
        currency: 'USDT',
        network: input.network,
        amount: input.amountUsdt,
        destination_address: input.platformWallet,
      },
      idempotencyKey,
    });

    return {
      providerTransferId: res.id,
      txHash: res.tx_hash ?? undefined,
      status: this.mapWithdrawalStatus(res.status),
    };
  }

  async getTransferStatus(providerTransferId: string, _idempotencyKey: string): Promise<TransferStatusResult | null> {
    if (this.mode === 'mock') {
      if (!providerTransferId.startsWith('mock-')) return null;
      return {
        status: 'COMPLETED',
        txHash: `0x${Buffer.from(providerTransferId).toString('hex').slice(0, 64)}`,
        providerReference: providerTransferId,
      };
    }

    // Real flow: GET /v3/partners/withdrawals/crypto/:id
    try {
      const res = await this.client!.request<WithdrawalResponse>({
        method: 'GET',
        path: `/v3/partners/withdrawals/crypto/${providerTransferId}`,
      });
      return {
        status: this.mapWithdrawalStatus(res.status),
        txHash: res.tx_hash ?? undefined,
        providerReference: res.id,
      };
    } catch {
      // If withdrawal not found or transient error, return null to signal unknown state
      return null;
    }
  }

  private mapWithdrawalStatus(status: string): 'PENDING' | 'COMPLETED' | 'FAILED' {
    switch (status) {
      case 'COMPLETED':
      case 'CONFIRMED':
        return 'COMPLETED';
      case 'FAILED':
      case 'REJECTED':
      case 'CANCELED':
        return 'FAILED';
      default:
        return 'PENDING';
    }
  }
}