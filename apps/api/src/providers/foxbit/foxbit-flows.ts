import type { FoxbitClient } from './foxbit-client.js';

export type FoxbitGatewayBuyOrder = {
  tax_id_number: string;
  name: string;
  phone_number: string;
  birth_date: string;
  payment_method: 'PIX';
  receive_account: string;
  receive_address: string;
  quote_id: string;
  address: {
    zip_code: string;
    state: string;
    city: string;
    neighborhood: string;
    street: string;
    number: string;
    complement?: string;
    country: 'BR';
  };
  ip_client: string;
  chain: string;
  travel_rule_declaration: Record<string, unknown>;
};

export class FoxbitFlows {
  constructor(private readonly client: FoxbitClient) {}

  getSubMemberDepositAddress(subMemberSn: string, networkCode: string, currencySymbol = 'usdt') {
    return this.client.request({
      method: 'GET',
      path: `/sub_member/${encodeURIComponent(subMemberSn)}/deposits/address`,
      query: [['network_code', networkCode], ['currency_symbol', currencySymbol]],
    });
  }

  createFiatGatewayBuyOrder(payload: FoxbitGatewayBuyOrder, idempotencyKey: string) {
    return this.client.request({
      method: 'POST',
      path: '/fiat_gateway/orders',
      body: payload,
      idempotencyKey,
    });
  }

  moveCommissionFromSubMemberToRoot(subMemberSn: string, amountUsdt: string, idempotencyKey: string) {
    return this.client.request({
      method: 'POST',
      path: `/sub_member/${encodeURIComponent(subMemberSn)}/internal_cash_out`,
      body: { currency_symbol: 'usdt', amount: amountUsdt },
      idempotencyKey,
    });
  }

  /** Create a sub-member crypto withdrawal. The Travel Rule declaration may be a follow-up API step. */
  withdrawFromSubMember(subMemberSn: string, payload: Record<string, unknown>, idempotencyKey: string) {
    return this.client.request({
      method: 'POST',
      path: `/sub_member/${encodeURIComponent(subMemberSn)}/withdrawals`,
      body: payload,
      idempotencyKey,
    });
  }

  /** Withdraw the commission from the root account to the platform's external USDT wallet. */
  withdrawPlatformCommission(payload: Record<string, unknown>, idempotencyKey: string) {
    return this.client.request({
      method: 'POST',
      path: '/withdrawals',
      body: payload,
      idempotencyKey,
    });
  }
}
