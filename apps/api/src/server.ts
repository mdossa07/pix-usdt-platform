import { canBeDefaultDestination } from './wallets/wallet-eligibility.js';
import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rawBody from 'fastify-raw-body';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient, Prisma, WalletStatus, WalletType, PaymentStatus, TransferKind, TransferStatus, LedgerDirection, LedgerStatus, MerchantType } from '@prisma/client';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { encryptPii, decryptPii } from './security/crypto.js';
import { buildTotpProvisioningUri, generateTotpSecret, matchTotpCounter } from './security/totp.js';
import { calculateUsdtSplit, mockBrlToUsdt } from './payments/split.js';
import { verifyFoxbitWebhook, parseFoxbitWebhook, mapWebhookStatusToPaymentState } from './providers/foxbit/foxbit-webhook.js';
import { verifyTransFiWebhookSignature, parseTransFiWebhook, mapTransFiStatusToPaymentState } from './providers/transfi/transfi-webhook.js';
import { startSettlementWorker, startRetryWorker } from './queues/workers.js';
import { enqueueSettlement, closeQueues } from './queues/producers.js';
import { canRunMockFinancialExecution } from './payments/mode-guard.js';
import { ReconciliationService } from './payments/reconciliation.js';
import { createPaymentIdempotently, isValidIdempotencyKey } from './payments/idempotent-payment.js';
import { hmacAuthMiddleware, generateMerchantApiKey } from './security/hmac-auth.js';
import { createPaymentProvider } from './providers/provider-factory.js';
import { claimWebhookEvent, completeWebhookEvent, releaseWebhookEvent } from './webhooks/event-claim.js';

const prisma = new PrismaClient();
const app = Fastify({ logger: true, bodyLimit: 1_048_576 });

await app.register(helmet);
await app.register(cors, { origin: config.APP_URL, credentials: true });
await app.register(rateLimit, { max: 80, timeWindow: '1 minute' });
await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: '2h' } });
await app.register(rawBody, { field: 'rawBody', global: false, encoding: false, runFirst: true });

app.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify();
    if ((request.user as { purpose?: string }).purpose === 'admin-2fa-challenge') {
      await reply.code(401).send({ error: 'two_factor_required' });
    }
  } catch {
    await reply.code(401).send({ error: 'unauthorized' });
  }
});

function userId(request: FastifyRequest) { return request.user.sub; }
async function merchantFor(request: FastifyRequest) {
  const merchant = await prisma.merchant.findUnique({ where: { userId: userId(request) } });
  if (!merchant) throw Object.assign(new Error('merchant_not_found'), { statusCode: 404 });
  return merchant;
}
function audit(request: FastifyRequest, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
  return prisma.auditEvent.create({ data: { actorUserId: request.user.sub, action, entityType, entityId, ipAddress: request.ip, metadata: metadata ? metadata as Prisma.InputJsonObject : undefined } });
}
function validateAddress(network: string, address: string) {
  if (network === 'polygon') return /^0x[a-fA-F0-9]{40}$/.test(address);
  if (network === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  return false;
}

app.get('/health', async () => ({ status: 'ok', mode: 'mock', foxbitIntegration: 'pending_partner_approval', livePayments: false }));
app.get('/v1/admin/provider-status', { preHandler: [app.authenticate] }, async (request, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'forbidden' });
  return {
    provider: config.PAYMENT_PROVIDER.toUpperCase(),
    enabled: false,
    adapterReady: false,
    credentialsConfigured: config.PAYMENT_PROVIDER === 'transfi'
      ? Boolean(config.TRANSFI_USERNAME && config.TRANSFI_PASSWORD && config.TRANSFI_MID && config.TRANSFI_WEBHOOK_SECRET)
      : Boolean(config.FOXBIT_API_KEY && config.FOXBIT_API_SECRET && config.FOXBIT_WEBHOOK_SECRET),
    connection: 'INTEGRATION_PENDING',
    paymentsMode: config.PAYMENTS_MODE,
    liveOperationsEnabled: false,
    pendingApprovals: [
      'aprovação comercial para pagamentos PIX de terceiros',
      'confirmação do fluxo de conversão BRL/USDT',
      'provisionamento e identificação de beneficiários',
      'aprovação de Travel Rule',
      'dois payouts USDT independentes por pagamento',
      'testes sandbox de falhas parciais e conciliação',
    ],
  };
});

const mockFinancialExecutionEnabled = canRunMockFinancialExecution(config.NODE_ENV, config.PAYMENTS_MODE);

const registerSchema = z.object({
  fullName: z.string().min(3).max(120), email: z.string().email().max(254), password: z.string().min(12).max(128),
  merchantType: z.enum(['INDIVIDUAL', 'COMPANY']), legalName: z.string().min(3).max(160), taxId: z.string().regex(/^\d{11}$|^\d{14}$/),
}).superRefine((value, context) => {
  const expectedLength = value.merchantType === 'INDIVIDUAL' ? 11 : 14;
  if (value.taxId.length !== expectedLength) context.addIssue({ code: 'custom', path: ['taxId'], message: value.merchantType === 'INDIVIDUAL' ? 'CPF deve conter 11 dígitos.' : 'CNPJ deve conter 14 dígitos.' });
});
app.post('/v1/auth/register', async (request, reply) => {
  const parsed = registerSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
  const body = parsed.data;
  const email = body.email.toLowerCase();
  const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
  try {
    const result = await prisma.user.create({ data: {
      email, passwordHash, fullName: body.fullName,
      merchant: { create: {
        merchantType: body.merchantType as MerchantType,
        legalName: body.legalName,
        taxIdEncrypted: encryptPii(body.taxId),
        taxIdLast4: body.taxId.slice(-4),
      } },
    }, include: { merchant: true } });
    await prisma.auditEvent.create({ data: { actorUserId: result.id, action: 'ACCOUNT_REGISTERED', entityType: 'USER', entityId: result.id } });
    const token = app.jwt.sign({ sub: result.id, role: result.role });
    return reply.code(201).send({ token, user: { id: result.id, email: result.email, fullName: result.fullName, role: result.role }, merchant: { id: result.merchant!.id, kycStatus: result.merchant!.kycStatus } });
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') return reply.code(409).send({ error: 'email_already_registered' });
    throw error;
  }
});

app.post('/v1/auth/login', async (request, reply) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_credentials' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() }, include: { merchant: true } });
  if (!user || !user.isActive || !(await argon2.verify(user.passwordHash, parsed.data.password))) return reply.code(401).send({ error: 'invalid_credentials' });

  if (user.role === 'SUPER_ADMIN' && user.twoFactorEnabledAt && user.twoFactorSecretEncrypted) {
    const challengeToken = app.jwt.sign(
      { sub: user.id, purpose: 'admin-2fa-challenge' },
      { expiresIn: '5m' },
    );
    return { requiresTwoFactor: true, challengeToken };
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = app.jwt.sign({ sub: user.id, role: user.role });
  return { token, user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role }, merchant: user.merchant ? { id: user.merchant.id, kycStatus: user.merchant.kycStatus } : null };
});

