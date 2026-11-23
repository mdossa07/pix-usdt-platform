# 07 — Checklist Foxbit: homologação do fluxo

## Objetivo

Plataforma SaaS multiusuário. Cada merchant vincula sua própria carteira USDT em uma corretora/VASP. O pagador final paga em BRL via PIX. A liquidação desejada é 98% para o endereço do merchant e 2% para a carteira externa da plataforma.

## Confirmações obrigatórias

- [ ] White-label / parceria permite comercializar a experiência para usuários da plataforma.
- [ ] Sub-member criado por usuário e KYC/KYB aprovado.
- [ ] A Foxbit confirma o método de funding BRL por sub-member.
- [ ] PIX de terceiro é aceito para esse funding, ou chave PIX provisionada por sub-member.
- [ ] A conversão BRL→USDT pode ser executada e conciliada no contexto do sub-member.
- [ ] A rede USDT é aceita ponta a ponta (PIX/conversão, transferência e withdrawal).
- [ ] Withdrawal para endereço de corretora `HOSTED` é aceito, com Travel Rule.
- [ ] `internal_cash_out` de 2% em USDT para a conta raiz é permitido por operação.
- [ ] Withdrawal da conta raiz para a carteira externa da plataforma é automatizável e permitido por operação.
- [ ] Custos, mínimos, spreads, prazos, limites, retenções, whitelist e política de reembolso foram documentados.
- [ ] Sandbox e liquidez de teste habilitados.
- [ ] Contrato e análise jurídica/contábil aprovam o modelo e o objeto social da empresa.

## Perguntas objetivas ao gerente institucional

1. Qual endpoint/arranjo exato cria o PIX que credita a subconta do merchant?
2. Fiat Gateway é partner-level; há PIX Key individual para cada sub-member? Aceita pagador terceiro?
3. O usuário pode cadastrar um endereço de depósito da Binance/OKX/Bybit como destino `HOSTED`? Quais campos de titular/VASP são exigidos?
4. A Foxbit aprova comissão 2% transferida por `internal_cash_out` em USDT para conta raiz por cada operação?
5. A comissão pode ser sacada da raiz para uma carteira externa por operação? Há bloqueio, whitelist, batch, fee ou mínimo?
6. O que ocorre em caso de PIX estornado/devolvido depois da compra ou depois do saque on-chain?
