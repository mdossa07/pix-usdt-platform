# 03 — Integração Foxbit: fatos documentados e pontos de validação

## Fatos confirmados na Partner API pública

A documentação oficial em https://docs.foxbit.com.br/rest/v3/partners/ informa:

1. **Sub-members:** a conta parceira cria clientes finais (sub-members), aplica KYC e limites, mantém saldos separados e pode executar RFQ e saques em nome deles.
2. **Funding de sub-member em BRL:** o fluxo documentado é (a) cash-in interno da conta raiz para a subconta (`POST /sub_member/{sub_member_sn}/internal_cash_in`) ou (b) chave PIX específica provisionada pela Foxbit, habilitada pelo gerente de conta.
3. **Fiat Gateway:** o fluxo PIX cria uma cobrança no nível da conta parceira e aceita pagadores terceiros. A documentação diz explicitamente que o PIX do Fiat Gateway não financia diretamente o saldo de um sub-member.
4. **Fiat Gateway BUY:** `POST /fiat_gateway/orders` cria uma ordem on-ramp PIX com `receive_address`, `chain`, `quote_id`, dados do cliente e Travel Rule do beneficiário. A ordem envia os criptoativos ao endereço informado quando concluída. A ordem não é documentada como funding de sub-member.
5. **RFQ:** a compra por `POST /rfq/quotes/execute` ocorre em nome de uma subconta e exige que ela já tenha saldo BRL.
6. **Transferência interna:** `POST /sub_member/{sub_member_sn}/internal_cash_out` transfere saldo da subconta para a conta raiz, em BRL ou cripto.
7. **Withdrawals:** a Partner API possui saque cripto da subconta e da conta raiz, e fluxo Travel Rule. Carteiras de corretora usam variante `HOSTED`; a declaração inclui dados do VASP e destinatário.
8. **Sandbox:** depende de habilitação pelo gerente de conta; KYC pode exigir liberação manual e a liquidez de teste precisa ser combinada.

## Desenhos de fluxo a decidir com Foxbit

### Alternativa A — Fiat Gateway direto para carteira do usuário

- O usuário gera cobrança pelo parceiro.
- Pagador paga PIX.
- A ordem BUY converte e envia USDT para o `receive_address` cadastrado pelo usuário (corretora `HOSTED`).
- A comissão de 2% precisaria ser retida ou cobrada por um mecanismo permitido pela Foxbit, confirmado antes do desenvolvimento final.

### Alternativa B — Funding de sub-member e split interno

- Cada usuário tem sub-member e KYC aprovado.
- A Foxbit provisiona uma chave PIX por sub-member ou aprova outro funding de BRL para a subconta.
- O pagador paga o PIX associado ao usuário.
- O saldo BRL da subconta compra USDT via RFQ.
- 2% em USDT é transferido via `internal_cash_out` para a conta raiz.
- 98% é sacado para a carteira externa do usuário.
- 2% é sacado para a carteira externa da plataforma.

A Alternativa B se aproxima da estrutura de split desejada, mas o funding por chave PIX individual e o on-ramp por subconta precisam de confirmação comercial.

## Não fazer

- Não presumir que Fiat Gateway PIX creditou uma subconta: a documentação diz que não credita.
- Não executar RFQ em sub-member sem saldo BRL disponível.
- Não enviar para corretora como `SELF_HOSTED`; usar a declaração `HOSTED` e os campos de VASP/beneficiário quando aplicáveis.
- Não marcar transferência concluída por webhook isolado; consultar status, saldo e hash.
- Não repetir mutações automaticamente em timeout sem reconciliação por ID idempotente.

## Assinatura e webhooks

A documentação atual indica V2: HMAC-SHA256 sobre os bytes exatos do corpo bruto com o segredo cadastrado, header `X-FB-SIGNATURE`, comparação em tempo constante. Validar assinatura antes de interpretar JSON; tolerar campos desconhecidos.

## Perguntas para o gerente institucional

1. A conta da plataforma pode operar no modelo white-label com muitos merchants e sub-members?
2. A Foxbit provisiona uma chave PIX individual por sub-member para o pagador final pagar diretamente?
3. Se não, existe outra forma contratada de receber PIX de terceiros e creditar BRL na subconta do beneficiário?
4. A chave PIX provisionada aceita pagador terceiro, com CPF/CNPJ diferente do sub-member? Quais dados precisam ser coletados?
5. A subconta pode executar compra BRL→USDT por RFQ e sacar para endereço externo de exchange (`HOSTED`)?
6. É permitido executar internal cash-out de 2% em USDT para a conta raiz por operação e depois withdrawal automatizado da conta raiz para a carteira da plataforma?
7. Quais limites, tarifas, mínimos, rede USDT, whitelist, Travel Rule, settlement time, hold, estorno PIX e disponibilidade de sandbox se aplicam?
8. O contrato autoriza explicitamente a plataforma a cobrar comissão de 2% em cada operação e exibir essa tarifa ao usuário?

## Referências oficiais

- https://docs.foxbit.com.br/rest/v3/partners/
- https://infra.foxbit.com.br/crypto-as-a-service-api/