app.post('/v1/auth/2fa/verify', {
  config: { rateLimit: { max: 6, timeWindow: '5 minutes' } },
}, async (request, reply) => {
  const parsed = z.object({
    challengeToken: z.string().min(1).max(4096),
    code: z.string().regex(/^\d{6}$/),
  }).strict().safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_two_factor_challenge' });

  let claims: { sub?: string; purpose?: string };
  try {
    claims = app.jwt.verify(parsed.data.challengeToken) as { sub?: string; purpose?: string };
  } catch {
    return reply.code(401).send({ error: 'invalid_two_factor_challenge' });
  }
  if (!claims.sub || claims.purpose !== 'admin-2fa-challenge') {
    return reply.code(401).send({ error: 'invalid_two_factor_challenge' });
  }

  const user = await prisma.user.findUnique({ where: { id: claims.sub }, include: { merchant: true } });
  if (!user || !user.isActive || user.role !== 'SUPER_ADMIN' || !user.twoFactorEnabledAt || !user.twoFactorSecretEncrypted) {
    return reply.code(401).send({ error: 'invalid_two_factor_challenge' });
  }

  const secret = decryptPii(user.twoFactorSecretEncrypted);
  const matchedStep = matchTotpCounter(secret, parsed.data.code);
  if (matchedStep === null) return reply.code(401).send({ error: 'invalid_or_replayed_two_factor_code' });

  const consumed = await prisma.user.updateMany({
    where: {
      id: user.id,
      isActive: true,
      role: 'SUPER_ADMIN',
      twoFactorEnabledAt: { not: null },
      OR: [
        { twoFactorLastUsedStep: null },
        { twoFactorLastUsedStep: { lt: BigInt(matchedStep) } },
      ],
    },
    data: {
      twoFactorLastUsedStep: BigInt(matchedStep),
      lastLoginAt: new Date(),
    },
  });
  if (consumed.count !== 1) return reply.code(401).send({ error: 'invalid_or_replayed_two_factor_code' });

  const token = app.jwt.sign({ sub: user.id, role: user.role });
  await prisma.auditEvent.create({
    data: {
      actorUserId: user.id,
      action: 'ADMIN_2FA_LOGIN',
      entityType: 'USER',
      entityId: user.id,
      ipAddress: request.ip,
    },
  });
  return {
    token,
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    merchant: user.merchant ? { id: user.merchant.id, kycStatus: user.merchant.kycStatus } : null,
  };
});

app.get('/v1/me', { preHandler: app.authenticate }, async (request, reply) => {
  const user = await prisma.user.findUnique({ where: { id: userId(request) }, include: { merchant: true } });
  if (!user) return reply.code(404).send({ error: 'user_not_found' });
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role, merchant: user.merchant ? { id: user.merchant.id, legalName: user.merchant.legalName, kycStatus: user.merchant.kycStatus, isEnabled: user.merchant.isEnabled } : null };
});

app.get('/v1/admin/2fa/status', { preHandler: [app.authenticate] }, async (request, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'forbidden' });
  const user = await prisma.user.findUnique({ where: { id: userId(request) } });
  if (!user) return reply.code(404).send({ error: 'user_not_found' });
  return {
    enabled: Boolean(user.twoFactorEnabledAt && user.twoFactorSecretEncrypted),
    enabledAt: user.twoFactorEnabledAt,
    setupPending: Boolean(user.twoFactorPendingSecretEncrypted),
  };
});

app.post('/v1/admin/2fa/setup', {
  preHandler: [app.authenticate],
  config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
}, async (request, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'forbidden' });
  const user = await prisma.user.findUnique({ where: { id: userId(request) } });
  if (!user) return reply.code(404).send({ error: 'user_not_found' });
  if (user.twoFactorEnabledAt) return reply.code(409).send({ error: 'two_factor_already_enabled' });

  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorPendingSecretEncrypted: encryptPii(secret) },
  });
  await audit(request, 'ADMIN_2FA_SETUP_STARTED', 'USER', user.id, {});
  return {
    secret,
    provisioningUri: buildTotpProvisioningUri(user.email, secret),
    issuer: 'PixSplit',
    algorithm: 'SHA1',
    digits: 6,
    periodSeconds: 30,
  };
});

app.post('/v1/admin/2fa/enable', {
  preHandler: [app.authenticate],
  config: { rateLimit: { max: 6, timeWindow: '5 minutes' } },
}, async (request, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'forbidden' });
  const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_two_factor_code' });

  const user = await prisma.user.findUnique({ where: { id: userId(request) } });
  if (!user) return reply.code(404).send({ error: 'user_not_found' });
  if (user.twoFactorEnabledAt) return reply.code(409).send({ error: 'two_factor_already_enabled' });
  if (!user.twoFactorPendingSecretEncrypted) return reply.code(409).send({ error: 'two_factor_setup_required' });

  const secret = decryptPii(user.twoFactorPendingSecretEncrypted);
  const matchedStep = matchTotpCounter(secret, parsed.data.code);
  if (matchedStep === null) return reply.code(400).send({ error: 'invalid_two_factor_code' });

  const enabledAt = new Date();
  const result = await prisma.user.updateMany({
    where: {
      id: user.id,
      twoFactorEnabledAt: null,
      twoFactorPendingSecretEncrypted: user.twoFactorPendingSecretEncrypted,
    },
    data: {
      twoFactorSecretEncrypted: user.twoFactorPendingSecretEncrypted,
      twoFactorPendingSecretEncrypted: null,
      twoFactorEnabledAt: enabledAt,
      twoFactorLastUsedStep: BigInt(matchedStep),
    },
  });
  if (result.count !== 1) return reply.code(409).send({ error: 'two_factor_setup_changed' });

  await audit(request, 'ADMIN_2FA_ENABLED', 'USER', user.id, { enabledAt: enabledAt.toISOString() });
  return { enabled: true, enabledAt };
});

