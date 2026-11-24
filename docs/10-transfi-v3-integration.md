# TransFi v3 — integração e requisitos de homologação

## Escopo deste documento

O repositório contém um cliente HTTP v3 tipado e mockável em `apps/api/src/providers/transfi/transfi-v3-client.ts`. Esse cliente é apenas a camada de transporte: ele não ativa pagamentos, não cria ordens em runtime e não altera o bloqueio de `sandbox/live` dos adaptadores.

A integração financeira só poderá ser liberada depois de confirmar o MID, as credenciais, o corredor BRL/PIX, os métodos habilitados, os papéis de sender/recipient e as duas pernas de payout com a TransFi.

## Endpoints v3 usados pela camada de transporte

- `POST /v3/senders/mandatory-fields`: descobre campos KYC/KYB exigidos para um sender por país, tipo e currencyType.
- `POST /v3/senders/individual` e `POST /v3/senders/business`: cadastra o pagador/sender depois de coletar e validar os campos obrigatórios.
- `GET /v3/recipients/mandatory-fields?country=BR&type=individual&currencyType=crypto`: descobre os campos do recipient no corredor escolhido.
- `POST /v3/recipients/individual` e `POST /v3/recipients/business`: cadastra o destinatário; endereço, rede, titular e Travel Rule dependem do schema retornado.
- `GET /v3/config/payment-methods?direction=deposit&country=BR`: descobre os métodos de depósito disponíveis. Não presumir que o paymentCode PIX estará habilitado em todo MID.
- `POST /v3/orders`: cria payin/payout. Cada ordem exige partnerId estável e purposeCode permitido pelo contrato.
- `GET /v3/orders/{orderId}`: consulta o estado autoritativo de uma ordem.
- `GET /v3/balance`: consulta saldo disponível, bloqueado e em trânsito antes de criar payouts.

Referências oficiais:
- https://docs.transfi.com/changelog
- https://docs.transfi.com/reference/create-order
- https://docs.transfi.com/docs/collect-with-a-local-payment-method
- https://docs.transfi.com/docs/payouts
- https://docs.transfi.com/docs/pay-out-in-crypto
- https://docs.transfi.com/docs/pobo-cobo

## Fluxo de negócio a homologar

1. Obter a lista de payment methods para depósito em BR e selecionar somente o método PIX devolvido pelo provedor.
2. Consultar os mandatory fields de sender e recipient para cada papel, tipo de pessoa e currencyType; não manter formulários estáticos se a API retornar outros campos.
3. Criar o sender do pagador e o recipient cripto do comerciante, persistindo os userIds TransFi e o estado KYC/KYB.
4. Criar o payin PIX com partnerId idempotente. O checkout deve usar a URL/instruções devolvidas pelo provedor; não fabricar QR ou copia-e-cola.
5. Só após confirmação final do payin e crédito do saldo correto, calcular o valor USDT líquido com precisão decimal e conferir saldo disponível.
6. Criar dois payouts independentes, cada um com recipient/userId, partnerId e amount próprios: 98% para o comerciante e 2% para a carteira da plataforma.
7. Só concluir o pagamento depois dos dois payouts chegarem ao estado final definido no contrato do corredor, da conferência do saldo e do ledger.
8. Em timeout ou estado desconhecido, consultar a ordem pelo ID/partnerId e reconciliar; nunca reenviar POST de order cegamente.

## Restrições de ownership / CoBO / POBO

A documentação de CoBO/POBO exige que sender e recipient envolvidos numa ordem pertençam ao mesmo customer da TransFi. A TransFi precisa confirmar por escrito qual customer/MID será dono dos senders de pagadores, recipients de comerciantes e recipient da comissão PixSplit. Não assumir que um sender criado sob um customer pode ser pago a um recipient de outro customer.

Também é necessário confirmar a moeda do saldo pós-payin e a moeda permitida no campo source dos payouts. O cliente de transporte não presume que o saldo seja USD ou USDT; a configuração exata depende do MID e do corredor habilitado.

## Idempotência e segurança

- Toda ordem de payin/payout deve ter partnerId único, determinístico por intenção de operação e diferente por perna.
- O cliente não repete automaticamente POST quando houver timeout. Ele marca outcomeUnknown e exige consulta/reconciliação pelo partnerId antes de nova tentativa.
- A autenticação usa Basic Auth e header MID; base URL deve ser HTTPS.
- Erros não incluem o corpo bruto do provedor, que pode conter PII.
- Webhooks precisam ser validados no corpo bruto, deduplicados por eventId e reconciliados com o status da ordem.

## Bloqueios atuais

- Ainda não existem credenciais sandbox/MID fornecidos nem prova de que PIX BRL está habilitado.
- Não recebemos a lista de purposeCode aceita, tarifas, limites, saldo de settlement, nem regra contratual sobre quem é o proprietário do saldo.
- O cliente v3 ainda não está ligado ao PaymentProvider runtime; os adaptadores seguem bloqueados para sandbox/live.
- O checkout ainda é mock e não coleta todos os campos dinâmicos de sender exigidos pela TransFi.
- Não considerar o fluxo aprovado até demonstrar payin PIX + dois payouts independentes em sandbox, incluindo timeout, eventos duplicados, payout parcial, reembolso e conciliação.
