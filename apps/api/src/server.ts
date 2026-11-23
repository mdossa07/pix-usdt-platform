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
import { calculateUsdtSplit, mockBrlToUsdt } from './payments/split.js';
import { verifyFoxbitWebhook } from './providers/foxbit/foxbit-webhook.js';

const prisma = new PrismaClient();
const app = Fastify({ logger: true, bodyLimit: 1_048_576 });

await app.register(helmet);
await app.register(cors, { origin: config.APP_URL, credentials: true });
await app.register(rateLimit, { max: 80, timeWindow: '1 minute' });
await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: '2h' } });
await app.register(rawBody, { field: 'rawBody', global: false, encoding: false, runFirst: true });

app.decorate('authenticate', async (request, reply) => {
  try { await request.jwtVerify(); }
  catch { await reply.code(401).send({ error: 'unauthorized' }); }
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
app.get('/v1/provider/status', async () => ({
  provider: 'FOXBIT', enabled: false, adapterReady: false,
  credentialsConfigured: Boolean(config.FOXBIT_API_KEY && config.FOXBIT_API_SECRET),
  connection: 'INTEGRATION_PENDING', paymentsMode: 'mock', liveOperationsEnabled: false,
  pendingApprovals: ['contrato white-label/multiusuário', 'PIX de terceiros associado ao merchant', 'funding da subconta', 'compra/conversão USDT', 'split 98/2 por operação', 'saques HOSTED', 'saque automatizado da comissão'],
}));

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
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = app.jwt.sign({ sub: user.id, role: user.role });
  return { token, user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role }, merchant: user.merchant ? { id: user.merchant.id, kycStatus: user.merchant.kycStatus } : null };
});

app.get('/v1/me', { preHandler: app.authenticate }, async (request, reply) => {
  const user = await prisma.user.findUnique({ where: { id: userId(request) }, include: { merchant: true } });
  if (!user) return reply.code(404).send({ error: 'user_not_found' });
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role, merchant: user.merchant ? { id: user.merchant.id, legalName: user.merchant.legalName, kycStatus: user.merchant.kycStatus, isEnabled: user.merchant.isEnabled } : null };
});