app.get('/v1/wallets', { preHandler: app.authenticate }, async (request) => {
  const merchant = await merchantFor(request);
  const wallets = await prisma.walletDestination.findMany({ where: { merchantId: merchant.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
  return wallets.map(w => ({ id: w.id, label: w.label, exchangeName: w.exchangeName, networkCode: w.networkCode, currencySymbol: w.currencySymbol.toUpperCase(), address: `${decryptPii(w.addressEncrypted).slice(0, 6)}…${w.addressLast8}`, hasTag: Boolean(w.tagEncrypted), walletType: w.walletType, status: w.status, isVerified: w.isVerified, holderName: w.holderName, holderCountry: w.holderCountry, isDefault: w.isDefault, createdAt: w.createdAt }));
});

app.post('/v1/wallets', { preHandler: app.authenticate }, async (request, reply) => {
  const schema = z.object({ label: z.string().min(2).max(60), exchangeName: z.string().min(2).max(80), networkCode: z.enum(['polygon', 'tron']), address: z.string().min(20).max(128), tag: z.string().max(128).optional(), walletType: z.enum(['HOSTED', 'SELF_HOSTED']), holderName: z.string().min(3).max(120), holderTaxId: z.string().regex(/^\d{11}$|^\d{14}$/).optional(), holderCountry: z.string().length(2).default('BR'), vaspEntityCountry: z.string().length(2).optional(), makeDefault: z.boolean().default(false) });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_wallet', details: parsed.error.flatten() });
  const data = parsed.data;
  if (!validateAddress(data.networkCode, data.address)) return reply.code(400).send({ error: 'wallet_address_network_mismatch' });
  if (data.walletType === 'HOSTED' && !data.exchangeName.trim()) return reply.code(400).send({ error: 'exchange_required_for_hosted_wallet' });
  if (data.walletType === 'HOSTED' && !data.holderTaxId) return reply.code(400).send({ error: 'holder_tax_id_required_for_exchange_wallet' });
  if (data.walletType === 'HOSTED' && !data.vaspEntityCountry) return reply.code(400).send({ error: 'vasp_entity_country_required' });
  const merchant = await merchantFor(request);
  if (data.holderTaxId && data.holderTaxId !== decryptPii(merchant.taxIdEncrypted)) return reply.code(400).send({ error: 'wallet_holder_must_match_merchant_identity' });
  // New destinations stay pending until reviewed; never replace a verified
  // default with an address that has not passed ownership/Travel Rule checks.
  const wallet = await prisma.walletDestination.create({ data: {
    merchantId: merchant.id, label: data.label, exchangeName: data.exchangeName, networkCode: data.networkCode,
    addressEncrypted: encryptPii(data.address), addressLast8: data.address.slice(-8), tagEncrypted: data.tag ? encryptPii(data.tag) : null,
    walletType: data.walletType as WalletType, walletOwner: 'SELF', holderName: data.holderName,
    holderTaxIdEncrypted: data.holderTaxId ? encryptPii(data.holderTaxId) : null,
    holderCountry: data.holderCountry.toUpperCase(), vaspEntityCountry: data.vaspEntityCountry?.toUpperCase() ?? null,
    isDefault: false, status: WalletStatus.PENDING_VERIFICATION,
  } });
  await audit(request, 'WALLET_REGISTERED', 'WALLET', wallet.id, { networkCode: wallet.networkCode, walletType: wallet.walletType, exchangeName: wallet.exchangeName });
  return reply.code(201).send({ id: wallet.id, label: wallet.label, exchangeName: wallet.exchangeName, networkCode: wallet.networkCode, addressLast8: wallet.addressLast8, status: wallet.status, note: 'Carteira cadastrada; aguarda validação de titularidade e Travel Rule pelo provedor.' });
});

app.post('/v1/wallets/:id/default', { preHandler: app.authenticate }, async (request, reply) => {
  const merchant = await merchantFor(request);
  const { id } = request.params as { id: string };
  const wallet = await prisma.walletDestination.findFirst({ where: { id, merchantId: merchant.id } });
  if (!wallet) return reply.code(404).send({ error: 'wallet_not_found' });
  if (!canBeDefaultDestination(wallet.status, wallet.isVerified)) {
    return reply.code(409).send({
      error: 'wallet_not_verified',
      message: 'Somente uma carteira verificada pode ser definida como padrão.',
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.walletDestination.updateMany({
      where: { merchantId: merchant.id, isDefault: true },
      data: { isDefault: false },
    });
    await tx.walletDestination.update({
      where: { id: wallet.id },
      data: { isDefault: true },
    });
  });
  await audit(request, 'WALLET_SET_DEFAULT', 'WALLET', id, { networkCode: wallet.networkCode });
  return { success: true };
});

app.get('/v1/dashboard', { preHandler: app.authenticate }, async (request) => {
  const merchant = await merchantFor(request);
  const [payments, counts, wallets, totals, completedTotals] = await Promise.all([
    prisma.payment.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: 'desc' }, take: 10, include: { walletDestination: true, transfers: true } }),
    prisma.payment.groupBy({ by: ['status'], where: { merchantId: merchant.id }, _count: { _all: true }, _sum: { amountBrlCents: true } }),
    prisma.walletDestination.count({ where: { merchantId: merchant.id } }),
    prisma.payment.aggregate({ where: { merchantId: merchant.id }, _sum: { amountBrlCents: true }, _count: { id: true } }),
    prisma.payment.aggregate({ where: { merchantId: merchant.id, status: PaymentStatus.COMPLETED }, _sum: { commissionUsdt: true, merchantNetUsdt: true } }),
  ]);
  const totalBrl = totals._sum.amountBrlCents ?? 0n;
  const completedCount = counts.find(c => c.status === PaymentStatus.COMPLETED)?._count._all ?? 0;
  const commission = completedTotals._sum.commissionUsdt?.toFixed(6) ?? '0.000000';
  return {
    mode: 'mock', merchant: { legalName: merchant.legalName, kycStatus: merchant.kycStatus, isEnabled: merchant.isEnabled },
    totals: { paymentsTotal: totals._count.id, recentPaymentsShown: payments.length, volumeBrlCents: totalBrl.toString(), completed: completedCount, commissionUsdt: commission, merchantNetUsdt: completedTotals._sum.merchantNetUsdt?.toFixed(6) ?? '0.000000', wallets },
    statusCounts: counts.map(c => ({ status: c.status, count: c._count._all, volumeBrlCents: c._sum.amountBrlCents?.toString() ?? '0' })),
    recentPayments: payments.map(p => ({ id: p.id, externalId: p.externalId, status: p.status, amountBrlCents: p.amountBrlCents.toString(), commissionUsdt: p.commissionUsdt?.toString() ?? null, merchantNetUsdt: p.merchantNetUsdt?.toString() ?? null, network: p.walletDestination.networkCode, walletLast8: p.walletDestination.addressLast8, createdAt: p.createdAt, transfers: p.transfers.map(t => ({ kind: t.kind, status: t.status, amountUsdt: t.amountUsdt.toString(), txHash: t.txHash })) })),
  };
});

app.get('/v1/admin/dashboard', { preHandler: app.authenticate }, async (request, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'admin_only' });
  const [merchants, totals, completed, recentPayments, walletCount, pendingKyc] = await Promise.all([
    prisma.merchant.count(),
    prisma.payment.aggregate({ _sum: { amountBrlCents: true }, _count: { id: true } }),
    prisma.payment.aggregate({ where: { status: PaymentStatus.COMPLETED }, _sum: { commissionUsdt: true, merchantNetUsdt: true }, _count: { id: true } }),
    prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, take: 12, include: { merchant: { include: { user: true } }, walletDestination: true, transfers: true } }),
    prisma.walletDestination.count(),
    prisma.merchant.count({ where: { kycStatus: { in: [ 'NOT_STARTED', 'PENDING' ] } } }),
  ]);
  return {
    mode: 'mock', totals: {
      merchants, paymentsTotal: totals._count.id, volumeBrlCents: (totals._sum.amountBrlCents ?? 0n).toString(),
      completed: completed._count.id, commissionUsdt: completed._sum.commissionUsdt?.toFixed(6) ?? '0.000000',
      merchantNetUsdt: completed._sum.merchantNetUsdt?.toFixed(6) ?? '0.000000', wallets: walletCount, pendingKyc,
    },
    recentPayments: recentPayments.map(p => ({ id: p.id, externalId: p.externalId, status: p.status,
      amountBrlCents: p.amountBrlCents.toString(), commissionUsdt: p.commissionUsdt?.toString() ?? null,
      merchantNetUsdt: p.merchantNetUsdt?.toString() ?? null, merchantName: p.merchant.legalName,
      merchantEmail: p.merchant.user.email, network: p.walletDestination.networkCode,
      walletLast8: p.walletDestination.addressLast8, createdAt: p.createdAt,
      transfers: p.transfers.map(t => ({ kind: t.kind, status: t.status, amountUsdt: t.amountUsdt.toString(), txHash: t.txHash }))
    })),
  };
});

