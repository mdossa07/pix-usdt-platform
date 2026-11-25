# Webhooks de saída para comerciantes

## Visão geral

Cada comerciante pode cadastrar até 10 endpoints HTTPS ativos, escolher os eventos recebidos, consultar o histórico de entregas, desativar um endpoint e rotacionar o segredo de assinatura. O segredo é exibido uma única vez e armazenado cifrado no PostgreSQL.

Eventos disponíveis:

- `payment.created`: cobrança PIX criada.
- `payment.status_changed`: estado interno da cobrança alterado.
- `payment.completed`: os dois repasses independentes foram confirmados e o estado agregado passou a `COMPLETED`.

As notificações incluem identificadores, estado e valores em unidades exatas. Não incluem CPF, dados do pagador, e-mail, endereço completo da carteira ou segredo do provedor.

## API do comerciante

Todas as rotas abaixo exigem sessão de comerciante autenticada.

### Criar endpoint

`POST /v1/merchant/webhooks`

```json
{
  "url": "https://hooks.suaempresa.com/pixsplit",
  "events": ["payment.created", "payment.status_changed", "payment.completed"]
}
```

A resposta inclui o identificador do endpoint, eventos e `signingSecret`. Salve o segredo imediatamente: ele não é retornado na listagem.

O sistema exige HTTPS na porta 443, rejeita IPs literais, hosts locais/internos, credenciais na URL, e valida as respostas DNS. O destino é validado novamente no momento de cada envio e os endereços públicos aprovados são fixados na conexão TLS para reduzir risco de DNS rebinding.

### Listar, desativar, rotacionar e auditar entregas

- `GET /v1/merchant/webhooks`: lista endpoints sem expor os segredos.
- `DELETE /v1/merchant/webhooks/:endpointId`: desativa o endpoint e cancela entregas ainda pendentes.
- `POST /v1/merchant/webhooks/:endpointId/enable`: reativa um endpoint desativado pelo próprio comerciante.
- `POST /v1/merchant/webhooks/:endpointId/deliveries/:deliveryId/retry`: reabre uma entrega `FAILED` do mesmo endpoint, somente se ele estiver ativo.
- `POST /v1/merchant/webhooks/:endpointId/rotate-secret`: invalida o segredo anterior e retorna um novo segredo uma única vez.
- `GET /v1/merchant/webhooks/:endpointId/deliveries`: lista até 100 entregas recentes e seus estados, tentativas e códigos de resposta/erro.

## Formato enviado

Cada entrega é um POST JSON. Exemplo ilustrativo:

```json
{
  "id": "uuid-do-evento",
  "type": "payment.completed",
  "createdAt": "2026-11-24T23:00:00.000Z",
  "data": {
    "paymentId": "id-interno",
    "externalId": "pixsplit_referencia",
    "status": "COMPLETED",
    "amountBrlCents": "12345",
    "currency": "BRL",
    "commissionBps": 200,
    "commissionUsdt": "0.44400000",
    "merchantNetUsdt": "21.75600000",
    "createdAt": "2026-11-24T22:00:00.000Z",
    "updatedAt": "2026-11-24T23:00:00.000Z"
  }
}
```

Os valores monetários são strings decimais ou centavos inteiros em string; não devem ser convertidos para ponto flutuante. `id` identifica o evento e é igual ao header `X-PixSplit-Event-Id`.

## Assinatura HMAC

Headers enviados:

- `X-PixSplit-Event`: nome do evento.
- `X-PixSplit-Event-Id`: identificador estável para deduplicação.
- `X-PixSplit-Timestamp`: Unix time em segundos.
- `X-PixSplit-Signature`: `sha256=<hex>`.

A assinatura é HMAC-SHA256, com o segredo do endpoint, sobre:

`timestamp + "." + corpo JSON bruto`

O consumidor deve validar a assinatura sobre os bytes exatos recebidos, aplicar uma janela de tolerância ao timestamp e deduplicar pelo `X-PixSplit-Event-Id`. Não reserializar o JSON antes da verificação.

Exemplo conceitual em Node.js:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyPixSplitWebhook({ secret, timestamp, rawBody, signature }) {
  if (!/^\\d{10}$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/.test(signature)) {
    return false;
  }
  const expected = createHmac('sha256', secret)
    .update(timestamp + '.' + rawBody)
    .digest();
  const supplied = Buffer.from(signature.slice('sha256='.length), 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
```

## Reenvio manual de entrega que falhou

Uma entrega em estado `FAILED` pode ser reaberta pelo comerciante quando o endpoint estiver ativo:

```
POST /v1/merchant/webhooks/:endpointId/deliveries/:deliveryId/retry
```

O sistema reutiliza a mesma linha do outbox, preserva `eventId` e payload, zera o contador de tentativas anteriores e agenda uma nova tentativa imediata. A operação é auditada e protegida por rate limit. Entregas `PENDING`, `PROCESSING` ou `DELIVERED` não podem ser reabertas. Um endpoint desativado precisa ser reabilitado antes; apenas o comerciante proprietário consegue reabilitá-lo.

Como a semântica permanece at-least-once, o consumidor deve continuar deduplicando pelo mesmo `X-PixSplit-Event-Id`; reenvio manual não cria um evento novo.

## Retentativas e entrega

- O endpoint precisa responder com HTTP 2xx para confirmar a entrega.
- Redirecionamentos 3xx não são seguidos e são tratados como falha.
- Timeout padrão de 5 segundos; resposta acima de 8 KiB é rejeitada.
- Até 8 tentativas, com espera exponencial: 30 segundos, 2 minutos, 10 minutos, 1 hora, 6 horas e 24 horas para as tentativas seguintes.
- A fila/outbox é persistida no PostgreSQL e o worker recupera bloqueios abandonados após reinício.
- A entrega é *at-least-once*: timeout após o consumidor processar o evento pode gerar reenvio. O consumidor deve deduplicar pelo ID do evento.
- A ordem entre eventos distintos não é garantida; use `createdAt`, `updatedAt` e o estado atual consultado na API para reconciliação.

## Segurança operacional

- Nunca configure endpoints em HTTP, IP privado, loopback, link-local ou redes reservadas.
- Não coloque tokens/credenciais na URL; use o segredo de assinatura para autenticar o evento.
- Rotacione o segredo se houver suspeita de exposição.
- Não considerar um webhook isolado como prova de pagamento. O estado definitivo continua sendo o estado interno reconciliado do PixSplit.
- Antes de produção, aplicar as migrações PostgreSQL, configurar TLS/DNS externo, validar a rede de saída do ambiente e testar recepção/deduplicação no sistema do comerciante.
