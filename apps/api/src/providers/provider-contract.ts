/** Provider-neutral contract for the exact two-beneficiary flow. */
export type CreatePixChargeInput = {
  merchantReference: string;
  amountBrlCents: bigint;
  payer: { name?: string; taxId?: string; email?: string; };
  beneficiary: { walletAddress: string; network: string; memo?: string; exchangeName: string; holderName: string; holderTaxId?: string; };
};

export type PixCharge = { providerChargeId: string; copyPaste: string; qrCodeBase64?: string; expiresAt: Date; };
export type SettlementLeg = { providerTransferId: string; status: 'PENDING' | 'COMPLETED' | 'FAILED'; txHash?: string; };

/**
 * A production adapter must implement these methods only after the provider confirms the full
 * partner arrangement. Split is not assumed to be atomic: both legs must be idempotent and
 * reconciled independently.
 */
export type TransferStatusResult = { status: 'PENDING' | 'COMPLETED' | 'FAILED'; txHash?: string; providerReference?: string; };

export interface PaymentProvider {
  createPixCharge(input: CreatePixChargeInput, idempotencyKey: string): Promise<PixCharge>;
  getChargeStatus(providerChargeId: string): Promise<'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELED'>;
  settleMerchantUsdt(input: { merchantWallet: string; network: string; amountUsdt: string; beneficiary: CreatePixChargeInput['beneficiary']; }, idempotencyKey: string): Promise<SettlementLeg>;
  settlePlatformCommission(input: { platformWallet: string; network: string; amountUsdt: string; }, idempotencyKey: string): Promise<SettlementLeg>;
  /** Consulta o status real de uma transferência pelo ID do provedor ou chave de idempotência. Retorna null se o provedor não reconhecer a operação. */
  getTransferStatus?(providerTransferId: string, idempotencyKey: string): Promise<TransferStatusResult | null>;
}