app.get('/v1/admin/commission-wallets', { preHandler: app.authenticate }, async (request, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'admin_only' });
  const wallets = await prisma.platformWallet.findMany({ orderBy: { networkCode: 'asc' } });
  return wallets.map(w => ({ networkCode: w.networkCode, currencySymbol: w.currencySymbol.toUpperCase(), addressLast8: w.addressLast8, isEnabled: w.isEnabled }));
});

app.post('/v1/admin/commission-wallets', { preHandler: app.authenticate }, async (request, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'admin_only' });
  const parsed = z.object({ networkCode: z.enum(['polygon', 'tron']), address: z.string().min(20).max(128), isEnabled: z.boolean().default(true) }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_platform_wallet', details: parsed.error.flatten() });
  if (!validateAddress(parsed.data.networkCode, parsed.data.address)) return reply.code(400).send({ error: 'wallet_address_network_mismatch' });
  const wallet = await prisma.platformWallet.upsert({
    where: { networkCode: parsed.data.networkCode },
    update: { addressEncrypted: encryptPii(parsed.data.address), addressLast8: parsed.data.address.slice(-8), isEnabled: parsed.data.isEnabled },
    create: { networkCode: parsed.data.networkCode, addressEncrypted: encryptPii(parsed.data.address), addressLast8: parsed.data.address.slice(-8), isEnabled: parsed.data.isEnabled },
  });
  await audit(request, 'PLATFORM_COMMISSION_WALLET_SAVED', 'PLATFORM_WALLET', wallet.id, { networkCode: wallet.networkCode, isEnabled: wallet.isEnabled });
  return reply.code(201).send({ networkCode: wallet.networkCode, addressLast8: wallet.addressLast8, isEnabled: wallet.isEnabled });
});

