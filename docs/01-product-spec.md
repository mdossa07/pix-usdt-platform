# 01 — Especificação do produto

## Objetivo

Comercializar uma plataforma multiusuário na qual lojistas/usuários cadastram uma carteira de corretora para receber USDT. O cliente final paga em BRL por PIX. Após confirmação e conversão pelo parceiro, o sistema divide o USDT líquido:

- 98% para o endereço de recebimento do usuário;
- 2% de comissão para a empresa proprietária da plataforma.

## Papéis

- Superadmin: configura provedor, taxas, limites, rede, tesouraria, bloqueios, relatórios e auditoria.
- Operação/Compliance: analisa KYC, beneficiários, alertas, retenções e exceções.
- Usuário/merchant: cadastra dados, carteira externa, cria cobranças e consulta operações.
- Pagador final: paga um PIX; não precisa ter conta na plataforma.

## Regra da comissão

Configuração inicial: 200 bps (2%). Base proposta para MVP: USDT efetivamente creditado na subconta depois das tarifas do provedor, antes da tarifa de saque do destinatário. A tela de cotação deve mostrar separadamente tarifa Foxbit, comissão da plataforma, taxa de saque e valor líquido estimado.

Fórmula:

`commission = roundDown(netUsdtCredited * 200 / 10000, tokenPrecision)`

`merchantPayout = netUsdtCredited - commission`

Não calcular com `Number`/float. Usar Decimal/inteiros na precisão da moeda.

## Carteiras

Guardar endereço, rede, exchange/VASP, titular, país, tipo `HOSTED`/`SELF_HOSTED`, tag/memo quando aplicável e dados de Travel Rule necessários. Endereço não é prova suficiente de titularidade: exigir verificação do beneficiário e confirmação de rede/ativo.

Nunca solicitar senha da corretora, API key de saque, seed phrase ou chave privada do usuário.

## Não objetivos do MVP

- Custodiar chaves privadas dos usuários.
- Criar exchange própria ou carteira custodial própria.
- Aceitar outras moedas que não USDT.
- Habilitar múltiplas redes antes de validar a primeira rota de ponta a ponta.
- Liberar produção sem contrato e aprovação do provedor.
