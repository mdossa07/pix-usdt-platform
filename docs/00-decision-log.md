# 00 — Registro de decisões (23/11/2026)

## Provedor inicial de integração

Foxbit Infra / Partner API é a primeira integração em avaliação porque possui sub-members, RFQ, Fiat Gateway, transferências internas, saques externos e Travel Rule para carteiras de corretoras. A aprovação final depende do gerente institucional e do contrato.

## Ponto crítico documentado

O Fiat Gateway PIX é partner-level e não credita uma subconta. O fluxo de sub-member/RFQ requer funding separado da subconta, por cash-in da raiz ou PIX key provisionada pela Foxbit. Essa distinção está explicitada na documentação Partner API; portanto, não presumir que um webhook de PIX Gateway aumente o saldo da subconta.

## Regra de split do produto

Comissão configurada em 200 bps (2%). A base definitiva será acordada com o provedor: valor convertido líquido de tarifa de serviço antes das tarifas de saque, ou outra base aceita e transparente ao usuário. O usuário vê cotação, taxa do provedor, comissão e valor líquido antes de confirmar.

## Requisito de aprovação

A Foxbit precisa validar por escrito: funding por merchant, pagador terceiro, compra de USDT na subconta, saque `HOSTED` para corretora, internal cash-out de 2% para a conta raiz e saque automático da comissão para carteira externa.

## Hodle não selecionada

O fluxo Hodle de on-ramp PIX→cripto não foi escolhido porque os requisitos de destino de carteira apresentados na documentação não cobriam com segurança o caso geral de endereço de depósito em corretora/VASP.