app.get('/v1/payments', { preHandler: app.authenticate }, async (request) => {
  const merchant = await merchantFor(request);
  const payments = await prisma.payment.findMany({ where: { merchantId: merchant.id }, include: { walletDestination: true, transfers: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  return payments.map(p => ({ id: p.id, externalId: p.externalId, status: p.status, amountBrlCents: p.amountBrlCents.toString(), commissionUsdt: p.commissionUsdt?.toString() ?? null, merchantNetUsdt: p.merchantNetUsdt?.toString() ?? null, wallet: { label: p.walletDestination.label, exchangeName: p.walletDestination.exchangeName, networkCode: p.walletDestination.networkCode, addressLast8: p.walletDestination.addressLast8 }, createdAt: p.createdAt, expiresAt: p.expiresAt, transfers: p.transfers.map(t => ({ kind: t.kind, status: t.status, amountUsdt: t.amountUsdt.toString(), txHash: t.txHash })) }));
});

app.post('/v1/payments', { preHandler: [app.authenticate] }, async (request, reply) => {
  if (!mockFinancialExecutionEnabled) {
    return reply.code(503).send({ error: 'financial_operations_disabled' });
  }

  const parsed = z.object({
    amountBrlCents: z.number().int().min(500).max(10_000_000),
    walletId: z.string().min(1),
    description: z.string().max(120).optional(),
  }).strict().safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_payment', details: parsed.error.flatten() });
  }

  const idempotencyKey = request.headers['idempotency-key'];
  if (!isValidIdempotencyKey(idempotencyKey)) {
    return reply.code(400).send({ error: 'valid_idempotency_key_required' });
  }

  const merchant = await merchantFor(request);
  const result = await createPaymentIdempotently(prisma, {
    merchantId: merchant.id,
    actorUserId: userId(request),
    walletDestinationId: parsed.data.walletId,
    amountBrlCents: parsed.data.amountBrlCents,
    commissionBps: config.PLATFORM_COMMISSION_BPS,
    description: parsed.data.description,
    idempotencyKey,
    ipAddress: request.ip,
  });

  switch (result.kind) {
    case 'idempotency_conflict':
      return reply.code(409).send({ error: result.error });
    case 'idempotency_in_progress':
      reply.header('Retry-After', '1');
      return reply.code(409).send({ error: result.error });
    case 'merchant_not_approved':
      return reply.code(403).send({ error: result.error });
    case 'wallet_not_found':
      return reply.code(404).send({ error: result.error });
    case 'wallet_not_verified':
      return reply.code(409).send({ error: result.error });
    case 'replayed':
      reply.header('Idempotency-Replayed', 'true');
      return reply.code(201).send(result.response);
    case 'created':
      return reply.code(201).send(result.response);
  }
});
app.post('/v1/payments/:id/mock-settle', { preHandler: app.authenticate }, async (request, reply) => {
  if (!mockFinancialExecutionEnabled) return reply.code(403).send({ error: 'mock_only' });
  const merchant = await merchantFor(request);
  const { id } = request.params as { id: string };
  const payment = await prisma.payment.findFirst({ where: { id, merchantId: merchant.id } });
  if (!payment) return reply.code(404).send({ error: 'payment_not_found' });
  if (payment.status === PaymentStatus.COMPLETED) return { success: true, status: 'already_completed', mock: true };
  if (payment.status === PaymentStatus.PIX_CONFIRMED) {
    await enqueueSettlement(id, payment.amountBrlCents);
    return { success: true, mock: true, status: 'ENQUEUED', message: 'Confirmação simulada já registrada; liquidação re-enfileirada.' };
  }
  if (payment.status !== PaymentStatus.PIX_PENDING) return reply.code(409).send({ error: 'payment_not_pending' });
  // This endpoint exists only in non-production mock environments. Transition the
  // payment first so the worker's PIX_CONFIRMED guard cannot silently drop the job.
  const confirmed = await prisma.payment.updateMany({
    where: { id, merchantId: merchant.id, status: PaymentStatus.PIX_PENDING },
    data: { status: PaymentStatus.PIX_CONFIRMED, paidAt: new Date() },
  });
  if (confirmed.count !== 1) return reply.code(409).send({ error: 'payment_state_changed' });
  await enqueueSettlement(id, payment.amountBrlCents);
  await audit(request, 'PAYMENT_SETTLEMENT_ENQUEUED', 'PAYMENT', id, { mode: 'mock', simulatedPixConfirmation: true });
  return { success: true, mock: true, status: 'ENQUEUED', message: 'Confirmação PIX simulada; liquidação assíncrona enfileirada. Nenhum pagamento real foi recebido.' };
});

app.post('/webhooks/foxbit', { config: { rawBody: true } }, async (request, reply) => {
  if (config.PAYMENTS_MODE === 'mock') return reply.code(503).send({ error: 'provider_webhooks_disabled' });
  const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
  const signatureHeader = request.headers['x-fb-signature'];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!raw) return reply.code(400).send({ error: 'missing_raw_body' });
  if (!verifyFoxbitWebhook(raw, signature, config.FOXBIT_WEBHOOK_SECRET)) return reply.code(401).send({ error: 'invalid_webhook_signature' });
  let body: unknown;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return reply.code(400).send({ error: 'invalid_json' }); }
  const event = parseFoxbitWebhook(body);
  if (!event) return reply.code(400).send({ error: 'invalid_event_payload' });
  const state = mapWebhookStatusToPaymentState(event.webhook_type, event.data.to_state);
  let claim;
  try {
    claim = await claimWebhookEvent(prisma, { provider: 'FOXBIT', providerEventId: event.event_id, eventType: event.webhook_type, rawPayload: raw.toString('utf8'), payloadEncrypted: encryptPii(raw.toString('utf8')) });
  } catch (error) {
    if (error instanceof Error && error.message === 'webhook_event_payload_conflict') return reply.code(409).send({ error: 'webhook_event_payload_conflict' });
    throw error;
  }
  if (claim.status === 'processed') return reply.code(200).send({ received: true, duplicate: true, processed: true });
  if (claim.status === 'busy') return reply.code(503).header('retry-after', '5').send({ received: true, retry: true, reason: 'event_processing' });
  const duplicate = claim.duplicate;
  let processed = false;
  const postPaymentStatuses: PaymentStatus[] = [PaymentStatus.CONVERSION_PENDING, PaymentStatus.CRYPTO_CREDITED, PaymentStatus.MERCHANT_PAYOUT_PENDING, PaymentStatus.PLATFORM_PAYOUT_PENDING, PaymentStatus.COMPLETED];
  const foxbitOpenPaymentStatuses: PaymentStatus[] = [PaymentStatus.CREATED, PaymentStatus.PIX_PENDING];
  if (event.data.type !== 'withdrawal' && event.data.purchase_id && state === 'PIX_CONFIRMED') {
    const payment = await prisma.payment.findFirst({ where: { providerOrderId: event.data.purchase_id } });
    if (payment && foxbitOpenPaymentStatuses.includes(payment.status)) {
      const changed = await prisma.payment.updateMany({
        where: { id: payment.id, status: { in: foxbitOpenPaymentStatuses } },
        data: { status: PaymentStatus.PIX_CONFIRMED, paidAt: new Date() },
      });
      if (changed.count === 1) {
        await enqueueSettlement(payment.id, payment.amountBrlCents);
        processed = true;
      }
    } else if (payment?.status === PaymentStatus.PIX_CONFIRMED) {
      // A previous attempt may have committed PIX_CONFIRMED but failed before enqueueing.
      await enqueueSettlement(payment.id, payment.amountBrlCents);
      processed = true;
    } else if (payment && postPaymentStatuses.includes(payment.status)) {
      processed = true;
    }
  } else if (event.data.type !== 'withdrawal' && state === 'FAILED' && event.data.purchase_id) {
    const payment = await prisma.payment.findFirst({ where: { providerOrderId: event.data.purchase_id } });
    if (payment && foxbitOpenPaymentStatuses.includes(payment.status)) {
      const changed = await prisma.payment.updateMany({
        where: { id: payment.id, status: { in: foxbitOpenPaymentStatuses } },
        data: { status: PaymentStatus.FAILED, failureCode: 'PROVIDER_ORDER_FAILED', failureMessage: 'Foxbit reported that the PIX order failed before confirmation.' },
      });
      processed = changed.count === 1;
    } else if (payment?.status === PaymentStatus.FAILED) processed = true;
  }
  if (processed) await completeWebhookEvent(prisma, claim.eventId, claim.token);
  else await releaseWebhookEvent(prisma, claim.eventId, claim.token);
  request.log.info({ eventId: event.event_id, eventType: event.webhook_type, state, processed, duplicate }, 'Foxbit webhook recorded');
  if (!processed) return reply.code(503).header('retry-after', '30').send({ received: true, processed: false, retry: true });
  return reply.code(200).send({ received: true, processed, duplicate });
});
// --- TransFi Webhook Handler ---
app.post('/webhooks/transfi', { config: { rawBody: true } }, async (request, reply) => {
  if (config.PAYMENTS_MODE === 'mock') return reply.code(503).send({ error: 'provider_webhooks_disabled' });
  const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
  const signatureHeader = request.headers['x-transfi-hmac-hash'];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!raw) return reply.code(400).send({ error: 'missing_raw_body' });
  if (!signature) return reply.code(401).send({ error: 'missing_signature' });

  try {
    verifyTransFiWebhookSignature(raw, signature);
  } catch {
    return reply.code(403).send({ error: 'invalid_signature' });
  }

  const payload = parseTransFiWebhook(raw);
  const newState = mapTransFiStatusToPaymentState(payload.status);

  // Persist and claim the authenticated event before applying financial side effects.
  let claim;
  try {
    claim = await claimWebhookEvent(prisma, { provider: 'TRANSFI', providerEventId: payload.eventId, eventType: payload.entityType ?? 'unknown', rawPayload: raw.toString('utf8'), payloadEncrypted: encryptPii(raw.toString('utf8')) });
  } catch (error) {
    if (error instanceof Error && error.message === 'webhook_event_payload_conflict') return reply.code(409).send({ error: 'webhook_event_payload_conflict' });
    throw error;
  }
  if (claim.status === 'processed') return reply.code(200).send({ received: true, duplicate: true, processed: true });
  if (claim.status === 'busy') return reply.code(503).header('retry-after', '5').send({ received: true, retry: true, reason: 'event_processing' });
  const duplicate = claim.duplicate;

  let processed = false;
  const postPaymentStatuses: PaymentStatus[] = [PaymentStatus.CONVERSION_PENDING, PaymentStatus.CRYPTO_CREDITED, PaymentStatus.MERCHANT_PAYOUT_PENDING, PaymentStatus.PLATFORM_PAYOUT_PENDING, PaymentStatus.COMPLETED];
  const openPaymentStatuses: PaymentStatus[] = [PaymentStatus.CREATED, PaymentStatus.PIX_PENDING];
  if (payload.entityId && newState && payload.entityType === 'order' && payload.orderType === 'payin') {
    const payment = await prisma.payment.findFirst({ where: { providerOrderId: payload.entityId } });
    if (payment && newState === 'PAID' && openPaymentStatuses.includes(payment.status)) {
      const changed = await prisma.payment.updateMany({
        where: { id: payment.id, status: { in: openPaymentStatuses } },
        data: { status: PaymentStatus.PIX_CONFIRMED, paidAt: new Date() },
      });
      if (changed.count === 1) {
        await enqueueSettlement(payment.id, payment.amountBrlCents);
        processed = true;
      }
    } else if (payment && newState === 'PAID' && payment.status === PaymentStatus.PIX_CONFIRMED) {
      // Recover a confirmation committed before a queue publish failure.
      await enqueueSettlement(payment.id, payment.amountBrlCents);
      processed = true;
    } else if (payment && newState === 'PAID' && postPaymentStatuses.includes(payment.status)) {
      processed = true;
    } else if (payment && newState === 'FAILED' && openPaymentStatuses.includes(payment.status)) {
      const changed = await prisma.payment.updateMany({
        where: { id: payment.id, status: { in: openPaymentStatuses } },
        data: { status: PaymentStatus.FAILED, failureCode: 'PROVIDER_ORDER_FAILED', failureMessage: 'The provider reported that the PIX order failed before confirmation.' },
      });
      processed = changed.count === 1;
    } else if (payment && newState === 'FAILED' && payment.status === PaymentStatus.FAILED) {
      processed = true;
    }
    // "asset_settled" means provider-side asset settlement, not both external
    // beneficiary transfers. Only the payout orchestrator may complete a payment.
  }

  if (processed) await completeWebhookEvent(prisma, claim.eventId, claim.token);
  else await releaseWebhookEvent(prisma, claim.eventId, claim.token);
  request.log.info({ eventId: payload.eventId, eventType: payload.entityType, processed, duplicate }, 'TransFi webhook recorded');
  if (!processed) return reply.code(503).header('retry-after', '30').send({ received: true, processed: false, retry: true });
  return reply.code(200).send({ received: true, processed, duplicate });
});

