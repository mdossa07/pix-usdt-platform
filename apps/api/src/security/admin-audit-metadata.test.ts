import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_RESERVATION_REVIEW_AUDIT_ACTION,
  sanitizeAdminAuditMetadata,
} from './admin-audit-metadata.js';

test('redacts historical free-text notes from reservation-review audit events', () => {
  const historicalPii = 'Old note: CPF 529.982.247-25; contact analyst at legacy@example.test';
  const safe = sanitizeAdminAuditMetadata(ADMIN_RESERVATION_REVIEW_AUDIT_ACTION, {
    reviewNote: historicalPii,
    reservationRemainsLocked: true,
    source: 'admin-review',
  });

  assert.deepEqual(safe, {
    reservationRemainsLocked: true,
    source: 'admin-review',
    reviewNoteRedacted: true,
  });
  assert.equal(JSON.stringify(safe).includes('529.982.247-25'), false);
  assert.equal(JSON.stringify(safe).includes('legacy@example.test'), false);
});

test('preserves unrelated audit metadata unchanged', () => {
  const metadata = {
    merchantId: 'merchant-123',
    reason: 'KYC approved after manual verification',
  };
  assert.deepEqual(sanitizeAdminAuditMetadata('MERCHANT_UPDATED', metadata), metadata);
});

test('does not invent a redaction marker when the review event has no note', () => {
  const metadata = { reservationRemainsLocked: true };
  assert.deepEqual(
    sanitizeAdminAuditMetadata(ADMIN_RESERVATION_REVIEW_AUDIT_ACTION, metadata),
    metadata,
  );
});

test('preserves primitive and null JSON metadata safely', () => {
  assert.equal(sanitizeAdminAuditMetadata(ADMIN_RESERVATION_REVIEW_AUDIT_ACTION, null), null);
  assert.equal(sanitizeAdminAuditMetadata(ADMIN_RESERVATION_REVIEW_AUDIT_ACTION, 'legacy-value'), 'legacy-value');
});
