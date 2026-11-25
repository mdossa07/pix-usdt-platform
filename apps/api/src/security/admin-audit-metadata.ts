import type { Prisma } from '@prisma/client';

export const ADMIN_RESERVATION_REVIEW_AUDIT_ACTION = 'MERCHANT_PAYMENT_RESERVATION_REVIEWED';
export const ADMIN_WALLET_REGISTRATION_AUDIT_ACTION = 'WALLET_REGISTERED';

const REDACTED_FIELDS_BY_ACTION: Readonly<Record<string, readonly string[]>> = {
  [ADMIN_RESERVATION_REVIEW_AUDIT_ACTION]: ['reviewNote'],
  [ADMIN_WALLET_REGISTRATION_AUDIT_ACTION]: ['exchangeName'],
};

/**
 * Free-text audit fields can predate current input validation or contain arbitrary
 * user-supplied values. Keep the event and non-text metadata, but omit those fields
 * from browser responses. Original values remain stored for controlled retention.
 */
export function sanitizeAdminAuditMetadata(
  action: string,
  metadata: Prisma.JsonValue | null,
): Prisma.JsonValue | null {
  const fieldsToRedact = REDACTED_FIELDS_BY_ACTION[action];
  if (!fieldsToRedact || metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata;

  const safeMetadata: Prisma.JsonObject = { ...metadata };
  for (const field of fieldsToRedact) {
    if (!Object.prototype.hasOwnProperty.call(safeMetadata, field)) continue;
    Reflect.deleteProperty(safeMetadata, field);
    safeMetadata[`${field}Redacted`] = true;
  }
  return safeMetadata;
}
