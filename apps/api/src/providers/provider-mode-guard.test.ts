import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreatePixChargeInput } from './provider-contract.js';
import { FoxbitAdapter } from './foxbit/foxbit-adapter.js';
import { TransFiAdapter } from './transfi/transfi-adapter.js';

const chargeInput: CreatePixChargeInput = {
  merchantReference: 'pixsplit-test-001',
  amountBrlCents: 12_345n,
  payer: { name: 'Pessoa Teste', taxId: '12345678901', email: 'teste@example.invalid' },
  beneficiary: {
    walletAddress: 'TMockWalletAddress',
    network: 'TRC20',
    exchangeName: 'Mock Exchange',
    holderName: 'Pessoa Teste',
  },
};

test('Foxbit adapter refuses direct sandbox and live construction', () => {
  assert.throws(() => new FoxbitAdapter('sandbox'), /FOXBIT_ADAPTER_NOT_HOMOLOGATED/);
  assert.throws(() => new FoxbitAdapter('live'), /FOXBIT_ADAPTER_NOT_HOMOLOGATED/);
});

test('TransFi adapter refuses direct sandbox and live construction', () => {
  assert.throws(() => new TransFiAdapter('sandbox'), /TRANSFI_ADAPTER_NOT_HOMOLOGATED/);
  assert.throws(() => new TransFiAdapter('live'), /TRANSFI_ADAPTER_NOT_HOMOLOGATED/);
});

test('mock adapters expose explicitly non-payable PIX references', async () => {
  const foxbit = await new FoxbitAdapter('mock').createPixCharge(chargeInput, 'foxbit-mock-key');
  const transfi = await new TransFiAdapter('mock').createPixCharge(chargeInput, 'transfi-mock-key');

  assert.match(foxbit.copyPaste, /^MOCK-PIX-NOT-PAYABLE-/);
  assert.match(transfi.copyPaste, /^MOCK-PIX-NOT-PAYABLE-/);
});
