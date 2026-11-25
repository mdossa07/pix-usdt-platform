# Gate regulatório brasileiro — PixSplit

**Data da revisão:** 25/11/2026  
**Situação:** bloqueio aberto para operação financeira real  
**Escopo:** análise técnica preliminar para orientar parecer jurídico/regulatório. Este documento não é parecer jurídico, não classifica definitivamente a PixSplit e não autoriza operação.

## 1. Conclusão operacional

A plataforma permanece obrigatoriamente em `PAYMENTS_MODE=mock`. Não habilitar sandbox de produção, credenciais live, payin PIX real, conversão BRL/USDT ou withdrawals até que o modelo concreto tenha sido analisado e aprovado por advogado/regulador e pelo provedor contratado.

O fluxo desenhado — pagador faz PIX, há conversão BRL→USDT e o ativo é distribuído em duas pernas independentes (98% para comerciante e 2% para plataforma) — exige uma análise formal de:
- quem presta cada serviço e em nome de quem;
- quem é o cliente e titular dos recursos em cada etapa;
- se a PixSplit executa, intermedeia ou apenas fornece tecnologia;
- se há prestação de serviço de ativo virtual, operação de câmbio ou serviço de pagamento;
- se a movimentação de recursos de terceiros e a distribuição 98%/2% são permitidas no arranjo contratual proposto.

Não presumir que o contrato ou a autorização de um provedor cubra automaticamente a atividade própria da PixSplit.

## 2. Base normativa e fatos relevantes

### Lei nº 14.478/2022

- O art. 2º determina que prestadoras de serviços de ativos virtuais somente podem funcionar no país mediante autorização prévia da autoridade pública competente.
- O art. 5º inclui, entre os serviços de ativos virtuais, a troca entre ativos virtuais e moeda nacional/estrangeira, troca entre ativos virtuais, transferência, custódia/administração e determinados serviços relacionados à oferta/venda.
- O enquadramento depende da atividade efetivamente executada pela pessoa jurídica em nome de terceiros, e não apenas do nome dado ao produto ou da existência de uma API.

Fonte oficial: https://planalto.gov.br/ccivil_03/_ato2019-2022/2022/lei/l14478.htm

### Resolução BCB nº 520/2025, com alterações da Resolução BCB nº 589/2026

- A Resolução 520 disciplina a constituição/funcionamento de prestadoras de serviços de ativos virtuais e os serviços prestados por outras instituições autorizadas pelo BCB.
- O art. 91, com redação dada pela Resolução 589/2026 e vigência a partir de 06/11/2026, veda às instituições financeiras, instituições de pagamento e demais instituições autorizadas pelo BCB realizar ou viabilizar operações no mercado de ativos virtuais que tenham como contraparte entidade que preste serviços de ativos virtuais e não esteja autorizada no país, ressalvadas as hipóteses expressamente admitidas.
- O parágrafo único do art. 91 abrange, entre outros atos, negociação, intermediação, custódia, operações de câmbio, contas de pagamento e transações de pagamento quando praticados para viabilizar as operações vedadas.

Fontes oficiais:
- Resolução 520: https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=520&tipo=resolu%C3%A7%C3%A3o+bcb
- Resolução 589: https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=589&tipo=resolu%C3%A7%C3%A3o+BCB

### Resolução BCB nº 521/2025 — operações no mercado de câmbio

O art. 76-A inclui no mercado de câmbio determinadas prestações de serviços de ativos virtuais, incluindo:
- pagamento ou transferência internacional com ativos virtuais;
- transferências entre clientes e carteiras autocustodiadas nas hipóteses previstas;
- compra, venda ou troca de ativos virtuais referenciados em moeda fiduciária.

O § 3º do art. 76-A veda a movimentação de recursos de interesse de terceiros mediante prestação de serviços de ativos virtuais incluída no mercado de câmbio, ressalvada a hipótese legal de serviço prestado a instituição autorizada a operar no mercado de câmbio que atue no interesse de seus clientes. O § 5º exige identificar o proprietário de carteira autocustodiada e documentar processos de verificação da origem e destino dos ativos.

O art. 76-B define quando há pagamento ou transferência internacional com ativos virtuais, incluindo alteração de titularidade entre residente e não residente ou envio/recebimento do exterior de ativo de mesma titularidade. A aplicação ao fluxo do PixSplit depende dos fatos concretos e deve ser determinada por parecer.

Fonte oficial: https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=521&tipo=Resolu%C3%A7%C3%A3o+BCB  
Texto consultável: https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=detalharAto&cod_menu=9486&cod_modulo=644&desItem=&desItemFim=&nomeTitulo=codigos&numeroAto=00000521&orgao=DC%2FBCB&seqAto=000&tipo=RES&valorAno=2025

### Lista oficial de instituições do Banco Central

O BCB mantém listas distintas para:
1. sociedades que protocolaram pedido de autorização; e
2. instituições já autorizadas que podem prestar serviços de ativos virtuais nos termos aplicáveis.

O próprio BCB alerta que constar na lista de pedidos **não significa** que a sociedade esteja autorizada. A lista consultada nesta revisão informa atualização em 06/11/2026. Para cada provedor deve ser verificada a entidade jurídica exata, CNPJ, modalidade, situação do pedido e escopo efetivamente autorizado.

Fonte oficial: https://www.bcb.gov.br/estabilidadefinanceira/autorizabc?SPSVAs_autorizacao_page=1&ifs-autorizadas-ativos-virtuais_page=2&modalAberto=spsavs-pedido-fase

