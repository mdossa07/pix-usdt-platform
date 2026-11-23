# 02 — Arquitetura técnica

## Componentes implementados

- Web Next.js: dashboard demonstrativo, operações, carteiras, integração API e relatórios.
- API Fastify: registro/login, JWT, merchants, cadastro de carteiras, criação de pagamentos mock, dashboard, extrato de operações e webhooks assinados.
- PostgreSQL/Prisma: dados de usuários/merchants, carteiras, pagamentos, duas pernas de liquidação, ledger, idempotência, webhooks e auditoria.
- Segurança: Argon2id para senha, AES-256-GCM para CPF/CNPJ, telefone e endereço/tag de carteira, JWT para API.
- Split: BigInt e base units, sem cálculos financeiros com ponto flutuante.

## Fluxo financeiro a implementar após aprovação Foxbit

A API tem duas alternativas de produto distintas que não podem ser misturadas sem confirmação:

- Fiat Gateway: recebe PIX de terceiros no nível da conta parceira e gera order BUY com `receive_address` e Travel Rule para a carteira beneficiária; a documentação diz que não credita sub-member.
- Sub-members + RFQ: opera em nome da subconta e exige saldo BRL pré-existente; o funding oficial é cash-in a partir da raiz ou PIX key provisionada pela Foxbit para aquela subconta.

A arquitetura definitiva depende de Foxbit confirmar qual dessas alternativas permite que cada usuário/merchant receba sua própria liquidação e que a comissão seja dividida automaticamente.

## Estado de pagamento

`CREATED → PIX_PENDING → PIX_CONFIRMED → CONVERSION_PENDING → CRYPTO_CREDITED → SPLIT_PENDING → PAYOUT_PENDING → COMPLETED`

Estados de exceção: `UNDER_REVIEW`, `FAILED`, `CANCELED`, `EXPIRED`, `REFUND_PENDING` (a ser adicionado se o fluxo aprovado exigir).

Cada perna de liquidação possui estado independente: `CREATED`, `SUBMITTED`, `PENDING_TRAVEL_RULE`, `PROCESSING`, `COMPLETED`, `FAILED`.

## Não atomicidade e idempotência

A operação de dois destinos não deve ser tratada como transação blockchain única. Persistir intenção de cada perna antes da chamada externa, usar chave de idempotência estável, consultar status após timeouts, nunca repetir blindamente, e reconciliar pelo ID do provedor e hash on-chain. Uma perna concluída não pode ser repetida só porque a outra falhou.