app.get('/v1/wallets', { preHandler: app.authenticate }, async (request) => {
  const merchant = await merchantFor(request);
  const wallets = await prisma.walletDestination.findMany({ where: { merchantId: merchant.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
  return wallets.map(w => ({ id: w.id, label: w.label, exchangeName: w.exchangeName, networkCode: w.networkCode, currencySymbol: w.currencySymbol.toUpperCase(), address: decryptPii(w.addressEncrypted), tag: w.tagEncrypted ? decryptPii(w.tagEncrypted) : null, walletType: w.walletType, status: w.status, holderName: w.holderName, holderCountry: w.holderCountry, isDefault: w.isDefault, createdAt: w.createdAt }));
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
  const wallet = await prisma.$transaction(async tx => {
    if (data.makeDefault) await tx.walletDestination.updateMany({ where: { merchantId: merchant.id }, data: { isDefault: false } });
    return tx.walletDestination.create({ data: {
      merchantId: merchant.id, label: data.label, exchangeName: data.exchangeName, networkCode: data.networkCode,
      addressEncrypted: encryptPii(data.address), addressLast8: data.address.slice(-8), tagEncrypted: data.tag ? encryptPii(data.tag) : null,
      walletType: data.walletType as WalletType, walletOwner: 'SELF', holderName: data.holderName,
      holderTaxIdEncrypted: data.holderTaxId ? encryptPii(data.holderTaxId) : null,
      holderCountry: data.holderCountry.toUpperCase(), vaspEntityCountry: data.vaspEntityCountry?.toUpperCase() ?? null,
      isDefault: data.makeDefault, status: WalletStatus.PENDING_VERIFICATION,
    } });
  });
  await audit(request, 'WALLET_REGISTERED', 'WALLET', wallet.id, { networkCode: wallet.networkCode, walletType: wallet.walletType, exchangeName: wallet.exchangeName });
  return reply.code(201).send({ id: wallet.id, label: wallet.label, exchangeName: wallet.exchangeName, networkCode: wallet.networkCode, addressLast8: wallet.addressLast8, status: wallet.status, note: 'Carteira cadastrada; aguarda validação de titularidade e Travel Rule pelo provedor.' });
});

app.post('/v1/wallets/:id/default', { preHandler: app.authenticate }, async (request, reply) => {
  const merchant = await merchantFor(request);
  const { id } = request.params as { id: string };
  const wallet = await prisma.walletDestination.findFirst({ where: { id, merchantId: merchant.id } });
  if (!wallet) return reply.code(404).send({ error: 'wallet_not_found' });
  await prisma.$transaction([
    prisma.walletDestination.updateMany({ where: { merchantId: merchant.id }, data: { isDefault: false } }),
    prisma.walletDestination.update({ where: { id }, data: { isDefault: true } }),
  ]);
  await audit(request, 'WALLET_SET_DEFAULT', 'WALLET', id);
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
  return wallets.map(w => ({ networkCode: w.networkCode, currencySymbol: w.currencySymbol.toUpperCase(), address: decryptPii(w.addressEncrypted), addressLast8: w.addressLast8, isEnabled: w.isEnabled }));
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

app.post('/v1/payments', { preHandler: app.authenticate }, async (request, reply) => {
  const schema = z.object({ amountBrlCents: z.number().int().min(500).max(10_000_000), walletId: z.string().min(1), description: z.string().max(120).optional() });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_payment', details: parsed.error.flatten() });
  const merchant = await merchantFor(request);
  const wallet = await prisma.walletDestination.findFirst({ where: { id: parsed.data.walletId, merchantId: merchant.id } });
  if (!wallet) return reply.code(404).send({ error: 'wallet_not_found' });
  if (wallet.status === WalletStatus.REJECTED || wallet.status === WalletStatus.DISABLED) return reply.code(400).send({ error: 'wallet_not_eligible' });
  const externalId = `ps_${randomUUID().replaceAll('-', '')}`;
  const payment = await prisma.payment.create({ data: {
    externalId, merchantId: merchant.id, walletDestinationId: wallet.id,
    status: PaymentStatus.PIX_PENDING, description: parsed.data.description, amountBrlCents: BigInt(parsed.data.amountBrlCents), commissionBps: config.PLATFORM_COMMISSION_BPS,
    pixCopyPaste: `MOCK-PIX-NOT-PAYABLE-${externalId}`, expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  } });
  await audit(request, 'PAYMENT_CREATED_MOCK', 'PAYMENT', payment.id, { amountBrlCents: parsed.data.amountBrlCents, walletId: wallet.id });
  return reply.code(201).send({ id: payment.id, externalId, status: payment.status, amountBrlCents: payment.amountBrlCents.toString(), pixCopyPaste: payment.pixCopyPaste, expiresAt: payment.expiresAt, mode: 'mock', warning: 'Este código é fictício e não aceita pagamento. Integração PIX real aguarda homologação Foxbit.' });
});

/** Local-only simulation. It never contacts the provider or blockchain. */
app.post('/v1/payments/:id/mock-settle', { preHandler: app.authenticate }, async (request, reply) => {
  if (config.PAYMENTS_MODE !== 'mock' || config.NODE_ENV === 'production') return reply.code(403).send({ error: 'mock_only' });
  const merchant = await merchantFor(request);
  const { id } = request.params as { id: string };
  const payment = await prisma.payment.findFirst({ where: { id, merchantId: merchant.id }, include: { walletDestination: true } });
  if (!payment) return reply.code(404).send({ error: 'payment_not_found' });
  if (payment.status === PaymentStatus.COMPLETED) return { success: true, status: 'already_completed', mock: true };
  if (payment.status !== PaymentStatus.PIX_PENDING) return reply.code(409).send({ error: 'payment_not_pending' });
  const grossUsdt = mockBrlToUsdt(payment.amountBrlCents, config.MOCK_USDT_PER_BRL);
  const split = calculateUsdtSplit(grossUsdt, payment.commissionBps, 6);
  const platformWallet = await prisma.platformWallet.findUnique({ where: { networkCode: payment.walletDestination.networkCode } });
  const commissionAddressEncrypted = platformWallet?.addressEncrypted ?? encryptPii('MOCK-PLATFORM-WALLET');
  const now = new Date();
  await prisma.$transaction(async tx => {
    await tx.payment.update({ where: { id }, data: {
      status: PaymentStatus.COMPLETED, providerGrossUsdt: grossUsdt, providerFeesUsdt: '0',
      commissionUsdt: split.commissionUsdt, merchantNetUsdt: split.merchantUsdt,
      fxRate: config.MOCK_USDT_PER_BRL, paidAt: now, completedAt: now,
    } });
    await tx.transfer.createMany({ data: [
      { paymentId: id, kind: TransferKind.MERCHANT_PAYOUT, status: TransferStatus.COMPLETED, amountUsdt: split.merchantUsdt, networkCode: payment.walletDestination.networkCode, destinationAddressEnc: payment.walletDestination.addressEncrypted, idempotencyKey: `${payment.externalId}:merchant:mock`, txHash: `MOCK-MERCHANT-${payment.externalId}` },
      { paymentId: id, kind: TransferKind.PLATFORM_COMMISSION, status: TransferStatus.COMPLETED, amountUsdt: split.commissionUsdt, networkCode: payment.walletDestination.networkCode, destinationAddressEnc: commissionAddressEncrypted, idempotencyKey: `${payment.externalId}:platform:mock`, txHash: `MOCK-COMMISSION-${payment.externalId}` },
    ] });
    await tx.ledgerEntry.createMany({ data: [
      { paymentId: id, accountCode: 'MOCK_CLEARING', asset: 'USDT', direction: LedgerDirection.CREDIT, amount: grossUsdt, status: LedgerStatus.POSTED, reference: `${payment.externalId}:clearing:credit` },
      { paymentId: id, accountCode: 'MERCHANT_PAYOUT', asset: 'USDT', direction: LedgerDirection.DEBIT, amount: split.merchantUsdt, status: LedgerStatus.POSTED, reference: `${payment.externalId}:merchant:debit` },
      { paymentId: id, accountCode: 'PLATFORM_COMMISSION', asset: 'USDT', direction: LedgerDirection.DEBIT, amount: split.commissionUsdt, status: LedgerStatus.POSTED, reference: `${payment.externalId}:commission:debit` },
    ] });
    await tx.auditEvent.create({ data: { actorUserId: userId(request), action: 'PAYMENT_SETTLED_MOCK', entityType: 'PAYMENT', entityId: id, ipAddress: request.ip, metadata: { grossUsdt, commissionUsdt: split.commissionUsdt, merchantUsdt: split.merchantUsdt } } });
  });
  return { success: true, mock: true, status: 'COMPLETED', split, warning: 'Liquidação simulada; nenhum PIX, USDT ou transferência real foi executado.' };
});

app.post('/webhooks/foxbit', { config: { rawBody: true } }, async (request, reply) => {
  const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
  const signatureHeader = request.headers['x-fb-signature'];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!raw || !verifyFoxbitWebhook(raw, signature, config.FOXBIT_WEBHOOK_SECRET)) return reply.code(401).send({ error: 'invalid_webhook_signature' });
  const event = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
  const eventId = typeof event.event_id === 'string' ? event.event_id : null;
  const eventType = typeof event.webhook_type === 'string' ? event.webhook_type : typeof event.type === 'string' ? event.type : 'unknown';
  try {
    await prisma.webhookEvent.create({ data: { provider: 'FOXBIT', providerEventId: eventId, eventType, payloadEncrypted: encryptPii(raw.toString('utf8')), signatureValid: true } });
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') return reply.code(200).send({ accepted: true, duplicate: true });
    throw error;
  }
  request.log.info({ eventType, eventId }, 'Foxbit webhook verified and persisted; not processed until provider schema is approved');
  return reply.code(202).send({ accepted: true, processed: false });
});

app.setErrorHandler((error, request, reply) => {
  const err = error as Error & { statusCode?: number };
  request.log.error({ err: err.name, message: err.message, requestId: request.id }, 'Request failed');
  const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
  reply.code(status).send({ error: status >= 500 ? 'internal_server_error' : err.message, requestId: request.id });
});

const shutdown = async () => { await app.close(); await prisma.$disconnect(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
await app.listen({ host: '0.0.0.0', port: config.API_PORT });
