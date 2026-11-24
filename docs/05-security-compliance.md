# 05 — Segurança, compliance e proteção de dados

## Regras obrigatórias

- Nenhuma seed phrase, private key ou senha de corretora de usuário será coletada.
- Carteiras externas são registradas como endereços públicos com rede, VASP/exchange, país, titular, tag/memo e declarações Travel Rule.
- Criptografar CPF/CNPJ, telefone, endereço e identificadores de beneficiário em repouso; restringir acesso por função.
- API keys do provedor ficam apenas no backend/secret manager. Nunca colocar em `.env` versionado, frontend, logs, tickets ou screenshots.
- Assinaturas de webhook são verificadas sobre o raw body, antes do parse JSON.
- Rate limit, IP allowlist quando exigida, TLS, rotação de chaves, TOTP para superadministradores e trilha de auditoria.
- Alertas para destinatários novos, variações de rede, valores fora do perfil, repetição de cobranças e saques.
- Bloquear pagamentos quando KYC, conta do provedor, rede, beneficiário ou Travel Rule estiverem pendentes/rejeitados.
- Definir tratamento de chargeback, fraude, devolução PIX e ativos já enviados; não prometer reversão on-chain.

## Gate regulatório

A empresa não deve receber, custodiar, converter ou transferir recursos de terceiros fora do papel e das permissões aprovados pelo provedor e pelo assessor jurídico. Antes de produção, contador e advogado devem validar CNAE/objeto social, contratos, enquadramento, responsabilidade por KYC/AML, LGPD, comunicação ao BCB e tributação da comissão. O CNPJ atual precisa ser analisado à luz do fluxo real e não apenas do texto comercial.

## Segundo fator administrativo

- Superadministradores podem habilitar TOTP no painel, usando qualquer aplicativo autenticador compatível com RFC 6238.
- O segredo de 160 bits é cifrado com AES-256-GCM antes de ser persistido. O status administrativo nunca devolve o segredo.
- O login exige senha e, quando TOTP estiver ativo, um desafio de cinco minutos mais código de seis dígitos.
- O código validado é consumido atomicamente no PostgreSQL; o mesmo passo não pode autenticar duas tentativas.
- O setup só é considerado concluído depois da confirmação do primeiro código.
- Antes de produção, todos os superadministradores devem estar com TOTP ativado. Recomenda-se manter um procedimento de recuperação administrativa fora de banda, com aprovação dupla.
