import { PrismaClient, UserRole, MerchantType, KycStatus, WalletType, WalletOwner, WalletStatus, PaymentStatus } from '@prisma/client';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting PixSplit seed...');

  // 1. Create Super Admin User
  const adminPassword = await argon2.hash('admin123');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@pixsplit.dev' },
    update: {},
    create: {
      email: 'admin@pixsplit.dev',
      passwordHash: adminPassword,
      fullName: 'Platform Admin',
      role: UserRole.SUPER_ADMIN,
    },
  });
  console.log(`✅ Admin user created: ${admin.email}`);

  // 2. Create Demo Merchant
  const merchantPassword = await argon2.hash('merchant123');
  const merchantUser = await prisma.user.upsert({
    where: { email: 'demo@merchant.com' },
    update: {},
    create: {
      email: 'demo@merchant.com',
      passwordHash: merchantPassword,
      fullName: 'Demo Merchant Owner',
      role: UserRole.MERCHANT,
    },
  });

  const merchant = await prisma.merchant.upsert({
    where: { userId: merchantUser.id },
    update: {},
    create: {
      userId: merchantUser.id,
      merchantType: MerchantType.COMPANY,
      legalName: 'Demo Comércio Digital Ltda',
      taxIdEncrypted: 'enc_mock_00000000000191',
      taxIdLast4: '0191',
      kycStatus: KycStatus.APPROVED,
      isEnabled: true,
    },
  });
  console.log(`✅ Merchant created: ${merchant.legalName} (${merchant.id})`);

  // 3. Create Default Wallet for Merchant
  const wallet = await prisma.walletDestination.upsert({
    where: { id: 'demo-wallet-001' },
    update: {},
    create: {
      id: 'demo-wallet-001',
      merchantId: merchant.id,
      label: 'Carteira Principal USDT',
      exchangeName: 'Foxbit',
      networkCode: 'polygon',
      currencySymbol: 'usdt',
      addressEncrypted: 'enc_mock_0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      addressLast8: '4438f44e',
      walletType: WalletType.HOSTED,
      walletOwner: WalletOwner.SELF,
      status: WalletStatus.VERIFIED,
      holderName: 'Demo Comércio Digital Ltda',
      isDefault: true,
      isVerified: true,
    },
  });
  console.log(`✅ Wallet created: ...${wallet.addressLast8}`);

  // 4. Create Platform Commission Wallet
  await prisma.platformWallet.upsert({
    where: { networkCode: 'polygon' },
    update: {},
    create: {
      networkCode: 'polygon',
      currencySymbol: 'usdt',
      addressEncrypted: 'enc_platform_0x0000000000000000000000000000000000000000',
      addressLast8: '00000000',
      isEnabled: true,
    },
  });
  console.log('✅ Platform commission wallet configured');

  // 5. Create Sample Payments in Various States
  const payments = [
    { status: PaymentStatus.PIX_PENDING, desc: 'Pedido #1001 - Tênis Esportivo', cents: 29990 },
    { status: PaymentStatus.COMPLETED, desc: 'Pedido #998 - Fone Bluetooth', cents: 1590 },
    { status: PaymentStatus.FAILED, desc: 'Pedido #995 - Relógio Smart', cents: 14990, failure: 'PIX expirado' },
    { status: PaymentStatus.CRYPTO_CREDITED, desc: 'Pedido #1002 - Curso Online', cents: 49900 },
  ];

  for (const p of payments) {
    const extId = `ps_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    await prisma.payment.create({
      data: {
        externalId: extId,
        merchantId: merchant.id,
        walletDestinationId: wallet.id,
        status: p.status,
        description: p.desc,
        amountBrlCents: BigInt(p.cents),
        commissionBps: 200, // 2%
        pixCopyPaste: `MOCK-PIX-${extId}`,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        failureMessage: p.failure ?? null,
      },
    });
  }
  console.log(`✅ ${payments.length} sample payments created`);

  console.log('\n🎉 Seed completed successfully!');
  console.log('   Admin: admin@pixsplit.dev / admin123');
  console.log('   Merchant: demo@merchant.com / merchant123');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });