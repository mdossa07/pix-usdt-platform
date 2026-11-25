import type { Prisma } from '@prisma/client';

export const ADMIN_RESERVATION_REVIEW_AUDIT_ACTION = 'MERCHANT_PAYMENT_RESERVATION_REVIEWED';

/**
 * Historical review notes may predate the server-side PII/credential validator.
 * Keep the audit event and its non-text metadata, but never return the free-text
 * note to the browser. The original remains in the database for retention and
 * controlled forensic access.
 */
export function sanitizeAdminAuditMetadata(
  action: string,
  metadata: Prisma.JsonValue | null,
): Prisma.JsonValue | null {
  if (action !== ADMIN_RESERVATION_REVIEW_AUDIT_ACTION) return metadata;
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata;

  const safeMetadata: Record<string, Prisma.JsonValue> = { ...metadata };
  if (Object.prototype.hasOwnProperty.call(safeMetadata, 'reviewNote')) {
    delete safeMetadata.reviewNote;
    safeMetadata.reviewNoteRedacted = true;
  }
  return safeMetadata as Prisma.JsonObject;
}
