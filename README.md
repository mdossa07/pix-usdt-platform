# PixSplit — plataforma SaaS de cobranças PIX com liquidação em USDT

> Versão 0.2.0 — aplicação inicial executável somente em modo mock. Nenhum pagamento ou saque real está habilitado.

## Produto

A plataforma será comercializada para múltiplos usuários/empresas. Cada usuário cadastra um endereço de depósito em uma corretora/VASP (ou carteira própria aceita pelo provedor), a rede, eventual memo/tag e os dados de beneficiário exigidos pelo processo de Travel Rule. O pagador final cria/recebe uma cobrança PIX em BRL. Após o pagamento e a conversão autorizada, a plataforma orquestra duas liquidações:

- 98% do USDT líquido ao endereço de recebimento vinculado ao usuário;
- 2% do USDT à tesouraria da plataforma.

O produto não pede senhas, chaves privadas, seed phrases nem API keys de saque das corretoras dos usuários.

## Estado técnico atual

- Painel web Next.js com overview, operações, carteiras, integração e relatórios demonstrativos.
- API Fastify com autenticação JWT, cadastro de merchant, login, cadastro criptografado de carteiras, criação de cobrança mock, consulta de dashboard/operações e endpoint de liquidação simulada.
- PostgreSQL/Prisma com usuários, merchants, destinos, pagamentos, duas pernas de transferência, ledger, webhooks, chaves de API e auditoria.
- Precisão financeira via `BigInt`; comissão padrão 200 bps (2%).
- Webhook Foxbit V2 com validação HMAC do corpo bruto.
- Proibição explícita de iniciar operações sandbox/live até aprovações e implementação do contrato financeiro real.

## Atenção: desenho Foxbit ainda depende de validação

A Foxbit Partner API documenta o Fiat Gateway como um fluxo parceiro (partner-level) para cobrança PIX de terceiros. A própria documentação diz que essa cobrança não financia automaticamente o saldo de uma subconta; funding de sub-member é via `internal_cash_in` da conta raiz ou chave PIX provisionada pela Foxbit. O RFQ para comprar cripto em nome de sub-member exige que a subconta já tenha saldo BRL. Veja `docs/03-foxbit-integration.md`.

Por isso a aplicação não assume que uma única chamada pública já faz o fluxo inteiro. A Foxbit precisa confirmar qual arranjo contratado permitirá atribuir a cobrança PIX ao usuário, converter para USDT, movimentar a subconta e concluir as duas pernas externas.

## Stack

- Web: Next.js 16 + React 19 + TypeScript
- API: Fastify 5 + TypeScript + Zod + JWT + Argon2
- Dados: PostgreSQL 16 + Prisma 6
- Filas (próxima etapa): Redis 7 + BullMQ

## Requisitos

- Node.js 22+
- pnpm 10+
- Docker Desktop funcional (ou PostgreSQL 16 local)

## Rodar no Windows PowerShell

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
.\scripts\generate-secrets.ps1
# O script grava segredos aleatórios de desenvolvimento em .env; nunca faça commit desse arquivo.
docker compose up -d postgres redis
pnpm db:generate
pnpm db:migrate -- --name init
pnpm dev
```

Web: http://localhost:3000  
API liveness: http://localhost:4000/health
API readiness (PostgreSQL + Redis): http://localhost:4000/ready

## Criar usuário superadministrador

Após o banco estar migrado, crie o primeiro administrador pelo terminal (a senha deve ter pelo menos 16 caracteres):

```powershell
pnpm --filter @pixsplit/api create-admin -- admin@seudominio.com "Administrador PixSplit" "SENHA_FORTE_COM_16_CARACTERES"
```

## Teste local de API

1. `POST /v1/auth/register` com `fullName`, `email`, senha de 12+ caracteres, `merchantType`, `legalName` e `taxId` de 11 ou 14 dígitos.
2. Faça login em `POST /v1/auth/login` e use o JWT como `Authorization: Bearer <token>`.
3. Cadastre carteira em `POST /v1/wallets`.
4. Crie cobrança mock em `POST /v1/payments` com `amountBrlCents` e `walletId`.
5. Em modo local, `POST /v1/payments/{id}/mock-settle` simula a liquidação e demonstra 98%/2%. O payload PIX é fictício e não pode ser pago.

## Segurança

- Não subir `.env` ao GitHub.
- `PII_ENCRYPTION_KEY` deve ser uma chave aleatória de 32 bytes em hexadecimal (64 caracteres).
- Credenciais Foxbit só no backend/secret manager.
- Nenhuma chamada live ou sandbox é habilitada nesta versão.
- Carteiras são pendentes até revisão/validação e KYC/Travel Rule.
- Não tratar o endereço de carteira como prova de titularidade.

## GitHub

O script `scripts/publish-to-github.ps1` cria um repositório privado chamado `pix-usdt-platform` na conta autenticada pelo GitHub CLI e publica o código. Não publique `.env` ou credenciais.