// --- Merchant API Key Management (JWT Auth) ---
app.post('/v1/merchant/api-keys', { preHandler: [app.authenticate] }, async (request, reply) => {
  const merchant = await merchantFor(request);
  const body = request.body as { name?: string } | undefined;
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : 'default';
  const result = await generateMerchantApiKey(merchant.id, name);
  await audit(request, 'API_KEY_CREATED', 'MERCHANT_API_KEY', result.keyId, { prefix: result.prefix });
  return reply.code(201).send({
    keyId: result.keyId,
    prefix: result.prefix,
    secret: result.secret,
    warning: 'Store this secret securely. It will not be shown again.',
  });
});

app.get('/v1/merchant/api-keys', { preHandler: [app.authenticate] }, async (request) => {
  const merchant = await merchantFor(request);
  const keys = await prisma.merchantApiKey.findMany({
    where: { merchantId: merchant.id },
    select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return { keys };
});

app.delete('/v1/merchant/api-keys/:keyId', { preHandler: [app.authenticate] }, async (request, reply) => {
  const merchant = await merchantFor(request);
  const { keyId } = request.params as { keyId: string };
  const key = await prisma.merchantApiKey.findFirst({ where: { id: keyId, merchantId: merchant.id, revokedAt: null } });
  if (!key) return reply.code(404).send({ error: 'api_key_not_found' });
  await prisma.merchantApiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
  await audit(request, 'API_KEY_REVOKED', 'MERCHANT_API_KEY', keyId, { prefix: key.prefix });
  return { success: true, revoked: true };
});

// --- Merchant Wallet Management ---
app.get('/v1/merchant/wallets', { preHandler: [app.authenticate] }, async (request) => {
  const merchant = await merchantFor(request);
  const wallets = await prisma.walletDestination.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: 'desc' },
  });
  return { wallets: wallets.map(w => ({ id: w.id, label: w.label, networkCode: w.networkCode, addressLast8: w.addressLast8, status: w.status, isDefault: w.isDefault, createdAt: w.createdAt })) };
});

app.post('/v1/merchant/wallets', { preHandler: [app.authenticate] }, async (request, reply) => {
  const merchant = await merchantFor(request);
  const schema = z.object({ label: z.string().min(1).max(60), exchangeName: z.string().min(1).max(60), networkCode: z.enum(['polygon', 'tron']), address: z.string().min(20).max(128), memoTag: z.string().max(64).optional(), holderName: z.string().min(1).max(120), isDefault: z.boolean().default(false) });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_wallet', details: parsed.error.flatten() });
  if (!validateAddress(parsed.data.networkCode, parsed.data.address)) return reply.code(400).send({ error: 'wallet_address_network_mismatch' });
  // The compatibility endpoint obeys the same pending-by-default policy.
  const wallet = await prisma.walletDestination.create({ data: {
    merchantId: merchant.id, label: parsed.data.label, exchangeName: parsed.data.exchangeName, networkCode: parsed.data.networkCode, currencySymbol: 'usdt',
    addressEncrypted: encryptPii(parsed.data.address), addressLast8: parsed.data.address.slice(-8),
    tagEncrypted: parsed.data.memoTag ? encryptPii(parsed.data.memoTag) : null,
    holderName: parsed.data.holderName,
    isDefault: false, status: WalletStatus.PENDING_VERIFICATION,
  }});
  await audit(request, 'WALLET_CREATED', 'WALLET_DESTINATION', wallet.id, { networkCode: wallet.networkCode });
  return reply.code(201).send({ id: wallet.id, label: wallet.label, networkCode: wallet.networkCode, addressLast8: wallet.addressLast8, status: wallet.status, isDefault: wallet.isDefault });
});

app.delete('/v1/merchant/wallets/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
  const merchant = await merchantFor(request);
  const { id } = request.params as { id: string };
  const wallet = await prisma.walletDestination.findFirst({ where: { id, merchantId: merchant.id } });
  if (!wallet) return reply.code(404).send({ error: 'wallet_not_found' });
  await prisma.walletDestination.update({ where: { id }, data: { status: WalletStatus.DISABLED } });
  await audit(request, 'WALLET_DISABLED', 'WALLET_DESTINATION', id, {});
  return { success: true, disabled: true };
});

// --- Merchant Transaction History Export ---
app.get('/v1/merchant/history/export', { preHandler: [app.authenticate] }, async (request, reply) => {
  const merchant = await merchantFor(request);
  const payments = await prisma.payment.findMany({
    where: { merchantId: merchant.id },
    include: { transfers: true, walletDestination: true },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });
  const csvHeader = 'ID,ExternalID,Status,AmountBRL,MerchantNetUSDT,CommissionUSDT,WalletNetwork,WalletAddress,MerchantTransferStatus,PlatformTransferStatus,CreatedAt\n';
  const rows = payments.map(p => [
    p.id, p.externalId, p.status, (Number(p.amountBrlCents) / 100).toFixed(2),
    p.merchantNetUsdt?.toString() ?? '', p.commissionUsdt?.toString() ?? '',
    p.walletDestination.networkCode, p.walletDestination.addressLast8,
    p.merchantTransferStatus ?? '', p.platformTransferStatus ?? '',
    p.createdAt.toISOString(),
  ].join(',')).join('\n');
  reply.header('Content-Type', 'text/csv').header('Content-Disposition', 'attachment; filename="pixsplit-history.csv"');
  return csvHeader + rows;
});

