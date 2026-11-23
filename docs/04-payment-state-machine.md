# 04 — Estados da operação

## Payment

`CREATED → PIX_PENDING → PIX_CONFIRMED → CRYPTO_CREDITED → SPLIT_PENDING → PAYOUT_PENDING → COMPLETED`

Estados excepcionais:

- `REVIEW`: compliance, antifraude ou Travel Rule em análise.
- `REFUND_PENDING`: ordem cancelada ou pagamento incompatível; aguardar restituição do provedor.
- `FAILED`: falha terminal confirmada pelo provedor.

## Duas pernas do split

Cada Payment gera duas entidades Transfer:

1. `PLATFORM_COMMISSION`: 2% internal cash-out para a conta raiz e saque para a carteira da empresa.
2. `MERCHANT_PAYOUT`: 98% da quantia líquida para a carteira externa do usuário.

Status de cada perna: `CREATED`, `SUBMITTED`, `PENDING_TRAVEL_RULE`, `PROCESSING`, `COMPLETED`, `FAILED`.

A comissão pode ter duas etapas internas: `SUB_MEMBER_TO_ROOT` e `ROOT_TO_PLATFORM_WALLET`. Cada etapa terá seu próprio idempotency key, provider reference, status e tx hash.

## Retentativas seguras

- Persistir idempotency key antes de chamar o provedor.
- Nunca criar novo saque após timeout sem consultar o estado do saque anterior.
- Tratar `409` com a chave de idempotência como possível operação já registrada.
- Webhook duplicado: guardar provider event ID e ignorar repetição.
- Estado desconhecido: reconciliar via GET/extrato antes de agir.
- Uma perna `COMPLETED` nunca é refeita porque a outra falhou.

## Regra de conclusão

Payment só pode ser `COMPLETED` quando:

- PIX confirmado;
- conversão e crédito em USDT reconciliados;
- comissão de 2% transferida para a conta raiz;
- comissão enviada para a carteira externa da plataforma e confirmada;
- payout de 98% enviado para carteira externa do merchant e confirmado;
- ledger balanceado.
