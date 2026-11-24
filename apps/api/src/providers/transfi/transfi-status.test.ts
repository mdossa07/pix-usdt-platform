import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapTransFiChargeStatus,
  mapTransFiTransferStatus,
} from './transfi-adapter.js';

test('TransFi payin fulfillment accepts only final success statuses', () => {
  assert.equal(mapTransFiChargeStatus('fund_settled'), 'PAID');
  assert.equal(mapTransFiChargeStatus('asset_settled'), 'PAID');
  for (const status of ['initiated', 'fund_processing', 'fund_deposited', 'asset_processing', 'manual_review', 'approval_pending']) {
    assert.equal(mapTransFiChargeStatus(status), 'PENDING', status);
  }
});

test('TransFi failed and expired payins remain non-paid', () => {
  for (const status of ['fund_failed', 'fund_deposit_failed', 'asset_settle_failed', 'rejected', 'failed', 'cancelled']) {
    assert.equal(mapTransFiChargeStatus(status), 'CANCELED', status);
  }
  assert.equal(mapTransFiChargeStatus('expired'), 'EXPIRED');
});

test('TransFi crypto payouts complete only on final settlement', () => {
  assert.equal(mapTransFiTransferStatus('asset_settled'), 'COMPLETED');
  for (const status of ['initiated', 'fund_processing', 'fund_deposited', 'asset_processing', 'manual_review', 'approval_pending']) {
    assert.equal(mapTransFiTransferStatus(status), 'PENDING', status);
  }
  for (const status of ['asset_settle_failed', 'fund_failed', 'fund_deposit_failed', 'rejected', 'failed', 'cancelled', 'expired']) {
    assert.equal(mapTransFiTransferStatus(status), 'FAILED', status);
  }
});