// --- Admin: wallet verification queue ---
app.get('/v1/admin/wallets', { preHandler: [app.authenticate] }, async (request, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'forbidden' });
  const wallets = await prisma.walletDestination.findMany({
    include: { merchant: { include: { user: { select: { email: true } } } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    take: 500,
  });
  return wallets.map(wallet => ({
    id: wallet.id,
    label: wallet.label,
    exchangeName: wallet.exchangeName,
    networkCode: wallet.networkCode,
    addressLast8: wallet.addressLast8,
    walletType: wallet.walletType,
    holderName: wallet.holderName,
    holderCountry: wallet.holderCountry,
    vaspEntityCountry: wallet.vaspEntityCountry,
    status: wallet.status,
    isDefault: wallet.isDefault,
    createdAt: wallet.createdAt,
    merchant: {
      id: wallet.merchant.id,
      legalName: wallet.merchant.legalName,
      email: wallet.merchant.user.email,
      kycStatus: wallet.merchant.kycStatus,
      isEnabled: wallet.merchant.isEnabled,
    },
  }));
});

app.patch('/v1/admin/wallets/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'forbidden' });
  const parsed = z.object({ status: z.enum(['VERIFIED', 'REJECTED']) }).strict().safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_wallet_review' });
  const { id } = request.params as { id: string };
  const wallet = await prisma.walletDestination.findUnique({
    where: { id },
    include: { merchant: true },
  });
  if (!wallet) return reply.code(404).send({ error: 'wallet_not_found' });
  if (parsed.data.status === 'VERIFIED' && (!wallet.merchant.isEnabled || wallet.merchant.kycStatus !== 'APPROVED')) {
    return reply.code(409).send({ error: 'merchant_approval_required', message: 'A conta do comerciante precisa estar aprovada antes da carteira.' });
  }
  const updated = await prisma.walletDestination.update({
    where: { id },
    data: {
      status: parsed.data.status,
      isVerified: parsed.data.status === 'VERIFIED',
    },
  });
  await audit(request, `WALLET_${parsed.data.status}`, 'WALLET_DESTINATION', id, {
    merchantId: wallet.merchantId,
    networkCode: wallet.networkCode,
    previousStatus: wallet.status,
    status: updated.status,
  });
  return { id: updated.id, status: updated.status, isVerified: updated.isVerified };
});

