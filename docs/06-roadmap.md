# 06 — Roadmap de entrega PixSplit

Atualizado em 25/11/2026. Consulte também `docs/08-current-status.md` para o status detalhado e os bloqueios de produção.

## 0.2.x — Fundação SaaS e protótipo verificável

- [x] Monorepo pnpm com Next.js, Fastify, Prisma e PostgreSQL.
- [x] Painéis iniciais de superadmin e comerciante, checkout público, operações, carteiras e relatórios.
- [x] Cadastro/login com Argon2id, RBAC e escopo por comerciante.
- [x] Criptografia AES-256-GCM para dados sensíveis e cadastro/revisão de carteiras USDT.
- [x] Sessões HttpOnly, proteção CSRF, revogação de sessão e MFA TOTP obrigatório para superadmin.
- [x] Chaves API merchant com HMAC, nonce e proteção anti-replay.
- [x] Cobrança mock não pagável e liquidação simulada, split contábil 98%/2% e ledger com precisão inteira.
- [x] Idempotência transacional de cobranças e tratamento conservador de payout ambíguo.
- [x] Webhooks de entrada assinados e com claim/lease/fencing.
- [x] Webhooks de saída via outbox transacional, assinatura HMAC, retries limitados e proteção SSRF.
- [x] Bloqueio de IPv4/IPv6 privados e reservados, incluindo NAT64 well-known/local-use (PR #19).
- [x] Cliente TransFi v3 tipado e testes de contrato; não habilitado como adaptador de pagamentos.
- [x] Métricas Prometheus protegidas por Bearer.
- [x] Overlay local Prometheus + Grafana, dashboard provisionado, alertas iniciais e smoke tests no CI (PR #20).
- [x] CI com lint/typecheck, unitários, integrações PostgreSQL, migrações, build e E2E Chromium de comerciante e superadministrador.
- [x] Guard do painel superadmin por cookie HttpOnly, validação server-side do papel e logout com revogação (PR #22).
- [x] Retry manual de entregas de webhook `FAILED`, com ownership, compare-and-set, rate limit, auditoria e preservação do evento/payload (PR #23).
- [x] Gitleaks com varredura de histórico e CodeQL `security-extended` para JavaScript/TypeScript (PR #25).
- [x] Segredos temporários e mascarados gerados a cada execução do CI, sem valores fixos no workflow (PR #25).
- [x] Dependências JWT/Prisma corrigidas, lockfile congelado e `pnpm audit --audit-level moderate` obrigatório e aprovado (PR #28).
- [x] Dependabot semanal para npm (monorepo), GitHub Actions e Docker Compose (PR #28).
- [x] Atualização de Argon2 para `0.45.2` (PR #36).
- [x] Limite de dez endpoints webhook ativos por comerciante aplicado atomicamente na criação e reativação, com tratamento de conflitos SERIALIZABLE e testes concorrentes PostgreSQL (PR #37).
- [x] Prometheus atualizado para `v3.16.0` e Grafana para `13.3.1`, com smoke tests de scrape/provisioning (PRs #29 e #31).
- [x] GitHub Actions `checkout` e `setup-node` atualizadas para `v7`; `pnpm/action-setup` atualizado para `v6` (PRs #32, #33 e #38).
- [x] Workflow Dependency Review preparado; sua ativação automática aguarda o proprietário habilitar Dependency Graph nas configurações do GitHub (PR #28).
- [x] Reconciliação de payout `SUBMITTED` ambíguo após 30 minutos, consulta pela referência original, single-flight local, deduplicação e testes de fila (PR #43).
- [x] Coordenação da reconciliação entre réplicas com advisory lock transacional PostgreSQL e lote máximo de 25 pagamentos (PR #47; CI e Security aprovados).
- [x] Teste E2E em PostgreSQL real com dois clientes Prisma independentes para validar aquisição, contenção e liberação do advisory lock (PR #49; 45/45 etapas CI, CodeQL e Gitleaks aprovados).
- [x] Idempotência persistente na criação HMAC de cobranças de comerciantes: reserva de `externalId` antes do provedor, fingerprint HMAC, replay exato, conflito para payload divergente, recuperação de crash/concorrência e fail-closed para resultado ambíguo (PR #52; CI 45/45, Gitleaks e CodeQL aprovados).
- [x] Fila administrativa de reservas HMAC sem resposta: lista apenas pendências antigas, exibe comerciante/valor quando disponíveis e permite registrar revisão manual auditada sem desbloquear a referência (PR #54; CI 47/47, Gitleaks 5/5 e CodeQL 8/8 aprovados).
- [x] Fila de revisão sem bloqueio de visibilidade: após a primeira revisão, a reserva sai das 100 pendências exibidas, permanece bloqueada e auditável; compare-and-set impede sobrescrever a revisão (PR #56; CI 47/47, Gitleaks 5/5 e CodeQL 8/8 aprovados).
- [x] Proteção de dados nas notas de revisão administrativa: bloqueio server-side de formatos reconhecíveis de PII/credenciais antes de qualquer gravação, validação correta do CPF e teste de não mutação quando a nota é recusada (PR #58; CI 47/47, Gitleaks e CodeQL aprovados no SHA da PR).
- [x] Minimização e cache-control da fila de revisão: resposta omite e-mail, `merchantId` e `walletDestinationId`, deixa de consultar e-mail e define `Cache-Control: no-store` nos endpoints de consulta/revisão; testes unitários e PostgreSQL cobrem o contrato (PR #60; CI 47/47, Gitleaks e CodeQL aprovados).
- [x] Política global de cache para a API administrativa e redação de histórico: hook `onSend` garante `Cache-Control: no-store`/`Pragma: no-cache` em todas as rotas `/v1/admin/*`; notas livres históricas de revisão são removidas do payload de auditoria sem apagar o registro ou os metadados não textuais (PR #61; CI 47/47, Gitleaks e CodeQL aprovados).
- [x] Política global de cache para toda a API versionada: hook `onSend` garante `Cache-Control: no-store`/`Pragma: no-cache` em respostas `/v1/*`, incluindo autenticação, sessões, perfil, comerciantes e checkout, sem modificar `/health`, `/metrics` ou arquivos estáticos (PR #62; CI 47/47, Gitleaks e CodeQL aprovados no SHA da PR).
- [x] Minimização do metadata de auditoria de carteiras: evento `WALLET_REGISTERED` não armazena mais o texto livre `exchangeName`; a API remove valores históricos do payload de auditoria e acrescenta `exchangeNameRedacted`, preservando rede e tipo (PR #64; CI 47/47, Gitleaks e CodeQL aprovados no SHA da PR).
- [x] Origens públicas HTTPS obrigatórias em produção: `APP_URL` e `NEXT_PUBLIC_API_URL` rejeitam HTTP/inválidos; o CI usa placeholder HTTPS somente no build e mantém HTTP local para desenvolvimento/teste (PR #63; integrada em `80276dbc`; CI push e pull request 47/47, Gitleaks e CodeQL aprovados).
- [x] Readiness PostgreSQL/Redis: `/health` é liveness independente e `/ready` verifica `SELECT 1`/`PING`, devolvendo 503 se banco ou Redis estiver indisponível; CI exige readiness antes do E2E (PR #65; integrada em `ec1e1476`; CI push e pull request 47/47, Gitleaks e CodeQL aprovados).
- [x] Runbook operacional inicial.

## Próxima etapa — Governança e preparação de homologação

- [ ] Tornar o repositório Private e revisar o histórico em busca de segredos/dados reais.
- [ ] Ativar proteção de branch e exigir CI aprovado antes de merge.
- [ ] Habilitar Dependency Graph no GitHub e mudar `.github/workflows/dependency-review.yml` de `workflow_dispatch` para `pull_request`.
- [x] Preparação PostgreSQL 16→18: runbook de backup/restore/cutover/rollback, sidecar 18 em volume separado e ensaio lógico automatizado em CI com clusters descartáveis (PR #40).
- [x] Ensaio PostgreSQL 16→18 ampliado: PK/identity, sequência, FK, UNIQUE/CHECK, índice, JSONB e numeric(28,8) verificados após dump PG16 e restore PG18 em recursos descartáveis (PR #45).
- [ ] Planejar e aprovar o cutover dos dados reais para PostgreSQL 18: snapshot e backup verificados, compatibilidade de extensões/roles, restauração ensaiada com os dados do ambiente, janela de manutenção e rollback; só então atualizar o serviço principal (PR #30).
- [ ] Obter parecer jurídico/regulatório sobre enquadramento da PixSplit, split 98%/2%, movimentação de recursos de terceiros (Res. BCB 521, art. 76-A, § 3º) e contraparte autorizada (Res. BCB 520, art. 91).
- [ ] Verificar no cadastro oficial do BCB o CNPJ e o escopo autorizado da entidade jurídica exata de cada provedor; protocolo de pedido de autorização não equivale a autorização concedida.
- [ ] Definir o provedor principal (Foxbit ou TransFi) e obter aprovação comercial escrita para o modelo marketplace, condicionada ao parecer regulatório.
- [ ] Confirmar por escrito o payin PIX de terceiros, funding/ownership de saldo, conversão BRL→USDT e os dois payouts independentes.
- [ ] Receber sandbox, MIDs, permissões, webhooks e limites/tarifas documentados.
- [ ] Fechar fluxo de KYC/KYB dinâmico, beneficiários, Travel Rule e redes aceitas.
- [ ] Obter validação jurídica, regulatória, fiscal e de LGPD antes de operar valores reais; registrar a conclusão e as restrições específicas no gate `docs/12-brazil-crypto-regulatory-gates.md`.

## Próxima etapa — Integração financeira homologada (somente após aprovação)

- [ ] Implementar adapter do provedor principal a partir de contratos e schemas oficiais confirmados.
- [ ] Conectar onboarding de sender/recipient e descoberta de requisitos por país/tipo.
- [ ] Conectar cobrança PIX e confirmação final do payin.
- [ ] Conectar cotação/conversão e conciliação do valor líquido.
- [ ] Implementar payout merchant 98% e payout da plataforma 2% como pernas independentes.
- [ ] Implementar estados, retentativas seguras, timeouts, fila, idempotência e recuperação manual para cada perna.
- [ ] Homologar devolução PIX, chargeback, reembolso, falha parcial, webhook perdido/duplicado e reconciliação.
- [ ] Manter sandbox/live travado até aprovação independente de todos os cenários.

## Próxima etapa — Operação e produção

- [ ] Provisionar serviços, banco, Redis, domínios, TLS e secret manager em ambiente controlado.
- [ ] Migrar o overlay Prometheus/Grafana para ambiente real, com scrape de todas as réplicas.
- [x] Overlay opcional Alertmanager com receiver webhook via arquivo secreto, roteamento Prometheus, preflight HTTPS obrigatório no startup sem rede e teste CI de recusa HTTP/aceitação HTTPS; o stack Prometheus/Grafana padrão continua independente (PR #66 integrada em `78beacee`; PR #67 integrada em `16dcb470`; CI push e pull request 47/47, Gitleaks e CodeQL aprovados nas duas PRs).
- [ ] Configurar a URL HTTPS real do receptor no secret manager e comprovar recebimento de notificação de teste; CI usa somente domínio `.invalid` e não comprova entrega externa.
- [ ] Aplicar firewall/rede privada e controle de acesso operacional.
- [ ] Formalizar responsáveis e simular break-glass 2-de-3.
- [ ] Executar pentest externo, revisão de código e revisão de segurança independente.
- [ ] Fazer teste de carga, backups, restauração e disaster recovery.
- [ ] Fazer piloto controlado com limites aprovados e monitoramento.
- [ ] Liberar produção apenas depois de confirmar os dois payouts, ledger balanceado e saldo reconciliado.

## Critério de conclusão — 100%

O projeto só será considerado 100% concluído quando:
1. Aplicação e APIs estiverem implantadas, monitoradas e operacionais.
2. Provedor tiver aprovado por escrito o modelo e o fluxo completo.
3. Sandbox comprovar payin, conversão, dois payouts e todos os casos de falha/reconciliação.
4. Compliance, KYC/KYB, Travel Rule, jurídico/regulatório/fiscal e LGPD estiverem validados.
5. Pentest, backups, recuperação, incidentes e operação break-glass estiverem aprovados.
6. Produção real tiver sido liberada explicitamente e passar pelos critérios de segurança e reconciliação.

**Importante:** uma interface pronta ou CI verde não equivale à homologação financeira. Até o cumprimento dos gates acima, `PAYMENTS_MODE` permanece `mock`.
