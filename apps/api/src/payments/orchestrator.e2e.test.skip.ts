import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient, PaymentStatus, TransferStatus, TransferKind } from '@prisma/client';
import { PaymentOrchestrator } from './orchestrator.js';
import type { PaymentProvider, SettlementLeg, TransferStatusResult } from '../providers/provider-contract.js';

/**
 * Critical scenario tests for the financial motor.
 * Validates independent leg states, idempotency, timeout recovery and exact 98/2 split.
 */

class MockProvider implements PaymentProvider {
  public callLog: { method: string; args: unknown[] }[] = [];
  public failMerchant = false;
  public failPlatform = false;
  public timeoutMerchant = false;
  public timeoutPlatform = false;
  public merchantCompletedRemotely = false;
  public platformCompletedRemotely = false;

  async createPixCharge() {
    return {
      providerChargeId: 'mock-charge',
      copyPaste: '00020126...',
      qrCodeBase64: 'base64qr',
      expiresAt: new Date(Date.now() + 3600000),
    };
  }

  async getChargeStatus(_providerChargeId: string) {
    return 'PAID' as const;
  }

  async convertBrlToUsdt(input: { amountBrlCents: bigint }) {
    const rate = 5.5;
    const usdt = Math.floor(Number(input.amountBrlCents) / rate);
    return { usdtAmount: String(usdt), rate: String(rate), conversionId: `conv-${Date.now()}` };
  }

  async settleMerchantUsdt(
    input: { merchantWallet: string; network: string; amountUsdt: string; beneficiary: { walletAddress: string; network: string; memo?: string; exchangeName: string; holderName: string; holderTaxId?: string } },
    idempotencyKey: string,
  ): Promise<SettlementLeg> {
    this.callLog.push({ method: 'settleMerchantUsdt', args: [input, idempotencyKey] });
    if (this.timeoutMerchant) throw new Error('ETIMEDOUT');
    if (this.failMerchant) throw new Error('PROVIDER_REJECTED');
    return {
      providerTransferId: `merchant-${idempotencyKey.slice(-8)}`,
      txHash: `0xmerchant${idempotencyKey.slice(0, 56)}`,
      status: 'COMPLETED',
    };
  }

  async settlePlatformCommission(
    input: { platformWallet: string; network: string; amountUsdt: string },
    idempotencyKey: string,
  ): Promise<SettlementLeg> {
    this.callLog.push({ method: 'settlePlatformCommission', args: [input, idempotencyKey] });
    if (this.timeoutPlatform) throw new Error('ETIMEDOUT');
    if (this.failPlatform) throw new Error('PROVIDER_REJECTED');
    return {
      providerTransferId: `platform-${idempotencyKey.slice(-8)}`,
      txHash: `0xplatform${idempotencyKey.slice(0, 56)}`,
      status: 'COMPLETED',
    };
  }

  async getTransferStatus(providerWithdrawalSn: string, _idempotencyKey: string): Promise<TransferStatusResult | null> {
    this.callLog.push({ method: 'getTransferStatus', args: [providerWithdrawalSn, _idempotencyKey] });
    if (providerWithdrawalSn.includes('merchant') && this.merchantCompletedRemotely) {
      return { status: 'COMPLETED', txHash: '0xrecovered_merchant_hash' };
    }
    if (providerWithdrawalSn.includes('platform') && this.platformCompletedRemotely) {
      return { status: 'COMPLETED', txHash: '0xrecovered_platform_hash' };
    }
    return { status: 'PENDING' };
  }
}