// --- Admin: List Merchants ---
app.get('/v1/admin/merchants', { preHandler: [app.authenticate] }, async (request, reply) => {
  const user = (request as any).user;
  if (user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'forbidden' });
  const [merchants, paymentTotals] = await Promise.all([
    prisma.merchant.findMany({
      include: { user: { select: { email: true } }, _count: { select: { payments: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payment.groupBy({
      by: ['merchantId'],
      _sum: { amountBrlCents: true },
    }),
  ]);
  const volumeByMerchant = new Map(paymentTotals.map(item => [item.merchantId, item._sum.amountBrlCents ?? 0n]));
  return merchants.map(merchant => ({
    id: merchant.id,
    legalName: merchant.legalName,
    email: merchant.user.email,
    isEnabled: merchant.isEnabled,
    kycStatus: merchant.kycStatus,
    paymentsCount: merchant._count.payments,
    totalVolumeBrlCents: (volumeByMerchant.get(merchant.id) ?? 0n).toString(),
  }));
});


// --- Admin: payments list for reconciliation and audit ---
app.get('/v1/admin/payments', { preHandler: [app.authenticate] }, async (request, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'forbidden' });
  const payments = await prisma.payment.findMany({
    include: { walletDestination: true, transfers: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return payments.map(payment => ({
    id: payment.id,
    externalId: payment.externalId,
    status: payment.status,
    amountBrlCents: payment.amountBrlCents.toString(),
    commissionUsdt: payment.commissionUsdt?.toString() ?? null,
    merchantNetUsdt: payment.merchantNetUsdt?.toString() ?? null,
    merchantTransferStatus: payment.merchantTransferStatus,
    platformTransferStatus: payment.platformTransferStatus,
    createdAt: payment.createdAt,
    wallet: {
      label: payment.walletDestination.label,
      exchangeName: payment.walletDestination.exchangeName,
      networkCode: payment.walletDestination.networkCode,
      addressLast8: payment.walletDestination.addressLast8,
    },
    transfers: payment.transfers.map(transfer => ({
      kind: transfer.kind,
      status: transfer.status,
      amountUsdt: transfer.amountUsdt.toString(),
      txHash: transfer.txHash,
    })),
  }));
});

// --- Admin: Audit Logs ---
app.get('/v1/admin/audit', { preHandler: [app.authenticate] }, async (request, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'forbidden' });
  const logs = await prisma.auditEvent.findMany({
    include: { actor: { select: { email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return logs.map(log => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actorEmail: log.actor?.email ?? null,
    metadata: log.metadata,
    createdAt: log.createdAt,
  }));
});

// --- Admin: enable/disable merchants with KYC enforcement ---
app.patch('/v1/admin/merchants/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'forbidden' });
  const parsed = z.object({
    isEnabled: z.boolean().optional(),
    kycStatus: z.enum(['NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
  }).strict().refine(value => value.isEnabled !== undefined || value.kycStatus !== undefined).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_merchant_update' });
  const { id } = request.params as { id: string };
  const merchant = await prisma.merchant.findUnique({ where: { id } });
  if (!merchant) return reply.code(404).send({ error: 'merchant_not_found' });

  const nextKycStatus = parsed.data.kycStatus ?? merchant.kycStatus;
  if (parsed.data.isEnabled === true && nextKycStatus !== 'APPROVED') {
    return reply.code(409).send({ error: 'kyc_approval_required', message: 'O comerciante só pode ser ativado após aprovação KYC.' });
  }

  const updateData: Prisma.MerchantUpdateInput = {};
  if (parsed.data.kycStatus !== undefined) updateData.kycStatus = parsed.data.kycStatus;
  if (parsed.data.isEnabled !== undefined) updateData.isEnabled = parsed.data.isEnabled;
  if (parsed.data.kycStatus === 'REJECTED' || parsed.data.kycStatus === 'NOT_STARTED') updateData.isEnabled = false;

  const updated = await prisma.merchant.update({ where: { id }, data: updateData });
  const action = parsed.data.kycStatus
    ? `MERCHANT_KYC_${parsed.data.kycStatus}`
    : parsed.data.isEnabled ? 'MERCHANT_ENABLED' : 'MERCHANT_DISABLED';
  await audit(request, action, 'MERCHANT', id, { previousKycStatus: merchant.kycStatus, kycStatus: updated.kycStatus, isEnabled: updated.isEnabled });
  return { id: updated.id, isEnabled: updated.isEnabled, kycStatus: updated.kycStatus };
});

// --- Admin: Retry Failed Payment ---
app.post('/v1/admin/payments/:id/retry', { preHandler: [app.authenticate] }, async (request, reply) => {
  if (!mockFinancialExecutionEnabled) return reply.code(503).send({ error: 'financial_reconciliation_disabled' });
  const user = (request as any).user;
  if (user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'forbidden' });
  const { id } = request.params as { id: string };
  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) return reply.code(404).send({ error: 'not_found' });
  const resumableStatuses: PaymentStatus[] = [
    PaymentStatus.CONVERSION_PENDING,
    PaymentStatus.CRYPTO_CREDITED,
    PaymentStatus.COMMISSION_TRANSFER_PENDING,
    PaymentStatus.MERCHANT_PAYOUT_PENDING,
    PaymentStatus.PLATFORM_PAYOUT_PENDING,
    PaymentStatus.FAILED,
    PaymentStatus.UNDER_REVIEW,
  ];
  const resumable = payment.status === PaymentStatus.PIX_CONFIRMED
    || (resumableStatuses.includes(payment.status)
      && payment.providerGrossUsdt !== null
      && payment.merchantNetUsdt !== null
      && payment.commissionUsdt !== null);
  if (!resumable) {
    return reply.code(400).send({ error: 'invalid_state', message: 'Only converted payments with a recoverable payout state can be reconciled' });
  }
  await enqueueSettlement(payment.id, payment.amountBrlCents);
  await audit(request, 'PAYMENT_RECONCILIATION_ENQUEUED', 'PAYMENT', payment.id, { previousStatus: payment.status });
  return { success: true, message: 'Provider reconciliation enqueued; unknown transfers will not be blindly resubmitted' };
});

// --- Protected Merchant Endpoint: Create Payment (HMAC Auth) ---
const createPaymentSchema = z.object({
  amountBrlCents: z.number().int().min(500).max(10_000_000),
  walletDestinationId: z.string().min(1),
  externalId: z.string().min(1).max(128).optional(),
  payerName: z.string().min(1).max(200).optional(),
  payerTaxId: z.string().min(1).max(64).optional(),
  description: z.string().max(500).optional(),
});

app.post('/v1/merchant/payments', { preHandler: [hmacAuthMiddleware], config: { rawBody: true } }, async (request, reply) => {
  if (!mockFinancialExecutionEnabled) return reply.code(503).send({ error: 'financial_operations_disabled' });
  const merchant = (request as any).merchant as { merchantId: string; keyId: string };
  const parsed = createPaymentSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
  }
  const { amountBrlCents, walletDestinationId, externalId, payerName, payerTaxId, description } = parsed.data;

  // Validate wallet belongs to merchant
  const merchantRecord = await prisma.merchant.findUnique({ where: { id: merchant.merchantId } });
  if (!merchantRecord?.isEnabled || merchantRecord.kycStatus !== 'APPROVED') {
    return reply.code(403).send({ error: 'merchant_not_approved', message: 'The merchant must be KYC-approved and enabled before creating PIX charges.' });
  }
  const wallet = await prisma.walletDestination.findFirst({ where: { id: walletDestinationId, merchantId: merchant.merchantId } });
  if (!wallet) {
    return reply.code(400).send({ error: 'invalid_wallet', message: 'Wallet not found or does not belong to merchant' });
  }
  if (wallet.status !== WalletStatus.VERIFIED) {
    return reply.code(409).send({ error: 'wallet_not_verified', message: 'The destination wallet must be verified before creating PIX charges.' });
  }

  const paymentExternalId = externalId || randomUUID();
  const existing = await prisma.payment.findUnique({ where: { externalId: paymentExternalId } });
  if (existing && existing.merchantId !== merchant.merchantId) return reply.code(409).send({ error: 'external_id_conflict' });
  if (existing) {
    return reply.code(200).send({
      paymentId: existing.id,
      externalId: existing.externalId,
      status: existing.status,
      pixQrCodeBase64: existing.pixQrCodeBase64,
      pixCopyPaste: existing.pixCopyPaste,
    });
  }

  // Real provider flow: create charge via configured payment provider (Foxbit or TransFi).
  // In mock mode, the adapter returns simulated but structurally valid data.
  // In sandbox/live, it makes real HTTP calls to the configured provider.
  const adapter = createPaymentProvider();

  const destWallet = await prisma.walletDestination.findUniqueOrThrow({ where: { id: walletDestinationId } });
  const charge = await adapter.createPixCharge({
    merchantReference: paymentExternalId,
    amountBrlCents: BigInt(amountBrlCents),
    payer: { name: payerName || undefined, taxId: payerTaxId || undefined },
    beneficiary: {
      walletAddress: decryptPii(destWallet.addressEncrypted),
      network: destWallet.networkCode,
      memo: destWallet.tagEncrypted ? decryptPii(destWallet.tagEncrypted) : undefined,
      exchangeName: destWallet.exchangeName,
      holderName: destWallet.holderName,
      holderTaxId: destWallet.holderTaxIdEncrypted ? decryptPii(destWallet.holderTaxIdEncrypted) : undefined,
    },
  }, paymentExternalId);

  // Conversion and 98/2 split happen only after a verified PIX confirmation.
  const payment = await prisma.payment.create({
    data: {
      merchantId: merchant.merchantId,
      walletDestinationId,
      externalId: paymentExternalId,
      amountBrlCents: BigInt(amountBrlCents),
      commissionBps: config.PLATFORM_COMMISSION_BPS,
      status: PaymentStatus.PIX_PENDING,
      providerOrderId: charge.providerChargeId,
      pixQrCodeBase64: charge.qrCodeBase64 ?? null,
      pixCopyPaste: charge.copyPaste,
      expiresAt: charge.expiresAt,
      payerName: payerName || null,
      payerTaxIdEncrypted: payerTaxId ? encryptPii(payerTaxId) : null,
      payerTaxIdLast4: payerTaxId ? payerTaxId.slice(-4) : null,
      description: description || null,
    },
  });

  // DO NOT enqueue settlement here. Settlement is triggered ONLY after
  // webhook confirmation (PIX_RECEIVED / PAYMENT_CONFIRMED) from Foxbit.
  // This prevents processing payments before actual PIX receipt.

  return reply.code(201).send({
    paymentId: payment.id,
    externalId: payment.externalId,
    amountBrlCents: payment.amountBrlCents.toString(),
    usdtAmount: null,
    merchantNetUsdt: null,
    commissionUsdt: null,
    status: payment.status,
    pixQrCodeBase64: payment.pixQrCodeBase64,
    pixCopyPaste: payment.pixCopyPaste,
    expiresAt: payment.expiresAt?.toISOString(),
    providerOrderId: payment.providerOrderId,
    mode: 'mock',
    warning: 'Cobrança criada em modo de demonstração. Não aceite nem envie este código PIX como pagamento real.',
  });
});

app.setErrorHandler((error, request, reply) => {
  const err = error as Error & { statusCode?: number };
  request.log.error({ err: err.name, message: err.message, requestId: request.id }, 'Request failed');
  const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
  reply.code(status).send({ error: status >= 500 ? 'internal_server_error' : err.message, requestId: request.id });
});

// Mock financial workers must never run in production.
const settlementWorker = mockFinancialExecutionEnabled ? startSettlementWorker() : null;
const retryWorker = mockFinancialExecutionEnabled ? startRetryWorker() : null;
const reconciliation = new ReconciliationService(prisma);
const reconciliationTimer = mockFinancialExecutionEnabled ? setInterval(() => {
  void reconciliation.reconcile().catch((error) => {
    app.log.error({ err: error instanceof Error ? error.name : 'unknown' }, 'Payment reconciliation cycle failed');
  });
}, 5 * 60 * 1000) : null;
reconciliationTimer?.unref();

const shutdown = async () => {
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  await settlementWorker?.close();
  await retryWorker?.close();
  await closeQueues();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
await app.listen({ host: '0.0.0.0', port: config.API_PORT });