### Foxbit — cuidado com entidade e escopo

A Foxbit divulga que protocolou pedido de autorização como prestadora de serviços de ativos virtuais. Isso não deve ser interpretado como autorização concedida. Uma autorização de outra pessoa jurídica do grupo, ou para atividade cambial distinta, não deve ser tratada automaticamente como autorização para todos os serviços de ativos virtuais.

Fontes do próprio grupo:
- https://foxbit.com.br/
- https://infra.foxbit.com.br/regulacao-e-licencas/
- Documentação Partner API: https://docs.foxbit.com.br/rest/v3/partners/

A documentação Partner API também separa o Fiat Gateway da conta de sub-member: o PIX do Fiat Gateway é uma cobrança em nível de parceiro e não credita diretamente o saldo BRL da subconta. Funding de sub-member depende de cash-in interno da conta raiz ou de chave PIX provisionada pela Foxbit. Esse comportamento técnico não substitui aprovação comercial ou regulatória do modelo.

## 3. Perguntas obrigatórias para parecer jurídico/regulatório

O parecer deve responder por escrito, citando dispositivos e premissas factuais:

1. A PixSplit, considerando seu contrato, interface, fluxo de ordens, recebimento de instruções, determinação de beneficiários e cobrança de 2%, executa algum serviço do art. 5º da Lei 14.478/2022 em nome de terceiros? Em caso positivo, qual modalidade e qual autorização é necessária?
2. A PixSplit pode atuar apenas como fornecedora de software/tecnologia enquanto o provedor regulado contrata diretamente cada usuário e executa integralmente troca, transferência, KYC e custódia? Quais responsabilidades permanecem com a PixSplit?
3. Quem é o cliente da operação perante o provedor: pagador, comerciante, PixSplit ou outra entidade? Quem é titular do BRL antes e depois do PIX, do USDT antes da transferência e de cada uma das duas pernas?
4. A distribuição de 98%/2% constitui movimentação de recursos de interesse de terceiros para fins do art. 76-A, § 3º, da Resolução 521? O fluxo pode ocorrer por conta de uma instituição autorizada a operar no mercado de câmbio que atue no interesse de seus clientes? Qual entidade deve contratar e executar cada etapa?
5. O fluxo envolve pagamento/transferência internacional, carteira autocustodiada, carteira hospedada em VASP ou apenas transferência doméstica? Quais campos de finalidade, pagador/recebedor, titularidade, origem/destino e vínculo precisam ser coletados e reportados?
6. Quais entidades do grupo do provedor serão contraparte contratual e operacional? Para cada CNPJ, qual autorização, comunicação ou enquadramento do BCB permite cada serviço específico?
7. O recebimento PIX, a emissão da cobrança, a liquidação ao comerciante e a retenção da taxa de plataforma exigem participação de instituição de pagamento, instituição financeira ou outro arranjo autorizado? Quem assume formalmente cada obrigação?
8. Qual o desenho permitido de KYC/KYB, beneficiário final, Travel Rule, análise de carteira, monitoramento, reporte, retenção de evidências, reclamações, reembolsos e chargebacks?

## 4. Evidências que devem ser obtidas antes de escolher o provedor

- Consulta datada à lista oficial do BCB pelo CNPJ da entidade exata que assinará o contrato.
- Certidão, ato de autorização ou comunicação formal aplicável; não aceitar apenas apresentação comercial, selo, marca do grupo ou protocolo de pedido.
- Contrato que descreva a titularidade dos fundos, o papel de cada parte, responsabilidades de KYC/AML, Travel Rule, dados, reembolso, chargeback, limites e liquidação.
- Aprovação escrita do fluxo exato: PIX de pagador terceiro, funding/ownership do saldo, conversão BRL→USDT, beneficiário merchant 98%, fee da plataforma 2% e duas transferências on-chain independentes.
- Confirmação de redes, wallets hosted/self-hosted, dados VASP e beneficiário, whitelist, limites, tarifas, prazos, origem/destino, sandbox e processo de reconciliação.

## 5. Bloqueios técnicos que decorrem do parecer

Não implementar ou ativar integração live antes do encerramento dos itens acima. Depois do parecer:
- atualizar o diagrama de sequência com os papéis jurídicos e a titularidade de fundos por etapa;
- ajustar contratos, termos, checkout, onboarding e disclosures;
- implementar os campos de origem/destino, finalidade e titularidade que efetivamente se aplicarem;
- implementar controles KYC/KYB, carteira hosted/self-hosted, monitoramento e bloqueios segundo a matriz aprovada;
- validar o split 98%/2% com o provedor por contrato e testes sandbox;
- manter a liberação live como aprovação explícita e auditada, nunca como simples variável de ambiente alterável por usuário.

## 6. Critério de encerramento

Este gate só pode ser marcado concluído quando:
- advogado com experiência em regulação financeira/cripto emitir parecer escrito sobre a estrutura concreta;
- entidade e escopo do provedor forem verificados em fonte oficial do BCB e contrato assinado;
- modelo de funding, conversão, split, transferências e reembolsos estiver aprovado por escrito;
- todas as adequações técnicas/contratuais identificadas forem implementadas e testadas;
- responsável jurídico/compliance e responsável financeiro aprovarem a liberação.

Até lá, o status é **PENDENTE — NÃO OPERAR VALORES REAIS**.