describe('PaymentOrchestrator — Critical Financial Scenarios', () => {
  let prisma: PrismaClient;
  let provider: MockProvider;
  let orchestrator: PaymentOrchestrator;

  beforeEach(async () => {
    prisma = new PrismaClient();
    provider = new MockProvider();
    orchestrator = new PaymentOrchestrator(prisma, provider, {
      commissionBps: 200,
      mockRate: '5.5',
      mode: 'mock',
    });

    // Clean slate (order matters due to FK constraints)
    await prisma.ledgerEntry.deleteMany();
    await prisma.transfer.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.walletDestination.deleteMany();
    await prisma.merchantApiKey.deleteMany();
    await prisma.merchant.deleteMany();
    await prisma.platformWallet.deleteMany();
    await prisma.user.deleteMany();

    // Seed minimal data aligned with actual schema
    await prisma.user.create({
      data: {
        id: 'admin-1',
        email: 'admin@test.com',
        passwordHash: 'x',
        fullName: 'Admin Test',
        role: 'SUPER_ADMIN',
      },
    });

    await prisma.merchant.create({
      data: {
        id: 'merch-1',
        userId: 'admin-1',
        legalName: 'Test Merchant LTDA',
        merchantType: 'COMPANY',
        taxIdEncrypted: 'enc:12345678000199',
        taxIdLast4: '0199',
        kycStatus: 'APPROVED',
        isEnabled: true,
      },
    });

    await prisma.walletDestination.create({
      data: {
        id: 'wallet-dest-1',
        merchantId: 'merch-1',
        label: 'Main Wallet',
        exchangeName: 'Foxbit',
        networkCode: 'TRON',
        addressEncrypted: 'enc:T9yD14Nj9j7xAB4dbGeiX9h8bNzyBvL3Qz',
        addressLast8: 'BvL3Qz',
        holderName: 'Test Merchant LTDA',
        walletType: 'HOSTED',
        walletOwner: 'SELF',
        status: 'VERIFIED',
        isDefault: true,
        isVerified: true,
      },
    });

    await prisma.platformWallet.create({
      data: {
        id: 'plat-wallet-1',
        networkCode: 'TRON',
        addressEncrypted: 'enc:TPlatformWalletAddress123456789abcdef',
        addressLast8: '9abcdef',
        isEnabled: true,
      },
    });
  });

  it('Scenario A: Both legs complete successfully with exact 98/2 split', async () => {
    const payment = await prisma.payment.create({
      data: {
        externalId: 'ext-a-both-ok',
        merchantId: 'merch-1',
        walletDestinationId: 'wallet-dest-1',
        status: PaymentStatus.PIX_CONFIRMED,
        amountBrlCents: BigInt(100000),
        paidAt: new Date(),
      },
    });

    await orchestrator.handlePixConfirmed(payment.id, BigInt(100000));

    const updated = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: { transfers: true },
    });
    expect(updated.status).toBe(PaymentStatus.COMPLETED);
    expect(updated.merchantTransferStatus).toBe(TransferStatus.COMPLETED);
    expect(updated.platformTransferStatus).toBe(TransferStatus.COMPLETED);

    const merchantTx = updated.transfers.find((t) => t.kind === TransferKind.MERCHANT_PAYOUT)!;
    const platformTx = updated.transfers.find((t) => t.kind === TransferKind.PLATFORM_COMMISSION)!;

    // 100000 / 5.5 = 18181 USDT (floor). 98% = 17817, 2% = 363, remainder 1 stays in platform
    expect(merchantTx.amountUsdt).toBe('17817');
    expect(platformTx.amountUsdt).toBe('363');
    expect(merchantTx.status).toBe(TransferStatus.COMPLETED);
    expect(platformTx.status).toBe(TransferStatus.COMPLETED);
  });

  it('Scenario B: Merchant succeeds, platform fails — independent states preserved', async () => {
    provider.failPlatform = true;

    const payment = await prisma.payment.create({
      data: {
        externalId: 'ext-b-merch-ok-plat-fail',
        merchantId: 'merch-1',
        walletDestinationId: 'wallet-dest-1',
        status: PaymentStatus.PIX_CONFIRMED,
        amountBrlCents: BigInt(50000),
        paidAt: new Date(),
      },
    });

    await expect(orchestrator.handlePixConfirmed(payment.id, BigInt(50000))).rejects.toThrow();

    const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updated.merchantTransferStatus).toBe(TransferStatus.COMPLETED);
    expect(updated.platformTransferStatus).toBe(TransferStatus.FAILED);
    expect(updated.status).not.toBe(PaymentStatus.COMPLETED);
  });

  it('Scenario C: Platform succeeds, merchant fails — independent states preserved', async () => {
    provider.failMerchant = true;

    const payment = await prisma.payment.create({
      data: {
        externalId: 'ext-c-plat-ok-merch-fail',
        merchantId: 'merch-1',
        walletDestinationId: 'wallet-dest-1',
        status: PaymentStatus.PIX_CONFIRMED,
        amountBrlCents: BigInt(50000),
        paidAt: new Date(),
      },
    });

    await expect(orchestrator.handlePixConfirmed(payment.id, BigInt(50000))).rejects.toThrow();

    const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updated.merchantTransferStatus).toBe(TransferStatus.FAILED);
    expect(updated.platformTransferStatus).toBe(TransferStatus.COMPLETED);
    expect(updated.status).not.toBe(PaymentStatus.COMPLETED);
  });

  it('Scenario D: Both legs fail — no money lost, both marked FAILED', async () => {
    provider.failMerchant = true;
    provider.failPlatform = true;

    const payment = await prisma.payment.create({
      data: {
        externalId: 'ext-d-both-fail',
        merchantId: 'merch-1',
        walletDestinationId: 'wallet-dest-1',
        status: PaymentStatus.PIX_CONFIRMED,
        amountBrlCents: BigInt(50000),
        paidAt: new Date(),
      },
    });

    await expect(orchestrator.handlePixConfirmed(payment.id, BigInt(50000))).rejects.toThrow();

    const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updated.merchantTransferStatus).toBe(TransferStatus.FAILED);
    expect(updated.platformTransferStatus).toBe(TransferStatus.FAILED);
  });

  it('Scenario E: Timeout on merchant, but provider completed remotely — recovery via getTransferStatus', async () => {
    provider.timeoutMerchant = true;

    const payment = await prisma.payment.create({
      data: {
        externalId: 'ext-e-timeout-recovery',
        merchantId: 'merch-1',
        walletDestinationId: 'wallet-dest-1',
        status: PaymentStatus.PIX_CONFIRMED,
        amountBrlCents: BigInt(50000),
        paidAt: new Date(),
      },
    });

    // First call times out during merchant settlement
    await expect(orchestrator.handlePixConfirmed(payment.id, BigInt(50000))).rejects.toThrow('ETIMEDOUT');

    // Simulate that provider actually completed the transfer
    provider.timeoutMerchant = false;
    provider.merchantCompletedRemotely = true;

    // Second call should recover via getTransferStatus
    await orchestrator.handlePixConfirmed(payment.id, BigInt(50000));

    const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updated.merchantTransferStatus).toBe(TransferStatus.COMPLETED);
    expect(updated.platformTransferStatus).toBe(TransferStatus.COMPLETED);
    expect(updated.status).toBe(PaymentStatus.COMPLETED);

    const statusCalls = provider.callLog.filter((c) => c.method === 'getTransferStatus');
    expect(statusCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('Scenario F: Duplicate webhook / double settlement — idempotency prevents double payout', async () => {
    const payment = await prisma.payment.create({
      data: {
        externalId: 'ext-f-idempotent',
        merchantId: 'merch-1',
        walletDestinationId: 'wallet-dest-1',
        status: PaymentStatus.PIX_CONFIRMED,
        amountBrlCents: BigInt(100000),
        paidAt: new Date(),
      },
    });

    await orchestrator.handlePixConfirmed(payment.id, BigInt(100000));
    await orchestrator.handlePixConfirmed(payment.id, BigInt(100000));

    const updated = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: { transfers: true },
    });
    expect(updated.status).toBe(PaymentStatus.COMPLETED);
    expect(updated.transfers).toHaveLength(2);

    const merchantCalls = provider.callLog.filter((c) => c.method === 'settleMerchantPayout');
    const platformCalls = provider.callLog.filter((c) => c.method === 'settlePlatformCommission');
    expect(merchantCalls).toHaveLength(1);
    expect(platformCalls).toHaveLength(1);
  });

  it('Scenario G: Small value rounding — floor preserves conservation', async () => {
    const payment = await prisma.payment.create({
      data: {
        externalId: 'ext-g-small-value',
        merchantId: 'merch-1',
        walletDestinationId: 'wallet-dest-1',
        status: PaymentStatus.PIX_CONFIRMED,
        amountBrlCents: BigInt(100),
        paidAt: new Date(),
      },
    });

    await orchestrator.handlePixConfirmed(payment.id, BigInt(100));

    const updated = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: { transfers: true },
    });
    const merchantTx = updated.transfers.find((t) => t.kind === TransferKind.MERCHANT_PAYOUT)!;
    const platformTx = updated.transfers.find((t) => t.kind === TransferKind.PLATFORM_COMMISSION)!;

    const merchantAmt = BigInt(String(merchantTx.amountUsdt));
    const platformAmt = BigInt(String(platformTx.amountUsdt));
    const totalConverted = BigInt(
      (await provider.convertBrlToUsdt({ amountBrlCents: BigInt(100) })).usdtAmount,
    );

    expect(merchantAmt + platformAmt).toBeLessThanOrEqual(totalConverted);
    expect(merchantAmt + platformAmt).toBeGreaterThanOrEqual(totalConverted - BigInt(1));
  });
});