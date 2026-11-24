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

A assinatura é calculada sobre os bytes UTF-8 exatos do corpo e o caminho sem query string:

```text
METHOD\nPATH\nTIMESTAMP\nRAW_BODY
```

Calcule `HMAC-SHA256(secret, signingString)`. O segredo é exibido somente na criação; em repouso, a API guarda um hash de consistência e o segredo cifrado com AES-256-GCM. O hash sozinho não é suficiente para assinar chamadas. Chaves antigas sem segredo cifrado são recusadas e precisam ser substituídas. O timestamp fora da janela de cinco minutos é recusado; clientes também devem usar IDs externos estáveis para operações idempotentes.

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

```json
{ "amountBrlCents": 100000, "walletId": "id-da-carteira", "description": "Pedido 123" }
```

Cria uma cobrança MOCK com identificador `MOCK-PIX-NOT-PAYABLE-...`. Esse texto não é código PIX e não aceita pagamento.

### `GET /v1/payments`

Lista as 100 operações mais recentes do merchant autenticado.

### `POST /v1/payments/{id}/mock-settle`

Somente modo local/mock. Simula o resultado em USDT usando a cotação fixa `MOCK_USDT_PER_BRL` no `.env`, grava duas pernas de liquidação e o ledger 98%/2%. Não chama instituição financeira nem blockchain.

## Dashboard

- `GET /v1/dashboard`: agregados e operações do merchant autenticado.
- `GET /v1/admin/dashboard`: apenas `SUPER_ADMIN`; agregados globais da plataforma.
- `GET /v1/provider/status`: informa se existe onboarding/credencial configurado e enumera aprovações pendentes.

## Webhook

`POST /webhooks/foxbit` valida `X-FB-SIGNATURE` usando o corpo bruto e persiste evento criptografado. Eventos são apenas recebidos/registrados nesta versão; não alteram saldos ou estado financeiro até o schema/event mapping ser homologado.

## Endpoints ainda não implementados

- API keys e autenticação merchant-to-server por chave.
- Webhooks de saída para os merchants.
- KYC/KYB e revisão manual no painel.
- Integração financeira Foxbit sandbox/live.
- Quotes, Fiat Gateway order / PIX key de sub-member, funding, RFQ, internal cash-out, withdrawals e reconciliação final.
