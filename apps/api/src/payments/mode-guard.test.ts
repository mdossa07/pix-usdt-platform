import test from 'node:test';
import assert from 'node:assert/strict';
import { canRunMockFinancialExecution } from './mode-guard.js';

test('mock financial execution is allowed only outside production', () => {
  assert.equal(canRunMockFinancialExecution('development', 'mock'), true);
  assert.equal(canRunMockFinancialExecution('test', 'mock'), true);
  assert.equal(canRunMockFinancialExecution('production', 'mock'), false);
  assert.equal(canRunMockFinancialExecution('development', 'live'), false);
  assert.equal(canRunMockFinancialExecution('production', 'live'), false);
});
