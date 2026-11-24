# Idempotência da criação de cobranças

## Endpoint

`POST /v1/payments` exige o cabeçalho:

```http
Idempotency-Key: <unique-random-key>
```

A chave deve ter entre 16 e 128 caracteres ASCII e aceitar apenas letras, números, ponto, sublinhado, dois-pontos e hífen. Um UUID aleatório é o formato recomendado.

## Comportamento

- O escopo da chave é o comerciante e o endpoint `POST /v1/payments`.
- A API calcula SHA-256 sobre uma representação canônica de `walletId`, `amountBrlCents` e `description`.
- A chave, o hash do corpo, a cobrança, a resposta e o evento de auditoria são gravados na mesma transação PostgreSQL.
- A mesma chave com o mesmo corpo retorna a resposta original e o cabeçalho `Idempotency-Replayed: true`.
- A mesma chave com corpo diferente retorna `409 idempotency_key_reused_with_different_request`.
- Uma chave ainda sem resposta persistida retorna `409 idempotency_request_in_progress` com `Retry-After: 1`.
- A restrição única `(scope, key)` serializa requisições concorrentes; somente uma delas pode criar a cobrança.
- Erros de validação anteriores à criação não reservam a chave.

## Cliente

O cliente deve gerar uma chave por intenção de cobrança, mantê-la durante tentativas de repetição após timeout/erro de rede e descartá-la somente depois de receber uma resposta confirmada. Uma nova cobrança, mesmo com os mesmos valores, deve usar outra chave.

O dashboard do comerciante guarda a chave pendente em memória e em `sessionStorage` para permitir retry na mesma aba após uma atualização.

## Retenção

As chaves atualmente permanecem reservadas enquanto o registro existir no banco; ainda não há rotina de limpeza/expurgo. Portanto, nunca reutilize uma chave antiga. O cliente deve gerar UUID novo para cada nova intenção.

## Segurança e limites

- Idempotência não substitui JWT, HMAC, nonce anti-replay ou controles de autorização.
- Quando um provedor real for integrado, cada payin e cada payout ainda precisará de seu próprio `partnerId`/chave idempotente no provedor.
- O endpoint continua em modo demonstração. A resposta contém `MOCK-PIX-NOT-PAYABLE`; nenhuma cobrança PIX real é emitida por esta implementação.
