# 05 — Segurança, compliance e proteção de dados

## Regras obrigatórias

- Nenhuma seed phrase, private key ou senha de corretora de usuário será coletada.
- Carteiras externas são registradas como endereços públicos com rede, VASP/exchange, país, titular, tag/memo e declarações Travel Rule.
- Criptografar CPF/CNPJ, telefone, endereço e identificadores de beneficiário em repouso; restringir acesso por função.
- API keys do provedor ficam apenas no backend/secret manager. Nunca colocar em `.env` versionado, frontend, logs, tickets ou screenshots.
- Assinaturas de webhook são verificadas sobre o raw body, antes do parse JSON.
- Rate limit, IP allowlist quando exigida, TLS, rotação de chaves, 2FA para administradores e trilha de auditoria.
- Alertas para destinatários novos, variações de rede, valores fora do perfil, repetição de cobranças e saques.
- Bloquear pagamentos quando KYC, conta do provedor, rede, beneficiário ou Travel Rule estiverem pendentes/rejeitados.
- Definir tratamento de chargeback, fraude, devolução PIX e ativos já enviados; não prometer reversão on-chain.

## Gate regulatório

A empresa não deve receber, custodiar, converter ou transferir recursos de terceiros fora do papel e das permissões aprovados pelo provedor e pelo assessor jurídico. Antes de produção, contador e advogado devem validar CNAE/objeto social, contratos, enquadramento, responsabilidade por KYC/AML, LGPD, comunicação ao BCB e tributação da comissão. O CNPJ atual precisa ser analisado à luz do fluxo real e não apenas do texto comercial.
