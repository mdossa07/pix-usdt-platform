# 04 — API da plataforma (versão 0.2.0)

Base URL local: `http://localhost:4000`.

Todas as rotas `/v1` exceto registro/login exigem `Authorization: Bearer <JWT>`.

## Autenticação

### `POST /v1/auth/register`

Cria usuário `MERCHANT` e perfil comercial inicial com KYC `NOT_STARTED`.

```json
{
  "fullName": "Nome do titular",
  "email": "usuario@empresa.com",
  "password": "senha-com-12-ou-mais-caracteres",
  "merchantType": "COMPANY",
  "legalName": "Empresa Exemplo Ltda",
  "taxId": "12345678000195"
}
```

### `POST /v1/auth/login`

```json
{ "email": "usuario@empresa.com", "password": "senha-com-12-ou-mais-caracteres" }
```

Retorna JWT com validade de 2 horas. O frontend de desenvolvimento armazena o token no `localStorage`; antes de produção, migrar para cookie HttpOnly/Secure/SameSite ou BFF.

### `GET /v1/me`

Retorna identidade e estado do merchant autenticado.

## Autenticação de API para merchants (HMAC)

As rotas de integração merchant-to-server usam os cabeçalhos:

- `x-pixsplit-key-id`: UUID da chave gerada no painel.
- `x-pixsplit-timestamp`: timestamp Unix em milissegundos.
- `x-pixsplit-signature`: HMAC-SHA256 em hexadecimal minúsculo.
- `x-pixsplit-nonce`: valor aleatório criptograficamente seguro, hexadecimal, único por requisição.

A assinatura é calculada sobre os bytes UTF-8 exatos do corpo e o caminho sem query string:

```text
METHOD\nPATH\nTIMESTAMP\nNONCE\nRAW_BODY
```

Calcule `HMAC-SHA256(secret, signingString)`. O segredo é exibido somente na criação; em repouso, a API guarda um hash de consistência e o segredo cifrado com AES-256-GCM. O hash sozinho não é suficiente para assinar chamadas. Chaves antigas sem segredo cifrado são recusadas e precisam ser substituídas. O timestamp fora da janela de cinco minutos é recusado. O nonce é consumido atomicamente no PostgreSQL e uma repetição recebe HTTP 409 `request_replayed`, inclusive em chamadas concorrentes a instâncias diferentes. Gere um nonce novo para cada tentativa; em caso de timeout, use a mesma chave de idempotência de negócio para consultar o resultado, não reenvie a mesma assinatura.

## Carteiras

### `GET /v1/wallets`

Lista apenas carteiras pertencentes ao merchant autenticado.

### `POST /v1/wallets`

```json
{
  "label": "Binance TRC20",
  "exchangeName": "Binance",
  "networkCode": "tron",
  "address": "T...",
  "walletType": "HOSTED",
  "holderName": "Nome do titular da conta na corretora",
  "holderTaxId": "12345678901",
  "holderCountry": "BR",
  "vaspEntityCountry": "BR",
  "makeDefault": true
}
```

Redes aceitas na primeira versão: `tron` e `polygon`. Endereço é criptografado em repouso. Carteiras iniciam como `PENDING_VERIFICATION`; cadastrar o endereço não comprova titularidade nem habilita saque real.

## Tesouraria da plataforma (superadmin)

- `GET /v1/admin/commission-wallets`: lista endereços de comissão por rede.
- `POST /v1/admin/commission-wallets`: configura endereço externo da tesouraria por rede (`polygon` ou `tron`). O endereço é criptografado em repouso.

A tesouraria precisa de um endereço por rede; a perna de 2% deve usar a mesma rede do pagamento/merchant. O modo mock usa um destino fictício quando ainda não há carteira configurada.

## Pagamentos

### `POST /v1/payments`

Cabeçalhos obrigatórios:

```http
Authorization: Bearer <JWT>
Idempotency-Key: <UUID aleatório por intenção de cobrança>
Content-Type: application/json
```

A chave deve ter entre 16 e 128 caracteres ASCII: letras, números, ponto, sublinhado, dois-pontos e hífen.

```json
{ "amountBrlCents": 100000, "walletId": "id-da-carteira", "description": "Pedido 123" }
```

Cria uma cobrança MOCK com identificador `MOCK-PIX-NOT-PAYABLE-...`. Esse texto não é código PIX e não aceita pagamento.

Idempotência:
- Mesma chave e mesmo corpo: devolve a resposta original, com HTTP 201 e `Idempotency-Replayed: true`.
- Mesma chave e corpo diferente: HTTP 409 `idempotency_key_reused_with_different_request`.
- Requisição ainda sem resposta persistida: HTTP 409 `idempotency_request_in_progress` e `Retry-After: 1`.
- Chave ausente ou inválida: HTTP 400 `valid_idempotency_key_required`.

O escopo é por comerciante e endpoint. O backend grava a chave, hash do corpo, cobrança, resposta e auditoria na mesma transação PostgreSQL. O dashboard conserva a chave pendente e apenas um fingerprint SHA-256 do corpo no navegador; logout remove esse estado. Use uma chave nova para cada nova intenção. Consulte `docs/09-payment-idempotency.md` para o contrato completo.

A cobrança permanece em `PIX_PENDING` e em modo mock. Nenhuma instituição financeira ou blockchain é acionada.

### `GET /v1/payments`

Lista as 100 operações mais recentes do merchant autenticado.

### `POST /v1/payments/{id}/mock-settle`

Somente modo local/mock. Simula o resultado em USDT usando a cotação fixa `MOCK_USDT_PER_BRL` no `.env`, grava duas pernas de liquidação e o ledger 98%/2%. Não chama instituição financeira nem blockchain.

## Dashboard

- `GET /v1/dashboard`: agregados e operações do merchant autenticado.
- `GET /v1/admin/dashboard`: apenas `SUPER_ADMIN`; agregados globais da plataforma.
- `GET /v1/admin/provider-status`: apenas `SUPER_ADMIN`; informa provedor selecionado, presença de credenciais, estado de homologação e aprovações pendentes. Não existe endpoint público para esse estado.

## Webhook

`POST /webhooks/foxbit` valida `X-FB-SIGNATURE` usando o corpo bruto e persiste evento criptografado. Eventos são apenas recebidos/registrados nesta versão; não alteram saldos ou estado financeiro até o schema/event mapping ser homologado.

## Endpoints ainda não implementados

- Webhooks de saída para os merchants, com gestão de endpoints, assinatura, tentativas e reentrega.
- Webhooks de saída para os merchants.
- KYC/KYB e revisão manual no painel.
- Integração financeira Foxbit sandbox/live.
- Quotes, Fiat Gateway order / PIX key de sub-member, funding, RFQ, internal cash-out, withdrawals e reconciliação final.
