import argon2 from 'argon2';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(process.cwd(), '../../.env') });
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();
const [emailArg, nameArg, password] = process.argv.slice(2);
if (!emailArg || !nameArg || !password || password.length < 16) {
  console.error('Uso: pnpm --filter @pixsplit/api create-admin -- email nome "senha-com-16-ou-mais-caracteres"');
  process.exit(1);
}
try {
  const user = await prisma.user.create({ data: {
    email: emailArg.toLowerCase(), fullName: nameArg,
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }), role: UserRole.SUPER_ADMIN,
  } });
  console.log(`Administrador criado: ${user.email}`);
} catch {
  console.error('Não foi possível criar o administrador. Verifique se o e-mail já existe.');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
