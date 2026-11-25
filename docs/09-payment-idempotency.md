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

O endpoint `POST /v1/payments` aplica esse contrato no backend. O dashboard do comerciante guarda a chave pendente e apenas um fingerprint SHA-256 do pedido em `localStorage`, permitindo retry após recarregar a página ou reabrir o navegador. O logout remove esse estado pendente.


## Endpoint HMAC de comerciantes

O endpoint `POST /v1/merchant/payments` também aceita uma referência idempotente por meio do campo `externalId` do corpo assinado por HMAC. Clientes devem enviar um `externalId` estável e único por intenção de cobrança; clientes legados que omitem o campo continuam recebendo uma referência aleatória, sem garantia de replay após falha de rede.

- A API cria uma reserva em `IdempotencyRecord` com escopo global do endpoint e a referência `externalId` como chave, antes de chamar o provedor.
- A impressão digital do pedido inclui comerciante, referência, valor, carteira, nome/CPF do pagador e descrição. O digest é um HMAC com chave derivada da chave de criptografia PII, e não um SHA-256 simples de dados de baixa entropia como CPF.
- Duas instâncias que recebem simultaneamente a mesma referência são serializadas pela restrição única do PostgreSQL. Uma única instância pode chamar o provedor; a concorrente recebe HTTP 409 `payment_creation_in_progress` com `Retry-After: 1`.
- A mesma referência com qualquer campo relevante diferente recebe HTTP 409 `external_id_reused_with_different_request`.
- Após a cobrança ser persistida, a resposta é guardada para que a repetição com o mesmo pedido receba a resposta original e `Idempotency-Replayed: true`.
- Se o resultado do provedor for ambíguo, ou se o provedor aceitar a cobrança mas a persistência local falhar, a reserva permanece sem resposta. Requisições seguintes não fazem novo envio automaticamente: é necessária reconciliação manual usando a referência original. Não apagar a reserva nem trocar o `externalId` para contornar esse estado.
- Se a linha Payment já foi gravada, mas o processo caiu antes de guardar a resposta HTTP, o middleware confirma que o pedido corresponde ao pagamento existente e completa a reserva antes de deixar o handler retornar a resposta existente.

A implementação é fail-closed e não habilita integração sandbox/live. O adapter continua sujeito à homologação e às aprovações registradas no gate regulatório.

## Retenção

As chaves atualmente permanecem reservadas enquanto o registro existir no banco; ainda não há rotina de limpeza/expurgo. Portanto, nunca reutilize uma chave antiga. O cliente deve gerar UUID novo para cada nova intenção.

## Segurança e limites

- Idempotência não substitui JWT, HMAC, nonce anti-replay ou controles de autorização.
- Quando um provedor real for integrado, cada payin e cada payout ainda precisará de seu próprio `partnerId`/chave idempotente no provedor.
- O endpoint continua em modo demonstração. A resposta contém `MOCK-PIX-NOT-PAYABLE`; nenhuma cobrança PIX real é emitida por esta implementação.
